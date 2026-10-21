/* Rally 3D — LANDSCAPE edition (mobile first)
   main.js — viewport/scaling, UI toolkit, touch + keyboard + gamepad input,
             tilt steering, audio, save data, scene machine.

   The logical canvas is a fixed 640x360 (16:9) landscape frame. It is scaled
   to the device with CSS and rendered at up to 2x device resolution so text
   stays crisp on a phone. Every drawing call works in logical pixels.
*/
(function () {
'use strict';
const D = window.R3D_DATA;
const R3D = window.R3D;
const W = R3D.W, H = R3D.H;              // 640 x 360

// ------------------------------------------------------------------ canvas
const glCanvas = document.getElementById('gl');
const uiCanvas = document.getElementById('ui');
const ui = uiCanvas.getContext('2d');
const renderer = new THREE.WebGLRenderer({
  canvas: glCanvas, antialias: false, alpha: true, preserveDrawingBuffer: true,
});
renderer.setClearColor(0x000000, 0);
// Shadows are always compiled in so toggling them never recompiles the
// materials; the sun only casts when the player asks for it.
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
// the near plane is close: the hood camera sits a few centimetres from the
// bodywork
const camera = new THREE.PerspectiveCamera(52, W / H, 0.08, 160);
R3D._renderer = renderer;
R3D._camera = camera;
R3D._gl = glCanvas;

let physScale = 1;

function layout() {
  const vw = window.innerWidth || W, vh = window.innerHeight || H;
  const fit = Math.min(vw / W, vh / H);
  const cssW = Math.max(1, Math.floor(W * fit));
  const cssH = Math.max(1, Math.floor(H * fit));
  const wrap = document.getElementById('wrap');
  if (wrap) { wrap.style.width = cssW + 'px'; wrap.style.height = cssH + 'px'; }
  for (const c of [glCanvas, uiCanvas]) {
    c.style.width = cssW + 'px';
    c.style.height = cssH + 'px';
  }
  const dpr = window.devicePixelRatio || 1;
  physScale = Math.max(1, Math.min(2, fit * dpr));
  uiCanvas.width = Math.round(W * physScale);
  uiCanvas.height = Math.round(H * physScale);
  ui.setTransform(physScale, 0, 0, physScale, 0, 0);
  ui.imageSmoothingEnabled = false;
  renderer.setPixelRatio(physScale);
  renderer.setSize(W, H, false);
  camera.aspect = W / H;
  camera.updateProjectionMatrix();
  if (R3D.onResize) R3D.onResize();
}
window.addEventListener('resize', layout);
window.addEventListener('orientationchange', () => setTimeout(layout, 150));

// ------------------------------------------------------------------ theme
// Rally broadcast graphics, taken from the original title art: deep rally
// blue, chrome-white italic headlines, panels slanted like the logo, amber for
// whatever is selected, and red / green only for time lost or gained.
const C = R3D.colors = {
  bg0: '#040a16',
  bg1: '#0c2350',
  navy: '#071226',
  panel: 'rgba(16,34,68,0.82)',
  panelHi: 'rgba(30,60,112,0.86)',
  line: 'rgba(150,190,255,0.34)',
  lineSoft: 'rgba(150,190,255,0.16)',
  white: '#ffffff',
  text: '#ffffff',
  dim: 'rgba(214,226,244,0.80)',
  faint: 'rgba(196,212,236,0.46)',
  accent: '#ffc400',      // selection
  accentHi: '#ffd94d',
  accentLo: '#e79a00',
  accent2: '#62b0ff',     // values, "on"
  blue: '#2a74ec',
  blueHi: '#4c95ff',
  blueLo: '#1546a6',
  magenta: '#2a74ec',     // old name of the clock colour
  red: '#ff4b4b',
  green: '#4fe08a',
  ink: '#08101e',
};

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
R3D.FONT = FONT;
R3D.isTouch = !!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches);

// ------------------------------------------------------------------ drawing helpers
function setFont(size, weight, spacing, italic) {
  ui.font = (italic ? 'italic ' : '') + (weight || '700') + ' ' + size + 'px ' + FONT;
  if ('letterSpacing' in ui) ui.letterSpacing = (spacing || 0) + 'px';
}

function roundRect(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r === undefined ? 2 : r, w / 2, h / 2));
  ui.beginPath();
  ui.moveTo(x + rr, y);
  ui.arcTo(x + w, y, x + w, y + h, rr);
  ui.arcTo(x + w, y + h, x, y + h, rr);
  ui.arcTo(x, y + h, x, y, rr);
  ui.arcTo(x, y, x + w, y, rr);
  ui.closePath();
}
R3D.roundRect = roundRect;

// Panels lean forward like the logo: the top edge is pushed right by `s`.
// The slant follows the height (about 12 degrees) up to 10 px.
function slantOf(h, s) { return s !== undefined ? s : Math.min(10, Math.round(h * 0.22)); }
function slantPath(x, y, w, h, s) {
  ui.beginPath();
  ui.moveTo(x + s, y);
  ui.lineTo(x + w, y);
  ui.lineTo(x + w - s, y + h);
  ui.lineTo(x, y + h);
  ui.closePath();
}
function shapePath(x, y, w, h, s, r) {
  if (s > 0) slantPath(x, y, w, h, s);
  else roundRect(x, y, w, h, r === undefined ? 2 : r);
}
R3D.slantOf = slantOf;
R3D.slantPath = slantPath;

function vgrad(y, h, a, b) {
  const g = ui.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, a);
  g.addColorStop(1, b);
  return g;
}
R3D.vgrad = vgrad;

// the coloured stripe along a panel's leading (left) edge
function edgeStripe(x, y, h, s, color, ew) {
  ew = ew || 4;
  ui.fillStyle = color;
  ui.beginPath();
  ui.moveTo(x + s, y);
  ui.lineTo(x + s + ew, y);
  ui.lineTo(x + ew, y + h);
  ui.lineTo(x, y + h);
  ui.closePath();
  ui.fill();
}
R3D.edgeStripe = edgeStripe;

