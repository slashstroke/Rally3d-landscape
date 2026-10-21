/* Rally 3D — LANDSCAPE edition
   scenes.js — the menus: title / new game / track grid / car showroom /
   high scores / settings / instructions / results.

   Rally broadcast style (see main.js): slanted panels, chrome italic
   headlines, amber for the selection, rally blue for everything else.
   Every screen eases in item by item, and Esc / Backspace / gamepad B goes
   back from every screen. */
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
      measure = R3D.measure, wasPressed = R3D.wasPressed, AudioSys = R3D.audio,
      tapArea = R3D.tapArea, textMid = R3D.textMid, tagMid = R3D.tagMid,
      chrome = R3D.chromeText;

// ------------------------------------------------------------------ layout
const PAD = 22;
const HEAD_Y = 12;
const COL_X = 356, COL_W = 262;  // right-hand menu column
const STAIR = 10;                // menu rows step left along the slant

const SEASONS = {
  summer: ['Summer', '#5ccf6a'], desert: ['Desert', '#e8a74a'],
  winter: ['Winter', '#9fd8ff'], night: ['Night', '#8f8cff'],
};
const MEDAL_COLORS = ['#ffc400', '#dfe6f0', '#cd7f45'];
const season = (i) => SEASONS[D.tracks[i].theme] || SEASONS.summer;

// ------------------------------------------------------------------ helpers
// Draw `fn` faded and slid in as entrance item `i` of the current screen.
function anim(i, dx, dy, fn) {
  const k = R3D.intro(i + 3, 0.04);
  if (k <= 0.001) return;
  ui.save();
  ui.globalAlpha *= k;
  ui.translate((1 - k) * dx, (1 - k) * dy);
  fn(k);
  ui.restore();
}

function wrap(str, size, weight, maxW) {
  const words = String(str).split(' ');
  const lines = [];
  let line = '';
  for (const w of words) {
    const t = line ? line + ' ' + w : w;
    if (line && measure(t, size, weight) > maxW) { lines.push(line); line = w; }
    else line = t;
  }
  if (line) lines.push(line);
  return lines;
}

function paragraph(str, x, y, maxW, size, color, lineH, weight) {
  const lines = wrap(str, size, weight || '500', maxW);
  lines.forEach((l, i) => text(l, x, y + i * lineH, 0, color, size, weight || '500'));
  return lines.length * lineH;
}

// press feedback for plates that are not menu rows
function flashOverlay(id, x, y, w, h) {
  const fl = R3D.flashFor(id);
  if (fl > 0) {
    ui.save();
    ui.globalAlpha *= fl * 0.45;
    R3D.slantPath(x, y, w, h, R3D.slantOf(h));
    ui.fillStyle = '#ffffff';
    ui.fill();
    ui.restore();
  }
}

// chrome screen title, optional back chip, right-hand note, livery rule
function header(title, onBack, right) {
  anim(0, 0, -8, () => {
    let tx = PAD;
    if (onBack) {
      const bx = PAD, by = HEAD_Y, bw = 38, bh = 30;
      plate(bx, by, bw, bh);
      R3D.iconChevron(bx + bw / 2, by + bh / 2, 13, 3, C.white, 2.5);
      flashOverlay('back', bx, by, bw, bh);
      tapArea('back', bx - 4, by - 4, bw + 8, bh + 8, onBack);
      tx = PAD + bw + 14;
    }
    chrome(title, tx, HEAD_Y + 15, 0, 20, { mid: true, spacing: 2 });
    if (right) tagMid(right, W - PAD, HEAD_Y + 15, 8, C.accent, 11, 1.6);
    const ly = HEAD_Y + 36;
    ui.fillStyle = C.accent;
    ui.fillRect(tx, ly, 28, 2);
    ui.fillStyle = 'rgba(120,170,255,0.3)';
    ui.fillRect(tx + 34, ly, W - PAD - tx - 34, 1);
  });
}

// a column of menu rows; o.stair steps each row left along the slant
function menuColumn(prefix, items, sel, onPick, o) {
  o = o || {};
  const x = o.x === undefined ? COL_X : o.x;
  const w = o.w === undefined ? COL_W : o.w;
  const h = o.h || 44, gap = o.gap === undefined ? 10 : o.gap;
  const stair = o.stair || 0;
  const n = items.length;
  const total = n * h + (n - 1) * gap;
  let y = o.y === undefined ? Math.round((H - total) / 2) + 10 : o.y;
  items.forEach((it, i) => {
    const ry = y, rx = x + (n - 1 - i) * stair;
    anim(i + (o.base || 1), 18, 0, () => {
      R3D.menuRow(prefix + i, rx, ry, w, h, it.label, Object.assign({}, it, {
        active: sel === i,
        size: it.size || o.size || 14,
        onTap: it.disabled && !it.tapDisabled ? null : () => onPick(i),
      }));
    });
    y += h + gap;
  });
}

function navList(scene, n) {
  if (wasPressed('DOWN')) scene.sel = (scene.sel + 1) % n;
  if (wasPressed('UP')) scene.sel = (scene.sel + n - 1) % n;
}

// the poster with its right and bottom edges faded out (made once)
let _poster = null;
function posterMasked() {
  const img = R3D._posterImg;
  if (!img || !img.width) return null;
  if (_poster) return _poster;
  const c = document.createElement('canvas');
  c.width = img.width; c.height = img.height;
  const g = c.getContext('2d');
  g.drawImage(img, 0, 0);
  g.globalCompositeOperation = 'destination-in';
  const gr = g.createLinearGradient(c.width * 0.5, 0, c.width, c.height * 0.12);
  gr.addColorStop(0, 'rgba(0,0,0,1)');
  gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, c.width, c.height);
  const gb = g.createLinearGradient(0, c.height * 0.78, 0, c.height);
  gb.addColorStop(0, 'rgba(0,0,0,1)');
  gb.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gb;
  g.fillRect(0, 0, c.width, c.height);
  _poster = c;
  return c;
}

function logo(x, y, w) {
  const img = R3D._logoImg;
  if (!img || !img.width) { chrome('Rally 3D', x, y, 0, 34); return 40; }
  const h = w * img.height / img.width;
  ui.drawImage(img, x, y, w, h);
  return h;
}

function cup(medal, x, y) {
  const img = R3D._cupImgs && R3D._cupImgs[medal];
  if (img && img.width) ui.drawImage(img, x, y);
}

