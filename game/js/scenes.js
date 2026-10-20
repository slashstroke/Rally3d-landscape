/* Rally 3D — LANDSCAPE edition
   scenes.js — the menus, rebuilt for a 16:9 phone screen:
     title / new game / championship hub / track grid / car showroom /
     high scores / settings / instructions / results.

   The interface follows a race-timing overlay: translucent grey plates with
   thin white rules, uppercase technical labels, values in a bright accent,
   and amber for whatever is selected. */
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
      tapArea = R3D.tapArea;

// ------------------------------------------------------------------ layout
const PAD = 22;
const HEAD_Y = 14;
const STRIP_Y = 54;              // checkered rule under the header
const COL_X = 356, COL_W = 262;  // right-hand menu column
const ROW_H = 44, ROW_GAP = 10;
const SHOP_W = 386;              // 3D showroom panel width (car select)

// null = let plate() use its glass gradient
const PLATE = null;
const PLATE_SOFT = null;

function header(title, opts) {
  opts = opts || {};
  if (opts.back) {
    const bx = PAD, by = HEAD_Y, r = 15;
    plate(bx, by, r * 2, r * 2, { r: 2 });
    R3D.iconArrow(bx + r, by + r, 14, 3, C.white);
    tapArea('back', bx - 4, by - 4, r * 2 + 8, r * 2 + 8, () => {
      if (opts.back === 'title') R3D.setScene(titleScene);
      else if (typeof opts.back === 'function') opts.back();
    });
    tag(title, PAD + 44, HEAD_Y + 8, 0, C.white, 16, 2);
  } else {
    tag(title, PAD, HEAD_Y + 8, 0, C.white, 16, 2);
  }
  // the blue checkered rule is gone from the menus
}

// a small lock glyph for the locked entries
function lockIcon(x, y) {
  ui.fillStyle = 'rgba(226,232,240,0.55)';
  ui.fillRect(x - 6, y - 2, 12, 9);
  ui.strokeStyle = 'rgba(226,232,240,0.7)';
  ui.lineWidth = 2;
  ui.beginPath();
  ui.arc(x, y - 2, 4.5, Math.PI, 0);
  ui.stroke();
}

// press feedback for the plates that are not menu rows
function flashOverlay(id, x, y, w, h) {
  const fl = R3D.flashFor(id);
  if (fl > 0) {
    ui.save();
    ui.globalAlpha = fl * 0.4;
    ui.fillStyle = '#ffffff';
    ui.fillRect(x, y, w, h);
    ui.restore();
  }
}

// a menu row: a thin-ruled plate, uppercase label, value on the right
function bigButton(id, x, y, w, h, label, onTap, opts) {
  opts = opts || {};
  const active = !!opts.active;
  panel(x, y, w, h, {
    r: 2,
    fill: opts.fill || PLATE,
    borderColor: active ? C.accent : (opts.border || 'rgba(255,255,255,0.14)'),
    lw: active ? 2 : 1,
    topLine: active ? 'rgba(255,214,110,0.28)' : 'rgba(255,255,255,0.10)',
  });
  if (active) {
    ui.fillStyle = C.accent;
    ui.fillRect(x, y, 3, h);
  }
  const fs = opts.size || 14;
  const ty = y + (h - fs) / 2 - 1;
  if (opts.upper === false) {
    text(label, x + (opts.center ? w / 2 : 18), ty, opts.center ? 5 : 0, opts.color || C.white, fs, '700', 0, true);
  } else {
    tag(label, x + (opts.center ? w / 2 : 18), ty, opts.center ? 5 : 0,
      opts.color || (active ? C.accent : C.text), fs, 0.9);
  }
  if (opts.right) {
    tag(opts.right, x + w - 18, ty, 8, opts.rightColor || C.accent2, opts.rightSize || 12, 0.9);
  }
  if (opts.dot) {
    ui.beginPath();
    ui.arc(x + w - 22, y + h / 2, 4, 0, Math.PI * 2);
    ui.fillStyle = C.accent2;
    ui.fill();
  }
  // press feedback - the row flashes for a fraction of a second
  const fl = R3D.flashFor(id);
  if (fl > 0) {
    ui.save();
    ui.globalAlpha = fl * 0.45;
    ui.fillStyle = '#ffffff';
    ui.fillRect(x, y, w, h);
    ui.restore();
  }
  if (onTap) tapArea(id, x, y, w, h, onTap);
}

