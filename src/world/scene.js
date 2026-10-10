// ============================================================================
//  world/scene.js — renderer, sky, lights, environment decoration
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, makeRng, lerp } from '../core/utils.js';
import { createMaterials } from './materials.js';

export class WorldScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: false,
      alpha: false,
      powerPreference: 'high-performance',
      stencil: false,
      depth: true,
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: false,
    });
    this.renderer.setPixelRatio(this._pixelRatio());
    this.renderer.setSize(window.innerWidth, window.innerHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace || THREE.LinearSRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.setClearColor(0x8fb4d9, 1);

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(CFG.render.fovBase, window.innerWidth / window.innerHeight, 0.35, 900);
    this.camera.position.set(0, 12, -26);

    this.M = createMaterials(this.scene);
    this.lights = this._lights();
    this.sky = this._sky();
    this.scene.background = this.sky.material;

    this.decor = new THREE.Group();
    this.decor.name = 'decor';
    this.scene.add(this.decor);

    this.qualityIndex = CFG.render.qualityStart;
    this.onResize = this.onResize.bind(this);
    window.addEventListener('resize', this.onResize);
    window.addEventListener('orientationchange', () => setTimeout(this.onResize, 200));
  }

  _pixelRatio() {
    const dpr = Math.min(window.devicePixelRatio || 1, CFG.render.maxPixelRatio);
    return dpr;
  }

  _lights() {
    const hemi = new THREE.HemisphereLight(0x8fb4d9, 0x6a5c42, 0.72);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xffd9a0, 1.18);
    sun.position.set(-52, 44, 22);
    sun.castShadow = false;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.left = -60; sun.shadow.camera.right = 60;
    sun.shadow.camera.top = 60; sun.shadow.camera.bottom = -60;
    sun.shadow.camera.near = 1; sun.shadow.camera.far = 200;
    sun.shadow.bias = -0.0016;
    this.scene.add(sun);
    // fill from the player's side so fort facings toward the camera stay readable
    const fill = new THREE.DirectionalLight(0xbccfe0, 0.5);
    fill.position.set(18, 26, -70);
    this.scene.add(fill);

    // night torches (created hidden)
    const torches = [];
    for (let i = 0; i < 4; i++) {
      const l = new THREE.PointLight(0xff9a44, 0, 26, 2);
      l.visible = false;
      this.scene.add(l);
      torches.push(l);
    }
    return { hemi, sun, fill, torches };
  }

  _sky() {
    const geo = new THREE.SphereGeometry(420, 20, 14);
    const sky = new THREE.Mesh(geo, this.M.sky);
    sky.name = 'sky';
    sky.frustumCulled = false;
    this.scene.add(sky);
    return sky;
  }

  /** Silhouette mountain layers + clouds for depth */
  buildBackdrop(rng) {
    const g = new THREE.Group();
    for (let layer = 0; layer < 2; layer++) {
      const dist = 250 + layer * 90;
      const h = 40 + layer * 34;
      const segs = 26;
      const pts = [];
      for (let i = 0; i <= segs; i++) {
        const a = (i / segs) * Math.PI * 2;
        const n = rng.range(0.35, 1.0);
        pts.push(new THREE.Vector3(Math.cos(a) * dist, n * h * (0.55 + 0.45 * Math.sin(i * 1.7 + layer)), Math.sin(a) * dist));
      }
      const shape = [];
      for (let i = 0; i < segs; i++) {
        const a = pts[i], b = pts[i + 1];
        const geo = new THREE.BufferGeometry();
        const v = new Float32Array([
          a.x, -6, a.z, b.x, -6, b.z, a.x, a.y, a.z,
          b.x, -6, b.z, b.x, b.y, b.z, a.x, a.y, a.z,
        ]);
        geo.setAttribute('position', new THREE.BufferAttribute(v, 3));
        geo.computeVertexNormals();
        shape.push(geo);
      }
      const merged = mergeGeos(shape);
      const mesh = new THREE.Mesh(merged, this.M.silhouette(layer === 0 ? 0x6a7a8a : 0x8a97a6, layer === 0 ? 0.55 : 0.34));
      mesh.frustumCulled = false;
      g.add(mesh);
      shape.forEach((x) => x.dispose());
    }
    this.decor.add(g);
    this.backdrop = g;
    return g;
  }

  /** instanced grass tufts + rocks + trees */
  buildFlora(rng, terrain, count, biome) {
    clearGroup(this.flora);
    const g = new THREE.Group();
    this.flora = g;
    this.decor.add(g);

    const nGrass = count;
    if (nGrass > 0) {
      const grassGeo = new THREE.ConeGeometry(0.16, 0.62, 4, 1, true);
      grassGeo.translate(0, 0.31, 0);
      const grassMat = new THREE.MeshLambertMaterial({ color: biome === 'winter' ? 0xd8e2e8 : 0x6d8a44, flatShading: true, side: THREE.DoubleSide });
      const inst = new THREE.InstancedMesh(grassGeo, grassMat, nGrass);
      const d = new THREE.Object3D();
      const c = new THREE.Color();
      for (let i = 0; i < nGrass; i++) {
        const x = rng.range(-105, 105), z = rng.range(-46, 118);
        if (Math.hypot(x, z) < 9) { d.position.set(0, -99, 0); d.scale.setScalar(0.001); d.updateMatrix(); inst.setMatrixAt(i, d.matrix); continue; }
        const y = terrain.heightAt(x, z);
        if (y < CFG.physics.waterLevel + 0.4) { d.position.set(0, -99, 0); d.scale.setScalar(0.001); d.updateMatrix(); inst.setMatrixAt(i, d.matrix); continue; }
        d.position.set(x, y, z);
        d.rotation.set(rng.range(-0.14, 0.14), rng.range(0, 6.28), rng.range(-0.14, 0.14));
        d.scale.setScalar(rng.range(0.6, 1.5));
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
        c.setHex(biome === 'winter' ? 0xdfe8ee : rng.chance(0.3) ? 0x8aa050 : 0x5f7d3c);
        c.multiplyScalar(rng.range(0.8, 1.15));
        inst.setColorAt(i, c);
      }
      inst.instanceMatrix.needsUpdate = true;
      if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
      inst.frustumCulled = true;
      g.add(inst);
    }

    // rocks
    const nRocks = Math.round(count * 0.11);
    if (nRocks > 0) {
      const rockGeo = new THREE.DodecahedronGeometry(0.7, 0);
      const rockMat = new THREE.MeshLambertMaterial({ color: 0x8b8378, flatShading: true });
      const inst = new THREE.InstancedMesh(rockGeo, rockMat, nRocks);
      const d = new THREE.Object3D();
      for (let i = 0; i < nRocks; i++) {
        const x = rng.range(-108, 108), z = rng.range(-48, 122);
        const y = terrain.heightAt(x, z);
        d.position.set(x, y + 0.12, z);
        d.rotation.set(rng.range(0, 6.28), rng.range(0, 6.28), rng.range(0, 6.28));
        d.scale.set(rng.range(0.4, 1.5), rng.range(0.3, 1.0), rng.range(0.4, 1.5));
        d.updateMatrix();
        inst.setMatrixAt(i, d.matrix);
      }
      inst.instanceMatrix.needsUpdate = true;
      g.add(inst);
    }

    // trees (2 LOD-ish prefabs)
    const nTrees = biome === 'winter' ? Math.round(count * 0.09) : Math.round(count * 0.07);
    for (let i = 0; i < nTrees; i++) {
      const x = rng.range(-112, 112), z = rng.range(-52, 126);
      if (Math.hypot(x, z) < 16) continue;
      if (Math.abs(x) < 26 && z > 30 && z < 120) continue;   // keep the firing lane clear
      const y = terrain.heightAt(x, z);
      if (y < CFG.physics.waterLevel + 0.6) continue;
      g.add(makeTree(rng, biome, y));
      g.children[g.children.length - 1].position.set(x, y, z);
    }
    return g;
  }

  /** player camp props behind the trebuchet: tents, carts,篝火 */
  buildCampProps(rng, terrain) {
    clearGroup(this.campProps);
    const g = new THREE.Group();
    this.campProps = g;
    this.decor.add(g);
    const M = this.M;
    const woodMat = new THREE.MeshLambertMaterial({ color: 0x6b4a2c, flatShading: true });
    const clothMat = new THREE.MeshLambertMaterial({ color: 0xc9b79a, flatShading: true, side: THREE.DoubleSide });

    for (let i = 0; i < 3; i++) {
      const x = rng.range(-16, 16), z = rng.range(-24, -12);
      const y = terrain.heightAt(x, z);
      const tent = new THREE.Group();
      const cone = new THREE.Mesh(new THREE.ConeGeometry(1.9, 2.5, 5), clothMat);
      cone.position.y = 1.25;
      tent.add(cone);
      tent.add(new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.9, 0.16), woodMat).translateY(1.4));
      tent.position.set(x, y, z);
      tent.rotation.y = rng.range(0, 6.28);
      g.add(tent);
    }
    // supply crates
    for (let i = 0; i < 6; i++) {
      const x = rng.range(-9, 9), z = rng.range(-11, -4);
      const y = terrain.heightAt(x, z);
      const c = new THREE.Mesh(new THREE.BoxGeometry(rng.range(0.7, 1.1), rng.range(0.6, 0.9), rng.range(0.7, 1.1)), woodMat);
      c.position.set(x, y + 0.4, z);
      c.rotation.y = rng.range(0, 3);
      g.add(c);
    }
    // campfire
    const fx = rng.range(-4, 4), fz = rng.range(-9, -5);
    const fy = terrain.heightAt(fx, fz);
    const fire = new THREE.Group();
    for (let i = 0; i < 6; i++) {
      const log = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.11, 1.3, 5), new THREE.MeshLambertMaterial({ color: 0x4a3320, flatShading: true }));
      log.position.set(fx, fy + 0.2, fz);
      log.rotation.set(Math.PI / 2 + rng.range(-0.4, 0.4), rng.range(0, 6.28), 0);
      fire.add(log);
    }
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.42, 1.05, 6), new THREE.MeshBasicMaterial({ color: 0xff9a3c, transparent: true, opacity: 0.85 }));
    flame.position.set(fx, fy + 0.75, fz);
    fire.add(flame);
    this.campFire = flame;
    const fl = new THREE.PointLight(0xff8a3a, 1.5, 16, 2);
    fl.position.set(fx, fy + 1.2, fz);
    fire.add(fl);
    this.campFireLight = fl;
    g.add(fire);

    // torches near the fort (used at night)
    this.lights.torches.forEach((lt, i) => {
      const a = (i / 4) * Math.PI * 2;
      lt.position.set(Math.cos(a) * 16, 4, 74 + Math.sin(a) * 12);
      lt.intensity = 2.2;
    });
    return g;
  }

  animate(t, dt) {
    if (this.campFire) {
      const s = 0.9 + Math.sin(t * 11) * 0.1 + Math.sin(t * 23.7) * 0.05;
      this.campFire.scale.set(s, s * (1 + Math.sin(t * 7) * 0.12), s);
    }
    if (this.campFireLight) this.campFireLight.intensity = 1.35 + Math.sin(t * 13) * 0.3;
    if (this.sky) { this.sky.position.copy(this.camera.position); }
  }

  setQuality(index) {
    this.qualityIndex = clamp(index, 0, CFG.render.qualitySteps.length - 1);
    const q = CFG.render.qualitySteps[this.qualityIndex];
    this.renderer.setPixelRatio(this._pixelRatio() * q.pixelRatio);
    this.renderer.shadowMap.enabled = q.shadows;
    this.lights.sun.castShadow = q.shadows;
    if (this.flora) this.flora.visible = q.grass > 0;
    if (this.backdrop) this.backdrop.children.forEach((c, i) => { c.visible = this.qualityIndex < 2 || i === 0; });
    this.onResize();
    return q;
  }
  get quality() { return CFG.render.qualitySteps[this.qualityIndex]; }

  onResize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h, false);
  }

  render() { this.renderer.render(this.scene, this.camera); }

  disposeDecor() {
    clearGroup(this.decor);
  }
}