// a full-height slanted livery stripe
function liveryStripe(x, w, color) {
  const d = H * 0.22;
  ui.fillStyle = color;
  ui.beginPath();
  ui.moveTo(x, 0); ui.lineTo(x + w, 0); ui.lineTo(x + w - d, H); ui.lineTo(x - d, H);
  ui.closePath();
  ui.fill();
}

// slanted segment bar (stats, progress)
function segBar(x, y, n, f, color, w) {
  const step = w / n, sw = Math.max(2, step - 3);
  const lit = Math.round(Math.max(0, Math.min(1, f)) * n);
  for (let i = 0; i < n; i++) {
    const sx = x + i * step;
    ui.fillStyle = i < lit ? color : 'rgba(255,255,255,0.12)';
    ui.beginPath();
    ui.moveTo(sx + 2, y); ui.lineTo(sx + sw + 2, y); ui.lineTo(sx + sw, y + 8); ui.lineTo(sx, y + 8);
    ui.closePath();
    ui.fill();
  }
}

function modeName(m) {
  return m === 'champ' ? D.lang[17] : (m === 'mp' ? 'Multiplayer' : D.lang[71]);
}

function tracksOpen() { return S().medals.filter((m) => m < 4).length; }
function medalCounts() {
  const c = [0, 0, 0];
  for (const m of S().medals) if (m <= 2) c[m]++;
  return c;
}

// what it takes to unlock car c, and how far along the player is
function carRequirement(c) {
  const need = [0, 4, 8, 12][c], req = [0, 2, 1, 0][c];
  const sv = S();
  let got = 0;
  for (let k = 0; k < need; k++) if (sv.medals[k] <= req) got++;
  const textReq = c === 3 ? 'Gold on all 12 tracks'
    : (c === 2 ? 'Silver or better on the first 8 tracks'
      : 'Bronze or better on the first 4 tracks');
  return { text: textReq, got, need };
}

// ==================================================================== TITLE
const titleScene = {
  sel: 0, menuMusic: true,
  // the menu music is started (and kept going) by the scene loop
  enter() { this.sel = 0; },
  items() {
    const c = Math.min(12, S().champ);
    return [
      { label: D.lang[101], right: c >= 12 ? 'Champion' : 'Race ' + (c + 1) + '/12' },
      { label: D.lang[97] },
      { label: D.lang[107] },
      { label: D.lang[99] },
    ];
  },
  pick(i) {
    if (i === 0) R3D.setScene(newGameScene);
    else if (i === 1) R3D.setScene(hiScoreScene);
    else if (i === 2) R3D.setScene(settingsScene);
    else R3D.setScene(instructionsScene);
  },
  update() {
    navList(this, this.items().length);
    if (wasPressed('OK')) this.pick(this.sel);
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    anim(0, -24, 0, () => {
      const p = posterMasked();
      if (p) ui.drawImage(p, 0, 0, 280, H);
    });
    anim(1, 0, -24, () => {
      liveryStripe(300, 4, C.accent);
      liveryStripe(311, 2, C.blueHi);
    });
    anim(2, 0, -10, () => {
      const lh = logo(18, 20, 236);
      const cy = 20 + lh + 4;
      plate(14, cy, 180, 24, { fill: 'rgba(7,18,38,0.82)', edge: C.accent });
      tagMid('Landscape edition', 30, cy + 12, 0, C.accent, 12, 2);
    });
    menuColumn('m', this.items(), this.sel, (i) => { this.sel = i; this.pick(i); }, {
      x: 318, w: 270, h: 48, gap: 10, base: 3, size: 16, stair: STAIR,
    });
    if (R3D.canFullscreen) {
      anim(8, 0, 6, () => {
        const fs = document.fullscreenElement || document.webkitFullscreenElement;
        const bw = 136, bh = 26, bx = W - PAD - bw, by = H - bh - 16;
        plate(bx, by, bw, bh, { fill: 'rgba(7,18,38,0.72)' });
        tagMid(fs ? 'Exit full screen' : 'Full screen', bx + bw / 2 + 2, by + bh / 2, 5, C.dim, 10, 1.4);
        flashOverlay('fs', bx, by, bw, bh);
        tapArea('fs', bx, by, bw, bh, () => R3D.toggleFullscreen());
      });
    }
  },
};

// ==================================================================== NEW GAME
const MODES = ['champ', 'tt', 'mp'];
const MODE_DESC = {
  champ: 'Race the twelve tracks in order. A medal on a track unlocks the next one and moves the championship on.',
  tt: 'Race against the clock on any track you have unlocked. Beat the medal times to climb the leaderboard.',
  mp: 'Race side by side against a computer driver in a different car. Beat it to the line.',
};
const newGameScene = {
  sel: 0, menuMusic: true, pickT: 0,
  enter() {
    const i = MODES.indexOf(R3D.game.mode);
    this.sel = i < 0 ? 0 : i;
    this.pickT = R3D.clock;
  },
  items() {
    const c = S().champ;
    return [
      { label: D.lang[17], sub: c >= 12 ? 'Championship won' : 'Next: race ' + (c + 1) + ' of 12' },
      { label: D.lang[71], sub: 'Beat the clock' },
      { label: 'Multiplayer', sub: '1 computer opponent' },
    ];
  },
  pick(i) {
    R3D.game.mode = MODES[i];
    R3D.setScene(trackSelectScene);
  },
  back() { R3D.setScene(titleScene); },
  update() {
    const before = this.sel;
    navList(this, 3);
    if (this.sel !== before) this.pickT = R3D.clock;
    if (wasPressed('OK')) this.pick(this.sel);
    else if (wasPressed('BACK')) this.back();
  },
  // the bottom of the mode card: what this mode looks like for you right now
  drawDetail(m, x, y, w) {
    ui.fillStyle = 'rgba(120,170,255,0.2)';
    ui.fillRect(x, y - 12, w, 1);
    if (m === 'champ') {
      const c = Math.min(12, S().champ);
      tag('Progress', x, y, 0, C.faint, 10, 1.4);
      tag(c >= 12 ? 'Champion' : 'Race ' + (c + 1) + ' of 12', x + w, y, 8, C.accent, 11, 1.2);
      segBar(x, y + 24, 12, c / 12, C.accent, w);
    } else if (m === 'tt') {
      const cnt = medalCounts();
      tag('Medals won', x, y, 0, C.faint, 10, 1.4);
      tag(tracksOpen() + '/12 tracks open', x + w, y, 8, C.accent2, 11, 1.2);
      for (let i = 0; i < 3; i++) {
        const mx = x + i * 76;
        cup(i, mx, y + 20);
        textMid('× ' + cnt[i], mx + 26, y + 30, 0, C.white, 15, '800', 0, true);
      }
    } else {
      tag('Opponent', x, y, 0, C.faint, 10, 1.4);
      tag(tracksOpen() + '/12 tracks open', x + w, y, 8, C.accent2, 11, 1.2);
      text('A computer driver in the next car up.', x, y + 24, 0, C.dim, 12, '500');
    }
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    header(D.lang[100], () => this.back());
    const m = MODES[this.sel];
    anim(1, -16, 0, () => {
      const cx = PAD, cy = 66, cw = 304, chh = 274;
      plate(cx, cy, cw, chh, { fill: 'rgba(7,18,38,0.84)', edge: C.accent, edgeW: 5 });
      // the card's content re-deals when the selection changes
      const k = Math.min(1, (R3D.clock - this.pickT) / 0.22);
      const e = 1 - Math.pow(1 - k, 3);
      ui.save();
      ui.globalAlpha *= e;
      ui.translate((1 - e) * 12, 0);
      tag('Mode', cx + 30, cy + 16, 0, C.faint, 10, 1.6);
      chrome(modeName(m), cx + 28, cy + 30, 0, 24, { spacing: 1 });
      paragraph(MODE_DESC[m], cx + 26, cy + 70, cw - 52, 13, C.dim, 19);
      this.drawDetail(m, cx + 24, cy + chh - 70, cw - 52);
      ui.restore();
    });
    menuColumn('m', this.items(), this.sel, (i) => { this.sel = i; this.pick(i); }, {
      x: 350, w: 250, h: 56, gap: 10, base: 2, size: 15, stair: STAIR,
    });
  },
};

