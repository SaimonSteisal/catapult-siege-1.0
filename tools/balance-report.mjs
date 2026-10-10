// ============================================================================
//  tools/balance-report.mjs — Monte-Carlo economy/balance simulator (npm run balance)
//  Analytic mission model (no WebGL): hit probability from CEP, loot tables from
//  config, ranks from efficiency thresholds. 2000 missions per chapter × skill tier.
// ============================================================================
import { CFG } from '../src/config.js';
import { makeRng, clamp } from '../src/core/utils.js';
import { generateMission } from '../src/systems/missions.js';
import { costToCoins, lootToCoins } from '../src/core/save.js';

const N = 2000;
const rng = makeRng(20261009);

// skill tiers: launch-cone sigma (deg) after assist & early tech
const TIERS = [
  { name: 'новичок',  sigma: 1.9, repairSkill: 0.25, targetRadius: 3.4, blocksPerHit: 8 },
  { name: 'средний',  sigma: 1.5, repairSkill: 0.55, targetRadius: 3.2, blocksPerHit: 16 },
  { name: 'ветеран',  sigma: 0.9, repairSkill: 0.85, targetRadius: 3.0, blocksPerHit: 22 },
];

const RANKS = ['S', 'A', 'B', 'C', 'D'];

const BLOCK_VALUE = 2.2;      // avg coin value of one destroyed block's loot (sell prices)
function targetBlocks(ch) { return 26 + ch * 5; }

function simulateMission(m, tier) {
  const ammo = CFG.ammo.stone;
  const shotCoins = costToCoins(ammo.cost) + CFG.missions.shotCostSupply * 0.9;
  const objectiveK = (m.objectives.find((o) => o.type === 'destroyTargets') || { count: 3 }).count;
  // progression curve: tech & crew soften sigma and grow cascade skill with chapters
  const sigma = tier.sigma * Math.max(0.75, 1 - 0.05 * (m.chapter - 1));
  const bph = tier.blocksPerHit + (m.chapter - 1) * 1.2;
  const cep = m.dist * Math.tan(sigma * Math.PI / 180) * 0.62;
  const r = tier.targetRadius;
  const pHit = clamp(1 - Math.exp(-(r * r) / (2 * cep * cep)), 0.05, 0.97);

  const blocks = targetBlocks(m.chapter);
  const hitsPerTarget = Math.max(1, Math.ceil(blocks * 0.75 / bph));   // target counts as rubble at 28% HP
  const lootPerTarget = blocks * BLOCK_VALUE * 0.85 + (30 + m.chapter * 10);

  let hits = 0, shots = 0, destroyed = 0, guard = 0;
  const shotLimit = m.shotLimit || Math.floor(m.supply / (CFG.missions.shotCostSupply * 0.9));
  while (destroyed < objectiveK && shots < shotLimit && guard++ < 400) {
    shots++;
    if (rng() < pHit) {
      hits++;
      if (hits >= hitsPerTarget) { hits = 0; destroyed++; }
    }
  }
  const complete = destroyed >= objectiveK;
  let gained = lootPerTarget * destroyed * (m.mod.loot || 1);
  if (!complete) gained = gained * 0.5 + lootPerTarget * 0.25 * destroyed;   // salvage
  gained *= (m.mod.reward || 1);

  const repairs = rng() < tier.repairSkill * 0.45 ? 1 : 0;
  const spent = shots * shotCoins + repairs * (CFG.missions.repairCostSupply * 1.5 * 0.9 + 8);
  tier._lastRepairs = repairs;

  const eff = gained / Math.max(1, spent);
  const accuracy = shots ? (hits + destroyed * 0) / shots : 0;   // hit shots / shots
  const hitShots = Math.min(shots, Math.round(shots * pHit));
  const acc = shots ? hitShots / shots : 0;
  let rank = 'D';
  for (const rk of ['S', 'A', 'B', 'C']) if (eff >= CFG.missions.rankThresholds[rk]) { rank = rk; break; }
  if (rank === 'S' && (acc < 0.7 || repairs > 0)) rank = 'A';   // mastery gates
  if (!complete && rank !== 'D') rank = eff >= CFG.missions.rankThresholds.C ? 'C' : 'D';
  void accuracy;
  return { shots, complete, eff, rank, spent, gained, pHit, cep, shotLimit, repairs };
}

