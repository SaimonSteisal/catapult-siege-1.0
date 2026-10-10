// ============================================================================
//  systems/progression.js — tech tree (48 nodes), synergies, ranks, trophies
// ============================================================================
import { CFG } from '../config.js';
import { clamp } from '../core/utils.js';
import { S, Save, pay, canAfford, addResource, events } from '../core/save.js';

const T = CFG.tech;

/** total tech nodes in the game = sum of branch levels + named nodes (48) */
export function allTechNodes() {
  const out = [];
  for (const br in T.branches) {
    const b = T.branches[br];
    for (let lvl = 1; lvl <= b.levels; lvl++) out.push({ branch: br, level: lvl, id: `${br}_${lvl}`, kind: 'level' });
  }
  for (const br in T.effects) {
    const named = T.effects[br].nodes || {};
    for (const lvl in named) out.push({ branch: br, level: +lvl, id: `${br}_n${named[lvl]}`, kind: 'named', name: named[lvl] });
  }
  return out;
}
export const TECH_NODE_COUNT = allTechNodes().length;

export function branchCost(branch, level) {
  const s = S();
  const base = T.costBase[branch];
  const coins = Math.round(base * Math.pow(level, 1.35));
  const blueprints = Math.floor(level / 3);
  const res = {};
  const extra = T.costRes[branch] || {};
  for (const k in extra) res[k] = Math.round(extra[k] * Math.pow(level, 1.22));
  return { coins, blueprints, ...res };
}

export function branchUnlocked(branch, level) {
  const s = S();
  if (level > T.branches[branch].levels) return false;
  const reqRank = T.rankRequiredPerLevel[level] || 0;
  if ((s.progress.rank || 0) < reqRank) return false;
  return (s.tech[branch] || 0) === level - 1;
}

export function buyBranch(branch) {
  const s = S();
  const level = (s.tech[branch] || 0) + 1;
  if (!branchUnlocked(branch, level)) return { ok: false, reason: 'locked' };
  const cost = branchCost(branch, level);
  if (!pay(cost)) return { ok: false, reason: 'cost', cost };
  s.tech[branch] = level;
  Save.markDirty();
  events.emit('tech:upgraded', { branch, level });
  return { ok: true, level, cost };
}

export function activeSynergies() {
  const s = S();
  const out = [];
  for (const syn of T.synergies) {
    let ok = true;
    for (const br in syn.req) if ((s.tech[br] || 0) < syn.req[br]) { ok = false; break; }
    if (ok) out.push(syn);
  }
  return out;
}
export function synergyById(id) { return T.synergies.find((s) => s.id === id); }

/**
 * Compute the aggregate modifier set from tech + synergies + crew + buffs.
 * Consumed by Trebuchet.setModifiers / Ballistics / Economy.
 */
export function computeMods(crewMods = {}, buffs = {}) {
  const s = S();
  const m = {
    power: 1, spread: 1, wear: 1, cockTime: 1, damage: 1, fatigue: 1, loot: 1,
    coins: 1, hp: 1, supply: 0, ammoDiscount: 0,
    flags: {},
  };
  const eff = T.effects;
  const lvl = (b) => s.tech[b] || 0;

  m.power += (eff.mechanics.perLevel.power || 0) * lvl('mechanics');
  m.spread += (eff.ballistics.perLevel.spread || 0) * lvl('ballistics');
  m.hp += (eff.durability.perLevel.hp || 0) * lvl('durability');
  m.wear += (eff.durability.perLevel.wear || 0) * lvl('durability');
  m.damage += (eff.ordnance.perLevel.damage || 0) * lvl('ordnance');
  m.fatigue += (eff.crew.perLevel.fatigue || 0) * lvl('crew');
  m.loot += (eff.crew.perLevel.loot || 0) * lvl('crew');

  // named nodes
  const named = {};
  for (const br in eff) for (const l in (eff[br].nodes || {})) { if (lvl(br) >= +l) named[eff[br].nodes[l]] = true; }
  m.flags = named;
  if (named.cockAuto) m.cockTime *= 0.85;
  if (named.doubleCock) m.power += 0.06;
  if (named.overdrive) m.power += 0.08;
  if (named.windComp) m.flags.windComp = true;
  if (named.scopeZoom) m.flags.scopeZoom = true;
  if (named.ricochetPredict) m.flags.ricochetPredict = true;
  if (named.ghostMaster) m.flags.ghostMaster = true;
  if (named.fastRepair) m.flags.fastRepair = true;
  if (named.autoRepair) m.flags.autoRepair = true;
  if (named.workshopDiscount) m.ammoDiscount = 0.15;
  if (named.slot3) m.crewSlots = Math.max(m.crewSlots || 0, 3);
  if (named.slot4) m.crewSlots = Math.max(m.crewSlots || 0, 4);
  if (named.veteran) m.flags.veteran = true;

  // crew passives
  m.spread *= (1 + (crewMods.spread || 0));
  m.cockTime *= (1 + (crewMods.cockTime || 0));
  m.wear *= (1 + (crewMods.wear || 0));
  m.coins *= (1 + (crewMods.coins || 0));
  m.fatigue *= (crewMods.fatigue || 1);

  // synergies
  const syn = activeSynergies();
  for (const x of syn) m.flags[x.id] = true;
  if (m.flags.iron_frame) { m.hp += 0.25; m.wear -= 0.10; }
  if (m.flags.greased_pivot) { m.spread -= 0.20; m.cockTime *= 0.75; }
  if (m.flags.pyromaniac) { m.flags.pyromaniac = true; }
  if (m.flags.quartermaster) { m.ammoDiscount = Math.max(m.ammoDiscount, 0.20); m.supply += 1; }
  if (m.flags.stone_rain) { m.flags.stoneRain = true; }
  if (m.flags.veteran_crew) { m.fatigue *= 0.5; }
  if (m.flags.wind_reader) { m.flags.windForecast = true; }
  if (m.flags.demolitionist) { m.flags.demolitionist = true; }
  if (m.flags.siege_doctor) { m.autoRepairCount = 2; }
  if (m.flags.grand_cannon) { m.power += 0.15; m.damage += 0.15; m.spread -= 0.15; m.flags.grandCannon = true; }
  if (m.flags.siege_sniper) { m.critBonus = 0.12; m.critMul = 1.25; }

  // temporary buffs (skills, ads)
  for (const k in buffs) m[k] = (m[k] || 0) + buffs[k];

  m.spread = clamp(m.spread, 0.15, 3);
  m.power = clamp(m.power, 0.35, 3);
  m.wear = clamp(m.wear, 0.25, 3);
  m.damage = clamp(m.damage, 0.4, 4);
  return m;
}