// A plate: a slanted blue panel with a chrome hairline along the top.
//   fill / top,mid,bottom   colours     border:false / borderColor / lw
//   topLine  bevel colour (bevel:false for none)
//   edge / edgeW  leading-edge stripe   slant  override (0 = rounded box)
function plate(x, y, w, h, opt) {
  opt = opt || {};
  const s = slantOf(h, opt.slant);
  shapePath(x, y, w, h, s, opt.r);
  if (opt.fill) {
    ui.fillStyle = opt.fill;
  } else {
    const g = ui.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, opt.top || 'rgba(32,62,116,0.84)');
    g.addColorStop(0.5, opt.mid || 'rgba(15,33,68,0.84)');
    g.addColorStop(1, opt.bottom || 'rgba(7,16,34,0.86)');
    ui.fillStyle = g;
  }
  ui.fill();
  if (opt.bevel !== false) {
    ui.save();
    shapePath(x, y, w, h, s, opt.r);
    ui.clip();
    ui.fillStyle = opt.topLine || 'rgba(255,255,255,0.22)';
    ui.fillRect(x, y, w, 1);
    ui.restore();
  }
  if (opt.border !== false) {
    shapePath(x, y, w, h, s, opt.r);
    ui.strokeStyle = opt.borderColor || 'rgba(120,170,255,0.28)';
    ui.lineWidth = opt.lw || 1;
    ui.stroke();
  }
  if (opt.edge) edgeStripe(x, y, h, s, opt.edge, opt.edgeW);
}
R3D.plate = plate;
R3D.panel = plate;

// a light band that sweeps across a selected row every few seconds
function sheen(x, y, w, h, s, alpha) {
  const t = ((R3D.clock || 0) % 2.8) / 0.9;
  if (t >= 1) return;
  const bx = x - 40 + t * (w + 80);
  ui.save();
  slantPath(x, y, w, h, s);
  ui.clip();
  ui.globalAlpha *= alpha;
  ui.fillStyle = '#ffffff';
  ui.beginPath();
  ui.moveTo(bx, y);
  ui.lineTo(bx + 16, y);
  ui.lineTo(bx + 16 - h * 0.5, y + h);
  ui.lineTo(bx - h * 0.5, y + h);
  ui.closePath();
  ui.fill();
  ui.restore();
}
R3D.sheen = sheen;

// text: str, x, y, align(0 left|5 center|8 right), color, size, weight, spacing, num
// `num` draws the string condensed and italic: the timing readouts.
function drawText(str, x, y, align, color, size, weight, spacing, num, mid, italic) {
  setFont(size || 16, weight, spacing, italic || num);
  ui.textAlign = align === 8 ? 'right' : (align === 5 ? 'center' : 'left');
  ui.textBaseline = mid ? 'middle' : 'top';
  ui.save();
  if (num) {
    ui.translate(x, y);
    ui.scale(0.88, 1);
    ui.translate(-x, -y);
  }
  if (color !== 'transparent' && color !== C.ink) {
    ui.fillStyle = 'rgba(0,0,0,0.5)';
    ui.fillText(str, x + 1, y + 1);
  }
  ui.fillStyle = color || C.text;
  ui.fillText(str, x, y);
  ui.restore();
}
function text(str, x, y, align, color, size, weight, spacing, num) {
  drawText(str, x, y, align, color, size, weight, spacing, num, false);
}
R3D.text = text;

function textMid(str, x, y, align, color, size, weight, spacing, num) {
  drawText(str, x, y, align, color, size, weight, spacing, num, true);
}
R3D.textMid = textMid;

// uppercase label; 12 px and up it leans like the logo
function tag(str, x, y, align, color, size, spacing) {
  const sz = size || 10;
  drawText(String(str).toUpperCase(), x, y, align, color || C.dim, sz, '700',
    spacing === undefined ? 0.9 : spacing, false, false, sz >= 12);
}
R3D.tag = tag;

function tagMid(str, x, y, align, color, size, spacing) {
  const sz = size || 10;
  drawText(String(str).toUpperCase(), x, y, align, color || C.dim, sz, '700',
    spacing === undefined ? 0.9 : spacing, false, true, sz >= 12);
}
R3D.tagMid = tagMid;

function measure(str, size, weight, spacing) {
  setFont(size || 16, weight, spacing);
  return ui.measureText(str).width;
}
R3D.measure = measure;

// Chrome headline lettering after the logo: italic, a bright-to-steel
// gradient and a dark outline. opts: mid (centre baseline), spacing, gold.
function chromeText(str, x, y, align, size, opts) {
  opts = opts || {};
  str = String(str).toUpperCase();
  setFont(size, '800', opts.spacing === undefined ? 1 : opts.spacing, true);
  ui.textAlign = align === 8 ? 'right' : (align === 5 ? 'center' : 'left');
  ui.textBaseline = opts.mid ? 'middle' : 'top';
  const top = opts.mid ? y - size * 0.5 : y;
  const g = ui.createLinearGradient(0, top, 0, top + size);
  if (opts.gold) {
    g.addColorStop(0, '#fff6c4'); g.addColorStop(0.45, '#ffd23a');
    g.addColorStop(0.55, '#b97400'); g.addColorStop(1, '#ffe58a');
  } else {
    g.addColorStop(0, '#ffffff'); g.addColorStop(0.45, '#dfe8f4');
    g.addColorStop(0.55, '#7f95b3'); g.addColorStop(1, '#eef4fb');
  }
  ui.lineJoin = 'round';
  ui.lineWidth = Math.max(2, size * 0.13);
  ui.strokeStyle = '#04102a';
  ui.strokeText(str, x, y);
  ui.fillStyle = g;
  ui.fillText(str, x, y);
}
R3D.chromeText = chromeText;

// procedural checkered strip (the original's flag motif)
function checkers(x, y, w, h, cell, a, b) {
  cell = cell || 8;
  a = a || '#1b4f8f'; b = b || '#123a6b';
  for (let i = 0; i * cell < w; i++) {
    for (let j = 0; j * cell < h; j++) {
      ui.fillStyle = ((i + j) & 1) ? a : b;
      ui.fillRect(x + i * cell, y + j * cell, cell, cell);
    }
  }
}
R3D.checkers = checkers;

function vGradient(x, y, w, h, top, bottom) {
  ui.fillStyle = vgrad(y, h, top, bottom);
  ui.fillRect(x, y, w, h);
}
R3D.vGradient = vGradient;

// ------------------------------------------------------------------ button feedback
// A tapped button flashes for a fraction of a second (time-based, so it lasts
// the same on a 60 Hz and a 120 Hz screen).
const flashes = [];
R3D.flash = function (id) {
  for (let i = flashes.length - 1; i >= 0; i--) if (flashes[i].id === id) flashes.splice(i, 1);
  flashes.push({ id: id, t0: performance.now() });
  if (flashes.length > 8) flashes.shift();
};
function flashFor(id) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    const f = flashes[i];
    if (f.id !== id) continue;
    const k = (performance.now() - f.t0) / 220;
    if (k >= 1) { flashes.splice(i, 1); return 0; }
    return 1 - k;
  }
  return 0;
}
R3D.flashFor = flashFor;
R3D.clearFlashes = () => { flashes.length = 0; };

