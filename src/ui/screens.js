// ============================================================================
//  ui/screens.js — all out-of-battle screens (§5)
// ============================================================================
import { CFG } from '../config.js';
import { t } from '../core/i18n.js';
import { el, qs, clear, toast, modal, confirmBox } from './dom.js';
import { clamp, fmt, pct, fmtTime } from '../core/utils.js';
import { S, Save, addResource, canAfford, pay } from '../core/save.js';
import { Audio } from '../core/audio.js';
import {
  campaignList, dailyContract, trialMission, trainingMission, chapterName, typeName, generateMission,
} from '../systems/missions.js';
import {
  buyBranch, branchCost, branchUnlocked, activeSynergies, computeMods, addXp, rankTitle,
  unlockedAmmo, ammoCost, TECH_NODE_COUNT, allTechNodes,
} from '../systems/progression.js';
import {
  roster, activeCrew, maxSlots, hire, toggleActive, trainCrew, restCrew, feedCrew, roleName,
  roleDef, skillName, xpForLevel, crewMods, restAll, trainCost,
} from '../systems/crew.js';
import {
  campRate, campCap, campUpgradeCost, upgradeBuilding, collectBuilding, collectAll, tickCamp,
  buyResource, sellResource,
} from '../systems/economy.js';

const RES = CFG.resources;

export class UI {
  constructor(root, game) {
    this.root = root;
    this.game = game;
    this.current = null;
    this.layer = el('div', { id: 'screens' });
    this.layer.style.cssText = 'position:absolute;inset:0;z-index:15;pointer-events:none';
    root.appendChild(this.layer);
  }

  show(name, params = {}) {
    this.current = name;
    clear(this.layer);
    this.layer.style.pointerEvents = 'none';
    const builder = BUILDERS[name];
    if (!builder) return;
    const node = builder.call(this, params);
    if (node) {
      // see-through screens (main menu) stay click-through so the player can
      // orbit the camp scene behind them; interactive parts opt back in via CSS
      node.style.pointerEvents = node.classList.contains('see-through') ? 'none' : 'auto';
      this.layer.appendChild(node);
    }
    if (name && name !== 'none') this.game.onScreen && this.game.onScreen(name);
  }

  hide() { this.current = null; clear(this.layer); this.layer.style.pointerEvents = 'none'; }

  head(title, onBack) {
    const back = onBack ? el('button', { class: 'btn ghost icon', text: '‹', onclick: () => { Audio.uiBack(); onBack(); } }) : null;
    return el('div', { class: 'screen-head' }, [back, el('h1', { text: title })]);
  }

  screen(cls, children) { return el('div', { class: 'screen ' + (cls || '') }, children); }

  resBar() {
    const s = S();
    const ids = ['coins', 'stone', 'wood', 'metal', 'rope', 'pitch', 'blueprints'];
    return el('div', { class: 'row wrap', style: { gap: '6px' } },
      ids.map((id) => el('span', { class: 'res', html: `<span class="ic">${RES.icon[id]}</span><span>${fmt(s.resources[id] || 0)}</span>` })));
  }
}

// ============================================================ SCREEN BUILDERS ==
const BUILDERS = {};

// ---------------------------------------------------------------- MAIN MENU --
BUILDERS.menu = function () {
  const s = S();
  const game = this.game;
  const top = el('div', { class: 'menu-top' });
  top.append(
    el('div', { class: 'menu-title', text: t('app_title') }),
    el('div', { class: 'menu-sub', text: t('app_subtitle') }),
    el('div', { class: 'menu-rank' }, [
      el('span', { class: 'tag gold', text: rankTitle() }),
      (() => {
        const need = CFG.ranks.xpPerLevel(s.progress.level);
        const w = el('div', { class: 'bar thin', style: { width: '110px' } });
        w.appendChild(el('i', { style: { width: pct(s.progress.xp / need) + '%' } }));
        return w;
      })(),
      el('span', { class: 'small muted', text: `${s.progress.xp}/${CFG.ranks.xpPerLevel(s.progress.level)} XP` }),
    ]),
    el('div', { class: 'row wrap', style: { marginTop: '10px', gap: '6px' } }, [
      el('span', { class: 'res', html: `<span class="ic">🪙</span>${fmt(s.resources.coins)}` }),
      el('span', { class: 'res', html: `<span class="ic">🪨</span>${fmt(s.resources.stone)}` }),
      el('span', { class: 'res', html: `<span class="ic">🪵</span>${fmt(s.resources.wood)}` }),
      el('span', { class: 'res', html: `<span class="ic">⚙️</span>${fmt(s.resources.metal)}` }),
      el('span', { class: 'res', html: `<span class="ic">📜</span>${fmt(s.resources.blueprints)}` }),
    ])
  );

  const mb = (icon, label, sub, onclick, cls = '') => el('button', { class: 'menu-btn ' + cls, onclick: () => { Audio.uiTap(); onclick(); }, html: `<span class="ic">${icon}</span><span>${label}<span class="sub">${sub || ''}</span></span>` });

  const next = game.nextCampaignMission();
  const bottom = el('div', { class: 'menu-bottom' });
  bottom.append(
    mb('⚔️', t('menu_continue'), next ? `${chapterName(next.chapter, s.lang)} · ${next.title}` : t('menu_campaign'), () => this.show('briefing', { mission: next || generateMission(1, 0) }), 'primary wide'),
    el('div', { class: 'menu-grid' }, [
      mb('🗺️', t('menu_campaign'), `${S().lang === 'en' ? 'Missions' : 'Миссии'}: ${Object.keys(s.progress.bestRank).length}/40`, () => this.show('contracts')),
      mb('📅', t('menu_daily'), s.progress.daily.done ? '✓' : ((s.progress.daily.loginStreak || 1) > 1 ? `🔥${s.progress.daily.loginStreak}` : '!'), () => {
        if (S().progress.daily.done) { Audio.uiError(); toast(t('daily_done'), '', 2400); return; }
        this.show('briefing', { mission: dailyContract() });
      }),
      mb('🎯', t('menu_trial'), `${s.progress.daily.trials || 0}/3`, () => {
        if ((S().progress.daily.trials || 0) >= 3) { Audio.uiError(); toast(t('trial_limit'), 'bad', 2400); return; }
        this.show('briefing', { mission: trialMission() });
      }),
      mb('🏹', t('menu_training'), '∞', () => this.show('briefing', { mission: trainingMission() })),
      mb('📐', t('menu_workshop'), `${S().lang === 'en' ? 'Nodes' : 'Узлы'}: ${countOwnedTech()}/${TECH_NODE_COUNT}`, () => this.show('workshop')),
      mb('👥', t('menu_crew'), `${S().lang === 'en' ? 'On duty' : 'В строю'}: ${activeCrew().length}/${maxSlots()}`, () => this.show('crew')),
      mb('💣', t('menu_ammo'), unlockedAmmo().length + '/' + CFG.ammoOrder.length, () => this.show('ammo')),
      mb('🏕️', t('menu_camp'), pendingCamp() > 0 ? `+${fmt(pendingCamp())}` : '', () => this.show('camp')),
      mb('⚙️', t('menu_settings'), '', () => this.show('settings')),
      mb('🚪', t('menu_exit'), '', () => this.game.exitApp()),
    ])
  );

  const node = el('div', { id: 'menu' }, [top, bottom]);
  return this.screen('see-through', [node]);
};

