// ============================================================================
//  systems/missions.js — campaign generation, objectives, modifiers, seeds
// ============================================================================
import { CFG } from '../config.js';
import { clamp, makeRng, hashString } from '../core/utils.js';
import { S, Save } from '../core/save.js';
import { FortBuilder } from './fort.js';

const MC = CFG.missions;

const BIOMES = {
  1: ['meadow', 'meadow', 'autumn'],
  2: ['river', 'desert', 'river'],
  3: ['mountain', 'autumn', 'river'],
  4: ['winter', 'winter', 'mountain'],
  5: ['volcano', 'winter', 'coast'],
};

const SCHEME_BY_CHAPTER = {
  1: ['linear_wall', 'village_outpost', 'courtyard', 'twin_towers'],
  2: ['riverside_fort', 'courtyard', 'gatehouse', 'hilltop_redoubt', 'linear_wall'],
  3: ['gatehouse', 'star_fort', 'barbican', 'keep', 'twin_towers'],
  4: ['winter_stockade', 'hilltop_redoubt', 'star_fort', 'barbican', 'keep'],
  5: ['grand_citadel', 'barbican', 'keep', 'star_fort', 'grand_citadel'],
};

const CHAPTER_NAMES = ['Предместья', 'Речной форт', 'Каменный рубеж', 'Зимняя осада', 'Цитадель'];
const CHAPTER_NAMES_EN = ['Outskirts', 'River Fort', 'Stone Line', 'Winter Siege', 'Citadel'];

export function chapterName(ch, lang = 'ru') {
  return (lang === 'en' ? CHAPTER_NAMES_EN : CHAPTER_NAMES)[clamp(ch - 1, 0, 4)];
}

function pickKind(rng, chapter, index) {
  if (index === MC.perChapter - 1 && chapter >= 3) return 'BOSS';
  if (index === 0 && chapter === 1) return 'DEMOLISH';
  const pool = [];
  MC.kinds.forEach((k, i) => {
    let w = MC.kindWeights[i];
    if (k === 'BOSS') w = 0;
    if (k === 'DEFEND' && chapter < 2) w = 0;
    if (k === 'ECONOMY' && chapter < 1) w = 0;
    if (k === 'SNIPER' && index < 2) w = Math.max(0, w - 1);
    for (let n = 0; n < w; n++) pool.push(k);
  });
  return rng.pick(pool);
}

export function generateMission(chapter, index, opts = {}) {
  const id = opts.id || `${chapter}-${index + 1}`;
  const seed = opts.seed || hashString('CS' + id);
  const rng = makeRng(seed);
  const biome = opts.biome || rng.pick(BIOMES[clamp(chapter, 1, 5)]);
  const schemes = SCHEME_BY_CHAPTER[clamp(chapter, 1, 5)];
  const scheme = opts.scheme || rng.pick(schemes);
  const kind = opts.kind || pickKind(rng, chapter, index);
  const mod = opts.mod || rng.pick(MC.modifiers);

  const dist = Math.round(rng.range(MC.distMin, MC.distMax) + chapter * 2.5);
  const hpMul = clamp(1 + (chapter - 1) * 0.12 + (mod.hp ? mod.hp - 1 : 0), 1, 2.2);

  const supply = Math.round((MC.supplyBase + (chapter - 1) * MC.supplyPerChapter) * (mod.supply || 1) * (opts.supplyMul || 1));

  const m = {
    id, chapter, index, seed, biome, scheme, kind, mod, dist, hpMul, supply,
    isBoss: kind === 'BOSS',
    isDaily: !!opts.daily,
    isTrial: !!opts.trial,
    title: missionTitle(kind, chapter, index, rng),
    objectives: [],
    shotLimit: null,
    timeLimit: null,
    rewardPreview: previewReward(chapter, kind, mod),
    windPreview: Math.round((mod.wind || 0) * MC.windMax[clamp(chapter, 1, 5) - 1] * (0.55 + rng() * 0.75)),
    hpMulPreview: hpMul,
    garrison: clamp(Math.round(2 + chapter * 1.7 + rng.int(0, 3)), 2, 22),
    engines: clamp(Math.round(chapter * 0.7 + rng.int(0, 1)), 0, 4),
  };

  // ---- objectives per kind
  switch (kind) {
    case 'DEMOLISH':
      m.objectives.push({ type: 'destroyTargets', count: clamp(1 + Math.ceil(chapter * 0.6), 2, 4), of: 'hostile' });
      break;
    case 'SNIPER':
      m.objectives.push({ type: 'destroyTargetType', target: rng.chance(0.5) ? 'commander' : 'banner', count: 1 });
      m.shotLimit = clamp(4 + chapter, 3, 9);
      break;
    case 'SIEGE':
      m.objectives.push({ type: 'destroyTargets', count: clamp(1 + Math.ceil(chapter * 0.5), 2, 3), ofType: 'wall' });
      m.objectives.push({ type: 'breach', count: 1 });
      break;
    case 'SABOTAGE':
      m.engines = clamp(m.engines + 1, 2, 4);
      m.objectives.push({ type: 'destroyTargets', count: m.engines, ofType: 'engine' });
      m.objectives.push({ type: 'noCivilian' });
      break;
    case 'DEFEND':
      m.timeLimit = clamp(70 + chapter * 14, 70, 150);
      m.objectives.push({ type: 'survive', seconds: m.timeLimit });
      m.objectives.push({ type: 'destroyTargets', count: clamp(1 + Math.ceil(chapter * 0.5), 2, 4), of: 'hostile' });
      break;
    case 'ECONOMY':
      m.supply = Math.round(m.supply * 0.72);
      m.objectives.push({ type: 'destroyTargets', count: clamp(1 + Math.ceil(chapter * 0.5), 2, 3), of: 'hostile' });
      m.objectives.push({ type: 'minEfficiency', value: 1.6 });
      break;
    case 'BOSS':
      m.objectives.push({ type: 'destroyTargets', count: 3, of: 'hostile' });
      m.objectives.push({ type: 'destroyTargetType', target: 'tower', count: 2 });
      m.objectives.push({ type: 'destroyTargetType', target: 'commander', count: 1 });
      m.hpMul *= 1.18;
      break;
  }

  m.checkComplete = (eco, structures) => checkObjectives(m, eco, structures);
  m.describe = () => describeObjectives(m);
  return m;
}