function clearGroup(g) {
  if (!g) return;
  for (let i = g.children.length - 1; i >= 0; i--) {
    const c = g.children[i];
    c.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
    g.remove(c);
  }
}

function mergeGeos(geos) {
  let total = 0;
  for (const g of geos) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    if (g.attributes.normal) nrm.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  return out;
}

function makeTree(rng, biome, y) {
  const g = new THREE.Group();
  const trunkH = rng.range(1.7, 3.4);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.26, trunkH, 5), new THREE.MeshLambertMaterial({ color: 0x5a4028, flatShading: true }));
  trunk.position.y = trunkH / 2;
  g.add(trunk);
  const winter = biome === 'winter';
  const leafCol = winter ? 0x3f5a4a : rng.chance(0.4) ? 0x4f7038 : 0x5f8442;
  const layers = rng.int(2, 3);
  for (let i = 0; i < layers; i++) {
    const r = (1.5 - i * 0.34) * rng.range(0.85, 1.15);
    const cone = new THREE.Mesh(new THREE.ConeGeometry(r, 1.7, 6), new THREE.MeshLambertMaterial({ color: leafCol, flatShading: true }));
    cone.position.y = trunkH + i * 0.95 + 0.4;
    g.add(cone);
  }
  if (winter) {
    const snow = new THREE.Mesh(new THREE.ConeGeometry(1.05, 0.5, 6), new THREE.MeshLambertMaterial({ color: 0xeaf2f7, flatShading: true }));
    snow.position.y = trunkH + 1.6;
    g.add(snow);
  }
  g.rotation.y = rng.range(0, 6.28);
  const s = rng.range(0.8, 1.5);
  g.scale.setScalar(s);
  return g;
}
