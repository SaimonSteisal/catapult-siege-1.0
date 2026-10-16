// ============================================================================
//  ui/hud.js — in-battle heads-up display (§5)
// ============================================================================
import { CFG } from '../config.js';
import { t } from '../core/i18n.js';
import { el, qs, clear, toast, holdButton } from './dom.js';
import { clamp, fmt, pct } from '../core/utils.js';
import { Input } from '../core/input.js';
import { Audio } from '../core/audio.js';
import { S } from '../core/save.js';
import { roleDef } from '../systems/crew.js';
import { vibrate } from '../core/utils.js';

const RES = CFG.resources;

export class BattleHUD {
  constructor(root, game) {
    this.game = game;
    this.root = root;
    this.visible = false;
    this.aimValues = { az: 0, el: 45, power: 0.7 };
    this._build();
    this._bind();
    this._lastSupply = -1;
  }

  // ------------------------------------------------------------------- build ---
  _build() {
    this.node = el('div', { id: 'hud' });

    // ---- top bar
    const top = el('div', { class: 'hud-top' });
    this.objBox = el('div', { class: 'hud-panel hud-obj', html: `<div class="t">${t('hud_target')}</div><div class="d"></div>` });
    this.resBox = el('div', { class: 'hud-panel hud-res' });
    top.append(this.objBox, el('div', { class: 'grow' }), this.resBox);
    this.node.appendChild(top);

    // ---- wind rose
    const wind = el('div', { id: 'windbox' });
    wind.innerHTML = `
      <div class="hud-panel" style="padding:4px 8px;display:flex;flex-direction:column;align-items:center;gap:1px">
        <svg id="windrose" viewBox="0 0 52 52">
          <circle cx="26" cy="26" r="23" fill="none" stroke="rgba(232,220,192,.28)" stroke-width="1.5"/>
          <circle cx="26" cy="26" r="15" fill="none" stroke="rgba(232,220,192,.14)" stroke-width="1"/>
          <g id="windarrow" transform="rotate(0 26 26)">
            <path d="M26 8 L31 22 L26 19 L21 22 Z" fill="#ffd27a"/>
            <path d="M26 44 L26 22" stroke="rgba(255,210,122,.5)" stroke-width="2"/>
          </g>
          <text x="26" y="7" text-anchor="middle" font-size="7" fill="rgba(232,220,192,.6)">С</text>
        </svg>
        <div id="windspeed">0 м/с</div>
      </div>`;
    this.node.appendChild(wind);
    this.windArrow = wind.querySelector('#windarrow');
    this.windSpeed = wind.querySelector('#windspeed');

    // ---- timer (DEFEND)
    this.timerBox = el('div', { class: 'hud-panel', style: { position: 'absolute', top: 'calc(70px + var(--safe-t))', left: '50%', transform: 'translateX(-50%)', fontWeight: '700' } });
    this.timerBox.style.display = 'none';
    this.node.appendChild(this.timerBox);

    // ---- node status / repair panel
    this.nodePanel = el('div', { id: 'nodepanel' });
    this.nodePanel.style.display = 'none';
    this.node.appendChild(this.nodePanel);

    // ---- selected target HP bar (world-anchored DOM)
    this.targetBar = el('div', { id: 'targetbar', style: { display: 'none' } });
    this.targetBar.innerHTML = `<div class="tb-n"></div><div class="bar thin"><i style="width:100%"></i></div>`;
    this.node.appendChild(this.targetBar);


    // ---- bottom cluster
    const bottom = el('div', { class: 'hud-bottom' });

    // aim pad
    this.aimPad = el('div', { id: 'aimpad' });
    this.aimPad.innerHTML = `
      <div id="aimread"><span class="az">${t('hud_az')} 0.0°</span><span class="el">${t('hud_el')} 45°</span><span class="pw">${t('hud_pwr')} 70%</span><span class="cep">±0.0 м</span><span class="streak" style="display:none"></span></div>
      <div class="axis axis-h">⇄ ${t('hud_az')}</div>
      <div class="axis axis-v">⇅ ${t('hud_el')}</div>
      <div class="axis axis-p">⤢ ${t('hud_pwr')}</div>
      <div class="knob"><b>◎</b></div>
      <div class="hint">${t('hud_drag_hint')}</div>
      <div id="powerstrip"><i></i><b>70%</b></div>
      <div id="cancelzone">${t('hud_cancel_hint')}</div>`;
    this.knob = this.aimPad.querySelector('.knob');
    this.readAz = this.aimPad.querySelector('.az');
    this.readEl = this.aimPad.querySelector('.el');
    this.readPw = this.aimPad.querySelector('.pw');
    this.readCep = this.aimPad.querySelector('.cep');
    this.streakEl = this.aimPad.querySelector('.streak');
    this.hintEl = this.aimPad.querySelector('.hint');
    this.cancelEl = this.aimPad.querySelector('#cancelzone');
    this.stripEl = this.aimPad.querySelector('#powerstrip');
    this.stripFill = this.stripEl.querySelector('i');
    this.stripVal = this.stripEl.querySelector('b');

    // right column
    const right = el('div', { class: 'hud-right' });
    this.skillRow = el('div', { class: 'skill-row' });
    this.toolRow = el('div', { class: 'tool-row' });
    this.ammoStrip = el('div', { class: 'ammo-strip' });
    this.fireBtn = el('button', { id: 'firebtn', html: `${t('hud_fire')}<span class="sub"></span>` });

    // tools: repair (hold), inspect, camera, tester, pause
    this.repairBtn = el('button', { class: 'tool-btn', html: `<span class="ic">🛠️</span><span>${t('hud_repair')}</span>` });
    this.inspectBtn = el('button', { class: 'tool-btn', html: `<span class="ic">🔍</span><span>${t('hud_inspect')}</span>` });
    this.camBtn = el('button', { class: 'tool-btn', title: t('cam_reset'), html: `<span class="ic">⌂</span>`, onclick: () => { Audio.uiTap(); this.game.resetCamera(); } });
    this.pauseBtn = el('button', { class: 'tool-btn', html: `<span class="ic">⏸</span>` });
    this.testBtn = el('button', { class: 'tool-btn', title: 'Tester mode', html: `<span class="ic">🧪</span>`, onclick: () => { Audio.uiTap(); this.game.toggleDevPanel(); } });
    this.testBtn.style.display = S().settings.testerMode ? '' : 'none';
    this.toolRow.append(this.repairBtn, this.inspectBtn, this.camBtn, this.testBtn, this.pauseBtn);

    right.append(this.skillRow, this.ammoStrip, this.toolRow, this.fireBtn);
    bottom.append(this.aimPad, right);
    this.node.appendChild(bottom);

    // fps
    this.fpsEl = el('div', { id: 'fps' });
    this.node.appendChild(this.fpsEl);

    // sound subtitles (accessibility setting `subtitles`)
    this.subsEl = el('div', { id: 'subs' });
    this.node.appendChild(this.subsEl);

    this.root.appendChild(this.node);
    requestAnimationFrame(() => this._syncZones());
    window.addEventListener('resize', () => this._syncZones());
    window.addEventListener('orientationchange', () => setTimeout(() => this._syncZones(), 220));
  }