export function missionTitle(kind, chapter, index, rng) {
  const ru = {
    DEMOLISH: ['Снос предместья', 'Разбор укреплений', 'Каменная пыль', 'Обвал', 'Гром над стеной'],
    SNIPER: ['Точный расчёт', 'Один выстрел', 'Снять знамя', 'Командир под прицелом', 'Ювелирная работа'],
    SIEGE: ['Проломить брешь', 'Осадный пролом', 'Дыра в стене', 'Штурмовой проход', 'Таранный удар'],
    SABOTAGE: ['Тихая порча', 'Обезвредить орудия', 'Без шума и пыли', 'Диверсия', 'Слепой гарнизон'],
    DEFEND: ['Держать позицию', 'Осада наоборот', 'Волна за волной', 'Не пройти', 'Последний рубеж'],
    ECONOMY: ['Бюджет впритык', 'Экономный расчёт', 'Каждый камень на счету', 'Скупой заказчик', 'Минимум затрат'],
    BOSS: ['Цитадель', 'Падение твердыни', 'Финальный штурм', 'Крепость не устоит', 'Осадный марш'],
  };
  const pool = ru[kind] || ru.DEMOLISH;
  return pool[(index + chapter) % pool.length];
}

export function checkObjectives(m, eco, structures) {
  for (const o of m.objectives) {
    switch (o.type) {
      case 'destroyTargets': {
        const list = structures.targets.filter((t) => t.destroyed && (o.of === 'hostile' ? t.priority > 0 : true) && (!o.ofType || t.type === o.ofType));
        if (list.length < o.count) return false;
        break;
      }
      case 'destroyTargetType': {
        const list = structures.targets.filter((t) => t.destroyed && t.type === o.target);
        if (list.length < o.count) return false;
        break;
      }
      case 'breach': {
        // a wall target reduced below 25% HP counts as breached
        const walls = structures.targets.filter((t) => t.type === 'wall');
        const breached = walls.some((w) => w.hp / w.hp0 < 0.25 || w.destroyed);
        if (!breached && walls.length) return false;
        break;
      }
      case 'noCivilian':
        if (structures.civilianDestroyed > 0) return false;
        break;
      case 'survive':
        if ((eco.survivedSeconds || 0) < o.seconds) return false;
        break;
      case 'minEfficiency': {
        const eff = eco.gainedValue / Math.max(1, eco.spentValue);
        if (eff < o.value) return false;
        break;
      }
    }
  }
  return true;
}

export function describeObjectives(m, lang = 'ru') {
  const out = [];
  for (const o of m.objectives) {
    switch (o.type) {
      case 'destroyTargets':
        out.push(lang === 'ru'
          ? `Разрушить целей: ${o.count}${o.ofType ? ` (${typeName(o.ofType, lang)})` : ''}`
          : `Destroy ${o.count} target(s)${o.ofType ? ` (${typeName(o.ofType, lang)})` : ''}`);
        break;
      case 'destroyTargetType':
        out.push(lang === 'ru' ? `Уничтожить: ${typeName(o.target, lang)}` : `Destroy: ${typeName(o.target, lang)}`);
        break;
      case 'breach': out.push(lang === 'ru' ? 'Пробить брешь в стене' : 'Breach the wall'); break;
      case 'noCivilian': out.push(lang === 'ru' ? 'Не задеть мирные постройки' : 'Spare civilian buildings'); break;
      case 'survive': out.push(lang === 'ru' ? `Продержаться ${o.seconds} с` : `Survive ${o.seconds}s`); break;
      case 'minEfficiency': out.push(lang === 'ru' ? `КПД не ниже ${o.value.toFixed(2)}` : `Efficiency ≥ ${o.value.toFixed(2)}`); break;
    }
  }
  if (m.shotLimit) out.push(lang === 'ru' ? `Лимит снарядов: ${m.shotLimit}` : `Shot limit: ${m.shotLimit}`);
  if (m.timeLimit) out.push(lang === 'ru' ? `Время: ${m.timeLimit} с` : `Time: ${m.timeLimit}s`);
  return out;
}

