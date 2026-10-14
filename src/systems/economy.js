// ============================================================================
//  systems/economy.js — supply budget, shot costs, loot, efficiency report,
//  market, camp idle production (§4.6)
// ============================================================================
import { CFG } from '../config.js';
import { clamp, lerp } from '../core/utils.js';
import { S, Save, addResource, canAfford, pay, costToCoins, lootToCoins, events } from '../core/save.js';

const M = CFG.missions;

export class Economy {
  constructor() {
    this.reset();
  }

  /** begin a sortie with a supply budget derived from the mission.
   *  `supplyOverride` is the effective budget computed by the game (mission
   *  supply + tech/synergy bonuses). It MUST match what the briefing showed —
   *  recalculating from the chapter base here ignored ECONOMY/trial/training
   *  adjustments and mods (training promised 1350 but only granted 150). */
  beginMission(mission, supplyOverride = null) {
    this.mission = mission;
    this.budget = supplyOverride != null
      ? supplyOverride
      : (mission.supply != null ? mission.supply : M.supplyBase);
    this.spentSupply = 0;
    this.survivedSeconds = 0;    // read by the 'survive' objective (DEFEND)
    this.spentValue = 0;
    this.gainedValue = 0;
    this.loot = {};
    this.coinsGained = 0;
    this.shots = 0;
    this.hits = 0;
    this.blocksDestroyed = 0;
    this.targetsDestroyed = 0;
    this.civilianDestroyed = 0;
    this.repairs = 0;
    this.repairValue = 0;
    this.perfectShots = 0;
    this.wearAccumulated = 0;
    this.nodeDamageTaken = 0;
    this.log = [];
    this.broken = false;
  }

  reset() {
    this.budget = 0; this.spentSupply = 0; this.spentValue = 0; this.gainedValue = 0;
    this.survivedSeconds = 0;
    this.loot = {}; this.coinsGained = 0; this.shots = 0; this.hits = 0;
    this.blocksDestroyed = 0; this.targetsDestroyed = 0; this.civilianDestroyed = 0;
    this.repairs = 0; this.repairValue = 0; this.perfectShots = 0; this.wearAccumulated = 0;
    this.nodeDamageTaken = 0; this.log = []; this.broken = false;
  }

  get supplyLeft() { return Math.max(0, this.budget - this.spentSupply); }
  get canShoot() { return this.supplyLeft >= M.shotCostSupply; }
  get canRepair() { return this.supplyLeft >= M.repairCostSupply; }

  /** cost of one shot in supply points + coin-equivalent */
  spendShot(ammoDef, inBattle = true) {
    const supply = M.shotCostSupply * (ammoDef.wear || 1) * 0.85;
    this.spentSupply += supply;
    const value = costToCoins(ammoDef.cost || {}) + supply * 0.9;
    this.spentValue += value;
    this.shots++;
    this.log.push({ t: 'shot', ammo: ammoDef.id, supply: +supply.toFixed(1), value: +value.toFixed(1) });
    if (this.spentSupply > this.budget) this.broken = true;
    return { supply, value };
  }

  spendRepair(nodeId, inBattle) {
    const mul = inBattle ? CFG.market.repairCostMulInBattle : 1;
    const cost = CFG.market.repairCost[nodeId] || { wood: 1 };
    const scaled = {};
    for (const k in cost) scaled[k] = Math.max(1, Math.round(cost[k] * mul));
    const supply = M.repairCostSupply * mul;
    this.spentSupply += supply;
    this.spentValue += costToCoins(scaled) + supply * 0.9;
    this.repairs++;
    this.repairValue += costToCoins(scaled);
    this.log.push({ t: 'repair', node: nodeId, supply: +supply.toFixed(1) });
    return { cost: scaled, supply };
  }

  recordHit(isHit, isPerfect) {
    if (isHit) this.hits++;
    if (isPerfect) this.perfectShots++;
  }

  /** collect loot produced by destroyed blocks (from Structures.lootPool) */
  collectLoot(pool, mods = {}) {
    const lootMul = (mods.loot || 1) * (this.mission && this.mission.mod ? (this.mission.mod.loot || 1) : 1);
    for (const k in pool) {
      const v = Math.max(0, Math.round(pool[k] * lootMul));
      if (!v) continue;
      this.loot[k] = (this.loot[k] || 0) + v;
    }
    return this.loot;
  }