function countOwnedTech() {
  // a branch at level N already includes its named nodes at levels <= N
  const s = S();
  let n = 0;
  for (const b in s.tech) n += s.tech[b] || 0;
  return n;
}
function pendingCamp() {
  const s = S();
  let n = 0;
  for (const k in s.camp.buildings) n += Math.floor(s.camp.buildings[k].stored || 0);
  return n;
}

// ---------------------------------------------------------------- CONTRACTS --
BUILDERS.contracts = function () {
  const s = S();
  const list = campaignList();
  const body = el('div', { class: 'screen-body' });
  body.appendChild(this.resBar());
  for (const ch of list) {
    const wrap = el('div', { class: 'chap' });
    const done = ch.missions.filter((m) => m.done).length;
    wrap.appendChild(el('div', { class: 'chap-head' }, [
      el('span', { class: 'n', text: `${ch.chapter}. ${ch.name}` }),
      el('span', { class: 'muted small', text: `${done}/${ch.missions.length}` }),
      ch.unlocked ? null : el('span', { class: 'tag bad', text: '🔒' }),
    ]));
    const grid = el('div', { class: 'mgrid' });
    for (const m of ch.missions) {
      const kindShort = { DEMOLISH: 'СНОС', SNIPER: 'ТОЧН', SIEGE: 'ПРОЛОМ', SABOTAGE: 'ДИВЕРС', DEFEND: 'ОБОРОНА', ECONOMY: 'ЭКОНОМ', BOSS: 'БОСС' }[m.kind];
      const tile = el('button', {
        class: 'mission-tile' + (m.unlocked ? '' : ' locked') + (m.done ? ' done' : '') + (m.isBoss ? ' boss' : ''),
        html: `<span class="k">${kindShort}</span><b>${m.index + 1}</b>${m.rank ? `<span class="rk">${m.rank}</span>` : ''}`,
        onclick: () => { if (!m.unlocked) { Audio.uiError(); toast(t('mission_locked'), 'bad', 2200); return; } Audio.uiTap(); this.show('briefing', { mission: m }); },
      });
      grid.appendChild(tile);
    }
    wrap.appendChild(grid);
    body.appendChild(wrap);
  }
  return this.screen('', [this.head(t('menu_campaign'), () => this.show('menu')), body]);
};

