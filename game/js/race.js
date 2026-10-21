/* Rally 3D — LANDSCAPE edition
   race.js — physics (ported 1:1 from the original jar), landscape chase camera,
   modern HUD and the on-screen touch controls for phones.

   The driving model is unchanged from the portrait build:
   - physics constants applied per f5-unit (f5 sums to SPEED_K per second)
   - suspension: wheel ground samples at RY(-yaw)*(±2,0,±4), spring g/i/j,
     body y = avg(g), roll = (g[3]-g[2])*6, pitch = (g[2]+g[3]-g[0]-g[1])*4
   - camera yaw lerps toward the car yaw (the original's authentic lag) */
(function () {
'use strict';
const D = window.R3D_DATA;
const R3D = window.R3D;
const W = R3D.W, H = R3D.H;
const ui = document.getElementById('ui').getContext('2d');
const renderer = R3D._renderer, camera = R3D._camera;
const S = () => R3D.saveObj;
const C = R3D.colors;
const text = R3D.text, tag = R3D.tag, plate = R3D.plate,
      roundRect = R3D.roundRect,
      wasPressed = R3D.wasPressed, AudioSys = R3D.audio,
      tapArea = R3D.tapArea, holdArea = R3D.holdArea;

const SPEED_K = R3D.SPEED_K;
// read lazily: scenes.js defines the car stats
const topSpeed = (car) => R3D.STAT_TOP[car] / 10;
const KMH = 15, MPH = 9.5;
const THEMES = R3D.themeColors;
const textMid = R3D.textMid, tagMid = R3D.tagMid;

// ------------------------------------------------------------------ cameras
// Four viewpoints, all in the car's own frame (x = right, y = up, z = front):
//   off  - where the camera sits
//   look - what it points at
//   lag  - how fast the camera frame follows the car's yaw (the original
//          chase cam trails noticeably; the rigid ones barely lag at all)
//
//  chase  - behind and above, the original's trailing yaw
//  hood   - at the base of the windscreen, looking along the bonnet
//  bumper - on the nose, at bumper height
//  top    - from above, the nose pointing up the screen
//
// `rigid` mounts the camera on the car (no vertical lag) and `clear` keeps it
// above the road surface, so a crest or a jump can never swallow it.
const CAMS = {
  chase: {
    label: 'Chase', off: [0, 3.2, -9.0], look: [0, 1.4, 8], lag: 25 / 6,
  },
  hood: {
    label: 'Hood', off: [0, 1.51, 1.03], look: [0, 2.47, 17.03], lag: 25 / 2.6,
    rigid: true, clear: 0.45,
  },
  bumper: {
    label: 'Bumper', off: [0, 0.55, 2.93], look: [0, 0.34, 22], lag: 25 / 2.6,
    rigid: true, clear: 0.35,
  },
  top: {
    label: 'Top down', off: [0, 13.0, -2.2], look: [0, 0, 1.6], lag: 25 / 2,
  },
};
const CAM_ORDER = ['chase', 'hood', 'bumper', 'top'];

// The on-car cameras follow the shape of the car being driven.
function fitCamerasToCar(carIdx) {
  const a = R3D.carAnchors(carIdx);
  const hy = a.frontTop + 0.04, hz = a.frontZ - 0.23;
  CAMS.hood.off = [0, hy, hz];
  CAMS.hood.look = [0, hy - 0.14, hz + 16];
  CAMS.bumper.off = [0, 0.55, a.noseZ + 0.20];
  CAMS.bumper.look = [0, 0.34, a.noseZ + 0.20 + 19];
}

// camera framing for the landscape frame (keeps the original's pixel scale)
const FOV = 60;
const HALF_FOV = FOV * Math.PI / 360;
const K0 = 2 * Math.tan(HALF_FOV);
const PROP_K = (H / K0) / (320 / (2 * Math.tan(30 * Math.PI / 180)));
const BG_SCALE = R3D.PIX;
const BG_SCROLL = (W / (2 * Math.atan(Math.tan(HALF_FOV) * (W / H)) * 180 / Math.PI)) / BG_SCALE;
R3D.view = { FOV, HALF_FOV, BG_SCALE, BG_SCROLL, PROP_K, CAMS };

function sheetKey(theme, code) {
  if (code === 0 || code === 4) return 'bb_' + theme + '_1';
  if (code === 1) return 'bb_' + theme + '_2';
  if (code === 2) return 'bb_' + theme + '_3';
  if (code === 3) return 'bb_shared_4';
  if (code === 5) return 'bb_shared_6';
  if (code === 6) return 'bb_shared_7';
  return null;
}

// one unit plane per sprite frame: bottom-anchored, UVs cut to the frame rect
function makeSpriteGeos(key, spr) {
  const img = R3D._sprImgs[key];
  const iw = (img && img.width) || 256, ih = (img && img.height) || 256;
  const geos = [];
  for (let f = 0; f < 6; f++) {
    const g = new THREE.PlaneGeometry(1, 1);
    g.translate(0, 0.5, 0);
    const u0 = spr.ox[f] / iw, u1 = (spr.ox[f] + spr.w[f]) / iw;
    const vT = 1 - spr.oy[f] / ih, vB = 1 - (spr.oy[f] + spr.h[f]) / ih;
    g.setAttribute('uv', new THREE.Float32BufferAttribute([u0, vT, u1, vT, u0, vB, u1, vB], 2));
    geos.push(g);
  }
  return geos;
}

const PLACES = ['1st', '2nd', '3rd', '4th', '5th'];

// the HUD row
const HUD_Y = 10, HUD_H = 34, HUD_GAP = 4;

const raceScene = {
  phase: 'prerace',   // prerace | countdown | racing | done
  cd: 0, cdN: 0, goT: 0,
  timeT: 0,
  car: null, world: null, track: null,
  camYaw: 0, camY: 0, camPos: new THREE.Vector3(),
  pos: new THREE.Vector3(), yaw: 0, speed: 0, steer: 0,
  roll: 0, pitch: 0,
  gH: [0, 0, 0, 0], sus: [0, 0, 0, 0], gJ: [0, 0, 0, 0],
  segHint: 0, air: 0, airT: 0,
  cpNext: 0, finished: false, wrongWay: false,
  azCnt: 0, cI: 0, coastT: 0, finishSeg: 0,
  doneT: 0, orbitFrom: 0,
  splitText: '', splitColor: '#fff', splitT: 0,
  paused: false, pauseSel: 0, pausePage: 0, pauseT: 0,
  ai: null, mpPlace: 0,

  enter() {
    const ti = R3D.game.trackIdx;
    this.track = D.tracks[ti];
    this.theme = this.track.theme;
    // the previous race's 3D (prop geometry included) was freed by the scene
    // machine when the shutter closed
    this._propGeos = null;
    const gfx = S().settings;
    this.world = R3D.buildTrack(this.track, { lighting: gfx.lighting !== 0 });
    R3D.clearScene3d();
    const sc = new THREE.Scene();
    for (const m of this.world.tileMeshes) sc.add(m);
    this.car = R3D.buildCar(R3D.game.carIdx, gfx.lighting !== 0, gfx.shadows !== 0);
    sc.add(this.car);
    this.lights = R3D.buildLights(sc);
    this.setupAI(sc);
    this.setLightLevel(gfx.lighting !== 0);
    this.buildPropBillboards(sc);
    R3D.scene3d = sc;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    this.tc = THEMES[this.theme];
    this.phase = 'prerace';
    this.paused = false; this.pauseSel = 0; this.pausePage = 0;
    this.timeT = 0; this.cpNext = 0; this.finished = false;
    this.splitT = 0; this.goT = 0; this.cd = 0; this.cdN = 0;
    this.splitVal = ''; this.splitGood = false;
    this.wrongWay = false; this.mpPlace = 0;
    this.checkpoints = this.track.checkpoints;
    this.finishIdx = this.track.finish;
    this.finishSeg = this.track.finish * 3 + 2;
    this.azCnt = 0; this.cI = 0; this.coastT = 0;
    this.doneT = 0; this.orbitFrom = 0; this.finishCam = null;
    this.camMode = CAMS[S().settings.camera] ? S().settings.camera : 'chase';
    fitCamerasToCar(R3D.game.carIdx);
    this.horizon = H / 2;
    this.gold = this.track.medals[0];
    this.teleport(5);
    this.camYaw = this.yaw;
    this.camY = this.pos.y + CAMS.chase.off[1];
    this.camPos.set(this.pos.x, this.camY, this.pos.z);
    AudioSys.stopMusic();
  },

  teleport(tileIdx) {
    const tiles = this.track.tiles;
    const i = Math.max(0, Math.min(tiles.length - 2, tileIdx));
    const t = tiles[i], t2 = tiles[i + 1];
    this.pos.set(t.x, t.h, t.z);
    this.yaw = 180 - (t.acc + t2.acc) / 2;
    this.speed = 0; this.steer = 0; this.roll = 0; this.pitch = 0;
    this.sus = [0, 0, 0, 0];
    this.segHint = i * 3;
    this.tileIdx = i;
    this.sampleWheels(0.0001, true);
    this.pos.y = (this.gH[0] + this.gH[1] + this.gH[2] + this.gH[3]) / 4;
    this.air = 0; this.airT = 0;
  },

  startCountdown() {
    AudioSys.sfx('plink1');
    this.phase = 'countdown'; this.cd = 0; this.cdN = 0;
  },

  update(dt) {
    if (wasPressed('CAM') && this.phase !== 'done') this.cycleCamera(!this.paused);
    if (this.paused) { this.pauseInput(); return; }
    if ((this.phase === 'racing' || this.phase === 'countdown') &&
        (wasPressed('PAUSE') || wasPressed('BACK'))) {
      this.pause();
      return;
    }
    // timers run on real time, not on frame count
    if (this.splitT > 0) this.splitT -= dt;
    if (this.goT > 0) this.goT -= dt;

    if (this.phase === 'prerace') {
      if (wasPressed('OK') || wasPressed('UP')) this.startCountdown();
      else if (wasPressed('BACK')) R3D.setScene(R3D.carSelectSceneRef);
      this.updateCamera(dt);
      return;
    }
    if (this.phase === 'countdown') {
      this.cd += dt;
      if (this.cd >= 1.0) {
        this.cd = 0; this.cdN++;
        if (this.cdN >= 2) {
          AudioSys.sfx('plink2');
          this.phase = 'racing';
          this.goT = 1.0;
          AudioSys.play('title', true, 0.85);
        } else {
          AudioSys.sfx('plink1');
        }
      }
      this.updateCamera(dt);
      return;
    }
    if (this.phase === 'racing') {
      this.step(dt);
      this.updateAI(dt);
      this.updateCamera(dt);
      return;
    }
    if (this.phase === 'done') {
      if (this.coastT > 0) {
        this.coastT -= dt;
        this.step(dt);
        this.speed *= Math.exp(-dt * 1.1);
      } else {
        R3D.setScene(R3D.resultsScene);
      }
      this.updateAI(dt);
      this.updateCamera(dt);
    }
  },

  // ---- pause -----------------------------------------------------------------
  pause() {
    if (this.paused) return;
    this.paused = true;
    this.pausePage = 0;
    this.pauseSel = 0;
    this.pauseT = R3D.clock;
    AudioSys.stopMusic();
    if (R3D.releaseAllHolds) R3D.releaseAllHolds();
  },
  resumeRace() {
    this.paused = false;
    if (this.phase === 'racing') AudioSys.play('title', true, 0.85);
  },
  pauseItems() {
    return [
      { label: D.lang[94] },        // Continue
      { label: 'Restart race' },
      { label: D.lang[107] },       // Settings
      { label: 'Quit race' },
    ];
  },
  pauseSettings() {
    const st = S().settings;
    return [
      { label: 'Camera', right: (CAMS[this.camMode] || CAMS.chase).label },
      { label: 'Touch buttons', toggle: st.buttons !== 0 },
      { label: 'Auto accelerate', toggle: st.auto === 1 },
      { label: 'Speed units', right: st.units === 1 ? 'Mph' : 'Km/h' },
      { label: 'Motion blur', toggle: st.motionBlur !== 0 },
      { label: 'Lighting', toggle: st.lighting !== 0 },
      { label: 'Shadows', toggle: st.shadows !== 0, disabled: st.lighting === 0 },
      { label: 'Sound', right: ['Off', 'Low', 'Loud'][st.sound] },
    ];
  },
  pausePick(i) {
    if (this.pausePage === 1) {
      const st = S().settings;
      if (i === 8) { this.pausePage = 0; this.pauseSel = 2; this.pauseT = R3D.clock; return; }
      if (i === 0) this.cycleCamera(false);
      else if (i === 1) st.buttons = st.buttons === 0 ? 1 : 0;
      else if (i === 2) st.auto = st.auto === 1 ? 0 : 1;
      else if (i === 3) st.units = st.units === 1 ? 0 : 1;
      else if (i === 4) st.motionBlur = st.motionBlur === 0 ? 1 : 0;
      else if (i === 5) { st.lighting = st.lighting === 0 ? 1 : 0; this.rebuildGraphics(); }
      else if (i === 6) { if (st.lighting === 0) return; st.shadows = st.shadows === 0 ? 1 : 0; this.setLightLevel(true); }
      else if (i === 7) { st.sound = (st.sound + 1) % 3; if (st.sound === 0) AudioSys.stopMusic(); }
      R3D.persist();
      return;
    }
    if (i === 0) this.resumeRace();
    else if (i === 1) { this.paused = false; R3D.setScene(raceScene); }
    else if (i === 2) { this.pausePage = 1; this.pauseSel = 0; this.pauseT = R3D.clock; }
    else { this.paused = false; R3D.setScene(R3D.trackSelectScene); }
  },
  pauseInput() {
    if (this.pausePage === 1) {
      const s = this.pauseSel;
      if (wasPressed('DOWN')) this.pauseSel = s === 8 ? 0 : (s % 4 === 3 ? 8 : s + 1);
      if (wasPressed('UP')) this.pauseSel = s === 8 ? 3 : (s % 4 === 0 ? 8 : s - 1);
      if ((wasPressed('LEFT') || wasPressed('RIGHT')) && s < 8) this.pauseSel = s < 4 ? s + 4 : s - 4;
      if (wasPressed('BACK')) { this.pausePage = 0; this.pauseSel = 2; this.pauseT = R3D.clock; return; }
      if (wasPressed('OK')) this.pausePick(this.pauseSel);
      return;
    }
    const n = this.pauseItems().length;
    if (wasPressed('DOWN')) this.pauseSel = (this.pauseSel + 1) % n;
    if (wasPressed('UP')) this.pauseSel = (this.pauseSel + n - 1) % n;
    if (wasPressed('BACK') || wasPressed('PAUSE')) { this.resumeRace(); return; }
    if (wasPressed('OK')) this.pausePick(this.pauseSel);
  },

  // ---- camera ----
  cycleCamera(announce) {
    const i = CAM_ORDER.indexOf(this.camMode);
    this.setCamera(CAM_ORDER[(i + 1) % CAM_ORDER.length]);
    if (announce) R3D.toast('Camera: ' + CAMS[this.camMode].label, 1200, 'cam');
  },
  setCamera(mode) {
    if (!CAMS[mode]) return;
    this.camMode = mode;
    // snap the camera height, otherwise it would sink or rise into place
    this.camY = this.pos.y + CAMS[mode].off[1];
    S().settings.camera = mode;
    R3D.persist();
  },

  // -------------------------------------------------- physics (original d(boolean))
  step(dt) {
    const car = R3D.game.carIdx;
    const top = topSpeed(car);
    const F5 = dt * SPEED_K;
    if (this.air === 4) this.airT += dt; else this.airT = 0;
    const frozen = this.airT >= 0.05;
    const gas = !this.finished && !frozen && (R3D.keys.U || S().settings.auto === 1);
    const brake = !this.finished && !frozen && R3D.keys.D;
    const left = !this.finished && !frozen && R3D.keys.L;
    const right = !this.finished && !frozen && R3D.keys.R;

    // steering — the original's 1.5 accumulate / 2.5 return, clamped to ±6.
    // Tilt steering feeds an ANALOG target instead of the digital left/right.
    const tilt = (R3D.tilt && R3D.tilt.enabled && !this.finished) ? R3D.tilt.value : 0;
    if (!frozen) {
      if (Math.abs(tilt) > 0.06 && !left && !right) {
        // like the buttons, tilt only turns the car once it is rolling
        const target = this.speed > 0.2 ? tilt * 6 : 0;
        this.steer += (target - this.steer) * Math.min(1, dt * 8);
      } else if (left && this.speed > 0.2) {
        this.steer -= 1.5 * F5;
        if (this.steer < -6) this.steer = -6;
      } else if (right && this.speed > 0.2) {
        this.steer += 1.5 * F5;
        if (this.steer > 6) this.steer = 6;
      } else {
        if (this.steer > 0) { this.steer -= 2.5 * F5; if (this.steer < 0) this.steer = 0; }
        else { this.steer += 2.5 * F5; if (this.steer > 0) this.steer = 0; }
      }
    } else {
      this.steer = 0;
    }
    this.yaw += this.steer * F5;

    if (!frozen) {
      if (brake) {
        this.speed -= 0.3 * F5;
        if (this.speed < 0) this.speed = 0;
      } else if (gas && this.speed < top) {
        this.speed += 0.25 * (top - this.speed) / 10 * F5;
        if (this.speed > top) this.speed = top;
      }
    }

    const rad = this.yaw * Math.PI / 180;
    this.pos.x += Math.sin(rad) * this.speed * F5;
    this.pos.z += -Math.cos(rad) * this.speed * F5;

    this.wallCollide();
    this.sampleWheels(dt, false);
    if (this.offCnt > 1 && this.speed > 1.0) {
      this.speed -= 0.14 * F5;
      if (this.speed < 1.0) this.speed = 1.0;
    }
    if (!this.finished) this.timeT += dt * 10;

    if (this.noGround > 1) this.doRespawn();
    if (this.tileIdx >= 0 && this.tileIdx < 4) this.teleport(5);

    this.checkProgress();

    if (!this.finished && this.azCnt >= 2 && this.tileIdx >= 0) {
      const tt = this.track.tiles[this.tileIdx];
      if (tt && ((this.cI < 0 && tt.rowR === 7) || (this.cI > 0 && tt.rowL === 7))) {
        this.doRespawn();
      }
    }
  },

  // -------------------------------------------------- boundary wall (original a(o))
  wallCollide() {
    const sts = this.world.stations;
    const bboxes = this.world.tileBboxes;
    const nT = bboxes ? bboxes.length : 0;
    const a = this.tileIdx;
    if (!nT || a === undefined || a === null) return;
    const pts = [[2, 4], [-2, 4], [2, -4], [-2, -4]];
    const rad = this.yaw * Math.PI / 180;
    const cy = Math.cos(rad), sy = Math.sin(rad);
    const wx = [], wz = [];
    for (let k = 0; k < 4; k++) {
      wx[k] = this.pos.x + pts[k][0] * cy - pts[k][1] * sy;
      wz[k] = this.pos.z + pts[k][0] * sy + pts[k][1] * cy;
    }
    const ring = [0, 1, 3, 2, 0];
    const bb = [0, 0, 0, 0, 0];
    let bestF = 0, pushX = 0, pushZ = 0;
    const t0 = Math.max(0, a - 7), t1 = Math.min(nT - 1, a + 7);
    for (let t = t0; t <= t1; t++) {
      const bx = bboxes[t];
      let active = false;
      for (let k = 0; k < 4 && !active; k++) {
        active = wx[k] >= bx.minX && wx[k] <= bx.maxX && wz[k] >= bx.minZ && wz[k] <= bx.maxZ;
      }
      if (!active) continue;
      for (let s2 = 0; s2 < 2; s2++) {
        const i = t * 3 + s2;
        const sa = sts[i], sb = sts[i + 1];
        if (!sa || !sb) continue;
        for (let side = 0; side < 2; side++) {
          const ea = side === 0 ? sa.extR : sa.extL;
          const eb = side === 0 ? sb.extR : sb.extL;
          const sgn = side === 0 ? 1 : -1;
          const Fx = sa.x + sgn * ea * sa.lx / 4, Fz = sa.z + sgn * ea * sa.lz / 4;
          const Dx = sb.x + sgn * eb * sb.lx / 4, Dz = sb.z + sgn * eb * sb.lz / 4;
          let px = Fx - Dx, pz = Fz - Dz;
          const pl = Math.sqrt(px * px + pz * pz);
          if (pl < 1e-6) continue;
          px /= pl; pz /= pl;
          let agx = -pz, agz = px;
          const cxm = (Fx + Dx) * 0.5 - (sa.x + sb.x) * 0.5;
          const czm = (Fz + Dz) * 0.5 - (sa.z + sb.z) * 0.5;
          if (agx * cxm + agz * czm < 0) { agx = -agx; agz = -agz; }
          for (let k = 0; k < 4; k++) {
            bb[k] = (wx[ring[k]] - Fx) * agx + (wz[ring[k]] - Fz) * agz;
          }
          bb[4] = bb[0];
          for (let k = 0; k < 4; k++) {
            if (bb[k] * bb[k + 1] > 0) continue;
            let t3, ax, az, bx2, bz;
            if (bb[k] > 0) {
              t3 = bb[k] / (bb[k] - bb[k + 1]);
              if (t3 > 1) continue;
              ax = wx[ring[k]]; az = wz[ring[k]];
              bx2 = wx[ring[k + 1]]; bz = wz[ring[k + 1]];
            } else {
              t3 = bb[k + 1] / (bb[k + 1] - bb[k]);
              if (t3 > 1) continue;
              ax = wx[ring[k + 1]]; az = wz[ring[k + 1]];
              bx2 = wx[ring[k]]; bz = wz[ring[k]];
            }
            const aux = ax + t3 * (bx2 - ax), auz = az + t3 * (bz - az);
            if (Math.abs(px) > Math.abs(pz)) {
              if (!((aux >= Fx && aux <= Dx) || (aux <= Fx && aux >= Dx))) continue;
            } else {
              if (!((auz >= Fz && auz <= Dz) || (auz <= Fz && auz >= Dz))) continue;
            }
            const f2 = (aux - ax) * agx + (auz - az) * agz;
            if (f2 < bestF) { bestF = f2; pushX = f2 * agx; pushZ = f2 * agz; }
          }
        }
      }
    }
    if (bestF < 0) {
      this.pos.x += pushX;
      this.pos.z += pushZ;
    }
  },

  // -------------------------------------------------- suspension (original b(float))
  sampleWheels(dt, snap) {
    const F5 = dt * SPEED_K;
    const settle = 0.35 * F5 * F5;
    const rad = this.yaw * Math.PI / 180;
    const cy = Math.cos(rad), sy = Math.sin(rad);
    const pts = [[2, 4], [-2, 4], [2, -4], [-2, -4]];
    let noGround = 0, offCnt = 0, touched = 0, azCnt = 0, cI = 0;
    for (let n = 0; n < 4; n++) {
      const ox = pts[n][0], oz = pts[n][1];
      const wx = this.pos.x + ox * cy - oz * sy;
      const wz = this.pos.z + ox * sy + oz * cy;
      const g = R3D.sampleGround(this.world, wx, wz, this.segHint);
      if (!g) { noGround++; continue; }
      if (!g.drivable) {
        offCnt++;
        if (n >= 2) azCnt++;
        cI = g.sec < 3 ? -1 : 1;
      }
      const f3 = this.gH[n];
      const f4 = this.gH[n] + this.sus[n];
      if (f3 <= g.y || f4 <= g.y) touched++;
      if (snap) {
        this.gH[n] = g.y; this.gJ[n] = g.y; this.sus[n] = 0;
        continue;
      }
      if (f3 < g.y && this.sus[n] < g.y - this.gJ[n]) this.sus[n] = g.y - this.gJ[n];
      if (f4 < g.y) {
        this.gH[n] = g.y;
        if (this.sus[n] <= g.y - this.gJ[n]) this.sus[n] = g.y - this.gJ[n];
      } else {
        this.gH[n] = f4;
        // downhill stick-assist (unchanged from the portrait build)
        const gap = f4 - g.y;
        const groundRate = g.y - this.gJ[n];
        if (this.sus[n] < 0 && gap < 0.6 && groundRate < -0.02 && this.sus[n] > groundRate) {
          this.gH[n] = g.y;
          this.sus[n] = groundRate;
        }
      }
      this.gJ[n] = g.y;
    }
    if (!snap) for (let n = 0; n < 4; n++) this.sus[n] -= settle;
    this.noGround = noGround;
    this.offCnt = offCnt;
    this.azCnt = azCnt;
    this.cI = cI;
    this.air = 4 - touched;
    if (noGround === 4) return;
    const f = snap ? 1 : 1 - Math.pow(0.5, dt * 25);
    const targetRoll = (this.gH[3] - this.gH[2]) * 6;
    const targetPitch = (this.gH[2] + this.gH[3] - this.gH[0] - this.gH[1]) * 4;
    this.roll += (targetRoll - this.roll) * f;
    if (this.roll > 45) this.roll = 45; if (this.roll < -45) this.roll = -45;
    this.pitch += (targetPitch - this.pitch) * f;
    if (this.pitch > 45) this.pitch = 45; if (this.pitch < -45) this.pitch = -45;
    if (!snap) this.pos.y = (this.gH[0] + this.gH[1] + this.gH[2] + this.gH[3]) / 4;
  },

  doRespawn() {
    const ti = (this.tileIdx !== undefined && this.tileIdx !== null) ? this.tileIdx : 5;
    this.teleport(ti);
    this.camYaw = this.yaw;
  },

  checkProgress() {
    const seg = R3D.sampleGround(this.world, this.pos.x, this.pos.z, this.segHint);
    if (seg) this.segHint = seg.seg;
    const ti = seg ? seg.ti : this.tileIdx;
    this.tileIdx = ti;
    if (ti === undefined || ti === null) return;
    if (seg) {
      const a = this.world.stations[seg.seg], b = this.world.stations[seg.seg + 1];
      const dx = b.x - a.x, dz = b.z - a.z;
      const rad = this.yaw * Math.PI / 180;
      const dot = Math.sin(rad) * dx + -Math.cos(rad) * dz;
      this.wrongWay = this.timeT > 30 && dot < 0;
    }
    if (this.cpNext < 3 && ti >= this.checkpoints[this.cpNext]) {
      const target = this.gold * (this.cpNext + 1) / 4;
      const diff = Math.round(this.timeT - target);
      this.splitText = (diff >= 0 ? '+' : '-') + R3D.fmtTime(Math.abs(diff));
      this.splitColor = diff >= 0 ? C.red : C.green;
      this.splitVal = (diff >= 0 ? '+' : '-') + (Math.abs(diff) / 10).toFixed(1);
      this.splitGood = diff < 0;
      this.splitT = 2.5;
      AudioSys.sfx('check');
      this.cpNext++;
    }
    if (!this.finished && seg && seg.seg >= this.finishSeg) {
      this.finished = true;
      this.phase = 'done';
      this.coastT = 2.4;
      this.doneT = 2.4;
      this.orbitFrom = this.camYaw;
      this.finishCam = 'chase';
      this.mpPlace = this.ai ? (this.ai.done ? 2 : 1) : 0;
      AudioSys.stopMusic();
      AudioSys.sfx('goal');
      this.buildResults(false);
    }
    if (!this.finished && this.timeT >= 3000) {
      this.finished = true;
      this.phase = 'done';
      this.coastT = 0.01;
      this.doneT = 0;
      this.mpPlace = this.ai ? 2 : 0;
      this.buildResults(true);
    }
  },

  // The leaderboard, medals, unlocks and the championship.
  // The championship only moves on when the current championship track is
  // raced and a medal is won (which is also what unlocks the next track).
  buildResults(timeUp) {
    const ti = R3D.game.trackIdx;
    const t10 = Math.round(this.timeT);
    const sv = S();
    const prevBest = sv.scores[ti][0];
    let rank = 5;
    if (!timeUp) {
      for (let i = 4; i >= 0; i--) {
        if (t10 < sv.scores[ti][i]) {
          if (i < 4) { sv.scores[ti][i + 1] = sv.scores[ti][i]; sv.names[ti][i + 1] = sv.names[ti][i]; }
          sv.scores[ti][i] = t10; sv.names[ti][i] = sv.name || D.lang[68];
          rank = i;
        }
      }
    }
    const medalNames = [D.lang[28], D.lang[60], D.lang[8]];
    const unlocks = [];
    let headline, sub = '';
    if (timeUp) {
      headline = D.lang[72];                       // Time is up
    } else if (rank <= 2) {
      headline = medalNames[rank];
      if (sv.medals[ti] > rank) sv.medals[ti] = rank;
      for (let k = 1; k < 12; k++) {
        if (sv.medals[k] === 4 && sv.medals[k - 1] <= 2) {
          sv.medals[k] = 3;
          unlocks.push(D.lang[85] + ' ' + D.tracks[k].name);
        }
      }
      const need = [-1, 4, 8, 12], req = [-1, 2, 1, 0];
      for (let c = 1; c < 4; c++) {
        if (sv.cars[c] !== 1) continue;
        let blocked = false;
        for (let k = 0; k < need[c]; k++) if (sv.medals[k] > req[c]) { blocked = true; break; }
        if (!blocked) {
          sv.cars[c] = 0;
          unlocks.push(D.lang[14] + ' ' + D.cars[c].name);
        }
      }
    } else if (rank <= 4) {
      headline = D.lang[29];                       // Good job!
    } else {
      headline = D.lang[42];                       // Sorry, no medal
    }
    if (!timeUp && rank <= 4) sub = PLACES[rank] + ' on the leaderboard';

    let champText = '', champion = false;
    if (sv.champ > 12) sv.champ = 12;              // repair saves from the old bug
    if (R3D.game.mode === 'champ' && !timeUp && sv.champ < 12 && ti === sv.champ) {
      if (rank <= 2) {
        sv.champ++;
        if (sv.champ === 12) { champion = true; headline = D.lang[16]; }
        else champText = 'Championship race ' + sv.champ + ' of 12 complete';
      } else {
        champText = 'Win a medal to move the championship on';
      }
    }

    let mpText = '';
    if (this.ai) mpText = this.mpPlace === 1 ? 'You beat the opponent' : 'The opponent got there first';

    R3D.game.results = {
      headline, sub, medalText: sub,
      time: t10, prevBest,
      record: !timeUp && rank === 0,
      medal: (!timeUp && rank <= 2) ? rank : -1,
      rank, unlocks, toasts: unlocks,
      champText, champion, mpText, mpPlace: this.mpPlace,
      timeUp: !!timeUp, trackIdx: ti,
      bestText: rank === 0 ? '' : ('Best ' + R3D.fmtTime(sv.scores[ti][0])),
    };
    R3D.persist();
  },

  // -------------------------------------------------- camera
  updateCamera(dt) {
    const done = this.phase === 'done' && this.doneT > 1 && this.coastT > 0;
    const mode = (this.phase === 'done' && this.finishCam) ? CAMS[this.finishCam] : (CAMS[this.camMode] || CAMS.chase);

    if (done) {
      const t = 1 - this.coastT / this.doneT;
      const e = t * t * (3 - 2 * t);
      const target = this.yaw + 180;
      this.camYaw = this.orbitFrom + (target - this.orbitFrom) * e;
    } else {
      this.camYaw += (this.yaw - this.camYaw) * (1 - Math.exp(-dt * mode.lag));
    }
    const rad = this.camYaw * Math.PI / 180;
    const cy = Math.cos(rad), sy = Math.sin(rad);

    const toWorld = (lx, ly, lz) => ({
      x: this.pos.x + lx * cy + lz * sy,
      y: this.pos.y + ly,
      z: this.pos.z + lx * sy - lz * cy,
    });

    const off = mode.off, look = mode.look;
    const p = toWorld(off[0], off[1], off[2]);
    if (mode.rigid) {
      this.camY = p.y;
      if (mode.clear) {
        const g = R3D.sampleGround(this.world, p.x, p.z, this.segHint);
        if (g && p.y < g.y + mode.clear) this.camY = g.y + mode.clear;
      }
    } else {
      this.camY += (p.y - this.camY) * (1 - Math.exp(-dt * 25 / 1.6));
    }
    this.camPos.set(p.x, this.camY, p.z);
    camera.position.copy(this.camPos);

    if (done) {
      const t = 1 - this.coastT / this.doneT;
      const k = Math.min(1, t * 4);
      camera.lookAt(
        this.camPos.x + Math.sin(rad) * 10 * (1 - k) + (this.pos.x - this.camPos.x) * k,
        this.camY * (1 - k) + (this.pos.y + 1.2) * k,
        this.camPos.z - Math.cos(rad) * 10 * (1 - k) + (this.pos.z - this.camPos.z) * k
      );
    } else {
      const l = toWorld(look[0], look[1], look[2]);
      camera.lookAt(l.x, l.y, l.z);
    }
    this.setHorizonFromLook();
    this.placeCar();
  },

  setHorizonFromLook() {
    const d = camera.getWorldDirection(this._dirV || (this._dirV = new THREE.Vector3()));
    const pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));
    if (pitch < -1.2) { this.horizon = null; return; }
    this.horizon = H / 2 - (H / 2) * Math.tan(-pitch) / Math.tan(HALF_FOV);
  },

  placeCar() {
    this.car.position.copy(this.pos);
    this.car.rotation.order = 'YZX';
    this.car.rotation.set(
      -this.pitch * Math.PI / 180,
      (180 - this.yaw) * Math.PI / 180,
      this.roll * Math.PI / 180
    );
  },

  updateShadow() {
    if (!this.lights) return;
    const sun = this.lights.sun;
    sun.target.position.set(this.pos.x, this.pos.y, this.pos.z);
    sun.position.set(
      this.pos.x + R3D.SUN[0] * 22,
      this.pos.y + R3D.SUN[1] * 22,
      this.pos.z + R3D.SUN[2] * 22
    );
    sun.target.updateMatrixWorld();
  },

  setLightLevel(on) {
    if (!this.lights) return;
    const st = S().settings;
    on = on && st.lighting !== 0;
    const shadows = on && st.shadows !== 0;
    this.lights.sun.intensity = on ? 0.85 : 0;
    this.lights.ambient.intensity = on ? 0.42 : 1.0;
    this.lights.sun.castShadow = shadows;
    if (this.car) this.car.children[0].castShadow = shadows;
    if (this.ai) this.ai.car.children[0].castShadow = shadows;
  },

  // a graphics setting changed: rebuild what it affects (freeing the old
  // geometry and materials) without touching the state of the race
  rebuildGraphics() {
    const gfx = S().settings;
    const sc = R3D.scene3d;
    if (!sc || !this.world || R3D.currentScene() !== raceScene) return;
    const oldMeshes = this.world.tileMeshes;
    for (const m of oldMeshes) {
      sc.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    if (oldMeshes[0]) oldMeshes[0].material.dispose();   // shared by every tile
    this.world = R3D.buildTrack(this.track, { lighting: gfx.lighting !== 0 });
    for (const m of this.world.tileMeshes) sc.add(m);
    const old = this.car;
    sc.remove(old);
    R3D.disposeObject(old);
    this.car = R3D.buildCar(R3D.game.carIdx, gfx.lighting !== 0, gfx.shadows !== 0);
    sc.add(this.car);
    this.placeCar();
    if (this.ai) {
      const oldAi = this.ai.car;
      sc.remove(oldAi);
      R3D.disposeObject(oldAi);
      this.ai.car = R3D.buildCar(this.ai.idx, gfx.lighting !== 0, gfx.shadows !== 0);
      sc.add(this.ai.car);
      this.placeAI();
    }
    this.setLightLevel(gfx.lighting !== 0);
  },

  // -------------------------------------------------- draw
  draw() {
    const th = this.tc;
    const bg = R3D.bgCanvas(this.theme) || R3D._bgImg[this.theme];
    const bgW = bg.width * BG_SCALE, bgH = bg.height * BG_SCALE;
    const hy = this.horizon;
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    if (hy === null || hy === undefined || !bgW) {
      ui.fillStyle = R3D.argb(th.ct).css; ui.fillRect(0, 0, W, H);
    } else {
      const y0 = Math.round(hy - 110 * BG_SCALE);
      const x0 = Math.floor((-(this.camYaw * BG_SCROLL) % bgW + bgW * 4) % bgW) - bgW;
      if (y0 > 0) { ui.fillStyle = R3D.argb(th.N).css; ui.fillRect(0, 0, W, y0); }
      for (let x = x0; x < W; x += bgW) ui.drawImage(bg, x, y0, bgW, bgH);
      const yBot = y0 + bgH;
      if (yBot < H) { ui.fillStyle = R3D.argb(th.ct).css; ui.fillRect(0, yBot, W, H - yBot); }
    }

    if (R3D.scene3d) {
      this.updateTileWindow();
      this.updateProps();
      this.updateShadow();
      this.renderScene();
      ui.drawImage(R3D._gl, 0, 0, W, H);
    }

    this.drawHUD();
    if (!this.paused && this.phase !== 'prerace' && this.phase !== 'done') this.drawControls();
    if (!this.paused) this.drawWords();
    this.drawFinishFade();
    if (this.paused) this.drawPause();
    if (this.phase === 'prerace') this.drawPreRace();
  },

  // -------------------------------------------------- the AI opponent
  // It drives the racing line: the track's stations are 16 units apart, so
  // the opponent is a distance along that path, offset to one side of the
  // road, slowing for the corners. It lines up beside you on the grid and
  // pulls over after the finish line instead of starting another lap.
  setupAI(scene) {
    this.ai = null;
    if (R3D.game.mode !== 'mp') return;
    const idx = (R3D.game.carIdx + 1) % 4;
    const gfx = S().settings;
    const car = R3D.buildCar(idx, gfx.lighting !== 0, gfx.shadows !== 0);
    scene.add(car);
    this.ai = { car: car, idx: idx, dist: 5 * 3 * 16, speed: 0, done: false };
    this.placeAI();
  },

  updateAI(dt) {
    const ai = this.ai;
    if (!ai) return;
    const sts = this.world.stations;
    const last = sts.length - 2;
    const finishDist = this.finishSeg * 16;
    if (ai.dist >= finishDist) ai.done = true;
    const top = topSpeed(ai.idx);
    let target = 0;
    if (!ai.done) {
      // how hard the next few corners are
      const i0 = Math.floor(ai.dist / 16);
      let turn = 0;
      for (let j = 0; j < 3; j++) {
        const a = sts[Math.min(last, i0 + j)], b = sts[Math.min(last + 1, i0 + j + 1)];
        let d = Math.abs(Math.atan2(b.fx, -b.fz) - Math.atan2(a.fx, -a.fz));
        if (d > Math.PI) d = Math.PI * 2 - d;
        if (d > turn) turn = d;
      }
      target = top * (0.95 - Math.min(0.42, turn * 1.1));
    }
    ai.speed += (target - ai.speed) * Math.min(1, dt * (ai.done ? 0.9 : 1.6));
    ai.dist = Math.min(ai.dist + ai.speed * dt * SPEED_K, last * 16);
    this.placeAI();
  },

  placeAI() {
    const ai = this.ai;
    if (!ai) return;
    const sts = this.world.stations;
    const n = sts.length - 1;
    const g = Math.max(0, Math.min(n - 1e-3, ai.dist / 16));
    const k = Math.floor(g), t = g - k;
    const p0 = sts[k], p1 = sts[Math.min(n, k + 1)];
    const lane = 0.85;                 // x the 4-unit right vector = 3.4 units
    const lx = p0.lx + (p1.lx - p0.lx) * t, lz = p0.lz + (p1.lz - p0.lz) * t;
    const x = p0.x + (p1.x - p0.x) * t + lx * lane;
    const z = p0.z + (p1.z - p0.z) * t + lz * lane;
    let y = p0.y + (p1.y - p0.y) * t;
    const gr = R3D.sampleGround(this.world, x, z, k);
    if (gr) y = gr.y;
    ai.car.position.set(x, y, z);
    const yaw = Math.atan2(p1.x - p0.x, -(p1.z - p0.z)) * 180 / Math.PI;
    ai.car.rotation.order = 'YZX';
    ai.car.rotation.set(0, (180 - yaw) * Math.PI / 180, 0);
  },

  // how far along the racing line the player is (same units as ai.dist)
  progressDist() {
    const seg = this.segHint || 0;
    const sts = this.world.stations;
    const a = sts[seg], b = sts[seg + 1];
    if (!a || !b) return seg * 16;
    const dx = b.x - a.x, dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1;
    const t = Math.max(0, Math.min(1, ((this.pos.x - a.x) * dx + (this.pos.z - a.z) * dz) / l2));
    return (seg + t) * 16;
  },

  // where the player is relative to the opponent: 1 = leading
  racePosition() {
    if (!this.ai) return 1;
    if (this.finished) return this.mpPlace || 2;
    if (this.ai.done) return 2;
    return this.progressDist() >= this.ai.dist ? 1 : 2;
  },

  // -------------------------------------------------- motion blur
  // The scene is rendered into a texture and then drawn again through a
  // radial (zoom) blur that grows with the speed.
  setupBlur() {
    if (this.blurRT) return;
    const w = Math.max(2, Math.round(R3D._gl.width)), h = Math.max(2, Math.round(R3D._gl.height));
    this.blurRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      format: THREE.RGBAFormat, depthBuffer: true, stencilBuffer: false,
    });
    this.blurMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.blurRT.texture },
        strength: { value: 0 },
      },
      vertexShader: [
        'varying vec2 vUv;',
        'void main() {',
        '  vUv = uv;',
        '  gl_Position = vec4(position.xy, 0.0, 1.0);',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D tDiffuse;',
        'uniform float strength;',
        'varying vec2 vUv;',
        'void main() {',
        '  vec2 dir = vUv - 0.5;',
        '  float d = length(dir);',
        '  float amt = strength * smoothstep(0.30, 0.85, d);',
        '  vec4 sum = vec4(0.0);',
        '  float wsum = 0.0;',
        '  for (int i = 0; i < 8; i++) {',
        '    float t = float(i) / 7.0;',
        '    float sc = 1.0 - amt * t;',
        '    float w = 1.0 - t * 0.55;',
        '    sum += texture2D(tDiffuse, 0.5 + dir * sc) * w;',
        '    wsum += w;',
        '  }',
        '  gl_FragColor = sum / wsum;',
        '}',
      ].join('\n'),
      // The render target already holds premultiplied colour (it is cleared
      // to transparent black and the scene draws opaque pixels into it), so
      // the averaged result must be written out as-is. Normal blending
      // multiplied it by alpha a second time, which drew dark fringes
      // wherever the blur reached the transparent sky.
      blending: THREE.NoBlending,
      transparent: false,
      depthTest: false,
      depthWrite: false,
    });
    this.blurScene = new THREE.Scene();
    this.blurCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.blurQuad.frustumCulled = false;
    this.blurScene.add(this.blurQuad);
  },

  blurAmount() {
    if (S().settings.motionBlur === 0) return 0;
    const top = topSpeed(R3D.game.carIdx);
    const k = (this.speed - top * 0.45) / (top * 0.55);
    return Math.max(0, Math.min(1, k)) * 0.075;
  },

  renderScene() {
    const amt = this.blurAmount();
    if (amt <= 0.001) {
      renderer.render(R3D.scene3d, camera);
      return;
    }
    this.setupBlur();
    const rt = this.blurRT;
    if (rt.width !== R3D._gl.width || rt.height !== R3D._gl.height) {
      rt.setSize(Math.max(2, R3D._gl.width), Math.max(2, R3D._gl.height));
    }
    renderer.setRenderTarget(rt);
    renderer.render(R3D.scene3d, camera);
    renderer.setRenderTarget(null);
    this.blurMat.uniforms.strength.value = amt;
    renderer.render(this.blurScene, this.blurCam);
  },

  // -------------------------------------------------- prop billboards
  buildPropBillboards(sc) {
    this.propBills = [];
    this._propGeos = {};
    if (!R3D._propMatCache) R3D._propMatCache = {};
    const geoCache = this._propGeos, matCache = R3D._propMatCache;
    for (const p of this.world.props) {
      const key = sheetKey(this.theme, p.sheet);
      const spr = key ? D.sprites[key] : null;
      if (!spr) continue;
      let mat = matCache[key];
      if (!mat) {
        const tex = R3D._sprTex['spr_' + key];
        if (!tex) continue;
        mat = new THREE.MeshBasicMaterial({ map: tex, alphaTest: 0.5, side: THREE.DoubleSide });
        mat.userData.keep = true;      // shared by every race: never freed
        matCache[key] = mat;
      }
      const geos = geoCache[key] || (geoCache[key] = makeSpriteGeos(key, spr));
      const mesh = new THREE.Mesh(geos[0], mat);
      mesh.visible = false;
      sc.add(mesh);
      this.propBills.push({ p, key, spr, geos, mesh, frame: 0 });
    }
  },

  updateProps() {
    if (!this.propBills) return;
    const v = this._v3 || (this._v3 = new THREE.Vector3());
    const camDir = this._camDir || (this._camDir = new THREE.Vector3());
    camera.getWorldDirection(camDir);
    for (const b of this.propBills) {
      const p = b.p;
      const dx = p.x - camera.position.x, dz = p.z - camera.position.z;
      const depth = dx * camDir.x + dz * camDir.z;
      if (depth < 6 || depth > 128) { b.mesh.visible = false; continue; }
      v.set(p.x, p.y, p.z).project(camera);
      if (v.z > 1) { b.mesh.visible = false; continue; }
      let frame = Math.floor(depth / 16);
      if (frame > 5) frame = 5;
      if (frame < 0) frame = 0;
      const w = b.spr.w[frame], h = b.spr.h[frame];
      if (!w || !h) { b.mesh.visible = false; continue; }
      if (b.frame !== frame) { b.frame = frame; b.mesh.geometry = b.geos[frame]; }
      const k = K0 * depth / H;
      b.mesh.scale.set(w * PROP_K * k, h * PROP_K * k, 1);
      b.mesh.position.set(p.x, p.y, p.z);
      b.mesh.rotation.y = Math.atan2(camera.position.x - p.x, camera.position.z - p.z);
      b.mesh.visible = true;
    }
  },

  // original render window: only a few tiles around the car are drawn
  updateTileWindow() {
    const meshes = this.world.tileMeshes;
    const a = this.tileIdx;
    if (!meshes || a === undefined || a === null) return;
    const back = this.phase === 'done' ? 5 : 2;
    for (let i = 0; i < meshes.length; i++) {
      meshes[i].visible = i >= a - back && i <= a + 5;
    }
  },

  // -------------------------------------------------- HUD
  // One compact row of slanted chips, all on the same top edge and height:
  //   left   pause · camera · [position] · stage (split + stage strip)
  //   right  time · speed (with a rev strip along its bottom edge)
  stageFrac(seg) {
    const start = 15, total = Math.max(start + 1, this.finishSeg || 1);
    return Math.max(0, Math.min(1, (seg - start) / (total - start)));
  },

  drawHUD() {
    if (this.phase === 'prerace') return;
    ui.save();
    this.pauseButton();
    if (this.phase !== 'done' && !this.paused) this.cameraButton();
    let x = 90;
    if (this.ai) x = this.drawPosChip(x) + HUD_GAP;
    this.drawStageChip(x);
    this.drawClockChips();
    ui.restore();
  },

  drawPosChip(x) {
    const p = this.racePosition(), w = 44, y = HUD_Y, h = HUD_H;
    const lead = p === 1;
    plate(x, y, w, h, {
      fill: R3D.vgrad(y, h, lead ? '#3fd47c' : '#ff5a50', lead ? '#16884a' : '#b0201c'),
      borderColor: 'rgba(255,255,255,0.55)', topLine: 'rgba(255,255,255,0.6)',
    });
    textMid('P' + p, x + w / 2 + 1, y + h / 2 + 1, 5, C.white, 17, '800', 0, true);
    return x + w;
  },

  drawStageChip(x) {
    const y = HUD_Y, h = HUD_H, w = 150;
    plate(x, y, w, h);
    const has = !!this.splitVal;
    tagMid('Split', x + 15, y + 11, 0, C.dim, 9, 1);
    textMid(has ? this.splitVal : '—', x + w - 14, y + 12, 8,
      has ? (this.splitGood ? C.green : C.red) : C.faint, 14, '800', 0, true);
    // stage strip: progress, checkpoints, opponent, finish flag
    const bx = x + 12, bw = w - 44, by = y + 24;
    const f = this.stageFrac(this.progressDist() / 16);
    ui.fillStyle = 'rgba(255,255,255,0.16)';
    ui.fillRect(bx, by, bw, 3);
    ui.fillStyle = C.accent;
    ui.fillRect(bx, by, Math.round(bw * f), 3);
    for (let c = 0; c < 3; c++) {
      const cx = bx + Math.round(bw * this.stageFrac(this.checkpoints[c] * 3));
      ui.fillStyle = c < this.cpNext ? C.accent : 'rgba(255,255,255,0.55)';
      ui.fillRect(cx - 1, by - 2, 2, 7);
    }
    if (this.ai) {
      const ax = bx + bw * this.stageFrac(this.ai.dist / 16);
      ui.fillStyle = C.red;
      ui.beginPath();
      ui.moveTo(ax, by - 1); ui.lineTo(ax - 3, by - 6); ui.lineTo(ax + 3, by - 6);
      ui.closePath(); ui.fill();
    }
    ui.fillStyle = C.white;
    ui.fillRect(bx + Math.round(bw * f) - 1, by - 2, 3, 7);
    R3D.checkers(bx + bw + 6, by - 3, 12, 9, 3, '#ffffff', '#101318');
  },

  drawClockChips() {
    const y = HUD_Y, h = HUD_H;
    const sw = 112, sx = W - 10 - sw;
    const tw = 112, tx = sx - HUD_GAP - tw;
    // time
    plate(tx, y, tw, h, {
      fill: R3D.vgrad(y, h, '#3b88f6', C.blueLo),
      borderColor: 'rgba(170,210,255,0.6)', topLine: 'rgba(255,255,255,0.5)',
    });
    tagMid('Time', tx + 16, y + h / 2, 0, 'rgba(255,255,255,0.75)', 9, 1);
    textMid(R3D.fmtTime(this.timeT), tx + tw - 12, y + h / 2 + 1, 8, C.white, 16, '800', 0.3, true);
    // speed
    const units = S().settings.units;
    const v = Math.round(this.speed * (units === 0 ? KMH : MPH));
    plate(sx, y, sw, h);
    tagMid(units === 0 ? 'Km/h' : 'Mph', sx + 15, y + 12, 0, C.dim, 9, 1);
    textMid(String(v), sx + sw - 14, y + 14, 8, C.white, 22, '800', 0, true);
    const f = Math.max(0, Math.min(1, this.speed / topSpeed(R3D.game.carIdx)));
    const n = 12, lit = Math.round(f * n), y0 = y + h - 7;
    for (let i = 0; i < n; i++) {
      const x = sx + 10 + i * 7;
      ui.globalAlpha = i < lit ? 1 : 0.18;
      ui.fillStyle = i >= n - 2 ? C.red : (i >= n - 4 ? C.accent : C.blueHi);
      ui.beginPath();
      ui.moveTo(x + 1, y0); ui.lineTo(x + 6, y0); ui.lineTo(x + 5, y0 + 3); ui.lineTo(x, y0 + 3);
      ui.closePath(); ui.fill();
    }
    ui.globalAlpha = 1;
  },
  // big centre words: Ready / Set / Go, the split chip, wrong way
  drawWords() {
    if (this.phase === 'countdown') {
      const labels = [D.lang[49], D.lang[59]];
      this.bigWord(labels[Math.min(this.cdN, 1)], this.cd, false);
    } else if (this.goT > 0) {
      this.bigWord(D.lang[27], 1 - this.goT, true);
    }
    if (this.splitT > 0 && this.phase !== 'countdown') {
      const age = 2.5 - this.splitT;
      const a = Math.max(0, Math.min(1, this.splitT / 0.4, age / 0.12));
      const k = Math.min(1, age / 0.2), e = 1 - Math.pow(1 - k, 3);
      const str = this.splitText;
      const w = R3D.measure(str, 22, '800') * 0.88 + 48, h = 32;
      const off = (1 - e) * 24;
      const x = (W - w) / 2 + off, y = 54;
      const good = this.splitGood;
      ui.save();
      ui.globalAlpha = a;
      plate(x, y, w, h, {
        fill: R3D.vgrad(y, h, good ? '#3fd47c' : '#ff5a50', good ? '#16884a' : '#b0201c'),
        borderColor: 'rgba(255,255,255,0.6)', topLine: 'rgba(255,255,255,0.6)',
      });
      textMid(str, W / 2 + off, y + h / 2 + 1, 5, C.white, 22, '800', 0, true);
      ui.restore();
    } else if (this.wrongWay && this.phase === 'racing') {
      const w = 230, h = 34, x = (W - w) / 2, y = 62;
      ui.save();
      ui.globalAlpha = 0.65 + 0.35 * Math.sin(R3D.clock * 8);
      plate(x, y, w, h, { fill: R3D.vgrad(y, h, '#ff5a50', '#a81a18'), borderColor: 'rgba(255,220,210,0.8)' });
      tagMid(D.lang[91], W / 2, y + h / 2, 5, C.white, 17, 2);
      ui.restore();
    }
  },

  // chrome word that pops in large, settles, then fades (t: 0..1)
  bigWord(str, t, gold) {
    const pop = Math.min(1, t / 0.15);
    const s = 1.4 - 0.4 * (1 - Math.pow(1 - pop, 3));
    const a = t < 0.7 ? 1 : Math.max(0, 1 - (t - 0.7) / 0.3);
    ui.save();
    ui.globalAlpha = a;
    ui.translate(W / 2, H / 2 - 34);
    ui.scale(s, s);
    plate(-150, -32, 300, 64, { fill: 'rgba(7,18,38,0.55)', border: false, bevel: false, slant: 14 });
    R3D.chromeText(str, 0, 2, 5, 52, { mid: true, spacing: 3, gold: gold });
    ui.restore();
  },

  drawFinishFade() {
    if (this.phase === 'done' && this.doneT > 1) {
      const t = 1 - Math.max(0, this.coastT) / this.doneT;
      const a = t <= 0.72 ? 0 : Math.min(1, (t - 0.72) / 0.28);
      if (a > 0) {
        ui.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
        ui.fillRect(0, 0, W, H);
      }
    }
  },

  // small slanted HUD buttons (pause, camera, back)
  hudButton(id, x, y, w, h) {
    plate(x, y, w, h);
    const fl = R3D.flashFor(id);
    if (fl > 0) {
      ui.save();
      ui.globalAlpha = fl * 0.45;
      R3D.slantPath(x, y, w, h, R3D.slantOf(h));
      ui.fillStyle = '#fff';
      ui.fill();
      ui.restore();
    }
  },

  pauseButton() {
    const x = 10, y = HUD_Y, w = 36, h = HUD_H;
    this.hudButton('pause', x, y, w, h);
    R3D.iconPause(x + w / 2, y + h / 2, 15, C.white);
    tapArea('pause', x - 6, y - 6, w + 8, h + 10, () => {
      if (this.phase === 'racing' || this.phase === 'countdown') this.pause();
    });
  },

  cameraButton() {
    const x = 10 + 36 + HUD_GAP, y = HUD_Y, w = 36, h = HUD_H;
    this.hudButton('camera', x, y, w, h);
    R3D.iconCamera(x + w / 2 + 1, y + h / 2, 15, C.white);
    tapArea('camera', x - 2, y - 6, w + 8, h + 10, () => this.cycleCamera(true));
  },

  // -------------------------------------------------- on-screen touch controls
  // Outlined pads over lightly tinted glass, so the road shows through. A held
  // pad fills amber. Each touch area is a little larger than its pad.
  drawControls() {
    if (S().settings.buttons === 0) return;
    const b = 64;
    this.pad('L', 16, H - b - 16, b, b, 'left', R3D.isHeld('L'));
    this.pad('R', 16 + b + 10, H - b - 16, b, b, 'right', R3D.isHeld('R'));
    this.pad('D', W - 16 - 80 - 10 - 64, H - 64 - 16, 64, 64, 'brake', R3D.isHeld('D'));
    this.pad('U', W - 16 - 80, H - 88 - 16, 80, 88, 'gas', R3D.isHeld('U'));
  },
  pad(id, x, y, w, h, kind, pressed) {
    plate(x, y, w, h, {
      slant: 8,
      fill: pressed ? R3D.vgrad(y, h, 'rgba(255,217,77,0.92)', 'rgba(231,154,0,0.88)') : 'rgba(7,18,38,0.30)',
      borderColor: pressed ? '#ffe08a' : 'rgba(255,255,255,0.42)',
      lw: 1.5,
      topLine: pressed ? 'rgba(255,255,255,0.7)' : 'rgba(255,255,255,0.3)',
    });
    const col = pressed ? C.ink : 'rgba(255,255,255,0.92)';
    const cx = x + w / 2, cy = y + h / 2;
    if (kind === 'left' || kind === 'right') {
      const d = kind === 'left' ? 3 : 1;
      R3D.iconChevron(cx - 6, cy, 20, d, col, 3);
      R3D.iconChevron(cx + 6, cy, 20, d, col, 3);
    } else {
      const up = kind === 'gas';
      ui.fillStyle = col;
      ui.beginPath();
      if (up) {
        ui.moveTo(cx, cy - 20); ui.lineTo(cx + 13, cy + 2); ui.lineTo(cx - 13, cy + 2);
      } else {
        ui.moveTo(cx, cy + 2); ui.lineTo(cx + 12, cy - 16); ui.lineTo(cx - 12, cy - 16);
      }
      ui.closePath();
      ui.fill();
      tag(up ? 'Gas' : 'Brake', cx - 2, y + h - (up ? 22 : 18), 5, pressed ? C.ink : C.dim, 10, 1.6);
    }
    const e = 4;
    holdArea(id, x - e, y - e, w + e * 2, h + e * 2);
  },

  // -------------------------------------------------- pre-race screen
  modeLabel() {
    const m = R3D.game.mode;
    if (m === 'champ') return D.lang[17] + '  ·  Race ' + (R3D.game.trackIdx + 1) + ' of 12';
    if (m === 'mp') return 'Multiplayer  ·  1 opponent';
    return D.lang[71];
  },
  drawPreRace() {
    ui.fillStyle = 'rgba(3,8,18,0.5)';
    ui.fillRect(0, 0, W, H);
    // the stage banner
    const k = R3D.intro(0, 0);
    const bx = 64, by = 14, bw = W - 64 - 40, bh = 100;
    ui.save();
    ui.globalAlpha = k;
    ui.translate((1 - k) * -24, 0);
    plate(bx, by, bw, bh, { fill: 'rgba(7,18,38,0.9)', edge: C.accent, edgeW: 5 });
    tag(this.modeLabel(), bx + 34, by + 14, 0, C.accent, 12, 1.6);
    R3D.chromeText(this.track.name, bx + 32, by + 34, 0, 34, { spacing: 1 });
    const best = S().scores[R3D.game.trackIdx][0];
    tag(D.cars[R3D.game.carIdx].name + '   ·   Best ' + R3D.fmtTime(best), bx + 34, by + 78, 0, C.dim, 11, 1.2);
    R3D.checkers(bx + bw - 72, by + 12, 48, 12, 6, 'rgba(255,255,255,0.85)', 'rgba(8,16,30,0.9)');
    ui.restore();

    // start button, kept clear of the car in the middle of the screen
    const k2 = R3D.intro(2, 0.06);
    const sw = 210, sh = 54, sx = W - sw - 24, sy = H - sh - 24;
    ui.save();
    ui.globalAlpha = k2;
    ui.translate((1 - k2) * 20, 0);
    const pulse = 0.5 + 0.5 * Math.sin(R3D.clock * 3.2);
    ui.save();
    ui.globalAlpha *= 0.25 + 0.4 * pulse;
    R3D.slantPath(sx - 5, sy - 5, sw + 10, sh + 10, R3D.slantOf(sh + 10));
    ui.strokeStyle = C.accent;
    ui.lineWidth = 1.5;
    ui.stroke();
    ui.restore();
    R3D.menuRow('start', sx, sy, sw, sh, R3D.isTouch ? 'Tap to start' : 'Start  ·  Enter', {
      active: true, center: true, size: 16, onTap: () => this.startCountdown(),
    });
    ui.restore();

    // back
    this.hudButton('pback', 10, HUD_Y, 36, HUD_H);
    R3D.iconChevron(29, HUD_Y + HUD_H / 2, 13, 3, C.white, 2.5);
    tapArea('pback', 4, 4, 48, 46, () => R3D.setScene(R3D.carSelectSceneRef));
  },

  // -------------------------------------------------- pause overlay
  drawPause() {
    const k = Math.min(1, (R3D.clock - (this.pauseT || 0)) / 0.18);
    const e = 1 - Math.pow(1 - k, 3);
    ui.fillStyle = 'rgba(3,8,18,' + (0.74 * Math.max(e, 0.6)).toFixed(3) + ')';
    ui.fillRect(0, 0, W, H);
    ui.save();
    ui.globalAlpha = e;
    ui.translate((1 - e) * 16, 0);
    if (this.pausePage === 1) this.drawPauseSettings();
    else this.drawPauseMain();
    ui.restore();
  },

  drawPauseMain() {
    const items = this.pauseItems();
    const rowH = 38, gap = 8;
    const cw = 310;
    const footer = R3D.isTouch ? 16 : 36;
    const ch = 70 + items.length * (rowH + gap) - gap + footer;
    const x = Math.round((W - cw) / 2), y = Math.round((H - ch) / 2);
    plate(x, y, cw, ch, { fill: 'rgba(7,18,38,0.95)', edge: C.accent, edgeW: 5 });
    R3D.chromeText('Paused', W / 2, y + 26, 5, 24, { mid: true, spacing: 3 });
    tagMid(this.track.name + '   ·   ' + R3D.fmtTime(this.timeT), W / 2, y + 48, 5, C.dim, 10, 1);
    let iy = y + 66;
    items.forEach((it, i) => {
      R3D.menuRow('p' + i, x + 22, iy, cw - 40, rowH, it.label, {
        active: i === this.pauseSel,
        right: it.right,
        onTap: () => { this.pauseSel = i; this.pausePick(i); },
      });
      iy += rowH + gap;
    });
    if (!R3D.isTouch) {
      tagMid('Esc to resume   ·   C for camera', W / 2, y + ch - 18, 5, C.faint, 10, 0.9);
    }
  },

  drawPauseSettings() {
    const items = this.pauseSettings();
    const cw = 530, ch = 270;
    const x = Math.round((W - cw) / 2), y = Math.round((H - ch) / 2);
    plate(x, y, cw, ch, { fill: 'rgba(7,18,38,0.95)', edge: C.accent, edgeW: 5 });
    R3D.chromeText(D.lang[107], W / 2, y + 26, 5, 22, { mid: true, spacing: 3 });
    const colW = (cw - 44 - 12) / 2, rowH = 34, gap = 6;
    items.forEach((it, i) => {
      const col = Math.floor(i / 4), row = i % 4;
      const rx = x + 24 + col * (colW + 12);
      const ry = y + 52 + row * (rowH + gap);
      R3D.menuRow('ps' + i, rx, ry, colW, rowH, it.label, {
        active: i === this.pauseSel,
        right: it.right,
        toggle: it.toggle,
        disabled: it.disabled,
        size: 12,
        onTap: () => { this.pauseSel = i; this.pausePick(i); },
      });
    });
    const bw = 150, bx = x + (cw - bw) / 2, by = y + 52 + 4 * (rowH + gap) + 6;
    R3D.menuRow('psback', bx, by, bw, rowH, D.lang[92], {
      active: this.pauseSel === 8,
      center: true,
      size: 12,
      onTap: () => { this.pauseSel = 8; this.pausePick(8); },
    });
  },
};

// the gamepad's B button brakes while racing instead of going back
R3D.raceActive = () => R3D.currentScene && R3D.currentScene() === raceScene && !raceScene.paused &&
  (raceScene.phase === 'racing' || raceScene.phase === 'countdown');

// leaving the app mid-race pauses it
document.addEventListener('visibilitychange', () => {
  if (document.hidden && R3D.raceActive()) raceScene.pause();
});

// background image cache
R3D._bgImg = {};
R3D._sprImgs = {};
(function preload() {
  const img = (f) => {
    const i = new Image(); i.src = 'assets/img/' + f; return i;
  };
  for (const t of ['summer', 'desert', 'winter', 'night']) R3D._bgImg[t] = img('bg_' + t + '.png');
  for (const k in D.sprites) R3D._sprImgs[k] = img(k + '.png');
})();

R3D.raceScene = raceScene;

})();
