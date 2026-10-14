// ============================================================================
//  systems/crew.js — roster, skills, fatigue, levelling (§4.5)
// ============================================================================
import { CFG } from '../config.js';
import { clamp, makeRng } from '../core/utils.js';
import { S, Save, pay, addResource, events } from '../core/save.js';

const C = CFG.crew;
const NAMES = {
  ru: ['Тихон','Грум','Бальдр','Одо','Мило','Радко','Вук','Степан','Яр','Гост','Любим','Драг','Оуэн','Каспар','Хильда','Бран','Избор','Фрол'],
  en: ['Tikhon','Grum','Baldr','Odo','Milo','Radko','Vuk','Stefan','Yar','Gost','Lyubim','Drag','Owen','Kaspar','Hilda','Bran','Izbor','Frol'],
};

export function roleDef(role) { return C.roles[role]; }
export function roleName(role, lang = 'ru') { const d = C.roles[role]; return lang === 'en' ? d.en : d.ru; }
export function skillName(role, lang = 'ru') { const d = C.roles[role]; return lang === 'en' ? d.skill.id : d.skill.ru; }

export function roster() { return S().crew.roster; }
export function activeCrew() {
  const s = S();
  return s.crew.active.map((id) => s.crew.roster.find((c) => c.id === id)).filter(Boolean);
}
export function maxSlots() {
  const s = S();
  const fromTech = s.tech.crew >= 6 ? 4 : s.tech.crew >= 3 ? 3 : C.slotsStart;
  return Math.max(C.slotsStart, Math.min(C.slotsMax, fromTech));
}

export function hire(role) {
  const s = S();
  if (s.crew.roster.length >= 8) return { ok: false, reason: 'full' };
  const idx = s.crew.roster.length;
  const cost = C.hireCost[clamp(idx, 1, 4)] || 1500;
  if (!pay({ coins: cost })) return { ok: false, reason: 'cost', cost };
  const lang = s.lang || 'ru';
  const pool = NAMES[lang] || NAMES.ru;
  const used = s.crew.roster.map((c) => c.name);
  const name = pool.find((n) => !used.includes(n)) || `${pool[0]} ${idx + 1}`;
  const c = { id: 'c' + (Date.now() % 100000) + idx, role, name, level: 1, xp: 0, fatigue: 0 };
  s.crew.roster.push(c);
  if (s.crew.active.length < maxSlots()) s.crew.active.push(c.id);
  Save.markDirty();
  events.emit('crew:hired', c);
  return { ok: true, crew: c, cost };
}

export function setActive(ids) {
  const s = S();
  const limit = maxSlots();
  s.crew.active = ids.slice(0, limit);
  Save.markDirty();
  events.emit('crew:active', s.crew.active);
}

export function toggleActive(id) {
  const s = S();
  const i = s.crew.active.indexOf(id);
  if (i >= 0) s.crew.active.splice(i, 1);
  else if (s.crew.active.length < maxSlots()) s.crew.active.push(id);
  else return { ok: false, reason: 'slots' };
  Save.markDirty();
  return { ok: true };
}

export function xpForLevel(lvl) { return C.levelXp[clamp(lvl, 0, C.levelXp.length - 1)] || 1e9; }

export function addCrewXp(id, amount) {
  const s = S();
  const c = s.crew.roster.find((x) => x.id === id);
  if (!c) return null;
  c.xp += amount;
  let leveled = false;
  while (c.level < C.levelXp.length && c.xp >= xpForLevel(c.level)) {
    c.xp -= xpForLevel(c.level);
    c.level++;
    leveled = true;
  }
  Save.markDirty();
  return { level: c.level, leveled };
}

export function levelUpCost(level) { return C.levelCost[clamp(level, 0, C.levelCost.length - 1)] || 99999; }
/** price to go from `level` to `level+1` (levelCost is indexed by TARGET level) */
export function trainCost(level) { return C.levelCost[clamp(level + 1, 0, C.levelCost.length - 1)] || 99999; }

export function trainCrew(id) {
  const s = S();
  const c = s.crew.roster.find((x) => x.id === id);
  if (!c) return { ok: false };
  if (c.level >= C.levelXp.length - 1) return { ok: false, reason: 'max' };
  const cost = trainCost(c.level);
  if (!pay({ coins: cost })) return { ok: false, reason: 'cost', cost };
  c.xp = xpForLevel(c.level);
  const r = addCrewXp(id, 0);
  Save.markDirty();
  return { ok: true, level: c.level, cost };
}