// vertical menu column on the right
function menuColumn(items, onPick, opts) {
  opts = opts || {};
  const x = opts.x === undefined ? COL_X : opts.x;
  const w = opts.w === undefined ? COL_W : opts.w;
  const h = opts.h || ROW_H, gap = opts.gap || ROW_GAP;
  const total = items.length * h + (items.length - 1) * gap;
  let y = opts.y === undefined ? Math.round((H - 28 - total) / 2) + 14 : opts.y;
  items.forEach((it, i) => {
    bigButton('m' + i, x, y, w, h, it.label, () => onPick(i), {
      active: opts.sel === i,
      right: it.right,
      rightColor: it.rightColor,
      dot: it.dot,
      color: it.locked ? C.faint : undefined,
      fill: it.fill,
      size: it.size || 15,
      upper: it.upper,
    });
    y += h + gap;
  });
}

// the original's flag art used as the game's poster on the title screen
function poster(x, y, w, h) {
  if (!R3D._posterImg) return;
  ui.drawImage(R3D._posterImg, x, y, w, h);
}

function logo(x, y, w) {
  if (!R3D._logoImg) return 0;
  const h = w * R3D._logoImg.height / R3D._logoImg.width;
  ui.drawImage(R3D._logoImg, x, y, w, h);
  return h;
}

// ==================================================================== TITLE
const titleScene = {
  sel: 0, menuMusic: true,
  enter() {
    this.sel = 0;
    AudioSys.play('title', true, 0.5);
    R3D.clearScene3d();
  },
  items() {
    return [
      { label: D.lang[101] },                 // New game
      { label: D.lang[97] },                  // High scores
      { label: D.lang[107] },                 // Settings
      { label: D.lang[99] },                  // Instructions
    ];
  },
  pick(i) {
    if (i === 0) R3D.setScene(newGameScene);
    else if (i === 1) R3D.setScene(hiScoreScene);
    else if (i === 2) R3D.setScene(settingsScene);
    else R3D.setScene(instructionsScene);
  },
  update() {
    const n = this.items().length;
    if (wasPressed('DOWN')) this.sel = (this.sel + 1) % n;
    if (wasPressed('UP')) this.sel = (this.sel + n - 1) % n;
    if (wasPressed('OK')) this.pick(this.sel);
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    poster(0, 0, 268, 358);
    const g = ui.createLinearGradient(150, 0, 266, 0);
    g.addColorStop(0, 'rgba(8,9,11,0)');
    g.addColorStop(1, 'rgba(8,9,11,0.97)');
    ui.fillStyle = g; ui.fillRect(150, 0, 140, H);
    const lh = logo(20, 24, 224) || 37;
    // the caption sits on its own plate so it stays readable over the art
    panel(14, 24 + lh + 2, 166, 26, { r: 2, fill: 'rgba(8,9,11,0.66)', border: false });
    tag('Landscape edition', 24, 24 + lh + 9, 0, C.accent, 12, 2);

    menuColumn(this.items(), (i) => { this.sel = i; this.pick(i); }, {
      x: 336, w: 282, y: 96, sel: this.sel,
    });
    const fsLabel = document.fullscreenElement ? 'Exit full screen' : 'Full screen';
    tag(fsLabel, W - PAD, H - 30, 8, C.dim, 11, 1.4);
    tapArea('fs', W - PAD - 130, H - 38, 130, 24, () => R3D.toggleFullscreen());
  },
};

// ==================================================================== NEW GAME
const newGameScene = {
  sel: 0, menuMusic: true,
  enter() { this.sel = 0; },
  items() {
    return [
      { label: D.lang[17], right: '12 races' },   // Championship
      { label: D.lang[71] },                       // Time trial
      { label: 'Multiplayer', right: '1 opponent' },
    ];
  },
  pick(i) {
    if (i === 0) { R3D.game.mode = 'champ'; R3D.setScene(trackSelectScene); }
    else if (i === 1) { R3D.game.mode = 'tt'; R3D.setScene(trackSelectScene); }
    else { R3D.game.mode = 'mp'; R3D.setScene(trackSelectScene); }
  },
  update() {
    const n = this.items().length;
    if (wasPressed('DOWN')) this.sel = (this.sel + 1) % n;
    if (wasPressed('UP')) this.sel = (this.sel + n - 1) % n;
    if (wasPressed('OK')) this.pick(this.sel);
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    header(D.lang[100], { back: 'title' });
    logo(30, 92, 240);
    tag('Choose a mode', 30, 152, 0, C.dim, 12, 2);
    menuColumn(this.items(), (i) => { this.sel = i; this.pick(i); }, { sel: this.sel, y: 96 });
  },
};

