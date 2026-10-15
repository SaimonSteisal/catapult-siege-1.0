// ============================================================================
//  systems/ballistics.js — projectiles, impact resolution, blast, prediction
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, makeRng, _v1, _v2, _v3, DEG } from '../core/utils.js';

const BALL = CFG.ballistics;
const UP = new THREE.Vector3(0, 1, 0);

/** aerodynamic wind coupling per ammo (light shells drift more) */
export function windCouplingFor(ammo) { return 0.030 + ammo.drag * 8.0; }

export class Ballistics {
  constructor(game) {
    this.game = game;                 // {scene, physics, structures, debris, vfx, audio, mission, camera}
    this.projectiles = [];
    this.pool = [];
    this.rng = makeRng(4242);
    this.onImpact = null;             // (result) => void
    this._tmpPos = new THREE.Vector3();
    this._tmpDir = new THREE.Vector3();
    this._hitList = [];
    this.trailGeoPool = [];
  }

  // ------------------------------------------------------------------ launch ---
  launch(pos, dir, speed, ammoId, opt = {}) {
    const ammo = CFG.ammo[ammoId] || CFG.ammo.stone;
    const p = this.pool.pop() || this._makeProjectile();
    p.pos.copy(pos);
    p.vel.copy(dir).multiplyScalar(speed);
    p.radius = ammo.mass > 60 ? 0.5 : ammo.mass > 40 ? 0.42 : 0.34;
    p.mass = ammo.mass;
    p.drag = ammo.drag;
    p.restitution = ammo.restitution;
    p.windAffected = true;
    p.windCoupling = windCouplingFor(ammo);
    p.friction = 0.34;
    p.gravityScale = 1;
    p.angularDamp = 0.97;
    p.collidesBlocks = true;
    p.alive = true;
    p.life = 14;
    p.ammoId = ammoId;
    p.ammo = ammo;
    p.bounces = 0;
    p.maxBounces = ammo.pierce ? 3 : 1;
    p.fuse = ammo.fuse || 0;
    p.fuseArmed = ammo.fuse ? 0.05 : 0;
    p.spin = new THREE.Vector3((this.rng() - 0.5) * 6, (this.rng() - 0.5) * 6, (this.rng() - 0.5) * 6);
    p.rot = p.rot || new THREE.Euler();
    p.trailPts = [];   // NOTE: distinct from p.trail (the THREE.Line)
    p.damageMul = opt.damageMul || 1;
    p.spreadNote = opt.spreadNote || 0;
    p.age = 0;
    p.trailPts = [];
    p.impactHandled = false;
    p._prev = p._prev || new THREE.Vector3();
    p._prev.copy(pos);
    p.onHit = (body, target, impact, normal, point) => this._onHit(body, target, impact, normal, point);
    p.onWater = (body, pos) => this._onWater(body, pos);

    p.mesh.visible = true;
    p.mesh.geometry.dispose();
    p.mesh.geometry = new THREE.DodecahedronGeometry(p.radius, ammoId === 'truestone' ? 2 : 1);
    p.mesh.material.color.setHex(ammo.vfx === 'fire' ? 0x4a3a2a : ammo.vfx === 'pierce' ? 0x6e7278 : 0x9c968a);
    p.mesh.material.emissive = p.mesh.material.emissive || new THREE.Color(0x000000);
    if (ammo.vfx === 'fire') p.mesh.material.emissive.setHex(0xff5a1e);
    else p.mesh.material.emissive.setHex(0x000000);

    this.projectiles.push(p);
    this.game.physics.activeBodies.push(p);
    return p;
  }