// ==================================================================== TRACK SELECT
const trackSelectScene = {
  sel: 0, menuMusic: true,
  enter() {
    const sv = S();
    if (R3D.game.mode === 'champ' && sv.champ < 12 && sv.medals[sv.champ] < 4) this.sel = sv.champ;
    else this.sel = R3D.game.trackIdx || 0;
  },
  pick(i) {
    if (S().medals[i] >= 4) {
      R3D.toast('Win a medal on ' + D.tracks[i - 1].name + ' to unlock', 2200, 'lock');
      return;
    }
    R3D.game.trackIdx = i;
    R3D.setScene(carSelectScene);
  },
  back() { R3D.setScene(newGameScene); },
  update() {
    const s = this.sel;
    if (wasPressed('LEFT')) this.sel = s % 4 === 0 ? s + 3 : s - 1;
    if (wasPressed('RIGHT')) this.sel = s % 4 === 3 ? s - 3 : s + 1;
    if (wasPressed('UP')) this.sel = (s + 8) % 12;
    if (wasPressed('DOWN')) this.sel = (s + 4) % 12;
    if (wasPressed('OK')) this.pick(this.sel);
    else if (wasPressed('BACK')) this.back();
  },
  draw() {
    R3D.drawBackground(D.tracks[this.sel].theme);
    const sv = S();
    const champ = R3D.game.mode === 'champ';
    header(D.lang[58], () => this.back(), modeName(R3D.game.mode));
    const cols = 4, cw = 142, ch = 76, gx = 12, gy = 10;
    const gridW = cols * cw + (cols - 1) * gx;
    const x0 = Math.round((W - gridW) / 2), y0 = 64;
    for (let i = 0; i < 12; i++) {
      const cx = x0 + (i % cols) * (cw + gx);
      const cy = y0 + Math.floor(i / cols) * (ch + gy);
      const locked = sv.medals[i] >= 4;
      const active = i === this.sel;
      const sea = season(i);
      anim(1 + i * 0.6, 0, 10, () => {
        plate(cx, cy, cw, ch, {
          fill: active ? R3D.vgrad(cy, ch, 'rgba(255,196,0,0.30)', 'rgba(110,70,0,0.34)')
            : (locked ? 'rgba(6,12,26,0.72)' : null),
          borderColor: active ? C.accent : undefined,
          lw: active ? 2 : 1,
          edge: active ? C.accent : (locked ? 'rgba(255,255,255,0.15)' : sea[1]),
          edgeW: active ? 5 : 3,
        });
        tag(String(i + 1).padStart(2, '0'), cx + 20, cy + 9, 0, active ? C.accent : C.faint, 10, 1.6);
        tag(sea[0], cx + cw - 12, cy + 9, 8, locked ? C.faint : C.dim, 9, 1);
        const nm = D.tracks[i].name;
        const fs = measure(nm, 16, '700') > cw - 30 ? 14 : 16;
        text(nm, cx + 16, cy + 28, 0, locked ? C.faint : C.white, fs, '700', 0, true);
        if (locked) {
          R3D.lockIcon(cx + cw - 24, cy + ch - 18);
          tag('Locked', cx + 12, cy + ch - 20, 0, C.faint, 10, 1);
        } else {
          tag('Best ' + R3D.fmtTime(sv.scores[i][0]), cx + 12, cy + ch - 20, 0, C.dim, 10, 0.8);
          if (champ && i === sv.champ) {
            const bw = 44, bx = cx + cw - bw - 12, by = cy + ch - 26;
            plate(bx, by, bw, 18, { fill: C.accent, border: false, bevel: false });
            tagMid('Next', bx + bw / 2 + 1, by + 9, 5, C.ink, 9, 1.2);
          } else if (sv.medals[i] <= 2) {
            cup(sv.medals[i], cx + cw - 36, cy + ch - 30);
          }
        }
        flashOverlay('t' + i, cx, cy, cw, ch);
      });
      tapArea('t' + i, cx, cy, cw, ch, () => { this.sel = i; this.pick(i); });
    }
  },
};

// ==================================================================== CAR SELECT
// A showroom: the car turns on a lit turntable on the left, arrows either side
// step through the cars (the new one slides in from that side), tabs below pick
// one directly, and the spec card on the right shows its numbers.
const SHOW_W = 400;      // 3D viewport width
const TABLE_Y = 232;     // turntable height: under the wheels
const CAR_UNLOCK = ['', 'Bronze on tracks 1–4', 'Silver on tracks 1–8', 'Gold on all 12 tracks'];