// ==================================================================== TRACK SELECT
const trackSelectScene = {
  sel: 0, menuMusic: true,
  enter() {
    this.sel = R3D.game.mode === 'champ' ? (S().champ % 12) : (R3D.game.trackIdx || 0);
  },
  pick(i) {
    if (S().medals[i] >= 4) return;
    R3D.game.trackIdx = i;
    R3D.setScene(carSelectScene);
  },
  update() {
    const n = 12;
    if (wasPressed('DOWN')) this.sel = (this.sel + 1) % n;
    if (wasPressed('UP')) this.sel = (this.sel + n - 1) % n;
    if (wasPressed('LEFT')) this.sel = (this.sel + 4) % n;
    if (wasPressed('RIGHT')) this.sel = (this.sel + 8) % n;
    if (wasPressed('OK')) this.pick(this.sel);
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    header(D.lang[58], { back: () => R3D.setScene(newGameScene) });
    const cols = 4, cw = 142, ch = 74, gx = 14, gy = 12;
    const gridW = cols * cw + (cols - 1) * gx;
    const x0 = Math.round((W - gridW) / 2), y0 = 82;
    for (let i = 0; i < 12; i++) {
      const cx = x0 + (i % cols) * (cw + gx);
      const cy = y0 + Math.floor(i / cols) * (ch + gy);
      const locked = S().medals[i] >= 4;
      const active = i === this.sel;
      panel(cx, cy, cw, ch, {
        r: 2,
        fill: active ? 'rgba(255,196,0,0.10)' : PLATE_SOFT,
        borderColor: active ? C.accent : 'rgba(255,255,255,0.14)',
        lw: active ? 2 : 1,
      });
      if (active) { ui.fillStyle = C.accent; ui.fillRect(cx, cy, 3, ch); }
      tag(String(i + 1).padStart(2, '0'), cx + 12, cy + 9, 0, active ? C.accent : C.faint, 10, 1.6);
      const nm = D.tracks[i].name;
      const fs = measure(nm, 16, '700', 0, true) > cw - 24 ? 14 : 16;
      text(nm, cx + 12, cy + 30, 0, locked ? C.faint : C.white, fs, '700', 0, true);
      if (locked) lockIcon(cx + cw - 20, cy + ch - 18);
      else {
        const m = S().medals[i];
        if (m <= 2 && R3D._cupImgs[m]) ui.drawImage(R3D._cupImgs[m], cx + cw - 30, cy + ch - 28);
      }
      if (!locked) {
        flashOverlay('t' + i, cx, cy, cw, ch);
        tapArea('t' + i, cx, cy, cw, ch, () => { this.sel = i; this.pick(i); });
      }
    }
  },
};