  _makeProjectile() {
    const mesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.42, 1),
      new THREE.MeshLambertMaterial({ color: 0x9c968a, flatShading: true })
    );
    this.game.scene.add(mesh);
    const trailGeo = new THREE.BufferGeometry();
    const arr = new Float32Array(CFG.vfx.trailSegments * 3);
    trailGeo.setAttribute('position', new THREE.BufferAttribute(arr, 3));
    trailGeo.setDrawRange(0, 0);
    const trail = new THREE.Line(trailGeo, this.game.materials.ghost.clone());
    trail.frustumCulled = false;
    trail.visible = false;
    this.game.scene.add(trail);
    return { mesh, trail, pos: new THREE.Vector3(), vel: new THREE.Vector3(), rot: new THREE.Euler() };
  }

  // ------------------------------------------------------------------- hits ---
  _onHit(body, target, impact, normal, point) {
    if (body.impactHandled) return;
    const ammo = body.ammo;

    // fuse (explosive) — detonate slightly after contact
    if (ammo.fuse) {
      if (!body.fuseStarted) {
        body.fuseStarted = true;
        body.vel.multiplyScalar(0.35);
        setTimeout(() => { if (body.alive) this._detonate(body, point || body.pos, normal); }, ammo.fuse * 1000);
      }
      return;
    }

    if (target === 'terrain') {
      body.impactHandled = true;
      this._detonateOrImpact(body, point || body.pos, normal, 'terrain');
      return;
    }

    // block hit
    body.bounces++;
    const res = this._damageBlock(body, target, impact, normal, point);
    if (ammo.pierce && body.bounces <= body.maxBounces && res.penetrated) {
      // keep flying, lose energy
      body.vel.multiplyScalar(0.62);
      body.impactHandled = false;
      return;
    }
    body.impactHandled = true;
    if (ammo.radius > 0) this._detonate(body, point || body.pos, normal);
    else this._detonateOrImpact(body, point || body.pos, normal, 'block', target);
  }

  _onWater(body, pos) {
    if (body.splashed) return;
    body.splashed = true;
    this.game.vfx.splash(pos.clone(), 1.3);
    this.game.audio.splash(1.1);
    body.vel.multiplyScalar(0.25);
    body.drag *= 6;
    body.windAffected = false;
  }

  _damageBlock(body, block, impact, normal, point) {
    const ammo = body.ammo;
    const ke = 0.5 * body.mass * impact * impact;
    // kinetic energy matters: a flat 20+ m/s hit must one-shot a stone block,
    // otherwise sieges stall into scratching paint (playtest finding)
    let dmg = (ke * 0.09 + ammo.dmg * 0.75) * (body.damageMul || 1);
    // kinetic bonus for heavy slow rounds
    if (ammo.id === 'anchor' || ammo.id === 'granite') dmg *= 1 + clamp(impact / 40, 0, 0.6);

    const crit = this.rng.chance(CFG.blocks.critChanceBase + (body.critBonus || 0));
    if (crit) dmg *= CFG.blocks.critMul * (body.critMulBonus || 1);

    const dir = _v1.copy(body.vel).normalize();
    const res = this.game.structures.damage(block, dmg, { source: 'shot', velocity: impact, dir: dir.clone(), crit });

    // penetration test: does the projectile have enough energy left to pass through?
    const penetrated = res.killed && ammo.pierce && ke > block.maxHp * 3;

    this.game.vfx.blockImpact(point ? point.clone() : block.p.clone(), normal ? normal.clone() : UP, block.mat, impact, ammo);
    this.game.audio[block.mat === 'wood' ? 'impactWood' : block.mat === 'metal' ? 'impactMetal' : 'impactStone'](clamp(impact / 26, 0.2, 1.6));
    if (res.killed) {
      this.game.vfx.destroyBlock(block, dir);
      this.game.audio.collapse(clamp(block.mass / 900, 0.3, 1.4));
    }
    if (crit) this.game.audio.crit();

    if (this.onImpact) {
      this.onImpact({
        kind: res.killed ? 'destroy' : 'hit',
        block, damage: res.dmg || dmg, crit, point: point ? point.clone() : block.p.clone(),
        ammoId: ammo.id, speed: impact, penetrated, target: block.cid ? this.game.structures.targets.find((t) => t.id === block.cid) : null,
      });
    }
    return { penetrated, killed: res.killed, dmg };
  }

  _detonate(body, point, normal) {
    const ammo = body.ammo;
    const flags = (this.game.mods && this.game.mods.flags) || {};
    let R = ammo.radius * (body.radiusBonus || 1);
    // «Каменный дождь»: картечь бьёт по большей площади (r 4.2 → 5.6 м)
    if (ammo.id === 'grapeshot' && flags.stoneRain) R = Math.max(R, 5.6);
    const center = point ? point.clone() : body.pos.clone();
    this.game.vfx.explosion(center, R, ammo.vfx);
    this.game.audio.explode(clamp(R / 3, 0.4, 1.6));
    if (ammo.vfx === 'fire') this.game.audio.fireWhoosh();

    // «Улей» отвлекает расчёты вражеских орудий — контрбатарея замолкает
    if (ammo.distract && this.game.enemy && this.game.enemy.enabled) {
      this.game.enemy.nextFire += ammo.distract;
      this.game.enemy.distractUnits(ammo.distract);
      if (this.onImpact) this.onImpact({ kind: 'distract', point: center, ammoId: ammo.id });
    }

    const dir = _v2.copy(body.vel).normalize();
    const list = this.game.structures.querySphere(center, R + 1.5);
    let totalDamage = 0, killed = 0;
    for (const b of list) {
      if (!b.alive) continue;
      const d = center.distanceTo(b.p);
      const falloff = clamp(1 - Math.max(0, d - R * 0.35) / (R * 1.2), 0.12, 1);
      const dmg = ammo.dmg * falloff * (body.damageMul || 1);
      const r = this.game.structures.damage(b, dmg, { source: 'blast', velocity: 12 * falloff, dir: _v3.copy(b.p).sub(center).normalize() });
      totalDamage += r.dmg || dmg;
      if (r.killed) killed++;
      if (ammo.dot) this.game.structures.ignite(b, ammo.dot * (flags.pyromaniac ? 1.35 : 1), ammo.dotTime || 5);
    }
    // blasts also mow down garrison soldiers in the radius (grapeshot's promise)
    if (this.game.enemy && this.game.enemy.enabled) {
      this.game.enemy.hurtArea(center, R + 1.5, ammo.dmg * (body.damageMul || 1) * 0.9);
    }
    // chain reaction (magazine)
    for (const t of this.game.structures.targets) {
      if (t.destroyed || !t.chainReaction) continue;
      if (center.distanceTo(t.center) < R + t.chainReaction.radius * 0.5) {
        setTimeout(() => this._chainReaction(t), 130 + Math.random() * 260);
      }
    }
    body.alive = false;
    body.mesh.visible = false;
    if (this.onImpact) this.onImpact({ kind: 'blast', point: center, radius: R, damage: totalDamage, killed, ammoId: ammo.id, target: null });
  }

  _chainReaction(target) {
    if (target._chained) return;
    target._chained = true;
    const cr = target.chainReaction;
    const center = target.center.clone();
    this.game.vfx.explosion(center, cr.radius, 'boom');
    this.game.audio.explode(1.7);
    const dir = new THREE.Vector3(0, 1, 0);
    const list = this.game.structures.querySphere(center, cr.radius + 2);
    for (const b of list) {
      if (!b.alive) continue;
      const d = center.distanceTo(b.p);
      const falloff = clamp(1 - d / (cr.radius * 1.25), 0.15, 1);
      this.game.structures.damage(b, cr.damage * falloff, { source: 'blast', velocity: 18 * falloff, dir: _v3.copy(b.p).sub(center).normalize() });
      if (b.mat === 'pitch') this.game.structures.ignite(b, 30, 3);
    }
    if (this.onImpact) this.onImpact({ kind: 'chain', point: center, radius: cr.radius, target });
  }

  _detonateOrImpact(body, point, normal, kind, block) {
    const ammo = body.ammo;
    this.game.vfx.impact(point, normal, kind === 'terrain' ? 'ground' : ammo.vfx, clamp(body.vel.length() / 30, 0.3, 1.4), ammo);
    if (kind === 'terrain') {
      this.game.audio.impactGround(clamp(body.vel.length() / 30, 0.3, 1.4));
      if (this.onImpact) this.onImpact({ kind: 'miss', point: point.clone(), ammoId: ammo.id, speed: body.vel.length() });
    }
    body.alive = false;
    body.mesh.visible = false;
  }

  // ------------------------------------------------------------------ update ---
  update(dt) {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i];
      p.age += dt;
      // garrison proxy hits: the shell sweeps through soldier bodies on its way
      if (p.alive && p._prev && this.game.enemy && this.game.enemy.enabled) {
        const maxHits = CFG.enemy.pierceMax[p.ammoId] || 1;
        const hits = this.game.enemy.sweepSegment(p._prev, p.pos, p.radius, maxHits);
        if (hits.length) {
          const dir = _v3.copy(p.vel).normalize();
          for (const u of hits) {
            const killed = this.game.enemy.hurt(u, p.ammo.dmg * 0.9 * (p.damageMul || 1), dir, p.ammo.vfx === 'fire' ? 'fire' : 'shot');
            if (killed) p.vel.multiplyScalar(0.985);
          }
        }
      }
      if (p._prev) p._prev.copy(p.pos);
      if (p.mesh.visible) {
        p.mesh.position.copy(p.pos);
        p.mesh.rotation.copy(p.rot);
      }
      // trail (polyline of the last N positions)
      if (p.trailPts && p.trail) {
        p.trailPts.push(p.pos.clone());
        if (p.trailPts.length > CFG.vfx.trailSegments) p.trailPts.shift();
        if (p.trailPts.length > 1 && p.mesh.visible) {
          const attr = p.trail.geometry.attributes.position;
          for (let k = 0; k < p.trailPts.length; k++) { attr.setXYZ(k, p.trailPts[k].x, p.trailPts[k].y, p.trailPts[k].z); }
          p.trail.geometry.setDrawRange(0, p.trailPts.length);
          attr.needsUpdate = true;
          p.trail.geometry.computeBoundingSphere();
          p.trail.visible = true;
        }
      }
      if (p.fuseArmed > 0) p.fuseArmed -= dt;
      if (!p.alive || p.life <= 0 || p.age > 16) {
        this._retire(p, i);
      }
    }
  }

  _retire(p, i) {
    p.mesh.visible = false;
    if (p.trail) { p.trail.visible = false; p.trail.geometry.setDrawRange(0, 0); }
    if (p.trailPts) p.trailPts.length = 0;
    const idx = this.game.physics.activeBodies.indexOf(p);
    if (idx >= 0) this.game.physics.activeBodies.splice(idx, 1);
    if (i === undefined) i = this.projectiles.indexOf(p);
    if (i >= 0) this.projectiles.splice(i, 1);
    p.impactHandled = false; p.fuseStarted = false; p.splashed = false;
    this.pool.push(p);
    if (this.onRetire) this.onRetire(p);
  }

  clear() {
    while (this.projectiles.length) this._retire(this.projectiles[0], 0);
  }

  get inFlight() { return this.projectiles.some((p) => p.alive && p.mesh.visible); }
  get active() { return this.projectiles.filter((p) => p.alive); }

  // -------------------------------------------------------------- prediction ---
  /**
   * Predict the trajectory from the current aim. Returns {points, impact, spreadRadius}
   */
  predict(origin, dir, speed, ammoId, opt = {}) {
    const ammo = CFG.ammo[ammoId] || CFG.ammo.stone;
    return this.game.physics.predict(origin, _v1.copy(dir).multiplyScalar(speed), {
      drag: ammo.drag,
      windAffected: true,
      windCoupling: windCouplingFor(ammo),
      points: opt.points || CFG.ballistics.predictPoints,
      dt: opt.dt || CFG.ballistics.predictDt,
      stopOnBlock: true,
      mass: ammo.mass,
    });
  }

  /** Monte-Carlo CEP (circular error probable) in metres at the predicted impact */
  estimateCep(origin, dir, speed, ammoId, sigmaDeg, samples = 9) {
    let sum = 0, n = 0;
    const base = this.predict(origin, dir, speed, ammoId);
    if (!base.length) return 0;
    const target = base[base.length - 1];
    for (let i = 0; i < samples; i++) {
      const a = this.rng() * Math.PI * 2;
      const r = Math.abs(this.rng.gauss()) * sigmaDeg * DEG;
      const d = _v2.copy(dir)
        .applyAxisAngle(UP, Math.cos(a) * r)
        .applyAxisAngle(_v3.copy(dir).cross(UP).normalize(), Math.sin(a) * r)
        .normalize();
      const p = this.predict(origin, d, speed * (1 + this.rng.gauss() * 0.006), ammoId, { points: 22 });
      if (!p.length) continue;
      sum += Math.hypot(p[p.length - 1].x - target.x, p[p.length - 1].z - target.z);
      n++;
    }
    return n ? sum / n : 0;
  }

  /** suggested correction after a miss (teaching system, §5) */
  suggestCorrection(missPoint, targetPoint) {
    const dx = targetPoint.x - missPoint.x, dz = targetPoint.z - missPoint.z;
    const dist = Math.hypot(dx, dz);
    const along = -dx; // firing direction is -X
    return {
      dist,
      powerDelta: clamp(along * 0.011, -0.12, 0.12),
      azDelta: clamp(Math.atan2(-dz, -dx) * 0.35 * (180 / Math.PI) * 0.02, -3, 3),
      short: along > 0,
    };
  }
}
