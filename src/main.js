// ============================================================================
//  main.js — bootstrap, state machine, battle orchestration, game loop
// ============================================================================
import * as THREE from 'three';
import { CFG } from './config.js';
import { clamp, lerp, makeRng, hashString, nowMs, fmt, pct, damp, vibrate, DEG } from './core/utils.js';
import { Audio } from './core/audio.js';
import { Input } from './core/input.js';
import { Save, S, addResource, canAfford, pay, events as saveEvents, checkDaily, applyOfflineGains, costToCoins, lootToCoins } from './core/save.js';
import { t } from './core/i18n.js';
import { applyA11y, toast, el, qs, clear, modal } from './ui/dom.js';
import { UI } from './ui/screens.js';
import { BattleHUD } from './ui/hud.js';
import { WorldScene } from './world/scene.js';
import { Terrain } from './world/terrain.js';
import { Physics, DebrisSystem } from './systems/physics.js';
import { Structures } from './systems/structures.js';
import { FortBuilder } from './systems/fort.js';
import { Trebuchet } from './systems/trebuchet.js';
import { Ballistics } from './systems/ballistics.js';
import { VFX } from './systems/vfx.js';
import { CameraRig } from './systems/camera.js';
import { Weather } from './systems/weather.js';
import { Enemy } from './systems/enemy.js';
import { Economy, tickCamp, campRate } from './systems/economy.js';
import { computeMods, addXp, unlockedAmmo, ammoCost, grantTrophy, activeSynergies } from './systems/progression.js';
import { SkillDirector, activeCrew, addFatigue, addCrewXp, crewMods, roleDef } from './systems/crew.js';
import { generateMission, campaignList, recordMissionResult, typeName, describeObjectives } from './systems/missions.js';

const UP = new THREE.Vector3(0, 1, 0);

function nodeConsequence(id) {
  const ru = {
    frame: 'мощность падает, при 0% — катастрофа',
    counterweight: 'слабее выстрел',
    beam: 'вибрация: рассеивание растёт',
    pivot: 'сильное рассеивание',
    sling: 'риск обрыва стропы',
    guide: 'отдача сбивает наводку',
  };
  const en = {
    frame: 'power drops, 0% = catastrophe',
    counterweight: 'weaker shots',
    beam: 'vibration: spread grows',
    pivot: 'heavy spread',
    sling: 'sling may snap',
    guide: 'recoil throws off aim',
  };
  const m = (S().lang || 'ru') === 'en' ? en : ru;
  return m[id] || '';
}


class Game {
  constructor() {
    this.screen = 'boot';
    this.paused = false;
    this.audio = Audio;   // subsystems reach SFX through game.audio
    this.mission = null;
    this.inBattle = false;
    this.selectedAmmo = 'stone';
    this.mods = computeMods();
    this.time = 0;
    this.battleTime = 0;
    this.frame = { last: nowMs(), fps: 60, acc: 0, frames: 0, avg: 16 };
    this.perf = { history: [], index: CFG.render.qualityStart, auto: true };
    this.shotsThisMission = [];
    this.selectedTarget = null;
    this.hintQueue = [];
    this.tutorial = { step: -1, done: false };
    this._tmpV = new THREE.Vector3();
    this._tmpV2 = new THREE.Vector3();
    this._ray = new THREE.Raycaster();
    this.lastShotTrace = null;
    this.ghostTraces = [];
    this.survivedSeconds = 0;
    this.autoRepairsLeft = 0;
    this.pendingEnd = null;
    this.buffs = {};
  }

  // ============================================================== BOOTSTRAP ==
  async boot() {
    const splash = qs('#splash');
    this.canvas = qs('#game');
    this.world = new WorldScene(this.canvas);
    this.scene = this.world.scene;
    this.camera = this.world.camera;
    this.materials = this.world.M;

    this.physics = new Physics();
    this.physics.activeBodies = [];

    // UI layer
    this.uiRoot = qs('#ui');
    this.ui = new UI(this.uiRoot, this);
    this.hud = new BattleHUD(this.uiRoot, this);
    this.hud.show(false);

    // systems
    this.economy = new Economy();
    this.skills = new SkillDirector(this);
    this.skills.game = this;
    this.ballistics = new Ballistics(this);
    this.enemy = new Enemy(this);

    this.terrain = null;
    this.structures = null;
    this.debris = null;
    this.vfx = null;
    this.rig = null;
    this.weather = null;
    this.trebuchet = null;

    // input
    Input.attach(document.documentElement, qs('#viewport'));
    this._bindInput();
    this._bindVisibility();
    this._bindCapacitor();

    // save
    await Save.load();
    this._dailyToast(checkDaily());
    const offline = applyOfflineGains();
    this.applySettings();

    // build an idle "camp" scene behind the menu
    this._buildMenuScene();
    // GPU sanity check for offscreen rendering — needs the menu scene in place
    this.world.postSelfOk = this.world.selfTestPost();
    this.world.setPostFx(S().settings.postFx !== false);
    this._bindImpacts();

    this.ui.show('menu');
    if (splash) { splash.style.transition = 'opacity .4s'; splash.style.opacity = '0'; setTimeout(() => splash.remove(), 420); }

    // welcome / offline report
    const total = Object.values(offline).reduce((a, b) => a + b, 0);
    if (total > 1) {
      setTimeout(() => {
        const lines = Object.entries(offline).filter(([, v]) => v >= 1).map(([k, v]) => `${CFG.resources.icon[k]} +${fmt(v)}`).join('  ');
        toast(`${t('cp_offline')}: ${lines}`, 'good', 3600);
      }, 700);
    }
    if (!S().progress.tutorialDone) this.tutorial.step = 0;

    Audio.resume();
    this._loop = this.loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _buildMenuScene() {
    const rng = makeRng(20240915);
    this.terrain = new Terrain(rng.int(1, 99999), 'meadow');
    this.terrainMesh = this.terrain.buildMesh(this.materials);   // MUST be tracked: otherwise the menu terrain survives into missions
    this.scene.add(this.terrainMesh);
    this.world.buildBackdrop(rng, 'meadow');
    this.world.buildFlora(rng, this.terrain, this.world.quality.grass, 'meadow');
    this.world.buildCampProps(rng, this.terrain);
    this.debris = new DebrisSystem(this.scene, this.materials);
    this.structures = new Structures(this.scene, this.materials, this.terrain, this.debris, rng);
    this.vfx = new VFX(this.scene, this.materials, this.camera, this.uiRoot);
    this.rig = new CameraRig(this.camera, this.uiRoot);
    this.weather = new Weather(this.scene, this.physics, this.world.lights);
    this.weather.configure({ id: 'calm', wind: 0.15 }, rng);
    this.world.applySkyTheme('sunset');
    this.world.setShadowArea(14, 76);
    this.physics.attach(this.terrain, this.structures);

    // show off the machine in the menu
    this.trebuchet = new Trebuchet(this.scene, this.materials, this.terrain);
    this.trebuchet.place(0, 0, Math.PI / 2);
    this.trebuchet.setCrew(['gunner', 'loader', 'engineer', 'commander'], {});
    this.trebuchet.setActiveAmmo('stone');
    this.rig.lookAtTrebuchet(new THREE.Vector3(0, 0, 0));
    this.rig.distGoal = 21;
    this.rig.azGoal = 214;
    this.rig.polGoal = 70;
    this.menuOrbit = true;
  }

  // ================================================================= INPUT ==
  _bindInput() {
    Input.on('orbit', (d) => {
      if (!this.inBattle && this.menuOrbit) { this.rig.orbit(d.dx * 0.55, d.dy * 0.35); return; }
      const s = S().settings;
      this.rig.orbit(d.dx, d.dy * (s.invertOrbitY ? -1 : 1));
    });
    Input.on('zoom', (d) => this.rig.zoom(d.delta));
    Input.on('pan', (d) => this.rig.pan(d.dx, d.dy));
    Input.on('dbltap', () => {
      if (this.inBattle) this.rig.setMode('battle', { force: true, target: this.trebuchet.root.position.clone().add(new THREE.Vector3(0, 3, 12)), dist: 26, az: 180, pol: 62 });
      else this._frameMenuCamera();
      Audio.uiTap();
    });
    Input.on('tap', (d) => this._onViewportTap(d));
    Input.on('longpress', (d) => {
      if (this.inBattle) { this.hud.toggleNodes(true); this.rig.lookAtTrebuchet(this.trebuchet.root.position); Audio.uiTap(); }
    });
  }

  _onViewportTap(d) {
    if (!this.inBattle) return;
    // pick a target under the finger
    const nx = (d.x / window.innerWidth) * 2 - 1;
    const ny = -(d.y / window.innerHeight) * 2 + 1;
    this._ray.setFromCamera({ x: nx, y: ny }, this.camera);
    let best = null, bestD = 1e9;
    for (const tg of this.structures.targets) {
      if (tg.destroyed) continue;
      const dist = this._ray.ray.distanceToPoint(tg.center);
      if (dist < 4.5 && dist < bestD) { bestD = dist; best = tg; }
    }
    if (best) {
      this.selectedTarget = best;
      this.vfx.markTarget(best.center, Math.max(2.5, this._targetRadius(best)));
      Audio.uiTap();
      // tap-to-solve: instantly lay the current ammo on the target (aimAssist)
      if (S().settings.aimAssist) {
        const pt = this._targetAimPoint(best) || best.center;
        const sol = this._solveAim(pt, this.selectedAmmo);
        if (sol && sol.d < 12) {
          this.trebuchet.setAim(sol.az, sol.el, clamp(sol.pw, CFG.ballistics.powerMin, CFG.ballistics.powerMax));
          this.hud.aimValues = { az: this.trebuchet.aim.az, el: this.trebuchet.aim.el, power: this.trebuchet.aim.power };
          this.hud.setAimReadout(this.hud.aimValues);
          this._updatePrediction();
        }
      }
      const def = CFG.targetTypes[best.type] || {};
      toast(`${def.ru || best.type} · HP ${Math.round(best.hp)}/${Math.round(best.hp0)} · ${best.bounty > 0 ? '+' : ''}${best.bounty} 🪙`, '', 2100);
      this.rig.setMode('battle', { target: best.center.clone(), dist: clamp(bestD + 24, 16, 46) });
    } else if (this.selectedTarget) {
      this.selectedTarget = null;
      this.vfx.unmarkTarget();
    }
  }

  _targetRadius(tg) {
    let r = 2;
    for (const b of tg.blocks) if (b.alive) r = Math.max(r, b.p.distanceTo(tg.center));
    return r;
  }

  _bindVisibility() {
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { Audio.suspend(); this.paused = true; if (this.inBattle) Save.save(true); }
      else {
        Audio.resume();
        // do NOT auto-resume if the pause/settings screens are open over a battle
        const screenOpen = this.ui.current === 'pause' || this.ui.current === 'settings';
        if (!(this.inBattle && screenOpen)) { this.paused = false; this.timeFreeze = false; }
        this.frame.last = nowMs();
      }
    });
    window.addEventListener('pagehide', () => Save.save(true));
    window.addEventListener('beforeunload', () => Save.save(true));
    // keyboard fallback for desktop debugging
    window.addEventListener('keydown', (e) => {
      if (!this.inBattle) return;
      // don't hijack keys while the user types in a field (save-import modal etc.)
      const ae = document.activeElement;
      if (ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA')) return;
      const k = e.key.toLowerCase();
      if (k === 'escape' || k === 'p') this.onPause();
      if (k === ' ') { e.preventDefault(); this.onFireButton(); }
      const mul = e.shiftKey ? (CFG.aim.fineMul || 0.25) : 1;   // Shift = fine
      if (k === 'arrowleft') this.trebuchet.nudgeAim(1 * mul, 0);   // screen-left = +az
      if (k === 'arrowright') this.trebuchet.nudgeAim(-1 * mul, 0);
      if (k === 'arrowup') this.trebuchet.nudgeAim(0, 1 * mul);
      if (k === 'arrowdown') this.trebuchet.nudgeAim(0, -1 * mul);
      if (k === 'q') this.aimPower(-0.05 * mul);
      if (k === 'e') this.aimPower(0.05 * mul);
      if (k === 'r') this.onRepair(true);
      if (k === 'f2' && S().settings.testerMode) { e.preventDefault(); this.toggleDevPanel(); }
    });
  }

