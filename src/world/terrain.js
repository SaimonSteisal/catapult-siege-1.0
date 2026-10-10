// ============================================================================
//  world/terrain.js — procedural heightmap terrain + analytical height queries
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { makeNoise2D, clamp, lerp } from '../core/utils.js';

const T = CFG.physics.terrain;

export class Terrain {
  constructor(seed = 1, biome = 'meadow') {
    this.seed = seed;
    this.biome = biome;
    this.size = T.size;
    this.segments = T.segments;
    this.n = this.segments + 1;
    this.heights = new Float32Array(this.n * this.n);
    this.noise = makeNoise2D(seed);
    this.generate();
  }

  biomeParams() {
    switch (this.biome) {
      case 'river':  return { amp: 2.4, rough: 1.6, flatRadius: 34, water: true,  tint: 0x6f8a52 };
      case 'mountain':return { amp: 9.5, rough: 3.4, flatRadius: 24, water: false, tint: 0x7d7461 };
      case 'winter': return { amp: 3.4, rough: 1.9, flatRadius: 32, water: false, tint: 0xcfd8e0 };
      case 'coast':  return { amp: 3.0, rough: 1.4, flatRadius: 30, water: true,  tint: 0x9a9463 };
      default:       return { amp: 3.2, rough: 1.8, flatRadius: 32, water: false, tint: 0x7a8a4f };
    }
  }

  generate() {
    const p = this.biomeParams();
    const n = this.n, s = this.segments;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const wx = -this.size / 2 + (i / s) * this.size;
        const wz = -this.size / 2 + (j / s) * this.size;

        // rolling hills
        let h = this.noise(wx * 0.011, wz * 0.011, 4, 0.5) * p.amp;
        h += this.noise(wx * 0.045 + 40, wz * 0.045 - 20, 3, 0.5) * p.rough;

        // flat building pads: player emplacement (origin) and fort area (+Z)
        const dPlayer = Math.hypot(wx, wz);
        const dFort = Math.hypot(wx - 0, wz - 74);
        const flatPlayer = clamp(1 - dPlayer / 18, 0, 1);
        const flatFort = clamp(1 - dFort / 40, 0, 1);
        const flat = Math.max(flatPlayer, flatFort * 0.92);
        h = lerp(h, 0, flat * flat * (3 - 2 * flat));

        // gentle bowl at the very edges so the world does not look cut off
        const edge = clamp((Math.max(Math.abs(wx), Math.abs(wz)) - this.size * 0.40) / (this.size * 0.10), 0, 1);
        h += edge * edge * 5.5;

        // river carve
        if (p.water) {
          const riverX = Math.sin(wz * 0.021) * 26 + 40;
          const d = Math.abs(wx - riverX);
          if (d < 12) h -= (1 - d / 12) * 5.2;
        }
        this.heights[j * n + i] = h;
      }
    }
  }

  /** grid vertex coords → world (integer grid points align with vertices) */
  gx(i) { return -this.size / 2 + (i / this.segments) * this.size; }

  heightAt(x, z) {
    const s = this.segments, half = this.size / 2;
    const fi = clamp((x + half) / this.size * s, 0, s);
    const fj = clamp((z + half) / this.size * s, 0, s);
    const i0 = Math.floor(fi), j0 = Math.floor(fj);
    const i1 = Math.min(i0 + 1, s), j1 = Math.min(j0 + 1, s);
    const tx = fi - i0, tz = fj - j0;
    const n = this.n;
    const h00 = this.heights[j0 * n + i0], h10 = this.heights[j0 * n + i1];
    const h01 = this.heights[j1 * n + i0], h11 = this.heights[j1 * n + i1];
    return lerp(lerp(h00, h10, tx), lerp(h01, h11, tx), tz);
  }

  normalAt(x, z, out = new THREE.Vector3()) {
    const e = this.size / this.segments * 0.6;
    const hl = this.heightAt(x - e, z), hr = this.heightAt(x + e, z);
    const hd = this.heightAt(x, z - e), hu = this.heightAt(x, z + e);
    return out.set(hl - hr, 2 * e, hd - hu).normalize();
  }

  buildMesh(materialLib) {
    const geo = new THREE.PlaneGeometry(this.size, this.size, this.segments, this.segments);
    geo.rotateX(-Math.PI / 2);
    const pos = geo.attributes.position;
    const n = this.n;
    for (let i = 0; i < pos.count; i++) {
      const ix = i % n, iz = Math.floor(i / n);
      pos.setY(i, this.heights[iz * n + ix]);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();

    // vertex colours by height + slope (biome aware)
    const p = this.biomeParams();
    const colors = new Float32Array(pos.count * 3);
    const c = new THREE.Color();
    const grass = new THREE.Color(p.tint);
    const rock = new THREE.Color(0x8b8378);
    const sand = new THREE.Color(0xb3a67c);
    const snow = new THREE.Color(0xeef3f7);
    const dirt = new THREE.Color(0x6d5a3f);
    const nrm = geo.attributes.normal;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      const slope = 1 - clamp(nrm.getY(i), 0, 1);
      c.copy(grass);
      if (this.biome === 'winter') c.lerpColors(snow, rock, clamp(slope * 2.2, 0, 1));
      else {
        c.lerpColors(c, dirt, clamp((y + 1.2) * 0.10, 0, 0.55));
        c.lerpColors(c, rock, clamp(slope * 2.4 - 0.25, 0, 1));
        if (y < CFG.physics.waterLevel + 1.2) c.lerpColors(c, sand, clamp((CFG.physics.waterLevel + 1.2 - y) * 0.5, 0, 1));
      }
      // subtle per-vertex noise so large quads are not flat-coloured
      const j = (this.noise(pos.getX(i) * 0.35, pos.getZ(i) * 0.35, 2, 0.5) * 0.5 + 0.5);
      c.multiplyScalar(0.90 + j * 0.18);
      colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

    const mat = materialLib.terrainVertex;
    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = false;
    mesh.name = 'terrain';
    return mesh;
  }

  waterMesh(materialLib) {
    const geo = new THREE.PlaneGeometry(this.size, this.size, 1, 1);
    geo.rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, materialLib.water);
    m.position.y = CFG.physics.waterLevel;
    m.name = 'water';
    return m;
  }
}