// ------------------------------------------------------------------ icons
function iconArrow(x, y, size, dir, color) {
  ui.save();
  ui.translate(x, y);
  ui.rotate(dir * Math.PI / 2);
  ui.fillStyle = color;
  const s = size;
  ui.beginPath();
  ui.moveTo(0, -s * 0.5);
  ui.lineTo(s * 0.42, s * 0.28);
  ui.lineTo(s * 0.16, s * 0.28);
  ui.lineTo(s * 0.16, s * 0.5);
  ui.lineTo(-s * 0.16, s * 0.5);
  ui.lineTo(-s * 0.16, s * 0.28);
  ui.lineTo(-s * 0.42, s * 0.28);
  ui.closePath();
  ui.fill();
  ui.restore();
}
R3D.iconArrow = iconArrow;

// a chevron: dir 0 = up, 1 = right, 2 = down, 3 = left
function iconChevron(x, y, size, dir, color, lw) {
  ui.save();
  ui.translate(x, y);
  ui.rotate((dir - 1) * Math.PI / 2);
  ui.strokeStyle = color;
  ui.lineWidth = lw || 2;
  ui.lineCap = 'round';
  ui.lineJoin = 'round';
  ui.beginPath();
  ui.moveTo(-size * 0.25, -size * 0.45);
  ui.lineTo(size * 0.25, 0);
  ui.lineTo(-size * 0.25, size * 0.45);
  ui.stroke();
  ui.restore();
}
R3D.iconChevron = iconChevron;

function iconPause(x, y, size, color) {
  ui.fillStyle = color;
  const w = size * 0.16, h = size * 0.46;
  ui.fillRect(x - size * 0.26, y - h / 2, w, h);
  ui.fillRect(x + size * 0.10, y - h / 2, w, h);
}
R3D.iconPause = iconPause;

// a small video-camera glyph (camera switch button)
function iconCamera(x, y, size, color) {
  const s = size;
  ui.fillStyle = color;
  roundRect(x - s * 0.45, y - s * 0.26, s * 0.62, s * 0.52, 2);
  ui.fill();
  ui.beginPath();
  ui.moveTo(x + s * 0.2, y - s * 0.06);
  ui.lineTo(x + s * 0.46, y - s * 0.24);
  ui.lineTo(x + s * 0.46, y + s * 0.24);
  ui.lineTo(x + s * 0.2, y + s * 0.06);
  ui.closePath();
  ui.fill();
}
R3D.iconCamera = iconCamera;

function iconGear(x, y, size, color) {
  ui.save();
  ui.translate(x, y);
  ui.strokeStyle = color;
  ui.lineWidth = Math.max(1.5, size * 0.1);
  ui.beginPath();
  ui.arc(0, 0, size * 0.32, 0, Math.PI * 2);
  ui.stroke();
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    ui.beginPath();
    ui.moveTo(Math.cos(a) * size * 0.36, Math.sin(a) * size * 0.36);
    ui.lineTo(Math.cos(a) * size * 0.48, Math.sin(a) * size * 0.48);
    ui.stroke();
  }
  ui.restore();
}
R3D.iconGear = iconGear;

function lockIcon(x, y, color) {
  ui.fillStyle = color || 'rgba(226,232,240,0.6)';
  ui.fillRect(x - 6, y - 1, 12, 9);
  ui.strokeStyle = color || 'rgba(226,232,240,0.7)';
  ui.lineWidth = 2;
  ui.beginPath();
  ui.arc(x, y - 1, 4.2, Math.PI, 0);
  ui.stroke();
}
R3D.lockIcon = lockIcon;

// on/off switch; x,y = left edge, vertical centre
function drawToggle(x, ym, on, dim) {
  const w = 32, h = 16, y = ym - h / 2;
  roundRect(x, y, w, h, 8);
  ui.fillStyle = on ? (dim ? 'rgba(76,149,255,0.4)' : C.blueHi) : 'rgba(0,0,0,0.38)';
  ui.fill();
  ui.strokeStyle = on ? 'rgba(200,225,255,0.75)' : 'rgba(255,255,255,0.28)';
  ui.lineWidth = 1;
  ui.stroke();
  ui.beginPath();
  ui.arc(on ? x + w - 8 : x + 8, ym, 6, 0, Math.PI * 2);
  ui.fillStyle = on ? '#ffffff' : 'rgba(255,255,255,0.65)';
  ui.fill();
}
R3D.drawToggle = drawToggle;

// ------------------------------------------------------------------ hit areas
// Immediate-mode: a scene registers its buttons while drawing, the input
// layer resolves pointers against the last drawn frame.
const hit = { holds: [], taps: [], drags: [] };
R3D.hit = hit;
R3D.clearHits = () => { hit.holds.length = 0; hit.taps.length = 0; hit.drags.length = 0; };
R3D.holdArea = (id, x, y, w, h) => { hit.holds.push({ id, x, y, w, h }); };
R3D.tapArea = (id, x, y, w, h, cb) => { hit.taps.push({ id, x, y, w, h, cb }); };
R3D.dragArea = (id, x, y, w, h) => { hit.drags.push({ id, x, y, w, h }); };