const carSelectScene = {
  sel: 0, yaw: 0, v: 32, slide: 0, spinVel: 250, menuMusic: true,
  confirmT: 0, leaving: false, bars: [0, 0, 0], pickT: 0,
  enter() {
    this.sel = R3D.game.carIdx || 0;
    if (S().cars[this.sel] !== 0) this.sel = 0;
    this.yaw = 0; this.v = 32; this.slide = 0; this.spinVel = 250;
    this.confirmT = 0; this.leaving = false;
    this.bars = [0, 0, 0];
    this.pickT = R3D.clock;
    camera.position.set(0, 0, 0);
    camera.rotation.set(0, 0, 0);
    camera.aspect = SHOW_W / H;
    camera.updateProjectionMatrix();
    const sc = new THREE.Scene();
    this.holder = new THREE.Group();
    this.tilt = new THREE.Group();
    this.tilt.rotation.x = 32 * Math.PI / 180;
    this.holder.add(this.tilt);
    sc.add(this.holder);
    this.car = null;
    R3D.scene3d = sc;
    this.swap();
  },
  place() { this.holder.position.set(this.slide, 0, -8 - this.v); },
  // swap the model on the turntable, freeing the old one
  swap() {
    if (this.car) {
      this.tilt.remove(this.car);
      R3D.disposeObject(this.car);
    }
    this.car = R3D.buildCar(this.sel);
    this.car.rotation.y = this.yaw * Math.PI / 180;
    this.tilt.add(this.car);
    this.place();
  },
  choose(i, dir) {
    if (i === this.sel || this.confirmT > 0 || this.leaving) return;
    if (dir === undefined) dir = i > this.sel ? 1 : -1;
    this.sel = i;
    this.slide = dir * 3;
    this.v = Math.max(this.v, 6);
    this.pickT = R3D.clock;
    this.swap();
  },
  step(d) { this.choose((this.sel + d + 4) % 4, d); },
  start() {
    if (this.confirmT > 0 || this.leaving) return;
    if (S().cars[this.sel] !== 0) {
      R3D.toast(CAR_UNLOCK[this.sel] + ' to unlock', 2200, 'lock');
      return;
    }
    R3D.game.carIdx = this.sel;
    AudioSys.sfx('plink1');
    this.confirmT = 0.5;
  },
  back() {
    if (this.confirmT > 0 || this.leaving) return;
    this.leaving = true;
    R3D.setScene(trackSelectScene);
  },
  update(dt) {
    if (!this.car) return;
    const target = [R3D.STAT_TOP, R3D.STAT_ACC, R3D.STAT_GRIP].map((s) => s[this.sel] / 100);
    for (let i = 0; i < 3; i++) this.bars[i] += (target[i] - this.bars[i]) * Math.min(1, dt * 9);
    this.slide *= Math.exp(-dt * 9);
    if (Math.abs(this.slide) < 0.01) this.slide = 0;

    if (this.confirmT > 0) {
      this.confirmT -= dt;
      this.v = Math.min(16, this.v + dt * 30);
      this.spinVel += (250 - this.spinVel) * Math.min(1, dt * 1.4);
      this.yaw += this.spinVel * dt;
      this.car.rotation.y = this.yaw * Math.PI / 180;
      this.place();
      if (this.confirmT <= 0 && !this.leaving) {
        this.leaving = true;
        R3D.setScene(R3D.raceScene);
      }
      return;
    }
    if (this.v > 0) this.v = Math.max(0, this.v - dt * 28);
    this.place();
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
    if (this.leaving) return;
    if (wasPressed('RIGHT') || wasPressed('DOWN')) this.step(1);
    if (wasPressed('LEFT') || wasPressed('UP')) this.step(-1);
    if (wasPressed('OK')) this.start();
    else if (wasPressed('BACK')) this.back();
  },
  // a glowing turntable under the car, its ticks turning with it
  drawTurntable() {
    ui.save();
    ui.translate(SHOW_W / 2, TABLE_Y);
    ui.scale(1, 0.26);
    const g = ui.createRadialGradient(0, 0, 10, 0, 0, 185);
    g.addColorStop(0, 'rgba(76,149,255,0.38)');
    g.addColorStop(1, 'rgba(76,149,255,0)');
    ui.fillStyle = g;
    ui.beginPath(); ui.arc(0, 0, 185, 0, Math.PI * 2); ui.fill();
    ui.strokeStyle = 'rgba(140,190,255,0.5)';
    ui.lineWidth = 2;
    ui.beginPath(); ui.arc(0, 0, 160, 0, Math.PI * 2); ui.stroke();
    ui.strokeStyle = 'rgba(140,190,255,0.22)';
    ui.beginPath(); ui.arc(0, 0, 126, 0, Math.PI * 2); ui.stroke();
    ui.strokeStyle = 'rgba(255,196,0,0.65)';
    ui.lineWidth = 3;
    const rot = this.yaw * Math.PI / 180;
    for (let i = 0; i < 24; i++) {
      const a = rot + i * Math.PI / 12;
      ui.beginPath();
      ui.moveTo(Math.cos(a) * 150, Math.sin(a) * 150);
      ui.lineTo(Math.cos(a) * 160, Math.sin(a) * 160);
      ui.stroke();
    }
    ui.restore();
  },
  draw() {
    const sv = S();
    R3D.drawBackground(D.tracks[R3D.game.trackIdx].theme);
    this.drawTurntable();
    if (R3D.scene3d) {
      renderer.setViewport(0, 0, SHOW_W, H);
      renderer.render(R3D.scene3d, camera);
      renderer.setViewport(0, 0, W, H);
      ui.drawImage(R3D._gl, 0, 0, W, H);
    }
    R3D.dragArea('car', 60, 56, SHOW_W - 120, 224);

    header(D.lang[57], () => this.back(), D.tracks[R3D.game.trackIdx].name);
    const locked = sv.cars[this.sel] === 1;

    // arrows either side of the car
    anim(1, 0, 0, () => {
      for (const [d, x] of [[-1, 18], [1, SHOW_W - 18 - 34]]) {
        const y = 138, w = 34, h = 44, id = d < 0 ? 'cprev' : 'cnext';
        plate(x, y, w, h, { fill: 'rgba(7,18,38,0.6)' });
        R3D.iconChevron(x + w / 2, y + h / 2, 14, d < 0 ? 3 : 1, C.white, 2.5);
        flashOverlay(id, x, y, w, h);
        tapArea(id, x - 8, y - 12, w + 16, h + 24, () => this.step(d));
      }
    });

    // car tabs
    const tw = 88, th = 48, tg = 6, ty = 294;
    D.cars.forEach((c, i) => {
      const tx = 18 + i * (tw + tg);
      anim(2 + i * 0.5, 0, 10, () => {
        const on = i === this.sel, lk = sv.cars[i] === 1;
        plate(tx, ty, tw, th, {
          fill: on ? R3D.vgrad(ty, th, C.accentHi, C.accentLo) : (lk ? 'rgba(6,12,26,0.72)' : null),
          borderColor: on ? 'rgba(255,236,170,0.9)' : undefined,
          topLine: on ? 'rgba(255,255,255,0.6)' : undefined,
        });
        const fg = on ? C.ink : (lk ? C.faint : C.white);
        tag(String(i + 1).padStart(2, '0'), tx + 16, ty + 7, 0, on ? C.ink : C.faint, 9, 1.2);
        if (lk) R3D.lockIcon(tx + tw - 20, ty + 12, on ? C.ink : undefined);
        const words = c.name.split(' ');
        tagMid(words[0], tx + 12, ty + 25, 0, fg, 11, 0.6);
        if (words.length > 1) tagMid(words.slice(1).join(' '), tx + 10, ty + 37, 0, fg, 11, 0.6);
        flashOverlay('ct' + i, tx, ty, tw, th);
      });
      tapArea('ct' + i, tx, ty, tw, th, () => this.choose(i));
    });

    // spec card
    anim(3, 18, 0, (k) => {
      const x = 410, y = 60, w = 208, h = locked ? 222 : 176;
      plate(x, y, w, h, {
        fill: 'rgba(7,18,38,0.86)',
        edge: locked ? 'rgba(255,255,255,0.25)' : C.accent, edgeW: 5,
      });
      const pk = Math.min(1, (R3D.clock - this.pickT) / 0.22), pe = 1 - Math.pow(1 - pk, 3);
      ui.save();
      ui.globalAlpha *= pe;
      ui.translate((1 - pe) * 10, 0);
      tag('Car ' + (this.sel + 1) + ' / 4', x + 24, y + 12, 0, C.faint, 9, 1.4);
      if (locked) tagMid('Locked', x + w - 14, y + 16, 8, C.accent, 10, 1.4);
      chrome(D.cars[this.sel].name, x + 22, y + 36, 0, 20, { mid: true, spacing: 1 });
      ui.restore();
      ui.fillStyle = 'rgba(120,170,255,0.2)';
      ui.fillRect(x + 16, y + 54, w - 30, 1);
      const stats = [[D.lang[65], R3D.STAT_TOP], [D.lang[4], R3D.STAT_ACC], [D.lang[30], R3D.STAT_GRIP]];
      stats.forEach(([label, arr], i) => {
        const ry = y + 70 + i * 36;
        tagMid(label.replace(':', ''), x + 18, ry, 0, C.dim, 10, 1.2);
        textMid(String(arr[this.sel]), x + w - 18, ry, 8, locked ? C.dim : C.white, 15, '800', 0, true);
        segBar(x + 16, ry + 10, 14, this.bars[i] * k, locked ? 'rgba(98,176,255,0.45)' : C.blueHi, w - 40);
      });
      if (locked) {
        const r = carRequirement(this.sel);
        const fy = y + 176;
        ui.fillStyle = 'rgba(120,170,255,0.2)';
        ui.fillRect(x + 12, fy - 6, w - 26, 1);
        R3D.lockIcon(x + 20, fy + 10, C.accent);
        text(CAR_UNLOCK[this.sel], x + 32, fy + 4, 0, C.white, 12, '600');
        segBar(x + 14, fy + 26, r.need, r.got / r.need, C.accent, w - 64);
        tagMid(r.got + '/' + r.need, x + w - 16, fy + 30, 8, C.accent, 11, 1);
      }
    });

    // race button
    anim(4, 18, 0, () => {
      const bx = 410, by = 290, bw = 208, bh = 52;
      R3D.menuRow('race', bx, by, bw, bh, locked ? 'Locked' : 'Race', {
        primary: !locked, disabled: locked, center: true, size: locked ? 13 : 20,
        onTap: () => this.start(),
      });
      if (!locked) {
        R3D.iconChevron(bx + bw - 36, by + bh / 2, 12, 1, 'rgba(255,255,255,0.85)', 2.5);
        R3D.iconChevron(bx + bw - 28, by + bh / 2, 12, 1, 'rgba(255,255,255,0.55)', 2.5);
      }
    });
  },
};
// ==================================================================== HIGH SCORES
const hiScoreScene = {
  sel: 0, menuMusic: true,
  enter() {
    this.sel = R3D.game.trackIdx || 0;
    this.pickT = R3D.clock;
  },
  setSel(i) {
    if (i === this.sel) return;
    this.sel = i;
    this.pickT = R3D.clock;
  },
  back() { R3D.setScene(titleScene); },
  update() {
    const s = this.sel;
    if (wasPressed('RIGHT')) this.setSel(s % 2 === 0 ? s + 1 : s - 1);
    if (wasPressed('LEFT')) this.setSel(s % 2 === 1 ? s - 1 : s + 1);
    if (wasPressed('DOWN')) this.setSel((s + 2) % 12);
    if (wasPressed('UP')) this.setSel((s + 10) % 12);
    if (wasPressed('OK') || wasPressed('BACK')) this.back();
  },
  draw() {
    R3D.drawBackground(D.tracks[this.sel].theme);
    header(D.lang[96], () => this.back());
    const sv = S();
    const sea = season(this.sel);
    anim(1, -16, 0, () => {
      const px = PAD, py = 62, pw = 314, ph = 280;
      plate(px, py, pw, ph, { fill: 'rgba(7,18,38,0.84)', edge: sea[1], edgeW: 5 });
      chrome(D.tracks[this.sel].name, px + 26, py + 22, 0, 20, { mid: true, spacing: 1 });
      tag(sea[0] + '  ·  Track ' + String(this.sel + 1).padStart(2, '0'), px + 26, py + 40, 0, C.dim, 10, 1.2);
      const m = sv.medals[this.sel];
      if (m <= 2) cup(m, px + pw - 40, py + 14);
      // the rows re-deal whenever another track is picked
      for (let i = 0; i < 5; i++) {
        const ry = py + 70 + i * 40;
        const k = Math.max(0, Math.min(1, (R3D.clock - this.pickT - i * 0.03) / 0.2));
        ui.save();
        ui.globalAlpha *= k;
        ui.translate((1 - k) * 10, 0);
        plate(px + 20, ry + 8, 28, 22, {
          slant: 5, border: false,
          fill: i < 3 ? MEDAL_COLORS[i] : 'rgba(255,255,255,0.14)',
          topLine: 'rgba(255,255,255,0.6)',
        });
        textMid(String(i + 1), px + 34, ry + 19, 5, i < 3 ? C.ink : C.white, 13, '800');
        textMid(sv.names[this.sel][i].substring(0, 14), px + 62, ry + 19, 0, C.white, 15, '700', 0, true);
        textMid(R3D.fmtTime(sv.scores[this.sel][i]), px + pw - 24, ry + 19, 8,
          i === 0 ? C.accent : C.white, 16, '800', 0, true);
        ui.restore();
        if (i < 4) {
          ui.fillStyle = 'rgba(120,170,255,0.12)';
          ui.fillRect(px + 20, ry + 38, pw - 44, 1);
        }
      }
    });
    const x0 = 352, cw = 132, ch = 32, gx = 8, gy = 8;
    for (let i = 0; i < 12; i++) {
      const cx = x0 + (i % 2) * (cw + gx);
      const cy = 62 + Math.floor(i / 2) * (ch + gy);
      const active = i === this.sel;
      anim(2 + i * 0.4, 14, 0, () => {
        plate(cx, cy, cw, ch, {
          fill: active ? R3D.vgrad(cy, ch, C.accentHi, C.accentLo) : null,
          borderColor: active ? 'rgba(255,236,170,0.9)' : undefined,
          edge: active ? null : season(i)[1], edgeW: 3,
        });
        const nm = D.tracks[i].name;
        const fs = measure(nm, 13, '700') > cw - 44 ? 11 : 13;
        textMid(nm, cx + 14, cy + ch / 2, 0, active ? C.ink : C.dim, fs, '700', 0, true);
        const m = sv.medals[i];
        if (m <= 2) cup(m, cx + cw - 30, cy + 7);
        else if (m >= 4) R3D.lockIcon(cx + cw - 20, cy + ch / 2, active ? C.ink : undefined);
        flashOverlay('hs' + i, cx, cy, cw, ch);
      });
      tapArea('hs' + i, cx, cy, cw, ch, () => this.setSel(i));
    }
  },
};

