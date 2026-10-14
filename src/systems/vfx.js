// ============================================================================
//  systems/vfx.js — pooled particles, trajectory visualisation, impact marks,
//  floating damage numbers, screen shake (§6, §11)
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, lerp, makeRng, easeOutCubic } from '../core/utils.js';

const UP = new THREE.Vector3(0, 1, 0);

class SpritePool {
  constructor(scene, materialFactory, max, sizeScale = 1) {
    this.max = max;
    this.items = [];
    this.scene = scene;
    for (let i = 0; i < max; i++) {
      const mat = materialFactory();
      const s = new THREE.Sprite(mat);
      s.visible = false;
      s.scale.setScalar(sizeScale);
      scene.add(s);
      this.items.push({ sprite: s, life: 0, maxLife: 1, vel: new THREE.Vector3(), grow: 0, fade: 1, spin: 0, alive: false, baseOpacity: mat.opacity });
    }
    this.cursor = 0;
  }
  spawn(pos, opt = {}) {
    let it = null;
    for (let i = 0; i < this.max; i++) {
      const idx = (this.cursor + i) % this.max;
      if (!this.items[idx].alive) { it = this.items[idx]; this.cursor = (idx + 1) % this.max; break; }
    }
    if (!it) { it = this.items[this.cursor]; this.cursor = (this.cursor + 1) % this.max; }
    it.alive = true;
    it.life = 0;
    it.maxLife = opt.life || 1;
    it.sprite.position.copy(pos);
    it.vel.copy(opt.vel || new THREE.Vector3());
    it.grow = opt.grow === undefined ? 1.6 : opt.grow;
    it.fade = opt.fade === undefined ? 1 : opt.fade;
    it.drag = opt.drag === undefined ? 1.2 : opt.drag;
    it.gravity = opt.gravity === undefined ? 0 : opt.gravity;
    it.spin = opt.spin || 0;
    const s0 = opt.size || 1;
    it.size0 = s0;
    it.sprite.scale.setScalar(s0);
    it.sprite.material.rotation = opt.rot || 0;
    if (opt.color !== undefined) it.sprite.material.color.setHex(opt.color);
    it.sprite.material.opacity = opt.opacity === undefined ? it.baseOpacity : opt.opacity;
    it.baseOpacityNow = it.sprite.material.opacity;
    it.sprite.visible = true;
    return it;
  }
  update(dt) {
    for (const it of this.items) {
      if (!it.alive) continue;
      it.life += dt;
      const k = it.life / it.maxLife;
      if (k >= 1) { it.alive = false; it.sprite.visible = false; continue; }
      it.vel.multiplyScalar(Math.max(0, 1 - it.drag * dt));
      it.vel.y -= it.gravity * dt;
      it.sprite.position.addScaledVector(it.vel, dt);
      if (it.spin) it.sprite.material.rotation += it.spin * dt;
      const s = it.size0 * (1 + it.grow * k);
      it.sprite.scale.setScalar(s);
      it.sprite.material.opacity = it.baseOpacityNow * Math.pow(1 - k, it.fade);
    }
  }
  clear() { for (const it of this.items) { it.alive = false; it.sprite.visible = false; } }
}