// One menu row: a slanted plate with an uppercase label, and on the right a
// value, an on/off switch or a lock. The selected row fills amber, gains a
// chevron and a passing sheen.
//   o.active o.sub o.right o.toggle o.lock o.disabled o.center o.primary o.danger
function menuRow(id, x, y, w, h, label, o) {
  o = o || {};
  const on = !!o.active, dis = !!o.disabled;
  const s = slantOf(h);
  let fill = o.fill || null, border = 'rgba(120,170,255,0.26)', ink = false;
  if (on && o.danger) {
    fill = vgrad(y, h, '#ff6a5e', '#c42a2a'); border = 'rgba(255,200,190,0.85)';
  } else if (on) {
    fill = vgrad(y, h, C.accentHi, C.accentLo); border = 'rgba(255,236,170,0.9)'; ink = true;
  } else if (o.primary && !dis) {
    fill = vgrad(y, h, '#3b88f6', C.blueLo); border = 'rgba(160,200,255,0.7)';
  } else if (dis) {
    fill = fill || 'rgba(8,16,32,0.62)'; border = 'rgba(120,170,255,0.14)';
  } else if (o.danger) {
    border = 'rgba(255,90,90,0.55)';
  }
  plate(x, y, w, h, {
    fill, borderColor: border, slant: s, lw: on ? 1.5 : 1,
    topLine: on || (o.primary && !dis) ? 'rgba(255,255,255,0.6)' : undefined,
  });
  if (on || (o.primary && !dis)) sheen(x, y, w, h, s, on ? 0.4 : 0.22);

  const fg = ink ? C.ink : (dis ? C.faint : (o.danger && !on ? C.red : C.white));
  const subCol = ink ? 'rgba(8,16,30,0.72)' : (dis ? C.faint : C.dim);
  const al = o.center ? 5 : 0;
  let lx = o.center ? x + w / 2 : x + s + 14;
  if (on && !o.center) {
    iconChevron(x + s + 13, y + h / 2, 10, 1, fg, 2.5);
    lx += 12;
  }
  const size = o.size || 14;
  if (o.sub) {
    tagMid(label, lx, y + h / 2 - 8, al, fg, size, 1);
    text(o.sub, lx, y + h / 2 + 3, al, subCol, 11, '500');
  } else {
    tagMid(label, lx, y + h / 2, al, fg, size, 1);
  }
  const rx = x + w - Math.round(s / 2) - 14;
  if (o.toggle !== undefined) drawToggle(rx - 32, y + h / 2, !!o.toggle, dis);
  else if (o.lock) lockIcon(rx - 6, y + h / 2 - 1, ink ? C.ink : undefined);
  else if (o.right) {
    tagMid(o.right, rx, y + h / 2, 8,
      ink ? 'rgba(8,16,30,0.78)' : (o.rightColor || (dis ? C.faint : C.accent2)), o.rightSize || 12, 1);
  }
  const fl = flashFor(id);
  if (fl > 0) {
    ui.save();
    ui.globalAlpha = fl * 0.4;
    slantPath(x, y, w, h, s);
    ui.fillStyle = '#ffffff';
    ui.fill();
    ui.restore();
  }
  if (o.onTap) R3D.tapArea(id, x, y, w, h, o.onTap);
}
R3D.menuRow = menuRow;

// drag state (used by the car showroom: grab the car and spin it)
const dragState = R3D.dragState = { down: false, dx: 0 };

// ------------------------------------------------------------------ input
const keyState = { L: false, R: false, U: false, D: false };
const holdCount = { L: 0, R: 0, U: 0, D: 0 };
const keys = R3D.keys = { L: false, R: false, U: false, D: false };
const PRESSED = {};
R3D.wasPressed = (k) => { if (PRESSED[k]) { PRESSED[k] = false; return true; } return false; };
R3D.clearPressed = () => { for (const k in PRESSED) PRESSED[k] = false; };

const KEYMAP = {
  ArrowUp: 'UP', KeyW: 'UP',
  ArrowDown: 'DOWN', KeyS: 'DOWN',
  ArrowLeft: 'LEFT', KeyA: 'LEFT',
  ArrowRight: 'RIGHT', KeyD: 'RIGHT',
  Enter: 'OK', Space: 'OK', NumpadEnter: 'OK',
  Escape: 'BACK', Backspace: 'BACK',
  KeyP: 'PAUSE',
  KeyC: 'CAM',
};
const DRIVE = { LEFT: 'L', RIGHT: 'R', UP: 'U', DOWN: 'D' };

window.addEventListener('keydown', (e) => {
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (DRIVE[k]) keyState[DRIVE[k]] = true;
  if (!e.repeat) PRESSED[k] = true;
  AudioSys.ensure();
}, { passive: false });
window.addEventListener('keyup', (e) => {
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (DRIVE[k]) keyState[DRIVE[k]] = false;
}, { passive: false });

// ---- tilt steering -------------------------------------------------------
const tilt = R3D.tilt = {
  supported: typeof window.DeviceOrientationEvent !== 'undefined',
  enabled: false,
  center: null,
  value: 0,        // -1 .. 1  (negative = tilted left)
  _raw: 0,
  _has: false,
  request() {
    const DOE = window.DeviceOrientationEvent;
    if (!DOE) return Promise.resolve(false);
    if (typeof DOE.requestPermission === 'function') {
      return DOE.requestPermission().then((r) => {
        if (r !== 'granted') return false;
        this._attach();
        return true;
      }).catch(() => false);
    }
    this._attach();
    return Promise.resolve(true);
  },
  _attach() {
    if (this._attached) return;
    this._attached = true;
    window.addEventListener('deviceorientation', (e) => this._onEvent(e));
  },
  _onEvent(e) {
    if (!this.enabled) return;
    const angle = (screen.orientation && screen.orientation.angle !== undefined)
      ? screen.orientation.angle
      : (window.orientation || 0);
    // screen-relative left/right tilt
    let x = e.gamma;
    if (angle === 90) x = -e.gamma;
    else if (angle === 180) x = -e.gamma;
    else if (angle === 270) x = e.gamma;
    if (x === null || x === undefined) return;
    this._raw = x;
    this._has = true;
    if (this.center === null) { this.center = x; this.value = 0; return; }
    const d = x - this.center;
    const dead = 3, range = 18;
    if (Math.abs(d) < dead) this.value = 0;
    else this.value = Math.max(-1, Math.min(1, (d - Math.sign(d) * dead) / range));
  },
  recalibrate() { this.center = this._has ? this._raw : null; this.value = 0; },
  enable() {
    return this.request().then((ok) => {
      this.enabled = !!ok;
      if (ok) this.recalibrate();
      return this.enabled;
    });
  },
  disable() { this.enabled = false; this.value = 0; },
};

// ---- pointers (multi touch) ---------------------------------------------
const pointers = new Map();          // pointerId -> {kind:'hold'|'tap'|'drag', id}

function localPoint(e) {
  const r = uiCanvas.getBoundingClientRect();
  return {
    x: (e.clientX - r.left) / (r.width || W) * W,
    y: (e.clientY - r.top) / (r.height || H) * H,
  };
}
function inArea(a, p) {
  return p.x >= a.x && p.x < a.x + a.w && p.y >= a.y && p.y < a.y + a.h;
}

function setHold(id, on) {
  if (!holdCount[id] && on) holdCount[id] = 1;
  else if (on) holdCount[id]++;
  else holdCount[id] = Math.max(0, holdCount[id] - 1);
}
R3D.isHeld = (id) => holdCount[id] > 0;

