// ============================================================================
//  systems/physics.js — custom deterministic physics core (Master Prompt §4.4)
//  semi-implicit Euler + fixed step, heightmap terrain, sphere-OBB, debris
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, makeNoise2D, _v1, _v2 } from '../core/utils.js';

const P = CFG.physics;
export const _tmpV = new THREE.Vector3();
export const _tmpV2 = new THREE.Vector3();
export const _tmpM = new THREE.Matrix4();
export const _tmpQ = new THREE.Quaternion();
export const _tmpS = new THREE.Vector3();
const _euler = new THREE.Euler();

export class Physics {
  constructor() {
    this.terrain = null;
    this.structures = null;
    this.accumulator = 0;
    this.time = 0;
    this.wind = new THREE.Vector3();
    this.windNoise = makeNoise2D(777);
    this.windBase = new THREE.Vector3();
    this.windGust = 0;
    this.gravity = new THREE.Vector3(0, -P.gravity, 0);
    this.substeps = 0;
    this.contactsThisFrame = 0;
    this.activeBodies = [];   // projectiles & other externally-managed dynamic bodies
  }

  attach(terrain, structures) { this.terrain = terrain; this.structures = structures; }

  // ------------------------------------------------------------------ wind ---
  setWind(dirDeg, speed) {
    const a = dirDeg * Math.PI / 180;
    this.windBase.set(Math.cos(a) * speed, 0, Math.sin(a) * speed);
  }
  updateWind(t) {
    const gust = this.windNoise(t * 0.055, 3.7, 3, 0.5);       // slow gusts
    const sway = Math.sin(t * 0.31) * 0.12;
    this.windGust = clamp(gust * 0.45 + sway, -0.55, 0.55);
    this.wind.copy(this.windBase).multiplyScalar(1 + this.windGust);
    this.wind.y = this.windBase.length() * 0.045 * this.windGust; // slight vertical component
    return this.wind;
  }
  windSpeed() { return this.wind.length(); }

  // ---------------------------------------------------------------- stepping ---
  step(dt, bodies) {
    this.accumulator += dt;
    let steps = 0;
    const h = P.fixedDt;
    while (this.accumulator >= h && steps < P.maxStepsPerFrame) {
      this.time += h;
      this.substep(h, bodies);
      this.accumulator -= h;
      steps++;
    }
    if (steps >= P.maxStepsPerFrame) this.accumulator = 0;  // avoid spiral of death
    this.substeps = steps;
    return steps;
  }

  substep(h, bodies) {
    this.contactsThisFrame = 0;
    for (let i = 0; i < bodies.length; i++) {
      const b = bodies[i];
      if (!b.alive) continue;
      this.integrateBody(b, h);
    }
  }

  /** semi-implicit Euler for one rigid-ish body (sphere collider) */
  integrateBody(b, h) {
    // forces
    b.vel.addScaledVector(this.gravity, h * (b.gravityScale === undefined ? 1 : b.gravityScale));
    if (b.drag > 0) {
      const sp = b.vel.length();
      if (sp > 0.001) {
        const fd = b.drag * sp * sp * h;
        b.vel.addScaledVector(b.vel, -clamp(fd / sp, 0, 0.95));
      }
    }
    if (b.windAffected) {
      // aerodynamic coupling: body is pushed toward wind speed
      _tmpV.copy(this.wind).sub(b.vel).multiplyScalar(b.windCoupling * h);
      b.vel.add(_tmpV);
    }
    b.pos.addScaledVector(b.vel, h);

    if (b.spin) {
      b.rot.x += b.spin.x * h; b.rot.y += b.spin.y * h; b.rot.z += b.spin.z * h;
      b.spin.multiplyScalar(Math.pow(b.angularDamp || P.debris.angularDamp, h * 60));
    }

    this.collide(b);

    if (b.life !== undefined) { b.life -= h; if (b.life <= 0) b.alive = false; }
    if (b.pos.y < -60 || Math.abs(b.pos.x) > P.worldSize || Math.abs(b.pos.z) > P.worldSize) b.alive = false;
  }