// ---------------------------------------------------------------- BRIEFING --
BUILDERS.briefing = function ({ mission }) {
  const s = S();
  if (!mission) { this.show('menu'); return null; }
  // daily/trial are limited per day — block re-entry via «Retry» on the results
  if (mission.isDaily && s.progress.daily.done) { Audio.uiError(); toast(t('daily_done'), '', 2400); this.show('menu'); return null; }
  if (mission.isTrial && (s.progress.daily.trials || 0) >= 3) { Audio.uiError(); toast(t('trial_limit'), 'bad', 2400); this.show('menu'); return null; }
  const game = this.game;
  const loadout = mission._loadout || { supply: mission.supply, ammo: {} };
  mission._loadout = loadout;
  if (!loadout.ammo.stone) loadout.ammo.stone = Math.min(14, Math.floor(mission.supply / (CFG.missions.shotCostSupply * 0.85)));

  const body = el('div', { class: 'screen-body' });

  // header card
  const kindName = t('kind_' + mission.kind);
  const head = el('div', { class: 'card' });
  head.append(
    el('div', { class: 'row spread' }, [
      el('h2', { style: { margin: 0 }, text: mission.title }),
      el('span', { class: 'tag', text: kindName }),
    ]),
    el('div', { class: 'muted small', style: { marginTop: '4px' }, text: `${chapterName(mission.chapter, s.lang)} · ${mission.id}` })
  );
  body.appendChild(head);

  // objectives
  const obj = el('div', { class: 'card' });
  obj.appendChild(el('h2', { text: t('brief_objectives') }));
  for (const line of mission.describe()) obj.appendChild(el('div', { class: 'small', style: { padding: '3px 0' }, html: `• ${line}` }));
  body.appendChild(obj);

  // conditions
  const cond = el('div', { class: 'card' });
  cond.appendChild(el('h2', { text: t('brief_conditions') }));
  const lines = [
    [t('brief_distance'), `${mission.dist} м`],
    [t('brief_wind'), `${mission.windPreview} м/с`],
    [t('brief_garrison'), `${mission.garrison}`],
    mission.garrisonSpec ? [t('brief_garrison_comp'), `🏹×${mission.garrisonSpec.archer} 🗡×${mission.garrisonSpec.spear} 🛠×${mission.garrisonSpec.engineer} ⚙×${mission.garrisonSpec.crew}`] : null,
    [t('brief_modifier'), `${mission.mod.ru} ×${mission.mod.reward.toFixed(2)}`],
    [t('brief_supply'), `${mission.supply} 📦`],
  ];
  for (const [k, v] of lines) cond.appendChild(el('div', { class: 'stat-line', html: `<span class="muted">${k}</span><b class="v">${v}</b>` }));
  body.appendChild(cond);

  // reward
  const rew = el('div', { class: 'card' });
  rew.appendChild(el('h2', { text: t('brief_reward') }));
  const r = mission.rewardPreview;
  rew.appendChild(el('div', { class: 'row wrap', style: { gap: '6px' } }, [
    el('span', { class: 'res', html: `🪙 ${r.coins}` }),
    el('span', { class: 'res', html: `🪨 ${r.stone}` }),
    el('span', { class: 'res', html: `🪵 ${r.wood}` }),
    el('span', { class: 'res', html: `⚙️ ${r.metal}` }),
    r.blueprints ? el('span', { class: 'res', html: `📜 ${r.blueprints}` }) : null,
  ]));
  body.appendChild(rew);

  // loadout
  const lo = el('div', { class: 'card' });
  lo.appendChild(el('h2', { text: t('brief_ammo') }));
  lo.appendChild(el('div', { class: 'muted small', style: { marginBottom: '8px', lineHeight: '1.4' }, text: t('brief_ammo_hint') }));
  const supplyBar = el('div', { class: 'bar', style: { marginBottom: '10px' } });
  supplyBar.appendChild(el('i', { style: { width: '0%' } }));
  lo.appendChild(supplyBar);
  const supplyLabel = el('div', { class: 'row spread small muted', style: { marginBottom: '9px' } });
  lo.appendChild(supplyLabel);
  const grid = el('div', { class: 'grid2' });
  lo.appendChild(grid);
  body.appendChild(lo);

  const avail = unlockedAmmo();
  const refreshLoadout = () => {
    let used = 0;
    for (const id in loadout.ammo) used += loadout.ammo[id] * CFG.missions.shotCostSupply * (CFG.ammo[id].wear || 1) * 0.85;
    const left = Math.max(0, Math.round(mission.supply - used));
    supplyBar.firstChild.style.width = pct(left / mission.supply) + '%';
    supplyBar.className = 'bar' + (left < CFG.missions.shotCostSupply ? ' crit' : left < mission.supply * 0.3 ? ' warn' : '');
    clear(supplyLabel);
    supplyLabel.append(el('span', { text: `${t('brief_supply')}: ${left}/${mission.supply} 📦` }), el('span', { text: `≈ ${Math.floor(left / (CFG.missions.shotCostSupply * 0.9))} ${t('hud_shot_left')}` }));
    clear(grid);
    for (const id of CFG.ammoOrder) {
      const a = CFG.ammo[id];
      const owned = avail.includes(id);
      const cost = ammoCost(id, computeMods().ammoDiscount);
      const count = loadout.ammo[id] || 0;
      const perShot = Math.round(CFG.missions.shotCostSupply * (a.wear || 1) * 0.85 * 10) / 10;
      const card = el('div', {
        class: 'card', style: { margin: 0, padding: '9px', opacity: owned ? '1' : '.4', border: count ? '1px solid var(--gold)' : '' },
      });
      card.append(
        el('div', { class: 'row spread' }, [el('b', { text: a.ru }), el('span', { class: 'tag gold', text: `×${count}` })]),
        el('div', { class: 'small muted', style: { margin: '3px 0 6px', lineHeight: '1.3' }, text: t('ammo_' + id + '_d') }),
        el('div', { class: 'row wrap', style: { gap: '4px', marginBottom: '7px' } },
          Object.entries(cost).map(([k, v]) => el('span', { class: 'res', style: { padding: '1px 6px', fontSize: '.8em' }, html: `${RES.icon[k]}${v}` }))),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('button', {
            class: 'btn small ghost grow', text: '−',
            onclick: () => {
              if (count <= 0) return;
              loadout.ammo[id]--;
              if (!mission.training) for (const k in cost) addResource(k, cost[k]);   // refund
              Audio.uiTap(); refreshLoadout();
            },
          }),
          el('button', {
            class: 'btn small primary grow', text: mission.training ? '+' : `+ ${Object.entries(cost).map(([k, v]) => RES.icon[k] + v).join(' ')}`,
            onclick: () => {
              if (!owned) { Audio.uiError(); toast(t('locked'), 'bad'); return; }
              const leftNow = mission.supply - Object.entries(loadout.ammo).reduce((s2, [k, v]) => s2 + v * CFG.missions.shotCostSupply * (CFG.ammo[k].wear || 1) * 0.85, 0);
              if (leftNow < perShot) { Audio.uiError(); toast(t('brief_full'), 'bad'); return; }
              if (!mission.training && !pay(cost)) { Audio.uiError(); toast(t('not_enough'), 'bad'); return; }
              loadout.ammo[id] = (loadout.ammo[id] || 0) + 1; Audio.uiTap(); refreshLoadout();
            },
          }),
        ])
      );
      grid.appendChild(card);
    }
  };
  refreshLoadout();

  const startBtn = el('button', {
    class: 'btn primary', style: { width: '100%', minHeight: '58px', fontSize: '1.08em', marginTop: '6px' },
    text: t('brief_start'),
    onclick: () => {
      const total = Object.values(loadout.ammo).reduce((a, b) => a + b, 0);
      if (!total) { Audio.uiError(); toast(t('brief_ammo_hint'), 'bad'); return; }
      Audio.uiUnlock();
      this.show('none');
      game.startMission(mission);
    },
  });
  body.appendChild(startBtn);

  return this.screen('', [this.head(t('brief_title'), () => this.show('menu')), body]);
};

// ----------------------------------------------------------------- RESULTS --
BUILDERS.results = function ({ report, mission, failed }) {
  const s = S();
  const body = el('div', { class: 'screen-body' });
  const rank = failed ? 'D' : (mission.training ? '✔' : report.rank);
  if (!failed) spawnConfetti(this.layer);

  body.appendChild(el('div', { class: 'center' }, [
    el('div', { class: 'rank-badge ' + rank, text: rank }),
    el('div', { class: 'muted', text: rank === '✔' ? (s.lang === 'ru' ? 'Тренировка завершена' : 'Training complete') : t('rank_' + rank) }),
    el('h2', { style: { margin: '8px 0 2px', color: failed ? 'var(--blood)' : 'var(--gold)' }, text: failed ? t('res_failed') : t('res_complete') }),
  ]));

  const card = el('div', { class: 'card' });
  card.appendChild(el('h2', { text: t('res_title') }));
  const lines = [
    [t('res_eff'), report.efficiency.toFixed(2)],
    [t('res_accuracy'), `${Math.round(report.accuracy * 100)}%`],
    [t('res_shots'), `${report.hits}/${report.shots}`],
    [t('res_spent'), `${report.spentValue} 🪙  ·  ${report.supplyUsed}/${report.supplyTotal} 📦`],
    [t('res_gained'), `${report.gainedValue} 🪙`],
    [`${t('res_loot')} · цели`, `${report.targetsDestroyed}`],
    [`${t('res_loot')} · блоки`, `${report.blocksDestroyed}`],
  ];
  if (report.perfectShots) lines.push([t('hint_perfect'), `×${report.perfectShots}`]);
  if (report.bestStreak >= 2) lines.push([`🔥 ${t('res_streak')}`, `×${report.bestStreak}`]);
  if (report.garrisonTotal && report.garrisonKilled) lines.push([`🗡 ${t('res_garrison_killed')}`, `${report.garrisonKilled}/${report.garrisonTotal}`]);
  if (report.repairs) lines.push([t('hud_repair'), `×${report.repairs}`]);
  if (report.civilianDestroyed) lines.push([t('res_penalty'), `−${report.civilianDestroyed * CFG.blocks.civilianPenaltyCoins} 🪙`]);
  for (const [k, v] of lines) card.appendChild(el('div', { class: 'stat-line', html: `<span class="muted">${k}</span><b class="v">${v}</b>` }));
  body.appendChild(card);

  // loot breakdown
  const loot = el('div', { class: 'card' });
  loot.appendChild(el('h2', { text: t('res_reward') }));
  loot.appendChild(el('div', { class: 'row wrap', style: { gap: '6px' } },
    Object.entries(report.loot).filter(([, v]) => v > 0).map(([k, v]) => el('span', { class: 'res', html: `<span class="ic">${RES.icon[k] || ''}</span>${fmt(v)}` }))));
  loot.appendChild(el('div', { class: 'stat-line', style: { marginTop: '8px' }, html: `<span class="muted">${t('res_xp')}</span><b class="v">+${report.xp}</b>` }));
  body.appendChild(loot);

  const row = el('div', { class: 'row wrap', style: { gap: '8px', marginTop: '4px' } });
  // `doubled` guard: the rewarded-double button must be one-shot, otherwise it
  // re-renders on the refreshed screen and mints coins forever
  if (!mission.training && !failed && !report.doubled) {
    row.appendChild(el('button', {
      class: 'btn gold grow', text: t('res_double'),
      onclick: () => {
        Audio.coins(6);
        addResource('coins', report.coins);
        toast(`+${report.coins} 🪙`, 'good');
        this.show('results', { report: { ...report, coins: report.coins * 2, doubled: true }, mission, failed });
      },
    }));
  }
  row.appendChild(el('button', { class: 'btn ghost grow', text: t('res_again'), onclick: () => { Audio.uiTap(); this.show('briefing', { mission }); } }));
  row.appendChild(el('button', {
    class: 'btn primary grow', text: failed ? t('res_camp') : t('res_next'),
    onclick: () => {
      Audio.uiTap();
      const next = this.game.nextCampaignMission();
      if (!failed && next && next.id !== mission.id) this.show('briefing', { mission: next });
      else this.show('menu');
    },
  }));
  body.appendChild(row);

  return this.screen('', [this.head(mission.title, () => this.show('menu')), body]);
};

