// ============================================================================
//  CATAPULT SIEGE — CONFIG (single source of truth for ALL numbers)
//  Master Prompt §8.3: no magic numbers in logic. Everything tuned here.
// ============================================================================

export const CFG = {
  VERSION: '1.0.0',
  SAVE_KEY: 'catapult_siege_save',
  SAVE_VERSION: 3,
  LANG_DEFAULT: 'ru',

  // ---------------------------------------------------------------- RENDER ---
  render: {
    maxPixelRatio: 2.0,
    qualitySteps: [
      { name: 'high', pixelRatio: 1.0, shadows: true,  grass: 900, debrisMax: 140, particles: 1.0, fog: true,  outline: true  },
      { name: 'med',  pixelRatio: 0.85, shadows: false, grass: 420, debrisMax: 90,  particles: 0.7, fog: true,  outline: true  },
      { name: 'low',  pixelRatio: 0.7,  shadows: false, grass: 0,   debrisMax: 45,  particles: 0.4, fog: false, outline: false },
    ],
    qualityStart: 1,                    // index into qualitySteps
    downgradeFrameMs: 20,               // avg frame above this => step down
    downgradeWindow: 90,                // frames to measure
    upgradeFrameMs: 13,                 // avg frame below this => step up
    upgradeWindow: 240,
    fovBase: 55,
    fovFlight: 62,
    fpsReportEvery: 60,
  },

  // --------------------------------------------------------------- PHYSICS ---
  physics: {
    fixedDt: 1 / 120,
    maxStepsPerFrame: 8,
    gravity: 9.81,
    airDensity: 1.2,
    worldSize: 240,                       // half-extent of playable ground
    terrain: { size: 240, segments: 63 }, // heightmap: 64x64 verts
    debris: {
      life: 4.0,
      max: 140,
      gravityScale: 1.0,
      restitution: 0.22,
      drag: 0.35,
      angularDamp: 0.94,
    },
    broadphaseCell: 6,
    projectileRadius: 0.42,
    minImpactSpeed: 2.0,
    waterLevel: -1.4,
  },

  // ------------------------------------------------------------ BALLISTICS ---
  ballistics: {
    v0Base: 34.0,          // m/s at 100% power, 100% condition
    v0Max: 54.0,
    powerMin: 0.30,
    powerMax: 1.00,
    elevationMin: 2,
    elevationMax: 85,
    azimuthMin: -32,
    azimuthMax: 32,
    baseSpreadDeg: 0.55,     // gaussian sigma of launch cone, perfect condition
    spreadFromWear: 2.4,     // extra sigma at 100% wear
    spreadFromWindUnc: 0.35, // extra sigma per m/s of wind
    predictPoints: 26,
    predictDt: 0.055,
    predictVisiblePoints: 13,
    ghostTrailLife: 12,
    slowmo: { scale: 0.22, duration: 0.65, hitstop: 0.07 },
    muzzleOffset: { x: 0, y: 2.55, z: 0 },   // relative to trebuchet root
  },

  // ------------------------------------------------------------- AIM INPUT ---
  aim: {
    azDegPerPx: 0.22,
    elDegPerPx: 0.22,
    powerPerPx: 1 / 150,       // drag distance (px) that maps to full power delta
    deadZonePx: 6,
    cancelZonePx: 92,          // radius of the bottom-left cancel zone
    smoothing: 0.35,           // exponential smoothing of aim values
    timeFreezeOnAim: true,     // Decision D6: world pauses while aiming
    fireButton: true,
    precisionStepDeg: 0.5,
  },

  // --------------------------------------------------------------- CAMERA ---
  camera: {
    orbitMinPolar: 12,
    orbitMaxPolar: 78,
    orbitMinAz: -155,
    orbitMaxAz: 155,
    distMin: 9,
    distMax: 70,
    distDefault: 26,
    targetDefault: [0, 3, 0],
    panRangeZ: 26,
    lerpPos: 0.16,
    lerpLook: 0.20,
    shakeDecay: 6.5,
    shakeMax: 0.55,
    shakeScaleByImpact: true,
    flightLeadTime: 0.35,
    flightLerp: 0.12,
    returnTime: 0.85,
    dynamic: true,             // false = accessibility "calm camera"
  },

  // ------------------------------------------------------------ TREBUCHET ---
  trebuchet: {
    nodes: ['frame', 'counterweight', 'beam', 'pivot', 'sling', 'guide'],
    nodeHp: { frame: 220, counterweight: 180, beam: 200, pivot: 140, sling: 120, guide: 160 },
    // effect of damage (0..1) on performance
    effects: {
      frame:         { power: -0.30, spread: 0.4 },
      counterweight: { power: -0.45, spread: 0.0 },
      beam:          { power: -0.30, spread: 0.7 },
      pivot:         { power: -0.05, spread: 1.4 },
      sling:         { power: -0.10, spread: 1.1, breakChanceAtZero: 0.55 },
      guide:         { power: -0.12, spread: 0.6 },
    },
    wearPerShotBase: 1.4,       // % of node HP
    wearPowerScale: 1.8,        // extra % at 100% power
    wearRecoilToAim: 0.55,      // how much the aim drifts after a shot (deg)
    // firing animation phases (seconds)
    phases: { load: 0.55, cock: 0.95, aim: 0.30, release: 0.06, swing: 0.42, recover: 1.15 },
    beamLength: 7.4,
    beamShortArm: 1.55,
    pivotHeight: 4.05,
    slingLength: 3.6,
    catastrophicAtZero: 'frame',
  },

  // ------------------------------------------------------------------ AMMO ---
  ammo: {
    stone:      { id:'stone',      ru:'Камень',        en:'Stone',        mass:40, drag:0.0009, restitution:0.28, dmg:125, radius:0, dot:0, pierce:0, cost:{stone:3},                  wear:1.00, unlock:0, vfx:'dust',  crit:1.0 },
    granite:    { id:'granite',    ru:'Гранитное',     en:'Granite',      mass:65, drag:0.0007, restitution:0.18, dmg:180, radius:0, dot:0, pierce:0, cost:{stone:6,metal:2},          wear:1.35, unlock:2, vfx:'rock',  crit:1.0 },
    fire:       { id:'fire',       ru:'Зажигательное', en:'Incendiary',   mass:35, drag:0.0011, restitution:0.22, dmg:60,  radius:2.2, dot:45, dotTime:5, pierce:0, cost:{stone:4,pitch:3}, wear:1.05, unlock:3, vfx:'fire', crit:1.0 },
    grapeshot:  { id:'grapeshot',  ru:'Картечь',       en:'Grapeshot',    mass:25, drag:0.0017, restitution:0.10, dmg:45,  radius:4.2, dot:0, pierce:0, cost:{stone:3,rope:1},          wear:0.85, unlock:3, vfx:'shrapnel', crit:0.8 },
    explosive:  { id:'explosive',  ru:'Разрывное',     en:'Explosive',    mass:50, drag:0.0010, restitution:0.05, dmg:155, radius:3.2, dot:0, pierce:0, cost:{stone:5,metal:6,pitch:2}, wear:1.55, unlock:5, vfx:'boom', crit:1.2, fuse:0.4 },
    anchor:     { id:'anchor',     ru:'Якорь-болт',    en:'Anchor bolt',  mass:80, drag:0.0006, restitution:0.02, dmg:210, radius:0, dot:0, pierce:1, cost:{metal:8,rope:4},            wear:1.80, unlock:6, vfx:'pierce', crit:1.4 },
    hive:       { id:'hive',       ru:'Улей',          en:'Beehive',      mass:30, drag:0.0013, restitution:0.30, dmg:20,  radius:3.0, dot:0, pierce:0, cost:{wood:2,pitch:4},          wear:0.70, unlock:7, vfx:'bees', crit:0.7, distract:4 },
    truestone:  { id:'truestone',  ru:'Точёное',       en:'Trued shot',   mass:40, drag:0.0008, restitution:0.24, dmg:110, radius:0, dot:0, pierce:0, cost:{stone:10,metal:4},        wear:1.05, unlock:9, vfx:'dust', crit:1.15, spreadMul:0.35 },
  },
  ammoOrder: ['stone','granite','fire','grapeshot','explosive','anchor','hive','truestone'],

  // --------------------------------------------------------------- BLOCKS ---
  blocks: {
    materials: {
      stone:  { hp: 135, density: 2400, dmgTaken: 1.00, dmgTo: 1.00, color: 0x9c968a, debris: 6, loot: { stone: 3 }, sfx: 'stone' },
      brick:  { hp: 100, density: 1900, dmgTaken: 1.25, dmgTo: 0.90, color: 0xa8705a, debris: 6, loot: { stone: 3 }, sfx: 'stone' },
      wood:   { hp:  70, density:  700, dmgTaken: 1.70, dmgTo: 0.70, color: 0x7a5533, debris: 5, loot: { wood: 3 },  sfx: 'wood'  },
      metal:  { hp: 260, density: 7800, dmgTaken: 0.55, dmgTo: 1.35, color: 0x6e7278, debris: 4, loot: { metal: 2 }, sfx: 'metal' },
      rope:   { hp:  35, density:  400, dmgTaken: 2.10, dmgTo: 0.30, color: 0xbfa878, debris: 3, loot: { rope: 1 },  sfx: 'wood'  },
      cloth:  { hp:  22, density:  200, dmgTaken: 2.60, dmgTo: 0.15, color: 0xd8d2c0, debris: 2, loot: {},           sfx: 'wood'  },
      pitch:  { hp:  60, density: 1100, dmgTaken: 1.40, dmgTo: 0.80, color: 0x3b2f2a, debris: 4, loot: { pitch: 1 },  sfx: 'stone' },
      gold:   { hp:  90, density: 5000, dmgTaken: 0.80, dmgTo: 0.50, color: 0xd9a62e, debris: 5, loot: { coins: 14 }, sfx: 'metal' },
    },
    dmgFalloff: 0.16,        // per metre beyond blast radius
    critChanceBase: 0.06,
    critMul: 2.0,
    crackAt: 0.60,           // HP ratio where crack decals appear
    collapseDamageMul: 0.75, // falling block damage = mass*speed*mul
    chipRadius: 1.7,         // micro-cascade: neighbours damaged when a block dies
    chipDamage: 0.45,
    overflowMul: 0.28,       // overkill energy punches into neighbouring blocks
    overflowRadius: 1.7,
    civilianPenaltyCoins: 40,
  },

  // --------------------------------------------------------------- TARGETS ---
  targetTypes: {
    wall:      { ru:'Стена',        en:'Wall',        bounty: 30, priority: 1 },
    tower:     { ru:'Башня',        en:'Tower',       bounty: 60, priority: 2 },
    gate:      { ru:'Ворота',       en:'Gate',        bounty: 50, priority: 2 },
    magazine:  { ru:'Пороховой склад', en:'Magazine', bounty: 75, priority: 3 },
    engine:    { ru:'Орудие врага', en:'Enemy engine',bounty: 80, priority: 3 },
    barracks:  { ru:'Казарма',      en:'Barracks',    bounty: 45, priority: 1 },
    banner:    { ru:'Штандарт',     en:'Banner',      bounty: 90, priority: 4 },
    commander: { ru:'Командир',     en:'Commander',   bounty: 150, priority: 4 },
    civilian:  { ru:'Мельница',     en:'Mill',        bounty: -60, priority: -1 },
    chapel:    { ru:'Часовня',      en:'Chapel',      bounty: -80, priority: -1 },
  },

  // -------------------------------------------------------------- RESOURCES ---
  resources: {
    ids: ['stone', 'wood', 'metal', 'rope', 'pitch', 'coins', 'blueprints', 'supply'],
    ru: { stone:'Камень', wood:'Дерево', metal:'Металл', rope:'Верёвка', pitch:'Смола', coins:'Монеты', blueprints:'Чертежи', supply:'Снабжение' },
    en: { stone:'Stone', wood:'Wood', metal:'Metal', rope:'Rope', pitch:'Pitch', coins:'Coins', blueprints:'Blueprints', supply:'Supply' },
    icon: { stone:'🪨', wood:'🪵', metal:'⚙️', rope:'🪢', pitch:'🔥', coins:'🪙', blueprints:'📜', supply:'📦' },
    start: { stone: 120, wood: 90, metal: 40, rope: 35, pitch: 12, coins: 260, blueprints: 2, supply: 0 },
    caps:  { stone: 4000, wood: 4000, metal: 2500, rope: 2000, pitch: 1200, coins: 999999, blueprints: 999 },
  },

  // ---------------------------------------------------------------- MARKET ---
  market: {
    buy:  { stone: 1.6, wood: 1.9, metal: 5.2, rope: 4.4, pitch: 9.5 },   // coins per unit
    sell: { stone: 0.7, wood: 0.8, metal: 2.4, rope: 1.9, pitch: 4.2 },
    bundle: 25,
    repairCostMulInBattle: 1.5,
    repairCost: { frame:{wood:2,metal:1}, counterweight:{metal:2}, beam:{wood:3}, pivot:{metal:1,rope:1}, sling:{rope:2}, guide:{wood:2} },
    repairTimeIdle: 0.9,
    repairTimeBattle: 1.8,
    repairHpPerAction: 46,
  },

  // ------------------------------------------------------------------ CREW ---
  crew: {
    slotsStart: 2,
    slotsMax: 4,
    roles: {
      gunner:   { ru:'Наводчик',   en:'Gunner',   skill:{ id:'measure',  ru:'Замер',            cd:30, dur:0 },
                  passive:{ spread:-0.08 } },
      loader:   { ru:'Заряжающий', en:'Loader',   skill:{ id:'overload', ru:'Двойной заряд',    cd:45, dur:1 },
                  passive:{ cockTime:-0.20 } },
      engineer: { ru:'Инженер',    en:'Engineer', skill:{ id:'fieldfix', ru:'Аварийный ремонт', cd:60, dur:0 },
                  passive:{ wear:-0.15 } },
      commander:{ ru:'Командир',   en:'Commander',skill:{ id:'warcry',   ru:'Боевой клич',      cd:90, dur:1 },
                  passive:{ coins:0.10 } },
    },
    fatiguePerShot: [6, 14],
    fatigueSkillLock: 100,
    fatigueSpreadMulAt100: 1.6,
    fatigueRestoredAtCamp: 100,
    hireCost: { 1: 0, 2: 180, 3: 520, 4: 1150 },
    levelXp: [0, 60, 150, 300, 520, 820, 1200],
    levelCost: [0, 0, 140, 320, 640, 1100, 1750],
  },

  // --------------------------------------------------------------- TECHTREE ---
  tech: {
    branches: {
      mechanics:  { ru:'Механика',  en:'Mechanics',  icon:'⚖️', color:'#c98a3a', levels:8 },
      ballistics: { ru:'Точность',  en:'Ballistics', icon:'🎯', color:'#4a8fb5', levels:8 },
      durability: { ru:'Прочность', en:'Durability', icon:'🛠️', color:'#7a8b52', levels:7 },
      ordnance:   { ru:'Боеприпасы',en:'Ordnance',   icon:'💥', color:'#b3372c', levels:10 },
      crew:       { ru:'Расчёт',    en:'Crew',       icon:'👥', color:'#8a6ab3', levels:8 },
    },
    // per-level cost formula: coins = base*lvl^1.35, blueprints = floor(lvl/3)
    costBase: { mechanics: 95, ballistics: 110, durability: 85, ordnance: 130, crew: 120 },
    costRes:  { mechanics:{metal:14}, ballistics:{rope:12}, durability:{wood:18}, ordnance:{stone:40}, crew:{pitch:6} },
    rankRequiredPerLevel: [0,0,0,0,0,0,1,1,2,2],   // early branch levels are coin-gated only
    effects: {
      mechanics:  { perLevel:{ power:0.105 }, nodes:{ 3:'cockAuto', 5:'doubleCock', 8:'overdrive' } },
      ballistics: { perLevel:{ spread:-0.085 }, nodes:{ 2:'windComp', 4:'scopeZoom', 6:'ricochetPredict', 8:'ghostMaster' } },
      durability: { perLevel:{ hp:0.11, wear:-0.075 }, nodes:{ 4:'fastRepair', 7:'autoRepair' } },
      ordnance:   { perLevel:{ damage:0.065 }, nodes:{ 2:'ammo_fire', 3:'ammo_grapeshot', 5:'ammo_explosive', 6:'ammo_anchor', 7:'ammo_hive', 9:'ammo_truestone', 4:'workshopDiscount' } },
      crew:       { perLevel:{ fatigue:-0.07, loot:0.035 }, nodes:{ 3:'slot3', 6:'slot4', 8:'veteran' } },
    },
    synergies: [
      { id:'overload_free', ru:'Перегруз',          req:{mechanics:6,durability:5}, desc:'Раз в миссию выстрел на 130% мощности без доп. износа' },
      { id:'siege_sniper',  ru:'Снайпер осады',     req:{ballistics:7,ordnance:6},  desc:'Крит ×2.5 при попадании в 1.5 м от центра цели' },
      { id:'iron_frame',    ru:'Железный остов',    req:{durability:7,mechanics:4}, desc:'+25% HP рамы, износ −10%' },
      { id:'greased_pivot', ru:'Смазанная ось',     req:{mechanics:5,crew:4},       desc:'Рассеивание −20%, взвод −25%' },
      { id:'pyromaniac',    ru:'Пироман',           req:{ordnance:5,ballistics:3},  desc:'Зажигательные: +35% DoT, горение распространяется' },
      { id:'quartermaster', ru:'Квартирмейстер',    req:{crew:6,ordnance:3},        desc:'Стоимость ядер −20%, +1 очко снабжения за контракт' },
      { id:'stone_rain',    ru:'Каменный дождь',    req:{ordnance:8,mechanics:6},   desc:'Картечь: +1 осколочная волна (r 4.2→5.6 м)' },
      { id:'veteran_crew',  ru:'Ветераны',          req:{crew:8,durability:4},      desc:'Усталость растёт вдвое медленнее' },
      { id:'wind_reader',   ru:'Чтец ветра',        req:{ballistics:6,crew:3},      desc:'Точный прогноз ветра на 3 с вперёд' },
      { id:'demolitionist', ru:'Подрывник',         req:{ordnance:7,ballistics:5},  desc:'Разрывные: +30% радиус, блоки разлетаются дальше' },
      { id:'siege_doctor',  ru:'Осадный лекарь',    req:{durability:6,crew:5},      desc:'Авторемонт 2 узлов за миссию (вместо 1)' },
      { id:'grand_cannon',  ru:'Гранд-канонир',     req:{mechanics:8,ballistics:8,ordnance:10}, desc:'Все эффекты +15%, ранг миссии S даёт ×2.3' },
    ],
  },

  // -------------------------------------------------------------- MISSIONS ---
  missions: {
    chapters: 5,
    perChapter: 8,
    supplyBase: 150,
    supplyPerChapter: 10,
    shotCostSupply: 9,
    repairCostSupply: 13,
    lootMulBase: 1.0,
    rankThresholds: { S: 11.0, A: 7.0, B: 4.0, C: 2.0 },   // efficiency = lootValue/spentValue
    rankRewardMul: { S: 2.0, A: 1.5, B: 1.2, C: 1.0, D: 0.6 },
    xpBase: 90,
    xpPerChapter: 34,
    perfectShotBonus: { radius: 1.6, xp: 45, coins: 30 },
    rankSGates: { accuracy: 0.7, noCivilians: true, noFrameLoss: true },
    distMin: 46,
    distMax: 96,
    windMax: [3, 6, 9, 12, 14],
    modifiers: [
      { id:'calm',       ru:'Штиль',            en:'Calm',          wind:0.0,  reward:1.00, supply:1.00 },
      { id:'gale',       ru:'Шквал',            en:'Gale',          wind:1.55, reward:1.35, supply:1.00 },
      { id:'rain',       ru:'Дождь',            en:'Rain',          wind:1.10, reward:1.20, supply:1.00, accuracy:0.86, fire:0.35 },
      { id:'fog',        ru:'Туман',            en:'Fog',           wind:0.80, reward:1.25, supply:1.00, visibility:0.55 },
      { id:'night',      ru:'Ночная осада',     en:'Night siege',   wind:0.90, reward:1.30, supply:1.00, night:true },
      { id:'brittle',    ru:'Хрупкая рама',     en:'Brittle frame', wind:1.00, reward:1.45, supply:1.00, wear:2.0 },
      { id:'scarce',     ru:'Дефицит',          en:'Scarcity',      wind:1.00, reward:1.55, supply:0.72 },
      { id:'elite',      ru:'Элитный гарнизон', en:'Elite garrison',wind:1.00, reward:1.70, supply:1.15, hp:1.45, loot:1.35 },
      { id:'generous',   ru:'Щедрый заказчик',  en:'Generous pay',  wind:1.00, reward:2.00, supply:0.90, coins:2.0 },
    ],
    kinds: ['DEMOLISH','SNIPER','SIEGE','SABOTAGE','DEFEND','ECONOMY','BOSS'],
    kindWeights: [3,3,2,2,1,2,0],
  },

  // ---------------------------------------------------------------- RANKS ---
  ranks: {
    list: ['Рекрут','Орудийный ученик','Наводчик','Мастер осады','Осадный маршал','Гранд-канонир'],
    listEn: ['Recruit','Apprentice','Gunner','Siege Master','Siege Marshal','Grand Cannonier'],
    levelsPerRank: 6,
    xpPerLevel: (lvl) => 180 + lvl * 120,
    rewardPerRankUp: { coins: 400, blueprints: 2 },
  },

  // -------------------------------------------------------------- ENEMY AI ---
  enemy: {
    returnFireDelay: [4.5, 9.0],
    returnFireDamage: [6, 14],
    returnFireAccuracy: 0.55,
    accuracyPerEngineAlive: 0.12,
    repairRateHpPerSec: 3.2,
    soldiersPerBarracks: 3,
    soldierHp: 34,
    defendWaveInterval: 22,
    panicDuration: 4,
  },

  // ---------------------------------------------------------------- CAMP/IDLE ---
  camp: {
    buildings: {
      quarry:  { ru:'Каменоломня', en:'Quarry',  res:'stone', base:26,  growth:1.16, cost:{coins:120,wood:30}, costGrowth:1.42, cap:260, capGrowth:1.28 },
      sawmill: { ru:'Лесопилка',   en:'Sawmill', res:'wood',  base:22,  growth:1.16, cost:{coins:110,stone:25}, costGrowth:1.42, cap:260, capGrowth:1.28 },
      mine:    { ru:'Шахта',       en:'Mine',    res:'metal', base:7.5, growth:1.18, cost:{coins:260,wood:70},  costGrowth:1.48, cap:90,  capGrowth:1.30 },
      ropery:  { ru:'Верёвочная',  en:'Ropery',  res:'rope',  base:9,   growth:1.17, cost:{coins:190,wood:50},  costGrowth:1.45, cap:130, capGrowth:1.29 },
      still:   { ru:'Смолокурня',  en:'Pitch still', res:'pitch', base:2.4, growth:1.20, cost:{coins:340,wood:90}, costGrowth:1.52, cap:44, capGrowth:1.30 },
    },
    offlineCapHours: 8,
    offlineEfficiency: 0.6,
    autoCollectCost: { coins: 900 },
    collectEverySec: 1,
  },

  // ------------------------------------------------------------------ VFX ---
  vfx: {
    smokeMax: 44,
    sparkMax: 64,
    dustRingMax: 8,
    trailSegments: 18,
    hitNumberLife: 1.1,
    hitNumberMax: 12,
    flashDuration: 0.08,
    maxShakePx: 6,
  },

  // ----------------------------------------------------------------- AUDIO ---
  audio: {
    masterVol: 0.85,
    sfxVol: 1.0,
    musicVol: 0.5,
    uiVol: 0.7,
    voices: 24,
    duckDb: -6,
  },

  // ------------------------------------------------------------- ACCESSIBILITY ---
  a11y: {
    uiScaleMin: 0.85,
    uiScaleMax: 1.30,
    colorBlindModes: ['off','deuteranopia','protanopia','tritanopia'],
    reduceMotion: false,
    leftHanded: false,
    showSubtitles: false,
  },

  // -------------------------------------------------------------- MONETIZATION ---
  iap: {
    enabled: false,   // wired but disabled in this build (Decision D14: needs server validation)
    adsEnabled: false,
    rewardedPerDay: { precise_measure: 3, double_loot: 5, instant_repair: 4, reroll: 3 },
  },

  // ------------------------------------------------------------- WORLD/SKY ---
  world: {
    skies: {
      dawn:    { top: 0x6f86b8, mid: 0xd9a8a0, bot: 0xf2c9a0, sun: 0xffd9b0, sunInt: 0.95, sunEl: 8,  stars: 0,    clouds: 0.25, aurora: 0,   haze: 0.35, fog: 0xd8b8a8, fogNear: 60, fogFar: 300 },
      noon:    { top: 0x3f7ec4, mid: 0x9cc4e0, bot: 0xd8e4e8, sun: 0xfff4d0, sunInt: 1.35, sunEl: 62, stars: 0,    clouds: 0.18, aurora: 0,   haze: 0.10, fog: 0xc4d4dc, fogNear: 90, fogFar: 340 },
      sunset:  { top: 0x5b8fc4, mid: 0xa9c6dd, bot: 0xe8c9a0, sun: 0xffd9a0, sunInt: 1.18, sunEl: 14, stars: 0,    clouds: 0.22, aurora: 0,   haze: 0.30, fog: 0xc9d6e2, fogNear: 90, fogFar: 340 },
      dusk:    { top: 0x2b3a63, mid: 0x7a5a7a, bot: 0xd98a5a, sun: 0xff9a5a, sunInt: 0.7,  sunEl: 3,  stars: 0.35, clouds: 0.30, aurora: 0,   haze: 0.45, fog: 0x6a5a72, fogNear: 50, fogFar: 260 },
      night:   { top: 0x0b1226, mid: 0x1d2a44, bot: 0x3a4a63, sun: 0xbfd0e8, sunInt: 0.32, sunEl: 38, stars: 1,    clouds: 0.12, aurora: 0,   haze: 0.15, fog: 0x22303f, fogNear: 40, fogFar: 220 },
      aurora:  { top: 0x081222, mid: 0x14303a, bot: 0x2a4a52, sun: 0xcfe0f0, sunInt: 0.3,  sunEl: 30, stars: 1,    clouds: 0.08, aurora: 1,   haze: 0.10, fog: 0x1a2a32, fogNear: 40, fogFar: 220 },
      storm:   { top: 0x4a5560, mid: 0x6a747e, bot: 0x8a9298, sun: 0xb0b8c0, sunInt: 0.5,  sunEl: 40, stars: 0,    clouds: 0.85, aurora: 0,   haze: 0.60, fog: 0x7a848c, fogNear: 30, fogFar: 180 },
      mist:    { top: 0x9aa8b0, mid: 0xb4bcc2, bot: 0xcfd4d6, sun: 0xd8d2c4, sunInt: 0.5,  sunEl: 30, stars: 0,    clouds: 0.5,  aurora: 0,   haze: 0.8,  fog: 0xb9bfc4, fogNear: 14, fogFar: 105 },
      heat:    { top: 0x7ab0d4, mid: 0xd4c8a0, bot: 0xf0e0b0, sun: 0xfff0c0, sunInt: 1.5,  sunEl: 70, stars: 0,    clouds: 0.06, aurora: 0,   haze: 0.55, fog: 0xe0d4b4, fogNear: 70, fogFar: 300 },
      ash:     { top: 0x2a2020, mid: 0x4a3430, bot: 0x6a4a3a, sun: 0xff7a4a, sunInt: 0.6,  sunEl: 20, stars: 0.15, clouds: 0.6,  aurora: 0,   haze: 0.7,  fog: 0x4a3a34, fogNear: 35, fogFar: 200 },
    },
    biomes: {
      meadow:  { terrain: { amp: 3.2, rough: 1.8, flat: 32, water: false }, tint: 0x7a8a4f, rock: 0x8b8378, trees: 'pine',   nTrees: 0.07, skies: ['noon', 'sunset', 'dawn'],  backdrop: 'mountains' },
      river:   { terrain: { amp: 2.4, rough: 1.6, flat: 34, water: true  }, tint: 0x6f8a52, rock: 0x8b8378, trees: 'birch',  nTrees: 0.09, skies: ['dawn', 'sunset', 'noon'], backdrop: 'treeline' },
      mountain:{ terrain: { amp: 9.5, rough: 3.4, flat: 24, water: false }, tint: 0x7d7461, rock: 0x8b8378, trees: 'pine',   nTrees: 0.05, skies: ['noon', 'dusk', 'mist'],  backdrop: 'mountains' },
      winter:  { terrain: { amp: 3.4, rough: 1.9, flat: 32, water: false }, tint: 0xcfd8e0, rock: 0x8a8f96, trees: 'pine',   nTrees: 0.09, skies: ['night', 'aurora', 'dawn'], backdrop: 'mountains', snow: true },
      coast:   { terrain: { amp: 3.0, rough: 1.4, flat: 30, water: true  }, tint: 0x9a9463, rock: 0x8b8378, trees: 'pine',   nTrees: 0.05, skies: ['sunset', 'noon', 'dusk'], backdrop: 'mountains' },
      desert:  { terrain: { amp: 2.6, rough: 0.9, flat: 36, water: false }, tint: 0xd4b878, rock: 0xb09878, trees: 'palm',   nTrees: 0.03, skies: ['heat', 'sunset', 'dusk'], backdrop: 'dunes' },
      autumn:  { terrain: { amp: 3.0, rough: 1.7, flat: 32, water: false }, tint: 0x8a7a3f, rock: 0x8b8378, trees: 'birchA', nTrees: 0.10, skies: ['dawn', 'sunset', 'mist'], backdrop: 'treeline' },
      volcano: { terrain: { amp: 5.5, rough: 3.0, flat: 26, water: false }, tint: 0x4a4038, rock: 0x3a3230, trees: 'dead',   nTrees: 0.04, skies: ['ash', 'dusk', 'night'],  backdrop: 'volcanoes' },
    },
  },

  // ------------------------------------------------------------------- DEV ---
  dev: {
    showFps: true,
    showDebugPanel: false,
    godMode: false,        // infinite resources (build-time only)
    instantCock: false,
    logEvents: false,
  },
};

// ---------------------------------------------------------------- helpers ---
export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export const AMMO = (id) => CFG.ammo[id] || CFG.ammo.stone;
