// ============================================================================
//  core/utils.js — math, seeded RNG, event bus, object pools, noise
// ============================================================================

export const TAU = Math.PI * 2;
export const DEG = Math.PI / 180;
export const RAD = 180 / Math.PI;

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const invLerp = (a, b, v) => (b === a ? 0 : (v - a) / (b - a));
export const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
export const smoothstep = (t) => { const x = clamp01(t); return x * x * (3 - 2 * x); };
export const easeOutCubic = (t) => 1 - Math.pow(1 - clamp01(t), 3);
export const easeOutBack = (t, s = 1.7) => { const x = clamp01(t) - 1; return x * x * ((s + 1) * x + s) + 1; };
export const easeInOut = (t) => { const x = clamp01(t); return x < 0.5 ? 2 * x * x : 1 - Math.pow(-2 * x + 2, 2) / 2; };
export const sign = (v) => (v < 0 ? -1 : 1);
export const approach = (v, target, step) => (v < target ? Math.min(v + step, target) : Math.max(v - step, target));

// Deterministic hash (used for mission seeds) — Decision D16/§8.3 determinism
export function hashString(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}
export function hashNums(...nums) {
  let h = 2166136261 >>> 0;
  for (const n of nums) { h ^= Math.floor(n * 1000); h = Math.imul(h, 16777619) >>> 0; }
  return h >>> 0;
}

// mulberry32 — tiny, fast, seedable, deterministic
export function makeRng(seed = 1234567) {
  let a = (seed >>> 0) || 1;
  const rng = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  rng.int = (min, max) => min + Math.floor(rng() * (max - min + 1));
  rng.range = (min, max) => min + rng() * (max - min);
  rng.pick = (arr) => arr[Math.floor(rng() * arr.length) % arr.length];
  rng.chance = (p) => rng() < p;
  rng.shuffle = (arr) => { const a2 = arr.slice(); for (let i = a2.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a2[i], a2[j]] = [a2[j], a2[i]]; } return a2; };
  rng.weighted = (items, weightFn) => {
    let total = 0; for (const it of items) total += weightFn(it);
    let r = rng() * total;
    for (const it of items) { r -= weightFn(it); if (r <= 0) return it; }
    return items[items.length - 1];
  };
  rng.gauss = () => { // Box–Muller
    let u = 0, v = 0;
    while (u === 0) u = rng();
    while (v === 0) v = rng();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(TAU * v);
  };
  rng.seed = a;
  return rng;
}

// ---------------------------------------------------------------- 1D noise ---
export function makeNoise1D(seed = 1) {
  const perm = new Float32Array(512);
  const rng = makeRng(seed);
  for (let i = 0; i < 512; i++) perm[i] = rng() * 2 - 1;
  return (x) => {
    const xi = Math.floor(x) & 255;
    const xf = x - Math.floor(x);
    const u = xf * xf * (3 - 2 * xf);
    return lerp(perm[xi], perm[xi + 1], u);
  };
}

// 2D value noise (terrain, texture generation)
export function makeNoise2D(seed = 1) {
  const size = 256;
  const grid = new Float32Array(size * size);
  const rng = makeRng(seed);
  for (let i = 0; i < grid.length; i++) grid[i] = rng() * 2 - 1;
  const at = (x, y) => grid[((y & 255) * size) + (x & 255)];
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(at(xi, yi), at(xi + 1, yi), u), lerp(at(xi, yi + 1), at(xi + 1, yi + 1), u), v);
  };
  return (x, y, octaves = 4, persistence = 0.5, lacunarity = 2.0) => {
    let amp = 1, freq = 1, sum = 0, norm = 0;
    for (let o = 0; o < octaves; o++) { sum += noise(x * freq, y * freq) * amp; norm += amp; amp *= persistence; freq *= lacunarity; }
    return sum / norm;
  };
}

// ------------------------------------------------------------ Event system ---
export class Emitter {
  constructor() { this._m = new Map(); }
  on(evt, fn) { if (!this._m.has(evt)) this._m.set(evt, []); this._m.get(evt).push(fn); return () => this.off(evt, fn); }
  off(evt, fn) { const a = this._m.get(evt); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(evt, payload) {
    const a = this._m.get(evt);
    if (a) for (let i = 0; i < a.length; i++) { try { a[i](payload); } catch (e) { console.error(`[event ${evt}] STACK: ` + (e && e.stack || e)); } }
    const w = this._m.get('*');
    if (w) for (const fn of w) { try { fn(evt, payload); } catch (e) { /* noop */ } }
  }
  clear() { this._m.clear(); }
}

// ------------------------------------------------------------------- Pools ---
export class Pool {
  constructor(factory, reset, initial = 0, max = 1e9) {
    this.factory = factory; this.reset = reset; this.max = max;
    this.free = []; this.active = [];
    for (let i = 0; i < initial; i++) this.free.push(factory());
  }
  acquire() {
    const o = this.free.length ? this.free.pop() : this.factory();
    this.active.push(o);
    return o;
  }
  release(o) {
    const i = this.active.indexOf(o);
    if (i < 0) return;
    this.active.splice(i, 1);
    if (this.reset) this.reset(o);
    if (this.free.length < this.max) this.free.push(o);
  }
  releaseAll() { while (this.active.length) this.release(this.active[this.active.length - 1]); }
  get activeCount() { return this.active.length; }
}

// ------------------------------------------------------------------- misc ---
export const fmt = (n, digits = 0) => {
  if (!isFinite(n)) return '∞';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(1) + 'k';
  return digits ? n.toFixed(digits) : Math.round(n).toString();
};
export const fmtTime = (s) => {
  s = Math.max(0, Math.floor(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  if (h) return `${h}ч ${m}м`;
  if (m) return `${m}м ${sec}с`;
  return `${sec}с`;
};
export const pct = (v) => Math.round(clamp01(v) * 100);

export function deepClone(o) { return JSON.parse(JSON.stringify(o)); }
export function deepMerge(base, over) {
  const out = Array.isArray(base) ? base.slice() : { ...base };
  for (const k in over) {
    const v = over[k];
    out[k] = (v && typeof v === 'object' && !Array.isArray(v) && base && typeof base[k] === 'object' && base[k] !== null && !Array.isArray(base[k]))
      ? deepMerge(base[k], v) : v;
  }
  return out;
}

// scratch vectors — reused in hot loops to avoid GC (§8.3)
import * as THREE from 'three';
export const _v1 = new THREE.Vector3();
export const _v2 = new THREE.Vector3();
export const _v3 = new THREE.Vector3();
export const _v4 = new THREE.Vector3();
export const _q1 = new THREE.Quaternion();
export const _m1 = new THREE.Matrix4();
export const _c1 = new THREE.Color();
export const _c2 = new THREE.Color();
export const _col = new THREE.Color();

export const isTouch = () => (typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0));
export const nowMs = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

export function vibrate(pattern) {
  try {
    if (typeof window !== 'undefined' && window.CapacitorHaptics) { window.CapacitorHaptics(pattern); return; }
    if (typeof navigator !== 'undefined' && navigator.vibrate) navigator.vibrate(pattern);
  } catch (e) { /* noop */ }
}
