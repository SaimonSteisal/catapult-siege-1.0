// ============================================================================
//  world/textures.js + materials.js — 100% procedural, zero external assets
// ============================================================================
import * as THREE from 'three';
import { makeNoise2D, clamp, makeRng } from '../core/utils.js';
import { CFG } from '../config.js';

const cache = new Map();

function canvas2d(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return { c, x: c.getContext('2d') };
}

function toTexture(canvas, repeat = 1, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  t.generateMipmaps = true;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.magFilter = THREE.LinearFilter;
  if (srgb && THREE.SRGBColorSpace) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

export function texWood(size = 256, seed = 7, base = '#7a5533') {
  const key = 'wood' + size + seed + base;
  if (cache.has(key)) return cache.get(key);
  const { c, x } = canvas2d(size);
  x.fillStyle = base; x.fillRect(0, 0, size, size);
  const noise = makeNoise2D(seed);
  const img = x.getImageData(0, 0, size, size);
  const d = img.data;
  for (let j = 0; j < size; j++) {
    for (let i = 0; i < size; i++) {
      const warp = noise(i * 0.02, j * 0.12, 3, 0.6) * 6;
      const grain = Math.sin((i + warp) * 0.45) * 0.5 + 0.5;
      const fine = noise(i * 0.6, j * 0.05, 2, 0.5) * 0.5 + 0.5;
      const v = 0.62 + grain * 0.24 + fine * 0.16;
      const k = (j * size + i) * 4;
      d[k] = clamp(d[k] * v, 0, 255); d[k + 1] = clamp(d[k + 1] * v, 0, 255); d[k + 2] = clamp(d[k + 2] * v, 0, 255);
    }
  }
  x.putImageData(img, 0, 0);
  // knots
  const rng = makeRng(seed);
  for (let n = 0; n < 5; n++) {
    const kx = rng.range(0, size), ky = rng.range(0, size), r = rng.range(4, 11);
    const g = x.createRadialGradient(kx, ky, 0, kx, ky, r);
    g.addColorStop(0, 'rgba(48,30,16,0.75)'); g.addColorStop(1, 'rgba(48,30,16,0)');
    x.fillStyle = g; x.beginPath(); x.arc(kx, ky, r, 0, 7); x.fill();
  }
  const t = toTexture(c, 1);
  cache.set(key, t); return t;
}

export function texStone(size = 256, seed = 21, base = '#9c968a') {
  const key = 'stone' + size + seed + base;
  if (cache.has(key)) return cache.get(key);
  const { c, x } = canvas2d(size);
  x.fillStyle = base; x.fillRect(0, 0, size, size);
  const noise = makeNoise2D(seed);
  const img = x.getImageData(0, 0, size, size);
  const d = img.data;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const v = 0.78 + noise(i * 0.09, j * 0.09, 4, 0.55) * 0.22 + noise(i * 0.7, j * 0.7, 2, 0.5) * 0.08;
    const k = (j * size + i) * 4;
    d[k] = clamp(d[k] * v, 0, 255); d[k + 1] = clamp(d[k + 1] * v, 0, 255); d[k + 2] = clamp(d[k + 2] * v, 0, 255);
  }
  x.putImageData(img, 0, 0);
  // mortar joints
  x.strokeStyle = 'rgba(40,36,30,0.42)'; x.lineWidth = 2;
  const rows = 4;
  for (let r = 0; r <= rows; r++) { const y = (r / rows) * size; x.beginPath(); x.moveTo(0, y); x.lineTo(size, y); x.stroke(); }
  const rng = makeRng(seed + 3);
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (size / 6);
    for (let q = 0; q <= 3; q++) { const xx = off + (q / 3) * size; x.beginPath(); x.moveTo(xx, (r / rows) * size); x.lineTo(xx, ((r + 1) / rows) * size); x.stroke(); }
  }
  // chips
  for (let n = 0; n < 26; n++) {
    x.fillStyle = `rgba(30,28,24,${rng.range(0.05, 0.16)})`;
    x.beginPath(); x.arc(rng.range(0, size), rng.range(0, size), rng.range(1.5, 5), 0, 7); x.fill();
  }
  const t = toTexture(c, 1);
  cache.set(key, t); return t;
}

