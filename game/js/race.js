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
const text = R3D.text, tag = R3D.tag, panel = R3D.panel, checkers = R3D.checkers,
      roundRect = R3D.roundRect, measure = R3D.measure,
      wasPressed = R3D.wasPressed, AudioSys = R3D.audio,
      tapArea = R3D.tapArea, holdArea = R3D.holdArea;

const SPEED_K = R3D.SPEED_K;
const TOPS = R3D.STAT_TOP;
const KMH = 15, MPH = 9.5;
const THEMES = R3D.themeColors;

// camera framing for the landscape frame. With a 60 degree vertical lens and
// the camera 9 units back, the world keeps EXACTLY the original's pixel
// scale (34.6 px per world unit at the car), so the track, the tree walls
// and the distant scenery read exactly like the portrait original - only the
// frame is wider, which is what a landscape phone screen gives us.
const FOV = 60;                  // vertical field of view (degrees)
const CAM_BACK = 9.0;            // units behind the car
const CAM_UP = 3.2;              // units above the car
const CAM_PITCH = 7.5 * Math.PI / 180;   // the camera looks slightly down
const HALF_FOV = FOV * Math.PI / 360;
const K0 = 2 * Math.tan(HALF_FOV);
// the 2D prop billboards are sized in screen pixels; this keeps them the same
// size relative to the 3D world as in the 240x320 portrait build
const PROP_K = (H / K0) / (320 / (2 * Math.tan(30 * Math.PI / 180)));
// where the horizon lands on screen (the background art is aligned to it)
const HORIZON = H / 2 - (H / 2) * Math.tan(CAM_PITCH) / Math.tan(HALF_FOV);
const BG_SCALE = R3D.PIX;
const BG_SCROLL = (W / (2 * Math.atan(Math.tan(HALF_FOV) * (W / H)) * 180 / Math.PI)) / BG_SCALE;
R3D.view = { FOV, CAM_BACK, CAM_UP, CAM_PITCH, HORIZON, BG_SCALE, BG_SCROLL, PROP_K, HALF_FOV };

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
    this.world = R3D.buildTrack(this.track);
    R3D.clearScene3d();
    const sc = new THREE.Scene();
    for (const m of this.world.tileMeshes) sc.add(m);
    this.car = R3D.buildCar(R3D.game.carIdx);
    sc.add(this.car);
    this.buildPropBillboards(sc);
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
    this.gold = this.track.medals[0];
    this.teleport(5);
    this.camYaw = this.yaw;
    this.camY = this.pos.y + CAM_UP;
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
      if (i === 0) st.auto = (st.auto + 1) % 2;
      else st.units = (st.units + 1) % 2;
      R3D.persist();
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
      R3D.setScene(R3D.game.mode === 'champ' ? R3D.nextRaceScene : R3D.trackSelectScene);
    }
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

  // -------------------------------------------------- camera (landscape chase cam)
  updateCamera(dt) {
    const cine = this.phase === 'done' && this.doneT > 1 && this.coastT > 0;
    if (cine) {
      const t = 1 - this.coastT / this.doneT;
      const e = t * t * (3 - 2 * t);
      const target = this.yaw + 180;
      this.camYaw = this.orbitFrom + (target - this.orbitFrom) * e;
    } else {
      this.camYaw += (this.yaw - this.camYaw) * (1 - Math.exp(-dt * 25 / 6));
    }
    const rad = this.camYaw * Math.PI / 180;
    const targetY = this.pos.y + CAM_UP;
    this.camY += (targetY - this.camY) * (1 - Math.exp(-dt * 25 / 1.6));
    this.camPos.set(
      this.pos.x - Math.sin(rad) * CAM_BACK,
      this.camY,
      this.pos.z + Math.cos(rad) * CAM_BACK
    );
    camera.position.copy(this.camPos);
    if (cine) {
      const t = 1 - this.coastT / this.doneT;
      const k = Math.min(1, t * 4);
      camera.lookAt(
        this.camPos.x + Math.sin(rad) * 10 * (1 - k) + (this.pos.x - this.camPos.x) * k,
        this.camY * (1 - k) + (this.pos.y + 1.2) * k,
        this.camPos.z - Math.cos(rad) * 10 * (1 - k) + (this.pos.z - this.camPos.z) * k
      );
    } else {
      // level-ish look, pitched slightly down so the car sits in the lower
      // third of a landscape frame and more of the road is visible
      const cp = Math.cos(CAM_PITCH), sp = Math.sin(CAM_PITCH);
      camera.lookAt(
        this.camPos.x + Math.sin(rad) * 20 * cp,
        this.camPos.y - 20 * sp,
        this.camPos.z - Math.cos(rad) * 20 * cp
      );
    }
    this.car.position.copy(this.pos);
    this.car.rotation.order = 'YZX';
    this.car.rotation.set(
      -this.pitch * Math.PI / 180,
      (180 - this.yaw) * Math.PI / 180,
      this.roll * Math.PI / 180
    );
  },

  // -------------------------------------------------- draw
  draw() {
    const th = this.tc;
    const bg = R3D._bgImg[this.theme];
    const bgW = bg.width * BG_SCALE, bgH = bg.height * BG_SCALE;
    const y0 = Math.round(HORIZON - 110 * BG_SCALE);
    let x0 = Math.floor((-(this.camYaw * BG_SCROLL) % bgW + bgW * 4) % bgW) - bgW;
    ui.fillStyle = '#000'; ui.fillRect(0, 0, W, H);
    if (y0 > 0) { ui.fillStyle = R3D.argb(th.N).css; ui.fillRect(0, 0, W, y0); }
    for (let x = x0; x < W; x += bgW) ui.drawImage(bg, x, y0, bgW, bgH);
    const yBot = y0 + bgH;
    if (yBot < H) { ui.fillStyle = R3D.argb(th.ct).css; ui.fillRect(0, yBot, W, H - yBot); }

    if (R3D.scene3d) {
      this.updateTileWindow();
      this.updateProps();
      renderer.render(R3D.scene3d, camera);
      ui.drawImage(R3D._gl, 0, 0, W, H);
    }

    this.drawHUD();
    if (!this.paused && this.phase !== 'prerace' && this.phase !== 'done') this.drawControls();
    if (this.paused) this.drawPause();
    if (this.phase === 'prerace') this.drawPreRace();
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
  // Laid out like a race-timing overlay: a pause box and a small data panel
  // in the top left, the speed box with the clock strip under it in the top
  // right. Thin white rules, translucent grey plates, one hot magenta bar.
  drawHUD() {
    if (this.phase === 'prerace') return;
    const units = S().settings.units;
    const kmh = Math.round(this.speed * (units === 0 ? KMH : MPH));

    // ---- top left: pause box + data panel
    this.pauseButton();
    panel(52, 14, 152, 44, { r: 2, fill: 'rgba(24,27,32,0.55)' });
    const total = this.finishSeg || 1;
    const prog = Math.max(0, Math.min(1, (this.segHint || 0) / total));
    tag('Dist.', 62, 19, 0, C.dim, 10, 1.2);
    text(Math.round(prog * 100) + '%', 194, 17, 8, C.white, 14, '700', 0, true);
    tag('Split', 62, 37, 0, C.dim, 10, 1.2);
    text(this.splitVal || '--', 194, 35, 8, this.splitVal ? (this.splitGood ? C.green : C.red) : C.faint, 14, '700', 0, true);

    // ---- top right: speed box
    const sx = W - 146;
    panel(sx, 14, 130, 54, { r: 2, fill: 'rgba(24,27,32,0.55)' });
    tag(units === 0 ? 'Km/h' : 'Mph', sx + 10, 20, 0, C.dim, 10, 1.2);
    text(String(kmh), sx + 120, 22, 8, C.white, 34, '700', -0.5, true);
    // ---- the clock strip
    ui.fillStyle = C.magenta;
    ui.fillRect(sx, 74, 130, 22);
    ui.fillStyle = C.white;
    ui.beginPath();
    ui.moveTo(sx + 9, 78); ui.lineTo(sx + 17, 85); ui.lineTo(sx + 9, 92);
    ui.closePath(); ui.fill();
    text(this.clockText(), sx + 23, 78, 0, C.white, 14, '700', 0.4, true);

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
    const x = 16, y = 14, s = 30;
    panel(x, y, s, s, { r: 2, fill: 'rgba(24,27,32,0.55)' });
    R3D.iconPause(x + s / 2, y + s / 2, 16, C.white);
    tapArea('pause', x - 4, y - 4, s + 8, s + 8, () => {
      if (this.phase === 'racing' || this.phase === 'countdown') {
        this.paused = true; this.pauseSel = 0; this.pausePage = 0;
        AudioSys.stopMusic();
      }
    });
  },

  // -------------------------------------------------- on-screen touch controls
  // Squared pads in the same technical language as the HUD: translucent grey
  // plates with a thin white rule, an arrow glyph, and an amber fill while
  // held. They are "hold" areas, so steering and throttle work together.
  drawControls() {
    if (S().settings.buttons === 0) return;
    const bs = 78;                       // steering pad size
    const by = H - bs - 14;
    this.pad('L', 20, by, bs, bs, 3, '◀', R3D.isHeld('L'));
    this.pad('R', 20 + bs + 10, by, bs, bs, 1, '▶', R3D.isHeld('R'));
    // throttle (big) and brake (smaller) on the right
    const gx = W - 104, gy = H - 100, gs = 90;
    this.pad('U', gx, gy, gs, gs, 0, '▲', R3D.isHeld('U'), 'GAS');
    this.pad('D', gx - 84, H - 86, 72, 72, 2, '▼', R3D.isHeld('D'), 'BRAKE');
  },
  pad(id, x, y, w, h, dir, glyph, pressed, caption) {
    panel(x, y, w, h, {
      r: 3,
      fill: pressed ? 'rgba(255,196,0,0.30)' : 'rgba(24,27,32,0.42)',
      borderColor: pressed ? C.accent : 'rgba(255,255,255,0.30)',
      lw: pressed ? 2 : 1,
    });
    R3D.iconArrow(x + w / 2, y + h / 2 - (caption ? 8 : 0), 26, dir,
      pressed ? C.accent : 'rgba(255,255,255,0.88)');
    if (caption) tag(caption, x + w / 2, y + h - 22, 5, pressed ? C.accent : C.dim, 10, 1.4);
    holdArea(id, x, y, w, h);
  },

  // -------------------------------------------------- pre-race screen
  drawPreRace() {
    ui.fillStyle = 'rgba(4,5,7,0.55)';
    ui.fillRect(0, 0, W, H);
    // banner card at the top
    panel(66, 14, W - 96, 112, { r: 2, fill: 'rgba(12,14,18,0.90)' });
    checkers(84, 30, W - 132, 4, 8);
    tag(R3D.game.mode === 'champ' ? D.lang[17] : D.lang[71], W / 2 + 14, 44, 5, C.accent, 12, 1.6);
    text(this.track.name, W / 2 + 14, 62, 5, C.white, 28, '700', 0, true);
    tag(D.cars[R3D.game.carIdx].name, W / 2 + 14, 100, 5, C.dim, 12, 1.4);
    // big start button, kept clear of the car in the middle of the screen
    const bw = 200, bh = 56, bx = W - bw - 26, by = H - bh - 26;
    panel(bx, by, bw, bh, { r: 2, fill: 'rgba(255,196,0,0.16)', borderColor: C.accent, lw: 2 });
    const pulse = 0.5 + 0.5 * Math.sin(R3D.clock * 3);
    ui.save();
    ui.globalAlpha = 0.25 + 0.3 * pulse;
    panel(bx - 3, by - 3, bw + 6, bh + 6, { r: 2, borderColor: C.accent, lw: 1 });
    ui.restore();
    tag('Tap to start', bx + bw / 2, by + 20, 5, C.white, 17, 2);
    tapArea('start', bx, by, bw, bh, () => {
      AudioSys.sfx('plink1');
      this.phase = 'countdown'; this.cd = 0; this.cdN = 0;
    });
    tag('Steer with ◀ ▶   ·   Accelerate with ▲', 26, H - 26, 0, C.faint, 12, 1.2);
    // small back button
    const bxx = 38, byy = 70, rr = 15;
    panel(bxx - rr, byy - rr, rr * 2, rr * 2, { r: 2, fill: 'rgba(12,14,18,0.80)' });
    R3D.iconArrow(bxx, byy, 14, 3, C.white);
    tapArea('pback', bxx - rr - 4, byy - rr - 4, rr * 2 + 8, rr * 2 + 8, () => {
      R3D.clearScene3d();
      R3D.setScene(R3D.carSelectSceneRef);
    });
  },

  // -------------------------------------------------- pause overlay
  drawPause() {
    ui.fillStyle = 'rgba(4,5,7,0.72)';
    ui.fillRect(0, 0, W, H);
    const items = this.pauseItems();
    const cw = 320, ch = 74 + items.length * 42;
    const x = Math.round((W - cw) / 2), y = Math.round((H - ch) / 2);
    panel(x, y, cw, ch, { r: 2, fill: 'rgba(12,14,18,0.96)' });
    checkers(x + 16, y + 16, cw - 32, 4, 8);
    tag(this.pausePage === 1 ? D.lang[107] : 'Paused', W / 2, y + 28, 5, C.accent, 16, 2.4);
    let iy = y + 52;
    items.forEach((it, i) => {
      const active = i === this.pauseSel;
      panel(x + 16, iy, cw - 32, 34, {
        r: 2,
        fill: active ? 'rgba(255,196,0,0.16)' : 'rgba(30,34,40,0.55)',
        borderColor: active ? C.accent : C.lineSoft,
        lw: active ? 2 : 1,
      });
      tag(it.label, x + 32, iy + 10, 0, C.white, 14, 1.2);
      if (it.right) tag(it.right, x + cw - 32, iy + 10, 8, C.accent2, 13, 1.2);
      tapArea('p' + i, x + 16, iy, cw - 32, 34, () => { this.pauseSel = i; this.pausePick(i); });
      iy += 42;
    });
    tag('Tap a row  ·  ESC to resume', W / 2, y + ch - 22, 5, C.faint, 11, 1.2);
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