// ==================================================================== SETTINGS
const settingsScene = {
  sel: 0, page: 0, menuMusic: true, confirmUntil: 0,
  enter() { this.sel = 0; this.page = 0; this.confirmUntil = 0; },
  items() {
    const st = S().settings;
    const confirming = R3D.clock < this.confirmUntil;
    return [
      { label: 'Sound', right: ['Off', 'Low', 'Loud'][st.sound],
        desc: 'How loud the music and the effects are.' },
      { label: 'Speed units', right: st.units === 1 ? 'Mph' : 'Km/h',
        desc: 'Show your speed in kilometres or miles per hour.' },
      { label: 'Auto accelerate', toggle: st.auto === 1,
        desc: 'The car accelerates by itself, so you only steer and brake.' },
      R3D.tilt.supported
        ? { label: 'Tilt steering', toggle: st.tilt === 1,
          desc: 'Steer by tilting the phone. Hold it the way you want to drive when you turn this on: that position becomes straight ahead.' }
        : { label: 'Tilt steering', right: 'n/a', disabled: true, tapDisabled: true,
          desc: 'This device has no tilt sensor.' },
      { label: 'Touch buttons', toggle: st.buttons !== 0,
        desc: 'Show the steering pads and the gas and brake pedals during a race.' },
      { label: 'Title song', right: st.titleSong === 1 ? 'TinySynth' : 'Classic',
        desc: 'Which synthesizer plays the menu music.' },
      { label: 'Graphics', right: '›', rightSize: 16,
        desc: 'Motion blur, lighting and shadows.' },
      { label: confirming ? (R3D.isTouch ? 'Tap again to reset' : 'Press again to reset') : D.lang[52],
        danger: true, active: confirming,
        desc: 'Clears every record, medal, unlocked track and unlocked car, and puts every setting back to its default.' },
    ];
  },
  gfxItems() {
    const st = S().settings;
    return [
      { label: 'Motion blur', toggle: st.motionBlur !== 0,
        desc: 'Smears the edges of the screen when you pick up speed.' },
      { label: 'Lighting', toggle: st.lighting !== 0,
        desc: 'Puts a sun on the hills and the car. Turn it off for the flat look of the original.' },
      { label: 'Shadows', toggle: st.shadows !== 0, disabled: st.lighting === 0,
        desc: st.lighting === 0 ? 'Shadows need lighting turned on.' : 'The car drops a real shadow onto the road. Turn off on slower phones.' },
      { label: D.lang[92], center: true, desc: 'Back to the settings.' },
    ];
  },
  setPage(p, sel) {
    this.page = p;
    this.sel = sel;
    this.confirmUntil = 0;
    R3D.restartIntro();
  },
  back() {
    if (this.page === 1) this.setPage(0, 6);
    else R3D.setScene(titleScene);
  },
  pick(i) {
    const st = S().settings;
    if (this.page === 1) {
      if (i === 0) st.motionBlur = st.motionBlur === 0 ? 1 : 0;
      else if (i === 1) st.lighting = st.lighting === 0 ? 1 : 0;
      else if (i === 2) { if (st.lighting === 0) return; st.shadows = st.shadows === 0 ? 1 : 0; }
      else { this.back(); return; }
      R3D.persist();
      return;
    }
    if (i !== 7) this.confirmUntil = 0;
    if (i === 0) {
      st.sound = (st.sound + 1) % 3;
      AudioSys.stopMusic();            // restarts at the new volume (or stays off)
    } else if (i === 1) {
      st.units = st.units === 1 ? 0 : 1;
    } else if (i === 2) {
      st.auto = st.auto === 1 ? 0 : 1;
    } else if (i === 3) {
      if (!R3D.tilt.supported) { R3D.toast('This device has no tilt sensor', 2200, 'tilt'); return; }
      if (st.tilt === 1) {
        st.tilt = 0;
        R3D.tilt.disable();
      } else {
        R3D.tilt.enable().then((ok) => {
          S().settings.tilt = ok ? 1 : 0;
          R3D.toast(ok ? 'Tilt steering on' : 'Tilt steering is not available', 2200, 'tilt');
          R3D.persist();
        });
        return;
      }
    } else if (i === 4) {
      st.buttons = st.buttons === 0 ? 1 : 0;
    } else if (i === 5) {
      st.titleSong = st.titleSong === 1 ? 0 : 1;
      AudioSys.stopMusic();
    } else if (i === 6) {
      this.setPage(1, 0);
      return;
    } else {
      // reset all: two presses within three seconds
      if (R3D.clock < this.confirmUntil) {
        this.confirmUntil = 0;
        AudioSys.stopMusic();
        R3D.saveReset();
        R3D.game.trackIdx = 0;
        R3D.game.carIdx = 0;
        R3D.toast('Progress reset', 2200, 'reset');
      } else {
        this.confirmUntil = R3D.clock + 3;
      }
      return;
    }
    R3D.persist();
  },
  update() {
    const n = this.page === 1 ? 4 : 8;
    const before = this.sel;
    navList(this, n);
    if (this.sel !== before) this.confirmUntil = 0;
    if (wasPressed('OK')) this.pick(this.sel);
    else if (wasPressed('BACK')) this.back();
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    const gfx = this.page === 1;
    const items = gfx ? this.gfxItems() : this.items();
    header(gfx ? 'Graphics' : D.lang[107], () => this.back(), gfx ? D.lang[107] : '');
    const it = items[this.sel] || items[0];
    anim(1, -16, 0, () => {
      plate(PAD, 66, 304, 160, { fill: 'rgba(7,18,38,0.84)', edge: it.danger ? C.red : C.accent, edgeW: 5 });
      tag(it.label, PAD + 28, 84, 0, it.danger ? C.red : C.accent, 12, 2);
      paragraph(it.desc, PAD + 26, 110, 256, 13, C.dim, 20);
    });
    if (!gfx && !R3D.isTouch) {
      anim(2, -16, 0, () => tag('↑ ↓ to choose   ·   Enter to change   ·   Esc to go back', PAD, H - 30, 0, C.faint, 10, 0.8));
    }
    if (gfx) {
      menuColumn('g', items, this.sel, (i) => { this.sel = i; this.pick(i); }, { y: 82, h: 40, gap: 8, base: 2 });
    } else {
      menuColumn('s', items, this.sel, (i) => { this.sel = i; this.pick(i); }, { y: 62, h: 31, gap: 5, base: 2, size: 13 });
    }
  },
};

