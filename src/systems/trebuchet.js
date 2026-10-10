// ============================================================================
//  systems/trebuchet.js — the machine, rebuilt to the reference mechanism:
//
//   • cocked:   LONG arm down-BACK (tip near the ground channel behind the
//               frame), counterweight raised HIGH over the TARGET side;
//   • swing:    lever angle follows a QUADRATIC ease (θ = θc + (θr−θc)·t²),
//               imitating the counterweight fall;
//   • sling:    purely visual lag curve ψ(t) = ψr + (ψc−ψr)·(1−t³); the pouch
//               slides along the ground channel (y clamped) then whips over
//               the top; the shell spawns at the pouch at t = 1;
//   • counterweight hanger always hangs "down" in beam space (rigid strut,
//               like the reference photo);
//   • gameplay launch direction/speed stay aim-driven (hybrid animation +
//               ballistics, exactly as the reference recommends), but the
//               spawn point is the analytic pouch position, so the predictive
//               arc and the real shell share one origin.
//
//  Local convention: THROW direction = −X (mapped to world +Z by baseRotY).
//  The long arm lives on +X (the BACK side), the counterweight on −X.
// ============================================================================
import * as THREE from 'three';
import { CFG } from '../config.js';
import { clamp, lerp, easeInOut, easeOutCubic, damp, DEG } from '../core/utils.js';

const TB = CFG.trebuchet;
const UP = new THREE.Vector3(0, 1, 0);

// mechanism angles (local degrees)
const THETA_COCK = -30 * DEG;     // long arm down-back, tip near the ground channel
const THETA_RELEASE = 40 * DEG;   // long arm up-back, pouch whipping over the top
const BETA_END = 135 * DEG;       // whip end: pouch wrapped over the top, forward of tip
const BEND = 45 * DEG;            // bent beam: counterweight arm angled up-forward

function box(w, h, d, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  return m;
}
function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  return m;
}
function sph(r, mat, x = 0, y = 0, z = 0, seg = 8) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, seg, Math.max(4, seg >> 1)), mat);
  m.position.set(x, y, z);
  return m;
}

/** Stylised low-poly crewman with simple procedural animation pivots. */
function makeCrewman(M, palette) {
  const g = new THREE.Group();
  const bodyMat = new THREE.MeshLambertMaterial({ color: palette.tunic, flatShading: true });
  const skinMat = new THREE.MeshLambertMaterial({ color: palette.skin, flatShading: true });
  const beltMat = new THREE.MeshLambertMaterial({ color: palette.belt, flatShading: true });
  g.add(box(0.46, 0.62, 0.3, bodyMat, 0, 1.05, 0));
  g.add(box(0.5, 0.1, 0.33, beltMat, 0, 0.76, 0));
  g.add(sph(0.185, skinMat, 0, 1.55, 0, 10));
  const helm = new THREE.Mesh(new THREE.ConeGeometry(0.21, 0.24, 8), new THREE.MeshLambertMaterial({ color: palette.helm, flatShading: true }));
  helm.position.set(0, 1.71, 0);
  g.add(helm);
  const legL = box(0.16, 0.72, 0.18, beltMat); legL.geometry.translate(0, 0.36, 0); legL.position.set(-0.12, 0, 0);
  const legR = box(0.16, 0.72, 0.18, beltMat); legR.geometry.translate(0, 0.36, 0); legR.position.set(0.12, 0, 0);
  g.add(legL, legR);
  const armL = new THREE.Group(); armL.position.set(-0.28, 1.3, 0);
  armL.add(box(0.13, 0.56, 0.14, bodyMat, 0, -0.28, 0));
  const armR = new THREE.Group(); armR.position.set(0.28, 1.3, 0);
  armR.add(box(0.13, 0.56, 0.14, bodyMat, 0, -0.28, 0));
  g.add(armL, armR);
  let tool = null;
  if (palette.tool === 'hammer') {
    tool = new THREE.Group();
    tool.add(cyl(0.03, 0.03, 0.5, beltMat, 0, -0.2, 0));
    tool.add(box(0.2, 0.13, 0.13, new THREE.MeshLambertMaterial({ color: 0x8a8f96, flatShading: true }), 0, -0.44, 0));
    armR.add(tool);
  } else if (palette.tool === 'ramrod') {
    tool = cyl(0.028, 0.028, 1.1, beltMat, 0, -0.3, 0);
    armR.add(tool);
  } else if (palette.tool === 'flag') {
    tool = new THREE.Group();
    tool.add(cyl(0.025, 0.025, 1.3, beltMat, 0, -0.2, 0));
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.4), M.banner);
    cloth.position.set(0.32, -0.62, 0);
    tool.add(cloth);
    armR.add(tool);
  } else if (palette.tool === 'sight') {
    tool = box(0.06, 0.5, 0.06, new THREE.MeshLambertMaterial({ color: 0xb08a4a, flatShading: true }), 0, -0.3, 0);
    armR.add(tool);
  }
  g.userData = { torso: g.children[0], head: g.children[2], helm, armL, armR, legL, legR, tool, phase: Math.random() * 6.28 };
  return g;
}