// tilt was on last session: re-enable it on the first touch (iOS only grants
// motion access inside a user gesture)
function restoreTilt() {
  if (tilt._restored || tilt.enabled || !save || save.settings.tilt !== 1) return;
  tilt._restored = true;
  tilt.enable().then((ok) => { if (!ok) { save.settings.tilt = 0; persist(); } });
}

uiCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  AudioSys.ensure();
  restoreTilt();
  if (R3D.isTransitioning && R3D.isTransitioning()) return;   // ignore taps mid-change
  const p = localPoint(e);
  for (let i = hit.holds.length - 1; i >= 0; i--) {
    const a = hit.holds[i];
    if (inArea(a, p)) {
      setHold(a.id, true);
      pointers.set(e.pointerId, { kind: 'hold', id: a.id });
      try { uiCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
  }
  for (let i = hit.taps.length - 1; i >= 0; i--) {
    const a = hit.taps[i];
    if (inArea(a, p)) {
      pointers.set(e.pointerId, { kind: 'tap', id: a.id });
      R3D.flash(a.id);
      if (a.cb) a.cb(a.id, p);
      return;
    }
  }
  // nothing tapped: maybe a free drag (showroom spin)
  for (let i = hit.drags.length - 1; i >= 0; i--) {
    const a = hit.drags[i];
    if (inArea(a, p)) {
      pointers.set(e.pointerId, { kind: 'drag', id: a.id, x: p.x });
      dragState.down = true;
      dragState.dx = 0;
      try { uiCanvas.setPointerCapture(e.pointerId); } catch (err) {}
      return;
    }
  }
}, { passive: false });

uiCanvas.addEventListener('pointermove', (e) => {
  const rec = pointers.get(e.pointerId);
  if (!rec) return;
  const p = localPoint(e);
  if (rec.kind === 'drag') {
    e.preventDefault();
    dragState.dx += p.x - rec.x;
    rec.x = p.x;
    dragState.down = true;
    return;
  }
  if (rec.kind !== 'hold') return;
  e.preventDefault();
  let cur = null;
  for (let i = hit.holds.length - 1; i >= 0; i--) {
    if (inArea(hit.holds[i], p)) { cur = hit.holds[i]; break; }
  }
  if (cur && cur.id !== rec.id) {
    setHold(rec.id, false);
    setHold(cur.id, true);
    rec.id = cur.id;
  }
}, { passive: false });

function endPointer(e) {
  const rec = pointers.get(e.pointerId);
  if (rec && rec.kind === 'hold') setHold(rec.id, false);
  if (rec && rec.kind === 'drag') { dragState.down = false; dragState.dx = 0; }
  pointers.delete(e.pointerId);
}
uiCanvas.addEventListener('pointerup', endPointer, { passive: false });
uiCanvas.addEventListener('pointercancel', endPointer, { passive: false });
uiCanvas.addEventListener('contextmenu', (e) => e.preventDefault());

// if the browser never delivers the matching pointerup (a phone call, the
// app going to the background) the pad would stay held forever
function releaseAllHolds() {
  for (const k in holdCount) holdCount[k] = 0;
  pointers.clear();
  dragState.down = false;
  dragState.dx = 0;
}
R3D.releaseAllHolds = releaseAllHolds;
window.addEventListener('blur', releaseAllHolds);
window.addEventListener('pagehide', releaseAllHolds);
document.addEventListener('visibilitychange', () => { if (document.hidden) releaseAllHolds(); });

// ---- gamepad -------------------------------------------------------------
// Standard mapping: left stick / d-pad / right stick steer, right trigger or
// A accelerates, left trigger or B brakes, Start pauses, X switches camera.
const pad = { index: -1, prev: [], connected: false, state: null };

function readPad() {
  if (!navigator.getGamepads) return null;
  const pads = navigator.getGamepads();
  for (let i = 0; i < pads.length; i++) {
    if (pads[i] && pads[i].connected) return pads[i];
  }
  return null;
}

const DEAD = 0.28;
function axis(v) { return Math.abs(v) < DEAD ? 0 : v; }

function pollGamepad() {
  const gp = readPad();
  if (!gp) {
    if (pad.connected) { pad.connected = false; pad.index = -1; pad.state = null; pad.prev.length = 0; }
    return;
  }
  if (!pad.connected) {
    pad.connected = true;
    pad.index = gp.index;
    R3D.toast('Gamepad connected', 2000, 'pad');
  }
  const ax = gp.axes || [];
  const btn = gp.buttons || [];
  const down = (i) => !!(btn[i] && btn[i].pressed);
  const prev = pad.prev;
  const pressed = (i) => down(i) && !prev[i];
  const racing = !!(R3D.raceActive && R3D.raceActive());

  const stick = axis(ax[0] || 0);
  let l = stick < 0, r = stick > 0;
  if (down(14)) l = true;
  if (down(15)) r = true;
  const rstick = axis(ax[2] || 0);
  if (rstick < 0) l = true;
  if (rstick > 0) r = true;

  const rt = btn[7] ? (btn[7].value || 0) : 0;
  const lt = btn[6] ? (btn[6].value || 0) : 0;
  const up = rt > 0.15 || down(0);
  const downB = lt > 0.35 || down(1);

  if (pressed(9)) PRESSED.PAUSE = true;            // Start
  if (pressed(0)) PRESSED.OK = true;               // A
  if (pressed(1) && !racing) PRESSED.BACK = true;  // B (brakes while racing)
  if (pressed(12)) PRESSED.UP = true;
  if (pressed(13)) PRESSED.DOWN = true;
  if (pressed(14)) PRESSED.LEFT = true;
  if (pressed(15)) PRESSED.RIGHT = true;
  if (pressed(2)) PRESSED.CAM = true;              // X

  pad.state = { l, r, up, down: downB };
  for (let i = 0; i < btn.length; i++) prev[i] = !!(btn[i] && btn[i].pressed);
}

// merge everything into the driving state each frame. Tilt is NOT folded
// into L/R: race.js reads tilt.value as an analog steering target.
R3D.pollInput = function () {
  pollGamepad();
  const g = pad.state;
  keys.L = keyState.L || holdCount.L > 0 || !!(g && g.l);
  keys.R = keyState.R || holdCount.R > 0 || !!(g && g.r);
  keys.U = keyState.U || holdCount.U > 0 || !!(g && g.up);
  keys.D = keyState.D || holdCount.D > 0 || !!(g && g.down);
  R3D.tiltActive = tilt.enabled && Math.abs(tilt.value) > 0.05;
};
R3D.gamepadConnected = () => pad.connected;