  addBounty(amount) {
    this.coinsGained += amount;
    this.loot.coins = (this.loot.coins || 0) + amount;
  }

  penalise(amount, reason) {
    this.coinsGained -= amount;
    this.loot.coins = (this.loot.coins || 0) - amount;
    this.log.push({ t: 'penalty', amount, reason });
  }

  // ------------------------------------------------------------------ report ---
  finish(structures, mods = {}) {
    this.collectLoot(structures.lootPool, mods);
    this.targetsDestroyed = structures.targets.filter((t) => t.destroyed && t.priority > 0).length;
    this.blocksDestroyed = structures.destroyedCount;
    this.civilianDestroyed = structures.civilianDestroyed;

    // bounties for destroyed targets
    let bounty = 0;
    for (const t of structures.targets) {
      if (t.destroyed) bounty += t.bounty;
    }
    if (bounty > 0) this.addBounty(Math.round(bounty * (this.mission && this.mission.mod ? (this.mission.mod.reward || 1) : 1)));
    if (this.civilianDestroyed > 0) this.penalise(this.civilianDestroyed * CFG.blocks.civilianPenaltyCoins, 'civilians');

    // coin value of gathered resources (loot.coins already holds the bounties)
    const resourceValue = lootToCoins({ ...this.loot, coins: 0 });
    this.gainedValue = resourceValue + Math.max(0, this.coinsGained);

    const spent = Math.max(1, this.spentValue);
    const efficiency = this.gainedValue / spent;
    const accuracy = this.shots ? this.hits / this.shots : 0;

    let rank = 'D';
    for (const r of ['S', 'A', 'B', 'C']) { if (efficiency >= M.rankThresholds[r]) { rank = r; break; } }
    // S is a mastery rank: efficiency alone is not enough
    const gates = M.rankSGates || {};
    if (rank === 'S') {
      if ((gates.accuracy || 0) > 0 && accuracy < gates.accuracy) rank = 'A';
      else if (gates.noCivilians && this.civilianDestroyed > 0) rank = 'A';
      else if (gates.noFrameLoss && this.nodeDamageTaken > 60) rank = 'A';
    }
    // hard requirements: must complete the objective for anything above C
    const objectiveDone = this.mission ? this.mission.checkComplete(this, structures) : true;
    if (!objectiveDone) rank = efficiency >= M.rankThresholds.C ? 'C' : 'D';
    if (this.broken && rank !== 'D') rank = 'D';
    if (rank === 'S' && mods && mods.grandCannon) { /* multiplier handled in payout */ }

    const rewardMul = M.rankRewardMul[rank] * (rank === 'S' && mods.grandCannon ? 1.15 : 1);

    return {
      rank, efficiency, accuracy, objectiveDone,
      spentValue: Math.round(spent), gainedValue: Math.round(this.gainedValue),
      rewardMul,
      loot: this.loot,
      coins: Math.round(Math.max(0, this.loot.coins || 0) * rewardMul),
      shots: this.shots, hits: this.hits,
      supplyUsed: Math.round(this.spentSupply), supplyTotal: this.budget,
      targetsDestroyed: this.targetsDestroyed,
      blocksDestroyed: this.blocksDestroyed,
      civilianDestroyed: this.civilianDestroyed,
      perfectShots: this.perfectShots,
      repairs: this.repairs,
      broken: this.broken,
      xp: this._xp(rank, objectiveDone),
    };
  }

  _xp(rank, objectiveDone) {
    const base = (M.xpBase + (this.mission ? (this.mission.chapter - 1) * M.xpPerChapter : 0));
    const rankBonus = { S: 1.6, A: 1.25, B: 1.0, C: 0.7, D: 0.45 }[rank] || 0.5;
    let xp = Math.round(base * rankBonus * (objectiveDone ? 1 : 0.5));
    xp += this.perfectShots * 22;
    xp += Math.round(this.accuracyFor(this.hits, this.shots) * 60);
    if (this.civilianDestroyed) xp = Math.round(xp * 0.7);
    return xp;
  }
  accuracyFor(h, s) { return s ? h / s : 0; }

