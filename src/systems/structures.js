// ============================================================================
//  systems/structures.js — destructible block world: instanced rendering,
//  damage model, support-graph cascade collapse, targets, loot (§4.3)
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, makeRng, _v1, _v2, _c1 } from '../core/utils.js';
import { sphereOBB } from './physics.js';

const MAT = CFG.blocks.materials;
const _m4 = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _col = new THREE.Color();
const _zero = new THREE.Matrix4().makeScale(0, 0, 0);

export class Structures {
  constructor(scene, materials, terrain, debris, rng) {
    this.scene = scene;
    this.M = materials;
    this.terrain = terrain;
    this.debris = debris;
    this.rng = rng || makeRng(1);
    this.blocks = [];
    this.targets = [];
    this.meshes = new Map();
    this.free = new Map();
    this.capacity = 900;
    this.grid = new Map();
    this.cell = CFG.physics.broadphaseCell;
    this.dirty = new Set();
    this.totalHpAtStart = 0;
    this.lootPool = {};
    this.destroyedCount = 0;
    this.civilianDestroyed = 0;

    for (const key of Object.keys(MAT)) {
      const im = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), materials.block[key], this.capacity);
      im.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      im.count = 0;
      // NOTE: frustum culling on an InstancedMesh uses a bounding sphere that is
      // computed once (possibly while empty) — the fort would vanish when the
      // camera frustum leaves the origin. Culling per-instance is not worth it:
      // 8 draw calls total.
      im.frustumCulled = false;
      im.name = 'blocks_' + key;
      scene.add(im);
      this.meshes.set(key, im);
      this.free.set(key, []);
    }
  }

  // ------------------------------------------------------------------ build ---
  addBlock(x, y, z, sx, sy, sz, matKey, opts = {}) {
    const def = MAT[matKey] || MAT.stone;
    const b = {
      p: new THREE.Vector3(x, y, z),
      hs: new THREE.Vector3(sx / 2, sy / 2, sz / 2),
      q: new THREE.Quaternion().setFromEuler(_e.set(opts.rx || 0, opts.ry || 0, opts.rz || 0)),
      mat: matKey,
      hp: def.hp * (opts.hpMul || 1),
      maxHp: def.hp * (opts.hpMul || 1),
      density: def.density,
      alive: true,
      static: true,
      col: opts.col,
      cid: opts.cid !== undefined ? opts.cid : null,
      ctype: opts.ctype || null,
      slot: -1,
      im: null,
      key: matKey,
      supports: [],      // blocks below that hold this one
      supportedBy: null,
      burning: 0,
      cracked: false,
      mass: def.density * sx * sy * sz,
      lootMul: opts.lootMul === undefined ? 1 : opts.lootMul,
      noLoot: !!opts.noLoot,
      civilian: !!opts.civilian,
      hitFlash: 0,
    };
    b.mass = Math.max(20, b.mass * 0.02);
    const im = this.meshes.get(matKey);
    let slot = this.free.get(matKey).pop();
    if (slot === undefined) {
      if (im.count >= this.capacity) { console.warn('block capacity reached'); return null; }
      slot = im.count++;
    }
    b.slot = slot; b.im = im;
    this.blocks.push(b);
    this._writeMatrix(b);
    // NOTE: the texture already carries the material colour — instanceColor must
    // only add per-block variation / damage tint, otherwise the colour is squared.
    const c = _col.setHex(0xffffff);
    if (opts.tint) c.multiply(opts.tint);
    c.multiplyScalar(0.86 + this.rng() * 0.28);
    im.setColorAt(slot, c);
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
    this.dirty.add(matKey);
    this._gridAdd(b);
    return b;
  }

  _writeMatrix(b, scale = 1) {
    _s.copy(b.hs).multiplyScalar(2 * scale);
    _m4.compose(b.p, b.q, _s);
    b.im.setMatrixAt(b.slot, _m4);
    this.dirty.add(b.key);
  }

  hide(b) { b.im.setMatrixAt(b.slot, _zero); this.dirty.add(b.key); }

  // ------------------------------------------------------------------ grid ---
  _cellKey(x, z) { return ((x / this.cell) | 0) + ',' + ((z / this.cell) | 0); }
  _gridAdd(b) {
    const minX = Math.floor((b.p.x - b.hs.x) / this.cell), maxX = Math.floor((b.p.x + b.hs.x) / this.cell);
    const minZ = Math.floor((b.p.z - b.hs.z) / this.cell), maxZ = Math.floor((b.p.z + b.hs.z) / this.cell);
    b._cells = [];
    for (let i = minX; i <= maxX; i++) for (let j = minZ; j <= maxZ; j++) {
      const k = i + ',' + j;
      let a = this.grid.get(k); if (!a) { a = []; this.grid.set(k, a); }
      a.push(b); b._cells.push(k);
    }
  }
  _gridRemove(b) {
    if (!b._cells) return;
    for (const k of b._cells) {
      const a = this.grid.get(k);
      if (!a) continue;
      const i = a.indexOf(b); if (i >= 0) a.splice(i, 1);
      if (!a.length) this.grid.delete(k);
    }
    b._cells = null;
  }

  querySphere(pos, radius, out = []) {
    out.length = 0;
    const minX = Math.floor((pos.x - radius) / this.cell), maxX = Math.floor((pos.x + radius) / this.cell);
    const minZ = Math.floor((pos.z - radius) / this.cell), maxZ = Math.floor((pos.z + radius) / this.cell);
    const seen = this._seen || (this._seen = new Set());
    seen.clear();
    for (let i = minX; i <= maxX; i++) for (let j = minZ; j <= maxZ; j++) {
      const a = this.grid.get(i + ',' + j);
      if (!a) continue;
      for (let k = 0; k < a.length; k++) {
        const b = a[k];
        if (!b.alive || seen.has(b)) continue;
        seen.add(b);
        // cheap AABB-sphere reject
        const dx = Math.max(Math.abs(pos.x - b.p.x) - b.hs.x, 0);
        const dy = Math.max(Math.abs(pos.y - b.p.y) - b.hs.y, 0);
        const dz = Math.max(Math.abs(pos.z - b.p.z) - b.hs.z, 0);
        if (dx * dx + dy * dy + dz * dz <= radius * radius) out.push(b);
      }
    }
    return out;
  }

  // ------------------------------------------------------------- support ----
  /** build the support graph: each block is supported by blocks whose top face touches its bottom */
  buildSupports() {
    for (const b of this.blocks) { b.supports = []; b.supportedBy = null; }
    for (const b of this.blocks) {
      if (!b.alive) continue;
      const bottomY = b.p.y - b.hs.y;
      let best = null, bestOverlap = 0;
      const cand = this.querySphere(_p.set(b.p.x, bottomY - 0.25, b.p.z), Math.max(b.hs.x, b.hs.z) + 1.2);
      for (const o of cand) {
        if (o === b || !o.alive) continue;
        const topY = o.p.y + o.hs.y;
        if (Math.abs(topY - bottomY) > 0.75) continue;
        const ox = Math.min(b.p.x + b.hs.x, o.p.x + o.hs.x) - Math.max(b.p.x - b.hs.x, o.p.x - o.hs.x);
        const oz = Math.min(b.p.z + b.hs.z, o.p.z + o.hs.z) - Math.max(b.p.z - b.hs.z, o.p.z - o.hs.z);
        const overlap = Math.max(0, ox) * Math.max(0, oz);
        if (overlap > bestOverlap) { bestOverlap = overlap; best = o; }
        if (overlap > 0) o.supports.push(b);
      }
      const groundY = this.terrain ? this.terrain.heightAt(b.p.x, b.p.z) : 0;
      if (!best && bottomY > groundY + 0.9) b.supportedBy = null;      // floating (will fall)
      else b.supportedBy = best;
      if (bottomY <= groundY + 0.9) b._grounded = true;
    }
    this.totalHpAtStart = this.blocks.reduce((s, b) => s + b.hp, 0);
  }

  // ---------------------------------------------------------------- damage ---
  /**
   * Apply damage to a block. Returns {killed, overkill, block}
   * ctx: {source:'shot'|'collapse'|'fire'|'blast', velocity, dir, crit}
   */
  damage(b, amount, ctx = {}) {
    if (!b || !b.alive) return { killed: false };
    const def = MAT[b.mat];
    const dmg = amount * def.dmgTaken * (ctx.mul || 1);
    b.hp -= dmg;
    b.hitFlash = 1;
    if (!b.cracked && b.hp / b.maxHp < CFG.blocks.crackAt) b.cracked = true;
    this._tintDamage(b);
    if (b.hp <= 0) { const ov = -b.hp; this.destroy(b, ctx); return { killed: true, overkill: ov, block: b, dmg }; }
    return { killed: false, block: b, dmg };
  }

  _tintDamage(b) {
    const ratio = clamp(b.hp / b.maxHp, 0, 1);
    _col.setHex(0xffffff);
    if (b.col) _col.multiply(b.col);
    _col.lerp(_c1.setHex(0x2a1d16), (1 - ratio) * 0.55);
    if (b.burning > 0) _col.lerp(_c1.setHex(0xff6a20), 0.28);
    if (b.hitFlash > 0) _col.lerp(_c1.setHex(0xffffff), b.hitFlash * 0.35);
    b.im.setColorAt(b.slot, _col);
    if (b.im.instanceColor) b.im.instanceColor.needsUpdate = true;
    this.dirty.add(b.key);
  }

  /** overkill energy of a killed block punches through into neighbours */
  overflowBurst(b, overflow, dir) {
    const R = CFG.blocks.overflowRadius || 1.9;
    const near = this.querySphere(b.p, R + 1.4);
    for (const o of near) {
      if (!o.alive || o === b) continue;
      const d = o.p.distanceTo(b.p);
      if (d > R + Math.max(o.hs.x, o.hs.y, o.hs.z)) continue;
      const fall = clamp(1 - d / (R + 1.0), 0.35, 1);
      // cap: a punch-through cleans at most ~one block per neighbour
      const dmg = Math.min(overflow * (CFG.blocks.overflowMul || 0.4) * fall, o.maxHp * 1.25);
      this.damage(o, dmg, { source: 'splash', velocity: 14, dir: dir || null, _noOverflow: true });
    }
  }

  destroy(b, ctx = {}) {
    if (!b.alive) return;
    b.alive = false;
    this.destroyedCount++;
    this._gridRemove(b);
    this.hide(b);
    this.free.get(b.key).push(b.slot);
    const def = MAT[b.mat];

    // loot
    if (!b.noLoot) {
      for (const k in def.loot) this.lootPool[k] = (this.lootPool[k] || 0) + def.loot[k] * b.lootMul;
    }
    if (b.civilian) this.civilianDestroyed++;

    // micro-cascade: killing a block chips its neighbours, so good hits chain
    if (!ctx._chip && CFG.blocks.chipRadius) {
      const reach = CFG.blocks.chipRadius;
      const near = this.querySphere(b.p, reach + 1.6);
      const chip = b.maxHp * 0.5 * CFG.blocks.chipDamage;
      const dir = ctx.dir || null;
      for (const o of near) {
        if (!o.alive || o === b) continue;
        const d = o.p.distanceTo(b.p);
        if (d > reach + Math.max(o.hs.x, o.hs.y, o.hs.z)) continue;
        this.damage(o, chip * clamp(1 - d / (reach + 1.2), 0.25, 1), { source: 'chip', _chip: true, velocity: 6, dir });
      }
    }

    // debris (visual + light physics)
    const n = ctx.source === 'blast' ? def.debris + 2 : def.debris;
    const speed = clamp((ctx.velocity || 8) * 0.45, 2.5, 14);
    const dir = ctx.dir ? _v2.copy(ctx.dir).normalize() : null;
    this.debris.burst(b.p, b.mat, Math.min(n, 8), speed, Math.max(b.hs.x, b.hs.y, b.hs.z) * 0.55, dir);

    // collapse cascade
    this.collapseFrom(b, ctx);
    return b;
  }

  /** remove support and let dependents fall; returns list of collapsed blocks */
  collapseFrom(b, ctx = {}) {
    const collapsed = [];
    let frontier = (b.supports || []).slice();
    let depth = 0;
    const visited = new Set([b]);
    while (frontier.length && depth < 14) {
      const next = [];
      for (const dep of frontier) {
        if (!dep.alive || visited.has(dep)) continue;
        visited.add(dep);
        // does it still have support?
        let supported = false;
        if (dep._grounded) supported = true;
        else {
          const cand = this.querySphere(_p.set(dep.p.x, dep.p.y - dep.hs.y - 0.3, dep.p.z), Math.max(dep.hs.x, dep.hs.z) + 1.0);
          for (const o of cand) {
            if (o === dep || !o.alive) continue;
            const topY = o.p.y + o.hs.y;
            if (Math.abs(topY - (dep.p.y - dep.hs.y)) > 0.9) continue;
            const ox = Math.min(dep.p.x + dep.hs.x, o.p.x + o.hs.x) - Math.max(dep.p.x - dep.hs.x, o.p.x - o.hs.x);
            const oz = Math.min(dep.p.z + dep.hs.z, o.p.z + o.hs.z) - Math.max(dep.p.z - dep.hs.z, o.p.z - o.hs.z);
            if (Math.max(0, ox) * Math.max(0, oz) > 0.12) { supported = true; break; }
          }
        }
        if (supported) continue;
        // unsupported → fall, take impact damage when it lands
        this._dropBlock(dep, ctx);
        collapsed.push(dep);
        for (const s of (dep.supports || [])) next.push(s);
      }
      frontier = next;
      depth++;
    }
    return collapsed;
  }

  _dropBlock(b, ctx) {
    const fallHeight = Math.max(0.6, b.p.y - (this.terrain ? this.terrain.heightAt(b.p.x, b.p.z) : 0) - b.hs.y);
    const impact = Math.sqrt(2 * CFG.physics.gravity * fallHeight);
    const dmg = b.mass * impact * CFG.blocks.collapseDamageMul * 0.06;
    // destroy self (becomes debris) and hurt whatever is below
    const below = this.querySphere(_p.set(b.p.x, b.p.y - b.hs.y - 0.6, b.p.z), Math.max(b.hs.x, b.hs.z) * 1.1);
    for (const o of below) {
      if (o === b || !o.alive) continue;
      this.damage(o, dmg * (o._grounded ? 1 : 0.8), { source: 'collapse', velocity: impact });
    }
    // big debris chunk instead of instant vanish
    this.destroy(b, { source: 'collapse', velocity: impact * 0.7, dir: new THREE.Vector3((this.rng() - 0.5), -0.4, (this.rng() - 0.5)) });
  }

  // --------------------------------------------------------------- burning ---
  ignite(b, dps, seconds) {
    if (!b || !b.alive) return;
    b.burning = Math.max(b.burning, seconds);
    b.burnDps = Math.max(b.burnDps || 0, dps);
  }

  update(dt) {
    for (const b of this.blocks) {
      if (!b.alive) continue;
      if (b.hitFlash > 0) { b.hitFlash = Math.max(0, b.hitFlash - dt * 6); this._tintDamage(b); }
      if (b.burning > 0) {
        b.burning -= dt;
        const flammable = (b.mat === 'wood' || b.mat === 'rope' || b.mat === 'cloth' || b.mat === 'pitch');
        this.damage(b, (b.burnDps || 20) * dt * (flammable ? 1.6 : 0.5), { source: 'fire' });
        if (flammable && this.rng.chance(dt * 0.35)) {
          // spread
          const near = this.querySphere(b.p, 2.6);
          for (const o of near) if (o !== b && o.alive && !o.burning && (o.mat === 'wood' || o.mat === 'rope' || o.mat === 'cloth' || o.mat === 'pitch')) { this.ignite(o, (b.burnDps || 20) * 0.7, b.burning * 0.7); break; }
        }
      }
    }
    for (const k of this.dirty) { const im = this.meshes.get(k); if (im) { im.instanceMatrix.needsUpdate = true; } }
    this.dirty.clear();
  }

  // --------------------------------------------------------------- targets ---
  addTarget(def) {
    const t = {
      id: def.id,
      type: def.type,
      center: new THREE.Vector3(def.x, def.y, def.z),
      blocks: [],
      alive: true,
      destroyed: false,
      hp0: 0,
      hp: 0,
      bounty: (CFG.targetTypes[def.type] || {}).bounty || 10,
      priority: (CFG.targetTypes[def.type] || {}).priority || 1,
      civilian: !!def.civilian,
      label: def.label || '',
      outline: null,
      loot: def.loot || null,
    };
    this.targets.push(t);
    return t;
  }
  assignBlock(t, b) { if (!b) return; t.blocks.push(b); b.cid = t.id; b.ctype = t.type; if (t.civilian) b.civilian = true; }
  finalizeTargets() {
    for (const t of this.targets) {
      t.hp0 = t.blocks.reduce((s, b) => s + b.hp, 0) || 1;
      t.hp = t.hp0;
    }
  }
  updateTargets() {
    const events = [];
    for (const t of this.targets) {
      if (t.destroyed) continue;
      let hp = 0, alive = 0;
      for (const b of t.blocks) if (b.alive) { hp += b.hp; alive++; }
      t.hp = hp;
      t.aliveCount = alive;
      const ratio = hp / t.hp0;
      const wasAlive = !t.destroyed;
      if (alive === 0 || ratio < 0.32) {   // <32% HP = rubble: counts as destroyed
        t.destroyed = true;
        if (wasAlive) events.push({ type: 'destroyed', target: t });
      } else if (ratio < 0.55 && !t.damaged) { t.damaged = true; events.push({ type: 'damaged', target: t }); }
    }
    return events;
  }

  targetProgress() {
    let total = 0, done = 0, hostile = 0, hostileDone = 0;
    for (const t of this.targets) {
      total++;
      if (t.destroyed) done++;
      if (t.priority > 0) { hostile++; if (t.destroyed) hostileDone++; }
    }
    return { total, done, hostile, hostileDone };
  }

  clear() {
    for (const b of this.blocks) if (b.alive) this.hide(b);
    this.blocks.length = 0;
    this.targets.length = 0;
    this.grid.clear();
    for (const [k, im] of this.meshes) { im.count = 0; this.free.get(k).length = 0; this.dirty.add(k); }
    this.lootPool = {};
    this.destroyedCount = 0;
    this.civilianDestroyed = 0;
    for (const k of this.dirty) { const im = this.meshes.get(k); if (im) im.instanceMatrix.needsUpdate = true; }
    this.dirty.clear();
  }

  get aliveBlocks() { let n = 0; for (const b of this.blocks) if (b.alive) n++; return n; }
}