// ---------------------------------------------------------------- WORKSHOP --
BUILDERS.workshop = function () {
  const s = S();
  const body = el('div', { class: 'screen-body' });
  body.appendChild(this.resBar());
  const mods = computeMods(crewMods());

  // summary
  const sum = el('div', { class: 'card' });
  sum.appendChild(el('h2', { text: t('ws_title') }));
  const stats = [
    [t('ws_effect_power'), `+${Math.round((mods.power - 1) * 100)}%`, 'good'],
    [t('ws_effect_spread'), `${Math.round((1 - mods.spread) * 100)}%`, mods.spread < 1 ? 'good' : 'bad'],
    [t('ws_effect_damage'), `+${Math.round((mods.damage - 1) * 100)}%`, 'good'],
    [t('ws_effect_hp'), `+${Math.round((mods.hp - 1) * 100)}%`, 'good'],
    [t('ws_effect_wear'), `${Math.round((1 - mods.wear) * 100)}%`, mods.wear < 1 ? 'good' : 'bad'],
    [t('ws_effect_loot'), `+${Math.round((mods.loot - 1) * 100)}%`, 'good'],
  ];
  sum.appendChild(el('div', { class: 'grid3' }, stats.map(([k, v, c]) => el('div', { class: 'center', style: { padding: '5px' } }, [
    el('div', { class: 'small muted', text: k }), el('b', { class: 'tag ' + c, text: v }),
  ]))));
  body.appendChild(sum);

  // branches
  for (const br in CFG.tech.branches) {
    const b = CFG.tech.branches[br];
    const lvl = s.tech[br] || 0;
    const card = el('div', { class: 'branch' });
    const pips = el('div', { class: 'pips' });
    const named = CFG.tech.effects[br].nodes || {};
    for (let i = 1; i <= b.levels; i++) {
      const isNamed = !!named[i];
      pips.appendChild(el('div', { class: 'pip' + (i <= lvl ? ' on' : '') + (isNamed ? ' named' : ''), title: isNamed ? named[i] : `${b.ru} ${i}` }));
    }
    const next = lvl + 1;
    const unlocked = branchUnlocked(br, next);
    const cost = branchCost(br, next);
    const affordable = canAfford(cost);
    const rankNeed = CFG.tech.rankRequiredPerLevel[next] || 0;

    const kids = [
      el('div', { class: 'branch-head' }, [
        el('span', { class: 'ic', text: b.icon }),
        el('span', { class: 'nm', text: b.ru }),
        el('span', { class: 'tag', text: `${lvl}/${b.levels}` }),
      ]),
      pips,
      el('div', { class: 'small muted', style: { margin: '8px 0', lineHeight: '1.45' }, html: effectText(br, lvl, lvl + 1) }),
    ];
    if (lvl < b.levels && rankNeed > (s.progress.rank || 0)) {
      kids.push(el('div', { class: 'small', style: { color: '#f0a89c', marginBottom: '6px' }, text: `🔒 ${t('ws_need_rank')}: ${rankListName(rankNeed)}` }));
    }
    if (lvl >= b.levels) {
      kids.push(el('div', { class: 'tag gold', text: t('max') }));
    } else {
      const costChips = Object.entries(cost).filter(([, v]) => v > 0)
        .map(([k, v]) => el('span', { class: 'res' + ((s.resources[k] || 0) < v ? ' lack' : ''), html: `<span class="ic">${RES.icon[k]}</span>${v}` }));
      kids.push(el('div', { class: 'row spread wrap', style: { gap: '8px' } }, [
        el('div', { class: 'row wrap', style: { gap: '5px' } }, costChips),
        // NOT disabled: a greyed no-op button feels broken — tap must explain itself
        el('button', {
          class: 'btn small ' + (affordable && unlocked ? 'primary' : 'ghost'),
          style: affordable && unlocked ? null : { opacity: '.55' },
          text: !unlocked && rankNeed > (s.progress.rank || 0) ? `${t('ws_need_rank')} ${rankNeed + 1}` : t('upgrade'),
          onclick: () => {
            const r = buyBranch(br);
            if (r.ok) {
              Audio.uiUnlock();
              const gained = namedGain(br, r.level);
              toast(`${b.icon} ${b.ru} → ур.${r.level}${gained ? ': ' + gained : ''}`, 'good', 3000);
              this.show('workshop');
            } else {
              Audio.uiError();
              const bpShort = cost.blueprints && (s.resources.blueprints || 0) < cost.blueprints;
              toast(r.reason === 'locked' ? t('locked') : (bpShort ? t('need_blueprints') : t('not_enough')), 'bad', 3400);
            }
          },
        }),
      ]));
    }
    card.append(...kids);
    body.appendChild(card);
  }

  // synergies
  const synCard = el('div', { class: 'card' });
  synCard.appendChild(el('h2', { text: t('ws_synergy') }));
  const active = activeSynergies();
  for (const syn of CFG.tech.synergies) {
    const on = active.includes(syn);
    synCard.appendChild(el('div', { class: 'synergy' + (on ? ' on' : '') }, [
      el('span', { class: 'ic', text: on ? '✅' : '🔒' }),
      el('div', { class: 'grow' }, [
        el('b', { text: syn.ru }),
        el('div', { class: 'd', text: syn.desc }),
        on ? null : el('div', { class: 'd', text: `${t('ws_synergy_locked')}: ` + Object.entries(syn.req).map(([k, v]) => `${CFG.tech.branches[k].ru} ${v}`).join(', ') }),
      ]),
    ]));
  }
  body.appendChild(synCard);

  return this.screen('', [this.head(t('ws_title'), () => this.show('menu')), body]);
};

