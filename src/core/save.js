// ============================================================================
//  core/save.js — versioned save state, migrations, autosave, cloud hook
// ============================================================================
import { CFG } from '../config.js';
import { clamp, deepClone, nowMs } from './utils.js';
import { Emitter } from './utils.js';

export const events = new Emitter();

const RES = CFG.resources;

export function defaultState() {
  return {
    v: CFG.SAVE_VERSION,
    createdAt: Date.now(),
    lastSeen: Date.now(),
    lang: CFG.LANG_DEFAULT,

    resources: deepClone(RES.start),

    tech: { mechanics: 0, ballistics: 0, durability: 0, ordnance: 0, crew: 0 },
    techNodes: {},                     // {nodeId: true}

    crew: {
      slots: CFG.crew.slotsStart,
      roster: [
        { id: 'c1', role: 'gunner',   name: 'Тихон',   level: 1, xp: 0, fatigue: 0 },
        { id: 'c2', role: 'loader',   name: 'Грум',    level: 1, xp: 0, fatigue: 0 },
      ],
      active: ['c1', 'c2'],
    },

    camp: {
      buildings: {
        quarry: { level: 1, stored: 0, lastTick: Date.now() },
        sawmill: { level: 1, stored: 0, lastTick: Date.now() },
        mine: { level: 0, stored: 0, lastTick: Date.now() },
        ropery: { level: 0, stored: 0, lastTick: Date.now() },
        still: { level: 0, stored: 0, lastTick: Date.now() },
      },
      autoCollect: false,
    },

    progress: {
      rank: 0, level: 1, xp: 0,
      missionsDone: 0,
      bestRank: {},                  // missionId -> 'S'..'D'
      shotsFired: 0, shotsHit: 0, bestEfficiency: 0,
      trophies: [],                  // collected trophy ids
      unlockedAmmo: ['stone'],
      unlockedMissions: ['1-1'],
      chapterProgress: { 1: 0 },
      daily: { date: null, contractSeed: null, done: false, trials: 0 },
      season: { id: 1, xp: 0, claimed: [] },
      tutorialDone: false,
      tutorialStep: 0,
    },

    settings: {
      quality: CFG.render.qualityStart,
      autoQuality: true,
      music: CFG.audio.musicVol,
      sfx: CFG.audio.sfxVol,
      ui: CFG.audio.uiVol,
      muted: false,
      haptics: true,
      cameraDynamic: true,
      aimAssist: true,
      ghostTrail: true,
      showPredict: true,
      precisionAim: false,
      uiScale: 1.0,
      leftHanded: false,
      colorBlind: 'off',
      reduceMotion: false,
      subtitles: false,
      invertOrbitY: false,
      sensAz: 1.0,
      sensEl: 1.0,
      sensPower: 1.0,
      // graphics features (1.3.0)
      shadows: true,
      postFx: true,
      // debug/QA flags — persisted so the settings screen doesn't lie after reload
      showFps: false,
      testerMode: false,
      godMode: false,
      instantCock: false,
    },

    stats: { playTime: 0, sessions: 0, coinsEarned: 0, blocksDestroyed: 0, perfectShots: 0, civiliansHit: 0, soldiersKilled: 0 },
    rewarded: { date: null, used: {} },
    debug: {},
  };
}

// --------------------------------------------------------------- migrations ---
const MIGRATIONS = {
  1: (s) => { s.v = 2; s.camp = s.camp || defaultState().camp; s.progress.unlockedAmmo = s.progress.unlockedAmmo || ['stone']; },
  2: (s) => { s.v = 3; s.settings = { ...defaultState().settings, ...(s.settings || {}) }; s.rewarded = s.rewarded || { date: null, used: {} }; },
  3: (s) => {
    s.v = 4;
    // daily/trial results used to leak into the campaign bestRank map
    if (s.progress && s.progress.bestRank) {
      for (const k of Object.keys(s.progress.bestRank)) {
        if (/^(daily|trial|training)/.test(k)) delete s.progress.bestRank[k];
      }
    }
    delete (s.settings || {}).langRoot;   // stray key from the old language widget
  },
};

function migrate(s) {
  let guard = 0;
  while (s && typeof s.v === 'number' && s.v < CFG.SAVE_VERSION && guard++ < 20) {
    const m = MIGRATIONS[s.v];
    if (m) { try { m(s); } catch (e) { console.warn('migration failed', s.v, e); s.v++; } }
    else s.v++;
  }
  if (!s || typeof s.v !== 'number') return defaultState();
  // forward-compat merge: fill any missing keys from defaults
  return reconcile(defaultState(), s);
}

function reconcile(base, saved) {
  const out = Array.isArray(base) ? (Array.isArray(saved) ? saved : base.slice()) : { ...base };
  if (!Array.isArray(base)) {
    for (const k of Object.keys(base)) {
      if (saved && Object.prototype.hasOwnProperty.call(saved, k)) {
        const b = base[k], s = saved[k];
        out[k] = (b && typeof b === 'object' && !Array.isArray(b) && s && typeof s === 'object' && !Array.isArray(s))
          ? reconcile(b, s) : s;
      }
    }
    // keep extra unknown keys from saved (forward compatibility)
    if (saved) for (const k of Object.keys(saved)) if (!(k in out)) out[k] = saved[k];
  }
  return out;
}

// ------------------------------------------------------------- persistence ---
class SaveManager {
  constructor() {
    this.state = defaultState();
    this.dirty = false;
    this._autosaveTimer = 0;
    this._cap = null;
    this.loaded = false;
  }

