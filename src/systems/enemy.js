// ============================================================================
//  systems/enemy.js — garrison AI, counter-battery fire, field repairs (§4.8)
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, makeRng, lerp, damp } from '../core/utils.js';

const E = CFG.enemy;

export class Enemy {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.rng = makeRng(777);
    this.soldiers = [];
    this.inst = null;
    this.engines = [];
    this.nextFire = 0;
    this.incoming = [];       // {mesh, pos, t}
    this.enabled = true;
    this.alertLevel = 0;      // 0..1 — rises as the fort takes damage
    this.waveTimer = 0;
    this.onEvent = null;
    this._dummy = new THREE.Object3D();
    this._col = new THREE.Color();
    this.soldierGeo = null;
  }

  reset() {
    this.clear();
    this.nextFire = this.rng.range(E.returnFireDelay[0], E.returnFireDelay[1]) + 5;
    this.alertLevel = 0;
    this.waveTimer = 0;
  }

  clear() {
    if (this.inst) { this.scene.remove(this.inst); this.inst.geometry.dispose(); this.inst = null; }
    for (const w of this.incoming) { this.scene.remove(w.mesh); this.scene.remove(w.warn); w.warn.geometry.dispose(); w.warn.material.dispose(); }
    this.incoming.length = 0;
    this.soldiers.length = 0;
    this.engines.length = 0;
  }

  /** spawn garrison from mission targets */
  setup(targets, count, playerPos) {
    this.reset();
    this.playerPos = playerPos.clone();
    const n = clamp(count, 0, 22);
    if (n === 0) return;
    this.soldierGeo = new THREE.CapsuleGeometry(0.26, 0.72, 3, 6);
    this.inst = new THREE.InstancedMesh(this.soldierGeo, new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }), n);
    this.inst.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.inst.frustumCulled = false;
    this.scene.add(this.inst);

    for (let i = 0; i < n; i++) {
      const home = targets.length ? targets[this.rng.int(0, targets.length - 1)].center : new THREE.Vector3(0, 0, 74);
      const a = this.rng() * Math.PI * 2;
      const r = this.rng.range(1.5, 7);
      const pos = new THREE.Vector3(home.x + Math.cos(a) * r, 0, home.z + Math.sin(a) * r);
      pos.y = this.game.terrain ? this.game.terrain.heightAt(pos.x, pos.z) + 0.72 : 0.72;
      this.soldiers.push({
        pos, home: pos.clone(), vel: new THREE.Vector3(),
        state: 'patrol', t: this.rng() * 10, hp: E.soldierHp, alive: true,
        phase: this.rng() * 6.28, cover: null, workTarget: null, bob: 0,
      });
      this.inst.setColorAt(i, this._col.setHex(i % 3 === 0 ? 0x4a5f7a : i % 3 === 1 ? 0x3d5a80 : 0x5a5550));
    }
    if (this.inst.instanceColor) this.inst.instanceColor.needsUpdate = true;
    this.engines = targets.filter((t) => t.type === 'engine' && !t.destroyed);
  }

  setAlert(v) { this.alertLevel = clamp(v, 0, 1); }

  update(dt, ctx) {
    if (!this.enabled) return;
    const { trebuchet, structures, missionKind } = ctx;
    this.engines = structures.targets.filter((t) => t.type === 'engine' && !t.destroyed);

    // ------------------------------------------------------ counter-battery ---
    this.nextFire -= dt;
    if (this.nextFire <= 0 && this.engines.length && trebuchet) {
      const alive = this.engines.length;
      const acc = clamp(E.returnFireAccuracy + alive * E.accuracyPerEngineAlive + this.alertLevel * 0.15, 0.1, 0.95);
      this._fireAtPlayer(acc, alive);
      this.nextFire = lerp(E.returnFireDelay[1], E.returnFireDelay[0], clamp(alive / 3, 0, 1)) * (1 + this.rng.range(-0.25, 0.35)) / clamp(0.4 + acc, 0.4, 1.6);
    }

    // incoming shells: visible parabolic flight with a smoke trail
    for (let i = this.incoming.length - 1; i >= 0; i--) {
      const w = this.incoming[i];
      w.t += dt;
      const k = clamp(w.t / w.delay, 0, 1);
      w.mesh.position.lerpVectors(w.from, w.pos, k);
      w.mesh.position.y += w.apex * 4 * k * (1 - k) * 0.5 + 0.4;
      w.mesh.rotation.x += dt * 5; w.mesh.rotation.z += dt * 3;
      w.trailT -= dt;
      if (w.trailT <= 0) {
        w.trailT = 0.07;
        this.game.vfx.smoke.spawn(w.mesh.position.clone(), {
          life: 0.8, size: 0.5, grow: 1.6, opacity: 0.3, color: 0x6a655c,
          vel: new THREE.Vector3(0, 0.4, 0), drag: 1.2,
        });
      }
      const wk = w.warn;
      wk.material.opacity = 0.35 + Math.sin(w.t * 10) * 0.25;
      wk.scale.setScalar(1 + (1 - k) * 0.5);
      if (w.t >= w.delay) {
        this._resolveIncoming(w);
        this.scene.remove(w.mesh);
        this.scene.remove(w.warn);
        w.warn.geometry.dispose(); w.warn.material.dispose();
        this.incoming.splice(i, 1);
      }
    }

    // idle engines: thin smoke + muzzle flash decay, so the threat is readable
    this._engineFxT = (this._engineFxT || 0) - dt;
    const puff = this._engineFxT <= 0;
    if (puff) this._engineFxT = 2.6;
    for (const e of this.engines) {
      if (e.destroyed) continue;
      const p = e.enginePos || e.center;
      if (e._flash > 0) e._flash -= dt;
      else if (puff && this.rng.chance(0.5)) {
        this.game.vfx.smoke.spawn(p.clone().add(new THREE.Vector3(0, 1.6, 0)), {
          life: 1.6, size: 0.55, grow: 1.8, opacity: 0.22, color: 0x77706a,
          vel: new THREE.Vector3(0, 1.1, 0), drag: 0.6,
        });
      }
    }

    // ------------------------------------------------------------ soldiers ---
    if (this.inst && this.soldiers.length) {
      for (let i = 0; i < this.soldiers.length; i++) {
        const s = this.soldiers[i];
        if (!s.alive) { this._dummy.position.set(0, -999, 0); this._dummy.scale.setScalar(0.001); this._dummy.updateMatrix(); this.inst.setMatrixAt(i, this._dummy.matrix); continue; }
        s.t += dt;
        this._soldierAI(s, dt, structures);
        this._dummy.position.copy(s.pos);
        this._dummy.position.y += Math.abs(Math.sin(s.t * 6 + s.phase)) * (s.state === 'patrol' || s.state === 'flee' ? 0.07 : 0.012);
        this._dummy.rotation.set(0, s.facing || 0, s.state === 'flee' ? Math.sin(s.t * 9) * 0.12 : 0);
        this._dummy.scale.setScalar(s.state === 'cover' ? 0.82 : 1);
        this._dummy.updateMatrix();
        this.inst.setMatrixAt(i, this._dummy.matrix);
      }
      this.inst.instanceMatrix.needsUpdate = true;
    }

    // --------------------------------------------------- defend-mode waves ---
    if (missionKind === 'DEFEND') {
      this.waveTimer += dt;
      if (this.waveTimer > E.defendWaveInterval) {
        this.waveTimer = 0;
        if (this.onEvent) this.onEvent('wave', {});
      }
    }
  }

  _soldierAI(s, dt, structures) {
    const alert = this.alertLevel;
    switch (s.state) {
      case 'patrol': {
        s.wp = s.wp || s.home.clone();
        if (s.pos.distanceTo(s.wp) < 0.7 || s.t > s.nextWp) {
          const a = this.rng() * 6.28, r = this.rng.range(1.5, 6);
          s.wp = new THREE.Vector3(s.home.x + Math.cos(a) * r, 0, s.home.z + Math.sin(a) * r);
          s.wp.y = (this.game.terrain ? this.game.terrain.heightAt(s.wp.x, s.wp.z) : 0) + 0.72;
          s.nextWp = s.t + this.rng.range(3, 7);
        }
        this._moveToward(s, s.wp, 1.5, dt);
        if (alert > 0.45 && this.rng.chance(dt * 0.6)) s.state = alert > 0.75 ? 'flee' : 'cover';
        else if (structures && this.rng.chance(dt * 0.05)) {
          // find a damaged block to repair
          const b = this._findRepairTarget(s, structures);
          if (b) { s.workTarget = b; s.state = 'repair'; }
        }
        break;
      }
      case 'cover': {
        if (!s.cover) {
          const a = this.rng() * 6.28;
          s.cover = new THREE.Vector3(s.home.x + Math.cos(a) * 3.5, 0, s.home.z - Math.abs(Math.sin(a)) * 3.5 - 2);
          s.cover.y = (this.game.terrain ? this.game.terrain.heightAt(s.cover.x, s.cover.z) : 0) + 0.72;
        }
        this._moveToward(s, s.cover, 2.6, dt);
        if (alert < 0.3) { s.state = 'patrol'; s.cover = null; }
        break;
      }
      case 'flee': {
        if (!s.cover) {
          s.cover = new THREE.Vector3(s.home.x + (this.rng() - 0.5) * 6, 0, s.home.z + this.rng.range(6, 14));
          s.cover.y = (this.game.terrain ? this.game.terrain.heightAt(s.cover.x, s.cover.z) : 0) + 0.72;
        }
        this._moveToward(s, s.cover, 3.6, dt);
        if (alert < 0.4) { s.state = 'patrol'; s.cover = null; }
        break;
      }
      case 'repair': {
        const b = s.workTarget;
        if (!b || !b.alive) { s.state = 'patrol'; s.workTarget = null; break; }
        const wp = new THREE.Vector3(b.p.x, b.p.y - b.hs.y - 0.6, b.p.z + 0.9);
        this._moveToward(s, wp, 2.0, dt);
        if (s.pos.distanceTo(wp) < 1.4) {
          b.hp = Math.min(b.maxHp, b.hp + E.repairRateHpPerSec * dt);
          structures._tintDamage(b);
          s.bob = Math.sin(s.t * 9) * 0.1;
        }
        if (alert > 0.6) { s.state = 'cover'; s.workTarget = null; }
        break;
      }
    }
  }

  _findRepairTarget(s, structures) {
    let best = null, bestScore = 1e9;
    for (const b of structures.blocks) {
      if (!b.alive || b.hp >= b.maxHp * 0.92) continue;
      const d = b.p.distanceTo(s.pos);
      if (d > 26) continue;
      const score = d + (b.hp / b.maxHp) * 12;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  _moveToward(s, wp, speed, dt) {
    const dx = wp.x - s.pos.x, dz = wp.z - s.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    s.pos.x += (dx / d) * speed * dt;
    s.pos.z += (dz / d) * speed * dt;
    const gy = (this.game.terrain ? this.game.terrain.heightAt(s.pos.x, s.pos.z) : 0) + 0.72;
    s.pos.y = damp(s.pos.y, gy, 8, dt);
    s.facing = Math.atan2(dx, dz);
  }

  _fireAtPlayer(acc, enginesAlive) {
    const target = this.playerPos.clone();
    // scatter
    const spread = (1 - acc) * 9 + 1.2;
    target.x += this.rng.gauss() * spread;
    target.z += this.rng.gauss() * spread;
    target.y = this.game.terrain ? this.game.terrain.heightAt(target.x, target.z) : 0;

    const engine = this.rng.pick(this.engines);
    const from = engine.enginePos ? engine.enginePos.clone() : engine.center.clone();
    from.y += 2.4;

    // ---- the shot is VISIBLE: muzzle flash + smoke at the engine, then a lobbed
    //      projectile with a trail flying a parabola engine → impact point
    const shell = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), new THREE.MeshLambertMaterial({ color: 0x55504a, flatShading: true }));
    shell.position.copy(from);
    this.scene.add(shell);

    const vfx = this.game.vfx;
    vfx.flashes.spawn(from, { life: 0.18, size: 2.6, grow: 1.2, opacity: 0.9, color: 0xffd9a0 });
    vfx.dustPuff(from, 7, 1.1, 0x8a8070);
    vfx.smokeColumn(from, 4, 0.7, 0x5a554c);
    engine._flash = 0.4;

    const dist = from.distanceTo(target);
    const flight = clamp(2.2 + dist * 0.016, 2.2, 4.2);      // readable flight time
    const apex = 9 + dist * 0.14;

    // impact warning ring stays on the ground for the whole flight
    const warn = new THREE.Mesh(
      new THREE.RingGeometry(1.2, 1.7, 22),
      new THREE.MeshBasicMaterial({ color: 0xff4a3a, transparent: true, opacity: 0.65, side: THREE.DoubleSide, depthWrite: false })
    );
    warn.rotation.x = -Math.PI / 2;
    warn.position.copy(target).setY((this.game.terrain ? this.game.terrain.heightAt(target.x, target.z) : 0) + 0.12);
    this.scene.add(warn);

    this.incoming.push({ mesh: shell, warn, from, pos: target, t: 0, delay: flight, flight, apex, acc, enginesAlive, trailT: 0 });
    this.game.audio.enemyShot(dist);
    if (this.onEvent) this.onEvent('incoming', { delay: flight, from });
  }

  _resolveIncoming(w) {
    this.scene.remove(w.warn);
    const trebuchet = this.game.trebuchet;
    if (!trebuchet) return;
    const d = w.pos.distanceTo(trebuchet.root.position);
    this.game.vfx.impact(w.pos, new THREE.Vector3(0, 1, 0), 'ground', 1.1);
    this.game.audio.impactStone(1.1);
    if (d < 6.5) {
      // direct damage to a random node
      const nodes = CFG.trebuchet.nodes;
      const weights = nodes.map(() => 1);
      let sum = 0; for (const x of weights) sum += x;
      let r = this.rng() * sum, node = nodes[0];
      for (let i = 0; i < nodes.length; i++) { r -= weights[i]; if (r <= 0) { node = nodes[i]; break; } }
      const ch = this.game.mission ? this.game.mission.chapter : 1;
      const dmg = this.rng.range(E.returnFireDamage[0], E.returnFireDamage[1]) * (0.65 + 0.12 * ch) * (1 + (w.enginesAlive - 1) * 0.12);
      const applied = trebuchet.damageNode(node, dmg);
      this.game.audio.nodeDamage();
      this.game.audio.alarm();
      this.game.vfx.addShake(0.22);
      if (this.onEvent) this.onEvent('playerHit', { node, dmg: applied, pos: w.pos });
    } else if (d < 14) {
      this.game.vfx.addShake(0.08);
      if (this.onEvent) this.onEvent('nearMiss', { dist: d });
    }
  }

  /** damage soldiers in a blast radius */
  hurtArea(pos, radius, dmg) {
    let killed = 0;
    for (const s of this.soldiers) {
      if (!s.alive) continue;
      const d = s.pos.distanceTo(pos);
      if (d > radius) continue;
      s.hp -= dmg * clamp(1 - d / radius, 0.2, 1);
      s.state = 'flee'; s.cover = null;
      if (s.hp <= 0) { s.alive = false; killed++; this.game.vfx.dustPuff(s.pos, 4, 0.5, 0x8a4a3a); }
    }
    return killed;
  }

  get aliveSoldiers() { return this.soldiers.filter((s) => s.alive).length; }
}
