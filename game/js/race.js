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
const text = R3D.text, tag = R3D.tag, panel = R3D.panel, plate = R3D.plate,
      checkers = R3D.checkers, roundRect = R3D.roundRect, measure = R3D.measure,
      wasPressed = R3D.wasPressed, AudioSys = R3D.audio,
      tapArea = R3D.tapArea, holdArea = R3D.holdArea;

const SPEED_K = R3D.SPEED_K;
const TOPS = R3D.STAT_TOP;
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
    // Placed from the car's own geometry: just above and behind the rear
    // edge of the bonnet, looking along it. The pitch is set so the bottom
    // of the frame lands exactly on that edge - the bodywork then runs off
    // the bottom of the screen with no gap, and the front wheels (which
    // sit below the bonnet line) stay out of shot.
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

// The on-car cameras follow the shape of the car being driven. The hood
// camera sits just behind the front bumper and a little above its top edge:
// the car's nose then fills the bottom of the frame with no gap of road
// showing under it, the front wheels are far behind the camera, and the
// camera is below the line of the bonnet.
function fitCamerasToCar(carIdx) {
  const a = R3D.carAnchors(carIdx);
  const hy = a.frontTop + 0.04, hz = a.frontZ - 0.23;
  CAMS.hood.off = [0, hy, hz];
  CAMS.hood.look = [0, hy - 0.14, hz + 16];
  CAMS.bumper.off = [0, 0.55, a.noseZ + 0.20];
  CAMS.bumper.look = [0, 0.34, a.noseZ + 0.20 + 19];
}