  _syncZones() {
    const vp = qs('#viewport');
    if (!vp || !this.aimPad) return;
    const vpR = vp.getBoundingClientRect();
    const r = this.aimPad.getBoundingClientRect();
    // NOTE: #cancelzone is display:none until a drag starts, so its rect can NOT
    // be measured here. Derive the centre from the pad rect + CSS offsets:
    // the circle now lives at the LEFT END of the power strip (bottom:44px, left:10px).
    const size = 92, off = 10, stripGap = 44;
    const leftHanded = !!S().settings.leftHanded;
    const cx = leftHanded
      ? (r.left - vpR.left) + r.width - off - size / 2
      : (r.left - vpR.left) + off + size / 2;
    const cy = (r.top - vpR.top) + r.height - stripGap - size / 2;
    Input.setAimZone(
      { x: r.left - vpR.left, y: r.top - vpR.top, w: r.width, h: r.height },
      { x: cx, y: cy },
      CFG.aim.cancelZonePx
    );
  }

  /** sound subtitles — visible captions of key audio events (a11y setting) */
  subtitle(text) {
    if (!S().settings.subtitles || !this.subsEl) return;
    this.subsEl.textContent = text;
    this.subsEl.classList.add('on');
    clearTimeout(this._subsT);
    this._subsT = setTimeout(() => this.subsEl.classList.remove('on'), 1900);
  }