function effectText(br, curLevel, nextLevel) {
  const e = CFG.tech.effects[br];
  const named = (e.nodes || {})[nextLevel];
  const per = Object.entries(e.perLevel || {}).map(([k, v]) => {
    const cur = Math.round(v * curLevel * 100);
    const nxt = Math.round(v * nextLevel * 100);
    const f = (x) => (x > 0 ? '+' : '') + x + '%';
    return `${t('ws_effect_' + k) || k}: <b style="color:var(--parchment)">${f(cur)}</b> → <b style="color:var(--gold)">${f(nxt)}</b>`;
  }).join('<br>');
  return per + (named ? `<br><span style="color:var(--gold)">★ ${namedText(named)}</span>` : '');
}
function namedGain(br, level) {
  const named = (CFG.tech.effects[br].nodes || {})[level];
  return named ? namedText(named) : Object.entries(CFG.tech.effects[br].perLevel || {}).map(([k, v]) => `${t('ws_effect_' + k)} ${v > 0 ? '+' : ''}${Math.round(v * 100)}%`).join(', ');
}
function rankListName(rankIdx) {
  const s = S();
  const list = (s.lang || 'ru') === 'en' ? CFG.ranks.listEn : CFG.ranks.list;
  return list[clamp(rankIdx, 0, list.length - 1)];
}
const NAMED_TEXT = {
  cockAuto: 'Авто-взвод: перезарядка на 15% быстрее',
  doubleCock: 'Двойной взвод: +6% мощности',
  overdrive: 'Форсаж: +8% мощности',
  windComp: 'Компенсатор ветра: дуга учитывает порывы',
  scopeZoom: 'Визир: зум камеры при наводке',
  ricochetPredict: 'Предсказание рикошета: вторая точка на дуге',
  ghostMaster: 'Призрачная трасса остаётся на 3 выстрела',
  fastRepair: 'Быстрый ремонт: −30% времени',
  autoRepair: 'Авторемонт: 1 узел чинится сам за миссию',
  workshopDiscount: 'Мастерская: ядра −15% снабжения',
  slot3: 'Третий боец в расчёте',
  slot4: 'Четвёртый боец в расчёте',
  veteran: 'Ветеран: опыт расчёта не сбрасывается',
  ammo_fire: 'Открывает зажигательное ядро',
  ammo_grapeshot: 'Открывает картечь',
  ammo_explosive: 'Открывает разрывное ядро',
  ammo_anchor: 'Открывает якорь-болт',
  ammo_hive: 'Открывает улей',
  ammo_truestone: 'Открывает точёное ядро',
};
function namedText(n) { return NAMED_TEXT[n] || n; }

// -------------------------------------------------------------------- CREW --
BUILDERS.crew = function () {
  const s = S();
  const body = el('div', { class: 'screen-body' });
  body.appendChild(this.resBar());
  const icons = { gunner: '🎯', loader: '💪', engineer: '🛠️', commander: '📯' };

  body.appendChild(el('div', { class: 'card' }, [
    el('h2', { text: t('cw_active_slots') }),
    el('div', { class: 'muted small', text: `${activeCrew().length}/${maxSlots()}` }),
    el('button', { class: 'btn small ghost', style: { marginTop: '8px' }, text: t('cw_rest') + ' — ' + t('cp_collect_all'), onclick: () => { restAll(); Audio.uiBuy(); toast('OK', 'good'); this.show('crew'); } }),
  ]));

  for (const c of roster()) {
    const isActive = s.crew.active.includes(c.id);
    const d = roleDef(c.role);
    const card = el('div', { class: 'crew-card' + (isActive ? ' active' : '') });
    const fatCls = c.fatigue > 85 ? 'crit' : c.fatigue > 50 ? 'warn' : '';
    card.append(
      el('div', { class: 'avatar', text: icons[c.role] }),
      el('div', { class: 'grow' }, [
        el('div', { class: 'row spread' }, [el('b', { text: `${c.name}` }), el('span', { class: 'tag', text: `${roleName(c.role, s.lang)} · ${t('level')} ${c.level}` })]),
        el('div', { class: 'small muted', style: { margin: '4px 0' }, text: `${t('cw_skill')}: ${d.skill.ru} (${d.skill.cd}с)` }),
        el('div', { class: 'small muted', style: { marginBottom: '4px' }, text: passiveText(d.passive) }),
        el('div', { class: 'row', style: { gap: '6px' } }, [
          el('span', { class: 'small muted', text: t('cw_fatigue') }),
          (() => { const b = el('div', { class: 'bar grow ' + fatCls }); b.appendChild(el('i', { style: { width: c.fatigue + '%' } })); return b; })(),
          el('span', { class: 'small', text: Math.round(c.fatigue) + '%' }),
        ]),
        el('div', { class: 'row', style: { gap: '6px', marginTop: '6px' } }, [
          el('span', { class: 'small muted', text: 'XP' }),
          (() => { const b = el('div', { class: 'bar thin grow' }); b.appendChild(el('i', { style: { width: pct(c.xp / xpForLevel(c.level)) + '%' } })); return b; })(),
        ]),
        el('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } }, [
          el('button', {
            class: 'btn small ' + (isActive ? 'ghost' : 'primary'),
            text: isActive ? '— ' + t('cw_active_slots') : '+ ' + t('cw_active_slots'),
            onclick: () => { const r = toggleActive(c.id); if (!r.ok) { Audio.uiError(); toast(t('locked'), 'bad'); } else { Audio.uiTap(); this.show('crew'); } },
          }),
          el('button', {
            class: 'btn small ghost', text: `${t('cw_train')} 🪙${trainCost(c.level)}`,
            onclick: () => { const r = trainCrew(c.id); if (r.ok) { Audio.levelUp(); this.show('crew'); } else { Audio.uiError(); toast(r.reason === 'max' ? t('max') : t('not_enough'), 'bad'); } },
          }),
          el('button', { class: 'btn small ghost', text: t('cw_rest'), onclick: () => { restCrew(c.id); Audio.uiBuy(); this.show('crew'); } }),
          el('button', { class: 'btn small ghost', text: `${t('cw_feed')} 🪙40`, onclick: () => { const r = feedCrew(c.id); r.ok ? (Audio.uiBuy(), this.show('crew')) : (Audio.uiError(), toast(t('not_enough'), 'bad')); } }),
        ]),
      ])
    );
    body.appendChild(card);
  }

  // hire
  const roles = Object.keys(CFG.crew.roles).filter((r) => !roster().some((c) => c.role === r));
  if (roles.length) {
    const hc = el('div', { class: 'card' });
    hc.appendChild(el('h2', { text: t('cw_hire') }));
    const idx = roster().length;
    const cost = CFG.crew.hireCost[clamp(idx, 1, 4)] || 1500;
    for (const r of roles) {
      hc.appendChild(el('div', { class: 'row spread', style: { padding: '6px 0', borderBottom: '1px dashed rgba(232,220,192,.1)' } }, [
        el('div', {}, [el('b', { text: `${icons[r]} ${roleName(r, s.lang)}` }), el('div', { class: 'small muted', text: CFG.crew.roles[r].skill.ru })]),
        el('button', { class: 'btn small primary', text: `🪙${cost}`, onclick: () => { const res = hire(r); res.ok ? (Audio.uiUnlock(), this.show('crew')) : (Audio.uiError(), toast(t('not_enough'), 'bad')); } }),
      ]));
    }
    body.appendChild(hc);
  }

  return this.screen('', [this.head(t('cw_title'), () => this.show('menu')), body]);
};
function passiveText(p) {
  const out = [];
  if (p.spread) out.push(`${t('ws_effect_spread')} ${Math.round(p.spread * 100)}%`);
  if (p.cockTime) out.push(`взвод ${Math.round(p.cockTime * 100)}%`);
  if (p.wear) out.push(`${t('ws_effect_wear')} ${Math.round(p.wear * 100)}%`);
  if (p.coins) out.push(`монеты +${Math.round(p.coins * 100)}%`);
  return t('cw_passive') + ': ' + (out.join(', ') || '—');
}