  collide(b) {
    const r = b.radius;
    // --- terrain ---
    if (this.terrain) {
      const th = this.terrain.heightAt(b.pos.x, b.pos.z);
      if (b.pos.y - r < th) {
        this.terrain.normalAt(b.pos.x, b.pos.z, _tmpV2);
        b.pos.y = th + r;
        const vn = b.vel.dot(_tmpV2);
        if (vn < 0) {
          const impact = -vn;
          b.vel.addScaledVector(_tmpV2, -(1 + b.restitution) * vn);
          b.vel.multiplyScalar(1 - b.friction);
          if (b.spin) b.spin.multiplyScalar(0.55);
          if (impact > P.minImpactSpeed && b.onHit) { b.onHit(b, 'terrain', impact, _tmpV2, b.pos); this.contactsThisFrame++; }
          if (impact < 0.7) b.vel.multiplyScalar(0.7);  // settle
        }
      }
      // water
      if (b.pos.y - r < P.waterLevel && b.pos.y > P.waterLevel - 4 && b.onWater && b.vel.length() > 3) {
        b.onWater(b, b.pos);
      }
    }
    // --- structures ---
    if (this.structures && b.collidesBlocks) {
      const hits = this.structures.querySphere(b.pos, r + 0.15);
      for (let i = 0; i < hits.length; i++) {
        const bl = hits[i];
        const res = sphereOBB(b.pos, r, bl, _tmpV);
        if (!res) continue;
        // push out
        b.pos.addScaledVector(res.normal, res.depth);
        const vn = b.vel.dot(res.normal);
        if (vn < 0) {
          const impact = -vn;
          const e = b.restitution * 0.6;
          b.vel.addScaledVector(res.normal, -(1 + e) * vn);
          b.vel.multiplyScalar(1 - b.friction * 1.4);
          if (b.spin) { b.spin.multiplyScalar(0.4); b.spin.x += (Math.random() - 0.5) * 2; }
          if (b.onHit) { b.onHit(b, bl, impact, res.normal, res.point); this.contactsThisFrame++; }
        }
      }
    }
  }

  // ---------------------------------------------------------- ray prediction ---
  /**
   * Integrate a massless-ish projectile forward, returning sample points until
   * first contact with terrain / block. Used for the predictive arc (§3.3).
   */
  predict(from, vel, opt = {}) {
    const {
      drag = 0.0009, windAffected = true, windCoupling = 0.030,
      points = CFG.ballistics.predictPoints, dt = CFG.ballistics.predictDt,
      maxTime = 9, stopOnBlock = true, mass = 40,
    } = opt;
    const out = [];
    const pos = _tmpVecA.copy(from);
    const v = _tmpVecB.copy(vel);
    const body = { pos, vel: v, radius: P.projectileRadius, drag, windAffected, windCoupling, restitution: 0.2, friction: 0.2, alive: true, collidesBlocks: true, spin: null };
    let hit = null;
    // the horizon must cover the WHOLE flight (lobs take 3-5 s), otherwise the
    // solver only ever sees flat solutions and "discovers" nothing behind the apex
    const steps = Math.min(points, Math.ceil(maxTime / dt));
    for (let i = 0; i < steps; i++) {
      // subdivide for accuracy
      const sub = 3;
      for (let s = 0; s < sub; s++) {
        body.pos = pos; body.vel = v;
        this.integratePredict(body, dt / sub, windAffected, windCoupling, drag);
        if (this.testContact(pos, P.projectileRadius, stopOnBlock)) { hit = this.testContact(pos, P.projectileRadius, stopOnBlock); break; }
      }
      out.push(new THREE.Vector3(pos.x, pos.y, pos.z));
      if (hit) { out.hit = hit; break; }
    }
    out.apex = 0;
    let maxY = -1e9;
    for (let i = 0; i < out.length; i++) if (out[i].y > maxY) { maxY = out[i].y; out.apex = i; }
    return out;
  }

