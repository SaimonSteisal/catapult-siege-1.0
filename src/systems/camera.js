// ============================================================================
//  systems/camera.js — orbit / battle / flight / inspect controllers (§3.5)
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, lerp, damp, DEG, easeInOut } from '../core/utils.js';

const C = CFG.camera;

export class CameraRig {
  constructor(camera, dom) {
    this.cam = camera;
    this.dom = dom;
    this.mode = 'battle';
    this.prevMode = 'battle';
    this.target = new THREE.Vector3(...C.targetDefault);
    this.targetGoal = this.target.clone();
    this.dist = C.distDefault;
    this.distGoal = this.dist;
    this.az = 180;            // degrees; 180 = looking from -Z toward the fort at +Z
    this.pol = 62;            // degrees from +Y
    this.azGoal = this.az;
    this.polGoal = this.pol;
    this.shakeAmount = 0;
    this.shakeSeed = Math.random() * 100;
    this.transition = 0;
    this.transitionTime = 0;
    this.fovGoal = CFG.render.fovBase;
    this.follow = null;         // object to follow in flight mode
    this.followLead = C.flightLeadTime;
    this.locked = false;
    this.manualOffset = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._tmp2 = new THREE.Vector3();
    this.t = 0;
    this.onModeChange = null;
  }

  setMode(mode, opt = {}) {
    if (this.mode === mode && !opt.force) return;
    this.prevMode = this.mode;
    this.mode = mode;
    this.transition = 0;
    this.transitionTime = opt.time || (mode === 'flight' ? 0.35 : C.returnTime);
    if (opt.target) this.targetGoal.copy(opt.target);
    if (opt.dist) this.distGoal = opt.dist;
    if (opt.az !== undefined) this.azGoal = opt.az;
    if (opt.pol !== undefined) this.polGoal = opt.pol;
    if (opt.follow !== undefined) this.follow = opt.follow;
    if (this.onModeChange) this.onModeChange(mode, this.prevMode);
  }

  reset() {
    this.azGoal = 180; this.polGoal = 62; this.distGoal = C.distDefault;
    this.targetGoal.set(...C.targetDefault);
    this.manualOffset.set(0, 0, 0);
  }

  orbit(dx, dy, sens = 1) {
    if (this.mode === 'flight') return;
    const k = 0.16 * sens;   // constant feel: no speed-up when zoomed out
    this.azGoal = clamp(this.azGoal - dx * k, C.orbitMinAz + 180, C.orbitMaxAz + 180);
    this.polGoal = clamp(this.polGoal - dy * k * (CFG.settingsInvertY ? -1 : 1), C.orbitMinPolar, C.orbitMaxPolar);
  }

  zoom(delta) {
    this.distGoal = clamp(this.distGoal * (1 + delta * 0.09), C.distMin, C.distMax);
  }

  pan(dx, dy) {
    if (this.mode === 'flight') return;
    // pan along the ground plane relative to the current azimuth
    const a = this.az * DEG;
    const right = this._tmp.set(Math.cos(a), 0, -Math.sin(a));
    const fwd = this._tmp2.set(-Math.sin(a), 0, -Math.cos(a));
    this.manualOffset.addScaledVector(right, dx * this.dist * 0.045);
    this.manualOffset.addScaledVector(fwd, dy * this.dist * 0.045);
    this.manualOffset.x = clamp(this.manualOffset.x, -C.panRangeZ, C.panRangeZ);
    this.manualOffset.z = clamp(this.manualOffset.z, -C.panRangeZ, C.panRangeZ);
    this.manualOffset.y = clamp(this.manualOffset.y, -6, 12);
  }

  lookAtFort(pos) {
    this.targetGoal.copy(pos);
    this.manualOffset.set(0, 0, 0);
    this.distGoal = clamp(pos.length() * 0.55 + 16, C.distMin, C.distMax);
    this.azGoal = 180;
    this.polGoal = 58;
  }

  lookAtTrebuchet(pos) {
    this.targetGoal.copy(pos).add(new THREE.Vector3(0, 2.4, 0));
    this.manualOffset.set(0, 0, 0);
    this.distGoal = 15;
    this.azGoal = 205;
    this.polGoal = 66;
  }

  addShake(v) { this.shakeAmount = clamp(this.shakeAmount + v, 0, C.shakeMax); }

  update(dt, game) {
    this.t += dt;
    this.transition = Math.min(1, this.transition + dt / Math.max(0.001, this.transitionTime));

    // ---- follow mode
    if (this.mode === 'flight' && this.follow) {
      const p = this.follow.pos || this.follow.position;
      const v = this.follow.vel;
      this._tmp.copy(p);
      if (v) this._tmp.addScaledVector(v, this.followLead * clamp(v.length() / 34, 0.2, 1.2));
      this.targetGoal.lerp(this._tmp, clamp(dt * 7, 0, 1));
      this.fovGoal = CFG.render.fovFlight;
      // keep a readable distance, pull back as the shot slows
      const sp = v ? v.length() : 20;
      this.distGoal = clamp(7 + sp * 0.28, 8, 30);
      this.polGoal = damp(this.polGoal, 74, 3, dt);
    } else if (this.mode === 'battle') {
      this.fovGoal = CFG.render.fovBase;
    } else {
      this.fovGoal = CFG.render.fovBase;
    }

    // ---- smooth params
    const k = this.mode === 'flight' ? 7 : 9;
    this.az = damp(this.az, this.azGoal, k, dt);
    this.pol = damp(this.pol, this.polGoal, k, dt);
    this.dist = damp(this.dist, this.distGoal, k * 0.8, dt);
    this.target.lerp(this.targetGoal, clamp(dt * (this.mode === 'flight' ? 8 : 6), 0, 1));

    // ---- spherical → cartesian
    const pol = this.pol * DEG, az = this.az * DEG;
    const sp = Math.sin(pol);
    const base = this.target.clone().add(this.manualOffset);
    const pos = new THREE.Vector3(
      base.x + this.dist * sp * Math.sin(az),
      base.y + this.dist * Math.cos(pol),
      base.z + this.dist * sp * Math.cos(az)
    );
    // never go below terrain
    if (game && game.terrain) {
      const h = game.terrain.heightAt(pos.x, pos.z) + 1.6;
      if (pos.y < h) pos.y = h;
    }
    this.cam.position.copy(pos);
    this.cam.lookAt(base);

    // ---- shake
    if (this.shakeAmount > 0.0005) {
      const s = this.shakeAmount * CFG.vfx.maxShakePx;
      const t = this.t * 47 + this.shakeSeed;
      this.cam.position.x += Math.sin(t * 1.7) * s * 0.02;
      this.cam.position.y += Math.sin(t * 2.3 + 1.1) * s * 0.02;
      this.cam.position.z += Math.cos(t * 1.9 + 2.2) * s * 0.02;
      this.cam.rotateZ(Math.sin(t * 2.7) * s * 0.0016);
      this.shakeAmount = Math.max(0, this.shakeAmount - dt * C.shakeDecay * 0.5);
    }

    // ---- fov
    if (Math.abs(this.cam.fov - this.fovGoal) > 0.01) {
      this.cam.fov = damp(this.cam.fov, this.fovGoal, 6, dt);
      this.cam.updateProjectionMatrix();
    }
  }

  get spherical() { return { az: this.az, pol: this.pol, dist: this.dist }; }
}