// ==================================================================== INSTRUCTIONS
const instructionsScene = {
  page: 0, menuMusic: true, pageT: 0,
  enter() { this.page = 0; this.pageT = R3D.clock; },
  pages() {
    return [
      { title: 'Unlocking', body: this.fix(D.lang[0], 0) },
      { title: 'Keyboard', body: this.fix(D.lang[1], 1) + ' Press P or Esc to pause, and C to change the camera.' },
      { title: D.lang[71], body: D.lang[3] },
      { title: 'Touch & gamepad',
        body: 'On a phone, hold the arrow pads on the left to steer and the GAS and BRAKE pedals on the right to drive, or turn on tilt steering in the settings. The two buttons at the top left pause the race and change the camera. With a gamepad, steer with the stick or the d-pad, accelerate with A or the right trigger, brake with B or the left trigger, press X to change the camera and Start to pause.' },
    ];
  },
  // The jar's strings carry %NU placeholders: on the unlocking page they are
  // track counts, on the controls page they are key names.
  fix(str, page) {
    if (page === 0) return str.replace('%0U', '4').replace('%1U', '8');
    return str.replace('%0U', 'A').replace('%1U', 'D').replace('%2U', 'W').replace('%3U', 'S');
  },
  turn(d) {
    const n = this.pages().length;
    this.page = (this.page + d + n) % n;
    this.pageT = R3D.clock;
  },
  back() { R3D.setScene(titleScene); },
  update() {
    if (wasPressed('RIGHT') || wasPressed('DOWN')) this.turn(1);
    if (wasPressed('LEFT') || wasPressed('UP')) this.turn(-1);
    if (wasPressed('OK') || wasPressed('BACK')) this.back();
  },
  draw() {
    R3D.drawBackground(R3D.uiTheme());
    header(D.lang[99], () => this.back(), (this.page + 1) + ' / ' + this.pages().length);
    const pg = this.pages()[this.page];
    anim(1, 0, 12, () => {
      plate(PAD, 66, W - PAD * 2, 228, { fill: 'rgba(7,18,38,0.84)', edge: C.accent, edgeW: 5 });
      const k = Math.min(1, (R3D.clock - this.pageT) / 0.22);
      const e = 1 - Math.pow(1 - k, 3);
      ui.save();
      ui.globalAlpha *= e;
      ui.translate((1 - e) * 14, 0);
      chrome(pg.title, PAD + 30, 92, 0, 18, { mid: true, spacing: 1.5 });
      paragraph(pg.body, PAD + 28, 116, W - PAD * 2 - 56, 15, C.white, 24);
      ui.restore();
    });
    anim(2, 0, 8, () => {
      const n = this.pages().length;
      for (let i = 0; i < n; i++) {
        const dx = W / 2 - (n - 1) * 14 + i * 28;
        plate(dx - 10, H - 40, 20, 8, {
          slant: 3, border: false, bevel: false,
          fill: i === this.page ? C.accent : 'rgba(255,255,255,0.22)',
        });
      }
      for (const [d, x] of [[3, PAD], [1, W - PAD - 48]]) {
        plate(x, H - 52, 48, 32);
        R3D.iconChevron(x + 24, H - 36, 13, d, C.white, 2.5);
      }
    });
    tapArea('prev', 0, 60, W / 2, H - 60, () => this.turn(-1));
    tapArea('next', W / 2, 60, W / 2, H - 60, () => this.turn(1));
  },
};