  /** actually grant the rewards to the persistent save */
  payout(report, mods = {}) {
    const s = S();
    // loot was ALREADY multiplied by mods.loot in collectLoot()/finish() —
    // multiplying again here double-dipped the crew-branch bonus
    for (const k in report.loot) {
      if (k === 'coins') continue;
      addResource(k, Math.round(report.loot[k]));
    }
    addResource('coins', report.coins);
    s.stats.coinsEarned += report.coins;
    s.stats.blocksDestroyed += report.blocksDestroyed;
    s.stats.perfectShots += report.perfectShots;
    s.stats.civiliansHit += report.civilianDestroyed;
    s.progress.shotsFired += report.shots;
    s.progress.shotsHit += report.hits;
    s.progress.bestEfficiency = Math.max(s.progress.bestEfficiency || 0, report.efficiency);
    s.progress.missionsDone = (s.progress.missionsDone || 0) + 1;
    Save.markDirty();
    events.emit('economy:payout', report);
    return report;
  }
}

// ------------------------------------------------------------------ market ---
export function buyResource(id, units = CFG.market.bundle) {
  const price = Math.ceil((CFG.market.buy[id] || 0) * units);
  if (!price) return { ok: false, reason: 'unavailable' };
  if (!pay({ coins: price })) return { ok: false, reason: 'no_coins' };
  addResource(id, units);
  return { ok: true, price, units };
}
export function sellResource(id, units = CFG.market.bundle) {
  const s = S();
  const have = s.resources[id] || 0;
  if (have < units) return { ok: false, reason: 'no_resource' };
  const gain = Math.floor((CFG.market.sell[id] || 0) * units);
  addResource(id, -units);
  addResource('coins', gain);
  return { ok: true, gain, units };
}

// -------------------------------------------------------------------- camp ---
export function campRate(buildingKey, level) {
  const d = CFG.camp.buildings[buildingKey];
  if (!d || !level) return 0;
  return d.base * Math.pow(d.growth, level - 1);
}
export function campCap(buildingKey, level) {
  const d = CFG.camp.buildings[buildingKey];
  if (!d || !level) return 0;
  return d.cap * Math.pow(d.capGrowth, level - 1);
}
export function campUpgradeCost(buildingKey, level) {
  const d = CFG.camp.buildings[buildingKey];
  const out = {};
  for (const k in d.cost) out[k] = Math.round(d.cost[k] * Math.pow(d.costGrowth, level));
  return out;
}
export function tickCamp(dtRealSeconds) {
  const s = S();
  let produced = {};
  for (const key in s.camp.buildings) {
    const b = s.camp.buildings[key];
    if (!b.level) continue;
    const def = CFG.camp.buildings[key];
    const rate = campRate(key, b.level);
    const cap = campCap(key, b.level);
    const add = rate * (dtRealSeconds / 3600);
    b.stored = clamp((b.stored || 0) + add, 0, cap);
    if (add > 0) produced[def.res] = (produced[def.res] || 0) + add;
  }
  Save.markDirty();
  return produced;
}
export function collectBuilding(key) {
  const s = S();
  const b = s.camp.buildings[key];
  if (!b || !b.level) return 0;
  const def = CFG.camp.buildings[key];
  const amount = Math.floor(b.stored || 0);
  if (amount <= 0) return 0;
  b.stored = (b.stored || 0) - amount;
  addResource(def.res, amount);
  Save.markDirty();
  return amount;
}
export function collectAll() {
  const s = S();
  let total = 0;
  for (const key in s.camp.buildings) total += collectBuilding(key);
  return total;
}
export function upgradeBuilding(key) {
  const s = S();
  const b = s.camp.buildings[key];
  const cost = campUpgradeCost(key, b.level);
  if (!pay(cost)) return { ok: false, cost };
  b.level++;
  b.lastTick = Date.now();
  Save.markDirty();
  events.emit('camp:upgraded', { key, level: b.level });
  return { ok: true, level: b.level, cost };
}