console.log('CATAPULT SIEGE — balance report (N=' + N + ' missions per cell)\n');
console.log('глава | tier    | pHit  | выстрелов | проход | КПД ср | S%  A%  B%  C%  D% | снабж./миссия');
console.log('------+---------+-------+-----------+--------+--------+--------------------+--------------');

let warnings = 0;
for (let ch = 1; ch <= CFG.missions.chapters; ch++) {
  for (const tier of TIERS) {
    const stats = { shots: 0, complete: 0, eff: 0, ranks: { S: 0, A: 0, B: 0, C: 0, D: 0 }, supply: 0 };
    for (let i = 0; i < N; i++) {
      const idx = rng.int(0, CFG.missions.perChapter - 2);   // skip boss for the mass stats
      const m = generateMission(ch, idx, { id: `${ch}-${idx + 1}` });
      const res = simulateMission(m, tier);
      stats.shots += res.shots; stats.complete += res.complete ? 1 : 0; stats.eff += res.eff;
      stats.ranks[res.rank]++;
      stats.supply += res.shots * CFG.missions.shotCostSupply;
    }
    const pct = (x) => ((x / N) * 100).toFixed(0).padStart(3);
    const line =
      `  ${ch}   | ${tier.name.padEnd(7)} | ${pHitAvg(ch, tier).toFixed(2)} | ${(stats.shots / N).toFixed(1).padStart(9)} | ${pct(stats.complete)}% | ${(stats.eff / N).toFixed(2).padStart(6)} | ${pct(stats.ranks.S)} ${pct(stats.ranks.A)} ${pct(stats.ranks.B)} ${pct(stats.ranks.C)} ${pct(stats.ranks.D)} | ${((stats.supply / N) / (CFG.missions.supplyBase + (ch - 1) * CFG.missions.supplyPerChapter) * 100).toFixed(0)}%`;
    console.log(line);

    const passRate = stats.complete / N;
    const avgEff = stats.eff / N;
    if (ch === 1 && tier.name === 'новичок' && passRate < 0.85) { console.log(`   ⚠ WARN: ch1 novice pass ${ (passRate*100).toFixed(0) }% < 85%`); warnings++; }
    if (ch === 5 && tier.name === 'ветеран' && passRate < 0.30) { console.log(`   ⚠ WARN: ch5 veteran pass ${(passRate*100).toFixed(0)}% < 30%`); warnings++; }
    if (avgEff > 13.0) { console.log(`   ⚠ WARN: efficiency ${avgEff.toFixed(2)} too high (farm risk)`); warnings++; }
    if (avgEff < 1.1 && tier.name === 'ветеран') { console.log(`   ⚠ WARN: veteran efficiency ${avgEff.toFixed(2)} too low (frustration risk)`); warnings++; }
    if ((tier.name !== 'ветеран') && stats.ranks.S / N > 0.20) { console.log(`   ⚠ WARN: ${tier.name} S-rate ${(stats.ranks.S / N * 100).toFixed(0)}% > 20%`); warnings++; }
  }
}

function pHitAvg(ch, tier) {
  const dist = (CFG.missions.distMin + CFG.missions.distMax) / 2 + ch * 2.5;
  const cep = dist * Math.tan(tier.sigma * Math.PI / 180) * 0.62;
  const r = tier.targetRadius;
  return clamp(1 - Math.exp(-(r * r) / (2 * cep * cep)), 0.05, 0.97);
}

console.log('\nпороги рангов КПД:', JSON.stringify(CFG.missions.rankThresholds));
console.log('стоимость выстрела (камень):', costToCoins(CFG.ammo.stone.cost), 'монет +', CFG.missions.shotCostSupply, 'снабжения');
console.log(warnings ? `\n${warnings} warnings — tune config.js` : '\nбаланс в коридорах ✔');
process.exit(0);