// -------------------------------------------------------------------- ranks ---
export function xpForLevel(lvl) { return CFG.ranks.xpPerLevel(lvl); }

export function addXp(amount) {
  const s = S();
  s.progress.xp += amount;
  let leveled = [];
  while (s.progress.xp >= xpForLevel(s.progress.level)) {
    s.progress.xp -= xpForLevel(s.progress.level);
    s.progress.level++;
    leveled.push(s.progress.level);
    if (s.progress.level > CFG.ranks.levelsPerRank) {
      s.progress.level = 1;
      s.progress.rank = clamp((s.progress.rank || 0) + 1, 0, CFG.ranks.list.length - 1);
      addResource('coins', CFG.ranks.rewardPerRankUp.coins);
      addResource('blueprints', CFG.ranks.rewardPerRankUp.blueprints);
      events.emit('rank:up', { rank: s.progress.rank });
    }
    addResource('coins', 60 + s.progress.rank * 30);
    events.emit('level:up', { level: s.progress.level, rank: s.progress.rank });
  }
  Save.markDirty();
  return leveled;
}

export function rankTitle() {
  const s = S();
  const lang = s.lang || 'ru';
  const list = lang === 'en' ? CFG.ranks.listEn : CFG.ranks.list;
  return `${list[clamp(s.progress.rank || 0, 0, list.length - 1)]} · ${s.progress.level}`;
}

// ------------------------------------------------------------------ trophies ---
const TROPHY_DEFS = [];
(function buildTrophies() {
  const types = Object.keys(CFG.targetTypes);
  let id = 0;
  for (const t of types) {
    for (let i = 0; i < 10; i++) TROPHY_DEFS.push({ id: `tr_${id++}`, type: t, tier: i + 1 });
  }
  // extra: rank / efficiency trophies to reach 96+
  for (let i = 0; i < 6; i++) TROPHY_DEFS.push({ id: `tr_${id++}`, type: 'rank', tier: i + 1 });
})();
export const TROPHIES = TROPHY_DEFS;

export function grantTrophy(type) {
  const s = S();
  const candidates = TROPHY_DEFS.filter((t) => t.type === type && !s.progress.trophies.includes(t.id));
  if (!candidates.length) return null;
  const t = candidates[0];
  s.progress.trophies.push(t.id);
  Save.markDirty();
  events.emit('trophy:granted', t);
  return t;
}

// ---------------------------------------------------------- ammo unlocks ---
export function unlockedAmmo() {
  const s = S();
  const rank = s.progress.rank || 0;
  const out = ['stone'];
  for (const id of CFG.ammoOrder) {
    const a = CFG.ammo[id];
    if (id === 'stone') continue;
    const named = `ammo_${id}`;
    if (a.unlock <= rank || (s.techNodes && s.techNodes[named]) || computeMods().flags[named]) out.push(id);
  }
  return Array.from(new Set(out));
}

export function ammoCost(ammoId, discount = 0) {
  const a = CFG.ammo[ammoId];
  const out = {};
  for (const k in a.cost) out[k] = Math.max(1, Math.round(a.cost[k] * (1 - discount)));
  return out;
}