// -------------------------------------------------------------------- CAMP --
BUILDERS.camp = function () {
  const s = S();
  const body = el('div', { class: 'screen-body' });
  body.appendChild(this.resBar());

  const icons = { quarry: '⛏️', sawmill: '🪓', mine: '⚒️', ropery: '🪢', still: '🔥' };
  const card = el('div', { class: 'card' });
  card.append(el('h2', { text: t('cp_title') }), el('div', { class: 'row spread', style: { marginBottom: '9px' } }, [
    el('span', { class: 'muted small', text: `${t('cp_stored')}: ${fmt(Math.floor(pendingCamp()))}` }),
    el('button', { class: 'btn small primary', text: t('cp_collect_all'), onclick: () => { const n = collectAll(); if (n > 0) { Audio.coins(4); toast(`+${fmt(n)}`, 'good'); this.show('camp'); } else { Audio.uiError(); toast(t('camp_nothing'), '', 2000); } } }),
  ]));
  body.appendChild(card);

  for (const key in CFG.camp.buildings) {
    const def = CFG.camp.buildings[key];
    const b = s.camp.buildings[key];
    const lvl = b.level;
    const cap = campCap(key, lvl);
    const cost = campUpgradeCost(key, lvl);
    const row = el('div', { class: 'building' });
    row.append(
      el('div', { class: 'ic', text: icons[key] }),
      el('div', { class: 'info' }, [
        el('div', { class: 'row spread' }, [el('span', { class: 'nm', text: def.ru }), el('span', { class: 'tag', text: lvl ? `${t('level')} ${lvl}` : t('locked') })]),
        lvl ? el('div', { class: 'small muted', text: `${t('cp_rate')}: ${campRate(key, lvl).toFixed(1)} · ${t('cp_stored')}: ${fmt(Math.floor(b.stored || 0))}/${fmt(cap)} ${RES.icon[def.res]}` })
          : el('div', { class: 'small muted', text: '—' }),
        lvl ? (() => { const bar = el('div', { class: 'bar thin', style: { marginTop: '5px' } }); bar.appendChild(el('i', { style: { width: pct((b.stored || 0) / cap) + '%' } })); return bar; })() : null,
        el('div', { class: 'row wrap', style: { gap: '6px', marginTop: '7px' } }, [
          lvl ? el('button', { class: 'btn small ghost', text: t('cp_collect'), onclick: () => { const n = collectBuilding(key); if (n > 0) { Audio.coins(3); this.show('camp'); } else { Audio.uiError(); toast(t('camp_nothing'), '', 2000); } } }) : null,
          el('button', {
            class: 'btn small primary', text: `${lvl ? t('upgrade') : t('buy')} · ` + Object.entries(cost).map(([k, v]) => `${RES.icon[k]}${v}`).join(' '),
            onclick: () => { const r = upgradeBuilding(key); r.ok ? (Audio.uiUnlock(), this.show('camp')) : (Audio.uiError(), toast(t('not_enough'), 'bad')); },
          }),
        ]),
      ])
    );
    body.appendChild(row);
  }

  // market
  const market = el('div', { class: 'card' });
  market.appendChild(el('h2', { text: t('cp_market') }));
  for (const id of ['stone', 'wood', 'metal', 'rope', 'pitch']) {
    const bPrice = Math.ceil(CFG.market.buy[id] * CFG.market.bundle);
    const sPrice = Math.floor(CFG.market.sell[id] * CFG.market.bundle);
    market.appendChild(el('div', { class: 'row spread', style: { padding: '5px 0', borderBottom: '1px dashed rgba(232,220,192,.1)' } }, [
      el('span', { html: `${RES.icon[id]} ${RES.ru[id]} ×${CFG.market.bundle}` }),
      el('div', { class: 'row', style: { gap: '5px' } }, [
        el('button', { class: 'btn small ghost', text: `${t('buy')} 🪙${bPrice}`, onclick: () => { const r = buyResource(id); r.ok ? (Audio.uiBuy(), this.show('camp')) : (Audio.uiError(), toast(t('not_enough'), 'bad')); } }),
        el('button', { class: 'btn small ghost', text: `${t('sell')} +🪙${sPrice}`, onclick: () => { const r = sellResource(id); r.ok ? (Audio.coins(2), this.show('camp')) : (Audio.uiError(), toast(t('not_enough'), 'bad')); } }),
      ]),
    ]));
  }
  body.appendChild(market);

  return this.screen('', [this.head(t('cp_title'), () => this.show('menu')), body]);
};