  async load() {
    let raw = null;
    try {
      if (window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.Preferences) {
        this._cap = window.Capacitor.Plugins.Preferences;
        const r = await this._cap.get({ key: CFG.SAVE_KEY });
        raw = r && r.value;
      }
    } catch (e) { /* fall through to localStorage */ }
    if (!raw) { try { raw = localStorage.getItem(CFG.SAVE_KEY); } catch (e) { raw = null; } }
    if (!raw) { try { raw = localStorage.getItem(CFG.SAVE_KEY + '_bak'); } catch (e) { raw = null; } }

    if (raw) {
      try { this.state = migrate(JSON.parse(raw)); }
      catch (e) { console.error('save corrupt, resetting', e); this.state = defaultState(); }
    } else this.state = defaultState();

    this.loaded = true;
    this.state.stats.sessions = (this.state.stats.sessions || 0) + 1;
    this.touch();
    this.startAutosave();
    events.emit('save:loaded', this.state);
    return this.state;
  }

  async save(silent = false) {
    this.state.lastSeen = Date.now();
    const raw = JSON.stringify(this.state);
    let ok = false;
    try { localStorage.setItem(CFG.SAVE_KEY, raw); ok = true; } catch (e) { console.warn('localStorage save failed', e); }
    if (ok) { try { localStorage.setItem(CFG.SAVE_KEY + '_bak', raw); } catch (e) {} }
    if (this._cap) { try { await this._cap.set({ key: CFG.SAVE_KEY, value: raw }); } catch (e) {} }
    this.dirty = false;
    if (!silent) events.emit('save:written');
    return ok;
  }

  startAutosave() {
    if (this._autosaveTimer) return;
    this._autosaveTimer = setInterval(() => { if (this.dirty) this.save(true); }, 20000);
  }

  markDirty() { this.dirty = true; }
  touch() { this.state.lastSeen = Date.now(); this.markDirty(); }

  reset() {
    this.state = defaultState();
    try { localStorage.removeItem(CFG.SAVE_KEY); localStorage.removeItem(CFG.SAVE_KEY + '_bak'); } catch (e) {}
    this.save(true);
    events.emit('save:reset');
  }

  export() { try { return btoa(unescape(encodeURIComponent(JSON.stringify(this.state)))); } catch (e) { return ''; } }
  import(str) {
    try {
      const obj = JSON.parse(decodeURIComponent(escape(atob(str.trim()))));
      this.state = migrate(obj); this.save(true); events.emit('save:loaded', this.state); return true;
    } catch (e) { return false; }
  }

  get s() { return this.state; }
}

export const Save = new SaveManager();
export const S = () => Save.state;

// ---------------------------------------------------------- resource helper ---
export function addResource(id, amount) {
  const s = S();
  const cap = RES.caps[id];
  if (cap) s.resources[id] = clamp((s.resources[id] || 0) + amount, 0, cap);
  else s.resources[id] = (s.resources[id] || 0) + amount;
  Save.markDirty();
  events.emit('resource:changed', { id, amount, total: s.resources[id] });
}
export function canAfford(cost) { const s = S(); for (const k in cost) if ((s.resources[k] || 0) < cost[k]) return false; return true; }
export function pay(cost) {
  const s = S();
  if (!canAfford(cost)) return false;
  for (const k in cost) s.resources[k] -= cost[k];
  Save.markDirty();
  events.emit('resource:changed', { bulk: true });
  return true;
}
export function costToCoins(cost) {
  const m = CFG.market.buy;
  let v = 0;
  for (const k in cost) v += cost[k] * (m[k] || 0);
  return Math.round(v);
}
export function lootToCoins(loot) {
  const m = CFG.market.sell;
  let v = 0;
  for (const k in loot) if (k !== 'coins') v += loot[k] * (m[k] || 0);
  return Math.round(v + (loot.coins || 0));
}

// ------------------------------------------------------------ daily rollover ---
export function checkDaily() {
  const s = S();
  const today = new Date().toISOString().slice(0, 10);
  if (s.progress.daily.date === today) return { newDay: false };
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  // login streak: continues when the previous visit was yesterday
  const streak = s.progress.daily.date === yesterday ? (s.progress.daily.loginStreak || 1) + 1 : 1;
  const prev = s.progress.daily;
  s.progress.daily = { date: today, contractSeed: (Date.now() % 99991) + 1000, done: false, trials: 0, loginStreak: streak };
  s.rewarded = { date: today, used: {} };
  // streak reward: coins grow with the streak, every 7th day adds a blueprint
  const reward = { coins: 100 + Math.min(6, streak - 1) * 25, blueprints: streak % 7 === 0 ? 1 : 0 };
  addResource('coins', reward.coins);
  if (reward.blueprints) addResource('blueprints', reward.blueprints);
  Save.markDirty();
  events.emit('daily:reset', { streak, reward });
  return { newDay: true, streak, reward, firstEver: !prev || !prev.date };
}

// -------------------------------------------------------- offline camp gains ---
export function applyOfflineGains() {
  const s = S();
  const now = Date.now();
  let gained = {};
  for (const key in s.camp.buildings) {
    const b = s.camp.buildings[key];
    const def = CFG.camp.buildings[key];
    if (!b.level) { b.lastTick = now; continue; }
    const hours = clamp((now - (b.lastTick || now)) / 3600000, 0, CFG.camp.offlineCapHours);
    if (hours <= 0.002) continue;
    const rate = def.base * Math.pow(def.growth, b.level - 1);
    const cap = def.cap * Math.pow(def.capGrowth, b.level - 1);
    const amount = rate * hours * CFG.camp.offlineEfficiency;
    b.stored = clamp((b.stored || 0) + amount, 0, cap);
    b.lastTick = now;
    gained[def.res] = (gained[def.res] || 0) + amount;
  }
  Save.markDirty();
  return gained;
}