export function texMetal(size = 128, seed = 33) {
  const key = 'metal' + size + seed;
  if (cache.has(key)) return cache.get(key);
  const { c, x } = canvas2d(size);
  x.fillStyle = '#6e7278'; x.fillRect(0, 0, size, size);
  const noise = makeNoise2D(seed);
  const img = x.getImageData(0, 0, size, size); const d = img.data;
  for (let j = 0; j < size; j++) for (let i = 0; i < size; i++) {
    const v = 0.82 + noise(i * 0.4, j * 0.06, 3, 0.5) * 0.2;
    const k = (j * size + i) * 4;
    d[k] = clamp(d[k] * v, 0, 255); d[k + 1] = clamp(d[k + 1] * v, 0, 255); d[k + 2] = clamp(d[k + 2] * v * 1.04, 0, 255);
  }
  x.putImageData(img, 0, 0);
  const rng = makeRng(seed);
  for (let n = 0; n < 8; n++) {
    x.fillStyle = 'rgba(150,120,70,0.25)';
    x.beginPath(); x.arc(rng.range(0, size), rng.range(0, size), rng.range(3, 9), 0, 7); x.fill();
  }
  const t = toTexture(c, 1); cache.set(key, t); return t;
}

export function texRope(size = 128) {
  const key = 'rope' + size;
  if (cache.has(key)) return cache.get(key);
  const { c, x } = canvas2d(size);
  x.fillStyle = '#bfa878'; x.fillRect(0, 0, size, size);
  x.strokeStyle = 'rgba(90,70,40,0.55)'; x.lineWidth = 5;
  for (let i = -size; i < size * 2; i += 14) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + size, size); x.stroke(); }
  x.strokeStyle = 'rgba(255,240,205,0.18)'; x.lineWidth = 2;
  for (let i = -size; i < size * 2; i += 14) { x.beginPath(); x.moveTo(i + 4, 0); x.lineTo(i + size + 4, size); x.stroke(); }
  const t = toTexture(c, 2); cache.set(key, t); return t;
}

export function texCrack(size = 256) {
  const key = 'crack' + size;
  if (cache.has(key)) return cache.get(key);
  const { c, x } = canvas2d(size);
  x.clearRect(0, 0, size, size);
  const rng = makeRng(1234);
  const drawBranch = (px, py, ang, len, w) => {
    if (len < 6 || w < 0.5) return;
    const ex = px + Math.cos(ang) * len, ey = py + Math.sin(ang) * len;
    x.strokeStyle = `rgba(18,14,10,${0.35 + w * 0.1})`; x.lineWidth = w; x.lineCap = 'round';
    x.beginPath(); x.moveTo(px, py); x.lineTo(ex, ey); x.stroke();
    if (rng.chance(0.62)) drawBranch(ex, ey, ang + rng.range(-0.9, 0.9), len * rng.range(0.5, 0.8), w * 0.6);
    if (rng.chance(0.35)) drawBranch(ex, ey, ang + rng.range(-1.2, 1.2), len * rng.range(0.4, 0.7), w * 0.55);
  };
  for (let i = 0; i < 4; i++) drawBranch(size / 2, size / 2, rng.range(0, 6.28), size * 0.28, 3.4);
  const t = toTexture(c, 1); cache.set(key, t); return t;
}

export function texSoftParticle(size = 64) {
  const key = 'soft' + size;
  if (cache.has(key)) return cache.get(key);
  const { c, x } = canvas2d(size);
  const g = x.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  x.fillStyle = g; x.fillRect(0, 0, size, size);
  const t = toTexture(c, 1); cache.set(key, t); return t;
}

export function texSpark(size = 32) {
  const key = 'spark' + size;
  if (cache.has(key)) return cache.get(key);
  const { c, x } = canvas2d(size);
  x.clearRect(0, 0, size, size);
  const g = x.createLinearGradient(0, size / 2, size, size / 2);
  g.addColorStop(0, 'rgba(255,220,140,0)');
  g.addColorStop(0.5, 'rgba(255,240,190,1)');
  g.addColorStop(1, 'rgba(255,180,80,0)');
  x.fillStyle = g; x.fillRect(0, size / 2 - 2, size, 4);
  const t = toTexture(c, 1); cache.set(key, t); return t;
}

