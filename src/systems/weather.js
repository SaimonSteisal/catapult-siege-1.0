// ============================================================================
//  systems/weather.js — wind field, rain/snow, fog, day-night lighting (§4.8)
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, lerp, makeNoise1D, damp } from '../core/utils.js';

export class Weather {
  constructor(scene, physics, lights) {
    this.scene = scene;
    this.physics = physics;
    this.lights = lights;
    this.noise = makeNoise1D(4242);
    this.t = 0;
    this.type = 'clear';      // clear | rain | fog | snow | night
    this.windDir = 0;         // degrees
    this.windSpeed = 0;       // m/s
    this.gust = 0;
    this.visibility = 1;
    this.rainCount = 0;
    this.particles = null;
    this.flagAngle = 0;
    this._buildParticles();
  }

  _buildParticles() {
    const max = 1400;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(max * 3);
    const vel = new Float32Array(max * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xcfe0ee, size: 0.16, transparent: true, opacity: 0.0,
      depthWrite: false, sizeAttenuation: true, fog: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.visible = false;
    this.scene.add(this.points);
    this.pos = pos; this.vel = vel; this.max = max;
    this.active = 0;
  }

  configure(mod, rng) {
    this.mod = mod || { id: 'calm' };
    const base = this.mod.wind === undefined ? 0 : this.mod.wind;
    this.windSpeed = base * (0.55 + rng() * 0.75) * (CFG.missions.windMax[2] / 9);
    this.windDir = rng.range(0, 360);
    this.type = this.mod.id === 'rain' ? 'rain' : this.mod.id === 'fog' ? 'fog' : this.mod.id === 'night' ? 'night' : 'clear';
    if (this.mod.id === 'gale') this.windSpeed *= 1.25;
    this.visibility = this.mod.visibility === undefined ? 1 : this.mod.visibility;
    this.physics.setWind(this.windDir, this.windSpeed);
    this._applyFog();
    this._applyLighting();
    this._applyParticles();
  }

  setWinter(on) { this.winter = on; if (on && this.type === 'clear') { this.type = 'snow'; this._applyParticles(); } }

  _applyFog() {
    const fogOn = CFG.render.qualitySteps[CFG.render.qualityStart].fog;
    if (!fogOn) { this.scene.fog = null; return; }
    const near = this.type === 'fog' ? 14 : 90;
    const far = this.type === 'fog' ? 105 : 340;
    if (!this.scene.fog) this.scene.fog = new THREE.Fog(0xbcc8d4, near, far);
    this.scene.fog.near = near; this.scene.fog.far = far;
    this.scene.fog.color.setHex(this.type === 'fog' ? 0xb9bfc4 : this.type === 'night' ? 0x22303f : 0xc9d6e2);
  }

  _applyLighting() {
    const L = this.lights;
    if (!L) return;
    if (this.type === 'night') {
      L.sun.color.setHex(0x6f86b8); L.sun.intensity = 0.35;
      L.hemi.color.setHex(0x2c3a52); L.hemi.groundColor.setHex(0x141a24); L.hemi.intensity = 0.55;
      L.sun.position.set(-30, 26, -40);
      if (this.scene.background && this.scene.background.uniforms) {
        this.scene.background.uniforms.topColor.value.setHex(0x0e1626);
        this.scene.background.uniforms.midColor.value.setHex(0x1d2a44);
        this.scene.background.uniforms.botColor.value.setHex(0x3a4a63);
      }
      L.torches.forEach((t) => { t.visible = true; });
    } else if (this.type === 'rain') {
      L.sun.color.setHex(0xb9c4cc); L.sun.intensity = 0.62;
      L.hemi.color.setHex(0x8fa0ae); L.hemi.groundColor.setHex(0x4a4438); L.hemi.intensity = 0.85;
      L.sun.position.set(-40, 48, 20);
      if (this.scene.background && this.scene.background.uniforms) {
        this.scene.background.uniforms.topColor.value.setHex(0x6a7885);
        this.scene.background.uniforms.midColor.value.setHex(0x93a0aa);
        this.scene.background.uniforms.botColor.value.setHex(0xb4bcc2);
      }
      L.torches.forEach((t) => { t.visible = false; });
    } else if (this.type === 'fog') {
      L.sun.color.setHex(0xd8d2c4); L.sun.intensity = 0.5;
      L.hemi.color.setHex(0xc4ccd2); L.hemi.groundColor.setHex(0x6a6353); L.hemi.intensity = 1.05;
      if (this.scene.background && this.scene.background.uniforms) {
        this.scene.background.uniforms.topColor.value.setHex(0xa8b2ba);
        this.scene.background.uniforms.midColor.value.setHex(0xbcc4ca);
        this.scene.background.uniforms.botColor.value.setHex(0xcfd4d6);
      }
      L.torches.forEach((t) => { t.visible = false; });
    } else if (this.winter) {
      L.sun.color.setHex(0xdfe8f2); L.sun.intensity = 0.92;
      L.hemi.color.setHex(0xc6d6e6); L.hemi.groundColor.setHex(0x8a8f96); L.hemi.intensity = 0.95;
      L.sun.position.set(-46, 34, 26);
      if (this.scene.background && this.scene.background.uniforms) {
        this.scene.background.uniforms.topColor.value.setHex(0x7d9fc4);
        this.scene.background.uniforms.midColor.value.setHex(0xb9cede);
        this.scene.background.uniforms.botColor.value.setHex(0xe2e8ec);
      }
      L.torches.forEach((t) => { t.visible = false; });
    } else {
      L.sun.color.setHex(0xffd9a0); L.sun.intensity = 1.18;
      L.hemi.color.setHex(0x8fb4d9); L.hemi.groundColor.setHex(0x6a5c42); L.hemi.intensity = 0.72;
      L.sun.position.set(-52, 44, 22);
      if (this.scene.background && this.scene.background.uniforms) {
        this.scene.background.uniforms.topColor.value.setHex(0x5b8fc4);
        this.scene.background.uniforms.midColor.value.setHex(0xa9c6dd);
        this.scene.background.uniforms.botColor.value.setHex(0xe8c9a0);
      }
      L.torches.forEach((t) => { t.visible = false; });
    }
    if (L.sun.shadow) { L.sun.shadow.needsUpdate = true; }
  }

  _applyParticles() {
    if (this.type === 'rain' || this.type === 'snow') {
      this.active = this.type === 'rain' ? 1100 : 700;
      this.points.visible = true;
      this.points.material.opacity = this.type === 'rain' ? 0.5 : 0.85;
      this.points.material.size = this.type === 'rain' ? 0.11 : 0.20;
      this.points.material.color.setHex(this.type === 'rain' ? 0xa8c4dc : 0xffffff);
      for (let i = 0; i < this.active; i++) this._respawn(i, true);
    } else {
      this.active = 0;
      this.points.visible = false;
    }
    this.points.geometry.setDrawRange(0, this.active);
  }

  _respawn(i, initial = false) {
    const r = 46;
    this.pos[i * 3] = (Math.random() - 0.5) * r * 2;
    this.pos[i * 3 + 1] = initial ? Math.random() * 34 : 30 + Math.random() * 8;
    this.pos[i * 3 + 2] = (Math.random() - 0.5) * r * 2;
    const fall = this.type === 'rain' ? 26 : 2.4;
    this.vel[i * 3] = 0; this.vel[i * 3 + 1] = -fall * (0.8 + Math.random() * 0.4); this.vel[i * 3 + 2] = 0;
  }

  update(dt, cameraPos) {
    this.t += dt;
    // wind with gusts
    const gustN = this.noise(this.t * 0.16) * 0.5 + Math.sin(this.t * 0.37) * 0.2;
    this.gust = clamp(gustN, -0.6, 0.6);
    this.physics.updateWind(this.t);
    const effective = this.physics.windSpeed();

    // precipitation follows the camera
    if (this.active > 0) {
      const cx = cameraPos ? cameraPos.x : 0, cz = cameraPos ? cameraPos.z : 0;
      const wx = this.physics.wind.x, wz = this.physics.wind.z;
      for (let i = 0; i < this.active; i++) {
        this.pos[i * 3] += (this.vel[i * 3] + wx * (this.type === 'rain' ? 0.45 : 1.5)) * dt;
        this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
        this.pos[i * 3 + 2] += (this.vel[i * 3 + 2] + wz * (this.type === 'rain' ? 0.45 : 1.5)) * dt;
        if (this.pos[i * 3 + 1] < -1 || Math.abs(this.pos[i * 3] - cx) > 52 || Math.abs(this.pos[i * 3 + 2] - cz) > 52) this._respawn(i);
      }
      // keep the box centred on the camera
      this.points.position.set(cx, 0, cz);
      this.points.geometry.attributes.position.needsUpdate = true;
    }

    this.flagAngle = damp(this.flagAngle, Math.atan2(this.physics.wind.z, this.physics.wind.x), 3, dt);
    return effective;
  }

  /** human-readable wind for HUD */
  hud() {
    const s = this.physics.windSpeed();
    const dirs = ['С', 'СВ', 'В', 'ЮВ', 'Ю', 'ЮЗ', 'З', 'СЗ'];
    const idx = Math.round(((this.windDir % 360) / 45)) % 8;
    return { speed: s, dir: dirs[idx], dirDeg: this.windDir, gust: this.gust, type: this.type };
  }
}