  integratePredict(b, h, windAffected, windCoupling, drag) {
    b.vel.addScaledVector(this.gravity, h);
    const sp = b.vel.length();
    if (sp > 0.001 && drag > 0) {
      const fd = drag * sp * sp * h;
      b.vel.addScaledVector(b.vel, -clamp(fd / sp, 0, 0.9));
    }
    if (windAffected) { _tmpVecC.copy(this.wind).sub(b.vel).multiplyScalar(windCoupling * h); b.vel.add(_tmpVecC); }
    b.pos.addScaledVector(b.vel, h);
  }

  testContact(pos, r, blocks) {
    if (this.terrain) {
      const th = this.terrain.heightAt(pos.x, pos.z);
      if (pos.y - r <= th) return { type: 'terrain', point: new THREE.Vector3(pos.x, th, pos.z), normal: this.terrain.normalAt(pos.x, pos.z, new THREE.Vector3()) };
    }
    if (blocks && this.structures) {
      const hits = this.structures.querySphere(pos, r);
      for (const bl of hits) {
        const res = sphereOBB(pos, r, bl, new THREE.Vector3());
        if (res) return { type: 'block', block: bl, point: res.point.clone(), normal: res.normal.clone() };
      }
    }
    return null;
  }
}

const _tmpVecA = new THREE.Vector3();
const _tmpVecB = new THREE.Vector3();
const _tmpVecC = new THREE.Vector3();

/** sphere vs oriented box (box = {p, hs, q}) → {depth, normal, point} or null */
export function sphereOBB(center, radius, box, outNormal) {
  _tmpV.copy(center).sub(box.p);
  _tmpV.applyQuaternion(_tmpQ.copy(box.q).invert());
  const hx = box.hs.x, hy = box.hs.y, hz = box.hs.z;
  const cx = clamp(_tmpV.x, -hx, hx);
  const cy = clamp(_tmpV.y, -hy, hy);
  const cz = clamp(_tmpV.z, -hz, hz);
  const dx = _tmpV.x - cx, dy = _tmpV.y - cy, dz = _tmpV.z - cz;
  const d2 = dx * dx + dy * dy + dz * dz;
  if (d2 > radius * radius) return null;
  let nx, ny, nz, depth;
  if (d2 > 1e-9) {
    const d = Math.sqrt(d2);
    nx = dx / d; ny = dy / d; nz = dz / d; depth = radius - d;
  } else {
    // centre inside box: push out along the shallowest axis
    const px = hx - Math.abs(_tmpV.x), py = hy - Math.abs(_tmpV.y), pz = hz - Math.abs(_tmpV.z);
    if (px < py && px < pz) { nx = Math.sign(_tmpV.x) || 1; ny = 0; nz = 0; depth = px + radius; }
    else if (py < pz) { nx = 0; ny = Math.sign(_tmpV.y) || 1; nz = 0; depth = py + radius; }
    else { nx = 0; ny = 0; nz = Math.sign(_tmpV.z) || 1; depth = pz + radius; }
  }
  outNormal.set(nx, ny, nz).applyQuaternion(box.q).normalize();
  const point = new THREE.Vector3(cx, cy, cz).applyQuaternion(box.q).add(box.p);
  return { depth, normal: outNormal, point };
}

// ----------------------------------------------------------------- debris ---
const DEBRIS_CAP = CFG.physics.debris.max;

export class DebrisSystem {
  constructor(scene, materials) {
    this.scene = scene;
    this.M = materials;
    this.max = DEBRIS_CAP;
    this.items = [];
    this.geo = {
      box: new THREE.BoxGeometry(1, 1, 1),
      chunk: new THREE.DodecahedronGeometry(0.55, 0),
    };
    this.meshes = new Map();   // materialKey -> InstancedMesh
    this.freeSlots = new Map();
    for (const key of Object.keys(materials.block)) {
      const im = new THREE.InstancedMesh(key === 'wood' ? this.geo.box : this.geo.chunk, materials.debris, this.max);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.frustumCulled = false;
      im.count = 0;
      im.name = 'debris_' + key;
      this.meshes.set(key, im);
      this.freeSlots.set(key, []);
      scene.add(im);
    }
    this._dirty = new Set();
    this._zero = new THREE.Matrix4().makeScale(0, 0, 0);
  }