  _bindCapacitor() {
    const cap = window.Capacitor;
    if (!cap) return;
    if (cap.Plugins && cap.Plugins.App) {
      cap.Plugins.App.addListener('backButton', () => {
        if (this.inBattle) {
          // back from settings/pause returns to the battle, never out of it
          if (this.ui.current === 'pause') this.onResumeBattle();
          else this.onPause();
        }
        else if (this.ui.current && this.ui.current !== 'menu') this.ui.show('menu');
        else if (cap.Plugins.App.exitApp) cap.Plugins.App.exitApp();
      });
    }
    if (cap.Plugins && cap.Plugins.StatusBar) {
      cap.Plugins.StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      cap.Plugins.StatusBar.setStyle({ style: 'dark' }).catch(() => {});
    }
    if (cap.Plugins && cap.Plugins.Haptics) {
      window.CapacitorHaptics = (pattern) => {
        const p = cap.Plugins.Haptics;
        if (!S().settings.haptics) return;
        if (Array.isArray(pattern)) p.vibrate({ duration: pattern.reduce((a, b) => a + b, 0) }).catch(() => {});
        else p.impact({ style: pattern > 20 ? 'heavy' : 'light' }).catch(() => {});
      };
    }
  }

  aimPower(d) {
    const a = this.trebuchet.aim;
    this.trebuchet.setAim(a.az, a.el, clamp(a.power + d, CFG.ballistics.powerMin, CFG.ballistics.powerMax));
  }

  // ============================================================== SETTINGS ==
  applySettings() {
    const s = S().settings;
    Audio.setVolume('master', s.muted ? 0 : CFG.audio.masterVol);
    Audio.setVolume('music', s.music);
    Audio.setVolume('sfx', s.sfx);
    Audio.setVolume('ui', s.ui);
    Audio.setMuted(!!s.muted);
    applyA11y(s);
    // dev/debug flags live in the save and must survive a reload
    CFG.dev.showFps = !!s.showFps;
    CFG.dev.godMode = !!s.godMode;
    CFG.dev.instantCock = !!s.instantCock;
    CFG.render.qualityStart = s.quality;
    this.perf.auto = s.autoQuality;
    this.perf.index = s.quality;
    if (this.world) {
      const q = this.world.setQuality(this.perf.index);
      if (this.vfx) this.vfx.setQuality(q.particles);
      if (this.debris) this.debris.max = q.debrisMax;
    }
    if (this.rig) CFG.camera.dynamic = s.cameraDynamic;
    if (this.world) {
      this.world.setShadows(s.shadows !== false);
      if (this.world.postSelfOk === undefined) this.world.postSelfOk = this.world.selfTestPost();
      const wantPost = s.postFx !== false;
      this.world.setPostFx(wantPost);
      if (wantPost && !this.world.postEnabled && !this._postWarned) {
        this._postWarned = true;
        setTimeout(() => toast(t('post_unsupported'), '', 3200), 1200);
      }
    }
    document.documentElement.style.setProperty('--ui-scale', String(s.uiScale || 1));
    if (this.hud) this.hud._syncZones();
    // toggles that affect the live battle view must apply immediately
    if (this.inBattle) { this._updatePrediction(); this._renderGhosts(); }
    this.syncTesterUi();
  }

  onScreen(name) {
    this.menuOrbit = name === 'menu';
    // the main menu is see-through: keep gestures alive so the camp scene can
    // be orbited behind it (every other screen blocks input)
    if (name === 'menu') Input.setEnabled(!this.inBattle);
    else if (name !== 'none') Input.setEnabled(false);
    if (name === 'menu' && this.trebuchet && !this.inBattle) this._frameMenuCamera();
  }

  _frameMenuCamera() {
    this.rig.lookAtTrebuchet(new THREE.Vector3(0, 0, 0));
    this.rig.distGoal = 21; this.rig.azGoal = 214; this.rig.polGoal = 70;
  }

  /** login-streak reward announcement (boot + midnight rollover) */
  _dailyToast(info) {
    if (!info || !info.newDay || info.firstEver) return;
    const bp = info.reward.blueprints ? ' +1 📜' : '';
    toast(t('daily_reward', { n: info.streak, coins: info.reward.coins, bp }), 'good', 4200);
    Audio.coins(5);
  }

  // ============================================================= MISSIONS ==
  nextCampaignMission() {
    const list = campaignList();
    for (const ch of list) {
      for (const m of ch.missions) if (m.unlocked && !m.done) return m;
    }
    for (const ch of list) for (const m of ch.missions) if (m.unlocked) return m;
    return null;
  }

  startMission(mission) {
    this.mission = mission;
    this.inBattle = true;
    this.paused = false;
    this.battleTime = 0;
    this.survivedSeconds = 0;
    this.streak = 0;
    this.streakBest = 0;
    this.shotsThisMission = [];
    this.ghostTraces = [];
    this.lastShotTrace = null;
    this.selectedTarget = null;
    this.pendingEnd = null;
    this.timeFreeze = false;
    this._wearWarned = false;
    this._reachWarned = false;
    this._celebrated = false;
    this.shotInFlight = false;

    // ---- modifiers
    const cm = crewMods();
    this.mods = computeMods(cm, this.skills.buffMods());
    this.trebuchet && this.trebuchet.setModifiers(this.mods);
    this.skills.reset();   // cooldowns/buffs must not leak between missions

    // ---- rebuild world for this mission
    this._buildMissionWorld(mission);

    // ---- economy
    // NOTE: mission.supply must NOT be mutated here — restarting the mission
    // used to compound the quartermaster bonus into the mission object forever.
    const supplyEff = Math.round(mission.supply * (1 + (this.mods.supply || 0) * 0.12));
    this.economy.beginMission(mission, supplyEff);
    // shells were paid for in the briefing loadout; here we only consume counts
    this.loadout = mission._loadout ? { ...mission._loadout.ammo } : { stone: 10 };
    if (mission.training) this.loadout.stone = Math.max(this.loadout.stone || 0, 24);
    if (!Object.values(this.loadout).some((v) => v > 0)) this.loadout.stone = 10;

    // ---- select first affordable ammo
    const first = Object.keys(this.loadout).find((k) => this.loadout[k] > 0);
    this.selectedAmmo = first || 'stone';

    // ---- trebuchet reset
    this.trebuchet.root.visible = true;
    this.trebuchet.nodes && this._resetTrebuchetHp();
    this.trebuchet.setCrew(activeCrew().map((c) => c.role), Object.fromEntries(activeCrew().map((c) => [c.role, c.fatigue])));
    this.trebuchet.setActiveAmmo(this.selectedAmmo, this._ammoColor(this.selectedAmmo), this._ammoRadius(this.selectedAmmo));
    this.trebuchet.busy = false;
    this.trebuchet.phase = 'IDLE';
    this.trebuchet.cocked = false;
    this.trebuchet.setAim(0, 45, 0.7);
    this.trebuchet.applied = { az: 0, el: 45, power: 0.7 };

    // auto-repair from tech
    this.autoRepairsLeft = this.mods.flags.autoRepair ? (this.mods.autoRepairCount || 1) : 0;

    // ---- camera
    this.rig.setMode('battle', { force: true });
    this.rig.lookAtTrebuchet(this.trebuchet.root.position);
    // framing: machine in the lower third, fort on the horizon above the aim pad
    this.rig.distGoal = 34; this.rig.azGoal = 168; this.rig.polGoal = 74;
    this.rig.targetGoal.set(-1, 2.4, mission.dist * 0.26);

    // ---- enemy
    this.enemy.setup(this.structures.targets, mission.garrisonSpec || { archer: mission.garrison, spear: 0, engineer: 0, crew: 0, commander: 1 },
      (this.missionFort && this.missionFort.slots) || [], this.trebuchet.root.position, mission.biome);
    this.enemy.enabled = !mission.training;
    this.rattle = 0; this.rattleT = 0; this._crushToasted = false;

    // ---- HUD
    this.hud.show(true);
    this.hud.toggleNodes(false);
    this.hud.buildAmmo();
    this.hud.buildSkills();
    this.hud.setStreak(0);
    this.hudAimChanged({ az: 0, el: 45, power: 0.7 });
    this._updateHud(0);

    // ---- audio
    Audio.setMusicIntensity(0.25);

    // ---- tutorial
    if (!S().progress.tutorialDone && this.tutorial.step >= 0) this._tutStep();

    // ---- first-shot assist
    this._autoAimSuggest();
    vibrate(18);
  }

  _resetTrebuchetHp() {
    const hpMul = this.mods.hp || 1;
    for (const id of CFG.trebuchet.nodes) {
      const n = this.trebuchet.nodes[id];
      n.max = CFG.trebuchet.nodeHp[id] * hpMul;
      n.hp = n.max;
    }
    this.trebuchet._syncNodesVisual();
  }

  _buildMissionWorld(mission) {
    // tear down
    if (this.terrainMesh) { this.scene.remove(this.terrainMesh); this.terrainMesh.geometry.dispose(); this.terrainMesh = null; }
    if (this.waterMesh) { this.scene.remove(this.waterMesh); this.waterMesh.geometry.dispose(); this.waterMesh = null; }
    this.world.disposeDecor();
    this.structures.clear();
    this.debris.clear();
    this.vfx.clearTransient();
    this.enemy.clear();
    this.ballistics.clear();
    this.physics.activeBodies.length = 0;

    const rng = makeRng(mission.seed);
    this.terrain = new Terrain(mission.seed, mission.biome);
    this.terrainMesh = this.terrain.buildMesh(this.materials);
    this.scene.add(this.terrainMesh);
    const hasWater = ['river', 'coast'].includes(mission.biome);
    if (hasWater) { this.waterMesh = this.terrain.waterMesh(this.materials); this.scene.add(this.waterMesh); }

    this.world.buildBackdrop(rng, mission.biome);
    this.world.buildFlora(rng, this.terrain, this.world.quality.grass, mission.biome);
    this.world.buildCampProps(rng, this.terrain);
    this.world.setQuality(this.perf.index);
    // shadow frustum covers the firing corridor: machine (z≈0) → fort (z≈dist).
    // Tight = more shadow-map texels per metre; trees outside never cast anyway.
    this.world.setShadowArea(mission.dist * 0.5, 34 + mission.dist * 0.55);

    this.physics.attach(this.terrain, this.structures);
    this.structures.terrain = this.terrain;
    this.structures.onBlockDrop = (b) => this.enemy && this.enemy.crushCheck(b);
    this.trebuchet.terrain = this.terrain;
    this.trebuchet.place(0, 0, Math.PI / 2);   // local -X → world +Z (the fort)

    this._buildDirectionMarks(mission);

    const fort = new FortBuilder(this.structures, this.terrain, rng);
    fort.build({
      scheme: mission.scheme, dist: mission.dist, chapter: mission.chapter,
      hpMul: mission.hpMul, seed: mission.seed, kind: mission.kind,
    });

    this.weather.setWinter(mission.biome === 'winter');
    this.weather.configure(mission.mod, rng);
    // sky/lighting/fog follow the mission modifier or the biome's theme pool
    // (_pickSkyTheme existed but was never called — every battle looked like sunset)
    this.world.applySkyTheme(this._pickSkyTheme(mission, rng));

    // boss phases
    if (mission.isBoss) {
      this.bossPhase = 1;
      this.bossMaxPhase = 3;
    } else this.bossPhase = 0;

    this.missionFort = fort;
    return fort;
  }