  // ------------------------------------------------------------------- bind ---
  _bind() {
    Input.on('aimstart', (d) => {
      this.aimPad.classList.add('active');
      this.cancelEl.classList.add('on');
      this.hintEl.style.opacity = '0';
      this._aimStart = { ...this.aimValues };
      this._lastDx = this._lastDy = 0;
      // zone by start point: the power strip never fires on release
      const sr = this.stripEl.getBoundingClientRect();
      this._aimZone = (d.y >= sr.top - 4) ? 'power' : 'stick';
      this.game.onAimStart();
    });
    Input.on('aimmove', (d) => {
      const st = S().settings;
      const a0 = this._aimStart || this.aimValues;
      const fine = d.fine ? (CFG.aim.fineMul || 0.25) : 1;   // second finger = fine mode
      if (this._aimZone === 'power') {
        // absolute mapping along the strip: left = min power, right = max
        const sr = this.stripEl.getBoundingClientRect();
        const k = clamp((d.x - sr.left) / Math.max(1, sr.width), 0, 1);
        const ps = CFG.aim.powerStrip || { min: CFG.ballistics.powerMin, max: CFG.ballistics.powerMax };
        this.aimValues.power = clamp(ps.min + k * (ps.max - ps.min), CFG.ballistics.powerMin, CFG.ballistics.powerMax);
      } else {
        // stick zone: azimuth/elevation ONLY — power no longer coupled to drag radius
        this.aimValues.az = clamp(a0.az - d.dx * CFG.aim.azDegPerPx * (st.sensAz || 1) * fine, CFG.ballistics.azimuthMin, CFG.ballistics.azimuthMax);
        this.aimValues.el = clamp(a0.el - d.dy * CFG.aim.elDegPerPx * (st.sensEl || 1) * (st.invertOrbitY ? -1 : 1) * fine, CFG.ballistics.elevationMin, CFG.ballistics.elevationMax);
      }
      this.game.hudAimChanged(this.aimValues);
      this.aimPad.classList.toggle('fine', !!d.fine);
      // knob position (stick zone only)
      const r = this.aimPad.getBoundingClientRect();
      const kx = clamp(r.width / 2 + (this._aimZone === 'stick' ? d.dx : 0), 34, r.width - 34);
      const ky = clamp(r.height * 0.62 + (this._aimZone === 'stick' ? d.dy : 0), 34, r.height - 34 - 40);
      this.knob.style.left = kx + 'px';
      this.knob.style.top = ky + 'px';
      this.knob.style.transform = `translate(-50%,-50%) scale(${1 + this.aimValues.power * 0.35})`;
      // cancel zone proximity (computed centre — the element itself is hidden)
      const zone = Input.aimCancelCenter;
      const near = zone && Math.hypot(d.x - zone.x, d.y - zone.y) < CFG.aim.cancelZonePx + 26;
      this.cancelEl.style.background = near ? 'rgba(179,55,44,.55)' : '';
      this.cancelEl.style.borderColor = near ? 'rgba(255,120,100,.9)' : '';
    });
    const endAim = () => {
      this.aimPad.classList.remove('active');
      this.aimPad.classList.remove('fine');
      this.cancelEl.classList.remove('on');
      this.cancelEl.style.background = '';
      this.knob.style.left = '50%'; this.knob.style.top = '62%'; this.knob.style.transform = 'translate(-50%,-50%)';
      this._lastDx = this._lastDy = 0;
    };
    Input.on('aimend', (d) => {
      const zone = this._aimZone;
      endAim();
      if (zone === 'power') { Audio.uiTap(); return; }   // strip commit ≠ shot
      this.game.onAimRelease(this.aimValues);
    });
    Input.on('aimcancel', () => { endAim(); this.game.onAimCancel(); Audio.uiBack(); });

    this.fireBtn.addEventListener('click', () => { Audio.uiTap(); vibrate(14); this.game.onFireButton(); });
    this.pauseBtn.addEventListener('click', () => { Audio.uiBack(); this.game.onPause(); });
    this.inspectBtn.addEventListener('click', () => { Audio.uiTap(); this.toggleNodes(); });
    holdButton(this.repairBtn, CFG.settings_repairHold || 700, () => this.game.onRepair(true), (k) => { this.repairBtn.style.background = `linear-gradient(90deg, rgba(92,138,58,.55) ${k * 100}%, rgba(20,16,12,.8) ${k * 100}%)`; },
      () => { Audio.uiError(); toast(t('hint_hold_repair'), '', 2000); });
  }

  // ------------------------------------------------------------------ state ---
  show(v) {
    this.visible = v;
    this.node.style.display = v ? '' : 'none';
    Input.setEnabled(v);
    if (v) {
      this._syncZones(); this.buildAmmo(); this.buildSkills();
      if (this.testBtn) this.testBtn.style.display = S().settings.testerMode ? '' : 'none';
    }
  }

  toggleNodes(force) {
    const on = force === undefined ? this.nodePanel.style.display === 'none' : force;
    this.nodePanel.style.display = on ? '' : 'none';
    if (on) this.renderNodes();
    this.game.onInspect(on);
  }