export function typeName(type, lang = 'ru') {
  const t = CFG.targetTypes[type];
  if (!t) return type;
  return lang === 'en' ? t.en : t.ru;
}

function previewReward(chapter, kind, mod) {
  const base = 90 + chapter * 42;
  const kindMul = { DEMOLISH: 1, SNIPER: 1.15, SIEGE: 1.1, SABOTAGE: 1.25, DEFEND: 1.3, ECONOMY: 1.2, BOSS: 2.1 }[kind] || 1;
  return {
    coins: Math.round(base * kindMul * (mod.reward || 1)),
    stone: Math.round((26 + chapter * 7) * (mod.loot || 1)),
    wood: Math.round((18 + chapter * 5) * (mod.loot || 1)),
    metal: Math.round((6 + chapter * 2.4) * (mod.loot || 1)),
    blueprints: chapter >= 3 ? 1 : 0,
  };
}

// --------------------------------------------------------------- campaign ---
export function campaignList() {
  const s = S();
  const out = [];
  for (let chIdx = 1; chIdx <= MC.chapters; chIdx++) {
    const unlocked = chIdx === 1 || (s.progress.chapterProgress[chIdx - 1] || 0) >= MC.perChapter - 1;
    const chObj = {
      chapter: chIdx,
      name: chapterName(chIdx, s.lang),
      missions: [],
      unlocked,
    };
    for (let i = 0; i < MC.perChapter; i++) {
      const id = `${chIdx}-${i + 1}`;
      const prevDone = i === 0 ? unlocked : (s.progress.bestRank[`${chIdx}-${i}`] !== undefined);
      const m = generateMission(chIdx, i, { id });
      m.unlocked = unlocked && prevDone;
      m.rank = s.progress.bestRank[id] || null;
      m.done = !!m.rank;
      m.chapterName = chObj.name;
      chObj.missions.push(m);
    }
    out.push(chObj);
  }
  return out;
}

export function dailyContract() {
  const s = S();
  const day = Math.floor(Date.now() / 86400000);
  const rng = makeRng(day * 7919 + 13);
  const chapter = clamp(1 + Math.floor((s.progress.rank || 0) * 1.2) + rng.int(0, 1), 1, 5);
  const m = generateMission(chapter, rng.int(0, MC.perChapter - 1), { id: `daily-${day}`, daily: true, seed: day * 7919 + 13 });
  m.title = 'Контракт дня';
  m.rewardPreview.coins = Math.round(m.rewardPreview.coins * 1.6);
  return m;
}

export function trialMission() {
  const s = S();
  const day = Math.floor(Date.now() / 86400000);
  const rng = makeRng(day * 104729 + 7);
  const chapter = clamp(2 + (s.progress.rank || 0), 1, 5);
  const m = generateMission(chapter, rng.int(0, MC.perChapter - 1), {
    id: `trial-${day}`, trial: true, seed: day * 104729 + 7,
    kind: 'DEMOLISH', supplyMul: 0.5,
  });
  m.title = 'Испытание: один ящик';
  m.objectives = [{ type: 'destroyTargets', count: 1, of: 'hostile' }];
  m.shotLimit = 3;
  m.rewardPreview.coins = Math.round(m.rewardPreview.coins * 1.3);
  return m;
}

export function trainingMission() {
  const m = generateMission(1, 0, { id: 'training', kind: 'DEMOLISH', biome: 'meadow', scheme: 'linear_wall', mod: CFG.missions.modifiers[0], supplyMul: 9 });
  m.title = 'Тренировочный полигон';
  m.objectives = [{ type: 'destroyTargets', count: 1, of: 'hostile' }];
  m.training = true;
  m.garrison = 0;      // no return fire on the training ground
  m.engines = 0;
  m.rewardPreview = { coins: 0, stone: 0, wood: 0, metal: 0, blueprints: 0 };
  return m;
}

export function recordMissionResult(mission, report) {
  const s = S();
  // daily/trial/training must not touch campaign progression: they used to
  // write `daily-…` keys into bestRank (inflating the «X/40» counter) and
  // could unlock campaign missions the player never actually played
  if (mission.training || mission.isTrial || mission.isDaily) return;
  const prev = s.progress.bestRank[mission.id];
  const order = { S: 5, A: 4, B: 3, C: 2, D: 1 };
  if (!prev || order[report.rank] > order[prev]) s.progress.bestRank[mission.id] = report.rank;
  const ch = mission.chapter;
  s.progress.chapterProgress[ch] = Math.max(s.progress.chapterProgress[ch] || 0, mission.index + 1);
  // unlock next chapter when the last mission of a chapter is done
  if (mission.index >= MC.perChapter - 1) s.progress.chapterProgress[ch] = MC.perChapter;
  Save.markDirty();
  events_emit_rank(mission, report);
}
function events_emit_rank() { /* wired through Save events in main.js */ }

export { events } from '../core/save.js';