export function restCrew(id) {
  const s = S();
  const c = s.crew.roster.find((x) => x.id === id);
  if (!c) return;
  c.fatigue = 0;
  Save.markDirty();
}
export function restAll() { roster().forEach((c) => { c.fatigue = 0; }); Save.markDirty(); }

export function feedCrew(id) {
  const s = S();
  const c = s.crew.roster.find((x) => x.id === id);
  if (!c) return { ok: false };
  if (!pay({ coins: 40, wood: 2 })) return { ok: false, reason: 'cost' };
  c.fatigue = clamp(c.fatigue - 45, 0, 100);
  Save.markDirty();
  return { ok: true, fatigue: c.fatigue };
}

/** aggregate passive modifiers from the active crew */
export function crewMods() {
  const out = { spread: 0, cockTime: 0, wear: 0, coins: 0, fatigue: 1 };
  for (const c of activeCrew()) {
    const p = roleDef(c.role).passive;
    const lvlMul = 1 + (c.level - 1) * 0.35;
    if (p.spread) out.spread += p.spread * lvlMul;
    if (p.cockTime) out.cockTime += p.cockTime * lvlMul;
    if (p.wear) out.wear += p.wear * lvlMul;
    if (p.coins) out.coins += p.coins * lvlMul;
    if (c.fatigue >= C.fatigueSkillLock) out.fatigue *= CFG.crew.fatigueSpreadMulAt100;
  }
  out.spread = clamp(out.spread, -0.75, 0.5);
  out.cockTime = clamp(out.cockTime, -0.7, 0.3);
  out.wear = clamp(out.wear, -0.7, 0.5);
  return out;
}

export function addFatigue(amount) {
  const s = S();
  for (const c of activeCrew()) c.fatigue = clamp(c.fatigue + amount, 0, 100);
  Save.markDirty();
}

// ------------------------------------------------------------------- skills ---
export class SkillDirector {
  constructor(game) {
    this.game = game;
    this.cool = {};        // crewId -> remaining seconds
    this.buffs = {};       // active temporary buffs
    this.rng = makeRng(99);
    this.usedThisMission = {};
  }
  reset() { this.cool = {}; this.buffs = {}; this.usedThisMission = {}; }

  available(crewman) {
    const d = roleDef(crewman.role);
    if ((this.cool[crewman.id] || 0) > 0) return { ok: false, reason: 'cooldown', left: this.cool[crewman.id] };
    if (crewman.fatigue >= C.fatigueSkillLock) return { ok: false, reason: 'fatigue' };
    return { ok: true, skill: d.skill };
  }

  use(crewman) {
    const chk = this.available(crewman);
    if (!chk.ok) return chk;
    const d = roleDef(crewman.role);
    const skill = d.skill;
    this.cool[crewman.id] = skill.cd;
    crewman.fatigue = clamp(crewman.fatigue + 18, 0, 100);
    Save.markDirty();

    switch (skill.id) {
      case 'measure':
        this.buffs.precise = { t: 8 };
        this.game.onSkill && this.game.onSkill('measure', crewman);
        break;
      case 'overload':
        this.buffs.overload = { t: 20, power: 0.25, wear: 0.6 };
        this.game.onSkill && this.game.onSkill('overload', crewman);
        break;
      case 'fieldfix': {
        const tb = this.game.trebuchet;
        if (tb) {
          const worst = tb.worstNode();
          const healed = tb.repairNode(worst, tb.nodes[worst].max * 0.35);
          this.game.onSkill && this.game.onSkill('fieldfix', crewman, { node: worst, healed });
        }
        break;
      }
      case 'warcry':
        this.buffs.warcry = { t: 25, damage: 1.0, loot: -0.10 };
        this.game.onSkill && this.game.onSkill('warcry', crewman);
        break;
    }
    events.emit('crew:skill', { crewman, skill });
    return { ok: true, skill };
  }

  update(dt) {
    for (const id in this.cool) this.cool[id] = Math.max(0, this.cool[id] - dt);
    for (const k in this.buffs) {
      const b = this.buffs[k];
      if (b.t !== undefined) { b.t -= dt; if (b.t <= 0) delete this.buffs[k]; }
    }
  }

  /** aggregate temporary modifiers from active buffs */
  buffMods() {
    const out = {};
    for (const k in this.buffs) {
      const b = this.buffs[k];
      for (const key of ['power', 'wear', 'damage', 'loot', 'spread']) if (b[key]) out[key] = (out[key] || 0) + b[key];
    }
    return out;
  }
  has(id) { return !!this.buffs[id]; }
}