// ==================================================================== CAR SELECT
const carSelectScene = {
  sel: 0, yaw: 0, v: 32, spinVel: 250, menuMusic: true, confirmT: 0,
  enter() {
    this.sel = R3D.game.carIdx || 0;
    this.yaw = 0; this.v = 32; this.spinVel = 250; this.confirmT = 0;
    R3D.clearScene3d();
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    camera.aspect = SHOP_W / H;
    camera.updateProjectionMatrix();
    const sc = new THREE.Scene();
    this.holder = new THREE.Group();
    this.tilt = new THREE.Group();
    this.tilt.rotation.x = 32 * Math.PI / 180;
    this.holder.add(this.tilt);
    sc.add(this.holder);
    this.car = null;
    this.swap();
    R3D.scene3d = sc;
  },
  swap() {
    if (this.car) this.tilt.remove(this.car);
    this.car = R3D.buildCar(this.sel);
    this.car.rotation.y = this.yaw * Math.PI / 180;
    this.tilt.add(this.car);
    this.holder.position.set(0, 0, -8 - this.v);
  },
  update(dt) {
    if (this.confirmT > 0) {
      this.confirmT -= dt;
      this.v = Math.min(16, this.v + dt * 30);
      this.holder.position.z = -8 - this.v;
      this.spinVel += (250 - this.spinVel) * Math.min(1, dt * 1.4);
      this.yaw += this.spinVel * dt;
      this.car.rotation.y = this.yaw * Math.PI / 180;
      if (this.confirmT <= 0) {
        R3D.clearScene3d();
        R3D.setScene(R3D.raceScene);
      }
      return;
    }
    if (this.v > 0) {
      this.v = Math.max(0, this.v - dt * 28);
      this.holder.position.z = -8 - this.v;
    }
    // drag to spin (mouse or finger on the showroom)
    const dg = R3D.dragState;
    if (dg && dg.down && dg.dx !== 0) {
      const dYaw = dg.dx * 2.4;
      this.yaw += dYaw;
      const inst = Math.max(-1500, Math.min(1500, dYaw / Math.max(dt, 1e-4)));
      this.spinVel = this.spinVel * 0.55 + inst * 0.45;
    } else {
      this.spinVel += (250 - this.spinVel) * Math.min(1, dt * 1.4);
      this.yaw += this.spinVel * dt;
    }
    if (this.yaw > 180000 || this.yaw < -180000) this.yaw %= 360;
    this.car.rotation.y = this.yaw * Math.PI / 180;
    if (wasPressed('RIGHT')) { this.sel = (this.sel + 1) % 4; this.swap(); }
    if (wasPressed('LEFT')) { this.sel = (this.sel + 3) % 4; this.swap(); }
    if (wasPressed('OK')) { if (S().cars[this.sel] === 0) this.start(); }
  },
  start() {
    R3D.game.carIdx = this.sel;
    this.confirmT = 0.5;
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    if (R3D.scene3d) {
      // the showroom renders into the left panel only; the GL canvas is
      // composited over the UI canvas (the 3D layer sits UNDER the UI layer)
      renderer.setViewport(0, 0, SHOP_W, H);
      renderer.render(R3D.scene3d, camera);
      renderer.setViewport(0, 0, W, H);
      ui.drawImage(R3D._gl, 0, 0, W, H);
    }
    // dragging on the model spins it
    R3D.dragArea('car', 0, 0, SHOP_W - 30, H);

    header('Select car', { back: () => R3D.setScene(trackSelectScene) });
    const locked = S().cars[this.sel] === 1;
    // the stat card sits under the model, clear of it
    plate(16, 250, 252, 92, { r: 2, fill: 'rgba(10,12,16,0.88)', topLine: 'rgba(255,255,255,0.10)' });
    if (locked) {
      tag(D.lang[9], 30, 268, 0, C.accent, 13, 1.8);
      // just how it is locked, no explanation
      const need = ['4x BRONZE', '8x SILVER', '12x GOLD'][this.sel - 1] || '';
      tag(need, 30, 300, 0, C.dim, 12, 1.6);
    } else {
      const bars = [[D.lang[65], R3D.STAT_TOP], [D.lang[4], R3D.STAT_ACC], [D.lang[30], R3D.STAT_GRIP]];
      let y = 266;
      for (const [label, stat] of bars) {
        tag(label, 30, y, 0, C.dim, 10, 1.4);
        const bx = 78, bw = 170;
        ui.fillStyle = 'rgba(255,255,255,0.12)';
        ui.fillRect(bx, y + 3, bw, 8);
        ui.fillStyle = C.accent2;
        ui.fillRect(bx, y + 3, Math.max(6, bw * stat[this.sel] / 100), 8);
        y += 24;
      }
    }

    const items = D.cars.map((c, i) => ({
      label: c.name,
      locked: S().cars[i] === 1,
      dot: S().cars[i] === 0,
    }));
    menuColumn(items, (i) => { this.sel = i; this.swap(); }, { x: COL_X, y: 74, h: 36, gap: 6, sel: this.sel });
    if (!locked) {
      bigButton('race', COL_X, 250, COL_W, 56, 'Race!', () => this.start(), {
        active: true, center: true, size: 20, color: C.white, fill: 'rgba(255,196,0,0.12)', border: C.accent,
      });
    }
  },
};