// ---------------------------------------------------------------- materials ---
export function createMaterials(scene) {
  const M = {};

  M.toon = (color, opts = {}) => new THREE.MeshLambertMaterial({
    color, flatShading: true, ...opts,
  });

  M.terrainVertex = new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: false });
  M.water = new THREE.MeshLambertMaterial({ color: 0x3f6f8f, transparent: true, opacity: 0.72, flatShading: true });

  // block materials — textured lambert, per-instance colour multiplies
  M.block = {
    stone: new THREE.MeshLambertMaterial({ map: texStone(256, 21, '#9c968a'), color: 0xffffff, flatShading: false }),
    brick: new THREE.MeshLambertMaterial({ map: texStone(256, 44, '#a8705a'), color: 0xffffff }),
    wood:  new THREE.MeshLambertMaterial({ map: texWood(256, 7, '#7a5533'), color: 0xffffff }),
    metal: new THREE.MeshLambertMaterial({ map: texMetal(128, 33), color: 0xffffff }),
    rope:  new THREE.MeshLambertMaterial({ map: texRope(128), color: 0xffffff }),
    cloth: new THREE.MeshLambertMaterial({ color: 0xd8d2c0, side: THREE.DoubleSide, flatShading: true }),
    pitch: new THREE.MeshLambertMaterial({ color: 0x3b2f2a, flatShading: true }),
    gold:  new THREE.MeshLambertMaterial({ color: 0xd9a62e, flatShading: true }),
  };
  M.debris = new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true });

  // trebuchet
  M.frame = new THREE.MeshLambertMaterial({ map: texWood(256, 11, '#6b4a2c'), color: 0xffffff });
  M.frameDark = new THREE.MeshLambertMaterial({ map: texWood(256, 19, '#4a3320'), color: 0xffffff });
  M.iron = new THREE.MeshLambertMaterial({ map: texMetal(128, 5), color: 0xb9bec4 });
  M.cw = new THREE.MeshLambertMaterial({ map: texMetal(128, 9), color: 0x8a8f96, flatShading: true });
  M.sling = new THREE.MeshLambertMaterial({ map: texRope(128), color: 0xd8c79a });
  M.leather = new THREE.MeshLambertMaterial({ color: 0x6b4a30, flatShading: true });
  M.banner = new THREE.MeshLambertMaterial({ color: 0xb3372c, side: THREE.DoubleSide, flatShading: true });
  M.enemyBanner = new THREE.MeshLambertMaterial({ color: 0x3d5a80, side: THREE.DoubleSide, flatShading: true });

  // sky dome: gradient + sun disc/glow + stars + drifting fbm clouds + aurora,
  // all in ONE shader (single draw call, no geometry cost)
  M.sky = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: {
      topColor: { value: new THREE.Color(0x5b8fc4) },
      midColor: { value: new THREE.Color(0xa9c6dd) },
      botColor: { value: new THREE.Color(0xe8c9a0) },
      sunColor: { value: new THREE.Color(0xffd9a0) },
      sunDir:   { value: new THREE.Vector3(-0.6, 0.25, 0.3).normalize() },
      sunSize:  { value: 1.0 },
      starFactor: { value: 0.0 },
      cloudCover: { value: 0.22 },
      cloudColor: { value: new THREE.Color(0xf0ead8) },
      auroraFactor: { value: 0.0 },
      haze: { value: 0.3 },
      time: { value: 0 },
    },
    vertexShader: `
      varying vec3 vWorld;
      void main(){
        vec4 wp = modelMatrix * vec4(position,1.0);
        vWorld = wp.xyz;
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: `
      uniform vec3 topColor, midColor, botColor, sunColor, cloudColor;
      uniform vec3 sunDir;
      uniform float sunSize, starFactor, cloudCover, auroraFactor, haze, time;
      varying vec3 vWorld;

      float hash21(vec2 p){ p = fract(p*vec2(233.34, 851.73)); p += dot(p, p+23.45); return fract(p.x*p.y); }
      float vnoise(vec2 p){
        vec2 i = floor(p), f = fract(p);
        f = f*f*(3.0-2.0*f);
        float a = hash21(i), b = hash21(i+vec2(1,0)), c = hash21(i+vec2(0,1)), d = hash21(i+vec2(1,1));
        return mix(mix(a,b,f.x), mix(c,d,f.x), f.y);
      }
      float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<4;i++){ s += a*vnoise(p); p*=2.1; a*=0.5; } return s; }

      void main(){
        vec3 dir = normalize(vWorld - cameraPosition);
        float h = dir.y;
        vec3 col = mix(botColor, midColor, clamp(h*2.2+0.35, 0.0, 1.0));
        col = mix(col, topColor, pow(max(h,0.0), 0.72));

        // sun: crisp disc + wide glow
        float sd = max(dot(dir, normalize(sunDir)), 0.0);
        col += sunColor * pow(sd, 1800.0/sunSize) * 1.6;
        col += sunColor * pow(sd, 10.0) * 0.30 * (1.0-haze*0.5);
        col += sunColor * pow(sd, 3.0) * 0.08 * haze;

        // stars (only upward, with slow twinkle)
        if (starFactor > 0.01 && h > 0.0) {
          vec2 sp = dir.xz / (h + 0.28) * 120.0;
          vec2 cell = floor(sp);
          float st = hash21(cell);
          float tw = 0.55 + 0.45*sin(time*1.7 + st*90.0);
          float dotp = step(0.9955, st) * smoothstep(0.35, 1.0, st);
          col += vec3(0.9,0.94,1.0) * dotp * tw * starFactor * smoothstep(0.0,0.22,h);
        }

        // drifting clouds
        if (cloudCover > 0.01 && h > 0.015) {
          vec2 cp = dir.xz / (h + 0.18) * 0.55 + vec2(time*0.0075, time*0.0038);
          float n = fbm(cp);
          float c = smoothstep(1.0-cloudCover*0.9, 1.0-cloudCover*0.25, n);
          vec3 cc = mix(cloudColor, cloudColor*0.72, 0.6-c*0.3);
          cc += sunColor * pow(sd, 6.0) * 0.35;   // cloud edges catch the sun
          col = mix(col, cc, c*0.88*smoothstep(0.015,0.22,h));
        }

        // aurora curtains (night/aurora themes)
        if (auroraFactor > 0.01 && h > 0.04) {
          float x = atan(dir.z, dir.x);
          float band = fbm(vec2(x*1.7 + time*0.05, 3.1)) * fbm(vec2(x*4.3 - time*0.03, 8.7));
          float vert = smoothstep(0.10, 0.42, h) * smoothstep(0.85, 0.5, h);
          float a = pow(band, 2.2) * vert * auroraFactor;
          vec3 ac = mix(vec3(0.25,1.0,0.55), vec3(0.35,0.65,1.0), smoothstep(0.25,0.7,h));
          col += ac * a * 1.35;
        }

        gl_FragColor = vec4(col, 1.0);
        // standard three.js epilogue: applies renderer tone-mapping + sRGB when
        // drawing to screen, and stays a no-op when drawing into the
        // post-processing render targets (OutputPass does it there instead)
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });

  // far silhouette mountains (2 parallax layers)
  M.silhouette = (color, opacity) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, fog: false, side: THREE.DoubleSide });

  // particles
  M.smoke = new THREE.SpriteMaterial({ map: texSoftParticle(64), color: 0xffffff, transparent: true, opacity: 0.5, depthWrite: false, fog: true });
  M.spark = new THREE.SpriteMaterial({ map: texSpark(32), color: 0xffd9a0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
  M.flash = new THREE.SpriteMaterial({ map: texSoftParticle(64), color: 0xfff0c0, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });

  M.crackDecal = new THREE.MeshBasicMaterial({ map: texCrack(256), transparent: true, opacity: 0.55, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });

  // aim/prediction line
  M.pred = new THREE.LineBasicMaterial({ color: 0xffe6a8, transparent: true, opacity: 0.85, depthTest: true, fog: false });
  M.ghost = new THREE.LineBasicMaterial({ color: 0x88aaff, transparent: true, opacity: 0.32, depthTest: true, fog: false });
  M.dot = new THREE.SpriteMaterial({ map: texSoftParticle(32), color: 0xffe08a, transparent: true, opacity: 0.95, depthWrite: false, fog: false });
  M.impactRing = new THREE.MeshBasicMaterial({ color: 0xffd27a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false, fog: false });
  M.outline = new THREE.MeshBasicMaterial({ color: 0xffd24a, transparent: true, opacity: 0.9, side: THREE.BackSide, depthWrite: false, fog: false });

  return M;
}
