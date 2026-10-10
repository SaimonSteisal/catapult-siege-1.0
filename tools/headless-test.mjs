// ============================================================================
//  tools/headless-test.mjs — Node unit tests without DOM/WebGL (npm test)
// ============================================================================
import { makeRng, hashString, clamp } from '../src/core/utils.js';
import { sphereOBB, Physics } from '../src/systems/physics.js';
import { CFG } from '../src/config.js';
import { generateMission, campaignList } from '../src/systems/missions.js';
import { branchCost, computeMods } from '../src/systems/progression.js';
import { campRate, campCap } from '../src/systems/economy.js';
import * as THREE from 'three';

let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✔ ${name}`); }
  else { fail++; console.log(`  ✘ ${name} ${extra}`); }
};

console.log('— RNG determinism —');
{
  const a = makeRng(42), b = makeRng(42);
  const sa = Array.from({ length: 50 }, () => a());
  const sb = Array.from({ length: 50 }, () => b());
  ok('same seed → same sequence', sa.every((v, i) => v === sb[i]));
  ok('values in [0,1)', sa.every((v) => v >= 0 && v < 1));
  const g = makeRng(7);
  const gs = Array.from({ length: 4000 }, () => g.gauss());
  const mean = gs.reduce((x, y) => x + y, 0) / gs.length;
  ok('gauss mean ≈ 0', Math.abs(mean) < 0.06, `mean=${mean.toFixed(3)}`);
}

console.log('— hash —');
{
  ok('hash stable', hashString('CS1-1') === hashString('CS1-1'));
  ok('hash differs', hashString('CS1-1') !== hashString('CS1-2'));
}

console.log('— sphereOBB —');
{
  const box = { p: new THREE.Vector3(0, 1, 0), hs: new THREE.Vector3(1, 1, 1), q: new THREE.Quaternion() };
  const n = new THREE.Vector3();
  const hit = sphereOBB(new THREE.Vector3(0, 1, 1.5), 0.6, box, n);
  ok('front face hit', !!hit && Math.abs(hit.depth - 0.1) < 1e-6 && Math.abs(n.z - 1) < 1e-6);
  ok('miss outside', sphereOBB(new THREE.Vector3(5, 1, 0), 0.4, box, n) === null);
  const inside = sphereOBB(new THREE.Vector3(0, 1, 0), 0.5, box, n);
  ok('centre inside pushes out', !!inside && inside.depth > 0.5);
  const rot = { p: new THREE.Vector3(0, 0, 0), hs: new THREE.Vector3(2, 0.5, 0.5), q: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, Math.PI / 4, 0)) };
  // long axis of the rotated box points to (cos45,0,-sin45): probe just past its end cap
  ok('oriented box hit', !!sphereOBB(new THREE.Vector3(1.485, 0, -1.485), 0.3, rot, n));
  ok('oriented box miss on the short side', sphereOBB(new THREE.Vector3(1.4, 0, 1.4), 0.3, rot, n) === null);
}

console.log('— physics: prediction matches integration —');
{
  const phys = new Physics();
  phys.terrain = null; phys.structures = null;
  phys.setWind(35, 4);
  phys.updateWind(1.2);
  const from = new THREE.Vector3(0, 8, 0);
  const dir = new THREE.Vector3(0, Math.sin(0.7), Math.cos(0.7));
  const speed = 38;
  const pred = phys.predict(from, dir.clone().multiplyScalar(speed), { drag: 0.0038, windCoupling: 0.028 + 0.0038 * 3.2, points: 200, dt: 0.02, stopOnBlock: false });
  // manual integration with the same stepping
  const body = {
    pos: from.clone(), vel: dir.clone().multiplyScalar(speed), radius: 0.42, drag: 0.0038,
    restitution: 0.2, friction: 0.3, windAffected: true, windCoupling: 0.028 + 0.0038 * 3.2,
    gravityScale: 1, alive: true, spin: null, collidesBlocks: false, onHit: null,
  };
  const h = 0.02;
  for (let i = 0; i < 200; i++) phys.integrateBody(body, h);
  const last = pred[pred.length - 1];
  const d = last.distanceTo(body.pos);
  ok('predict ≈ integrate (200 steps)', d < 1.2, `d=${d.toFixed(2)}m`);
}

console.log('— missions determinism —');
{
  const a = generateMission(2, 3, { id: '2-4' });
  const b = generateMission(2, 3, { id: '2-4' });
  ok('same id → same seed', a.seed === b.seed);
  ok('same dist/scheme/kind', a.dist === b.dist && a.scheme === b.scheme && a.kind === b.kind);
  const c = generateMission(2, 4, { id: '2-5' });
  ok('different id → different seed', c.seed !== a.seed);
}

console.log('— tech costs & mods —');
{
  let mono = true;
  for (const br of Object.keys(CFG.tech.branches)) {
    let prev = 0;
    for (let l = 1; l <= CFG.tech.branches[br].levels; l++) {
      const cost = branchCost(br, l).coins;
      if (cost <= prev) mono = false;
      prev = cost;
    }
  }
  ok('branch costs strictly grow', mono);
  const m0 = computeMods({}, {});
  ok('base mods neutral', Math.abs(m0.power - 1) < 1e-9 && Math.abs(m0.spread - 1) < 1e-9);
  const mFull = computeMods({}, {});
  ok('mods within clamps', mFull.spread >= 0.15 && mFull.power <= 3 && mFull.wear >= 0.25);
}

console.log('— camp economy —');
{
  ok('quarry L1 rate', Math.abs(campRate('quarry', 1) - CFG.camp.buildings.quarry.base) < 1e-9);
  ok('growth compounds', campRate('quarry', 3) > campRate('quarry', 2) && campRate('quarry', 2) > campRate('quarry', 1));
  ok('cap grows slower than rate ratio', campCap('quarry', 4) / campCap('quarry', 1) < Math.pow(CFG.camp.buildings.quarry.growth, 3) * 4);
}

console.log('— mission economy thresholds —');
{
  const th = CFG.missions.rankThresholds;
  ok('S > A > B > C', th.S > th.A && th.A > th.B && th.B > th.C);
  const shot = CFG.missions.shotCostSupply;
  ok('shot affordable at start budget', CFG.missions.supplyBase >= shot * 6);
  const stone = CFG.ammo.stone;
  ok('stone shot value sane', stone.cost.stone * CFG.market.buy.stone < 12);
}

console.log('— ballistics reachability —');
{
  // max range must cover max mission distance at power 1 (vacuum estimate minus drag margin)
  const v = CFG.ballistics.v0Base * (0.55 + 0.78) ;
  const vacRange = (v * v) / CFG.physics.gravity;
  ok('vacuum range > max dist', vacRange > CFG.missions.distMax * 1.15, `vac=${vacRange.toFixed(0)}m`);
  const vmin = CFG.ballistics.v0Base * (0.55 + CFG.ballistics.powerMin * 0.78);
  ok('min-power range < max dist (skill matters)', (vmin * vmin) / CFG.physics.gravity < CFG.missions.distMax);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