// ==================================================================== HIGH SCORES
const hiScoreScene = {
  sel: 0, menuMusic: true,
  enter() {
    this.sel = R3D.game.mode === 'champ' ? (S().champ % 12) : (R3D.game.trackIdx || 0);
  },
  update() {
    if (wasPressed('RIGHT')) this.sel = (this.sel + 1) % 12;
    if (wasPressed('LEFT')) this.sel = (this.sel + 11) % 12;
    if (wasPressed('OK')) R3D.setScene(titleScene);
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    header(D.lang[96], { back: 'title' });
    const sv = S();
    panel(PAD, 82, 300, 194, { r: 2, fill: PLATE_SOFT });
    text(D.tracks[this.sel].name, PAD + 18, 96, 0, C.white, 19, '700', 0, true);
    let y = 134;
    for (let i = 0; i < 5; i++) {
      const medal = [C.accent, '#dfe6f0', '#cd7f45'][i] || C.faint;
      tag(String(i + 1), PAD + 18, y + 2, 0, medal, 14, 1);
      text(sv.names[this.sel][i].substring(0, 12), PAD + 44, y, 0, C.white, 15, '700', 0, true);
      text(R3D.fmtTime(sv.scores[this.sel][i]), PAD + 282, y, 8, C.white, 15, '700', 0, true);
      y += 28;
    }
    const x0 = 356, cw = 128, ch = 30, gx = 8, gy = 6;
    for (let i = 0; i < 12; i++) {
      const cx = x0 + (i % 2) * (cw + gx);
      const cy = 82 + Math.floor(i / 2) * (ch + gy);
      const active = i === this.sel;
      panel(cx, cy, cw, ch, {
        r: 2,
        fill: active ? 'rgba(255,196,0,0.10)' : PLATE_SOFT,
        borderColor: active ? C.accent : 'rgba(255,255,255,0.14)',
        lw: active ? 2 : 1,
      });
      if (active) { ui.fillStyle = C.accent; ui.fillRect(cx, cy, 3, ch); }
      const nm = D.tracks[i].name;
      const fs = measure(nm, 13, '700', 0, true) > cw - 40 ? 11 : 13;
      text(nm, cx + 10, cy + 8, 0, active ? C.white : C.dim, fs, '700', 0, true);
      const m = sv.medals[i];
      if (m <= 2 && R3D._cupImgs[m]) ui.drawImage(R3D._cupImgs[m], cx + cw - 22, cy + 7);
      else if (m >= 4) lockIcon(cx + cw - 16, cy + ch / 2);
      flashOverlay('hs' + i, cx, cy, cw, ch);
      tapArea('hs' + i, cx, cy, cw, ch, () => { this.sel = i; });
    }
  },
};