// ------------------------------------------------------------------ save
const SAVE_KEY = 'r3d_save_landscape_v1';
function defSave() {
  const scores = [], names = [];
  for (let t = 0; t < 12; t++) {
    names.push([D.lang[68], D.lang[68], D.lang[68], D.lang[68], D.lang[68]]);
    scores.push([D.tracks[t].medals[0], D.tracks[t].medals[1], D.tracks[t].medals[2],
                 D.tracks[t].medals[3], D.tracks[t].medals[3] + 100]);
  }
  return {
    medals: [3, 3, 4, 4, 4, 4, 4, 4, 4, 4, 4, 4],
    cars: [0, 1, 1, 1],
    names, scores,
    champ: 0,
    settings: { sound: 2, units: 0, auto: 0, titleSong: 0, tilt: 0, buttons: 1, camera: 'chase',
                motionBlur: 1, lighting: 1, shadows: 1 },
    name: D.lang[68],
  };
}
let save;
try {
  const raw = JSON.parse(localStorage.getItem(SAVE_KEY) || 'null');
  save = raw ? Object.assign(defSave(), raw) : defSave();
  save.settings = Object.assign(defSave().settings, raw && raw.settings);
} catch (e) { save = defSave(); }
function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(save)); } catch (e) {} }
R3D.save = () => save;
R3D.persist = persist;
R3D.defSave = defSave;
R3D.saveReset = function () {
  try { localStorage.removeItem(SAVE_KEY); } catch (e) {}
  save = defSave();
  persist();
  tilt.disable();
  return save;
};
Object.defineProperty(R3D, 'saveObj', { get() { return save; }, set(v) { save = v; } });

// one time format everywhere: M:SS.t (input in tenths of a second)
function fmtTime(t) {
  if (t < 0) return '-:--.-';
  t = Math.round(t);
  const tenth = t % 10, ss = Math.floor(t / 10) % 60, mm = Math.floor(t / 600);
  return mm + ':' + (ss < 10 ? '0' : '') + ss + '.' + tenth;
}
R3D.fmtTime = fmtTime;

// ------------------------------------------------------------------ audio
// The ORIGINAL MIDI files from the jar, played through a General-MIDI
// synthesizer (libmidi / TinySynth). The OGG renders are a fallback.
// Every looped track carries a generation number: stopMusic() bumps it, so a
// track that is still loading when the music is stopped never starts.
const AudioSys = R3D.audio = {
  ctx: null, music: null, _fx: null,
  midiLib: null, musicPlayer: null, sfxPlayer: null, midiBufs: {}, midiFailed: false,
  _pending: null, _starting: false, _gen: 0,
  tiny: null, tinyFailed: false, _tinyPending: null,
  ensure() {
    if (!this.ctx) {
      try { this.ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) {}
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      const c = this.ctx;
      c.resume().then(() => { if (this.ctx === c) this._flushPending(); }).catch(() => {});
    } else if (this.ctx && this.ctx.state === 'running') {
      this._flushPending();
    }
    if (this.tiny && this.tiny.actx) {
      const ta = this.tiny.actx;
      if (ta.state === 'suspended') ta.resume().then(() => this._flushTinyPending()).catch(() => {});
      else if (ta.state === 'running') this._flushTinyPending();
    }
  },
  _flushTinyPending() {
    if (this._tinyPending) {
      const p = this._tinyPending; this._tinyPending = null;
      this.play(p.name, p.loop, p.vol);
    }
  },
  _flushPending() {
    if (this._pending) {
      const p = this._pending; this._pending = null;
      this.play(p.name, p.loop, p.vol);
    }
  },
  async initTiny() {
    if (this.tiny || this.tinyFailed) return this.tiny;
    try {
      if (!window.WebAudioTinySynth) throw new Error('no tinysynth');
      this.tiny = new window.WebAudioTinySynth({ quality: 1, useReverb: 1, voices: 48 });
    } catch (e) { this.tinyFailed = true; }
    return this.tiny;
  },
  async initMidi() {
    if (this.midiLib || this.midiFailed) return this.midiLib;
    try {
      if (!this.ctx.audioWorklet || typeof AudioWorkletNode === 'undefined') throw new Error('no worklet');
      const mod = await import('../libmidi/libmidi.js');
      this.midiLib = new mod.LibMidi(this.ctx, this.ctx.destination);
      await this.midiLib.init();
      this.MIDIPlayer = mod.MIDIPlayer;
      this.musicPlayer = this.midiLib.midiPlayer;
      this.sfxPlayer = new mod.MIDIPlayer(this.ctx, this.ctx.destination);
    } catch (e) { this.midiFailed = true; }
    return this.midiLib;
  },
  async _midiBuf(name) {
    if (this.midiBufs[name]) return this.midiBufs[name];
    const r = await fetch('assets/midi/' + name + '.mid');
    if (!r.ok) throw new Error('midi ' + name + ' missing');
    const buf = await r.arrayBuffer();
    this.midiBufs[name] = buf;
    return buf;
  },
  async playTinyMidi(name, loop, vol, gen) {
    const t = await this.initTiny();
    if (!t) return false;
    try {
      const buf = await this._midiBuf(name);
      if (loop && gen !== this._gen) return true;          // stopped while loading
      if (!t.actx || t.actx.state !== 'running') {
        this._tinyPending = { name, loop, vol };
        if (t.actx) t.actx.resume().then(() => this._flushTinyPending()).catch(() => {});
        return true;
      }
      t.setMasterVol(Math.min(1, vol * 1.2));
      t.stopMIDI();
      t.loadMIDI(buf.slice(0));
      t.loop = loop ? 1 : 0;
      t.playTick = 0; t.playIndex = 0;
      t.playMIDI();
      this.music = { tiny: t };
      return true;
    } catch (e) { return false; }
  },
  async playMidi(name, loop, vol, gen) {
    if (!await this.initMidi()) return false;
    try {
      const buf = await this._midiBuf(name);
      if (loop && gen !== this._gen) return true;          // stopped while loading
      if (loop) {
        const p = this.musicPlayer;
        await p.setSequence(buf);
        if (gen !== this._gen) return true;
        p.volume = vol;
        p.stop(); p.loop(-1); p.play();
        this.music = { midi: p };
      } else {
        const p = this.sfxPlayer;
        await p.setSequence(buf);
        p.volume = vol;
        p.stop(); p.play();
        this._fx = { midi: p };
      }
      return true;
    } catch (e) { return false; }
  },
  play(name, loop, vol) {
    this.ensure();
    if (!this.ctx || save.settings.sound === 0) return;
    if (this.ctx.state !== 'running') {
      if (loop) this._pending = { name, loop, vol };
      return;
    }
    const v = (vol !== undefined ? vol : 0.6) * (save.settings.sound === 1 ? 0.45 : 1);
    if (loop) { this.stopMusic(); this._starting = true; }
    const gen = this._gen;
    const route = (name === 'title' && save.settings.titleSong === 1)
      ? this.playTinyMidi(name, loop, v, gen)
      : this.playMidi(name, loop, v, gen);
    route.then((ok) => {
      if (loop && gen === this._gen) this._starting = false;
      if (ok || save.settings.sound === 0 || (loop && gen !== this._gen)) return;
      const a = new Audio('assets/audio/' + name + '.ogg');
      a.loop = !!loop;
      a.volume = v;
      a.play().then(() => {
        if (loop && gen !== this._gen) { a.pause(); return; }
        if (loop) this.music = a; else this._fx = a;
      }).catch(() => {});
    });
  },
  stopMusic() {
    this._gen++;
    this._starting = false;
    this._pending = null;
    this._tinyPending = null;
    if (this.tiny) { try { this.tiny.stopMIDI(); } catch (e) {} }
    if (this.music) {
      if (this.music.midi) { try { this.music.midi.stop(); } catch (e) {} }
      else if (this.music.pause) { try { this.music.pause(); } catch (e) {} }
      this.music = null;
    }
  },
  sfx(name) { this.play(name, false, 0.9); },
};