export class VFX {
  constructor(scene, materials, camera, domLayer) {
    this.scene = scene;
    this.M = materials;
    this.camera = camera;
    this.dom = domLayer;
    this.rng = makeRng(31337);
    this.quality = 1;

    const smokeMat = () => this.M.smoke.clone();
    const sparkMat = () => this.M.spark.clone();
    const flashMat = () => this.M.flash.clone();

    this.smoke = new SpritePool(scene, smokeMat, CFG.vfx.smokeMax, 1);
    this.sparks = new SpritePool(scene, sparkMat, CFG.vfx.sparkMax, 1);
    this.flashes = new SpritePool(scene, flashMat, 12, 1);

    // ---- dust rings on the ground
    this.rings = [];
    this.ringGeo = new THREE.RingGeometry(0.4, 1.0, 20);
    this.ringGeo.rotateX(-Math.PI / 2);

    // ---- impact decals (scorch / crater marks)
    this.decals = [];
    this.decalGeo = new THREE.CircleGeometry(1, 14);
    this.decalGeo.rotateX(-Math.PI / 2);
    this.decalMat = new THREE.MeshBasicMaterial({ color: 0x2a2118, transparent: true, opacity: 0.42, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -3 });

    // ---- prediction arc
    this.predLine = new THREE.Line(new THREE.BufferGeometry(), materials.pred);
    this.predLine.frustumCulled = false;
    this.predLine.visible = false;
    scene.add(this.predLine);
    this.predDots = [];
    for (let i = 0; i < CFG.ballistics.predictPoints; i++) {
      const s = new THREE.Sprite(materials.dot.clone());
      s.scale.setScalar(0.34);
      s.visible = false;
      scene.add(s);
      this.predDots.push(s);
    }
    // ghost trail of the previous shot
    this.ghostLine = new THREE.Line(new THREE.BufferGeometry(), materials.ghost);
    this.ghostLine.frustumCulled = false;
    this.ghostLine.visible = false;
    scene.add(this.ghostLine);

    // ---- spread area: translucent CEP disk on the ground + drop line
    this.cepDisk = new THREE.Mesh(
      new THREE.CircleGeometry(1, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false })
    );
    this.cepDisk.rotation.x = -Math.PI / 2;
    this.cepDisk.visible = false;
    scene.add(this.cepDisk);
    this.cepRing = new THREE.Mesh(
      new THREE.RingGeometry(0.92, 1, 28),
      new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false })
    );
    this.cepRing.rotation.x = -Math.PI / 2;
    this.cepRing.visible = false;
    scene.add(this.cepRing);
    this.dropLine = new THREE.Line(
      new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0], 3)),
      new THREE.LineDashedMaterial({ color: 0xffd27a, transparent: true, opacity: 0.5, dashSize: 0.5, gapSize: 0.35, depthWrite: false })
    );
    this.dropLine.visible = false;
    scene.add(this.dropLine);

    // ---- impact marker (predicted landing ellipse)
    this.marker = new THREE.Group();
    const ring = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 26), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false }));
    ring.rotation.x = -Math.PI / 2;
    const cross1 = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 0.12), new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.7, depthWrite: false }));
    cross1.rotation.x = -Math.PI / 2;
    const cross2 = cross1.clone(); cross2.rotation.z = Math.PI / 2;
    this.marker.add(ring, cross1, cross2);
    this.marker.visible = false;
    scene.add(this.marker);
    this.markerScale = 1;

    // ---- spread sample dots (where virtual sample shots landed)
    this.cepDots = [];
    for (let i = 0; i < 8; i++) {
      const d = new THREE.Sprite(materials.dot.clone());
      d.material.color.setHex(0xffb45a);
      d.material.opacity = 0.55;
      d.scale.setScalar(0.5);
      d.visible = false;
      scene.add(d);
      this.cepDots.push(d);
    }

    // ---- target outline marker
    this.targetMarker = new THREE.Mesh(
      new THREE.TorusGeometry(2.2, 0.09, 6, 26),
      new THREE.MeshBasicMaterial({ color: 0xff5a4a, transparent: true, opacity: 0.85, depthWrite: false })
    );
    this.targetMarker.rotation.x = Math.PI / 2;
    this.targetMarker.visible = false;
    scene.add(this.targetMarker);

    // ---- floating numbers (DOM)
    this.floaters = [];
    this.floaterPool = [];
    for (let i = 0; i < CFG.vfx.hitNumberMax; i++) {
      const el = document.createElement('div');
      el.className = 'floater';
      el.style.display = 'none';
      if (domLayer) domLayer.appendChild(el);
      this.floaterPool.push({ el, life: 0, maxLife: 1, pos: new THREE.Vector3(), vy: 0 });
    }

    // ---- screen shake state
    this.shake = 0;
    this.shakeVec = new THREE.Vector2();
    this.hitStop = 0;
    this.slowmo = 0;
    this.slowmoScale = 1;

    // ---- fire lights
    this.fireLights = [];
    this._t = 0;
  }

  setQuality(k) { this.quality = k; }

  // ------------------------------------------------------------------- fx ----
  impact(pos, normal, kind, force = 1, ammo = null) {
    const f = clamp(force, 0.2, 2) * this.quality;
    if (kind === 'ground') {
      this.dustPuff(pos, Math.round(7 * f), 0.9 + f * 0.5, 0x9a8a6a);
      this.ring(pos, 1.1 + f, 0.55);
      this.decal(pos, 0.7 + f * 0.5, 0x3a2f22);
    } else if (kind === 'fire') {
      this.fireBurst(pos, Math.round(9 * f));
      this.dustPuff(pos, Math.round(5 * f), 1.0, 0x6a5540);
    } else if (kind === 'shrapnel') {
      this.sparkBurst(pos, Math.round(14 * f), 9);
      this.dustPuff(pos, Math.round(4 * f), 0.7, 0x8a7a5a);
    } else if (kind === 'pierce') {
      this.sparkBurst(pos, Math.round(16 * f), 12);
      this.dustPuff(pos, Math.round(6 * f), 0.8, 0x9a9a9a);
    } else {
      this.dustPuff(pos, Math.round(8 * f), 0.9 + f * 0.4, 0xa89880);
      this.sparkBurst(pos, Math.round(5 * f), 6);
    }
    this.addShake(0.10 * f);
  }

  blockImpact(pos, normal, mat, force, ammo) {
    const f = clamp(force / 26, 0.15, 1.6) * this.quality;
    const col = mat === 'wood' ? 0x8a6a3a : mat === 'metal' ? 0xbfc6cc : mat === 'pitch' ? 0x4a3a2a : 0xa89880;
    this.dustPuff(pos, Math.round(6 * f), 0.6 + f * 0.4, col);
    if (mat === 'metal') this.sparkBurst(pos, Math.round(10 * f), 11);
    if (ammo && ammo.vfx === 'fire') this.fireBurst(pos, Math.round(6 * f));
    this.addShake(0.06 * f);
  }

  destroyBlock(block, dir) {
    const pos = block.p;
    const col = CFG.blocks.materials[block.mat].color;
    this.dustPuff(pos, Math.round(5 * this.quality), Math.max(block.hs.x, block.hs.y) * 1.6, col);
    if (block.mat === 'pitch') this.fireBurst(pos, Math.round(8 * this.quality));
  }

  explosion(pos, radius, kind = 'boom') {
    const f = clamp(radius / 3, 0.4, 2) * this.quality;
    this.flashes.spawn(pos, { life: 0.16, size: radius * 1.5, grow: 1.4, opacity: 0.95, color: 0xfff0c0 });
    this.dustPuff(pos, Math.round(12 * f), radius * 0.8, kind === 'fire' ? 0x6a4a30 : 0x8a8070);
    this.smokeColumn(pos, Math.round(9 * f), radius * 0.55, 0x4a443c);
    this.sparkBurst(pos, Math.round(20 * f), 14 + radius * 2);
    this.ring(pos, radius * 1.5, 0.7);
    this.decal(pos, radius * 0.85, 0x1e1812);
    if (kind === 'fire') { this.fireBurst(pos, Math.round(16 * f)); this.addFireLight(pos, radius, 1.6); }
    this.addShake(0.30 * f);
    this.hitStop = Math.max(this.hitStop, CFG.ballistics.slowmo.hitstop);
  }

  /** celebratory firework: colored flash + spark crown + smoke */
  fireworkBurst(pos, colorHex) {
    const q = this.quality;
    this.flashes.spawn(pos, { life: 0.22, size: 3.4, grow: 1.5, opacity: 0.95, color: colorHex });
    const n = Math.round(26 * q);
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + this.rng.range(-0.1, 0.1);
      const sp = this.rng.range(7, 15);
      const d = new THREE.Vector3(Math.cos(a) * sp, this.rng.range(2, 8), Math.sin(a) * sp);
      this.sparks.spawn(pos.clone(), {
        life: this.rng.range(0.7, 1.3), size: this.rng.range(0.22, 0.4), grow: -0.25, opacity: 0.95,
        color: this.rng.chance(0.35) ? 0xfff0c0 : colorHex,
        vel: d, gravity: 11, drag: 0.7,
      });
    }
    this.smokeColumn(pos, Math.round(5 * q), 0.8, 0x5a554c);
    this.addShake(0.06);
  }

  splash(pos, force = 1) {
    this.dustPuff(pos, Math.round(10 * force * this.quality), 0.8, 0xbfd8e6);
    this.ring(pos, 1.6 * force, 0.9);
    for (let i = 0; i < Math.round(10 * force * this.quality); i++) {
      this.sparks.spawn(pos, {
        life: 0.55, size: 0.16, grow: 0.2, opacity: 0.7, color: 0xcfe8f4,
        vel: new THREE.Vector3((this.rng() - 0.5) * 4 * force, this.rng.range(3, 7) * force, (this.rng() - 0.5) * 4 * force),
        gravity: 12, drag: 0.4,
      });
    }
  }

  dustPuff(pos, n, size, color) {
    n = Math.round(n * this.quality);
    for (let i = 0; i < n; i++) {
      this.smoke.spawn(pos.clone().add(new THREE.Vector3((this.rng() - 0.5) * size, (this.rng() - 0.5) * size * 0.6, (this.rng() - 0.5) * size)), {
        life: this.rng.range(0.7, 1.7), size: size * this.rng.range(0.5, 1.1), grow: 2.4, opacity: 0.42, color,
        vel: new THREE.Vector3((this.rng() - 0.5) * 2.4, this.rng.range(0.4, 2.2), (this.rng() - 0.5) * 2.4),
        drag: 1.5, spin: (this.rng() - 0.5) * 2,
      });
    }
  }

  smokeColumn(pos, n, size, color) {
    n = Math.round(n * this.quality);
    for (let i = 0; i < n; i++) {
      this.smoke.spawn(pos.clone().add(new THREE.Vector3((this.rng() - 0.5) * size, i * 0.25, (this.rng() - 0.5) * size)), {
        life: this.rng.range(1.4, 3.0), size: size * this.rng.range(0.8, 1.8), grow: 3.2, opacity: 0.36, color,
        vel: new THREE.Vector3((this.rng() - 0.5) * 1.1, this.rng.range(1.4, 3.4), (this.rng() - 0.5) * 1.1),
        drag: 0.7, spin: (this.rng() - 0.5) * 1.2,
      });
    }
  }

  fireBurst(pos, n) {
    n = Math.round(n * this.quality);
    for (let i = 0; i < n; i++) {
      const t = this.rng();
      this.flashes.spawn(pos.clone().add(new THREE.Vector3((this.rng() - 0.5) * 1.2, this.rng() * 1.2, (this.rng() - 0.5) * 1.2)), {
        life: this.rng.range(0.35, 0.95), size: this.rng.range(0.5, 1.5), grow: 1.1, opacity: 0.85,
        color: t < 0.4 ? 0xfff0a0 : t < 0.75 ? 0xff9a30 : 0xff5a1e,
        vel: new THREE.Vector3((this.rng() - 0.5) * 3, this.rng.range(2.4, 6), (this.rng() - 0.5) * 3),
        drag: 1.6, gravity: -1.2,
      });
    }
  }

  sparkBurst(pos, n, speed) {
    n = Math.round(n * this.quality);
    for (let i = 0; i < n; i++) {
      const d = new THREE.Vector3(this.rng() - 0.5, this.rng() * 0.9 + 0.1, this.rng() - 0.5).normalize();
      this.sparks.spawn(pos.clone(), {
        life: this.rng.range(0.28, 0.75), size: this.rng.range(0.14, 0.34), grow: -0.3, opacity: 0.95,
        color: this.rng.chance(0.3) ? 0xfff0c0 : 0xffb45a,
        vel: d.multiplyScalar(speed * this.rng.range(0.4, 1.3)), gravity: 16, drag: 0.6,
      });
    }
  }

  ring(pos, radius, life) {
    if (this.rings.length > CFG.vfx.dustRingMax) { const old = this.rings.shift(); this.scene.remove(old.mesh); old.mesh.geometry.dispose(); }
    const mesh = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ color: 0xd9c9a8, transparent: true, opacity: 0.6, side: THREE.DoubleSide, depthWrite: false }));
    mesh.position.copy(pos); mesh.position.y += 0.08;
    mesh.scale.setScalar(0.4);
    this.scene.add(mesh);
    this.rings.push({ mesh, life: 0, maxLife: life, radius });
  }

  decal(pos, radius, color) {
    if (this.decals.length > 14) { const old = this.decals.shift(); this.scene.remove(old.mesh); }
    const mesh = new THREE.Mesh(this.decalGeo, this.decalMat.clone());
    mesh.material.color.setHex(color);
    mesh.position.copy(pos); mesh.position.y += 0.05;
    mesh.scale.setScalar(radius);
    mesh.rotation.z = this.rng() * 6.28;
    this.scene.add(mesh);
    this.decals.push({ mesh, life: 0, maxLife: 22 });
  }

  addFireLight(pos, radius, life) {
    const l = new THREE.PointLight(0xff7a30, 2.4, radius * 7, 2);
    l.position.copy(pos).add(new THREE.Vector3(0, 1.2, 0));
    this.scene.add(l);
    this.fireLights.push({ l, life, maxLife: life, base: 2.4 });
  }

  addShake(amount) {
    const max = CFG.camera.shakeMax * (CFG.render ? 1 : 1);
    this.shake = clamp(this.shake + amount, 0, max);
  }

  triggerSlowmo(dur = CFG.ballistics.slowmo.duration, scale = CFG.ballistics.slowmo.scale) {
    this.slowmo = Math.max(this.slowmo, dur);
    this.slowmoScale = scale;
  }

  // -------------------------------------------------------- trajectory viz ---
  showPrediction(points, impact, cepRadius, samplePoints) {
    if (!points || points.length < 2) { this.hidePrediction(); return; }
    const pos = [];
    for (let i = 0; i < points.length; i++) pos.push(points[i].x, points[i].y, points[i].z);
    this.predLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.predLine.geometry.setDrawRange(0, points.length);
    this.predLine.visible = true;

    // dots strided across the WHOLE arc so lob trajectories read end-to-end
    const vis = Math.min(this.predDots.length, CFG.ballistics.predictVisiblePoints);
    const stride = Math.max(1, Math.floor(points.length / vis));
    for (let i = 0; i < this.predDots.length; i++) {
      const idx = i * stride;
      if (idx < points.length && i < vis) {
        this.predDots[i].position.copy(points[idx]);
        this.predDots[i].visible = true;
        const k = i / vis;
        this.predDots[i].scale.setScalar(0.30 - k * 0.14);
        this.predDots[i].material.opacity = 0.95 - k * 0.55;
      } else this.predDots[i].visible = false;
    }

    if (impact) {
      const contact = impact.point || impact;
      // ground-projected spread area: where the shell CAN land (CEP disk)
      const gy = impact.groundY !== undefined ? impact.groundY : contact.y;
      const cep = clamp(cepRadius || 1.5, 0.7, 14);
      const cx = impact.cx !== undefined ? impact.cx : contact.x;
      const cz = impact.cz !== undefined ? impact.cz : contact.z;
      const cgy = impact.cgroundY !== undefined ? impact.cgroundY : gy;
      this.cepDisk.position.set(cx, cgy + 0.10, cz);
      this.cepDisk.scale.setScalar(cep);
      this.cepDisk.visible = true;
      this.cepRing.position.set(cx, cgy + 0.12, cz);
      this.cepRing.scale.setScalar(cep);
      this.cepRing.visible = true;
      // drop line from the contact point down to the ground disk
      const posAttr = this.dropLine.geometry.attributes.position;
      posAttr.setXYZ(0, contact.x, contact.y + 0.05, contact.z);
      posAttr.setXYZ(1, contact.x, gy + 0.1, contact.z);
      posAttr.needsUpdate = true;
      this.dropLine.geometry.computeBoundingSphere();
      this.dropLine.computeLineDistances();
      this.dropLine.visible = contact.y - gy > 0.6;
      // sample impact dots: the actual "where it can land" set
      for (let i = 0; i < this.cepDots.length; i++) {
        const sp = samplePoints && samplePoints[i];
        if (sp) {
          this.cepDots[i].position.set(sp.x, (sp.y || gy) + 0.25, sp.z);
          this.cepDots[i].visible = true;
        } else this.cepDots[i].visible = false;
      }
      // crosshair marker sits on the predicted contact point
      this.marker.position.copy(contact);
      this.marker.position.y += 0.12;
      this.markerScale = clamp(cep * 0.35, 0.8, 3.2);
      this.marker.visible = true;
    } else {
      this.marker.visible = false;
      this.cepDisk.visible = false;
      this.cepRing.visible = false;
      this.dropLine.visible = false;
      for (const d of this.cepDots) d.visible = false;
    }
  }

  hidePrediction() {
    this.predLine.visible = false;
    this.marker.visible = false;
    this.cepDisk.visible = false;
    this.cepRing.visible = false;
    this.dropLine.visible = false;
    for (const d of this.predDots) d.visible = false;
    for (const d of this.cepDots) d.visible = false;
  }

  showGhost(points) {
    if (!points || points.length < 2) { this.ghostLine.visible = false; return; }
    const pos = [];
    for (const p of points) pos.push(p.x, p.y, p.z);
    this.ghostLine.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.ghostLine.visible = true;
  }
  hideGhost() { this.ghostLine.visible = false; }

  markTarget(pos, radius) {
    this.targetMarker.position.copy(pos);
    this.targetMarker.position.y += 0.2;
    this.targetMarker.scale.setScalar(clamp(radius / 2.2, 0.4, 4));
    this.targetMarker.visible = true;
  }
  unmarkTarget() { this.targetMarker.visible = false; }

  // ------------------------------------------------------ floating numbers ---
  floater(worldPos, text, cls = '') {
    let f = this.floaterPool.find((x) => x.life <= 0);
    if (!f) f = this.floaterPool[0];
    f.life = 0.001; f.maxLife = CFG.vfx.hitNumberLife; f.pos.copy(worldPos); f.vy = 2.4;
    f.el.textContent = text;
    f.el.className = 'floater ' + cls;
    f.el.style.display = 'block';
  }

  _projectToScreen(v, out) {
    const p = v.clone().project(this.camera);
    out.x = (p.x * 0.5 + 0.5) * window.innerWidth;
    out.y = (-p.y * 0.5 + 0.5) * window.innerHeight;
    out.visible = p.z < 1;
    return out;
  }

  // ------------------------------------------------------------------ update ---
  update(dt, dtReal) {
    this._t += dtReal;
    this.smoke.update(dt);
    this.sparks.update(dt);
    this.flashes.update(dt);

    for (let i = this.rings.length - 1; i >= 0; i--) {
      const r = this.rings[i];
      r.life += dt;
      const k = r.life / r.maxLife;
      if (k >= 1) { this.scene.remove(r.mesh); r.mesh.geometry = this.ringGeo; this.rings.splice(i, 1); continue; }
      r.mesh.scale.setScalar(lerp(0.4, r.radius, easeOutCubic(k)));
      r.mesh.material.opacity = 0.6 * (1 - k);
    }
    for (let i = this.decals.length - 1; i >= 0; i--) {
      const d = this.decals[i];
      d.life += dt;
      if (d.life > d.maxLife) { this.scene.remove(d.mesh); d.mesh.material.dispose(); this.decals.splice(i, 1); }
      else if (d.life > d.maxLife - 4) d.mesh.material.opacity = 0.42 * ((d.maxLife - d.life) / 4);
    }
    for (let i = this.fireLights.length - 1; i >= 0; i--) {
      const f = this.fireLights[i];
      f.life -= dt;
      f.l.intensity = f.base * clamp(f.life / f.maxLife, 0, 1) * (0.75 + Math.sin(this._t * 22 + i) * 0.25);
      if (f.life <= 0) { this.scene.remove(f.l); this.fireLights.splice(i, 1); }
    }

    // marker pulse
    if (this.marker.visible) {
      const pulse = 1 + Math.sin(this._t * 5) * 0.07;
      this.marker.scale.setScalar(this.markerScale * pulse);
      this.marker.rotation.y += dt * 0.7;
    }
    if (this.cepRing.visible) {
      this.cepRing.material.opacity = 0.42 + Math.sin(this._t * 3.2) * 0.16;
    }
    if (this.targetMarker.visible) {
      this.targetMarker.rotation.z += dt * 1.1;
      this.targetMarker.material.opacity = 0.6 + Math.sin(this._t * 4) * 0.25;
    }

    // floating numbers
    const scr = { x: 0, y: 0, visible: false };
    for (const f of this.floaterPool) {
      if (f.life <= 0) { if (f.el.style.display !== 'none') f.el.style.display = 'none'; continue; }
      f.life += dtReal;
      f.pos.y += f.vy * dtReal;
      f.vy *= 0.94;
      if (f.life >= f.maxLife) { f.life = 0; f.el.style.display = 'none'; continue; }
      this._projectToScreen(f.pos, scr);
      const k = f.life / f.maxLife;
      f.el.style.transform = `translate(-50%,-50%) translate(${scr.x.toFixed(0)}px,${scr.y.toFixed(0)}px) scale(${(1.25 - k * 0.45).toFixed(2)})`;
      f.el.style.opacity = (1 - k * k).toFixed(2);
      f.el.style.display = scr.visible ? 'block' : 'none';
    }

    // shake decay
    this.shake = Math.max(0, this.shake - dtReal * CFG.camera.shakeDecay * 0.14);
    if (this.shake > 0.0005) {
      this.shakeVec.set((Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2).multiplyScalar(this.shake);
    } else this.shakeVec.set(0, 0);

    // slow-mo timer
    if (this.slowmo > 0) { this.slowmo -= dtReal; if (this.slowmo <= 0) this.slowmoScale = 1; }
    if (this.hitStop > 0) this.hitStop -= dtReal;
  }

  get timeScale() {
    if (this.hitStop > 0) return 0.04;
    if (this.slowmo > 0) return this.slowmoScale;
    return 1;
  }

  clearTransient() {
    this.smoke.clear(); this.sparks.clear(); this.flashes.clear();
    for (const r of this.rings) this.scene.remove(r.mesh);
    this.rings.length = 0;
    for (const d of this.decals) { this.scene.remove(d.mesh); d.mesh.material.dispose(); }
    this.decals.length = 0;
    for (const f of this.fireLights) this.scene.remove(f.l);
    this.fireLights.length = 0;
    this.hidePrediction(); this.hideGhost(); this.unmarkTarget();
    for (const f of this.floaterPool) { f.life = 0; f.el.style.display = 'none'; }
  }
}