// ==================================================================== SETTINGS
const settingsScene = {
  sel: 0, page: 0, menuMusic: true,
  enter() { this.sel = 0; this.page = 0; },
  items() {
    const st = S().settings;
    return [
      { label: 'Sound', right: [D.lang[64], D.lang[62], D.lang[61]][st.sound] },
      { label: 'Speed units', right: [D.lang[66], D.lang[67]][st.units] },
      { label: 'Auto acceleration', right: st.auto === 1 ? 'on' : 'off' },
      { label: 'Title song', right: st.titleSong === 1 ? 'Tinysynth' : 'Tinysound' },
      { label: 'Tilt steering', right: st.tilt === 1 ? 'on' : 'off' },
      { label: 'On-screen buttons', right: st.buttons === 0 ? 'off' : 'on' },
      { label: 'Graphics', right: '' },
      { label: D.lang[52], right: '' },
    ];
  },
  // the graphics sub-page
  gfxItems() {
    const st = S().settings;
    return [
      { label: 'Motion blur', right: st.motionBlur === 0 ? 'off' : 'on' },
      { label: 'Lighting', right: st.lighting === 0 ? 'off' : 'on' },
      { label: 'Shadows', right: st.shadows === 0 ? 'off' : 'on' },
    ];
  },
  pick(i) {
    const st = S().settings;
    if (this.page === 1) {
      if (i === 0) st.motionBlur = (st.motionBlur + 1) % 2;
      else if (i === 1) st.lighting = (st.lighting + 1) % 2;
      else st.shadows = (st.shadows + 1) % 2;
      R3D.persist();
      if (R3D.raceScene && R3D.raceScene.rebuildGraphics) R3D.raceScene.rebuildGraphics();
      return;
    }
    if (i === 0) { st.sound = (st.sound + 1) % 3; if (st.sound === 0) AudioSys.stopMusic(); }
    else if (i === 1) st.units = (st.units + 1) % 2;
    else if (i === 2) st.auto = (st.auto + 1) % 2;
    else if (i === 3) {
      st.titleSong = (st.titleSong === 1) ? 0 : 1;
      if (AudioSys.music) AudioSys.stopMusic();
    } else if (i === 4) {
      if (st.tilt === 1) { st.tilt = 0; R3D.tilt.disable(); }
      else {
        R3D.tilt.enable().then((ok) => {
          st.tilt = ok ? 1 : 0;
          if (!ok) R3D.toast('Tilt steering is not available on this device');
          R3D.persist();
        });
      }
    } else if (i === 5) st.buttons = (st.buttons + 1) % 2;
    else if (i === 6) { this.page = 1; this.sel = 0; return; }
    else { R3D.saveReset(); R3D.toast('Progress reset'); }
    R3D.persist();
  },
  update() {
    const items = this.page === 1 ? this.gfxItems() : this.items();
    const n = items.length;
    if (wasPressed('DOWN')) this.sel = (this.sel + 1) % n;
    if (wasPressed('UP')) this.sel = (this.sel + n - 1) % n;
    if (wasPressed('OK')) this.pick(this.sel);
    if (wasPressed('BACK')) {
      if (this.page === 1) { this.page = 0; this.sel = 6; }
      else R3D.setScene(titleScene);
    }
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    if (this.page === 1) {
      header('Graphics', { back: () => { this.page = 0; this.sel = 6; } });
      const items = this.gfxItems();
      menuColumn(items, (i) => { this.sel = i; this.pick(i); }, { x: COL_X, y: 96, h: 40, gap: 8, sel: this.sel });
      panel(PAD, 84, 300, 196, { r: 2, fill: PLATE_SOFT });
      tag('Graphics', PAD + 18, 98, 0, C.accent, 12, 2);
      const tips = [
        'Motion blur smears the edges of the',
        'screen when you pick up speed.',
        '',
        'Lighting puts a sun on the hills and',
        'the car.',
        '',
        'Shadows drop the car onto the road.',
      ];
      tips.forEach((t, i) => text(t, PAD + 18, 128 + i * 21, 0, C.dim, 12, '500'));
      return;
    }
    header(D.lang[107], { back: 'title' });
    const items = this.items().map((it) => ({ label: it.label, right: it.right }));
    menuColumn(items, (i) => { this.sel = i; this.pick(i); }, { sel: this.sel, y: 68, h: 32, gap: 5 });
    // a short "how to play" card on the empty left half
    panel(PAD, 82, 300, 182, { r: 2, fill: PLATE_SOFT });
    tag('How to play', PAD + 18, 96, 0, C.accent, 12, 2);
    const tips = [
      'Steer with the ◀ ▶ pads',
      'Accelerate with ▲, brake with ▼',
      'Or turn on tilt steering and',
      'just tilt the device to steer',
      'Tap the pause box to stop',
    ];
    tips.forEach((t, i) => text(t, PAD + 18, 124 + i * 26, 0, C.dim, 13, '600'));
  },
};