// ==================================================================== RESULTS
// The finish screen. Left: the verdict, your time counting up into place, the
// gap to your old best, and what changed (place, opponent, championship,
// unlocks). Right: the track's leaderboard with your entry lit.
const resultsScene = {
  menuMusic: true, musicT: 0, sel: 1,
  enter() {
    AudioSys.stopMusic();
    this.musicT = 2.0;
    this.sel = 1;
  },
  again() { R3D.setScene(R3D.raceScene); },
  leave() { R3D.setScene(trackSelectScene); },
  update(dt) {
    if (this.musicT > 0) this.musicT -= dt;
    if (wasPressed('LEFT') || wasPressed('UP')) this.sel = 0;
    if (wasPressed('RIGHT') || wasPressed('DOWN')) this.sel = 1;
    if (wasPressed('OK')) { if (this.sel === 0) this.again(); else this.leave(); }
    else if (wasPressed('BACK')) this.leave();
  },
  draw() {
    const g = R3D.game.results || { headline: '', time: 0, unlocks: [], medal: -1, rank: 5 };
    const sv = S();
    const ti = g.trackIdx === undefined ? R3D.game.trackIdx : g.trackIdx;
    const tr = D.tracks[ti];
    R3D.drawBackground(tr.theme);
    const won = g.medal >= 0 || !!g.champion;
    const age = R3D.sceneAge();
    const ramp = (t0, len) => Math.max(0, Math.min(1, (age - t0) / len));

    // top line: mode and track, with the livery rule
    anim(0, 0, -8, () => {
      tag(modeName(R3D.game.mode) + '   ·   ' + tr.name, PAD, 16, 0, C.accent, 12, 1.6);
      ui.fillStyle = 'rgba(120,170,255,0.3)';
      ui.fillRect(PAD, 40, W - PAD * 2, 1);
      ui.fillStyle = C.accent;
      ui.fillRect(PAD, 39, 28, 2);
    });

    // the verdict, with the cup when a medal was won
    anim(1, -20, 0, () => {
      let hx = PAD;
      const img = g.medal >= 0 && R3D._cupImgs ? R3D._cupImgs[g.medal] : null;
      if (img && img.width) {
        const s = Math.max(1, Math.round(36 / img.height));
        ui.drawImage(img, PAD, 52, img.width * s, img.height * s);
        hx += img.width * s + 12;
      }
      const head = String(g.headline);
      let size = 30;
      while (size > 18 && measure(head.toUpperCase(), size, '800', 2) > 318 - hx) size -= 2;
      chrome(head, hx, 70, 0, size, { mid: true, spacing: 2, gold: won });
    });

    // your time, counting up, then the gap to your old best
    anim(2, -20, 0, () => {
      tag('Your time', PAD, 98, 0, C.dim, 10, 1.4);
      const t = ramp(0.3, 0.8);
      const shown = Math.round(g.time * (1 - Math.pow(1 - t, 3)));
      text(g.timeUp ? '-:--.-' : R3D.fmtTime(shown), PAD - 2, 108, 0, C.white, 48, '800', 0, true);
      const a = ramp(1.1, 0.2);
      if (!g.timeUp && g.prevBest > 0 && a > 0) {
        const d = g.time - g.prevBest;
        const better = d < 0;
        const str = (better ? '−' : '+') + (Math.abs(d) / 10).toFixed(1) +
          (g.record ? '   New record' : '   vs best');
        const w = measure(str.toUpperCase(), 11, '700', 1) + 40, y = 166, h = 24;
        ui.save();
        ui.globalAlpha *= a;
        ui.translate((1 - a) * 10, 0);
        plate(PAD, y, w, h, {
          fill: R3D.vgrad(y, h, better ? '#3fd47c' : '#ff5a50', better ? '#16884a' : '#b0201c'),
          borderColor: 'rgba(255,255,255,0.5)', topLine: 'rgba(255,255,255,0.6)',
        });
        tagMid(str, PAD + 18, y + h / 2, 0, C.white, 11, 1);
        ui.restore();
      }
    });

    // what changed
    const lines = [];
    if (g.sub) lines.push([g.sub, C.blueHi]);
    if (g.mpText) lines.push([g.mpText, g.mpPlace === 1 ? C.green : C.red]);
    if (g.champText) lines.push([g.champText, C.accent]);
    (g.unlocks || []).forEach((u) => lines.push([u, C.accent]));
    lines.slice(0, 4).forEach((l, i) => {
      anim(4 + i, -16, 0, () => {
        const y = 204 + i * 32;
        plate(PAD, y, 304, 26, { fill: 'rgba(7,18,38,0.84)', edge: l[1] });
        tagMid(l[0], PAD + 18, y + 13, 0, C.white, 10, 1);
      });
    });

    // the leaderboard, your entry lit
    anim(3, 20, 0, () => {
      const px = 352, py = 52, pw = 266, ph = 232;
      plate(px, py, pw, ph, { fill: 'rgba(7,18,38,0.86)', edge: C.blueHi, edgeW: 4 });
      tag('Leaderboard', px + 24, py + 12, 0, C.faint, 10, 1.6);
      for (let i = 0; i < 5; i++) {
        const ry = py + 34 + i * 38, rh = 32;
        const me = !g.timeUp && i === g.rank;
        const k = ramp(0.5 + i * 0.06, 0.25);
        ui.save();
        ui.globalAlpha *= k;
        ui.translate((1 - k) * 12, 0);
        if (me) {
          plate(px + 12, ry, pw - 24, rh, {
            fill: R3D.vgrad(ry, rh, C.accentHi, C.accentLo),
            borderColor: 'rgba(255,236,170,0.9)', topLine: 'rgba(255,255,255,0.6)',
          });
          R3D.sheen(px + 12, ry, pw - 24, rh, R3D.slantOf(rh), 0.4);
        }
        plate(px + 24, ry + 6, 26, 20, {
          slant: 4, border: false,
          fill: i < 3 ? MEDAL_COLORS[i] : 'rgba(255,255,255,0.14)',
          topLine: 'rgba(255,255,255,0.6)',
        });
        textMid(String(i + 1), px + 37, ry + 16, 5, i < 3 ? C.ink : C.white, 12, '800');
        const fg = me ? C.ink : C.white;
        textMid(sv.names[ti][i].substring(0, 12), px + 62, ry + 16, 0, fg, 14, '700', 0, true);
        textMid(R3D.fmtTime(sv.scores[ti][i]), px + pw - 28, ry + 16, 8, fg, 15, '800', 0, true);
        ui.restore();
      }
    });

    // buttons
    const next = R3D.game.mode === 'champ' && g.medal >= 0 && !g.champion ? 'Next race' : D.lang[94];
    anim(9, 0, 10, () => {
      const by = 296, bh = 46;
      R3D.menuRow('again', 352, by, 128, bh, 'Race again', {
        center: true, active: this.sel === 0, size: 13,
        onTap: () => { this.sel = 0; this.again(); },
      });
      R3D.menuRow('cont', 490, by, 128, bh, next, {
        center: true, primary: true, active: this.sel === 1, size: 13,
        onTap: () => { this.sel = 1; this.leave(); },
      });
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
  // saves from the old build could count the championship past 12
  const sv = S();
  if (sv.champ > 12) { sv.champ = 12; R3D.persist(); }
  R3D.setScene(titleScene);
  R3D._loop();
};

})();