export class Trebuchet {
  constructor(scene, M, terrain) {
    this.scene = scene;
    this.M = M;
    this.terrain = terrain;
    this.root = new THREE.Group();
    this.root.name = 'trebuchet';
    scene.add(this.root);

    this.aim = { az: 0, el: 45, power: 0.7 };
    this.applied = { az: 0, el: 45, power: 0.7 };
    this.phase = 'IDLE';
    this.phaseT = 0;
    this.theta = THETA_COCK;
    this.busy = false;
    this.onEvent = null;
    this.basePos = new THREE.Vector3();
    this.baseRotY = 0;
    this.pouchWorld = new THREE.Vector3();
    this.pivotWorld = new THREE.Vector3();
    this.loadedAmmo = 'stone';
    this.projectileReleased = false;

    this.nodes = {};
    for (const n of TB.nodes) this.nodes[n] = { id: n, hp: TB.nodeHp[n], max: TB.nodeHp[n], mats: [], baseColors: [] };

    this._build();
    this.setAim(0, 45, 0.7);
    this.update(0, 0);
  }

  // ------------------------------------------------------------------- build ---
  _build() {
    const M = this.M;
    const root = this.root;
    const L = TB.beamLength, S = TB.beamShortArm;

    // ---- base skids + ground channel BEHIND the frame (the pouch runway)
    const skidL = box(L + 4.6, 0.42, 0.55, M.frameDark.clone(), 1.1, 0.22, -1.45);
    const skidR = skidL.clone(); skidR.position.z = 1.45;
    root.add(skidL, skidR);
    root.add(box(L + 3.4, 0.3, 0.4, M.frameDark.clone(), 1.1, 0.42, 0));
    for (let i = -2; i <= 3; i++) root.add(box(0.34, 0.24, 3.2, M.frameDark.clone(), i * 1.7, 0.32, 0));
    this._register('guide', [skidL, skidR]);

    // launch channel: trough + rails behind the machine, under the cocked tip
    this.channel = new THREE.Group();
    const chX = 10.0;
    this.channel.add(box(5.0, 0.18, 0.8, M.frameDark.clone(), chX, 0.22, 0));
    this.channel.add(box(5.0, 0.26, 0.13, M.frameDark.clone(), chX, 0.36, 0.44));
    this.channel.add(box(5.0, 0.26, 0.13, M.frameDark.clone(), chX, 0.36, -0.44));
    for (const lx of [chX - 2.0, chX + 2.0]) this.channel.add(box(0.22, 0.5, 0.9, M.frameDark.clone(), lx, 0.05, 0));
    root.add(this.channel);

    // ---- A-frames
    const frameMeshes = [];
    for (const s of [-1, 1]) {
      const z = s * 1.45;
      const legA = box(0.36, 4.7, 0.36, M.frame.clone(), -1.15, 2.35, z); legA.rotation.z = -0.30;
      const legB = box(0.36, 4.7, 0.36, M.frame.clone(), 1.15, 2.35, z); legB.rotation.z = 0.30;
      const brace = box(2.5, 0.26, 0.26, M.frame.clone(), 0, 1.9, z);
      const cap = box(0.9, 0.3, 0.4, M.frame.clone(), 0, TB.pivotHeight - 0.12, z);
      root.add(legA, legB, brace, cap);
      frameMeshes.push(legA, legB, brace, cap);
    }
    for (let i = -1; i <= 1; i += 2) root.add(box(0.22, 0.22, 3.0, M.frame.clone(), i * 1.9, 1.5, 0));
    this._register('frame', frameMeshes);

    // ---- axle
    const axle = cyl(0.17, 0.17, 3.3, M.iron.clone(), 0, TB.pivotHeight, 0);
    axle.rotation.x = Math.PI / 2;
    root.add(axle);
    this._register('pivot', [axle]);

    // ---- beam (lever): long arm on +X (back), bent short arm on -X (target side)
    this.beamPivot = new THREE.Group();
    this.beamPivot.position.set(0, TB.pivotHeight, 0);
    root.add(this.beamPivot);
    this.beam = new THREE.Group();
    this.beamPivot.add(this.beam);

    const beamLong = box(L, 0.46, 0.52, M.frame.clone(), L / 2, 0, 0);
    const beamTip = box(0.9, 0.26, 0.32, M.frame.clone(), L - 0.45, 0, 0);
    const beamShort = box(S * 1.55, 0.44, 0.48, M.frameDark.clone(),
      -Math.cos(BEND) * S * 0.72, Math.sin(BEND) * S * 0.72, 0);
    beamShort.rotation.z = -BEND;
    for (let i = 0; i < 5; i++) this.beam.add(box(0.16, 0.5, 0.56, M.iron.clone(), i * (L / 5) + 0.6, 0, 0));
    this.beam.add(beamLong, beamTip, beamShort);
    this._register('beam', [beamLong, beamTip, beamShort]);

    // ---- counterweight on the bent short arm (hangs "down" in beam space)
    this.cwHanger = new THREE.Group();
    this.cwHanger.position.set(-Math.cos(BEND) * S * 1.42, Math.sin(BEND) * S * 1.42, 0);
    this.cwHanger.rotation.z = -BEND;
    this.beam.add(this.cwHanger);
    const ropeL = cyl(0.045, 0.045, 1.05, M.sling.clone(), -0.34, -0.55, 0.55);
    const ropeR = ropeL.clone(); ropeR.position.z = -0.55;
    const cwBox = box(1.95, 1.55, 1.7, M.cw.clone(), 0, -1.7, 0);
    const cwBand1 = box(2.05, 0.16, 1.8, M.iron.clone(), 0, -1.35, 0);
    const cwBand2 = cwBand1.clone(); cwBand2.position.y = -2.05;
    this.cwHanger.add(ropeL, ropeR, cwBox, cwBand1, cwBand2);
    this._register('counterweight', [cwBox, cwBand1, cwBand2]);

    // ---- sling: a hierarchy, exactly as in the reference snippet:
    //      beam -> slingPivot (at the lever tip) -> ropes + pouch + stone anchor.
    //      Three.js multiplies the matrices, so the rope ROOT can never detach
    //      from the lever tip and the stone always hangs on the rope END.
    this.slingAnchor = new THREE.Object3D();
    this.slingAnchor.position.set(L, 0, 0);
    this.beam.add(this.slingAnchor);
    this.slingPivot = new THREE.Object3D();
    this.slingAnchor.add(this.slingPivot);
    const ropeGeo = () => { const g = new THREE.CylinderGeometry(0.06, 0.05, TB.slingLength, 6); g.translate(0, -TB.slingLength / 2, 0); return g; };  // pivot at the TOP end
    this.rope1 = new THREE.Mesh(ropeGeo(), M.sling.clone());
    this.rope2 = new THREE.Mesh(ropeGeo(), M.sling.clone());
    this.rope1.position.z = 0.11; this.rope2.position.z = -0.11;
    this.pouch = box(0.85, 0.2, 0.75, M.leather.clone());
    this.pouch.position.set(0, -TB.slingLength, 0);      // stone hangs on the END
    this.slingPivot.add(this.rope1, this.rope2, this.pouch);
    this._register('sling', [this.rope1, this.rope2, this.pouch]);

    // ---- projectile (rides the pouch until release)
    this.projectileMesh = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.42, 1),
      new THREE.MeshLambertMaterial({ color: 0x9c968a, flatShading: true })
    );
    this.projectileMesh.visible = false;
    root.add(this.projectileMesh);

    // ---- the rock lying in the ground channel while cocked.
    //      It swaps with the projectile the instant the load phase starts,
    //      so there is never a double stone and never an empty cradle.
    this.channelStone = new THREE.Mesh(
      new THREE.DodecahedronGeometry(0.42, 1),
      new THREE.MeshLambertMaterial({ color: 0x9c968a, flatShading: true })
    );
    root.add(this.channelStone);

    // ---- trigger pin + winch (winch sits at the BACK, where the cocking rope runs)
    this.trigger = box(0.18, 0.7, 0.18, M.iron.clone(), 0.4, TB.pivotHeight - 0.9, 1.6);
    root.add(this.trigger);
    this.winch = new THREE.Group();
    this.winch.position.set(2.6, 0.85, 1.5);
    this.winch.add(cyl(0.2, 0.2, 1.5, M.frameDark.clone()).rotateX(Math.PI / 2));
    this.winchHandle = box(0.7, 0.09, 0.09, M.iron.clone(), 0.4, 0, 0.85);
    this.winch.add(this.winchHandle);
    root.add(this.winch);
    this.cockRope = cyl(0.03, 0.03, 1, M.sling.clone(), 2.6, 2.2, 0);
    root.add(this.cockRope);

    // ---- gunner's sight at the FRONT (target side)
    this.sight = new THREE.Group();
    this.sight.position.set(-1.6, 1.35, 1.65);
    this.sight.add(box(0.14, 1.0, 0.14, M.frame.clone(), 0, 0.5, 0));
    this.sightArm = box(0.08, 0.08, 0.7, M.iron.clone(), 0, 1.0, 0.2);
    this.sight.add(this.sightArm);
    root.add(this.sight);

    // ---- ammo pile at the back, near the channel
    this.trough = new THREE.Group();
    this.trough.position.set(11.8, 0, -2.4);
    this.trough.add(box(2.2, 0.3, 1.5, M.frameDark.clone(), 0, 0.35, 0));
    for (let i = 0; i < 5; i++) {
      const st = new THREE.Mesh(new THREE.DodecahedronGeometry(0.26 + Math.random() * 0.1, 0),
        new THREE.MeshLambertMaterial({ color: 0x8f8a80, flatShading: true }));
      st.position.set((Math.random() - 0.5) * 1.5, 0.6 + Math.random() * 0.25, (Math.random() - 0.5) * 0.9);
      st.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3);
      this.trough.add(st);
    }
    root.add(this.trough);

    // ---- player banner at the BACK-LEFT (so it never blocks the throwing side)
    const pole = cyl(0.06, 0.06, 3.4, M.frameDark.clone(), 3.4, 1.7, 2.2);
    root.add(pole);
    this.flag = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 0.8, 4, 2), M.banner);
    this.flag.position.set(4.05, 3.0, 2.2);
    root.add(this.flag);

    // ---- crew homes: loader at the back channel, gunner at the front sight
    this.crewGroup = new THREE.Group();
    root.add(this.crewGroup);
    this.crewMeshes = {};
    const palettes = {
      gunner:   { tunic: 0x5c7a4a, skin: 0xd8a882, belt: 0x4a3524, helm: 0x9aa0a6, tool: 'sight' },
      loader:   { tunic: 0x8a6a3a, skin: 0xc9976f, belt: 0x3f2d1e, helm: 0x7a6a52, tool: 'ramrod' },
      engineer: { tunic: 0x4a5f7a, skin: 0xd8a882, belt: 0x33383f, helm: 0xb08a4a, tool: 'hammer' },
      commander:{ tunic: 0x8f3a34, skin: 0xc9976f, belt: 0x2f2620, helm: 0xd9a62e, tool: 'flag' },
    };
    const homePos = {
      gunner:    { p: [-2.2, 0, 2.3], r: 2.6 },
      loader:    { p: [9.6, 0, -2.2], r: -0.6 },
      engineer:  { p: [1.9, 0, 2.5], r: -0.9 },
      commander: { p: [-3.0, 0, -2.3], r: 0.7 },
    };
    for (const role of Object.keys(palettes)) {
      const c = makeCrewman(M, palettes[role]);
      const hp = homePos[role];
      c.position.set(hp.p[0], hp.p[1], hp.p[2]);
      c.rotation.y = hp.r;
      c.userData.home = { pos: c.position.clone(), rot: hp.r };
      c.userData.role = role;
      c.visible = false;
      this.crewGroup.add(c);
      this.crewMeshes[role] = c;
    }

    this.smokeAnchor = new THREE.Object3D();
    this.smokeAnchor.position.set(0, 2.4, 0);
    root.add(this.smokeAnchor);

    this._syncNodesVisual();
    this.theta = THETA_COCK;
  }

  _register(nodeId, meshes) {
    const node = this.nodes[nodeId];
    for (const m of meshes) { node.mats.push(m.material); node.baseColors.push(m.material.color.clone()); }
  }

  // -------------------------------------------------------------- placement ---
  place(x, z, rotY = 0) {
    const y = this.terrain ? this.terrain.heightAt(x, z) : 0;
    this.root.position.set(x, y, z);
    this.root.rotation.y = rotY;
    this.basePos = this.root.position.clone();
    this.baseRotY = rotY;
    // the ground channel sits BEHIND the machine, where the terrain may be
    // higher/lower than under the pivot — lift it onto the local ground so the
    // pouch, ropes and channel never sink "under the textures"
    this.channelLift = 0;
    if (this.terrain) {
      const back = new THREE.Vector3(10.0, 0, 0).applyAxisAngle(UP, rotY);
      const gBack = this.terrain.heightAt(x + back.x, z + back.z);
      this.channelLift = Math.max(0, gBack - y);
    }
    if (this.channel) this.channel.position.y = this.channelLift;
    if (this.trough) this.trough.position.y = this.channelLift;
    if (this.channelStone) {
      const rest = this.pouchLocal(0, new THREE.Vector3(), new THREE.Vector3());
      this.channelStone.position.set(rest.x, rest.y + 0.20, 0);
      this.channelStone.visible = this.phase === 'IDLE' && !!this.loadedAmmo;
    }
    for (const role in this.crewMeshes) {
      const c = this.crewMeshes[role];
      const wp = c.userData.home.pos;
      const gy = (this.terrain ? this.terrain.heightAt(x + wp.x, z + wp.z) : 0) - y;
      c.position.y = gy;
    }
  }

  // ------------------------------------------------------------------- state ---
  get condition() {
    let hp = 0, max = 0;
    for (const n of TB.nodes) { hp += this.nodes[n].hp; max += this.nodes[n].max; }
    return hp / max;
  }
  wear() { return 1 - this.condition; }
  nodeRatio(id) { const n = this.nodes[id]; return clamp(n.hp / n.max, 0, 1); }
  damageNode(id, amount) {
    const n = this.nodes[id]; if (!n) return 0;
    const before = n.hp; n.hp = clamp(n.hp - amount, 0, n.max);
    this._syncNodesVisual(); return before - n.hp;
  }
  repairNode(id, amount) {
    const n = this.nodes[id]; if (!n) return 0;
    const before = n.hp; n.hp = clamp(n.hp + amount, 0, n.max);
    this._syncNodesVisual(); return n.hp - before;
  }
  worstNode() {
    let worst = null, r = 2;
    for (const id of TB.nodes) { const q = this.nodeRatio(id); if (q < r) { r = q; worst = id; } }
    return worst;
  }
  _syncNodesVisual() {
    for (const id of TB.nodes) {
      const n = this.nodes[id];
      const r = clamp(n.hp / n.max, 0, 1);
      for (let i = 0; i < n.mats.length; i++) {
        n.mats[i].color.copy(n.baseColors[i]).multiplyScalar(0.45 + r * 0.55);
        if (r < 0.35) n.mats[i].color.lerp(new THREE.Color(0x2a1a12), (0.35 - r) * 1.4);
      }
    }
  }

  setModifiers(mods) { this.mods = mods; }
  getMods() { return this.mods || { power: 1, spread: 1, wear: 1, cockTime: 1, damage: 1, fatigue: 1 }; }

  launchSpeed(power) {
    const mods = this.getMods();
    let eff = 1;
    for (const id of TB.nodes) {
      const dmg = 1 - this.nodeRatio(id);
      const e = TB.effects[id];
      if (e.power) eff += e.power * dmg;
    }
    eff *= mods.power || 1;
    const p = clamp(power, CFG.ballistics.powerMin, CFG.ballistics.powerMax);
    const v = CFG.ballistics.v0Base * (0.55 + p * 0.78) * Math.sqrt(eff > 0 ? eff : 0.05);
    return clamp(v, 6, CFG.ballistics.v0Max * 1.25);
  }

  spreadDeg(uncertainty = 0, ammoSpreadMul = 1, crewSkill = 1, fatigueMul = 1) {
    const mods = this.getMods();
    let s = CFG.ballistics.baseSpreadDeg * ammoSpreadMul * (mods.spread || 1);
    for (const id of TB.nodes) {
      const dmg = 1 - this.nodeRatio(id);
      const e = TB.effects[id];
      if (e.spread) s += e.spread * dmg;
    }
    s += CFG.ballistics.spreadFromWear * this.wear() * 0.35;
    s += CFG.ballistics.spreadFromWindUnc * uncertainty;
    s *= crewSkill * fatigueMul;
    return clamp(s, 0.15, 14);
  }

  applyShotWear(power, mul = 1) {
    const mods = this.getMods();
    const base = (TB.wearPerShotBase + TB.wearPowerScale * power) * mul * (mods.wear || 1);
    const report = {};
    for (const id of TB.nodes) {
      const n = this.nodes[id];
      const factor = id === 'sling' ? 1.15 : id === 'pivot' ? 1.0 : id === 'counterweight' ? 0.6 : id === 'guide' ? 0.8 : 1.0;
      report[id] = this.damageNode(id, base * factor * n.max / 100);
    }
    this._syncNodesVisual();
    return report;
  }

  // ------------------------------------------------------------------ aiming ---
  setAim(az, el, power) {
    this.aim.az = clamp(az, CFG.ballistics.azimuthMin, CFG.ballistics.azimuthMax);
    this.aim.el = clamp(el, CFG.ballistics.elevationMin, CFG.ballistics.elevationMax);
    this.aim.power = clamp(power, CFG.ballistics.powerMin, CFG.ballistics.powerMax);
  }
  nudgeAim(dAz, dEl) { this.setAim(this.aim.az + dAz, this.aim.el + dEl, this.aim.power); }

  launchDir(out) {
    const el = this.aim.el * DEG;
    const azWorld = this.baseRotY + this.aim.az * DEG;
    return out.set(-Math.cos(el), Math.sin(el), 0).applyAxisAngle(UP, azWorld).normalize();
  }
  muzzle(outPos, outDir) {
    this.launchDir(outDir);
    if (this.pouchWorld) outPos.copy(this.pouchWorld).addScaledVector(outDir, 0.35);
    else this.predictOrigin(outPos);
    return outPos;
  }

  // ------------------------------------------------------- mechanism maths ---
  /** lever angle at normalised swing time t (quadratic ease = falling weight) */
  swingTheta(t) { return THETA_COCK + (THETA_RELEASE - THETA_COCK) * (t * t); }
  /**
   * Pouch path, two phases (mirror-correct per the reference plots):
   *  1) DRAG:  the stone lies in the channel BEYOND the lever tip and is dragged
   *            along the ground on the circle around the rising tip
   *            (pouch = tip + (sqrt(Ls²−dy²), −dy)) — the rope never crosses the lever;
   *  2) WHIP:  once the tip outruns the sling length, the pouch wraps over the top:
   *            offset angle β sweeps −90° → BETA_END with a cubic ease, so at release
   *            the pouch is above/ahead of the tip and the shell leaves over the machine.
   */
  swingBeta(dy) {
    const SL = TB.slingLength;
    const dyMax = TB.pivotHeight + Math.sin(THETA_RELEASE) * TB.beamLength - 0.45;
    const u = clamp((dy - SL) / Math.max(0.001, dyMax - SL), 0, 1);
    return -Math.PI / 2 + (BETA_END + Math.PI / 2) * (u * u * u);
  }

  /** tip of the long arm in LOCAL coords for a lever angle */
  tipLocal(theta, out) { return out.set(Math.cos(theta) * TB.beamLength, TB.pivotHeight + Math.sin(theta) * TB.beamLength, 0); }

  /** pouch (projectile) position in LOCAL coords for swing parameter t */
  pouchLocal(t, out, tipOut) {
    const SL = TB.slingLength;
    const gy = 0.45 + (this.channelLift || 0);
    const theta = this.swingTheta(t);
    const tip = this.tipLocal(theta, tipOut || new THREE.Vector3());
    const dy = tip.y - gy;
    if (dy < SL) {
      // phase 1: stone on the ground BEYOND the tip, rope taut on the ground circle
      const ox = Math.sqrt(Math.max(0, SL * SL - dy * dy));
      return out.set(tip.x + ox, gy, 0);
    }
    // phase 2: whip over the top
    const beta = this.swingBeta(dy);
    return out.set(tip.x + Math.cos(beta) * SL, tip.y + Math.sin(beta) * SL, 0);
  }

  /** analytic pouch position at the release instant (t = 1) — the muzzle */
  releaseState() {
    const tip = new THREE.Vector3();
    const pouch = this.pouchLocal(1, new THREE.Vector3(), tip);
    return { pouchLocal: pouch, tipLocal: tip };
  }

  predictOrigin(out) {
    const azWorld = this.baseRotY + this.aim.az * DEG;
    const rs = this.releaseState();
    const v = new THREE.Vector3(rs.pouchLocal.x, rs.pouchLocal.y, 0).applyAxisAngle(UP, azWorld);
    return out.copy(this.root.position).add(v);
  }

  // -------------------------------------------------------------------- fire ---
  fire(ammoId, opt = {}) {
    if (this.busy) return false;
    this.busy = true;
    this.firingAmmo = ammoId;
    this.phase = 'LOAD';
    this.phaseT = 0;
    this.fired = false;
    this.powerShot = opt.power === undefined ? this.aim.power : opt.power;
    this._setPhaseTarget();
    this.emit('phase', { phase: 'LOAD' });
    return true;
  }
  emit(name, data) { if (this.onEvent) this.onEvent(name, data); }
  _setPhaseTarget() { this.phaseTarget = TB.phases[this.phase.toLowerCase()] || 0.4; }
  _nextPhase(next) { this.phase = next; this.phaseT = 0; this._setPhaseTarget(); this.emit('phase', { phase: next }); }
  cancelFire() {
    if (!this.busy) return;
    this.busy = false; this.phase = 'IDLE'; this.phaseT = 0;
    this.emit('phase', { phase: 'IDLE' });
  }

  update(dt, tSec) {
    const mods = this.getMods();
    this.applied.az = damp(this.applied.az, this.aim.az, 14, dt);
    this.applied.el = damp(this.applied.el, this.aim.el, 12, dt);
    this.applied.power = damp(this.applied.power, this.aim.power, 8, dt);
    this.root.rotation.y = this.baseRotY + this.applied.az * DEG;

    this.phaseT += dt;
    const fast = CFG.dev.instantCock ? 0.12 : 1;
    const P = {};
    for (const k in TB.phases) P[k] = TB.phases[k] * fast;

    switch (this.phase) {
      case 'IDLE':
        this.theta = damp(this.theta, THETA_COCK, 6, dt);
        break;
      case 'LOAD':
        if (this.phaseT >= P.load) this._nextPhase('COCK');
        break;
      case 'COCK': {
        const k = clamp(this.phaseT / P.cock, 0, 1);
        this.theta = THETA_COCK;      // already cocked (aiming state); winch spins
        if (k >= 1) this._nextPhase('AIM');
        break;
      }
      case 'AIM': {
        const k = clamp(this.phaseT / P.aim, 0, 1);
        this.theta = THETA_COCK - 0.02 * k;   // tiny preload tremble
        if (k >= 1) this._nextPhase('RELEASE');
        break;
      }
      case 'RELEASE':
        this._nextPhase('SWING');
        break;
      case 'SWING': {
        const k = clamp(this.phaseT / P.swing, 0, 1);
        this.theta = this.swingTheta(k);
        if (k >= 0.98 && !this.fired) {
          this.fired = true;
          const pw = this.powerShot === undefined ? this.aim.power : this.powerShot;
          this.emit('release', { ammoId: this.firingAmmo || 'stone', v0: this.launchSpeed(pw), power: pw, theta: this.theta });
        }
        if (k >= 1) this._nextPhase('RECOVER');
        break;
      }
      case 'RECOVER': {
        const k = clamp(this.phaseT / P.recover, 0, 1);
        this.theta = lerp(THETA_RELEASE, THETA_COCK, easeInOut(k));
        if (k >= 1) { this.busy = false; this.phase = 'IDLE'; this.emit('phase', { phase: 'IDLE' }); }
        break;
      }
    }

    this.beamPivot.rotation.z = this.theta;
    // hinged counterweight: the box always hangs straight down in world space
    if (this.cwHanger) this.cwHanger.rotation.z = -this.theta;

    // recoil squat
    const squat = this.phase === 'SWING' ? Math.sin(clamp(this.phaseT / TB.phases.swing, 0, 1) * Math.PI) * 0.16 * this.powerShot : 0;
    this.root.position.y = this.basePos.y - squat;

    this._updateSling();
    this.sight.rotation.z = -(this.applied.el - 45) * DEG * 0.9;
    this.sightArm.rotation.x = this.applied.az * DEG * 0.5;
    if (this.phase === 'COCK') this.winchHandle.rotation.z -= dt * 9;

    // flag wave
    const fpos = this.flag.geometry.attributes.position;
    for (let i = 0; i < fpos.count; i++) {
      const x = fpos.getX(i);
      fpos.setZ(i, Math.sin(x * 3.4 + tSec * 3.1) * 0.09 * (x + 0.62));
    }
    fpos.needsUpdate = true;
    this.flag.geometry.computeVertexNormals();

    this._updateCrew(dt, tSec);
  }

  _updateSling() {
    // Two-bone IK in LOCAL space of the machine:
    //   bone 1 = lever (theta), bone 2 = sling (psi).
    //   rope ROOT  = the lever tip anchor,
    //   rope END   = the pouch; the stone hangs on the end and pulls it down
    //   into the channel while cocked.
    let t = 0;
    if (this.phase === 'SWING') t = clamp(this.phaseT / TB.phases.swing, 0, 1);
    else if (this.phase === 'RECOVER') t = 1 - easeInOut(clamp(this.phaseT / TB.phases.recover, 0, 1));

    const tipL = this.tipLocal(this.theta, this._tipL || (this._tipL = new THREE.Vector3()));
    const pouchL = this.pouchLocal(t, this._pouchL || (this._pouchL = new THREE.Vector3()), tipL);

    // sling angle in beam space: pouch = tip + SL·(sin α, −cos α); φ = α − θ
    const ax = (pouchL.x - tipL.x) / TB.slingLength;
    const ay = -(pouchL.y - tipL.y) / TB.slingLength;
    const alpha = Math.atan2(ax, ay);
    this.slingPivot.rotation.z = alpha - this.theta;

    // the fired shell rides the pouch from LOAD until release
    if (!this.projectileReleased && this.projectileMesh.visible) {
      this.projectileMesh.position.copy(pouchL).add(this._shellOff || (this._shellOff = new THREE.Vector3(0, 0.24, 0)));
      this.projectileMesh.rotation.set(0, 0, 0);
    }

    // world position of the pouch (for muzzle flash / spawn fallback)
    this.pouchWorld = this.pouchWorld || new THREE.Vector3();
    this.pouchWorld.copy(pouchL).applyAxisAngle(UP, this.root.rotation.y).add(this.root.position);
    this.pivotWorld = this.pivotWorld || new THREE.Vector3();
    this.pivotWorld.copy(tipL).applyAxisAngle(UP, this.root.rotation.y).add(this.root.position);

    // phase-change bookkeeping: cradle rock <-> projectile swap
    if (this._prevPhase !== this.phase) {
      if (this.phase === 'LOAD') {
        this.channelStone.visible = false;          // the cradle rock BECOMES the shot
        this.projectileMesh.visible = !!this.loadedAmmo;
      } else if (this.phase === 'IDLE') {
        this.projectileMesh.visible = false;
        this.channelStone.visible = !!this.loadedAmmo;   // loader puts a fresh rock in
      }
      this._prevPhase = this.phase;
    }
  }

  _updateCrew(dt, t) {
    const roles = this.activeRoles || ['gunner', 'loader'];
    for (const role in this.crewMeshes) {
      const c = this.crewMeshes[role];
      c.visible = roles.includes(role);
      if (!c.visible) continue;
      const u = c.userData;
      const breathe = Math.sin(t * 1.7 + u.phase) * 0.02;
      u.torso.position.y = 1.05 + breathe;
      u.head.position.y = 1.55 + breathe;
      u.helm.position.y = 1.71 + breathe;
      const fat = (this.crewFatigue && this.crewFatigue[role]) || 0;
      const slump = fat > 85 ? 0.22 : 0;
      let armL = 0, armR = 0, lean = slump;
      if (this.phase === 'LOAD' && role === 'loader') { armR = -1.9 + Math.sin(t * 9) * 0.5; lean = 0.25; }
      else if (this.phase === 'COCK') {
        if (role === 'loader' || role === 'engineer') { armR = -1.3 + Math.sin(t * 11 + u.phase) * 0.8; armL = -0.8 + Math.cos(t * 11) * 0.5; lean = 0.18; }
      } else if (this.phase === 'AIM' && role === 'gunner') { armR = -1.5; lean = -0.12; }
      else if ((this.phase === 'SWING' || this.phase === 'RELEASE') && role === 'gunner') { armR = -2.4; }
      else if (this.phase === 'RECOVER') { armL = -0.35 + Math.sin(t * 4 + u.phase) * 0.25; armR = -0.35 + Math.cos(t * 4 + u.phase) * 0.25; }
      else { armL = -0.1 + Math.sin(t * 1.3 + u.phase) * 0.12; armR = -0.1 + Math.sin(t * 1.3 + u.phase + 1.2) * 0.12; }
      u.armL.rotation.x = damp(u.armL.rotation.x, armL, 10, dt);
      u.armR.rotation.x = damp(u.armR.rotation.x, armR, 10, dt);
      c.rotation.x = damp(c.rotation.x, lean, 8, dt);
      c.position.y = c.userData.home.pos.y + Math.sin(t * 0.9 + u.phase) * 0.015;
      c.rotation.y = c.userData.home.rot + Math.sin(t * 0.45 + u.phase) * 0.05;
    }
  }

  setCrew(roles, fatigueMap) { this.activeRoles = roles || []; this.crewFatigue = fatigueMap || {}; }

  setActiveAmmo(ammoId, color = 0x9c968a, radius = 0.42) {
    this.loadedAmmo = ammoId;
    this.projectileMesh.material.color.setHex(color);
    this.projectileMesh.geometry.dispose();
    this.projectileMesh.geometry = new THREE.DodecahedronGeometry(radius, ammoId === 'truestone' ? 2 : 1);
    this.projectileReleased = false;
    if (this.channelStone) {
      this.channelStone.material.color.setHex(color);
      this.channelStone.geometry.dispose();
      this.channelStone.geometry = new THREE.DodecahedronGeometry(radius, ammoId === 'truestone' ? 2 : 1);
      this.channelStone.visible = this.phase === 'IDLE';
    }
    this.projectileMesh.visible = this.phase !== 'IDLE';
  }
  releaseProjectileVisual() { this.projectileReleased = true; this.projectileMesh.visible = false; }
  restoreProjectileVisual() {
    // back to IDLE the cradle rock is shown instead of the shell mesh
    this.projectileReleased = false;
    this.projectileMesh.visible = false;
    if (this.channelStone) this.channelStone.visible = !!this.loadedAmmo;
  }

  dispose() {
    this.root.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) { if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose()); else o.material.dispose(); }
    });
    this.scene.remove(this.root);
  }
}