// -------------------------------------------------------------------- AMMO --
BUILDERS.ammo = function () {
  const s = S();
  const body = el('div', { class: 'screen-body' });
  body.appendChild(this.resBar());
  body.appendChild(el('div', { class: 'card' }, [
    el('h2', { text: t('aw_title') }),
    el('div', { class: 'small muted', style: { lineHeight: '1.45' }, text: t('brief_ammo_hint') }),
  ]));
  const avail = unlockedAmmo();
  for (const id of CFG.ammoOrder) {
    const a = CFG.ammo[id];
    const open = avail.includes(id);
    const cost = ammoCost(id, computeMods().ammoDiscount);
    const card = el('div', { class: 'card', style: { opacity: open ? '1' : '.55' } });
    card.append(
      el('div', { class: 'row spread' }, [
        el('b', { text: `${a.ru}` }),
        open ? el('span', { class: 'tag good', text: t('cw_ready') }) : el('span', { class: 'tag bad', html: ammoLockLabel(id, a) }),
      ]),
      el('div', { class: 'small muted', style: { margin: '4px 0' }, text: t('ammo_' + id + '_d') }),
      el('div', { class: 'row wrap', style: { gap: '6px' } }, [
        el('span', { class: 'res', html: `💥 ${a.dmg}` }),
        el('span', { class: 'res', html: `⚖️ ${a.mass}кг` }),
        a.radius ? el('span', { class: 'res', html: `☄️ r${a.radius}м` }) : null,
        a.dot ? el('span', { class: 'res', html: `🔥 ${a.dot}/с` }) : null,
        a.pierce ? el('span', { class: 'res', text: '↯ пробитие' }) : null,
      ]),
      el('div', { class: 'row wrap', style: { gap: '5px', marginTop: '7px' } },
        Object.entries(cost).map(([k, v]) => el('span', { class: 'res', style: { padding: '1px 7px', fontSize: '.85em' }, html: `${RES.icon[k]}${v} / ${s.lang === 'en' ? 'shot' : 'выстрел'}` }))),
    );
    body.appendChild(card);
  }
  return this.screen('', [this.head(t('aw_title'), () => this.show('menu')), body]);
};

/** lock label: rank name required + the tech branch alternative that also opens it */
function ammoLockLabel(id, a) {
  const s = S();
  const list = (s.lang || 'ru') === 'en' ? CFG.ranks.listEn : CFG.ranks.list;
  let out = `${t('locked')} · ${t('ws_need_rank')}: ${list[clamp(a.unlock, 0, list.length - 1)]}`;
  const node = Object.entries(CFG.tech.effects.ordnance.nodes || {}).find(([, v]) => v === 'ammo_' + id);
  if (node) out += ` · ${t('ammo_tech_alt', { b: t('ws_branch_ordnance'), n: node[0] })}`;
  return out;
}