// ==================================================================== INSTRUCTIONS
const instructionsScene = {
  page: 0, menuMusic: true,
  pages() { return [D.lang[0], D.lang[1], D.lang[3]]; },
  // the jar's strings carry %NU placeholders for the key numbers
  fix(str) {
    return str
      .replace('%0U', '◀').replace('%1U', '▶')
      .replace('%2U', '▲').replace('%3U', '▼')
      .replace('%U', 'OK');
  },
  update() {
    if (wasPressed('RIGHT') || wasPressed('DOWN')) this.page = (this.page + 1) % 3;
    if (wasPressed('LEFT') || wasPressed('UP')) this.page = (this.page + 2) % 3;
    if (wasPressed('OK')) R3D.setScene(titleScene);
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    header(D.lang[99], { back: 'title' });
    panel(PAD, 82, W - PAD * 2, 202, { r: 2, fill: PLATE_SOFT });
    const body = this.fix(this.pages()[this.page]);
    const words = body.split(' ');
    let line = '', y = 104, maxW = W - PAD * 2 - 44;
    for (const w of words) {
      const t = line + w + ' ';
      if (measure(t, 15, '500') > maxW) {
        text(line, PAD + 22, y, 0, C.white, 15, '500');
        y += 24; line = w + ' ';
      } else line = t;
    }
    if (line) text(line, PAD + 22, y, 0, C.white, 15, '500');
    const cx = W / 2;
    for (let i = 0; i < 3; i++) {
      ui.beginPath();
      ui.arc(cx - 22 + i * 22, H - 44, 4, 0, Math.PI * 2);
      ui.fillStyle = i === this.page ? C.accent : 'rgba(255,255,255,0.24)';
      ui.fill();
    }
    R3D.iconArrow(PAD + 26, H - 44, 18, 3, C.dim);
    R3D.iconArrow(W - PAD - 26, H - 44, 18, 1, C.dim);
    tapArea('prev', 0, 70, W / 2, H - 70, () => { this.page = (this.page + 2) % 3; });
    tapArea('next', W / 2, 70, W / 2, H - 70, () => { this.page = (this.page + 1) % 3; });
  },
};

// ==================================================================== RESULTS
const resultsScene = {
  menuMusic: true, musicT: 0,
  enter() { AudioSys.stopMusic(); this.musicT = 2.0; },
  update(dt) {
    if (this.musicT > 0) this.musicT -= dt;
    if (wasPressed('OK') || wasPressed('BACK')) this.leave();
  },
  leave() {
    // back to the track list either way - the championship moves on to the
    // next race from there
    R3D.setScene(trackSelectScene);
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    const g = R3D.game.results || { headline: '', time: 0 };
    const cw = 380, ch = 244;
    const x = Math.round((W - cw) / 2), y = Math.round((H - ch) / 2) + 4;
    panel(x, y, cw, ch, { r: 2, fill: 'rgba(12,14,18,0.96)', topLine: 'rgba(255,255,255,0.10)' });
    tag(g.headline, W / 2, y + 30, 5, C.accent, 19, 2);
    let ty = y + 68;
    if (g.medalText) { tag(g.medalText, W / 2, ty, 5, C.white, 14, 1.4); ty += 26; }
    text(D.lang[32] + ' ' + R3D.fmtTime(g.time), W / 2, ty, 5, C.white, 19, '700', 0, true); ty += 26;
    if (g.bestText) { tag(g.bestText, W / 2, ty, 5, C.faint, 12, 1.2); ty += 22; }
    (g.toasts || []).forEach((t) => {
      tag(t, W / 2, ty, 5, C.accent2, 13, 1.2);
      ty += 20;
    });
    bigButton('cont', W / 2 - 90, y + ch - 54, 180, 42, D.lang[94], () => this.leave(), {
      center: true, size: 15, fill: 'rgba(255,196,0,0.15)', border: C.accent,
    });
  },
};

R3D.STAT_TOP = [60, 68, 75, 80];
R3D.STAT_ACC = [20, 60, 90, 80];
R3D.STAT_GRIP = [40, 80, 80, 90];
R3D.titleScene = titleScene;
R3D.resultsScene = resultsScene;
R3D.trackSelectScene = trackSelectScene;
R3D.carSelectSceneRef = carSelectScene;
R3D.newGameScene = newGameScene;
R3D.settingsScene = settingsScene;
R3D.instructionsScene = instructionsScene;
R3D.hiScoreScene = hiScoreScene;

// ==================================================================== BOOT
R3D.game = { mode: 'champ', trackIdx: 0, carIdx: 0, raceIdx: 0, results: null };

R3D.start = async function () {
  await R3D.loadAll();
  const img = (f) => new Promise((res) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = () => res(i);
    i.src = 'assets/img/' + f;
  });
  R3D._posterImg = await img('title.png');
  R3D._logoImg = await img('title_text.png');
  R3D._cupImgs = [await img('cup3.png'), await img('cup2.png'), await img('cup1.png')];
  R3D.setScene(titleScene);
  R3D._loop();
};

})();
