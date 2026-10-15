// ============================================================================
//  systems/enemy.js — garrison AI 1.4: role units (archer/spear/engineer/crew/
//  commander) on fort slots, killable by shot/blast/crush, morale & rout,
//  counter-battery fire, DEFEND waves (§4.8, PLAN_UNITS_AND_FORTS.md)
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, makeRng, lerp, damp } from '../core/utils.js';

const E = E_CFG();
function E_CFG() { return CFG.enemy; }
const SW1 = new THREE.Vector3(), SW2 = new THREE.Vector3(), SW3 = new THREE.Vector3(), SW4 = new THREE.Vector3();

// ---------------------------------------------------------------- geometry ---
// faction palette (cold blues/iron vs the player's warm camp) — plan §2
const PAL = {
  tunic: 0x3d5a80, officer: 0x5a4a78, skin: 0xc9a27e, iron: 0x6e7278,
  leather: 0x6b4a2c, cloth: 0xd8d2c0, wood: 0x4a3a2c, crest: 0xb3372c,
};

function painted(geo, hex) {
  const c = new THREE.Color(hex);
  const n = geo.attributes.position.count;
  const arr = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { arr[i * 3] = c.r; arr[i * 3 + 1] = c.g; arr[i * 3 + 2] = c.b; }
  geo.setAttribute('color', new THREE.BufferAttribute(arr, 3));
  return geo;
}
function box(w, h, d, hex, x = 0, y = 0, z = 0, ry = 0, rx = 0) {
  const g = new THREE.BoxGeometry(w, h, d);
  if (ry) g.rotateY(ry);
  if (rx) g.rotateX(rx);
  g.translate(x, y, z);
  return painted(g, hex);
}
function cone(r, h, hex, x = 0, y = 0, z = 0) {
  const g = new THREE.ConeGeometry(r, h, 6);
  g.translate(x, y, z);
  return painted(g, hex);
}
function cyl(rt, rb, h, hex, x = 0, y = 0, z = 0, rx = 0, rz = 0) {
  const g = new THREE.CylinderGeometry(rt, rb, h, 6);
  if (rx) g.rotateX(rx);
  if (rz) g.rotateZ(rz);
  g.translate(x, y, z);
  return painted(g, hex);
}
function mergeGeos(list) {
  let vc = 0, ic = 0;
  for (const g of list) { vc += g.attributes.position.count; ic += (g.index ? g.index.count : g.attributes.position.count); }
  const pos = new Float32Array(vc * 3), nrm = new Float32Array(vc * 3), col = new Float32Array(vc * 3);
  const idx = vc > 65535 ? new Uint32Array(ic) : new Uint16Array(ic);
  let vo = 0, io = 0;
  for (const g of list) {
    pos.set(g.attributes.position.array, vo * 3);
    nrm.set(g.attributes.normal.array, vo * 3);
    col.set(g.attributes.color.array, vo * 3);
    const gi = g.index;
    if (gi) { for (let i = 0; i < gi.count; i++) idx[io + i] = gi.array[i] + vo; io += gi.count; }
    else { for (let i = 0; i < g.attributes.position.count; i++) idx[io + i] = i + vo; io += g.attributes.position.count; }
    vo += g.attributes.position.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.setIndex(new THREE.BufferAttribute(idx, 1));
  return out;
}

/** body silhouette per role — merged, vertex-colored, 1 draw call per role */
function roleGeometry(role) {
  const P = [];
  // legs + torso + head shared base
  P.push(box(0.14, 0.5, 0.14, PAL.leather, -0.09, 0.25, 0));
  P.push(box(0.14, 0.5, 0.14, PAL.leather, 0.09, 0.25, 0));
  const tunic = role === 'commander' ? PAL.officer : PAL.tunic;
  P.push(box(0.34, 0.52, 0.22, tunic, 0, 0.76, 0));
  P.push(cyl(0.11, 0.12, 0.22, PAL.skin, 0, 1.12, 0));
  switch (role) {
    case 'archer':
      P.push(cone(0.16, 0.26, PAL.tunic, 0, 1.28, 0));            // hood
      P.push(box(0.26, 0.34, 0.08, PAL.leather, 0, 0.82, -0.16)); // quiver back
      break;
    case 'spear':
      P.push(cyl(0.13, 0.14, 0.24, PAL.iron, 0, 1.26, 0));        // bucket helm
      P.push(box(0.3, 0.42, 0.07, PAL.tunic, -0.24, 0.8, 0.06));  // shield
      P.push(cyl(0.05, 0.05, 0.1, PAL.iron, -0.24, 0.8, 0.1));    // shield boss
      break;
    case 'engineer':
      P.push(cone(0.17, 0.16, PAL.leather, 0, 1.26, 0));          // kettle hat
      P.push(box(0.28, 0.4, 0.05, PAL.leather, 0, 0.72, 0.13));   // apron
      break;
    case 'crew':
      P.push(box(0.3, 0.1, 0.2, PAL.cloth, 0, 1.24, 0));          // head wrap
      P.push(box(0.36, 0.12, 0.24, PAL.leather, 0, 0.98, 0));     // harness
      break;
    case 'commander':
      P.push(cone(0.14, 0.3, PAL.iron, 0, 1.32, 0));              // helm
      P.push(box(0.06, 0.22, 0.16, PAL.crest, 0, 1.44, 0));       // crest
      P.push(box(0.4, 0.62, 0.06, PAL.officer, 0, 0.72, -0.15));  // cloak
      break;
  }
  return mergeGeos(P);
}
/** handheld prop per role (separate instanced layer → animatable) */
function propGeometry(role) {
  const P = [];
  switch (role) {
    case 'archer':
      P.push(box(0.05, 1.1, 0.06, PAL.wood, 0, 0, 0));                    // bow stave
      P.push(box(0.03, 0.9, 0.03, PAL.cloth, 0.06, 0, 0));                // string-ish
      P.push(cyl(0.02, 0.02, 0.7, PAL.wood, 0.1, 0, 0.1, Math.PI / 2));   // nocked arrow
      break;
    case 'spear':
      P.push(cyl(0.03, 0.035, 2.4, PAL.wood, 0, 0, 0));
      P.push(cone(0.07, 0.28, PAL.iron, 0, 1.3, 0));
      break;
    case 'engineer':
      P.push(cyl(0.03, 0.03, 0.5, PAL.wood, 0, 0, 0));
      P.push(box(0.16, 0.12, 0.1, PAL.iron, 0, 0.28, 0));
      break;
    case 'crew':
      P.push(cyl(0.03, 0.03, 1.6, PAL.wood, 0, 0, 0, Math.PI / 2));       // rammer pole
      P.push(cyl(0.09, 0.09, 0.2, PAL.leather, 0.8, 0, 0, Math.PI / 2));
      break;
    case 'commander':
      P.push(box(0.05, 0.9, 0.05, PAL.wood, 0, 0, 0));                    // standard pole
      P.push(box(0.5, 0.34, 0.03, PAL.tunic, 0.27, 0.3, 0));              // heraldic cloth
      P.push(box(0.2, 0.1, 0.04, PAL.cloth, 0.27, 0.3, 0.02));            // chevron hint
      break;
    default:
      P.push(box(0.02, 0.02, 0.02, PAL.cloth, 0, 0, 0));
  }
  return mergeGeos(P);
}
/** surrender flag prop (white quad on a stick) */
function flagGeometry() {
  return mergeGeos([
    cyl(0.02, 0.02, 1.1, PAL.wood, 0, 0, 0),
    box(0.42, 0.3, 0.02, 0xf2ead8, 0.22, 0.38, 0),
  ]);
}

// ------------------------------------------------------------------- unit ----
class Unit {
  constructor(role, pos, rng) {
    this.role = role;
    this.pos = pos.clone();
    this.home = pos.clone();
    this.yaw = Math.PI;                 // face the player (-Z) by default
    this.state = 'hold';
    this.t = rng() * 10;
    this.phase = rng() * 6.28;
    this.hp = this.maxHp = E.roles[role].hp;
    this.alive = true;
    this.deathT = 0;
    this.hurtT = 0;
    this.burnT = 0;
    this.distractT = 0;
    this.volleyCd = rng.range(E.archer.cooldown[0], E.archer.cooldown[1]);
    this.volleyPhase = 0;               // 0 cooldown → 1 ready → 2 draw
    this.volleyT = 0;
    this.wp = null; this.nextWp = 0; this.cover = null; this.workTarget = null;
    this.surrendered = false;
    this.facing = this.yaw;
  }
}

export class Enemy {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.rng = makeRng(777);
    this.units = [];
    this.roleMeshes = {};
    this.propMeshes = {};
    this.flagMesh = null;
    this.inst = null;                   // legacy alias kept for probes
    this.engines = [];
    this.nextFire = 0;
    this.burst = 0;
    this.incoming = [];
    this.enabled = true;
    this.alertLevel = 0;
    this.waveTimer = 0;
    this.morale = 1;
    this.killed = 0;
    this.routed = false;
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
    this.burst = 0;
    this.morale = 1;
    this.killed = 0;
    this.routed = false;
  }

  clear() {
    for (const k in this.roleMeshes) { this.scene.remove(this.roleMeshes[k]); this.roleMeshes[k].geometry.dispose(); delete this.roleMeshes[k]; }
    for (const k in this.propMeshes) { this.scene.remove(this.propMeshes[k]); this.propMeshes[k].geometry.dispose(); delete this.propMeshes[k]; }
    if (this.flagMesh) { this.scene.remove(this.flagMesh); this.flagMesh.geometry.dispose(); this.flagMesh = null; }
    for (const id in (this.engineKits || {})) {
      const kit = this.engineKits[id];
      this.scene.remove(kit.group);
      kit.group.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    }
    this.engineKits = {};
    for (const a of (this.arrows || [])) this.scene.remove(a.mesh);
    this.arrows = [];
    if (this.arrowGeo) { this.arrowGeo.dispose(); this.arrowGeo = null; }
    for (const w of this.incoming) { this.scene.remove(w.mesh); this.scene.remove(w.warn); w.warn.geometry.dispose(); w.warn.material.dispose(); }
    this.incoming.length = 0;
    this.units.length = 0;
    this.engines.length = 0;
  }

  /** spawn the garrison onto fort slots (plan §3.3) */
  setup(targets, spec, slots = [], playerPos, biome = 'meadow') {
    this.reset();
    this.playerPos = playerPos.clone();
    this.biome = biome;
    spec = spec || { archer: 0, spear: 0, engineer: 0, crew: 0, commander: 0 };
    // slots carry a PREFERRED role + zone; placement matches by zone first
    const byZone = (zones, role) => slots
      .filter((s) => zones.includes(s.zone) && !s.taken)
      .sort((a, b) => (b.role === role ? 1 : 0) - (a.role === role ? 1 : 0));
    const place = (role, zoneRoles) => {
      const pool = byZone(zoneRoles, role);
      let n = spec[role] || 0;
      while (n-- > 0) {
        const s = pool.find((x) => !x.taken);
        let pos;
        if (s) { s.taken = true; pos = s.pos.clone().add(new THREE.Vector3(this.rng.range(-0.25, 0.25), 0, this.rng.range(-0.25, 0.25))); }
        else pos = this._yardPos();
        const u = new Unit(role, pos, this.rng);
        u.yaw = Math.atan2(this.playerPos.x - pos.x, this.playerPos.z - pos.z);
        if (s && (s.zone === 'wall' || s.zone === 'tower')) u.state = role === 'archer' ? 'aim' : 'hold';
        if (role === 'engineer' || role === 'spear') u.state = 'patrol';
        if (role === 'crew') u.state = 'hold';
        this.units.push(u);
      }
    };
    place('commander', ['commander', 'keep']);
    place('archer', ['wall', 'tower']);
    place('spear', ['gate', 'yard']);
    place('engineer', ['yard', 'enginepad']);
    place('crew', ['enginepad']);
    // overflow of any role lands in the yard as patrol
    this._buildMeshes();
    this.engines = targets.filter((t) => t.type === 'engine' && !t.destroyed);
    this._buildEngineKits(this.game.mission ? this.game.mission.chapter : 1);
  }

  _yardPos() {
    const a = this.rng() * Math.PI * 2;
    const r = this.rng.range(4, 11);
    const c = this._fortCenter || (this._fortCenter = new THREE.Vector3(0, 0, this.game.mission ? this.game.mission.dist : 70));
    const x = c.x + Math.cos(a) * r, z = c.z + Math.sin(a) * r * 0.7;
    const y = this.game.terrain ? this.game.terrain.heightAt(x, z) : 0;
    return new THREE.Vector3(x, y, z);
  }

  _buildMeshes() {
    const counts = {};
    for (const u of this.units) counts[u.role] = (counts[u.role] || 0) + 1;
    const mat = () => new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
    for (const role in counts) {
      const n = counts[role];
      const im = new THREE.InstancedMesh(roleGeometry(role), mat(), n);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.castShadow = true;
      im.frustumCulled = false;
      const pm = new THREE.InstancedMesh(propGeometry(role), mat(), n);
      pm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      pm.frustumCulled = false;
      // per-instance tint: faction variance + biome cloaks (snow/desert)
      for (let i = 0; i < n; i++) {
        const v = 0.9 + this.rng() * 0.2;
        this._col.setRGB(v, v, v);
        if (this.biome === 'winter') this._col.multiplyScalar(1.12);
        if (this.biome === 'desert') this._col.setRGB(v * 1.05, v * 0.98, v * 0.85);
        im.setColorAt(i, this._col);
        pm.setColorAt(i, this._col);
      }
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      if (pm.instanceColor) pm.instanceColor.needsUpdate = true;
      this.scene.add(im, pm);
      this.roleMeshes[role] = im;
      this.propMeshes[role] = pm;
    }
    if (this.units.length) {
      this.flagMesh = new THREE.InstancedMesh(flagGeometry(), mat(), this.units.length);
      this.flagMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      this.flagMesh.frustumCulled = false;
      this.flagMesh.count = this.units.length;
      this.scene.add(this.flagMesh);
    }
    this._roleIndex = {};
    for (const role in counts) this._roleIndex[role] = 0;
    for (const u of this.units) { u.slotIndex = this._roleIndex[u.role]++; }
  }

  setAlert(v) { this.alertLevel = clamp(v, 0, 1); }
  get aliveSoldiers() { return this.units.filter((u) => u.alive && !u.surrendered).length; }
  get totalSoldiers() { return this.units.length; }

  // ------------------------------------------------------------- damage API --
  /** blast / area damage (grapeshot, explosive, chain) */
  hurtArea(pos, radius, dmg) {
    let killed = 0;
    for (const u of this.units) {
      if (!u.alive || u.surrendered) continue;
      const d = u.pos.distanceTo(pos);
      if (d > radius) continue;
      if (this.hurt(u, dmg * clamp(1 - d / radius, 0.2, 1), null)) killed++;
    }
    return killed;
  }
  /** crushing by a falling block (structures hook) */
  crushCheck(block) {
    const R = CFG.enemy.crushRadius;
    for (const u of this.units) {
      if (!u.alive || u.surrendered) continue;
      if (Math.abs(u.pos.x - block.p.x) < R && Math.abs(u.pos.z - block.p.z) < R && u.pos.y < block.p.y + 0.6) {
        this.hurt(u, 999, null, 'crush');
      }
    }
  }
  /** projectile proxy sweep: true 3D distance from the torso centre to the
   *  flight segment of this frame (no axis weighting — steep lobs included) */
  sweepSegment(a, b, radius, maxHits) {
    const hits = [];
    const ab = SW1.copy(b).sub(a);
    const len2 = ab.lengthSq() || 1e-6;
    for (const u of this.units) {
      if (!u.alive || u.surrendered) continue;
      const torso = SW2.copy(u.pos); torso.y += 0.8;
      const t = clamp(SW3.copy(torso).sub(a).dot(ab) / len2, 0, 1);
      const d = SW4.copy(a).addScaledVector(ab, t).distanceTo(torso);
      if (d < radius + CFG.enemy.unitRadius) hits.push(u);
      if (hits.length >= maxHits) break;
    }
    return hits;
  }
  /** returns true if the unit died from this hit */
  hurt(u, dmg, dir = null, tag = '') {
    if (!u.alive || u.surrendered) return false;
    u.hp -= dmg;
    u.hurtT = 0.18;
    if (u.hp <= 0) { this._die(u, dir, tag); return true; }
    if (tag === 'fire') { u.burnT = 3; u.state = 'flee'; }
    else if (u.state === 'hold' || u.state === 'aim') { u.state = 'cover'; u.cover = null; }
    return false;
  }
  distractUnits(sec = 4) { for (const u of this.units) if (u.alive && !u.surrendered) u.distractT = Math.max(u.distractT, sec); }
  killCommanderUnit() {
    const c = this.units.find((u) => u.role === 'commander' && u.alive);
    if (c) this._die(c, null, 'target');
  }

  _die(u, dir, tag = '') {
    u.alive = false;
    u.deathT = 0;
    u.fallDir = dir ? Math.atan2(dir.x, dir.z) : u.yaw + (this.rng() - 0.5);
    this.killed++;
    this._updateMorale();
    if (this.onEvent) this.onEvent('unitKilled', { role: u.role, pos: u.pos.clone(), tag, bounty: E.roles[u.role].bounty });
    if (u.role === 'commander' && this.onEvent) this.onEvent('commanderDown', { pos: u.pos.clone() });
  }

  _updateMorale() {
    const total = Math.max(1, this.totalSoldiers);
    const st = this.game.structures;
    const cmdDead = !this.units.some((u) => u.role === 'commander' && u.alive);
    const bannerDead = st ? st.targets.some((t) => t.type === 'banner' && t.destroyed) : false;
    let m = 1 - (this.killed / total) * E.morale.killWeight - (cmdDead ? E.morale.commanderLoss : 0) - (bannerDead ? E.morale.bannerLoss : 0);
    if (!cmdDead) m = Math.max(m, E.morale.commanderAuraFloor);   // commander holds the line
    this.morale = clamp(m, 0, 1);
    if (!this.routed && this.morale < E.morale.routAt && this.aliveSoldiers > 2) {
      this.routed = true;
      let fled = 0, surrendered = 0;
      const share = Math.ceil(this.aliveSoldiers * E.morale.routShare);
      for (const u of this.units) {
        if (!u.alive || u.surrendered || u.role === 'commander') continue;   // commander never routs
        if (fled + surrendered >= share) break;
        if (u.role === 'archer' || u.role === 'crew') { u.state = 'flee'; fled++; }
        else { u.state = 'surrender'; u.surrendered = true; surrendered++; }   // mix by role (Q3)
      }
      if (this.onEvent) this.onEvent('rout', { fled, surrendered });
    }
  }

  // ---------------------------------------------------------------- update ---
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
      if (this.burst > 0) {
        this.burst--;
        this.nextFire = this.rng.range(1.6, 2.8);
      } else {
        this.nextFire = lerp(E.returnFireDelay[1], E.returnFireDelay[0], clamp(alive / 3, 0, 1)) * (1 + this.rng.range(-0.25, 0.35)) / clamp(0.4 + acc, 0.4, 1.6);
      }
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

    // idle engines: thin smoke so the threat reads at a glance
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

    this._updateArrows(dt);
    // engine kits: firing swing + death tilt + black smoke
    for (const id in this.engineKits) {
      const kit = this.engineKits[id];
      const e = structures.targets.find((t2) => t2.id === id);
      if (kit.dead || (e && e.destroyed)) {
        kit.dead = true;
        kit.group.rotation.z = damp(kit.group.rotation.z, 0.5, 2, dt);
        kit.arm.rotation.x = damp(kit.arm.rotation.x, -2.2, 2, dt);
        kit._smokeT = (kit._smokeT || 0) - dt;
        if (kit._smokeT <= 0) {
          kit._smokeT = 0.5;
          this.game.vfx.smoke.spawn(kit.group.position.clone().add(new THREE.Vector3(0, 2, 0)), {
            life: 2.2, size: 0.9, grow: 2.2, opacity: 0.4, color: 0x2a2422, vel: new THREE.Vector3(0, 1.4, 0), drag: 0.5,
          });
        }
        continue;
      }
      if (e && e._flash > 0) kit.swing = Math.max(kit.swing, 1);
      if (kit.swing > 0) {
        kit.swing = Math.max(0, kit.swing - dt * 2.2);
        kit.arm.rotation.x = 0.5 - Math.sin((1 - kit.swing) * Math.PI) * 2.0;   // swing forward (−Z)
      } else {
        kit.arm.rotation.x = damp(kit.arm.rotation.x, 0.5, 3, dt);
      }
    }

    // ------------------------------------------------------------- soldiers ---
    if (this.units.length) {
      const cmdAlive = this.units.some((u) => u.role === 'commander' && u.alive);
      for (const u of this.units) this._unitAI(u, dt, structures, cmdAlive);
      this._writeMatrices(dt);
    }

    // --------------------------------------------------- defend-mode waves ---
    if (missionKind === 'DEFEND') {
      this.waveTimer += dt;
      if (this.waveTimer > E.defendWaveInterval) {
        this.waveTimer = 0;
        const chapter = (ctx && ctx.missionChapter) || 1;
        this.burst = 2 + Math.min(3, Math.floor(chapter / 2));
        this.nextFire = Math.min(this.nextFire, 1.2);
        if (this.onEvent) this.onEvent('wave', { burst: this.burst });
      }
    }
  }

  _unitAI(u, dt, structures, cmdAlive) {
    u.t += dt;
    if (u.hurtT > 0) u.hurtT -= dt;
    if (u.distractT > 0) u.distractT -= dt;
    if (!u.alive) { u.deathT += dt; return; }
    if (u.burnT > 0) {
      u.burnT -= dt;
      if (this.hurt(u, 14 * dt, null, 'burntick')) return;
    }
    switch (u.state) {
      case 'surrender':
        return;                                    // sits; flag prop raised
      case 'hold':
        u.yaw = damp(u.yaw, Math.atan2(this.playerPos.x - u.pos.x, this.playerPos.z - u.pos.z), 2, dt);
        if (this.alertLevel > 0.6 && this.rng.chance(dt * 0.25)) u.state = 'cover';
        break;
      case 'aim': {                                // archer volley cycle
        if (u.distractT > 0) { u.volleyPhase = 0; break; }
        u.volleyT += dt;
        if (u.volleyPhase === 0 && u.volleyT >= u.volleyCd) { u.volleyPhase = 1; u.volleyT = 0; }
        else if (u.volleyPhase === 1 && u.volleyT >= E.archer.readySec) { u.volleyPhase = 2; u.volleyT = 0; }
        else if (u.volleyPhase === 2 && u.volleyT >= E.archer.drawSec) {
          u.volleyPhase = 0; u.volleyT = 0;
          u.volleyCd = this.rng.range(E.archer.cooldown[0], E.archer.cooldown[1]) * (cmdAlive ? 1 : 1.35);
          this.spawnArrow(u.pos, u.yaw);
          if (this.onEvent) this.onEvent('volley', { pos: u.pos.clone(), yaw: u.yaw });
        }
        u.yaw = damp(u.yaw, Math.atan2(this.playerPos.x - u.pos.x, this.playerPos.z - u.pos.z), 3, dt);
        break;
      }
      case 'patrol': {
        if (!u.wp || u.pos.distanceTo(u.wp) < 0.7 || u.t > u.nextWp) {
          const a = this.rng() * 6.28, r = this.rng.range(1.5, 6);
          u.wp = new THREE.Vector3(u.home.x + Math.cos(a) * r, 0, u.home.z + Math.sin(a) * r);
          u.wp.y = (this.game.terrain ? this.game.terrain.heightAt(u.wp.x, u.wp.z) : 0);
          u.nextWp = u.t + this.rng.range(3, 7);
        }
        this._moveToward(u, u.wp, E.roles[u.role].speed, dt);
        // engineers look for damaged blocks to repair
        if (u.role === 'engineer' && structures && this.rng.chance(dt * 0.05)) {
          const b = this._findRepairTarget(u, structures);
          if (b) { u.workTarget = b; u.state = 'repair'; }
        }
        break;
      }
      case 'cover': {
        if (!u.cover) {
          const a = this.rng() * 6.28;
          u.cover = new THREE.Vector3(u.home.x + Math.cos(a) * 3.5, 0, u.home.z - Math.abs(Math.sin(a)) * 3.5 - 2);
          u.cover.y = (this.game.terrain ? this.game.terrain.heightAt(u.cover.x, u.cover.z) : 0);
        }
        this._moveToward(u, u.cover, 2.6, dt);
        if (this.alertLevel < 0.3) { u.state = u.role === 'archer' ? 'aim' : 'patrol'; u.cover = null; }
        break;
      }
      case 'flee': {
        if (!u.cover) {
          u.cover = new THREE.Vector3(u.home.x + (this.rng() - 0.5) * 6, 0, u.home.z + this.rng.range(6, 14));
          u.cover.y = (this.game.terrain ? this.game.terrain.heightAt(u.cover.x, u.cover.z) : 0);
        }
        this._moveToward(u, u.cover, 3.6, dt);
        if (this.alertLevel < 0.4 && u.burnT <= 0) { u.state = u.role === 'archer' ? 'aim' : 'patrol'; u.cover = null; }
        break;
      }
      case 'repair': {
        const b = u.workTarget;
        if (!b || !b.alive) { u.state = 'patrol'; u.workTarget = null; break; }
        const wp = new THREE.Vector3(b.p.x, b.p.y - b.hs.y - 0.6, b.p.z + 0.9);
        this._moveToward(u, wp, 2.0, dt);
        if (u.pos.distanceTo(wp) < 1.4) {
          const mul = cmdAlive ? E.morale.engineerAuraMul : 1;
          b.hp = Math.min(b.maxHp, b.hp + E.repairRateHpPerSec * mul * dt);
          structures._tintDamage(b);
        }
        if (this.alertLevel > 0.6) { u.state = 'cover'; u.workTarget = null; }
        break;
      }
    }
  }

  _moveToward(u, wp, speed, dt) {
    const dx = wp.x - u.pos.x, dz = wp.z - u.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    u.pos.x += (dx / d) * speed * dt;
    u.pos.z += (dz / d) * speed * dt;
    const gy = (this.game.terrain ? this.game.terrain.heightAt(u.pos.x, u.pos.z) : 0);
    u.pos.y = damp(u.pos.y, gy, 8, dt);
    u.facing = Math.atan2(dx, dz);
  }

  _findRepairTarget(u, structures) {
    let best = null, bestScore = 1e9;
    for (const b of structures.blocks) {
      if (!b.alive || b.hp >= b.maxHp * 0.92) continue;
      const d = b.p.distanceTo(u.pos);
      if (d > 26) continue;
      const score = d + (b.hp / b.maxHp) * 12;
      if (score < bestScore) { bestScore = score; best = b; }
    }
    return best;
  }

  /** compose instance matrices: idle bob, walk, volley draw, death fall, sit */
  _writeMatrices(dt) {
    for (const role in this.roleMeshes) {
      const im = this.roleMeshes[role];
      const pm = this.propMeshes[role];
      let i = 0;
      for (const u of this.units) {
        if (u.role !== role) continue;
        const d = this._dummy;
        if (!u.alive) {
          const k = clamp(u.deathT / 0.35, 0, 1);
          const sink = u.deathT > 1 ? clamp((u.deathT - 1) / E.corpseSinkSec, 0, 1) : 0;
          d.position.set(u.pos.x, u.pos.y + 0.0 - sink * 1.6, u.pos.z);
          d.rotation.set(0, u.fallDir || u.yaw, 0);
          d.rotateX(k * Math.PI / 2);                    // fall over sideways
          d.scale.setScalar(sink > 0.85 ? 0.001 : 1);
          d.updateMatrix();
          im.setMatrixAt(i, d.matrix);
          d.scale.setScalar(0.001); d.updateMatrix();
          pm.setMatrixAt(i, d.matrix);
          if (this.flagMesh) { this.flagMesh.setMatrixAt(i, d.matrix); }
          i++;
          continue;
        }
        const bob = Math.abs(Math.sin(u.t * 6 + u.phase)) * (u.state === 'patrol' || u.state === 'flee' ? 0.07 : 0.012);
        d.position.set(u.pos.x, u.pos.y + bob - (u.surrendered ? 0.35 : 0), u.pos.z);
        d.rotation.set(0, u.state === 'hold' || u.state === 'aim' ? u.yaw : u.facing, u.state === 'flee' ? Math.sin(u.t * 9) * 0.12 : 0);
        d.scale.set(u.surrendered ? 0.9 : 1, u.surrendered ? 0.8 : 1, u.surrendered ? 0.9 : 1);
        d.updateMatrix();
        im.setMatrixAt(i, d.matrix);
        // prop in hand: bow draws during volley phase 2, spear idles, flag down
        const p = this._dummy;
        p.position.set(u.pos.x, u.pos.y + 0.85 + bob, u.pos.z);
        p.rotation.set(0, (u.state === 'hold' || u.state === 'aim' ? u.yaw : u.facing), 0);
        if (role === 'archer') {
          const draw = u.volleyPhase === 2 ? clamp(u.volleyT / E.archer.drawSec, 0, 1) : 0;
          p.rotateX(-0.15 - draw * 0.25);
          p.position.y += draw * 0.05;
        } else if (role === 'spear') p.rotateZ(0.06 * Math.sin(u.t * 2 + u.phase));
        else if (role === 'engineer' && u.state === 'repair') p.rotateX(Math.sin(u.t * 12) * 0.5);
        if (u.surrendered) { p.rotation.set(Math.PI / 2, u.facing, 0); p.position.y = u.pos.y + 0.1; }
        p.scale.setScalar(u.surrendered && role !== 'commander' ? 1 : 1);
        p.updateMatrix();
        pm.setMatrixAt(i, p.matrix);
        // surrender flag (commander never surrenders)
        if (this.flagMesh) {
          if (u.surrendered) {
            p.position.set(u.pos.x + 0.3, u.pos.y + 0.55, u.pos.z);
            p.rotation.set(0, u.facing, 0);
            p.scale.setScalar(1);
            p.updateMatrix();
            this.flagMesh.setMatrixAt(i, p.matrix);
          } else {
            p.scale.setScalar(0.001); p.updateMatrix();
            this.flagMesh.setMatrixAt(i, p.matrix);
            p.scale.setScalar(1);
          }
        }
        // hurt/burn tint
        if (u.hurtT > 0 || u.burnT > 0) {
          this._col.setHex(u.burnT > 0 ? 0xff7a3a : 0xd05040);
        } else this._col.setScalar(0.9 + ((u.slotIndex * 37) % 10) / 50);
        im.setColorAt(i, this._col);
        i++;
      }
      im.count = i; pm.count = i;
      im.instanceMatrix.needsUpdate = true;
      pm.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
    if (this.flagMesh) this.flagMesh.instanceMatrix.needsUpdate = true;
  }

  // -------------------------------------------------------------- arrows ----
  _ensureArrows() {
    if (this.arrowPool) return;
    this.arrowPool = [];
    const geo = mergeGeos([
      cyl(0.02, 0.02, 0.72, PAL.wood, 0, 0, 0, Math.PI / 2),
      cone(0.045, 0.14, PAL.iron, 0.42, 0, 0),
      box(0.1, 0.02, 0.12, PAL.cloth, -0.32, 0, 0),
    ]);
    geo.rotateZ(Math.PI / 2);   // cone default +Y → +Z forward after lookAt
    this.arrowGeo = geo;
    this.arrowMat = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true });
  }
  spawnArrow(from, yaw) {
    this._ensureArrows();
    if (this.arrows && this.arrows.length >= 8) return;
    const m = new THREE.Mesh(this.arrowGeo, this.arrowMat);
    m.position.copy(from).add(new THREE.Vector3(0, 1.3, 0));
    this.scene.add(m);
    const to = this.playerPos.clone(); to.x += this.rng.range(-2.5, 2.5); to.z += this.rng.range(-2, 2);
    this.arrows = this.arrows || [];
    this.arrows.push({ mesh: m, t: 0, dur: 1.6, from: m.position.clone(), to });
    m.lookAt(to);
    this.game.audio.volleyTwang();
  }
  _updateArrows(dt) {
    if (!this.arrows) return;
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.t += dt;
      const k = clamp(a.t / a.dur, 0, 1);
      a.mesh.position.lerpVectors(a.from, a.to, k);
      a.mesh.position.y += Math.sin(k * Math.PI) * 2.2;
      if (k >= 1) {
        this.scene.remove(a.mesh);
        this.arrows.splice(i, 1);
        if (this.onEvent) this.onEvent('volleyImpact', { pos: a.to.clone() });
      }
    }
  }

  // ------------------------------------------- engine decor kits (style) ----
  _buildEngineKits(chapter) {
    this.engineKits = {};
    const dark = PAL.wood;
    for (const e of this.engines) {
      const g = new THREE.Group();
      const base = mergeGeos([
        box(0.5, 1.1, 2.4, dark, -1.3, 0.55, 0), box(0.5, 1.1, 2.4, dark, 1.3, 0.55, 0),
        box(2.6, 0.4, 3.1, dark, 0, 0.25, 0),
        cyl(0.42, 0.42, 0.3, PAL.iron, -1.5, 0.42, 1.1, 0, Math.PI / 2), cyl(0.42, 0.42, 0.3, PAL.iron, 1.5, 0.42, 1.1, 0, Math.PI / 2),
        cyl(0.42, 0.42, 0.3, PAL.iron, -1.5, 0.42, -1.1, 0, Math.PI / 2), cyl(0.42, 0.42, 0.3, PAL.iron, 1.5, 0.42, -1.1, 0, Math.PI / 2),
        box(1.1, 0.9, 0.9, PAL.tunic, 0, 0.8, 1.9),           // counterweight box w/ faction cloth (rear)
        box(1.12, 0.3, 0.92, PAL.cloth, 0, 1.0, 1.9),         // chevron band
      ]);
      const baseMesh = new THREE.Mesh(base, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      baseMesh.castShadow = true;
      const armGeo = mergeGeos([
        box(0.22, 3.4, 0.22, dark, 0, 1.5, 0),
        cyl(0.5, 0.35, 0.5, PAL.iron, 0, 3.1, 0),            // cup
        box(0.3, 0.3, 0.3, PAL.iron, 0, -0.2, 0),
      ]);
      const arm = new THREE.Mesh(armGeo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
      arm.position.set(0, 1.2, -0.3);
      arm.rotation.x = 0.5;                                  // cocked back toward the rear
      arm.castShadow = true;
      g.add(baseMesh, arm);
      g.position.copy(e.center); g.position.y = (this.game.terrain ? this.game.terrain.heightAt(e.center.x, e.center.z) : 0);
      // face the firing direction: kit forward is −Z, yaw maps −Z onto (player − engine)
      const dx = this.playerPos.x - g.position.x, dz = this.playerPos.z - g.position.z;
      g.rotation.y = Math.atan2(-dx, -dz) + (this.rng() - 0.5) * 0.06;
      this.scene.add(g);
      this.engineKits[e.id] = { group: g, arm, swing: 0, dead: false };
    }
    this.engineChapter = chapter || 1;
  }
  onEngineDown(target) {
    const kit = this.engineKits && this.engineKits[target.id];
    if (kit) { kit.dead = true; kit.swing = 0; }
    // the crew abandons the piece
    for (const u of this.units) {
      if (u.alive && !u.surrendered && u.pos.distanceTo(target.center) < 6) u.state = 'flee', u.cover = null;
    }
    if (this.onEvent) this.onEvent('engineDown', { pos: target.center.clone() });
  }
  onBannerDown() { this._updateMorale(); }

  // --------------------------------------------------------- counter shots ---
  _fireAtPlayer(acc, enginesAlive) {
    const target = this.playerPos.clone();
    const spread = (1 - acc) * 9 + 1.2;
    target.x += this.rng.gauss() * spread;
    target.z += this.rng.gauss() * spread;
    target.y = this.game.terrain ? this.game.terrain.heightAt(target.x, target.z) : 0;

    const engine = this.rng.pick(this.engines);
    const from = engine.enginePos ? engine.enginePos.clone() : engine.center.clone();
    from.y += 2.4;

    const shell = new THREE.Mesh(new THREE.DodecahedronGeometry(0.36, 0), new THREE.MeshLambertMaterial({ color: 0x55504a, flatShading: true }));
    shell.position.copy(from);
    this.scene.add(shell);

    const vfx = this.game.vfx;
    vfx.flashes.spawn(from, { life: 0.18, size: 2.6, grow: 1.2, opacity: 0.9, color: 0xffd9a0 });
    vfx.dustPuff(from, 7, 1.1, 0x8a8070);
    vfx.smokeColumn(from, 4, 0.7, 0x5a554c);
    engine._flash = 0.4;

    const dist = from.distanceTo(target);
    const flight = clamp(2.2 + dist * 0.016, 2.2, 4.2);
    const apex = 9 + dist * 0.14;

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
      const nodes = CFG.trebuchet.nodes;
      let r = this.rng() * nodes.length, node = nodes[0];
      for (let i = 0; i < nodes.length; i++) { r -= 1; if (r <= 0) { node = nodes[i]; break; } }
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
}