// ------------------------------------------------------------------ scenes
R3D.scene3d = null;          // active three.js scene (race / showroom)

// Free a three.js tree. Textures are shared by every car and track and are
// never freed; materials flagged userData.keep (cached prop sprites) stay.
R3D.disposeObject = function (root) {
  if (!root) return;
  root.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    const m = o.material;
    if (m) (Array.isArray(m) ? m : [m]).forEach((mm) => { if (!mm.userData.keep) mm.dispose(); });
  });
};
R3D.clearScene3d = function () {
  if (R3D.scene3d) { R3D.disposeObject(R3D.scene3d); R3D.scene3d = null; }
};

let scene = null;
let pending = null;
let trans = { dir: 0, t: 0 };   // 1 = shutter closing, -1 = shutter opening
let last = 0;
let clock = 0;
R3D.sceneStart = 0;
R3D.clock = 0;

// The old scene keeps drawing (3D included) until the shutter covers it;
// only then is its 3D freed and the new scene entered.
function applyScene(s) {
  if (!s) return;
  R3D.clearScene3d();
  R3D.clearFlashes();
  scene = s;
  R3D.sceneStart = clock;
  R3D.clearPressed();
  if (s.enter) s.enter();
}

R3D.setScene = function (s) {
  if (pending || !s) return;
  if (!scene) {                       // first screen: start covered, then open
    applyScene(s);
    trans.dir = -1; trans.t = 1;
    return;
  }
  pending = s;
  if (trans.dir === 0) { trans.dir = 1; trans.t = 0; }
};
R3D.currentScene = () => scene;
R3D.isTransitioning = () => trans.dir !== 0 || !!pending;

// entrance animation: 0 -> 1 over 0.28s after the scene appears; item i
// starts `delay` seconds after item i-1 (staggered menus)
R3D.sceneAge = () => clock - R3D.sceneStart;
R3D.intro = function (i, delay) {
  const t = (clock - R3D.sceneStart - (i || 0) * (delay === undefined ? 0.035 : delay)) / 0.28;
  const k = Math.max(0, Math.min(1, t));
  return 1 - Math.pow(1 - k, 3);
};
R3D.restartIntro = () => { R3D.sceneStart = clock; };

// the menus keep the title music looping; restart it whenever nothing plays
R3D.ensureMenuMusic = function () {
  const A = R3D.audio;
  if (!A.music && !A._starting && save.settings.sound !== 0) A.play('title', true, 0.5);
};

function ease(t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}
R3D.ease = ease;

// The shutter is one slanted navy panel sweeping left to right, its moving
// edge carrying the amber-and-blue livery.
const SLANT = 70;
function slab(l, r, color, alpha) {
  if (r <= l) return;
  ui.save();
  ui.globalAlpha = alpha;
  ui.fillStyle = color;
  ui.beginPath();
  ui.moveTo(l, 0); ui.lineTo(r, 0); ui.lineTo(r - SLANT, H); ui.lineTo(l - SLANT, H);
  ui.closePath();
  ui.fill();
  ui.restore();
}
function drawCover(phase, e) {
  const span = W + SLANT;
  if (phase === 1) {
    const r = e * span;
    slab(-SLANT - 4, r, C.navy, 1);
    slab(r - 5, r, C.accent, 1);
    slab(r - 13, r - 10, C.blueHi, 1);
  } else {
    const l = (1 - e) * span;
    slab(l, W + SLANT + 4, C.navy, 1);
    slab(l, l + 5, C.accent, 1);
    slab(l + 10, l + 13, C.blueHi, 1);
  }
}

// ---- toasts ---------------------------------------------------------------
// `key` replaces an earlier toast with the same key (e.g. camera changes)
const toasts = [];
R3D.toast = function (msg, ms, key) {
  if (key) for (let i = toasts.length - 1; i >= 0; i--) if (toasts[i].key === key) toasts.splice(i, 1);
  toasts.push({ msg: String(msg), t: 0, life: ms || 2600, key: key });
  if (toasts.length > 3) toasts.shift();
};
function drawToasts(dt) {
  for (let i = toasts.length - 1; i >= 0; i--) {
    toasts[i].t += dt * 1000;                 // life is in milliseconds
    if (toasts[i].t > toasts[i].life) toasts.splice(i, 1);
  }
  let y = 78;
  for (const t of toasts) {
    const a = Math.max(0, Math.min(1, t.t / 120, (t.life - t.t) / 300));
    const ox = (1 - Math.min(1, t.t / 160)) * 14;
    const w = Math.min(W - 40, measure(t.msg.toUpperCase(), 12, '700', 1) + 48);
    const x = (W - w) / 2 + ox;
    ui.save();
    ui.globalAlpha = a;
    plate(x, y, w, 30, { fill: 'rgba(7,18,38,0.95)', borderColor: 'rgba(120,170,255,0.4)', edge: C.accent });
    tagMid(t.msg, x + w / 2 + 2, y + 15, 5, C.white, 12, 1);
    ui.restore();
    y += 36;
  }
}