// ---------------------------------------------------------------- SETTINGS --
// `origin` tells where "back" must return to: opening settings from the pause
// menu used to drop the player into the main menu — i.e. it silently kicked
// them out of the battle. Now the screen remembers its entry point.
BUILDERS.settings = function (params = {}) {
  const s = S();
  const set = s.settings;
  const origin = params.origin || 'menu';
  const back = () => {
    if (origin === 'pause') {
      // the battle might have ended while settings were open (pending-end timers)
      if (this.game.inBattle) this.game.onPause();
      else this.show('menu');
    } else this.show(origin);
  };
  const body = el('div', { class: 'screen-body' });

  const section = (title) => { const c = el('div', { class: 'card' }); c.appendChild(el('h2', { text: title })); body.appendChild(c); return c; };
  const toggle = (parent, label, key, onchange) => {
    const sw = el('div', { class: 'switch' + (set[key] ? ' on' : '') }, [el('i')]);
    sw.addEventListener('click', () => { set[key] = !set[key]; sw.classList.toggle('on', set[key]); Audio.uiTap(); Save.markDirty(); this.game.applySettings(); onchange && onchange(set[key]); });
    parent.appendChild(el('div', { class: 'setting' }, [el('div', { class: 'nm', text: label }), sw]));
  };
  const slider = (parent, label, key, min, max, step, fmtFn) => {
    const val = el('b', { text: fmtFn(set[key]) });
    const inp = el('input', { type: 'range', min, max, step, value: set[key] });
    inp.addEventListener('input', () => { set[key] = parseFloat(inp.value); val.textContent = fmtFn(set[key]); Save.markDirty(); this.game.applySettings(); });
    inp.addEventListener('change', () => Audio.uiTap());
    parent.appendChild(el('div', { class: 'setting' }, [el('div', { class: 'nm', text: label }), val, inp]));
  };
  const seg = (parent, label, key, options, opt = {}) => {
    const getV = opt.get || (() => set[key]);
    const wrap = el('div', { class: 'seg' });
    const upd = () => { for (const b of wrap.children) b.classList.toggle('on', b.dataset.v === String(getV())); };
    for (const o of options) {
      const b = el('button', {
        dataset: { v: o.v }, text: o.l,
        onclick: () => {
          if (opt.onPick) opt.onPick(o.v); else set[key] = o.v;
          upd(); Audio.uiTap(); Save.markDirty(); this.game.applySettings();
          if (opt.rebuild) this.show('settings', params);   // refresh dependent widgets
        },
      });
      wrap.appendChild(b);
    }
    upd();
    parent.appendChild(el('div', { class: 'setting' }, [el('div', { class: 'nm', text: label }), wrap]));
  };

  const g = section(t('st_graphics'));
  // manual quality pick turns the auto-tuner off (otherwise it silently
  // overrides the user's choice on the next frame measurement)
  seg(g, t('st_quality'), 'quality', [{ v: 0, l: t('st_q_high') }, { v: 1, l: t('st_q_med') }, { v: 2, l: t('st_q_low') }],
    { onPick: (v) => { set.quality = v; set.autoQuality = false; }, rebuild: true });
  toggle(g, t('st_quality_auto'), 'autoQuality');
  toggle(g, t('st_shadows'), 'shadows');
  toggle(g, t('st_post'), 'postFx');
  toggle(g, t('st_camera_dynamic'), 'cameraDynamic');
  toggle(g, t('st_fps'), 'showFps', (v) => { CFG.dev.showFps = v; });

  const snd = section(t('st_sound'));
  toggle(snd, t('st_mute'), 'muted');
  slider(snd, t('st_music'), 'music', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
  slider(snd, t('st_sfx'), 'sfx', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
  slider(snd, t('st_ui'), 'ui', 0, 1, 0.05, (v) => Math.round(v * 100) + '%');
  toggle(snd, t('st_haptics'), 'haptics');

  const ctl = section(t('st_controls'));
  slider(ctl, t('st_sens_az'), 'sensAz', 0.4, 2.2, 0.05, (v) => v.toFixed(2) + '×');
  slider(ctl, t('st_sens_el'), 'sensEl', 0.4, 2.2, 0.05, (v) => v.toFixed(2) + '×');
  slider(ctl, t('st_sens_power'), 'sensPower', 0.4, 2.2, 0.05, (v) => v.toFixed(2) + '×');
  toggle(ctl, t('st_invert_y'), 'invertOrbitY');
  toggle(ctl, t('st_left_hand'), 'leftHanded');
  toggle(ctl, t('st_precision'), 'precisionAim', (v) => { if (this.game.hud) this.game.hud.togglePrecision(v); });
  toggle(ctl, t('st_assist'), 'aimAssist');
  toggle(ctl, t('st_predict'), 'showPredict');
  toggle(ctl, t('st_ghost'), 'ghostTrail');

  const acc = section(t('st_access'));
  slider(acc, t('st_ui_scale'), 'uiScale', CFG.a11y.uiScaleMin, CFG.a11y.uiScaleMax, 0.05, (v) => v.toFixed(2) + '×');
  seg(acc, t('st_colorblind'), 'colorBlind', [{ v: 'off', l: '—' }, { v: 'deuteranopia', l: 'D' }, { v: 'protanopia', l: 'P' }, { v: 'tritanopia', l: 'T' }]);
  toggle(acc, t('st_reduce_motion'), 'reduceMotion');
  toggle(acc, t('st_subtitles'), 'subtitles');
  // language lives on the save root (S().lang), not inside settings
  seg(acc, t('st_lang'), null, [{ v: 'ru', l: 'RU' }, { v: 'en', l: 'EN' }], {
    get: () => S().lang || 'ru',
    onPick: (v) => { S().lang = v; },
    rebuild: true,   // re-render the screen so every label switches language
  });

  const dev = section(t('st_debug'));
  toggle(dev, '🧪 Режим тестера (панель механик в бою)', 'testerMode', (v) => { this.game.syncTesterUi(); });
  toggle(dev, 'God mode (ресурсы ∞)', 'godMode', (v) => { CFG.dev.godMode = v; });
  toggle(dev, 'Мгновенный взвод', 'instantCock', (v) => { CFG.dev.instantCock = v; });
  dev.appendChild(el('div', { class: 'row wrap', style: { gap: '6px', marginTop: '8px' } }, [
    el('button', {
      class: 'btn small ghost', text: 'Экспорт сейва',
      onclick: async () => {
        const str = Save.export();
        try { await navigator.clipboard.writeText(str); toast('Скопировано', 'good'); }
        catch (e) {
          const ta = el('textarea', { style: 'width:100%;height:120px' });
          ta.value = str;
          await modal({
            title: 'Save', dismissable: false,
            body: el('div', {}, [el('div', { class: 'small muted', style: { marginBottom: '6px' }, text: 'Скопируйте код сейва:' }), ta]),
            actions: [{ label: t('close'), value: true, class: 'primary' }],
          });
        }
      },
    }),
    el('button', {
      class: 'btn small ghost', text: 'Импорт сейва',
      // window.prompt() is a no-op in Android WebView — use a real modal instead
      onclick: async () => {
        const ta = el('textarea', { style: 'width:100%;height:120px' });
        const ok = await modal({
          title: 'Импорт сейва',
          body: el('div', {}, [el('div', { class: 'small muted', style: { marginBottom: '6px' }, text: 'Вставьте код сейва:' }), ta]),
          actions: [{ label: t('cancel'), value: false, class: 'ghost' }, { label: t('ok'), value: true, class: 'primary' }],
        });
        if (!ok) return;
        const str = (ta.value || '').trim();
        if (str && Save.import(str)) { toast('OK', 'good'); this.game.applySettings(); this.show('menu'); }
        else toast('Ошибка импорта', 'bad');
      },
    }),
    el('button', {
      class: 'btn small danger', text: t('st_reset'),
      onclick: async () => { if (await confirmBox(t('menu_reset'), t('menu_reset_warn'), t('confirm'), t('cancel'))) { Save.reset(); location.reload(); } },
    }),
  ]));
  dev.appendChild(el('div', { class: 'small muted', style: { marginTop: '8px' }, text: `v${CFG.VERSION} · ${TECH_NODE_COUNT} узлов · build ${BUILD_HASH}` }));

  return this.screen('', [this.head(t('st_title'), back), body]);
};

// ------------------------------------------------------------------- PAUSE --
BUILDERS.pause = function ({ onResume }) {
  const body = el('div', { class: 'screen-body center', style: { display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: '10px' } });
  body.append(
    el('button', { class: 'btn primary', style: { width: '100%', minHeight: '56px' }, text: t('pz_resume'), onclick: () => { Audio.uiTap(); onResume(); } }),
    el('button', { class: 'btn ghost', style: { width: '100%' }, text: t('st_title'), onclick: () => { Audio.uiTap(); this.show('settings', { origin: 'pause' }); } }),
    el('button', { class: 'btn ghost', style: { width: '100%' }, text: t('pz_restart'), onclick: async () => { if (await confirmBox(t('pz_restart'), t('pz_retreat_warn'), t('confirm'), t('cancel'))) { Audio.uiTap(); this.game.restartMission(); } } }),
    el('button', { class: 'btn danger', style: { width: '100%' }, text: t('pz_retreat'), onclick: async () => { if (await confirmBox(t('pz_retreat'), t('pz_retreat_warn'), t('confirm'), t('cancel'))) { Audio.uiBack(); this.game.endMission(false, true); } } }),
    el('button', { class: 'btn ghost', style: { width: '100%' }, text: t('menu_exit'), onclick: async () => { if (await confirmBox(t('menu_exit'), 'Закрыть приложение? Прогресс сохранён.', t('confirm'), t('cancel'))) this.game.exitApp(true); } }),
  );
  return this.screen('', [this.head(t('pz_title'), () => onResume()), body]);
};

/** DOM confetti burst for victory screens */
function spawnConfetti(root) {
  const wrap = el('div', { class: 'confetti' });
  const colors = ['#d9a62e', '#b3372c', '#5c8a3a', '#4a8fb5', '#e8dcc0', '#8a6ab3'];
  for (let i = 0; i < 70; i++) {
    const p = el('i');
    p.style.left = Math.random() * 100 + '%';
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = (Math.random() * 1.4).toFixed(2) + 's';
    p.style.animationDuration = (2.4 + Math.random() * 2.2).toFixed(2) + 's';
    p.style.transform = `rotate(${Math.random() * 360}deg)`;
    p.style.width = (5 + Math.random() * 7) + 'px';
    p.style.height = (8 + Math.random() * 10) + 'px';
    wrap.appendChild(p);
  }
  root.appendChild(wrap);
  setTimeout(() => wrap.remove(), 6000);
}

export const BUILD_HASH = typeof __BUILD_HASH__ !== 'undefined' ? __BUILD_HASH__ : 'dev';