// camera framing for the landscape frame. With a 60 degree vertical lens and
// the camera 9 units back, the world keeps EXACTLY the original's pixel
// scale (34.6 px per world unit at the car), so the track, the tree walls
// and the distant scenery read exactly like the portrait original - only the
// frame is wider, which is what a landscape phone screen gives us.
const FOV = 60;                  // vertical field of view (degrees)
const HALF_FOV = FOV * Math.PI / 360;
const K0 = 2 * Math.tan(HALF_FOV);
// the 2D prop billboards are sized in screen pixels; this keeps them the same
// size relative to the 3D world as in the 240x320 portrait build
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
  paused: false, pauseSel: 0, pausePage: 0,

  enter() {
    const ti = R3D.game.trackIdx;
    this.track = D.tracks[ti];
    this.theme = this.track.theme;
    if (this._propGeos) for (const key in this._propGeos) for (const g of this._propGeos[key]) g.dispose();
    this._propGeos = null;
    const gfx = S().settings;
    this.world = R3D.buildTrack(this.track, { lighting: gfx.lighting !== 0 });
    R3D.clearScene3d();
    const sc = new THREE.Scene();
    for (const m of this.world.tileMeshes) sc.add(m);
    this.car = R3D.buildCar(R3D.game.carIdx, gfx.lighting !== 0, gfx.shadows !== 0);
    sc.add(this.car);
    this.lights = R3D.buildLights(sc);
    this.setLightLevel(gfx.lighting !== 0);
    this.buildPropBillboards(sc);
    this.setupAI(sc);
    R3D.scene3d = sc;
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    this.tc = THEMES[this.theme];
    this.phase = 'prerace';
    this.paused = false; this.pauseSel = 0; this.pausePage = 0;
    this.timeT = 0; this.cpNext = 0; this.finished = false;
    this.splitT = 0; this.goT = 0;
    this.splitVal = ''; this.splitGood = false;
    this.checkpoints = this.track.checkpoints;
    this.finishIdx = this.track.finish;
    this.finishSeg = this.track.finish * 3 + 2;
    this.azCnt = 0; this.cI = 0; this.coastT = 0;
    this.doneT = 0; this.orbitFrom = 0;
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

  update(dt) {
    if (wasPressed('CAM')) this.cycleCamera();
    if (this.paused) { this.pauseInput(); return; }
    if ((this.phase === 'racing' || this.phase === 'countdown') &&
        (wasPressed('PAUSE') || wasPressed('BACK'))) {
      this.paused = true; this.pauseSel = 0; this.pausePage = 0;
      AudioSys.stopMusic();
      return;
    }
    if (this.phase === 'prerace') {
      if (wasPressed('OK') || wasPressed('UP')) {
        AudioSys.sfx('plink1');
        this.phase = 'countdown'; this.cd = 0; this.cdN = 0;
      }
      if (wasPressed('BACK')) { R3D.clearScene3d(); R3D.setScene(R3D.carSelectSceneRef); }
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
      if (this.goT > 0) this.goT -= dt;
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
      this.updateCamera(dt);
    }
  },

  // ---- pause menu (modern card) ----
  pauseItems() {
    if (this.pausePage === 1) {
      const st = S().settings;
      return [
        { label: 'Camera', right: (CAMS[this.camMode] || CAMS.chase).label },
        { label: 'Touch controls', right: st.buttons === 0 ? 'hidden' : 'shown' },
        { label: 'Motion blur', right: st.motionBlur === 0 ? 'off' : 'on' },
        { label: 'Lighting', right: st.lighting === 0 ? 'off' : 'on' },
        { label: 'Shadows', right: st.shadows === 0 ? 'off' : 'on' },
        { label: 'Auto acceleration', right: st.auto === 1 ? 'on' : 'off' },
        { label: 'Speed units', right: [D.lang[66], D.lang[67]][st.units] },
      ];
    }
    return [
      { label: D.lang[94] },            // Continue
      { label: D.lang[107] },           // Settings
      { label: 'Restart race' },
      { label: 'Quit race' },
    ];
  },
  pausePick(i) {
    if (this.pausePage === 1) {
      const st = S().settings;
      if (i === 0) this.cycleCamera();
      else if (i === 1) st.buttons = (st.buttons + 1) % 2;
      else if (i === 2) st.motionBlur = (st.motionBlur + 1) % 2;
      else if (i === 3) st.lighting = (st.lighting + 1) % 2;
      else if (i === 4) st.shadows = (st.shadows + 1) % 2;
      else if (i === 5) st.auto = (st.auto + 1) % 2;
      else st.units = (st.units + 1) % 2;
      R3D.persist();
      if (i >= 2 && i <= 4) this.rebuildGraphics();
      return;
    }
    if (i === 0) this.resumeRace();
    else if (i === 1) { this.pausePage = 1; this.pauseSel = 0; }
    else if (i === 2) {
      this.paused = false;
      R3D.clearScene3d();
      R3D.setScene(R3D.raceScene);
    } else {
      this.paused = false;
      R3D.clearScene3d();
      R3D.setScene(R3D.newGameScene);
    }
  },

  // ---- camera ----
  cycleCamera() {
    const i = CAM_ORDER.indexOf(this.camMode);
    this.setCamera(CAM_ORDER[(i + 1) % CAM_ORDER.length]);
  },
  setCamera(mode) {
    if (!CAMS[mode]) return;
    this.camMode = mode;
    // snap the camera height, otherwise it would sink or rise into place
    this.camY = this.pos.y + CAMS[mode].off[1];
    S().settings.camera = mode;
    R3D.persist();
  },
  pauseInput() {
    const n = this.pauseItems().length;
    if (wasPressed('DOWN')) this.pauseSel = (this.pauseSel + 1) % n;
    if (wasPressed('UP')) this.pauseSel = (this.pauseSel + n - 1) % n;
    if (wasPressed('BACK')) {
      if (this.pausePage === 1) { this.pausePage = 0; this.pauseSel = 1; return; }
      this.resumeRace();
      return;
    }
    if (wasPressed('OK')) this.pausePick(this.pauseSel);
  },
  resumeRace() {
    this.paused = false;
    if (this.phase === 'racing') AudioSys.play('title', true, 0.85);
  },

  // -------------------------------------------------- physics (original d(boolean))
  step(dt) {
    const car = R3D.game.carIdx;
    const top = TOPS[car] / 10;
    const F5 = dt * SPEED_K;
    if (this.air === 4) this.airT += dt; else this.airT = 0;
    const frozen = this.airT >= 0.05;
    const gas = !this.finished && !frozen && (R3D.keys.U || S().settings.auto === 1);
    const brake = !this.finished && !frozen && R3D.keys.D;
    const left = !this.finished && !frozen && R3D.keys.L;
    const right = !this.finished && !frozen && R3D.keys.R;

    // steering — the original's 1.5 accumulate / 2.5 return, clamped to ±6.
    // Tilt steering feeds an ANALOG target instead of the digital left/right.
    const tilt = (R3D.tilt && R3D.tilt.enabled) ? R3D.tilt.value : 0;
    if (!frozen) {
      if (Math.abs(tilt) > 0.06 && !left && !right) {
        const target = tilt * 6;
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
        // downhill stick-assist (unchanged from the portrait build): glue a
        // slightly falling wheel to ground that descends faster than it falls
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
    let targetRoll = (this.gH[3] - this.gH[2]) * 6;
    let targetPitch = (this.gH[2] + this.gH[3] - this.gH[0] - this.gH[1]) * 4;
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
      // the compact reading in the HUD data panel
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
      // the victory shot is always from behind the car
      this.finishCam = 'chase';
      AudioSys.stopMusic();
      AudioSys.sfx('goal');
      this.buildResults();
    }
    if (!this.finished && this.timeT >= 3000) {
      this.finished = true;
      this.phase = 'done';
      this.coastT = 0.01;
      this.doneT = 0;
      this.buildResults(true);
    }
  },

  buildResults(timeUp) {
    const ti = R3D.game.trackIdx;
    const t10 = Math.round(this.timeT);
    const sv = S();
    let rank = 5;
    for (let i = 4; i >= 0; i--) {
      if (t10 < sv.scores[ti][i]) {
        if (i < 4) { sv.scores[ti][i + 1] = sv.scores[ti][i]; sv.names[ti][i + 1] = sv.names[ti][i]; }
        sv.scores[ti][i] = t10; sv.names[ti][i] = sv.name || D.lang[68];
        rank = i;
      }
    }
    const medalNames = [D.lang[28], D.lang[60], D.lang[8]];
    const rankNames = [D.lang[25], D.lang[55], D.lang[69]];
    let headline, medalText = '', toasts = [];
    if (timeUp) {
      headline = D.lang[72];
    } else if (rank <= 2) {
      headline = medalNames[rank];
      medalText = rankNames[rank];
      if (sv.medals[ti] > rank) sv.medals[ti] = rank;
      for (let k = 1; k < 12; k++) {
        if (sv.medals[k] === 4 && sv.medals[k - 1] <= 2) {
          sv.medals[k] = 3;
          toasts.push(D.lang[85] + ' ' + D.tracks[k].name);
        }
      }
      const need = [-1, 4, 8, 12], req = [-1, 2, 1, 0];
      for (let c = 1; c < 4; c++) {
        if (sv.cars[c] !== 1) continue;
        let blocked = false;
        for (let k = 0; k < need[c]; k++) if (sv.medals[k] > req[c]) { blocked = true; break; }
        if (!blocked) {
          sv.cars[c] = 0;
          toasts.push(D.lang[14] + ' ' + D.cars[c].name);
        }
      }
    } else if (rank === 5) {
      headline = D.lang[29];
    } else {
      headline = D.lang[42];
    }
    const best = sv.scores[ti][0];
    R3D.game.results = {
      headline, medalText, toasts, time: t10,
      bestText: rank === 0 ? '' : (D.lang[32].replace(':', '') + ' ' + R3D.fmtTime(best)),
    };
    if (R3D.game.mode === 'champ' && !timeUp && R3D.game.raceIdx === (sv.champ % 12)) {
      sv.champ = (sv.champ + 1);
      if (sv.champ >= 12) R3D.game.results.headline = D.lang[16];
    }
    R3D.persist();
  },

  // -------------------------------------------------- camera
  // The chase cam keeps the original's trailing yaw (the car visibly leads
  // the camera into a corner). The other viewpoints are mounted on the car
  // and barely lag at all.
  updateCamera(dt) {
    const done = this.phase === 'done' && this.doneT > 1 && this.coastT > 0;
    // after the finish the camera drops back to the chase view: sitting on
    // the bonnet while the car coasts to a stop looks broken
    const mode = (this.phase === 'done' && this.finishCam) ? CAMS[this.finishCam] : (CAMS[this.camMode] || CAMS.chase);

    if (done) {
      // the finish shot: swing around to the front of the car
      const t = 1 - this.coastT / this.doneT;
      const e = t * t * (3 - 2 * t);
      const target = this.yaw + 180;
      this.camYaw = this.orbitFrom + (target - this.orbitFrom) * e;
    } else {
      this.camYaw += (this.yaw - this.camYaw) * (1 - Math.exp(-dt * mode.lag));
    }
    const rad = this.camYaw * Math.PI / 180;
    const cy = Math.cos(rad), sy = Math.sin(rad);

    // camera frame -> world. The car's own frame: +X is the car's right,
    // +Z is the direction it is travelling (the wheel offsets use the
    // opposite convention, with +Z meaning "rear", so they must not be
    // reused here).
    const toWorld = (lx, ly, lz) => ({
      x: this.pos.x + lx * cy + lz * sy,
      y: this.pos.y + ly,
      z: this.pos.z + lx * sy - lz * cy,
    });

    let off = mode.off, look = mode.look;
    const p = toWorld(off[0], off[1], off[2]);
    if (mode.rigid) {
      // a camera bolted to the car: no vertical lag at all, and it is lifted
      // if the road underneath rises above it (a crest, a jump)
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
    this.applyShake(dt, camera);
    this.setHorizonFromLook();
    this.placeCar();
  },

  // the 2D background is aligned to the horizon, so the horizon has to follow
  // whichever camera is active
  setHorizonFromLook() {
    const d = camera.getWorldDirection(this._dirV || (this._dirV = new THREE.Vector3()));
    const pitch = Math.asin(Math.max(-1, Math.min(1, d.y)));   // negative = looking down
    if (pitch < -1.2) { this.horizon = null; return; }          // looking straight down
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

  // -------------------------------------------------- camera shake
  // How much the camera should rattle: the faster you go and the more the
  // suspension is working, the more. The bumpiness comes from how fast the
  // car's attitude is changing - a steady slope gives a constant roll, which
  // should not shake the camera at all. Kept deliberately small: it is there
  // to make the speed felt, not to make the screen hard to read.
  shakeAmount() {
    const top = TOPS[R3D.game.carIdx] / 10;
    const speedK = Math.max(0, Math.min(1, this.speed / top));
    const dRoll = this.prevRoll === undefined ? 0 : Math.abs(this.roll - this.prevRoll);
    const dPitch = this.prevPitch === undefined ? 0 : Math.abs(this.pitch - this.prevPitch);
    const dY = this.prevY === undefined ? 0 : Math.abs(this.pos.y - this.prevY);
    // how much the suspension is working: the car changing attitude and
    // bouncing over the road
    const rough = Math.max(0, Math.min(1, (dRoll + dPitch) * 4 + dY * 6));
    // speed always gives a little rattle, rough ground gives a lot more
    return speedK * speedK * (0.22 + rough * 0.55);
  },

  applyShake(dt, cam) {
    // the on-car cameras are bolted to the body, so they rattle far less
    const scale = this.camMode === 'hood' || this.camMode === 'bumper' ? 0.35 : 1;
    const amt = this.shakeAmount() * 0.35 * scale;
    if (amt >= 0.0015) {
      this.shakeT = (this.shakeT || 0) + dt * (16 + 18 * Math.min(1, this.speed / 4));
      const t = this.shakeT;
      // a couple of out-of-step waves read as a rattle, not as a wobble
      const sx = Math.sin(t * 1.9) * 0.6 + Math.sin(t * 4.3 + 1.1) * 0.4;
      const sy = Math.sin(t * 2.6 + 0.7) * 0.5 + Math.sin(t * 5.7) * 0.5;
      const rad = this.camYaw * Math.PI / 180;
      // the car's right axis, so the shake is across the road and never tilts
      const rx = Math.cos(rad), rz = Math.sin(rad);
      cam.position.x += rx * sx * amt;
      cam.position.z += rz * sx * amt;
      cam.position.y += sy * amt;
    }
    // remember where the car was, so the next frame can see how much the
    // suspension moved
    this.prevRoll = this.roll;
    this.prevPitch = this.pitch;
    this.prevY = this.pos.y;
  },

  // the contact shadow follows the car and fades as it leaves the ground
  updateShadow() {
    if (!this.lights) return;
    const sun = this.lights.sun;
    // the shadow box follows the car, so the map only has to cover the road
    // right around it instead of the whole track
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
    const shadows = on && st.shadows !== 0;
    this.lights.sun.intensity = on ? 0.85 : 0;
    this.lights.ambient.intensity = on ? 0.42 : 1.0;
    this.lights.sun.castShadow = shadows;
    if (this.car) this.car.children[0].castShadow = shadows;
    if (this.ai) this.ai.car.children[0].castShadow = shadows;
  },

  // a graphics setting changed: rebuild what it affects, without touching the
  // state of the race
  rebuildGraphics() {
    const gfx = S().settings;
    const sc = R3D.scene3d;
    if (!sc) return;
    for (const m of this.world.tileMeshes) {
      sc.remove(m);
      if (m.geometry) m.geometry.dispose();
    }
    this.world = R3D.buildTrack(this.track, { lighting: gfx.lighting !== 0 });
    for (const m of this.world.tileMeshes) sc.add(m);
    const old = this.car;
    this.car = R3D.buildCar(R3D.game.carIdx, gfx.lighting !== 0, gfx.shadows !== 0);
    sc.add(this.car);
    sc.remove(old);
    if (this.ai) {
      const oldAi = this.ai.car;
      this.ai.car = R3D.buildCar(this.ai.idx, gfx.lighting !== 0, gfx.shadows !== 0);
      sc.add(this.ai.car);
      sc.remove(oldAi);
    }
    this.setLightLevel(gfx.lighting !== 0);
  },

  // -------------------------------------------------- draw
  draw() {
    const th = this.tc;
    const bg = R3D._bgImg[this.theme];
    const bgW = bg.width * BG_SCALE, bgH = bg.height * BG_SCALE;
    // the background art is pinned to the horizon of whichever camera is
    // active; looking straight down there is no horizon, so it is skipped
    const hy = this.horizon;
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    if (hy === null || hy === undefined) {
      ui.fillStyle = R3D.argb(th.ct).css; ui.fillRect(0, 0, W, H);
    } else {
      const y0 = Math.round(hy - 110 * BG_SCALE);
      let x0 = Math.floor((-(this.camYaw * BG_SCROLL) % bgW + bgW * 4) % bgW) - bgW;
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
    if (this.paused) this.drawPause();
    if (this.phase === 'prerace') this.drawPreRace();
  },

  // -------------------------------------------------- the AI opponent
  // It drives the racing line: the track's stations are 16 units apart, so
  // the opponent is a position along that path, slowing for the corners.
  setupAI(scene) {
    if (R3D.game.mode !== 'mp') { this.ai = null; return; }
    const idx = (R3D.game.carIdx + 1) % 4;
    const gfx = S().settings;
    const car = R3D.buildCar(idx, gfx.lighting !== 0, gfx.shadows !== 0);
    scene.add(car);
    this.ai = { car: car, idx: idx, dist: 5 * 3 * 16, speed: 0, start: 5 * 3 * 16 };
  },

  updateAI(dt) {
    const ai = this.ai;
    if (!ai) return;
    const sts = this.world.stations;
    const n = sts.length - 1;
    const top = TOPS[ai.idx] / 10;
    const i = Math.floor(ai.dist / 16) % n;
    const a = sts[i], b = sts[(i + 1) % n];
    // how hard the next corner is
    const ya = Math.atan2(a.fx, -a.fz), yb = Math.atan2(b.fx, -b.fz);
    let turn = Math.abs(yb - ya);
    if (turn > Math.PI) turn = Math.PI * 2 - turn;
    const target = top * (0.95 - Math.min(0.42, turn * 1.1));
    ai.speed += (target - ai.speed) * Math.min(1, dt * 1.6);
    ai.dist += ai.speed * dt * SPEED_K;
    if (ai.dist > n * 16) ai.dist = ai.start;      // one lap, then it loops
    // place it on the line
    const g = ai.dist / 16;
    const k = Math.floor(g) % n, t = g - Math.floor(g);
    const p0 = sts[k], p1 = sts[(k + 1) % n];
    ai.car.position.set(
      p0.x + (p1.x - p0.x) * t,
      p0.y + (p1.y - p0.y) * t,
      p0.z + (p1.z - p0.z) * t
    );
    const yaw = Math.atan2(p1.x - p0.x, -(p1.z - p0.z)) * 180 / Math.PI;
    ai.car.rotation.order = 'YZX';
    ai.car.rotation.set(0, (180 - yaw) * Math.PI / 180, 0);
  },

  // where the player is relative to the opponent: 1 = leading
  racePosition() {
    if (!this.ai) return 1;
    const mine = (this.segHint || 0) * 16;
    const theirs = this.ai.dist;
    return mine >= theirs ? 1 : 2;
  },

  // -------------------------------------------------- motion blur
  // The scene is rendered into a texture and then drawn again through a
  // radial (zoom) blur that grows with the speed - the classic speed-blur
  // you get at the edge of the screen when you are going fast.
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
        // only the far edges smear - the middle of the screen (the car and
        // the road ahead) stays sharp
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
      transparent: true,
      depthTest: false,
      depthWrite: false,
    });
    this.blurScene = new THREE.Scene();
    this.blurCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.blurQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.blurMat);
    this.blurQuad.frustumCulled = false;
    this.blurScene.add(this.blurQuad);
  },

  // how hard the blur should be right now. The centre of the screen is left
  // alone - that is where the car and the road ahead are, and smearing them
  // is what makes the effect feel broken rather than fast.
  blurAmount() {
    if (S().settings.motionBlur === 0) return 0;
    const top = TOPS[R3D.game.carIdx] / 10;
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
    const k0 = K0;
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
      const k = k0 * depth / H;
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
  // A race-timing overlay: a pause box and a two-row data panel on the left,
  // the speed box with the clock strip under it on the right. Both clusters
  // start on the same line and their plates are the same height, so the
  // overlay reads as one piece of instrumentation.
  drawHUD() {
    if (this.phase === 'prerace') return;
    const units = S().settings.units;
    const kmh = Math.round(this.speed * (units === 0 ? KMH : MPH));
    const top = 14, plateH = 46;

    // ---- top left: pause box + data panel
    this.pauseButton();
    const total = this.finishSeg || 1;
    const prog = Math.max(0, Math.min(1, (this.segHint || 0) / total));
    // the position only shows when there is somebody to race
    const rows = [];
    if (this.ai) rows.push(['Pos.', this.racePosition() + '/2', C.white]);
    rows.push(['Dist.', Math.round(prog * 100) + '%', C.white]);
    rows.push(['Split', this.splitVal || '--:--',
      this.splitVal ? (this.splitGood ? C.green : C.red) : C.faint]);
    const dx = 52, dw = 148;
    const rowH = 21;
    const panelH = 8 + rows.length * rowH;
    plate(dx, top, dw, panelH, { topLine: 'rgba(255,255,255,0.10)' });
    rows.forEach((r, i) => {
      const y = top + 4 + rowH * (i + 0.5);
      tagMid(r[0], dx + 10, y, 0, C.dim, 10, 0.9);
      textMid(r[1], dx + dw - 10, y, 8, r[2], 15, '700', 0, true);
      if (i < rows.length - 1) {
        ui.fillStyle = 'rgba(255,255,255,0.09)';
        ui.fillRect(dx + 10, top + 4 + rowH * (i + 1), dw - 20, 1);
      }
    });

    // ---- top right: speed box
    const sx = W - 146, sw = 130;
    plate(sx, top, sw, plateH, { topLine: 'rgba(255,255,255,0.10)' });
    tag(units === 0 ? 'Km/h' : 'Mph', sx + 10, top + 9, 0, C.dim, 10, 0.9);
    textMid(String(kmh), sx + sw - 10, top + 36, 8, C.white, 32, '700', 0, true);
    // ---- the clock strip
    ui.fillStyle = C.magenta;
    ui.fillRect(sx, top + plateH + 6, sw, 21);
    ui.fillStyle = C.white;
    ui.beginPath();
    ui.moveTo(sx + 9, top + plateH + 11); ui.lineTo(sx + 16, top + plateH + 16.5); ui.lineTo(sx + 9, top + plateH + 22);
    ui.closePath(); ui.fill();
    textMid(this.clockText(), sx + 22, top + plateH + 16.5, 0, C.white, 13, '700', 0.3, true);

    if (this.splitT > 0) {
      this.splitT -= 1 / 60;
      text(this.splitText, W / 2, 62, 5, this.splitColor, 30, '700');
    }
    if (this.goT > 0) {
      text(D.lang[27], W / 2, H / 2 - 40, 5, '#ffffff', 44, '800');
    } else if (this.wrongWay && this.phase === 'racing') {
      tag(D.lang[91], W / 2, 66, 5, C.accent, 20, 2);
    }
    if (this.phase === 'countdown') {
      const labels = [D.lang[49], D.lang[59]];
      const idx = Math.min(this.cdN, 1);
      text(labels[idx], W / 2, H / 2 - 40, 5, '#ffffff', 44, '800');
    }
    if (this.phase === 'done' && this.doneT > 1) {
      const t = 1 - Math.max(0, this.coastT) / this.doneT;
      const a = t <= 0.72 ? 0 : Math.min(1, (t - 0.72) / 0.28);
      if (a > 0) {
        ui.fillStyle = 'rgba(0,0,0,' + a.toFixed(3) + ')';
        ui.fillRect(0, 0, W, H);
      }
    }
  },

  // the clock strip shows M:SS.t - a stopwatch reading
  clockText() {
    const t = Math.max(0, this.timeT) / 10;
    const m = Math.floor(t / 60);
    const s = Math.floor(t % 60);
    const d = Math.floor((t * 10) % 10);
    return m + ':' + (s < 10 ? '0' : '') + s + '.' + d;
  },

  // the pause box, top left
  pauseButton() {
    const x = 16, y = 14, s = 28;
    plate(x, y, s, s, { r: 2, topLine: 'rgba(255,255,255,0.10)' });
    R3D.iconPause(x + s / 2, y + s / 2, 14, C.white);
    tapArea('pause', x - 5, y - 5, s + 10, s + 10, () => {
      if (this.phase === 'racing' || this.phase === 'countdown') {
        this.paused = true; this.pauseSel = 0; this.pausePage = 0;
        AudioSys.stopMusic();
      }
    });
  },

  // -------------------------------------------------- on-screen touch controls
  // The pads are real controls, not flat boxes: a glass plate with a hairline
  // edge and an inner highlight, a solid glyph, and an inverted fill while
  // they are held. They are "hold" areas, so steering and throttle work
  // together and a thumb can slide from one to the next.
  drawControls() {
    if (S().settings.buttons === 0) return;
    const bs = 76;
    const by = H - bs - 16;
    this.pad('L', 22, by, bs, bs, 3, R3D.isHeld('L'));
    this.pad('R', 22 + bs + 12, by, bs, bs, 1, R3D.isHeld('R'));
    // throttle (big) and brake (smaller) on the right
    this.pad('U', W - 104, H - 100, 90, 90, 0, R3D.isHeld('U'), 'GAS');
    this.pad('D', W - 194, H - 86, 70, 70, 2, R3D.isHeld('D'), 'BRAKE');
  },
  pad(id, x, y, w, h, dir, pressed, caption) {
    const r = 6;
    // the plate
    roundRect(x, y, w, h, r);
    const g = ui.createLinearGradient(0, y, 0, y + h);
    if (pressed) {
      g.addColorStop(0, 'rgba(255,196,0,0.34)');
      g.addColorStop(1, 'rgba(255,196,0,0.16)');
    } else {
      g.addColorStop(0, 'rgba(228,236,246,0.16)');
      g.addColorStop(1, 'rgba(90,104,122,0.10)');
    }
    ui.fillStyle = g;
    ui.fill();
    ui.strokeStyle = pressed ? C.accent : 'rgba(255,255,255,0.26)';
    ui.lineWidth = 1;
    ui.stroke();
    // inner highlight along the top edge
    ui.fillStyle = pressed ? 'rgba(255,220,120,0.45)' : 'rgba(255,255,255,0.13)';
    ui.fillRect(x + 3, y + 1, w - 6, 1);
    // the glyph: a solid triangle, inverted when held
    const cx = x + w / 2, cy = y + h / 2 - (caption ? 7 : 0);
    const s = w * 0.30;
    ui.save();
    ui.translate(cx, cy);
    ui.rotate(dir * Math.PI / 2);
    ui.beginPath();
    ui.moveTo(0, -s * 0.55);
    ui.lineTo(s * 0.52, s * 0.40);
    ui.lineTo(-s * 0.52, s * 0.40);
    ui.closePath();
    ui.fillStyle = pressed ? '#101318' : 'rgba(255,255,255,0.92)';
    ui.fill();
    ui.restore();
    if (caption) tag(caption, cx, y + h - 20, 5, pressed ? '#101318' : C.dim, 10, 1.6);
    holdArea(id, x, y, w, h);
  },

  // -------------------------------------------------- pre-race screen
  drawPreRace() {
    ui.fillStyle = 'rgba(4,5,7,0.55)';
    ui.fillRect(0, 0, W, H);
    // banner card at the top
    plate(66, 14, W - 96, 104, { r: 2, fill: 'rgba(12,14,18,0.90)', topLine: 'rgba(255,255,255,0.10)' });
    tag(R3D.game.mode === 'champ' ? D.lang[17] : D.lang[71], W / 2 + 14, 32, 5, C.accent, 12, 1.6);
    text(this.track.name, W / 2 + 14, 50, 5, C.white, 28, '700', 0, true);
    tag(D.cars[R3D.game.carIdx].name, W / 2 + 14, 88, 5, C.dim, 12, 1.4);
    // big start button, kept clear of the car in the middle of the screen
    const bw = 200, bh = 56, bx = W - bw - 26, by = H - bh - 26;
    plate(bx, by, bw, bh, { r: 2, fill: 'rgba(255,196,0,0.16)', borderColor: C.accent, lw: 2 });
    const pulse = 0.5 + 0.5 * Math.sin(R3D.clock * 3);
    ui.save();
    ui.globalAlpha = 0.25 + 0.3 * pulse;
    roundRect(bx - 3, by - 3, bw + 6, bh + 6, 4);
    ui.strokeStyle = C.accent; ui.lineWidth = 1; ui.stroke();
    ui.restore();
    tag('Tap to start', bx + bw / 2, by + 20, 5, C.white, 17, 2);
    tapArea('start', bx, by, bw, bh, () => {
      AudioSys.sfx('plink1');
      this.phase = 'countdown'; this.cd = 0; this.cdN = 0;
    });
    // small back button
    const bxx = 38, byy = 66, rr = 15;
    plate(bxx - rr, byy - rr, rr * 2, rr * 2, { r: 2, fill: 'rgba(12,14,18,0.80)' });
    R3D.iconArrow(bxx, byy, 14, 3, C.white);
    tapArea('pback', bxx - rr - 4, byy - rr - 4, rr * 2 + 8, rr * 2 + 8, () => {
      R3D.clearScene3d();
      R3D.setScene(R3D.carSelectSceneRef);
    });
  },

  // -------------------------------------------------- pause overlay
  drawPause() {
    ui.fillStyle = 'rgba(4,5,7,0.70)';
    ui.fillRect(0, 0, W, H);
    const items = this.pauseItems();
    const rowH = this.pausePage === 1 ? 30 : 34;
    const gap = this.pausePage === 1 ? 5 : 8;
    const cw = 330, ch = (this.pausePage === 1 ? 62 : 76) + items.length * (rowH + gap);
    const x = Math.round((W - cw) / 2), y = Math.max(8, Math.round((H - ch) / 2));
    plate(x, y, cw, ch, { r: 2, fill: 'rgba(10,12,16,0.94)', topLine: 'rgba(255,255,255,0.10)' });
    tag(this.pausePage === 1 ? D.lang[107] : 'Paused', W / 2, y + 24, 5, C.accent, 15, 2.2);
    if (this.pausePage === 1) {
      tag('Tap a row to change it', W / 2, y + 42, 5, C.faint, 10, 0.9);
    }
    let iy = y + (this.pausePage === 1 ? 58 : 50);
    items.forEach((it, i) => {
      const active = i === this.pauseSel;
      plate(x + 16, iy, cw - 32, rowH, {
        r: 2,
        borderColor: active ? C.accent : 'rgba(255,255,255,0.12)',
        lw: active ? 2 : 1,
        topLine: active ? 'rgba(255,214,110,0.28)' : 'rgba(255,255,255,0.09)',
      });
      if (active) { ui.fillStyle = C.accent; ui.fillRect(x + 16, iy, 3, rowH); }
      tag(it.label, x + 30, iy + (rowH - 12) / 2, 0, active ? C.accent : C.text, 12, 0.9);
      if (it.right) tag(it.right, x + cw - 30, iy + (rowH - 12) / 2, 8, C.accent2, 11, 0.9);
      tapArea('p' + i, x + 16, iy, cw - 32, rowH, () => { this.pauseSel = i; this.pausePick(i); });
      iy += rowH + gap;
    });
    if (this.pausePage !== 1) {
      tag('Tap a row  ·  ESC to resume  ·  C for camera', W / 2, y + ch - 20, 5, C.faint, 10, 0.9);
    }
  },
};

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