// a screen that throws is reported once in the console and, for a few
// seconds, in a red bar on screen (handy on a phone with no console)
let lastErr = null;
function reportError(e) {
  const msg = String((e && e.message) || e);
  if (!lastErr || lastErr.msg !== msg) console.error(e);
  lastErr = { msg: msg, t: clock };
}
function drawError() {
  ui.fillStyle = 'rgba(176,32,28,0.92)';
  ui.fillRect(0, H - 22, W, 22);
  textMid('Error: ' + lastErr.msg.slice(0, 90), 10, H - 11, 0, C.white, 11, '600');
}

R3D._loop = function () {
  requestAnimationFrame(function frame(ts) {
    requestAnimationFrame(frame);
    // physics uses a capped dt; the transition uses real elapsed time so a
    // throttled tab can't stretch the wipe into seconds of black
    const rawDt = Math.min(0.25, (ts - last) / 1000 || 0.016);
    const dt = Math.min(0.05, rawDt);
    last = ts;
    clock += dt;
    R3D.clock = clock;
    R3D.pollInput();
    ui.setTransform(physScale, 0, 0, physScale, 0, 0);

    let dx = 0, phase = 0, cover = 0;
    if (trans.dir === 1) {
      trans.t = Math.min(1, trans.t + rawDt / 0.2);
      cover = ease(trans.t); phase = 1;
      dx = 10 * cover;                      // the old screen drifts with the shutter
      if (trans.t >= 1) {
        const nx = pending; pending = null;
        trans.t = 1; trans.dir = -1;          // move on first, so a throwing
        applyScene(nx);                       // enter() cannot wedge the shutter
      }
    } else if (trans.dir === -1) {
      trans.t = Math.max(0, trans.t - rawDt / 0.24);
      cover = ease(trans.t); phase = -1;
      dx = -10 * cover;                     // the new screen settles into place
      if (trans.t <= 0) {
        trans.dir = 0;
        if (pending) { trans.dir = 1; trans.t = 0; }
      }
    }

    // every frame starts from a clean screen, so a failed draw can never
    // leave the shutter's trail behind
    ui.fillStyle = C.bg0;
    ui.fillRect(0, 0, W, H);
    if (scene) {
      if (trans.dir === 0 && scene.menuMusic && !(scene.musicT > 0)) R3D.ensureMenuMusic();
      R3D.clearHits();
      try { scene.update(dt); } catch (e) { reportError(e); }
      ui.save();
      try {
        if (dx) ui.translate(dx, 0);
        scene.draw(dt);
      } catch (e) { reportError(e); }
      finally { ui.restore(); }
      if (lastErr && clock - lastErr.t < 6) drawError();
    }
    if (phase) drawCover(phase, cover);
    drawToasts(dt);
    dragState.dx = 0;      // drag deltas are per frame
    R3D.clearPressed();
  });
};

// ------------------------------------------------------------------ misc helpers
// the season of the selected track sets the menu backdrop
R3D.uiTheme = function () {
  const t = (R3D.game && R3D.game.trackIdx) || 0;
  const tr = D.tracks[t];
  return (tr && tr.theme) || 'summer';
};

// Menu backdrop: deep rally blue with the title art's swoosh, the season's
// scenery faintly underneath, speed streaks along the slant and a chequered
// hem at the bottom.
let _streaks = null;
R3D.drawBackground = function (theme) {
  const t = clock;
  ui.fillStyle = vgrad(0, H, '#0c2350', '#040a16');
  ui.fillRect(0, 0, W, H);
  const img = theme && R3D.bgCanvas ? R3D.bgCanvas(theme) : null;
  if (img && img.width) {
    const sc = Math.max(W / img.width, H / img.height) * 1.08;
    const w = img.width * sc, h = img.height * sc;
    const drift = Math.sin(t * 0.06) * (w - W) * 0.45;
    ui.save();
    ui.globalAlpha = 0.2;
    ui.drawImage(img, (W - w) / 2 + drift, (H - h) / 2, w, h);
    ui.restore();
  }
  // the swoosh
  ui.save();
  ui.translate(W * 0.1, H * 1.25);
  ui.rotate(-0.18 + Math.sin(t * 0.15) * 0.02);
  for (const [r, lw, a] of [[W * 0.78, 60, 0.2], [W * 0.92, 18, 0.16], [W * 0.62, 10, 0.1]]) {
    const g = ui.createLinearGradient(-r, 0, r, 0);
    g.addColorStop(0, 'rgba(70,150,255,0)');
    g.addColorStop(0.5, 'rgba(70,150,255,' + a + ')');
    g.addColorStop(1, 'rgba(170,215,255,0)');
    ui.strokeStyle = g;
    ui.lineWidth = lw;
    ui.beginPath();
    ui.ellipse(0, 0, r, r * 0.55, 0, Math.PI * 1.05, Math.PI * 1.95);
    ui.stroke();
  }
  ui.restore();
  // speed streaks
  if (!_streaks) {
    _streaks = [];
    for (let i = 0; i < 16; i++) {
      _streaks.push({ y: (i * 53 + 17) % H, sp: 30 + (i * 37) % 60, len: 40 + (i * 29) % 90, o: (i * 131) % 1000 });
    }
  }
  ui.save();
  ui.strokeStyle = 'rgba(170,205,255,0.08)';
  ui.lineWidth = 1;
  for (const s of _streaks) {
    const x = ((s.o + t * s.sp) % (W + 200)) - 100;
    ui.beginPath();
    ui.moveTo(x, s.y);
    ui.lineTo(x + s.len, s.y - s.len * 0.22);
    ui.stroke();
  }
  ui.restore();
  // chequered hem
  ui.save();
  ui.globalAlpha = 0.07;
  checkers(0, H - 10, W, 10, 5, '#ffffff', 'rgba(0,0,0,0)');
  ui.restore();
  // vignette
  const vg = ui.createRadialGradient(W / 2, H / 2, H * 0.3, W / 2, H / 2, W * 0.78);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.5)');
  ui.fillStyle = vg;
  ui.fillRect(0, 0, W, H);
};

// fullscreen (user gesture driven)
R3D.canFullscreen = !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
R3D.toggleFullscreen = function () {
  const el = document.documentElement;
  if (!(document.fullscreenElement || document.webkitFullscreenElement)) {
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  } else if (document.webkitExitFullscreen) {
    document.webkitExitFullscreen();
  }
};

layout();

})();
