// ============================================================================
//  core/audio.js — 100% procedural WebAudio (Master Prompt §7). Zero assets.
// ============================================================================
import { CFG } from '../config.js';
import { clamp, makeRng } from './utils.js';

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this.volumes = { master: CFG.audio.masterVol, sfx: CFG.audio.sfxVol, music: CFG.audio.musicVol, ui: CFG.audio.uiVol };
    this.voices = 0;
    this.maxVoices = CFG.audio.voices;
    this.noiseBuf = null;
    this.music = null;
    this.rng = makeRng(9182736);
    this.lastShot = 0;
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { this.ctx = new AC({ latencyHint: 'interactive' }); } catch (e) { return; }

    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;

    this.comp = this.ctx.createDynamicsCompressor();
    this.comp.threshold.value = -14; this.comp.knee.value = 22;
    this.comp.ratio.value = 8; this.comp.attack.value = 0.004; this.comp.release.value = 0.18;

    this.limiter = this.ctx.createDynamicsCompressor();
    this.limiter.threshold.value = -1.2; this.limiter.knee.value = 0; this.limiter.ratio.value = 20;
    this.limiter.attack.value = 0.001; this.limiter.release.value = 0.05;

    this.busSfx = this.ctx.createGain(); this.busSfx.gain.value = this.volumes.sfx;
    this.busMusic = this.ctx.createGain(); this.busMusic.gain.value = this.volumes.music;
    this.busUi = this.ctx.createGain(); this.busUi.gain.value = this.volumes.ui;

    this.busSfx.connect(this.comp);
    this.busUi.connect(this.comp);
    this.busMusic.connect(this.comp);
    this.comp.connect(this.limiter);
    this.limiter.connect(this.master);
    this.master.connect(this.ctx.destination);

    // white-noise buffer (2 s) reused by every noise-based effect
    const len = Math.floor(this.ctx.sampleRate * 2);
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // brown-noise buffer for wind/rumble
    this.brownBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const b = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const w = Math.random() * 2 - 1; last = (last + 0.02 * w) / 1.02; b[i] = last * 3.2; }

    this.ready = true;
    this.startAmbience();
    this.startMusic();
  }

  resume() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
  }

  setVolume(bus, v) {
    this.volumes[bus] = clamp(v, 0, 1);
    if (!this.ready) return;
    const map = { master: this.master, sfx: this.busSfx, music: this.busMusic, ui: this.busUi };
    if (map[bus]) map[bus].gain.value = this.volumes[bus];
  }

  setMuted(m) { this.muted = m; if (this.ready) this.master.gain.value = m ? 0 : this.volumes.master; }

  get t() { return this.ctx.currentTime; }

  _guard() {
    if (!this.ready || this.muted) return false;
    if (this.voices > this.maxVoices) return false;
    return true;
  }
  _use(n = 1) { this.voices += n; }
  _free(n = 1) { this.voices = Math.max(0, this.voices - n); }

  // ------------------------------------------------------------ primitives ---
  _noise(opts = {}) {
    const { dur = 0.3, type = 'lowpass', freq = 800, q = 1, gain = 0.5, attack = 0.002, dest = this.busSfx, rate = 1, sweep = 0 } = opts;
    if (!this._guard()) return null;
    this._use();
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.playbackRate.value = rate;
    src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = type; flt.frequency.value = freq; flt.Q.value = q;
    const g = this.ctx.createGain();
    const t0 = this.t;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (sweep) flt.frequency.exponentialRampToValueAtTime(Math.max(60, freq * sweep), t0 + dur);
    src.connect(flt); flt.connect(g); g.connect(dest);
    src.start(t0); src.stop(t0 + dur + 0.05);
    src.onended = () => this._free();
    return { src, flt, g };
  }

  _tone(opts = {}) {
    const { freq = 440, dur = 0.2, type = 'sine', gain = 0.2, attack = 0.005, dest = this.busSfx, detune = 0, endFreq = 0, pan = 0 } = opts;
    if (!this._guard()) return null;
    this._use();
    const osc = this.ctx.createOscillator();
    osc.type = type; osc.frequency.value = freq; osc.detune.value = detune;
    const g = this.ctx.createGain();
    const t0 = this.t;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.linearRampToValueAtTime(gain, t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    if (endFreq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t0 + dur);
    let node = osc;
    if (pan && this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); osc.connect(p); node = p; }
    node.connect(g); g.connect(dest);
    osc.start(t0); osc.stop(t0 + dur + 0.05);
    osc.onended = () => this._free();
    return { osc, g };
  }

  _pluck(freq, dur = 0.5, gain = 0.16, type = 'triangle') {
    return this._tone({ freq, dur, gain, type, attack: 0.002 });
  }

  // ----------------------------------------------------------------- SFX ----
  uiTap() { this._tone({ freq: 880, dur: 0.045, gain: 0.045, type: 'sine' }); }
  uiHover() { this._tone({ freq: 1320, dur: 0.03, gain: 0.02, type: 'sine' }); }
  uiBack() { this._tone({ freq: 420, dur: 0.07, gain: 0.05, type: 'sine', endFreq: 300 }); }
  uiError() { this._tone({ freq: 160, dur: 0.16, gain: 0.09, type: 'sawtooth', endFreq: 110 }); this._noise({ dur: 0.1, freq: 400, gain: 0.05 }); }
  uiBuy() { this._pluck(660, 0.12, 0.09); setTimeout(() => this._pluck(990, 0.16, 0.08), 70); }
  uiUnlock() { [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => this._pluck(f, 0.3, 0.09), i * 75)); }

  cock(pitch = 1) {
    // winch creak: FM-ish squeak + ratchet clicks
    this._tone({ freq: 190 * pitch, dur: 0.85, gain: 0.05, type: 'sawtooth', endFreq: 260 * pitch });
    for (let i = 0; i < 7; i++) setTimeout(() => this._noise({ dur: 0.035, freq: 2400, q: 6, gain: 0.035, type: 'bandpass' }), i * 105);
  }
  loadThunk() { this._noise({ dur: 0.14, freq: 260, gain: 0.16, type: 'lowpass' }); this._tone({ freq: 92, dur: 0.16, gain: 0.11, type: 'sine', endFreq: 58 }); }

  fire(power = 1) {
    const p = clamp(power, 0.3, 1);
    // deep thump
    this._tone({ freq: 130 + p * 40, dur: 0.5, gain: 0.42 * p + 0.15, type: 'sine', endFreq: 38, attack: 0.003 });
    // noise crack
    this._noise({ dur: 0.32, freq: 1500, gain: 0.34 * p + 0.1, type: 'lowpass', sweep: 0.15 });
    // sling snap
    this._noise({ dur: 0.11, freq: 2600, q: 3, gain: 0.2, type: 'bandpass', rate: 1.4 });
    // wood groan
    this._tone({ freq: 210, dur: 0.55, gain: 0.09, type: 'triangle', endFreq: 120 });
    this._duckMusic(0.5);
  }

  whistle(speed = 25, pan = 0) {
    if (!this._guard() || !isFinite(speed)) return;
    this._use(2);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.Q.value = 9;
    bp.frequency.setValueAtTime(500 + speed * 26, this.t);
    bp.frequency.exponentialRampToValueAtTime(280 + speed * 8, this.t + 1.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.t);
    g.gain.linearRampToValueAtTime(clamp(speed / 90, 0.02, 0.16), this.t + 0.06);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + 1.7);
    let node = src;
    if (this.ctx.createStereoPanner) { const p = this.ctx.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); src.connect(p); node = p; }
    node.connect(bp); bp.connect(g); g.connect(this.busSfx);
    src.start(); src.stop(this.t + 1.8);
    src.onended = () => this._free(2);
  }

  impactStone(force = 1) {
    const f = clamp(force, 0.1, 2);
    this._noise({ dur: 0.22 * f, freq: 1100, gain: 0.30 * f, type: 'lowpass', sweep: 0.18 });
    this._tone({ freq: 340 + this.rng.range(-40, 60), dur: 0.34 * f, gain: 0.16 * f, type: 'triangle', endFreq: 120 });
    // rubble
    for (let i = 0; i < Math.min(9, Math.round(5 * f)); i++) {
      setTimeout(() => this._noise({ dur: 0.05, freq: this.rng.range(900, 2600), q: 2, gain: 0.05 * f, type: 'bandpass' }), i * 38 + this.rng.range(0, 30));
    }
  }
  impactWood(force = 1) {
    const f = clamp(force, 0.1, 2);
    this._noise({ dur: 0.16 * f, freq: 700, gain: 0.26 * f, type: 'lowpass', sweep: 0.25 });
    this._tone({ freq: 180, dur: 0.24 * f, gain: 0.13 * f, type: 'square', endFreq: 70 });
    for (let i = 0; i < Math.min(7, Math.round(4 * f)); i++) setTimeout(() => this._noise({ dur: 0.045, freq: this.rng.range(600, 1500), gain: 0.05, type: 'bandpass', q: 3 }), i * 45);
  }
  impactMetal(force = 1) {
    const f = clamp(force, 0.1, 2);
    this._tone({ freq: 2200, dur: 0.5 * f, gain: 0.10 * f, type: 'triangle', endFreq: 1500 });
    this._tone({ freq: 3100, dur: 0.36 * f, gain: 0.06 * f, type: 'sine', endFreq: 2400 });
    this._noise({ dur: 0.12 * f, freq: 3200, gain: 0.18 * f, type: 'highpass' });
  }
  impactGround(force = 1) { this._noise({ dur: 0.26 * clamp(force, 0.1, 2), freq: 320, gain: 0.20 * force, type: 'lowpass', sweep: 0.3 }); }
  splash(force = 1) { this._noise({ dur: 0.4 * force, freq: 1600, gain: 0.16, type: 'bandpass', q: 0.8, sweep: 0.35 }); }

  explode(force = 1) {
    const f = clamp(force, 0.2, 2);
    this._tone({ freq: 90, dur: 1.1 * f, gain: 0.5 * f, type: 'sine', endFreq: 28 });
    this._noise({ dur: 0.9 * f, freq: 900, gain: 0.42 * f, type: 'lowpass', sweep: 0.08 });
    this._noise({ dur: 0.16, freq: 4200, gain: 0.22 * f, type: 'highpass' });
    this._duckMusic(0.8);
  }
  fireWhoosh() { this._noise({ dur: 0.9, freq: 700, gain: 0.14, type: 'bandpass', q: 0.7, sweep: 2.2, rate: 0.8 }); }

  collapse(size = 1) {
    // granular rubble burst
    const n = Math.round(12 * clamp(size, 0.3, 2));
    for (let i = 0; i < n; i++) {
      const d = i * (36 + Math.random() * 40);
      setTimeout(() => {
        this._noise({ dur: 0.06 + Math.random() * 0.1, freq: 300 + Math.random() * 1800, gain: 0.05 + Math.random() * 0.09, type: 'bandpass', q: 1.5 });
      }, d);
    }
    this._tone({ freq: 70, dur: 0.8 * size, gain: 0.2 * size, type: 'sine', endFreq: 32 });
    this._duckMusic(0.6);
  }

  repair() {
    for (let i = 0; i < 3; i++) setTimeout(() => this._noise({ dur: 0.05, freq: 1800 + i * 500, gain: 0.09, type: 'bandpass', q: 5 }), i * 90);
    this._tone({ freq: 320, dur: 0.16, gain: 0.07, type: 'square', endFreq: 420 });
  }
  hit() { this._tone({ freq: 700, dur: 0.08, gain: 0.10, type: 'square', endFreq: 900 }); }
  crit() { this._tone({ freq: 1200, dur: 0.12, gain: 0.12, type: 'square', endFreq: 1800 }); setTimeout(() => this._tone({ freq: 2000, dur: 0.14, gain: 0.08, type: 'sine' }), 60); }
  miss() { this._tone({ freq: 300, dur: 0.3, gain: 0.07, type: 'triangle', endFreq: 140 }); }

  enemyShot(dist = 60) {
    const g = clamp(1 - dist / 130, 0.12, 0.7);
    this._tone({ freq: 110, dur: 0.4, gain: 0.20 * g, type: 'sine', endFreq: 42 });
    this._noise({ dur: 0.3, freq: 900, gain: 0.14 * g, type: 'lowpass', sweep: 0.2 });
  }
  nodeDamage() { this._tone({ freq: 150, dur: 0.45, gain: 0.14, type: 'sawtooth', endFreq: 62 }); this._noise({ dur: 0.3, freq: 500, gain: 0.12, type: 'lowpass' }); }
  alarm() { [0, 180, 360].forEach((d, i) => setTimeout(() => this._tone({ freq: 620, dur: 0.12, gain: 0.09, type: 'square', endFreq: 480 }), d)); }

  success() { [523, 659, 784, 1046, 1318].forEach((f, i) => setTimeout(() => this._pluck(f, 0.42, 0.10), i * 82)); }
  rankS() { [523, 784, 1046, 1318, 1568, 2093].forEach((f, i) => setTimeout(() => this._pluck(f, 0.6, 0.10, 'triangle'), i * 78)); }
  fail() { [392, 349, 294, 233].forEach((f, i) => setTimeout(() => this._tone({ freq: f, dur: 0.42, gain: 0.10, type: 'sawtooth' }), i * 130)); }
  coins(n = 1) { for (let i = 0; i < Math.min(6, n); i++) setTimeout(() => this._tone({ freq: 1800 + Math.random() * 900, dur: 0.07, gain: 0.05, type: 'sine' }), i * 55); }
  levelUp() { [440, 554, 659, 880].forEach((f, i) => setTimeout(() => this._pluck(f, 0.5, 0.11), i * 90)); }

  // ------------------------------------------------------------ ambience ---
  startAmbience() {
    if (!this.ready || this.ambience) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.brownBuf; src.loop = true;
    const flt = this.ctx.createBiquadFilter();
    flt.type = 'lowpass'; flt.frequency.value = 420; flt.Q.value = 0.4;
    const g = this.ctx.createGain(); g.gain.value = 0.0;
    src.connect(flt); flt.connect(g); g.connect(this.busSfx);
    src.start();
    this.ambience = { src, flt, g };
  }
  setWind(strength = 0, gust = 0) {
    if (!this.ready || !this.ambience) return;
    const s = clamp(strength / 14, 0, 1);
    const target = 0.012 + s * 0.10 + gust * 0.02;
    this.ambience.g.gain.setTargetAtTime(this.muted ? 0 : target, this.t, 0.6);
    this.ambience.flt.frequency.setTargetAtTime(300 + s * 700, this.t, 0.8);
  }

  // ---------------------------------------------------------------- music ---
  startMusic() {
    if (!this.ready || this.music) return;
    const g = this.ctx.createGain(); g.gain.value = 0.0;
    g.connect(this.busMusic);
    const flt = this.ctx.createBiquadFilter(); flt.type = 'lowpass'; flt.frequency.value = 900; flt.Q.value = 0.6;
    flt.connect(g);

    // drone: two detuned saws through the filter (D minor-ish)
    const oscs = [];
    [73.42, 110, 146.83].forEach((f, i) => {
      const a = this.ctx.createOscillator(); a.type = 'sawtooth'; a.frequency.value = f;
      const b = this.ctx.createOscillator(); b.type = 'sawtooth'; b.frequency.value = f * 1.004;
      const og = this.ctx.createGain(); og.gain.value = i === 2 ? 0.05 : 0.09;
      a.connect(og); b.connect(og); og.connect(flt);
      a.start(); b.start();
      oscs.push(a, b);
    });
    // slow LFO on filter
    const lfo = this.ctx.createOscillator(); lfo.frequency.value = 0.045;
    const lfoG = this.ctx.createGain(); lfoG.gain.value = 320;
    lfo.connect(lfoG); lfoG.connect(flt.frequency); lfo.start();

    this.music = { g, flt, oscs, lfo, intensity: 0, nextBeat: this.t + 1.0, beat: 0 };
  }

  setMusicIntensity(v) {
    if (!this.ready || !this.music) return;
    const i = clamp(v, 0, 1);
    this.music.intensity = i;
    this.music.g.gain.setTargetAtTime(this.muted ? 0 : 0.10 + i * 0.16, this.t, 1.2);
    this.music.flt.frequency.setTargetAtTime(620 + i * 1400, this.t, 1.0);
  }

  _duckMusic(sec = 0.5) {
    if (!this.ready || !this.music) return;
    const db = CFG.audio.duckDb;
    const g = this.music.g.gain;
    const cur = g.value;
    g.cancelScheduledValues(this.t);
    g.setValueAtTime(cur, this.t);
    g.linearRampToValueAtTime(cur * Math.pow(10, db / 20), this.t + 0.03);
    g.linearRampToValueAtTime(this.muted ? 0 : 0.10 + this.music.intensity * 0.16, this.t + sec);
  }

  // procedural frame-drum pulse; density follows battle intensity
  tickMusic() {
    if (!this.ready || !this.music || this.muted) return;
    const m = this.music;
    if (this.t < m.nextBeat) return;
    const bpm = 74 + m.intensity * 34;
    const beatDur = 60 / bpm;
    m.nextBeat = this.t + beatDur;
    m.beat = (m.beat + 1) % 8;
    const density = 0.22 + m.intensity * 0.6;
    // kick on 0 and 4 (+2 when intense)
    if (m.beat === 0 || m.beat === 4 || (m.beat === 2 && m.intensity > 0.55)) {
      this._tone({ freq: 96, dur: 0.24, gain: 0.16 + m.intensity * 0.1, type: 'sine', endFreq: 44, dest: this.busMusic });
    }
    // frame drum shuffle
    if (this.rng.chance(density * 0.6)) {
      this._noise({ dur: 0.09, freq: 2600, q: 1.6, gain: 0.045 + m.intensity * 0.03, type: 'bandpass', dest: this.busMusic, rate: 1.2 });
    }
    // melodic ping on bar starts when calm
    if (m.beat === 0 && this.rng.chance(0.4 - m.intensity * 0.25)) {
      const scale = [293.66, 349.23, 392.0, 440.0, 523.25, 587.33];
      const f = this.rng.pick(scale);
      this._tone({ freq: f, dur: 1.6, gain: 0.05, type: 'triangle', dest: this.busMusic, attack: 0.08 });
    }
  }

  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {}); }
  setMutedAll(m) { this.setMuted(m); }
}

export const Audio = new AudioEngine();