  setObjective(text, sub) {
    this.objBox.querySelector('.t').textContent = text;
    this.objBox.querySelector('.d').innerHTML = sub || '';
  }

  setResources(entries) {
    // entries: [{id, value, icon, lack}]
    let html = '';
    for (const e of entries) html += `<span class="res ${e.lack ? 'lack' : ''}"><span class="ic">${e.icon}</span><span class="v">${e.value}</span></span>`;
    if (this.resBox.innerHTML !== html) this.resBox.innerHTML = html;
  }

  setWind(hud) {
    this.windArrow.setAttribute('transform', `rotate(${(hud.dirDeg + 180).toFixed(0)} 26 26)`);
    // «Чтец ветра»: forecast 3 s ahead next to the current speed
    this.windSpeed.textContent = hud.forecast !== undefined
      ? `${hud.speed.toFixed(1)} → ${hud.forecast.toFixed(1)} м/с`
      : `${hud.speed.toFixed(1)} м/с`;
    this.windSpeed.style.color = hud.speed > 8 ? '#ffb0a0' : hud.speed > 4 ? '#ffd27a' : '';
  }

  setTimer(sec, label) {
    if (sec === null) { this.timerBox.style.display = 'none'; return; }
    this.timerBox.style.display = '';
    this.timerBox.textContent = `${label || t('hud_time')}: ${Math.max(0, sec).toFixed(0)}с`;
    this.timerBox.style.color = sec < 15 ? '#ff9a86' : '';
  }

  setAimReadout(v) {
    this.aimValues = v;
    this.readAz.textContent = `${t('hud_az')} ${v.az.toFixed(1)}°`;
    this.readEl.textContent = `${t('hud_el')} ${v.el.toFixed(1)}°`;
    this.readPw.textContent = `${t('hud_pwr')} ${Math.round(v.power * 100)}%`;
    if (this.stripFill) {
      const ps = CFG.aim.powerStrip || { min: CFG.ballistics.powerMin, max: CFG.ballistics.powerMax };
      const k = clamp((v.power - ps.min) / (ps.max - ps.min), 0, 1);
      this.stripFill.style.width = (k * 100).toFixed(0) + '%';
      this.stripVal.textContent = Math.round(v.power * 100) + '%';
    }
  }

  /** consecutive-impact streak badge (🔥 ×N from 2 hits, no misses between) */
  setStreak(n) {
    if (!this.streakEl) return;
    if (n >= 2) {
      const txt = `🔥 ×${n}`;
      if (this.streakEl.textContent !== txt) {
        this.streakEl.textContent = txt;
        this.streakEl.classList.remove('pop');
        void this.streakEl.offsetWidth;
        this.streakEl.classList.add('pop');
      }
      this.streakEl.style.display = '';
    } else this.streakEl.style.display = 'none';
  }

  setCep(m) {
    if (!this.readCep) return;
    this.readCep.textContent = `±${m.toFixed(1)} м`;
    this.readCep.style.color = m > 4 ? '#ff9a86' : m > 2 ? '#ffd27a' : '#b8e88a';
  }

  setFireEnabled(on, label) {
    this.fireBtn.disabled = !on;
    this.fireBtn.querySelector('.sub').textContent = label || '';
  }

  buildAmmo() {
    clear(this.ammoStrip);
    const game = this.game;
    const list = game.availableAmmo();
    for (const id of list) {
      const a = CFG.ammo[id];
      const left = (game.loadout && game.loadout[id]) || 0;
      const owned = left > 0;
      if (!owned && !game.inBattle) continue;
      const chip = el('div', {
        class: 'ammo-chip' + (game.selectedAmmo === id ? ' sel' : '') + (owned ? '' : ' locked'),
        html: `<div class="n">${a.ru}</div><div class="c">×${left}</div>`,
        onclick: () => {
          if (!owned) { Audio.uiError(); toast('Нет таких ядер в запасе', 'bad'); return; }
          Audio.uiTap(); vibrate(8); game.selectAmmo(id); this.buildAmmo();
        },
      });
      this.ammoStrip.appendChild(chip);
    }
  }

  /** world-anchored HP bar of the selected target */
  updateTargetBar(target, screenPos, visible) {
    if (!target || !visible) { this.targetBar.style.display = 'none'; return; }
    const ratio = clamp(target.hp / target.hp0, 0, 1);
    const def = CFG.targetTypes[target.type] || {};
    this.targetBar.style.display = 'block';
    this.targetBar.style.transform = `translate(-50%,-100%) translate(${screenPos.x.toFixed(0)}px,${screenPos.y.toFixed(0)}px)`;
    this.targetBar.querySelector('.tb-n').textContent = `${def.ru || target.type} · ${Math.round(ratio * 100)}%`;
    const bar = this.targetBar.querySelector('.bar');
    bar.className = 'bar thin' + (ratio < 0.35 ? ' crit' : ratio < 0.7 ? ' warn' : '');
    bar.firstChild.style.width = (ratio * 100).toFixed(0) + '%';
  }
  flashTargetBar() {
    this.targetBar.classList.remove('flash');
    void this.targetBar.offsetWidth;
    this.targetBar.classList.add('flash');
  }