  spawn(pos, vel, matKey, size, spread = 1) {
    if (this.items.length >= this.max) this._recycleOldest();
    const im = this.meshes.get(matKey) || this.meshes.get('stone');
    const key = matKey in CFG.blocks.materials ? matKey : 'stone';
    let slot = this.freeSlots.get(key).pop();
    if (slot === undefined) {
      const cur = im.count;
      if (cur >= this.max) { slot = Math.floor(Math.random() * this.max); }
      else { slot = cur; im.count = cur + 1; }
    }
    const col = new THREE.Color(CFG.blocks.materials[key].color);
    col.multiplyScalar(0.78 + Math.random() * 0.35);
    im.setColorAt(slot, col);
    if (im.instanceColor) im.instanceColor.needsUpdate = true;

    const s = size * (0.55 + Math.random() * 0.7) * spread;
    const item = {
      pos: pos.clone(),
      vel: vel.clone(),
      rot: new THREE.Euler(Math.random() * 6.28, Math.random() * 6.28, Math.random() * 6.28),
      spin: new THREE.Vector3((Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 9),
      scale: new THREE.Vector3(s, s * (0.6 + Math.random() * 0.6), s),
      radius: s * 0.5,
      restitution: CFG.physics.debris.restitution,
      friction: 0.28,
      drag: CFG.physics.debris.drag,
      windAffected: false,
      collidesBlocks: false,
      gravityScale: 1,
      angularDamp: CFG.physics.debris.angularDamp,
      life: CFG.physics.debris.life * (0.75 + Math.random() * 0.5),
      alive: true,
      slot, key, im,
      onHit: null,
    };
    this.items.push(item);
    this._dirty.add(key);
    return item;
  }

  burst(pos, matKey, count, speed = 6, size = 0.35, dir = null) {
    for (let i = 0; i < count; i++) {
      const v = new THREE.Vector3(Math.random() - 0.5, Math.random() * 0.85 + 0.15, Math.random() - 0.5);
      if (dir) v.lerp(dir, 0.55).normalize();
      v.normalize().multiplyScalar(speed * (0.35 + Math.random() * 0.9));
      const p = pos.clone().add(new THREE.Vector3((Math.random() - 0.5) * size * 2, (Math.random() - 0.5) * size * 2, (Math.random() - 0.5) * size * 2));
      this.spawn(p, v, matKey, size);
    }
  }

  _recycleOldest() {
    let oldest = null;
    for (const it of this.items) if (!oldest || it.life < oldest.life) oldest = it;
    if (oldest) this.remove(oldest);
  }

  remove(item) {
    const i = this.items.indexOf(item);
    if (i >= 0) this.items.splice(i, 1);
    item.im.setMatrixAt(item.slot, this._zero);
    this.freeSlots.get(item.key).push(item.slot);
    this._dirty.add(item.key);
  }

  update(physics, dt) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      physics.integrateBody(it, dt);
      if (!it.alive) { this.remove(it); continue; }
      // fade-out shrink in the last second
      if (it.life < 1.0) {
        const k = clamp(it.life, 0, 1);
        it.scale.multiplyScalar(0.985 + k * 0.012);
      }
      _tmpM.compose(it.pos, _tmpQ.setFromEuler(it.rot), it.scale);
      it.im.setMatrixAt(it.slot, _tmpM);
      this._dirty.add(it.key);
    }
    for (const key of this._dirty) { const im = this.meshes.get(key); if (im) im.instanceMatrix.needsUpdate = true; }
    this._dirty.clear();
  }

  clear() { while (this.items.length) this.remove(this.items[0]); }
  get count() { return this.items.length; }
}
