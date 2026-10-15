// ============================================================================
//  systems/fort.js — procedural fortification generator (12 schemes, 4 biomes)
//  Deterministic from mission seed (§8.3). Builds blocks + registers targets.
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, makeRng } from '../core/utils.js';

const U = 1.25;          // base block unit (metres)
const _v = new THREE.Vector3();

export class FortBuilder {
  constructor(structures, terrain, rng) {
    this.S = structures;
    this.T = terrain;
    this.rng = rng;
    this.dist = 80;
    this.slots = [];   // garrison placement points (PLAN_UNITS_AND_FORTS §3.1)
  }

  /** garrison spawn point: role preference + zone + cover factor */
  addSlot(x, y, z, role, zone, cover = 0.3) {
    if (this.slots.length > 64) return null;
    const s = { pos: new THREE.Vector3(x, y, z), role, zone, cover, taken: false };
    this.slots.push(s);
    return s;
  }

  ground(x, z) { return this.T ? this.T.heightAt(x, z) : 0; }

  /** block helper that auto-sits on terrain when y === null */
  blk(x, y, z, sx, sy, sz, mat, target, opts = {}) {
    const gy = this.ground(x, z);
    const yy = y === null ? gy + sy / 2 : y;
    const b = this.S.addBlock(x, yy, z, sx, sy, sz, mat, opts);
    if (b && target) this.S.assignBlock(target, b);
    return b;
  }

  // ------------------------------------------------------------------ schemes ---
  static schemes = [
    'linear_wall', 'courtyard', 'twin_towers', 'keep', 'gatehouse',
    'star_fort', 'riverside_fort', 'hilltop_redoubt', 'village_outpost',
    'barbican', 'grand_citadel', 'winter_stockade',
  ];