  buildSkills() {
    clear(this.skillRow);
    const crew = this.game.activeCrewList();
    const icons = { gunner: '🎯', loader: '💪', engineer: '🛠️', commander: '📯' };
    for (const c of crew) {
      const cd = (roleDef(c.role) || { skill: { cd: 30 } }).skill.cd;
      const b = el('div', {
        class: 'skill-btn', dataset: { id: c.id, cd: String(cd) },
        html: `<span>${icons[c.role] || '★'}</span><span class="cd"></span><span class="lbl">${c.name.slice(0, 6)}</span>`,
        onclick: () => { const r = this.game.useSkill(c.id); if (!r.ok) { Audio.uiError(); toast(r.reason === 'cooldown' ? `${Math.ceil(r.left)}с` : t('cw_tired'), 'bad'); } },
      });
      this.skillRow.appendChild(b);
    }
    if (!crew.length) this.skillRow.appendChild(el('div', { class: 'muted small', text: '—' }));
  }

  updateSkillCooldowns(map) {
    for (const node of this.skillRow.children) {
      const id = node.dataset && node.dataset.id;
      if (!id) continue;
      const left = map[id] || 0;
      const cd = node.querySelector('.cd');
      // per-skill cooldown length (was hardcoded to 30 — wrong for 45/60/90 s skills)
      const total = parseFloat(node.dataset && node.dataset.cd) || 30;
      if (left > 0) {
        cd.style.setProperty('--p', clamp((left / total) * 100, 0, 100) + '%');
        cd.style.background = `conic-gradient(rgba(0,0,0,.72) ${clamp((left / total) * 100, 0, 100)}%, transparent 0)`;
        node.style.opacity = '.62';
      } else { cd.style.background = ''; node.style.opacity = '1'; }
    }
  }

  renderNodes() {
    const tb = this.game.trebuchet;
    if (!tb) return;
    clear(this.nodePanel);
    this.nodePanel.appendChild(el('h3', { text: `${t('hud_inspect')} · ${Math.round(tb.condition * 100)}%` }));
    for (const id of CFG.trebuchet.nodes) {
      const n = tb.nodes[id];
      const r = clamp(n.hp / n.max, 0, 1);
      const cls = r > 0.6 ? '' : r > 0.3 ? 'warn' : 'crit';
      const cost = CFG.market.repairCost[id] || {};
      const costStr = Object.entries(cost).map(([k, v]) => `${RES.icon[k]}${v}`).join(' ') + ` +${CFG.missions.repairCostSupply}${RES.icon.supply}`;
      const row = el('div', {
        class: 'noderow', style: { cursor: 'pointer', gridTemplateColumns: '1fr 56px auto' },
        html: `<div class="nm">${t('node_' + id)}</div><div class="bar ${cls}"><i style="width:${(r * 100).toFixed(0)}%"></i></div><div class="small muted">${Math.round(r * 100)}%</div>`,
        onclick: () => { Audio.uiTap(); this.game.onRepairNode(id); this.renderNodes(); },
      });
      row.title = `${t('hud_repair')}: ${costStr}`;
      this.nodePanel.appendChild(row);
    }
    const costInfo = el('div', { class: 'small muted', style: { marginTop: '7px', lineHeight: '1.4' }, html: `Тап по узлу = ремонт (${CFG.missions.repairCostSupply}${RES.icon.supply} + ресурсы).<br>Hold «${t('hud_repair')}» = чинит худший узел.` });
    this.nodePanel.appendChild(costInfo);
  }

  setSupply(left, total) {
    const lack = left < CFG.missions.shotCostSupply;
    if (left !== this._lastSupply) {
      if (lack && this._lastSupply >= CFG.missions.shotCostSupply) { toast(t('hint_supply_low'), 'bad'); Audio.alarm(); }
      this._lastSupply = left;
    }
  }

  setFps(fps, info) {
    if (!CFG.dev.showFps) { this.fpsEl.style.display = 'none'; return; }
    this.fpsEl.textContent = `${fps} fps · ${info}`;
  }

  destroy() { this.node.remove(); }
}