  /** chevron decals on the ground showing the firing corridor (machine → fort) */
  _buildDirectionMarks(mission) {
    const g = new THREE.Group();
    const mat = new THREE.MeshBasicMaterial({ color: 0xd9a62e, transparent: true, opacity: 0.30, depthWrite: false, side: THREE.DoubleSide });
    for (let i = 0; i < 5; i++) {
      const z = 12 + i * 7;
      const y = this.terrain.heightAt(0, z) + 0.09;
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.15, 2.2, 3), mat);
      cone.rotation.x = -Math.PI / 2;   // point toward +Z
      cone.rotation.z = Math.PI / 2;
      cone.position.set(0, y, z);
      cone.scale.setScalar(1 - i * 0.06);
      g.add(cone);
    }
    this.world.decor.add(g);
  }

  /** modifier wins; otherwise a random theme from the biome's pool (mission seed) */
  _pickSkyTheme(mission, rng) {
    const bd = CFG.world.biomes[mission.biome] || CFG.world.biomes.meadow;
    const modId = mission.mod ? mission.mod.id : 'calm';
    if (modId === 'night') return mission.biome === 'winter' ? 'aurora' : 'night';
    if (modId === 'rain') return 'storm';
    if (modId === 'fog') return 'mist';
    if (modId === 'gale') return bd.skies[0];
    return rng.pick(bd.skies);
  }

  _ammoColor(id) {
    const v = CFG.ammo[id].vfx;
    return v === 'fire' ? 0x4a3a2a : v === 'pierce' ? 0x6e7278 : v === 'boom' ? 0x5a4a3a : 0x9c968a;
  }
  _ammoRadius(id) {
    const m = CFG.ammo[id].mass;
    return m > 60 ? 0.5 : m > 40 ? 0.42 : 0.34;
  }

  availableAmmo() { return unlockedAmmo().filter((id) => CFG.ammoOrder.includes(id)); }
  activeCrewList() { return activeCrew(); }

  ammoCostOf(id) {
    const discount = this.mods.ammoDiscount || 0;
    return ammoCost(id, discount);
  }
  canAffordAmmo(id) {
    if (CFG.dev.godMode) return true;
    if (this.inBattle) return ((this.loadout && this.loadout[id]) || 0) > 0;
    // out of battle (briefing): wallet check
    const cost = this.ammoCostOf(id);
    for (const k in cost) if ((S().resources[k] || 0) < cost[k]) return false;
    return true;
  }

  selectAmmo(id) {
    this.selectedAmmo = id;
    this.trebuchet.setActiveAmmo(id, this._ammoColor(id), this._ammoRadius(id));
    this.hudAimChanged(this.hud.aimValues);
  }

  // =============================================================== AIM/FIRE ==
  onAimStart() {
    if (!this.inBattle || this.paused) return;
    this.timeFreeze = CFG.aim.timeFreezeOnAim;
    Audio.setMusicIntensity(0.45);
    if (S().settings.scopeZoom && this.mods.flags.scopeZoom) this.rig.zoom(-1.4);
  }

  onAimRelease(values) {
    if (!this.inBattle) return;
    this.timeFreeze = false;
    this.hudAimChanged(values);
    // release = fire (Angry-Birds style)
    this.tryFire();
  }

  onAimCancel() {
    this.timeFreeze = false;
    this.trebuchet.cancelFire();
    toast(t('cancel'), '', 900);
  }

  onFireButton() {
    if (!this.inBattle || this.paused) return;
    this.tryFire();
  }

  hudAimChanged(values) {
    if (!this.trebuchet) return;
    this.trebuchet.setAim(values.az, values.el, values.power);
    this.hud.setAimReadout(values);
    this._cepDirty = true;
    this._updatePrediction();
  }

  _updatePrediction() {
    if (!S().settings.showPredict || !this.inBattle) { this.vfx.hidePrediction(); return; }
    const tb = this.trebuchet;
    const ammo = CFG.ammo[this.selectedAmmo] || CFG.ammo.stone;
    const origin = tb.predictOrigin(this._tmpV);
    const dir = tb.launchDir(this._tmpV2);
    const speed = tb.launchSpeed(tb.aim.power);
    // full flight truth: arc ends at the DETONATION point (fuse/blast/pierce/bounce),
    // wind evolves exactly as it will during the real flight
    const pred = this.ballistics.predictFull(origin, dir, speed, this.selectedAmmo, { points: 110, dt: 0.06, windT0: this.time });
    const pts = pred.pts;
    const sigma = this._currentSpread();
    let impact = null;
    if (pred.detonation) {
      const pt = pred.detonation;
      const col = { boom: 0xff8a4a, shrapnel: 0xbfc6cc, fire: 0xff5a1e, bees: 0xd8b45a, pierce: 0x9aa0a6 }[ammo.vfx] || 0xffd27a;
      impact = {
        point: pt,
        groundY: this.terrain ? this.terrain.heightAt(pt.x, pt.z) : 0,
        radius: pred.radius, tof: pred.tof, color: col,
        label: `${Math.round(pt.distanceTo(origin))} ${t('unit_m')} · ${pred.tof.toFixed(1)} ${t('unit_s')}` + (pred.radius ? ` · R ${pred.radius.toFixed(1)} ${t('unit_m')}` : ''),
      };
    }
    // empirical spread: fire virtual sample shots through the SAME integrator
    // (walls & terrain included) so the circle shows where shells CAN land
    const nowS = this.time;
    if (this._cepDirty || nowS - (this._cepT || -10) > 0.25) {
      this._cepT = nowS;
      this._cepDirty = false;
      this._samples = this._sampleSpread(origin, dir, speed, sigma);
    }
    const samples = this._samples || { cep: 0.5, points: [] };
    if (impact && samples.center) {
      impact.cx = samples.center.x; impact.cz = samples.center.z;
      impact.cgroundY = this.terrain ? this.terrain.heightAt(samples.center.x, samples.center.z) : 0;
    }
    // ghost continuation: fuse burn / bounce / pierce chain (one secondary polyline)
    const secondary = pred.fusePts || pred.bouncePts || pred.piercePts;
    this.vfx.showPrediction(pts, impact, samples.cep, samples.points, secondary);
    this.hud.setCep(samples.cep);
    this._prediction = { pts, impact, cep: samples.cep, sigma };
    return this._prediction;
  }

  _currentSpread(extra = 0) {
    const ammo = CFG.ammo[this.selectedAmmo] || CFG.ammo.stone;
    const crewSkill = 1 - Math.min(0.35, (this.mods.spread < 1 ? (1 - this.mods.spread) * 0.4 : 0));
    const fatigueMul = this._fatigueSpreadMul();
    const windUnc = this.mods.flags.windComp ? this.physics.windSpeed() * 0.25 : this.physics.windSpeed() * 0.6;
    let s = this.trebuchet.spreadDeg(windUnc, ammo.spreadMul || 1, crewSkill, fatigueMul);
    if (this.skills.has('precise')) s *= 0.25;
    if (this.mods.flags.windComp) s *= 0.85;
    if (S().settings.aimAssist) s *= 0.8;   // on-screen assist steadies the aim
    s *= 1 + this.rattleNow();             // «расчёт прижат» стрелами с стен
    return clamp(s * (1 + extra), 0.12, 16);
  }

  _fatigueSpreadMul() {
    let m = 1;
    for (const c of activeCrew()) if (c.fatigue >= CFG.crew.fatigueSkillLock) m *= CFG.crew.fatigueSpreadMulAt100;
    return m;
  }

  /**
   * Monte-Carlo-lite dispersion: 8 virtual shots perturbed by the current sigma
   * through the real integrator (so walls, towers and terrain shape the area).
   * Returns { cep, points[] } — points are the sample impact locations.
   */
  _sampleSpread(origin, dir, speed, sigmaDeg) {
    const s = sigmaDeg * DEG;
    const axis = new THREE.Vector3().crossVectors(dir, UP).normalize();
    const pts = [];
    let cep = 0.6;
    const base = this._prediction ? this._prediction.impact : null;
    const center = base ? (base.point || base) : null;
    const offsets = [
      [1, 0], [-1, 0], [0, 1], [0, -1], [0.7, 0.7], [-0.7, 0.7], [0.7, -0.7], [-0.7, -0.7],
    ];
    for (const [la, el] of offsets) {
      const d = dir.clone()
        .applyAxisAngle(UP, la * s)
        .applyAxisAngle(axis, el * s)
        .normalize();
      const sp = speed * (1 + this._rngSpread() * 0.004);
      const pr = this.ballistics.predictFull(origin, d, sp, this.selectedAmmo, { points: 70, dt: 0.06, windT0: this.time });
      const end = pr.detonation || (pr.pts.length ? pr.pts[pr.pts.length - 1] : null);
      if (end) pts.push(end.clone());
    }
    if (pts.length) {
      // centre = mean of the sample impacts (honest "where shots tend to land"),
      // radius = RMS distance so walls/terrain shaping the samples is visible
      const mx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
      const mz = pts.reduce((a, q) => a + q.z, 0) / pts.length;
      let rms = 0, mx2 = 0;
      for (const q of pts) { const d2 = Math.hypot(q.x - mx, q.z - mz); rms += d2 * d2; mx2 = Math.max(mx2, d2); }
      rms = Math.sqrt(rms / pts.length);
      cep = clamp(Math.max(rms * 1.6, mx2 * 0.85, 0.5), 0.5, 18);
      this._cepCenter = { x: mx, z: mz };
    }
    return { cep: clamp(cep, 0.5, 18), points: pts, center: this._cepCenter };
  }
  _rngSpread() { const r = this._rng || (this._rng = makeRng(777)); return r.gauss(); }

  tryFire() {
    if (!this.inBattle || this.paused) return false;
    if (this.trebuchet.busy || this.shotInFlight) { Audio.uiError(); return false; }
    if (this.trebuchet.nodes.frame.hp <= 0) { this._frameDestroyed(); return false; }

    const ammoId = this.selectedAmmo;
    const ammo = CFG.ammo[ammoId];
    if (!this.canAffordAmmo(ammoId)) {
      Audio.uiError();
      toast('Ядра «' + ammo.ru + '» кончились — выберите другое', 'bad');
      return false;
    }
    if (!this.economy.canShoot && !CFG.dev.godMode) { Audio.uiError(); toast(t('hint_no_supply'), 'bad'); this._maybeEndMission(); return false; }
    if (this.mission.shotLimit && this.shotsThisMission.length >= this.mission.shotLimit) {
      Audio.uiError(); toast(`${t('hud_shot_left')}: 0`, 'bad'); this._maybeEndMission(); return false;
    }

    // consume one shell from the sortie loadout (resources were paid at briefing)
    if (!CFG.dev.godMode) {
      this.loadout[ammoId] = Math.max(0, (this.loadout[ammoId] || 0) - 1);
      this.economy.spendShot(ammo);
    } else {
      this.economy.spendShot(ammo);   // stats only: budget is infinite in god mode
      this.economy.spentSupply = Math.min(this.economy.spentSupply, this.economy.budget * 0.5);
    }
    this.shotsThisMission.push({ ammo: ammoId, t: this.battleTime, aim: { ...this.trebuchet.aim } });

    // fire sequence
    this.trebuchet.setModifiers(computeMods(crewMods(), this.skills.buffMods()));
    this.trebuchet.firingMods = this.mods;
    this.trebuchet.fire(ammoId);
    this.shotInFlight = false;
    this.hud.setFireEnabled(false, '');
    Audio.setMusicIntensity(0.8);
    vibrate(26);
    this.hud.toggleNodes(false);
    if (this.tutorial.step === 0 || this.tutorial.step === 1) this._tutNext();
    return true;
  }

  _onTrebuchetEvent(name, data) {
    if (name === 'phase') {
      if (data.phase === 'COCK') Audio.cock(0.9 + this.trebuchet.aim.power * 0.3);
      if (data.phase === 'LOAD') Audio.loadThunk();
      if (data.phase === 'IDLE') {
        this.hud.setFireEnabled(true, this._fireSubLabel());
        this.trebuchet.restoreProjectileVisual();
        this._postShotCheck();
      }
    }
    if (name === 'release') {
      const tb = this.trebuchet;
      const origin = this._tmpV.copy(tb.pouchWorld || tb.root.position);
      origin.y += 0.2;
      const dir = tb.launchDir(this._tmpV2);
      // spread applied at launch
      const sigma = this._currentSpread();
      const spread = this._applySpread(dir, sigma);
      let speed = data.v0;
      if (this.skills.has('overload')) speed *= 1.25;
      const dmgMul = (this.mods.damage || 1) * (this.skills.has('warcry') ? 2 : 1);

      // Spawn from the ANALYTIC release origin — the same point the predictive
      // arc uses — and snap the visual pouch onto it. Otherwise the shell starts
      // ~2 m behind its own prediction and every aimed shot falls short.
      const analytic = this.trebuchet.predictOrigin(this._tmpV2.clone ? new THREE.Vector3() : new THREE.Vector3());
      const launchOrigin = analytic;
      this.trebuchet.pouchWorld && this.trebuchet.pouchWorld.copy(launchOrigin);
      this.lastLaunch = { origin: launchOrigin.clone(), dir: dir.clone(), speed, power: data.power, aim: { ...this.trebuchet.aim } };
      const p = this.ballistics.launch(launchOrigin, dir, speed, data.ammoId, { damageMul: dmgMul });
      p.critBonus = this.mods.critBonus || 0;
      p.critMulBonus = this.mods.critMul || 1;
      p.radiusBonus = this.mods.flags.demolitionist ? 1.3 : 1;
      this.shotInFlight = true;
      this.currentShot = p;

      Audio.fire(clamp(data.power, 0.3, 1));
      Audio.whistle(speed, 0);
      this.hud.subtitle('💥 ' + t('sub_shot'));
      this.vfx.dustPuff(tb.root.position.clone().add(new THREE.Vector3(0, 0.4, 0)), 8, 1.6, 0xb0a088);
      this.vfx.addShake(0.20 + data.power * 0.16);
      vibrate([16, 30, 22]);

      // wear
      this._cepDirty = true;
      const wearMul = (this.mission.mod.wear || 1) * (this.skills.has('overload') ? 1.6 : 1) * (CFG.ammo[data.ammoId].wear || 1);
      const wear = tb.applyShotWear(data.power, wearMul * (this.mods.wear || 1));
      this.economy.wearAccumulated += Object.values(wear).reduce((a, b) => a + b, 0);

      // fatigue
      const [fMin, fMax] = CFG.crew.fatiguePerShot;
      addFatigue((fMin + Math.random() * (fMax - fMin)) * (this.mods.fatigue || 1));
      this.hud.buildSkills();

      // camera → flight
      if (S().settings.cameraDynamic) this.rig.setMode('flight', { follow: p });
      this._recordTrace();

      // aim drift from recoil
      tb.nudgeAim((Math.random() - 0.5) * CFG.trebuchet.wearRecoilToAim * (1 + tb.wear()), (Math.random() - 0.5) * CFG.trebuchet.wearRecoilToAim * 0.5);
      this.hud.aimValues.az = tb.aim.az; this.hud.aimValues.el = tb.aim.el;
      this.hud.setAimReadout(this.hud.aimValues);

      // sling break chance at zero HP
      if (tb.nodes.sling.hp <= 0 && Math.random() < CFG.trebuchet.effects.sling.breakChanceAtZero) {
        setTimeout(() => {
          if (!this.inBattle) return;
          toast(t('hint_sling_broke'), 'bad');
          this.hud.subtitle(t('hint_sling_broke'));
          Audio.nodeDamage();
          if (this.currentShot) { this.currentShot.vel.multiplyScalar(0.35); this.currentShot.vel.y -= 6; }
        }, 220);
      }
      // engine alert
      this.enemy.setAlert(clamp(this.enemy.alertLevel + 0.4, 0, 1));
      this.trebuchet.releaseProjectileVisual();
    }
  }

  _applySpread(dir, sigmaDeg) {
    if (sigmaDeg <= 0.02) return dir;
    const rng = this._rng || (this._rng = makeRng(Date.now() & 0xffff));
    const s = sigmaDeg * DEG;
    const a = rng() * Math.PI * 2;
    const r = Math.abs(rng.gauss()) * s;
    const axis = new THREE.Vector3().crossVectors(dir, UP).normalize();
    dir.applyAxisAngle(UP, Math.cos(a) * r).applyAxisAngle(axis, Math.sin(a) * r).normalize();
    return dir;
  }

  _recordTrace() {
    const tb = this.trebuchet;
    const origin = tb.predictOrigin(this._tmpV.clone());
    const dir = tb.launchDir(this._tmpV2.clone());
    const pts = this.ballistics.predict(origin, dir, tb.launchSpeed(tb.aim.power), this.selectedAmmo);
    this.ghostTraces.push(pts);
    if (this.ghostTraces.length > (this.mods.flags.ghostMaster ? 3 : 1)) this.ghostTraces.shift();
    this._renderGhosts();
  }
  _renderGhosts() {
    if (!S().settings.ghostTrail || !this.ghostTraces.length) { this.vfx.hideGhost(); return; }
    this.vfx.showGhost(this.ghostTraces[this.ghostTraces.length - 1]);
  }

  /** called when the trebuchet returns to IDLE after a shot cycle */
  _postShotCheck() {
    if (!this.inBattle) return;
    const cond = this.trebuchet.condition;
    if (cond < 0.6 && !this._wearWarned) {
      this._wearWarned = true;
      toast('Орудие изношено: мощность и точность падают. Удерживайте «Ремонт» или почините узел', 'bad', 4200);
      Audio.alarm();
      this.hud.toggleNodes(true);
    }
    this.hud.buildAmmo();
    this.hud.renderNodes();
    this.hud.setFireEnabled(true, this._fireSubLabel());
    this._updatePrediction();
    this._updateHud(0);
    this._maybeEndMission();
    if (this.tutorial.step === 3) this._tutNext();
  }

  _fireSubLabel() {
    const left = Math.floor(this.economy.supplyLeft / (CFG.missions.shotCostSupply * 0.9));
    return `${left} ${t('hud_shot_left')}`;
  }

  // ============================================================== IMPACTS ==
  _bindImpacts() {
    this.ballistics.onImpact = (res) => this._onImpact(res);
    this.ballistics.onRetire = () => { this.shotInFlight = false; };
    this.enemy.onEvent = (name, data) => this._onEnemyEvent(name, data);
    this.trebuchet.onEvent = (n, d) => this._onTrebuchetEvent(n, d);
  }

  _onImpact(res) {
    const eco = this.economy;
    if (res.kind === 'distract') { toast(t('hint_distract'), 'good', 1800); return; }
    // impact shock knocks down defenders near the contact point
    if (res.point && this.enemy && this.enemy.enabled && (res.kind === 'miss' || res.kind === 'hit' || res.kind === 'destroy')) {
      const ammo = CFG.ammo[res.ammoId] || CFG.ammo.stone;
      this.enemy.hurtArea(res.point, 1.7, ammo.dmg * 0.45);
    }
    if (res.kind === 'hit' || res.kind === 'destroy') {
      this._bumpStreak();
      const txt = Math.round(res.damage);
      this.hud.subtitle('💥 ' + t('sub_hit'));
      this.vfx.floater(res.point, (res.crit ? '✷ ' : '') + txt, res.crit ? 'crit' : 'dmg');
      if (res.target && this.selectedTarget === res.target) {
        this.hud.flashTargetBar();
        const ratio = clamp(res.target.hp / res.target.hp0, 0, 1);
        this.vfx.floater(res.point.clone().add(new THREE.Vector3(0, 1.6, 0)), `${Math.round(ratio * 100)}% HP`, 'hit');
      }
      if (res.crit) Audio.crit();
      eco.recordHit(true, false);
      this._perfectCheck(res.point);
      this._checkTargetEvents();
      if (this.tutorial.step === 2) this._tutNext();
    } else if (res.kind === 'blast' || res.kind === 'chain') {
      this._bumpStreak();
      eco.recordHit(true, false);
      this._perfectCheck(res.point);
      this._checkTargetEvents();
      this.vfx.floater(res.point, '💥 ' + Math.round(res.damage || 0), 'crit');
    } else if (res.kind === 'miss') {
      this.streak = 0;
      this.hud.setStreak(0);
      eco.recordHit(false, false);
      Audio.miss();
      this.lastMiss = res.point ? res.point.clone() : null;
      this._missHint(res.point);
      if (this.selectedTarget) this._correctionHint(res.point, this.selectedTarget.center);
    }
    // camera back to the machine
    if (!res.kind || res.kind !== 'chain') {
      this.shotInFlight = false;
      this.currentShot = null;
      setTimeout(() => {
        if (!this.inBattle) return;
        this.rig.setMode('battle', { time: CFG.camera.returnTime });
        this.rig.targetGoal.set(this.trebuchet.root.position.x - 1, 2.4, this.mission.dist * 0.26);
        this.rig.distGoal = 34; this.rig.polGoal = 74; this.rig.azGoal = 168;
      }, 420);
      if (S().settings.cameraDynamic && !S().settings.reduceMotion) this.vfx.triggerSlowmo(0.55, 0.28);
    }
    Audio.setMusicIntensity(0.4);
    this._updatePrediction();
    this._maybeEndMission();
  }

  /** consecutive-impact streak: small escalating coin bounty on destroyed targets */
  _bumpStreak() {
    this.streak = (this.streak || 0) + 1;
    if (this.streak > (this.streakBest || 0)) this.streakBest = this.streak;
    this.hud.setStreak(this.streak);
    if (this.streak === 3 || this.streak === 5 || (this.streak >= 8 && this.streak % 4 === 0)) {
      toast(t('streak_hit', { n: this.streak }), 'good', 1600);
      Audio.crit();
    }
  }
  streakMul() { return this.streak >= 2 ? 1 + Math.min(0.4, 0.08 * (this.streak - 1)) : 1; }

  _perfectCheck(point) {
    if (!this.selectedTarget) return;
    const d = point.distanceTo(this.selectedTarget.center);
    if (d < CFG.missions.perfectShotBonus.radius) {
      this.economy.recordHit(true, true);
      this.vfx.floater(point.clone().add(new THREE.Vector3(0, 2, 0)), t('hint_perfect'), 'good');
      this.world.setFlash(0xffe6a8, 0.35);
      Audio.crit();
      vibrate([12, 40, 12]);
    }
  }

  _missHint(point) {
    const target = this.selectedTarget ? this.selectedTarget.center : new THREE.Vector3(0, 0, this.mission.dist);
    const short = target.z - point.z;          // >0 = fell short of the target
    const latX = point.x - target.x;           // +X = screen LEFT (camera looks along +Z)
    let key = null, d = 0;
    if (Math.abs(short) > Math.abs(latX)) { key = short > 0 ? 'hint_undershot' : 'hint_overshot'; d = Math.abs(short); }
    else { key = latX > 0 ? 'hint_left' : 'hint_right'; d = Math.abs(latX); }
    if (d > 1.6 && S().settings.aimAssist) toast(t(key, { d: d.toFixed(1) }), '', 2200);
  }

  _correctionHint(missPoint, targetPoint) {
    if (!S().settings.aimAssist) return;
    const autoApply = !!S().settings.autoCorrect;   // default OFF: the aim is yours
    const dx = targetPoint.x - missPoint.x, dz = targetPoint.z - missPoint.z;
    const short = dz;                        // fell short along the +Z firing lane
    const dist = Math.max(6, Math.hypot(dx, dz));
    // miss to +X (screen left) => aim more negative azimuth
    const azDelta = clamp(-Math.atan2(missPoint.x - targetPoint.x, dist) * (180 / Math.PI) * 0.85, -6, 6);
    const pwDelta = clamp(short * 0.0016, -0.14, 0.14);
    const a = this.hud.aimValues;
    const naz = clamp(a.az + azDelta, CFG.ballistics.azimuthMin, CFG.ballistics.azimuthMax);
    const npw = clamp(a.power + pwDelta, CFG.ballistics.powerMin, CFG.ballistics.powerMax);
    if (autoApply) {
      this.trebuchet.setAim(naz, a.el, npw);
      this.hud.aimValues = { az: naz, el: a.el, power: npw };
      this.hud.setAimReadout(this.hud.aimValues);
      this._updatePrediction();
    }
    if (Math.abs(azDelta) > 0.4 || Math.abs(pwDelta) > 0.01) {
      toast(autoApply
        ? `Поправка внесена: азимут ${azDelta >= 0 ? '+' : ''}${azDelta.toFixed(1)}°, мощность ${pwDelta >= 0 ? '+' : ''}${Math.round(pwDelta * 100)}%`
        : `Подсказка: азимут ${azDelta >= 0 ? '+' : ''}${azDelta.toFixed(1)}°, мощность ${pwDelta >= 0 ? '+' : ''}${Math.round(pwDelta * 100)}%`, '', 2400);
    }
  }

  _checkTargetEvents() {
    const evts = this.structures.updateTargets();
    for (const e of evts) {
      if (e.type === 'destroyed') {
        const tg = e.target;
        const def = CFG.targetTypes[tg.type] || {};
        if (tg.civilian) {
          toast(t('hint_civilian'), 'bad', 2600);
          Audio.fail();
          this.economy.penalise(CFG.blocks.civilianPenaltyCoins, 'civilian');
          vibrate([40, 60, 40]);
        } else {
          toast(`${t('hint_destroyed')}: ${def.ru || tg.type}`, 'good', 1800);
          Audio.success();
          grantTrophy(tg.type);
          this.economy.targetsDestroyed++;
          this.world.setFlash(0xd9a62e, 0.4);
          vibrate([14, 30, 14]);
          // streak bounty: consecutive-impact series pays extra coins per kill
          if (this.streak >= 2) {
            const bonus = Math.max(1, Math.round((tg.bounty > 0 ? tg.bounty : 30) * (this.streakMul() - 1)));
            this.economy.addBounty(bonus);
            this.vfx.floater(tg.center.clone().add(new THREE.Vector3(0, 2.6, 0)), `🔥×${this.streak} +${bonus} 🪙`, 'good');
          }
          if (tg.type === 'engine') this.enemy.setAlert(clamp(this.enemy.alertLevel + 0.2, 0, 1));
          if (tg.type === 'commander' || tg.type === 'banner') this.enemy.setAlert(1);
        }
        if (tg.type === 'commander') this.enemy.killCommanderUnit();
        if (tg.type === 'banner') this.enemy.onBannerDown();
        if (tg.type === 'engine') this.enemy.onEngineDown(tg);
        if (this.selectedTarget === tg) { this.selectedTarget = null; this.vfx.unmarkTarget(); this._autoAimSuggest(); }
        if (this.bossPhase) this._bossPhaseCheck();
      }
    }
    this._updateHud(0);
  }

  _bossPhaseCheck() {
    const prog = this.structures.targetProgress();
    const ratio = prog.hostile ? prog.hostileDone / prog.hostile : 0;
    const phase = ratio > 0.72 ? 3 : ratio > 0.38 ? 2 : 1;
    if (phase !== this.bossPhase) {
      this.bossPhase = phase;
      toast(`Фаза ${phase}/${this.bossMaxPhase}`, 'bad', 2200);
      Audio.alarm();
      this.enemy.setAlert(1);
    }
  }

  rattleNow() { return this.rattleT > 0 ? this.rattle : 0; }

  _onEnemyEvent(name, data) {
    if (name === 'unitKilled') {
      const bounty = data.bounty || 3;
      this.economy.addBounty(bounty);
      const st = S().stats; st.soldiersKilled = (st.soldiersKilled || 0) + 1;
      Save.markDirty();
      this.vfx.floater(data.pos.clone().add(new THREE.Vector3(0, 1.5, 0)), `+${bounty} 🪙`, 'good');
      this.vfx.dustPuff(data.pos.clone().add(new THREE.Vector3(0, 0.8, 0)), 4, 0.5, 0x8a4a3a);
      Audio.unitDie();
      if (data.tag === 'crush' && !this._crushToasted) { this._crushToasted = true; toast(t('hint_crushed'), '', 2600); }
      return;
    }
    if (name === 'rout') {
      toast(t('hint_rout'), 'good', 3000);
      this.hud.subtitle('📯 ' + t('hint_rout'));
      Audio.routHorn();
      return;
    }
    if (name === 'volleyImpact') {
      const A = CFG.enemy.archer;
      this.rattle = Math.min(A.debuffCap, (this.rattleT > 0 ? this.rattle : 0) + A.spreadDebuff);
      this.rattleT = A.debuffSec;
      this.vfx.floater(this.trebuchet.root.position.clone().add(new THREE.Vector3(0, 4.4, 0)), t('sub_volley'), 'bad');
      this.vfx.dustPuff(data.pos.clone().add(new THREE.Vector3(0, 0.6, 0)), 3, 0.4, 0xb0a088);
      this.vfx.addShake(0.05);
      Audio.arrowThud();
      this._cepDirty = true;
      return;
    }
    if (name === 'engineDown') {
      this.hud.subtitle('💥 ' + t('sub_engine_down'));
      return;
    }
    if (name === 'commanderDown') {
      this.hud.subtitle('📯 ' + t('sub_commander_down'));
      return;
    }
    if (name === 'incoming') { toast(t('hud_incoming'), 'bad', 1400); this.hud.subtitle('⚠️ ' + t('hud_incoming')); this.world.setFlash(0x8a3a2c, 0.3); Audio.alarm(); vibrate([20, 40, 20]); }
    if (name === 'playerHit') {
      this._cepDirty = true;      // node damage changes spread -> refresh the area
      this.economy.nodeDamageTaken += data.dmg;
      this.hud.subtitle('🛠️ ' + t('sub_node'));
      this.world.setFlash(0xb3372c, 0.85);
      this.vfx.floater(this.trebuchet.root.position.clone().add(new THREE.Vector3(0, 4, 0)), `−${Math.round(data.dmg)}`, 'bad');
      toast(`${t('hint_node_broken', { n: t('node_' + data.node) })} — ${nodeConsequence(data.node)}`, 'bad', 2400);
      this.hud.renderNodes();
      if (data.node === 'frame' && this.trebuchet.nodes.frame.hp <= 0) this._frameDestroyed();
      if (this.trebuchet.condition < 0.45 && this.autoRepairsLeft > 0) {
        this.autoRepairsLeft--;
        const w = this.trebuchet.worstNode();
        this.trebuchet.repairNode(w, this.trebuchet.nodes[w].max * 0.4);
        toast(`${t('node_' + w)} — авторемонт`, 'good');
        Audio.repair();
      }
    }
    if (name === 'wave') {
      toast(t('hint_wave', { n: data.burst || 2 }), 'bad', 2200);
      this.hud.subtitle('⚠️ ' + t('hud_incoming'));
      this.world.setFlash(0x8a6ab3, 0.45);
      this.enemy.setAlert(1);
    }
  }

  _frameDestroyed() {
    toast(t('hint_frame_broke'), 'bad', 3200);
    this.hud.subtitle(t('hint_frame_broke'));
    this.world.setFlash(0xb3372c, 1.0);
    Audio.fail();
    this.vfx.addShake(0.5);
    this.vfx.explosion(this.trebuchet.root.position.clone().add(new THREE.Vector3(0, 2, 0)), 3.2, 'boom');
    this.trebuchet.root.visible = false;
    setTimeout(() => this.endMission(false), 1100);
  }

  // ================================================================ REPAIR ==
  /** repair one specific node (tap on the inspect panel row) */
  onRepairNode(nodeId) {
    if (!this.inBattle || this.paused) return;
    const tb = this.trebuchet;
    const n = tb.nodes[nodeId];
    if (!n || n.hp >= n.max - 0.5) { Audio.uiError(); toast(`${t('node_' + nodeId)}: уже цел`, ''); return; }
    if (!this.economy.canRepair) { Audio.uiError(); toast(t('hint_no_supply'), 'bad'); return; }
    const r = this.economy.spendRepair(nodeId, true);
    if (!CFG.dev.godMode && !canAfford(r.cost)) { Audio.uiError(); toast(t('not_enough'), 'bad'); return; }
    if (!CFG.dev.godMode) pay(r.cost);
    tb.repairNode(nodeId, CFG.market.repairHpPerAction * (this.mods.hp || 1));
    this._cepDirty = true;
    Audio.repair();
    vibrate(16);
    this.vfx.dustPuff(tb.root.position.clone().add(new THREE.Vector3(0, 2, 0)), 4, 0.8, 0xbfa878);
    toast(`${t('node_' + nodeId)}: +${CFG.market.repairHpPerAction} HP`, 'good', 1400);
    this._updatePrediction();
  }

  onRepair(fromHold) {
    if (!this.inBattle || this.paused) return;
    const tb = this.trebuchet;
    const worst = tb.worstNode();
    if (!worst || tb.nodes[worst].hp >= tb.nodes[worst].max - 0.5) { Audio.uiError(); toast('Орудие в порядке', ''); return; }
    if (!this.economy.canRepair) { Audio.uiError(); toast(t('hint_no_supply'), 'bad'); return; }
    const r = this.economy.spendRepair(worst, true);
    if (!CFG.dev.godMode && !canAfford(r.cost)) { Audio.uiError(); toast(t('not_enough'), 'bad'); return; }
    if (!CFG.dev.godMode) pay(r.cost);
    const time = CFG.market.repairTimeBattle * (this.mods.flags.fastRepair ? 0.7 : 1);
    tb.repairNode(worst, CFG.market.repairHpPerAction * (this.mods.hp || 1));
    this._cepDirty = true;
    Audio.repair();
    vibrate(18);
    this.vfx.dustPuff(tb.root.position.clone().add(new THREE.Vector3(0, 2, 0)), 5, 0.9, 0xbfa878);
    this.hud.renderNodes();
    toast(`${t('node_' + worst)} +${CFG.market.repairHpPerAction}`, 'good', 1200);
    if (this.tutorial.step === 3) this._tutNext();
  }

  onInspect(on) {
    if (on) {
      this.rig.setMode('battle', { target: this.trebuchet.root.position.clone().add(new THREE.Vector3(0, 2.4, 0)), dist: 14, pol: 68 });
      Audio.uiTap();
    } else {
      this.rig.setMode('battle', { target: new THREE.Vector3(this.trebuchet.root.position.x - 1, 2.6, this.mission ? this.mission.dist * 0.26 : 18), dist: 34, pol: 74, az: 168 });
    }
  }

  // ================================================================= SKILLS ==
  useSkill(crewId) {
    const c = activeCrew().find((x) => x.id === crewId);
    if (!c) return { ok: false, reason: 'none' };
    const r = this.skills.use(c);
    if (r.ok) {
      Audio.uiUnlock();
      vibrate(20);
      this.mods = computeMods(crewMods(), this.skills.buffMods());
      this.trebuchet.setModifiers(this.mods);
      this.hud.buildSkills();
      this._updatePrediction();
      if (r.skill.id === 'measure') {
        toast('Замер: идеальная дуга 8 с', 'good', 1800);
        this._showIdealArc();
      }
      if (r.skill.id === 'overload') toast('Двойной заряд: +25% мощности', 'good', 1600);
      if (r.skill.id === 'warcry') toast('Боевой клич: ×2 урон, −10% лута', 'good', 1600);
      if (r.skill.id === 'fieldfix') toast('Аварийный ремонт', 'good', 1400);
    }
    return r;
  }

  _showIdealArc() {
    if (!this.selectedTarget) { toast('Сначала выберите цель (тап по ней)', '', 2000); return; }
    // solve a simple ballistic to the target with current power, adjust elevation
    const target = this.selectedTarget.center;
    const tb = this.trebuchet;
    const origin = tb.predictOrigin(this._tmpV.clone());
    let best = null;
    for (let el = CFG.ballistics.elevationMin; el <= CFG.ballistics.elevationMax; el += 1.5) {
      for (let az = CFG.ballistics.azimuthMin; az <= CFG.ballistics.azimuthMax; az += 1.5) {
        tb.setAim(az, el, tb.aim.power);
        const dir = tb.launchDir(this._tmpV2.clone());
        const pts = this.ballistics.predict(tb.predictOrigin(this._tmpV), dir, tb.launchSpeed(tb.aim.power), this.selectedAmmo, { points: 160, dt: 0.045 });
        const end = pts[pts.length - 1];
        if (!end) continue;
        const d = Math.hypot(end.x - target.x, end.y - target.y, end.z - target.z);
        if (!best || d < best.d) best = { d, az, el, pts };
        if (d < 1.2) break;
      }
      if (best && best.d < 1.2) break;
    }
    if (best) {
      tb.setAim(best.az, best.el, tb.aim.power);
      this.hud.aimValues.az = best.az; this.hud.aimValues.el = best.el;
      this.hud.setAimReadout(this.hud.aimValues);
      this.vfx.showPrediction(best.pts, best.pts[best.pts.length - 1], 0.8);
      Audio.crit();
    }
    tb.setAim(this.hud.aimValues.az, this.hud.aimValues.el, this.hud.aimValues.power);
  }

  /**
   * Numeric aim solver: searches (azimuth, elevation, power) against the REAL
   * predictive integrator (drag + wind included), so the suggestion lands on target.
   */
  _solveAim(targetPoint, ammoId = this.selectedAmmo) {
    const tb = this.trebuchet;
    const o0 = tb.predictOrigin(this._tmpV);
    const dx = targetPoint.x - o0.x, dz = targetPoint.z - o0.z;
    const azT = clamp(Math.atan2(dx, dz) * (180 / Math.PI), CFG.ballistics.azimuthMin, CFG.ballistics.azimuthMax);
    let best = null;
    outer:
    for (let el = 2; el <= 78; el += 3) {
      for (let pw = 0.5; pw <= 1.0001; pw += 0.0625) {
        tb.setAim(azT, el, pw);
        const dir = tb.launchDir(this._tmpV2);
        const origin = tb.predictOrigin(this._tmpV);
        const pred = this.ballistics.predictFull(origin, dir, tb.launchSpeed(pw), ammoId, { points: 160, dt: 0.045, windT0: this.time });
        const end = pred.detonation || (pred.pts.length ? pred.pts[pred.pts.length - 1] : null);
        if (!end) continue;
        let d = end.distanceTo(targetPoint);
        // Scoring: contacting the selected target is best; contacting ANY hostile
        // block is still productive (a fort is contiguous); civilian hits and
        // bare-ground misses are what we avoid.
        const hitBlock = pred.hit && pred.hit.block ? pred.hit.block : null;
        if (hitBlock) {
          if (hitBlock.civilian) d += 30;
          else if (targetPoint.__cid !== undefined && hitBlock.cid === targetPoint.__cid) d *= 0.3;
          else d += 0.5;
        } else {
          d += 2.5;
        }
        if (!best || d < best.d) best = { d, az: azT, el, pw, pts: pred.pts };
        if (best.d < 1.1) break outer;
      }
    }
    return best;
  }

  /**
   * The point a shot should actually aim at: the ALIVE block of the target that
   * faces the machine. Aiming at the geometric centre makes shells fly through
   * breaches once the front is opened.
   */
  _targetAimPoint(target) {
    const root = this.trebuchet.root.position;
    let best = null, bestD = 1e9;
    for (const b of target.blocks) {
      if (!b.alive) continue;
      // front face, mid height: gives flat trajectories something to bite on
      const d = b.p.distanceTo(root) + Math.abs(b.p.y - 3) * 1.5;
      if (d < bestD) { bestD = d; best = b; }
    }
    if (!best) return null;
    const p = best.p.clone();
    p.__cid = target.id;
    return p;
  }

  _autoAimSuggest() {
    // choose the target whose FRONT FACE is most reachable right now, then solve
    const root = this.trebuchet.root.position;
    const hostile = this.structures.targets.filter((t2) => t2.priority > 0 && !t2.destroyed);
    if (!hostile.length) { this.vfx.unmarkTarget(); this.selectedTarget = null; return; }
    const big = (t2) => (t2.type === 'wall' || t2.type === 'tower' || t2.type === 'gate' || t2.type === 'barracks');
    hostile.sort((a, b) => (big(b) - big(a)) || (a.center.distanceTo(root) - b.center.distanceTo(root)) || (b.priority - a.priority));

    let bestSol = null, bestTarget = null;
    for (const cand of hostile.slice(0, 4)) {
      const pt = this._targetAimPoint(cand);
      if (!pt) continue;
      const sol = this._solveAim(pt);
      if (!sol) continue;
      const aliveBlocks = cand.blocks.reduce((n, b) => n + (b.alive ? 1 : 0), 0);
      const score = sol.d + (cand === this.selectedTarget ? -0.6 : 0) + (big(cand) ? -0.4 : 0) - Math.min(1.2, aliveBlocks / 25);
      if (!bestSol || score < bestSol.score) { bestSol = { ...sol, score }; bestTarget = cand; }
      if (bestSol.score < 1.4) break;
    }
    if (!bestTarget) return;
    if (bestSol.d > 10 && !this._reachWarned) {
      this._reachWarned = true;
      toast('Цель не достаёт: изношено орудие или мало мощности — ремонт/апгрейды механики', 'bad', 3800);
    }
    this.selectedTarget = bestTarget;
    this._lastSolve = { d: bestSol.d, az: bestSol.az, el: bestSol.el, pw: bestSol.pw, target: bestTarget.type };
    this.vfx.markTarget(bestTarget.center, Math.max(2.5, this._targetRadius(bestTarget)));
    this.trebuchet.setAim(bestSol.az, bestSol.el, clamp(bestSol.pw, CFG.ballistics.powerMin, CFG.ballistics.powerMax));
    this.hud.aimValues = { az: this.trebuchet.aim.az, el: this.trebuchet.aim.el, power: this.trebuchet.aim.power };
    this.hud.setAimReadout(this.hud.aimValues);
    this._updatePrediction();
  }

  // ------------------------------------------------------------ app control --
  exitApp(force = false) {
    Save.save(true);
    const cap = window.Capacitor;
    if (cap && cap.Plugins && cap.Plugins.App && cap.Plugins.App.exitApp) {
      cap.Plugins.App.exitApp().catch(() => {});
      return;
    }
    window.close();
    setTimeout(() => toast('Закройте вкладку браузера — веб-версия не может закрыться сама', '', 3000), 200);
  }

  resetCamera() {
    if (!this.rig) return;
    if (this.inBattle && this.mission) {
      this.rig.setMode('battle', { force: true });
      this.rig.azGoal = 168; this.rig.polGoal = 74; this.rig.distGoal = 34;
      this.rig.targetGoal.set(this.trebuchet.root.position.x - 1, 2.4, this.mission.dist * 0.26);
      this.rig.manualOffset.set(0, 0, 0);
    } else {
      this.rig.lookAtTrebuchet(new THREE.Vector3(0, 0, 0));
      this.rig.distGoal = 21; this.rig.azGoal = 214; this.rig.polGoal = 70;
    }
    Audio.uiTap();
    toast(t('cam_reset'), '', 900);
  }

  /** victory fireworks + banner before the results screen */
  _celebrate(report) {
    if (this._celebrated) return;
    this._celebrated = true;
    const fort = this.structures.targets.find((t2) => t2.priority > 0);
    const center = fort ? fort.center.clone() : new THREE.Vector3(0, 4, this.mission.dist);
    center.y += 6;
    this.rig.setMode('battle', { target: center.clone().setY(center.y * 0.6), dist: 46, pol: 72, az: 180 });
    const colors = [0xd9a62e, 0xb3372c, 0x5c8a3a, 0x4a8fb5, 0xe8dcc0];
    for (let i = 0; i < 5; i++) {
      setTimeout(() => {
        if (!this.inBattle && i > 1) return;
        const p = center.clone().add(new THREE.Vector3((Math.random() - 0.5) * 22, Math.random() * 8, (Math.random() - 0.5) * 14));
        this.vfx.fireworkBurst(p, colors[i % colors.length]);
        this.audio.explode(0.75);
      }, i * 320);
    }
    const banner = el('div', { class: 'vic-banner' }, [
      el('h1', { text: t('vic_title') }),
      el('p', { text: t('vic_sub') }),
    ]);
    this.uiRoot.appendChild(banner);
    setTimeout(() => banner.remove(), 2600);
    Audio.success();
    this.hud.subtitle('🎺 ' + t('sub_victory'));
    this.world.setFlash(0xd9a62e, 0.6);
    vibrate([30, 60, 30, 60, 60]);
  }

  // ============================================================ END MISSION ==
  _maybeEndMission() {
    if (!this.inBattle || this.pendingEnd) return;
    const m = this.mission;
    const complete = m.checkComplete(this.economy, this.structures);
    if (complete) {
      this.pendingEnd = 'win';
      this._celebrate();
      setTimeout(() => this.endMission(true), 2300);
      return;
    }
    const anyShells = Object.values(this.loadout || {}).some((v) => v > 0);
    const noBudget = this.economy.supplyLeft < CFG.missions.shotCostSupply;
    if (!this.shotInFlight && !anyShells) {
      // nothing left to fire with: end instead of leaving a dead battle
      this.pendingEnd = 'lose';
      setTimeout(() => this.endMission(false), 1400);
    } else if (!this.economy.canShoot && !this.shotInFlight && noBudget) {
      this.pendingEnd = 'lose';
      setTimeout(() => this.endMission(false), 1200);
    }
    if (m.timeLimit && this.survivedSeconds >= m.timeLimit && complete) { this.pendingEnd = 'win'; setTimeout(() => this.endMission(true), 700); }
    if (m.timeLimit && this.survivedSeconds >= m.timeLimit && !complete) { this.pendingEnd = 'lose'; setTimeout(() => this.endMission(false), 700); }
    if (m.shotLimit && this.shotsThisMission.length >= m.shotLimit && !this.shotInFlight && !complete) {
      this.pendingEnd = 'lose';
      setTimeout(() => this.endMission(false), 1200);
    }
  }

  endMission(won, retreated = false) {
    if (!this.inBattle) return;
    this.inBattle = false;
    this.pendingEnd = null;
    this.selectedTarget = null;
    this.currentShot = null;
    this.shotInFlight = false;
    this.hud.show(false);
    this.vfx.hidePrediction();
    this.vfx.hideGhost();
    this.vfx.unmarkTarget();
    this.enemy.enabled = false;
    this.timeFreeze = false;
    Audio.setMusicIntensity(0.1);

    // refund unused shells back to the wallet
    let refund = 0;
    if (this.loadout) {
      for (const id in this.loadout) {
        const n = this.loadout[id] || 0;
        if (!n) continue;
        const cost = this.ammoCostOf(id);
        for (const k in cost) addResource(k, cost[k] * n);
        refund += n;
      }
    }
    const report = this.economy.finish(this.structures, this.mods);
    report.refund = refund;
    report.bestStreak = this.streakBest || 0;
    report.garrisonKilled = this.enemy.killed || 0;
    report.garrisonTotal = this.enemy.totalSoldiers || 0;
    if (retreated) { report.rank = 'D'; report.objectiveDone = false; }
    report.xp = won ? report.xp : Math.round(report.xp * 0.4);
    // accuracy-streak mastery bonus (win only)
    if (won && (this.streakBest || 0) >= 3) report.xp += Math.min(90, 15 * (this.streakBest - 2));

    if (refund > 0) setTimeout(() => toast(`Возврат неиспользованных ядер: ${refund} шт.`, '', 2600), 900);
    if (won) {
      this.economy.payout(report, this.mods);
      // contract reward promised in the briefing (was never paid before 1.4.1 —
      // the whole blueprint economy starved because of this)
      const mult = CFG.missions.rankRewardMul[report.rank] || 1;
      const rp = this.mission.rewardPreview || {};
      const granted = [];
      for (const k of ['coins', 'stone', 'wood', 'metal', 'rope', 'pitch', 'blueprints']) {
        const v = Math.round((rp[k] || 0) * mult);
        if (v > 0) { addResource(k, v); granted.push(`${CFG.resources.icon[k]}${v}`); }
      }
      if (granted.length) setTimeout(() => toast(`${t('res_contract')}: ${granted.join(' ')}`, 'good', 3200), 700);
      addXp(report.xp);
      recordMissionResult(this.mission, report);
      // crew xp — through addCrewXp so levels actually tick up
      for (const c of activeCrew()) addCrewXp(c.id, Math.round(report.xp * 0.25));
      Save.markDirty();
      Audio.rankS ? (report.rank === 'S' ? Audio.rankS() : Audio.success()) : Audio.success();
      if (this.mission.isDaily) { S().progress.daily.done = true; Save.markDirty(); }
      if (this.mission.isTrial) { S().progress.daily.trials = (S().progress.daily.trials || 0) + 1; Save.markDirty(); }
    } else {
      Audio.fail();
      // half the loot is salvaged on failure
      for (const k in report.loot) if (k !== 'coins') addResource(k, Math.round(report.loot[k] * 0.35));
      addResource('coins', Math.round(Math.max(0, report.coins) * 0.2));
      addXp(report.xp);
    }
    Save.save(true);

    // restore to a calm menu scene
    this._buildMenuScene2();
    this.ui.show('results', { report, mission: this.mission, failed: !won });
    if (!S().progress.tutorialDone && this.tutorial.step >= 4) this._finishTutorial();
  }

  restartMission() {
    const m = this.mission;
    this.inBattle = false;
    this.paused = false;
    this.timeFreeze = false;
    this.pendingEnd = null;
    this.enemy.enabled = false;
    this.hud.show(false);
    this.vfx.hidePrediction();
    this.vfx.hideGhost();
    this.vfx.unmarkTarget();
    this.ui.show('briefing', { mission: m });
  }

  _buildMenuScene2() {
    // rebuild a light menu backdrop without wiping the save/UI
    if (this.terrainMesh) { this.scene.remove(this.terrainMesh); this.terrainMesh.geometry.dispose(); }
    if (this.waterMesh) { this.scene.remove(this.waterMesh); this.waterMesh = null; }
    this.world.disposeDecor();
    this.structures.clear();
    this.debris.clear();
    this.vfx.clearTransient();
    this.vfx.hidePrediction();
    this.vfx.hideGhost();
    this.vfx.unmarkTarget();
    // battle leftovers (shells in flight, enemy volley meshes, soldiers) must
    // not survive into the menu scene
    this.ballistics.clear();
    this.enemy.clear();
    this.physics.activeBodies.length = 0;
    const rng = makeRng(20240915);
    this.terrain = new Terrain(rng.int(1, 99999), 'meadow');
    this.terrainMesh = this.terrain.buildMesh(this.materials);
    this.scene.add(this.terrainMesh);
    this.world.buildBackdrop(rng);
    this.world.buildFlora(rng, this.terrain, this.world.quality.grass, 'meadow');
    this.world.buildCampProps(rng, this.terrain);
    this.world.applySkyTheme('sunset');
    this.world.setShadowArea(14, 76);
    this.physics.attach(this.terrain, this.structures);
    this.trebuchet.terrain = this.terrain;
    this.trebuchet.place(0, 0, Math.PI / 2);
    this.trebuchet.root.visible = true;
    this._resetTrebuchetHp();
    this.trebuchet.setCrew(['gunner', 'loader', 'engineer', 'commander'], {});
    this.weather.configure({ id: 'calm', wind: 0.15 }, rng);
    this.rig.setMode('battle', { force: true });
    this.rig.lookAtTrebuchet(new THREE.Vector3(0, 0, 0));
    this.rig.distGoal = 21; this.rig.azGoal = 214; this.rig.polGoal = 70;
    this.menuOrbit = true;
  }

  // ================================================================= PAUSE ==
  onPause() {
    if (!this.inBattle) return;
    // Escape/back while the pause menu is open = resume (toggle)
    if (this.ui.current === 'pause') { this.onResumeBattle(); return; }
    this.paused = true;
    this.timeFreeze = true;
    Input.setEnabled(false);
    this.ui.show('pause', { onResume: () => this.onResumeBattle() });
  }

  onResumeBattle() {
    if (!this.inBattle) { this.ui.show('menu'); return; }
    this.ui.hide();
    this.paused = false;
    this.timeFreeze = false;
    this.hud.show(true);      // also re-enables Input
    Input.setEnabled(true);
  }

  // ============================================================= TUTORIAL ==
  _tutStep() {
    const steps = ['tut_1', 'tut_2', 'tut_3', 'tut_4', 'tut_5', 'tut_6'];
    const i = this.tutorial.step;
    if (i < 0 || i >= steps.length) return;
    if (this._tutEl) this._tutEl.remove();
    const box = el('div', { class: 'tut' });
    box.append(
      el('div', { class: 'tx', text: t(steps[i]) }),
      el('div', { class: 'row' }, [
        el('button', { class: 'btn small ghost', text: t('tut_skip'), onclick: () => { this._finishTutorial(); } }),
        el('button', { class: 'btn small primary', text: t('tut_next'), onclick: () => { this._tutNext(); } }),
      ])
    );
    this._tutEl = box;
    this.uiRoot.appendChild(box);
  }
  _tutNext() {
    this.tutorial.step++;
    if (this.tutorial.step >= 6) this._finishTutorial();
    else this._tutStep();
    Audio.uiTap();
  }
  _finishTutorial() {
    if (this._tutEl) { this._tutEl.remove(); this._tutEl = null; }
    this.tutorial.step = -1;
    S().progress.tutorialDone = true;
    Save.markDirty();
    addResource('coins', 120);
    toast('+120 🪙 за обучение', 'good');
  }

  // ================================================================== LOOP ==
  loop() {
    requestAnimationFrame(this._loop);
    const now = nowMs();
    let dtReal = (now - this.frame.last) / 1000;
    this.frame.last = now;
    dtReal = clamp(dtReal, 0, 0.1);

    // perf tracking
    this.frame.acc += dtReal * 1000; this.frame.frames++;
    if (this.frame.frames >= CFG.render.fpsReportEvery) {
      this.frame.avg = this.frame.acc / this.frame.frames;
      this.frame.fps = Math.round(1000 / Math.max(1, this.frame.avg));
      this.frame.acc = 0; this.frame.frames = 0;
      this._autoQuality(this.frame.avg);
      if (this.inBattle) {
        this.hud.setFps(this.frame.fps, `dc:${this.world.renderer.info.render.calls} tri:${fmt(this.world.renderer.info.render.triangles)} deb:${this.debris.count} q:${this.world.quality.name}`);
      } else this.hud.setFps(this.frame.fps, `q:${this.world.quality.name}`);
    }

    this.time += dtReal;
    Audio.tickMusic();

    // camp idle production ticks once per real second while the app is open
    this._campAcc = (this._campAcc || 0) + dtReal;
    if (this._campAcc >= 1) { tickCamp(this._campAcc); this._dailyToast(checkDaily()); this._campAcc = 0; }

    // time scaling (freeze while aiming, slow-mo on impact)
    let scale = 1;
    if (this.paused || this.timeFreeze) scale = 0.0001;
    else if (this.inBattle) scale = this.vfx.timeScale;
    const dt = dtReal * scale;

    if (this.inBattle && !this.paused) {
      this.battleTime += dt;
      if (this.rattleT > 0) this.rattleT -= dt;
      if (this.mission && this.mission.timeLimit) this.survivedSeconds += dt;
      // the DEFEND 'survive' objective is checked against the economy object
      this.economy.survivedSeconds = this.survivedSeconds;
    }

    // ---- systems
    this.physics.updateWind(this.time);
    if (this.inBattle && !this.paused) {
      this.physics.step(dt, this.physics.activeBodies);
      this.structures.update(dt);
      this.debris.update(this.physics, dt);
      this.ballistics.update(dt);
      this.skills.update(dtReal);
      this.enemy.update(dt, { trebuchet: this.trebuchet, structures: this.structures, missionKind: this.mission ? this.mission.kind : null, missionChapter: this.mission ? this.mission.chapter : 1 });
      this._updateHud(dtReal);
    } else {
      this.debris.update(this.physics, Math.min(dt, dtReal * 0.5));
    }
    this.trebuchet.update(this.paused ? 0 : Math.max(dt, this.inBattle ? 0 : dtReal * 0.6), this.time);
    this.weather.update(this.paused ? 0 : dtReal, this.camera.position);
    this.vfx.update(dt, dtReal);
    this.rig.update(dtReal, this);
    this.world.animate(this.time, dtReal);

    // wind audio
    Audio.setWind(this.physics.windSpeed(), this.weather.gust);

    // ---- render
    this.world.render();
  }

  /** objective checklist with live counters (so progress is always visible) */
  _objectiveLines(m) {
    const st = this.structures;
    const out = [];
    for (const o of m.objectives) {
      switch (o.type) {
        case 'destroyTargets': {
          const done = st.targets.filter((t2) => t2.destroyed && (o.of === 'hostile' ? t2.priority > 0 : true) && (!o.ofType || t2.type === o.ofType)).length;
          const okDone = done >= o.count;
          out.push(`<span style="color:${okDone ? 'var(--green)' : 'var(--parchment)'}">${okDone ? '✔' : '•'} ${o.ofType ? typeName(o.ofType, S().lang) : t('hud_target')}: ${done}/${o.count}</span>`);
          break;
        }
        case 'destroyTargetType': {
          const done = st.targets.filter((t2) => t2.destroyed && t2.type === o.target).length;
          const okDone = done >= o.count;
          out.push(`<span style="color:${okDone ? 'var(--green)' : 'var(--parchment)'}">${okDone ? '✔' : '•'} ${typeName(o.target, S().lang)}: ${done}/${o.count}</span>`);
          break;
        }
        case 'breach': {
          const walls = st.targets.filter((t2) => t2.type === 'wall');
          const done = walls.some((w) => w.destroyed || w.hp / w.hp0 < 0.25);
          out.push(`<span style="color:${done ? 'var(--green)' : 'var(--parchment)'}">${done ? '✔' : '•'} ${S().lang === 'ru' ? 'Брешь в стене' : 'Wall breach'}</span>`);
          break;
        }
        case 'noCivilian': {
          const bad = st.civilianDestroyed > 0;
          out.push(`<span style="color:${bad ? 'var(--blood)' : 'var(--parchment)'}">${bad ? '✘' : '•'} ${S().lang === 'ru' ? 'Мирные целы' : 'Civilians safe'}</span>`);
          break;
        }
        case 'survive': {
          const left = Math.max(0, o.seconds - this.survivedSeconds);
          out.push(`• ${S().lang === 'ru' ? 'Продержаться' : 'Survive'}: ${Math.ceil(left)}с`);
          break;
        }
        case 'minEfficiency': {
          const eff = this.economy.gainedValue / Math.max(1, this.economy.spentValue);
          out.push(`• ${t('res_eff')} ≥ ${o.value.toFixed(1)} (${eff.toFixed(1)})`);
          break;
        }
      }
    }
    if (m.shotLimit) out.push(`${t('hud_shot_left')}: ${Math.max(0, m.shotLimit - this.shotsThisMission.length)}`);
    if (m.timeLimit) out.push(`${t('hud_time')}: ${Math.max(0, m.timeLimit - this.survivedSeconds).toFixed(0)}с`);
    return out;
  }

  _updateHud(dtReal) {
    const eco = this.economy;
    const m = this.mission;
    const s = S();

    // objective line with LIVE per-objective progress
    const prog = this.structures.targetProgress();
    const gar = this.enemy.totalSoldiers ? ` · 🗡 ${this.enemy.killed}/${this.enemy.totalSoldiers}` : '';
    const objText = `${t('kind_' + m.kind)} · ${prog.hostileDone}/${prog.hostile}${gar}`;
    const sub = this._objectiveLines(m).join('<br>');
    this.hud.setObjective(objText, sub);

    // resources
    const entries = [
      { id: 'supply', icon: '📦', value: `${Math.round(eco.supplyLeft)}/${eco.budget}`, lack: eco.supplyLeft < CFG.missions.shotCostSupply },
      { id: 'coins', icon: '🪙', value: fmt(s.resources.coins) },
      { id: 'stone', icon: '🪨', value: fmt(s.resources.stone), lack: (s.resources.stone || 0) < 3 },
      { id: 'wood', icon: '🪵', value: fmt(s.resources.wood) },
      { id: 'metal', icon: '⚙️', value: fmt(s.resources.metal) },
      { id: 'rope', icon: '🪢', value: fmt(s.resources.rope) },
    ];
    this.hud.setResources(entries);
    this.hud.setSupply(eco.supplyLeft, eco.budget);

    // wind (+3 s forecast when the «Чтец ветра» synergy is active)
    const windHud = this.weather.hud();
    if (this.mods.flags.windForecast) windHud.forecast = this.physics.windAt(this.time + 3);
    this.hud.setWind(windHud);

    // timer
    this.hud.setTimer(m.timeLimit ? Math.max(0, m.timeLimit - this.survivedSeconds) : null, m.timeLimit ? 'Продержаться' : null);

    // fire button
    const canFire = !this.trebuchet.busy && !this.shotInFlight && eco.canShoot && this.canAffordAmmo(this.selectedAmmo)
      && !(m.shotLimit && this.shotsThisMission.length >= m.shotLimit);
    this.hud.setFireEnabled(canFire, this._fireSubLabel());

    // nodes panel live
    if (this.hud.nodePanel.style.display !== 'none') this.hud.renderNodes();
    this.hud.updateSkillCooldowns(this.skills.cool);

    // selected-target HP bar, anchored in world space
    const tgt = this.selectedTarget;
    if (tgt && !tgt.destroyed) {
      const pos = this._tmpV.copy(tgt.center); pos.y += this._targetRadius(tgt) * 0.55 + 2.2;
      const scr = this.vfx._projectToScreen(pos, this._scr || (this._scr = { x: 0, y: 0, visible: false }));
      this.hud.updateTargetBar(tgt, scr, scr.visible);
    } else this.hud.updateTargetBar(null, null, false);
  }

  _autoQuality(avgFrameMs) {
    if (!this.perf.auto || !S().settings.autoQuality) return;
    const q = CFG.render.qualitySteps;
    this.perf.history.push(avgFrameMs);
    if (this.perf.history.length > 6) this.perf.history.shift();
    const avg = this.perf.history.reduce((a, b) => a + b, 0) / this.perf.history.length;
    if (avg > CFG.render.downgradeFrameMs && this.perf.index < q.length - 1) {
      this.perf.index++;
      this.perf.history.length = 0;
      this.world.setQuality(this.perf.index);
      this.vfx.setQuality(this.world.quality.particles);
      this.debris.max = this.world.quality.debrisMax;
      S().settings.quality = this.perf.index;
      Save.markDirty();
      toast(`Качество: ${this.world.quality.name}`, '', 1400);
    } else if (avg < CFG.render.upgradeFrameMs && this.perf.index > 0 && this.perf.history.length >= 5) {
      this.perf.index--;
      this.perf.history.length = 0;
      this.world.setQuality(this.perf.index);
      this.vfx.setQuality(this.world.quality.particles);
      this.debris.max = this.world.quality.debrisMax;
      S().settings.quality = this.perf.index;
      Save.markDirty();
    }
  }

  // ------------------------------------------------------------- dev tools --
  syncTesterUi() {
    const on = !!S().settings.testerMode;
    if (this.hud && this.hud.testBtn) this.hud.testBtn.style.display = on && this.inBattle ? '' : 'none';
    if (!on) { const p = qs('#devpanel'); if (p) p.classList.remove('on'); }
  }

  toggleDevPanel() {
    const p = qs('#devpanel');
    if (!p) return;
    if (!p.childElementCount) this._buildDevPanel(p);
    p.classList.toggle('on');
  }

  _buildDevPanel(p) {
    clear(p);
    const row = (label, fn, guard) => {
      const b = el('button', {
        text: label,
        onclick: () => {
          if (guard && !guard()) return;
          fn();
          this._updateHud(0);
          if (p.classList.contains('on')) this._buildDevPanel(p);   // refresh labels/state
        },
      });
      p.appendChild(b);
    };
    const inBattle = () => {
      if (!this.inBattle) { toast('Доступно только в бою', 'bad', 1400); return false; }
      return true;
    };
    p.appendChild(el('div', { text: '🧪 ТЕСТЕР', style: { fontWeight: '700', marginBottom: '4px' } }));
    row('+500 всех ресурсов', () => { for (const id of ['stone', 'wood', 'metal', 'rope', 'pitch', 'coins']) addResource(id, 500); toast('+500 ресурсов', 'good', 1000); });
    row('+200 снабжения', () => { this.economy.budget += 200; toast('Снабжение +200', 'good', 1000); }, inBattle);
    row('Ядра +99 (все типы)', () => { for (const id of CFG.ammoOrder) this.loadout[id] = (this.loadout[id] || 0) + 99; this.hud.buildAmmo(); toast('Ядра +99', 'good', 1000); }, inBattle);
    row('God-mode: ' + (CFG.dev.godMode ? 'ВКЛ' : 'выкл'), () => { CFG.dev.godMode = !CFG.dev.godMode; });
    row('Мгновенный взвод: ' + (CFG.dev.instantCock ? 'ВКЛ' : 'выкл'), () => { CFG.dev.instantCock = !CFG.dev.instantCock; });
    row('Полный ремонт машины', () => { for (const id of CFG.trebuchet.nodes) this.trebuchet.repairNode(id, 1e5); this.hud.renderNodes(); this._cepDirty = true; toast('Машина как новая', 'good', 1200); }, inBattle);
    row('Износ 90% (проверка дуги)', () => { for (const id of CFG.trebuchet.nodes) { const n = this.trebuchet.nodes[id]; n.hp = n.max * 0.1; } this.trebuchet._syncNodesVisual(); this.hud.renderNodes(); this._cepDirty = true; this._updatePrediction(); toast('Ужасный износ', 'bad', 1200); }, inBattle);
    row('Разрушить выбранную цель', () => {
      if (!this.selectedTarget) { toast('Сначала выберите цель: тап по крепости', 'bad', 1800); return; }
      const t = this.selectedTarget;
      for (const b of t.blocks) if (b.alive) this.structures.damage(b, 1e6, { source: 'dev' });
      this._checkTargetEvents();
    }, inBattle);
    row('Залп врага по мне', () => {
      if (!this.enginesSafe()) { toast('В этой миссии нет орудий врага', 'bad', 1600); return; }
      this.enemy._fireAtPlayer(0.9, 2);
    }, inBattle);
    row('Пересчитать разброс', () => { this._cepDirty = true; this._updatePrediction(); });
    row('Небо: следующая тема', () => {
      const keys = Object.keys(CFG.world.skies);
      this._skyIdx = ((this._skyIdx === undefined ? keys.indexOf(this.world.skyThemeId || 'sunset') : this._skyIdx) + 1) % keys.length;
      this.world.applySkyTheme(keys[this._skyIdx]);
      toast('Небо: ' + keys[this._skyIdx], '', 1200);
    });
    row('Победа (results)', () => this.endMission(true), inBattle);
    row('Провал (results)', () => this.endMission(false), inBattle);
    row('Закрыть', () => p.classList.remove('on'));
  }
  enginesSafe() { return this.enemy && this.enemy.engines && this.enemy.engines.length > 0; }
}

// ===================================================================== boot ==
const game = new Game();
window.__GAME__ = game;
window.__S__ = S;   // dev/QA hook: live save state
window.__CFG__ = CFG; // dev/QA hook: live balance/config

async function start() {
  try {
    await game.boot();
  } catch (e) {
    console.error(e);
    const s = qs('#splash');
    if (s) s.innerHTML = `<div class="lg" style="color:#ff9a86">Ошибка запуска</div><pre style="max-width:86vw;overflow:auto;font-size:11px;opacity:.8">${String(e && e.stack || e)}</pre>`;
  }
}

// first user gesture unlocks audio (WebView requirement)
const unlock = () => { Audio.resume(); window.removeEventListener('touchstart', unlock); window.removeEventListener('pointerdown', unlock); };
window.addEventListener('touchstart', unlock, { passive: true });
window.addEventListener('pointerdown', unlock);

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