  build(cfg) {
    const { scheme, dist, chapter, hpMul = 1, seed = 1, kind = 'DEMOLISH' } = cfg;
    this.dist = dist;
    this.chapter = chapter;
    this.hpMul = hpMul;
    const rng = makeRng(seed);
    this.rng = rng;
    const z = dist;
    const targets = [];
    const T = (type, x, y, zz, label, extra = {}) => {
      const t = this.S.addTarget({ id: `t${targets.length}`, type, x, y, z: zz, label, civilian: type === 'civilian' || type === 'chapel', ...extra });
      targets.push(t);
      return t;
    };

    const hasCivilians = rng.chance(0.55) && chapter >= 2 && kind !== 'SIEGE';
    const civSide = rng.chance(0.5) ? -1 : 1;

    switch (scheme) {
      case 'linear_wall':    this.linearWall(z, T, rng, hpMul); break;
      case 'courtyard':      this.courtyard(z, T, rng, hpMul); break;
      case 'twin_towers':    this.twinTowers(z, T, rng, hpMul); break;
      case 'keep':           this.keep(z, T, rng, hpMul); break;
      case 'gatehouse':      this.gatehouse(z, T, rng, hpMul); break;
      case 'star_fort':      this.starFort(z, T, rng, hpMul); break;
      case 'riverside_fort': this.linearWall(z, T, rng, hpMul); this.dock(z, T, rng); break;
      case 'hilltop_redoubt':this.redoubt(z, T, rng, hpMul); break;
      case 'village_outpost':this.village(z, T, rng, hpMul); break;
      case 'barbican':       this.barbican(z, T, rng, hpMul); break;
      case 'grand_citadel':  this.citadel(z, T, rng, hpMul); break;
      case 'winter_stockade':this.stockade(z, T, rng, hpMul); break;
      default:               this.linearWall(z, T, rng, hpMul);
    }

    // always: banner + commander on the most important structure
    const main = targets.find((t) => t.type === 'tower') || targets.find((t) => t.type === 'keep') || targets[targets.length - 1];
    if (main) {
      const bt = T('banner', main.center.x, main.center.y + 4, main.center.z, 'Штандарт');
      this.banner(bt, main.center.x, main.center.y + 2.2, main.center.z, rng);
      const ct = T('commander', main.center.x + (rng() - 0.5) * 4, 0, main.center.z + (rng() - 0.5) * 3, 'Командир');
      this.commander(ct, ct.center.x, this.ground(ct.center.x, ct.center.z), ct.center.z);
    }

    // enemy engines (counter-battery threat)
    const engines = clamp(Math.round(chapter * 0.7 + rng.int(0, 1)), 0, 4);
    for (let i = 0; i < engines; i++) {
      const ex = (i - (engines - 1) / 2) * (10 + rng.range(0, 6)) + rng.range(-3, 3);
      const ez = z - rng.range(2, 9);
      const et = T('engine', ex, 0, ez, 'Орудие врага');
      this.engine(et, ex, this.ground(ex, ez), ez, rng);
    }

    // magazine (chain reaction prize)
    if (rng.chance(0.72)) {
      const mx = rng.range(-14, 14), mz = z + rng.range(-4, 8);
      const mt = T('magazine', mx, 0, mz, 'Пороховой склад', { loot: { pitch: 5, coins: 40, metal: 3 } });
      this.magazine(mt, mx, this.ground(mx, mz), mz, rng);
    }

    // barracks (soldiers)
    if (rng.chance(0.6)) {
      const bx = rng.range(-18, 18), bz = z + rng.range(4, 12);
      const bt = T('barracks', bx, 0, bz, 'Казарма');
      this.barracks(bt, bx, this.ground(bx, bz), bz, rng);
    }

    // civilians — NEVER on the direct firing line unless the player is sloppy
    if (hasCivilians) {
      const cx = civSide * rng.range(24, 34), cz = z + rng.range(-2, 10);
      const type = rng.chance(0.5) ? 'civilian' : 'chapel';
      const ct = T(type, cx, 0, cz, type === 'civilian' ? 'Мельница' : 'Часовня');
      if (type === 'civilian') this.mill(ct, cx, this.ground(cx, cz), cz, rng);
      else this.chapel(ct, cx, this.ground(cx, cz), cz, rng);
    }

    // inner yard: engineer/spear posts ring the main structure (behind walls)
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.4;
      const px = Math.cos(a) * 9, pz = z + Math.sin(a) * 6 - 5;
      this.addSlot(px, this.ground(px, pz), pz, i % 2 ? 'spear' : 'engineer', 'yard', 0.2);
    }
    this.S.finalizeTargets();
    this.S.buildSupports();
    return { targets, z, scheme, slots: this.slots };
  }

  // ------------------------------------------------------------ constructions ---
  wallRun(z, T, rng, x0, x1, height, thickness = U, mat = 'stone', walkway = true) {
    const wt = T('wall', (x0 + x1) / 2, 0, z, 'Стена');
    const cols = Math.max(2, Math.round((x1 - x0) / U));
    for (let c = 0; c < cols; c++) {
      const x = x0 + (c + 0.5) * ((x1 - x0) / cols);
      const gy = this.ground(x, z);
      let y = gy;
      for (let r = 0; r < height; r++) {
        const isTop = r === height - 1;
        const m = isTop && walkway ? 'wood' : mat;
        this.blk(x, y + U / 2, z, U * 0.99, U, thickness, m, wt, { hpMul: this.hpMul * (isTop ? 0.75 : 1), ry: 0 });
        y += U;
      }
      // crenellations
      if (walkway && c % 2 === 0) {
        this.blk(x, y + U * 0.35, z, U * 0.9, U * 0.7, thickness * 0.8, mat, wt, { hpMul: this.hpMul * 0.5 });
      } else if (walkway) {
        // gap between merlons = an archer's firing place on the wall walk
        this.addSlot(x, y, z - thickness * 0.3, 'archer', 'wall', 0.6);
      }
    }
    return wt;
  }

  tower(T, x, z, baseH, topH, mat = 'stone', label = 'Башня') {
    const t = T('tower', x, 0, z, label);
    const gy = this.ground(x, z);
    const R = U * 2.1;
    // stone base: 3x3 block cluster per level
    for (let r = 0; r < baseH; r++) {
      const y = gy + U * r + U / 2;
      const shrink = r > baseH - 3 ? 0.94 : 1;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        if (Math.abs(i) + Math.abs(j) === 2 && r % 3 !== 0) continue; // hollow-ish look, fewer blocks
        this.blk(x + i * U * 0.98 * shrink, y, z + j * U * 0.98 * shrink, U * shrink, U, U * shrink, mat, t, { hpMul: this.hpMul });
      }
    }
    // wooden top gallery + roof
    let y = gy + U * baseH;
    for (let r = 0; r < topH; r++) {
      const s = r === topH - 1 ? 0.8 : 1.05;
      for (let i = -1; i <= 1; i += 2) {
        this.blk(x + i * U * 0.95 * s, y + U / 2, z, U * s, U, U * 2.2 * s, 'wood', t, { hpMul: this.hpMul * 0.85 });
        this.blk(x, y + U / 2, z + i * U * 0.95 * s, U * 2.2 * s, U, U * s, 'wood', t, { hpMul: this.hpMul * 0.85 });
      }
      y += U;
    }
    // conical roof from 4 wedges
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      this.blk(x + Math.cos(a) * U * 0.5, y + U * 0.45, z + Math.sin(a) * U * 0.5, U * 1.5, U * 0.7, U * 1.5, 'wood', t, { hpMul: this.hpMul * 0.6, ry: a });
    }
    // gallery floor: archer places in the tower corners
    const gyTop = gy + U * baseH;
    this.addSlot(x - U * 0.9, gyTop, z - U * 0.9, 'archer', 'tower', 0.7);
    this.addSlot(x + U * 0.9, gyTop, z - U * 0.9, 'archer', 'tower', 0.7);
    return t;
  }

  gate(T, x, z, h = 4) {
    const t = T('gate', x, 0, z, 'Ворота');
    const gy = this.ground(x, z);
    // jambs
    for (const s of [-1, 1]) {
      for (let r = 0; r < h + 2; r++) this.blk(x + s * U * 1.6, gy + U * r + U / 2, z, U, U, U * 1.3, 'stone', t, { hpMul: this.hpMul * 1.2 });
    }
    // lintel
    for (let i = -1; i <= 1; i++) this.blk(x + i * U * 0.9, gy + U * (h + 2) + U / 2, z, U, U * 0.9, U * 1.3, 'stone', t, { hpMul: this.hpMul });
    // wooden doors — weak point (hinges)
    for (let r = 0; r < h; r++) {
      for (const s of [-0.5, 0.5]) {
        const isHinge = r === 0 || r === h - 1;
        this.blk(x + s * U, gy + U * r + U / 2, z, U * 0.95, U, U * 0.42, isHinge ? 'metal' : 'wood', t, { hpMul: this.hpMul * (isHinge ? 0.7 : 1) });
      }
    }
    // gate guard: spearmen on both flanks, facing the approach
    this.addSlot(x - U * 2.7, gy, z - U * 1.4, 'spear', 'gate', 0.4);
    this.addSlot(x + U * 2.7, gy, z - U * 1.4, 'spear', 'gate', 0.4);
    return t;
  }

  magazine(T, x, y, z, rng) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      const m = (i === 0 && j === 0) ? 'pitch' : 'wood';
      this.blk(x + i * U * 0.9, y + U / 2, z + j * U * 0.9, U * 0.92, U, U * 0.92, m, T, { hpMul: this.hpMul * 0.9 });
    }
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      if (Math.abs(i) + Math.abs(j) !== 1) continue;
      this.blk(x + i * U * 0.9, y + U * 1.5, z + j * U * 0.9, U * 0.92, U, U * 0.92, 'wood', T, { hpMul: this.hpMul * 0.8 });
    }
    this.blk(x, y + U * 2.4, z, U * 2.6, U * 0.5, U * 2.6, 'wood', T, { hpMul: this.hpMul * 0.6 });
    T.chainReaction = { radius: 7.5, damage: 420, mat: 'pitch' };
    return T;
  }

  engine(T, x, y, z, rng) {
    // small enemy trebuchet, axis along Z: throws toward the player (−Z),
    // counterweight at the rear (+Z) — the machine FACES its firing direction
    for (const s of [-1, 1]) {
      this.blk(x + s * U * 1.1, y + U * 0.5, z, U * 0.4, U, U * 2.2, 'wood', T, { hpMul: this.hpMul * 0.9 });
      this.blk(x + s * U * 1.1, y + U * 1.4, z, U * 0.4, U * 0.8, U * 0.4, 'wood', T, { hpMul: this.hpMul * 0.7 });
    }
    this.blk(x, y + U * 1.1, z, U * 0.35, U * 0.35, U * 2.6, 'wood', T, { hpMul: this.hpMul * 0.8, rx: 0.35 });
    this.blk(x, y + U * 0.75, z + U * 1.3, U * 0.9, U * 0.9, U * 0.9, 'metal', T, { hpMul: this.hpMul * 1.1 });
    this.blk(x, y + U * 0.25, z, U * 2.6, U * 0.5, U * 3.0, 'wood', T, { hpMul: this.hpMul });
    T.enginePos = new THREE.Vector3(x, y + U * 1.6, z - U * 1.6);   // muzzle at the FRONT
    this.addSlot(x - 1.7, y, z - 1.5, 'crew', 'enginepad', 0.3);
    this.addSlot(x + 1.7, y, z - 1.5, 'crew', 'enginepad', 0.3);
    return T;
  }

  barracks(T, x, y, z, rng) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      this.blk(x + i * U, y + U / 2, z + j * U, U, U, U, 'wood', T, { hpMul: this.hpMul * 0.9 });
    }
    for (let i = -1; i <= 1; i++) {
      this.blk(x + i * U, y + U * 1.4, z, U, U * 0.8, U * 3.0, 'wood', T, { hpMul: this.hpMul * 0.75 });
      this.blk(x, y + U * 1.4, z + i * U, U * 3.0, U * 0.8, U, 'wood', T, { hpMul: this.hpMul * 0.75 });
    }
    this.blk(x, y + U * 2.3, z, U * 3.3, U * 0.5, U * 3.3, 'wood', T, { hpMul: this.hpMul * 0.6 });
    T.soldiers = CFG.enemy.soldiersPerBarracks;
    this.addSlot(x - U, y, z - U * 2.2, 'spear', 'yard', 0.2);
    this.addSlot(x + U, y, z - U * 2.2, 'spear', 'yard', 0.2);
    return T;
  }

  mill(T, x, y, z, rng) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) this.blk(x + i * U, y + U / 2, z + j * U, U, U, U, 'wood', T, { hpMul: this.hpMul * 0.8 });
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { if (Math.abs(i) + Math.abs(j) > 1) continue; this.blk(x + i * U, y + U * 1.5, z + j * U, U, U, U, 'wood', T, { hpMul: this.hpMul * 0.7 }); }
    this.blk(x, y + U * 2.5, z, U * 2.4, U * 0.7, U * 2.4, 'wood', T, { hpMul: this.hpMul * 0.6 });
    // sails
    for (let i = 0; i < 4; i++) {
      const a = i * Math.PI / 2;
      this.blk(x + Math.cos(a) * 2.2, y + U * 2.6 + Math.sin(a) * 2.2, z - U * 1.7, U * 0.5, U * 3.2, U * 0.25, 'cloth', T, { hpMul: this.hpMul * 0.35, rz: a });
    }
    T.civilian = true;
    return T;
  }

  chapel(T, x, y, z, rng) {
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) this.blk(x + i * U, y + U / 2, z + j * U, U, U, U, 'stone', T, { hpMul: this.hpMul * 0.85 });
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) { if (Math.abs(i) + Math.abs(j) > 1) continue; this.blk(x + i * U, y + U * 1.5, z + j * U, U, U, U, 'stone', T, { hpMul: this.hpMul * 0.7 }); }
    this.blk(x, y + U * 2.6, z, U * 2.6, U * 0.9, U * 2.6, 'wood', T, { hpMul: this.hpMul * 0.6 });
    this.blk(x, y + U * 4.0, z, U * 0.6, U * 2.0, U * 0.6, 'stone', T, { hpMul: this.hpMul * 0.7 });
    T.civilian = true;
    return T;
  }

  banner(T, x, y, z, rng) {
    this.blk(x, y + U * 1.4, z, U * 0.22, U * 2.8, U * 0.22, 'wood', T, { hpMul: this.hpMul * 0.8 });
    this.blk(x + U * 0.75, y + U * 2.2, z, U * 1.5, U * 1.1, U * 0.1, 'cloth', T, { hpMul: this.hpMul * 0.35 });
    return T;
  }

  commander(T, x, y, z) {
    this.blk(x, y + U * 0.55, z, U * 0.55, U * 1.1, U * 0.55, 'metal', T, { hpMul: this.hpMul * 0.9 });
    this.blk(x, y + U * 1.35, z, U * 0.42, U * 0.5, U * 0.42, 'metal', T, { hpMul: this.hpMul * 0.8 });
    this.blk(x + U * 0.5, y + U * 0.9, z, U * 0.14, U * 1.9, U * 0.14, 'wood', T, { hpMul: this.hpMul * 0.5 });
    T.commanderPos = new THREE.Vector3(x, y + 1.2, z);
    this.addSlot(x, y, z - U * 0.8, 'commander', 'keep', 0.2);
    return T;
  }

  stockade(T, x, z, len, rng) {
    const t = T('wall', x, 0, z, 'Частокол');
    const n = Math.round(len / (U * 0.8));
    for (let i = 0; i < n; i++) {
      const xx = x - len / 2 + i * (len / n);
      const gy = this.ground(xx, z);
      const h = U * rng.range(2.2, 3.4);
      this.blk(xx, gy + h / 2, z, U * 0.42, h, U * 0.42, 'wood', t, { hpMul: this.hpMul * 0.8, rz: (rng() - 0.5) * 0.12 });
    }
    return t;
  }

  // ---------------------------------------------------------------- layouts ---
  linearWall(z, T, rng, hpMul) {
    const half = rng.range(9, 15);
    this.wallRun(z, T, rng, -half, -U * 1.8, rng.int(4, 6), U, 'stone');
    this.wallRun(z, T, rng, U * 1.8, half, rng.int(4, 6), U, 'stone');
    this.gate(T, 0, z, rng.int(3, 4));
    if (rng.chance(0.6)) this.tower(T, -half - U * 1.6, z, rng.int(5, 7), rng.int(1, 2), 'stone', 'Левая башня');
    if (rng.chance(0.6)) this.tower(T, half + U * 1.6, z, rng.int(5, 7), rng.int(1, 2), 'stone', 'Правая башня');
  }

  courtyard(z, T, rng, hpMul) {
    const half = rng.range(10, 14);
    this.wallRun(z, T, rng, -half, half, rng.int(3, 5), U, 'stone');
    this.wallRun(z + half * 1.5, T, rng, -half, half, rng.int(3, 4), U, 'stone');
    for (const s of [-1, 1]) {
      const t = T('wall', s * half, 0, z + half * 0.75, 'Боковая стена');
      for (let i = 0; i < Math.round(half * 1.5 / U); i++) {
        const zz = z + i * U;
        const gy = this.ground(s * half, zz);
        for (let r = 0; r < rng.int(3, 4); r++) this.blk(s * half, gy + U * r + U / 2, zz, U, U, U, 'stone', t, { hpMul });
      }
    }
    this.tower(T, -half, z, rng.int(5, 6), 2, 'stone', 'Башня двора');
    const bt = T('barracks', half * 0.4, 0, z + half * 0.9, 'Казарма');
    this.barracks(bt, half * 0.4, this.ground(half * 0.4, z + half * 0.9), z + half * 0.9, rng);
  }

  twinTowers(z, T, rng, hpMul) {
    const off = rng.range(9, 13);
    this.tower(T, -off, z, rng.int(7, 9), rng.int(2, 3), 'stone', 'Западная башня');
    this.tower(T, off, z, rng.int(7, 9), rng.int(2, 3), 'stone', 'Восточная башня');
    this.wallRun(z, T, rng, -off + U * 2.4, off - U * 2.4, rng.int(3, 4), U, 'stone');
  }

  keep(z, T, rng, hpMul) {
    const t = T('tower', 0, 0, z, 'Донжон');
    const gy = this.ground(0, z);
    const R = 3;
    for (let r = 0; r < rng.int(8, 11); r++) {
      const y = gy + U * r + U / 2;
      const shrink = 1 - r * 0.022;
      for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
        const edge = Math.max(Math.abs(i), Math.abs(j)) === R;
        if (!edge && r % 2 === 0) continue;
        if (!edge && r > 2) continue;
        this.blk(i * U * shrink, y, z + j * U * shrink, U * shrink, U, U * shrink, r > 6 ? 'brick' : 'stone', t, { hpMul: hpMul * (edge ? 1 : 0.9) });
      }
    }
    for (let i = -R; i <= R; i++) for (let j = -R; j <= R; j++) {
      if (Math.max(Math.abs(i), Math.abs(j)) !== R) continue;
      this.blk(i * U * 0.82, gy + U * 11 + U / 2, z + j * U * 0.82, U * 0.85, U, U * 0.85, 'wood', t, { hpMul: hpMul * 0.7 });
    }
    this.wallRun(z + U * 4.2, T, rng, -12, 12, 3, U, 'stone');
  }

  gatehouse(z, T, rng, hpMul) {
    this.gate(T, 0, z, 5);
    for (const s of [-1, 1]) {
      this.tower(T, s * U * 4.2, z, rng.int(6, 8), 2, 'stone', s < 0 ? 'Левая башня' : 'Правая башня');
      this.wallRun(z, T, rng, s * U * 6.5, s * rng.range(14, 19), rng.int(3, 5), U, 'stone');
    }
  }

  starFort(z, T, rng, hpMul) {
    const arms = 4;
    for (let a = 0; a < arms; a++) {
      const ang = (a / arms) * Math.PI * 2 + Math.PI / 4;
      const len = rng.range(9, 13);
      const n = Math.round(len / U);
      const t = T('wall', Math.cos(ang) * len * 0.5, 0, z + Math.sin(ang) * len * 0.5, 'Бастион');
      for (let i = 0; i < n; i++) {
        const x = Math.cos(ang) * (i * U), zz = z + Math.sin(ang) * (i * U);
        const gy = this.ground(x, zz);
        for (let r = 0; r < rng.int(2, 4); r++) this.blk(x, gy + U * r + U / 2, zz, U, U, U, 'stone', t, { hpMul, ry: ang });
      }
    }
    this.tower(T, 0, z, rng.int(5, 7), 2, 'brick', 'Центральный редут');
  }

  dock(z, T, rng) {
    const x = rng.range(16, 24), zz = z - rng.range(4, 10);
    const t = T('wall', x, 0, zz, 'Пристань');
    const gy = Math.min(this.ground(x, zz), CFG.physics.waterLevel);
    for (let i = 0; i < 8; i++) {
      this.blk(x - i * U * 0.9, gy + 1.6, zz, U * 0.9, U * 0.35, U * 3.4, 'wood', t, { hpMul: this.hpMul * 0.8 });
    }
    for (let i = 0; i < 4; i++) this.blk(x - i * U * 2.2, gy + 0.8, zz + U * 1.4, U * 0.4, U * 1.8, U * 0.4, 'wood', t, { hpMul: this.hpMul * 0.7 });
  }

  redoubt(z, T, rng, hpMul) {
    const r = rng.range(7, 10);
    const t = T('wall', 0, 0, z, 'Редут');
    const n = Math.round((2 * Math.PI * r) / U);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = Math.cos(a) * r, zz = z + Math.sin(a) * r;
      const gy = this.ground(x, zz);
      for (let k = 0; k < rng.int(2, 4); k++) this.blk(x, gy + U * k + U / 2, zz, U, U, U, 'stone', t, { hpMul, ry: a });
    }
    this.tower(T, 0, z, rng.int(4, 6), 2, 'stone', 'Сторожевая вышка');
  }

  village(z, T, rng, hpMul) {
    this.stockade(T, 0, z - rng.range(4, 7), rng.range(18, 26), rng);
    for (let i = 0; i < 3; i++) {
      const x = (i - 1) * rng.range(9, 13), zz = z + rng.range(0, 8);
      const t = T('barracks', x, 0, zz, 'Дом');
      this.barracks(t, x, this.ground(x, zz), zz, rng);
    }
    this.tower(T, rng.range(-4, 4), z + rng.range(8, 14), rng.int(4, 6), 2, 'wood', 'Дозорная вышка');
  }

  barbican(z, T, rng, hpMul) {
    this.wallRun(z, T, rng, -13, 13, rng.int(4, 6), U, 'stone');
    this.wallRun(z + 7, T, rng, -9, 9, rng.int(3, 4), U, 'brick');
    this.gate(T, 0, z, 4);
    this.gate(T, 0, z + 7, 3);
    for (const s of [-1, 1]) this.tower(T, s * 15, z + 3.5, rng.int(6, 8), 2, 'stone', s < 0 ? 'Западная башня' : 'Восточная башня');
  }

  citadel(z, T, rng, hpMul) {
    // boss: 3 rings — outer wall, inner towers, central keep (multi-phase)
    this.wallRun(z - 6, T, rng, -20, 20, 5, U, 'stone');
    this.gate(T, 0, z - 6, 5);
    this.wallRun(z + 2, T, rng, -14, 14, 4, U, 'brick');
    this.tower(T, -16, z - 2, 9, 3, 'stone', 'Западная башня');
    this.tower(T, 16, z - 2, 9, 3, 'stone', 'Восточная башня');
    this.keep(z + 10, T, rng, hpMul * 1.15);
  }

  stockadeRing(z, T, rng, hpMul) { this.redoubt(z, T, rng, hpMul); }
}
