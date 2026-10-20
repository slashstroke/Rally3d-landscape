/* Rally 3D — LANDSCAPE edition (mobile first)
   main.js — viewport/scaling, modern UI toolkit, touch + keyboard input,
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
const camera = new THREE.PerspectiveCamera(52, W / H, 1, 128);
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
// The visual language follows a race-timing HUD: translucent grey panels with
// thin white rules, uppercase technical labels, values in bright accents and
// one saturated magenta strip for the clock.
const C = R3D.colors = {
  bg0: '#08090b',
  bg1: '#171a1f',
  panel: 'rgba(122,130,140,0.22)',
  panelHi: 'rgba(150,158,168,0.36)',
  line: 'rgba(255,255,255,0.34)',
  lineSoft: 'rgba(255,255,255,0.16)',
  white: '#ffffff',
  text: '#ffffff',
  dim: 'rgba(224,231,240,0.74)',
  faint: 'rgba(224,231,240,0.42)',
  accent: '#ffc400',      // selection / highlight
  accent2: '#22b4ff',     // info, "on"
  magenta: '#ff2d95',     // the clock strip
  red: '#ff4b4b',
  green: '#5fe08d',
  ink: '#08090b',
};

const FONT = '"Segoe UI", system-ui, -apple-system, Roboto, "Helvetica Neue", Arial, sans-serif';
const NUMF = '"Arial Narrow", "Helvetica Neue", Arial, sans-serif';
R3D.FONT = FONT;
R3D.NUMF = NUMF;

// ------------------------------------------------------------------ drawing helpers
function setFont(size, weight, spacing, num) {
  ui.font = (weight || '700') + ' ' + size + 'px ' + (num ? NUMF : FONT);
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

function panel(x, y, w, h, opt) {
  opt = opt || {};
  roundRect(x, y, w, h, opt.r === undefined ? 2 : opt.r);
  ui.fillStyle = opt.fill || C.panel;
  ui.fill();
  if (opt.border !== false) {
    ui.strokeStyle = opt.borderColor || C.line;
    ui.lineWidth = opt.lw || 1;
    ui.stroke();
  }
}
R3D.panel = panel;

// text: str, x, y, align(0 left|5 center|8 right), color, size, weight, spacing, numeric
function text(str, x, y, align, color, size, weight, spacing, num) {
  setFont(size || 16, weight, spacing, num);
  ui.textAlign = align === 8 ? 'right' : (align === 5 ? 'center' : 'left');
  ui.textBaseline = 'top';
  if (color !== 'transparent') {
    ui.fillStyle = 'rgba(0,0,0,0.45)';
    ui.fillText(str, x + 1, y + 1);
  }
  ui.fillStyle = color || C.text;
  ui.fillText(str, x, y);
}
R3D.text = text;

// small uppercase technical label, the workhorse of the new HUD
function tag(str, x, y, align, color, size, spacing) {
  text(String(str).toUpperCase(), x, y, align, color || C.dim, size || 11, '700', spacing === undefined ? 1.1 : spacing);
}
R3D.tag = tag;

function measure(str, size, weight, spacing, num) {
  setFont(size || 16, weight, spacing, num);
  return ui.measureText(str).width;
}
R3D.measure = measure;

// procedural checkered strip (the original's flag motif, redrawn for the
// landscape header) — crisp at any size, no upscaled pixel art.
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

// ------------------------------------------------------------------ button feedback
// A tapped button flashes for a fraction of a second - the response has to be
// immediate or the screen feels dead on a phone.
const flashes = [];
R3D.flash = function (id) {
  flashes.push({ id: id, t: 0 });
  if (flashes.length > 8) flashes.shift();
};
function flashFor(id) {
  for (let i = flashes.length - 1; i >= 0; i--) {
    if (flashes[i].id === id) {
      const f = flashes[i];
      f.t += 1 / 60;
      if (f.t > 0.22) { flashes.splice(i, 1); return 0; }
      return 1 - f.t / 0.22;
    }
  }
  return 0;
}
R3D.flashFor = flashFor;

function vGradient(x, y, w, h, top, bottom) {
  const g = ui.createLinearGradient(0, y, 0, y + h);
  g.addColorStop(0, top); g.addColorStop(1, bottom);
  ui.fillStyle = g;
  ui.fillRect(x, y, w, h);
}
R3D.vGradient = vGradient;

// simple vector icons (drawn, no assets) -------------------------------
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

function iconPause(x, y, size, color) {
  ui.fillStyle = color;
  const w = size * 0.16, h = size * 0.46;
  ui.fillRect(x - size * 0.26, y - h / 2, w, h);
  ui.fillRect(x + size * 0.10, y - h / 2, w, h);
}
R3D.iconPause = iconPause;

function iconGear(x, y, size, color) {
  // simple gear glyph: circle + spokes
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

// ------------------------------------------------------------------ hit areas
// Immediate-mode: a scene registers its buttons while drawing, the input
// layer resolves pointers against the last drawn frame.
const hit = { holds: [], taps: [], drags: [] };
R3D.hit = hit;
R3D.clearHits = () => { hit.holds.length = 0; hit.taps.length = 0; hit.drags.length = 0; };
R3D.holdArea = (id, x, y, w, h) => { hit.holds.push({ id, x, y, w, h }); };
R3D.tapArea = (id, x, y, w, h, cb) => { hit.taps.push({ id, x, y, w, h, cb }); };
R3D.dragArea = (id, x, y, w, h) => { hit.drags.push({ id, x, y, w, h }); };

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
    let x = e.gamma, y = e.beta;
    if (angle === 90) { x = -e.gamma; y = e.beta; }
    else if (angle === 180) { x = -e.gamma; y = -e.beta; }
    else if (angle === 270) { x = e.gamma; y = -e.beta; }
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
    const p = this.request();
    return p.then((ok) => {
      this.enabled = !!ok;
      if (ok) this.recalibrate();
      return this.enabled;
    });
  },
  disable() { this.enabled = false; this.value = 0; },
};

// ---- pointers (multi touch) ---------------------------------------------
const pointers = new Map();          // pointerId -> {kind:'hold'|'tap', id}

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

uiCanvas.addEventListener('pointerdown', (e) => {
  e.preventDefault();
  AudioSys.ensure();
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

// safety: if the browser never delivers the matching pointerup (a phone
// call, the app going to the background, a stray gesture) the pad would stay
// held forever - release everything when the page loses focus.
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

// merge everything into the driving state each frame
R3D.pollInput = function () {
  const t = tilt.enabled ? tilt.value : 0;
  keys.L = keyState.L || holdCount.L > 0 || t < -0.12;
  keys.R = keyState.R || holdCount.R > 0 || t > 0.12;
  keys.U = keyState.U || holdCount.U > 0;
  keys.D = keyState.D || holdCount.D > 0;
  R3D.tiltActive = tilt.enabled && Math.abs(t) > 0.05;
};

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
    settings: { sound: 2, units: 0, auto: 0, titleSong: 0, tilt: 0, buttons: 1 },
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
  return save;
};
Object.defineProperty(R3D, 'saveObj', { get() { return save; }, set(v) { save = v; } });

function fmtTime(t) {
  if (t < 0) return '-:-';
  const tenth = t % 10, ss = Math.floor(t / 10) % 60, mm = Math.floor(t / 600);
  const ss2 = (ss < 10 ? '0' : '') + ss;
  return mm > 0 ? mm + ':' + ss2 + ':' + tenth : ss + ':' + tenth;
}
R3D.fmtTime = fmtTime;

// ------------------------------------------------------------------ audio
// The ORIGINAL MIDI files from the jar, played through the same General-MIDI
// synthesizer the emulator used (libmidi.wasm / TinySoundFont core). The OGG
// renders stay as an automatic fallback.
const AudioSys = R3D.audio = {
  ctx: null, music: null, _fx: null,
  midiLib: null, musicPlayer: null, sfxPlayer: null, midiBufs: {}, midiFailed: false,
  _pending: null, _starting: false,
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
  async initTiny() {
    if (this.tiny || this.tinyFailed) return this.tiny;
    try {
      if (!window.WebAudioTinySynth) throw new Error('no tinysynth');
      this.tiny = new window.WebAudioTinySynth({ quality: 1, useReverb: 1, voices: 48 });
    } catch (e) { this.tinyFailed = true; }
    return this.tiny;
  },
  async playTinyMidi(name, loop, vol) {
    const t = await this.initTiny();
    if (!t) return false;
    try {
      const buf = await this._midiBuf(name);
      const start = () => {
        t.setMasterVol(Math.min(1, vol * 1.2));
        t.stopMIDI();
        t.loadMIDI(buf.slice(0));
        t.loop = loop ? 1 : 0;
        t.playTick = 0; t.playIndex = 0;
        t.playMIDI();
        this.music = { tiny: t };
      };
      if (!t.actx || t.actx.state !== 'running') {
        this._tinyPending = { name, loop, vol };
        if (t.actx) t.actx.resume().then(() => this._flushTinyPending()).catch(() => {});
        return true;
      }
      start();
      return true;
    } catch (e) { return false; }
  },
  _flushPending() {
    if (this._pending) {
      const p = this._pending; this._pending = null;
      this.play(p.name, p.loop, p.vol);
    }
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
  async playMidi(name, loop, vol) {
    if (!await this.initMidi()) return false;
    try {
      const buf = await this._midiBuf(name);
      if (loop) {
        const p = this.musicPlayer;
        await p.setSequence(buf);
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
      if (loop && !this._pending) this._pending = { name, loop, vol };
      return;
    }
    const v = (vol !== undefined ? vol : 0.6) * (save.settings.sound === 1 ? 0.45 : 1);
    if (loop) {
      if (this._starting) return;
      this._starting = true;
      this.stopMusic();
    }
    const route = (name === 'title' && save.settings.titleSong === 1)
      ? this.playTinyMidi(name, loop, v)
      : this.playMidi(name, loop, v);
    route.then((ok) => {
      if (loop) this._starting = false;
      if (ok || save.settings.sound === 0) return;
      const a = new Audio('assets/audio/' + name + '.ogg');
      a.loop = !!loop;
      a.volume = v;
      a.play().then(() => {
        if (loop) this.music = a; else this._fx = a;
      }).catch(() => {});
    });
  },
  stopMusic() {
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
R3D.clearScene3d = function () {
  if (R3D.scene3d) {
    R3D.scene3d.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
    });
    R3D.scene3d = null;
  }
};

let scene = null;
let pending = null;
let trans = { dir: 0, t: 0 };   // 1 = wipe out, -1 = wipe in
let last = 0;
let clock = 0;

function applyScene(s) {
  scene = s;
  R3D.clearPressed();
  if (s.enter) s.enter();
}

// Screen change: a hard vertical wipe instead of a soft cross-fade. The bar
// sweeps in, the screen swaps at full cover, then the bar sweeps off again -
// 100 ms each way, so it reads as a switch, not a dissolve.
R3D.setScene = function (s) {
  if (pending) return;
  pending = s;
  trans.dir = 1;
  trans.t = 0;
};
R3D.currentScene = () => scene;

R3D.ensureMenuMusic = function () {
  const A = R3D.audio;
  if (!A.music && !A._starting && save.settings.sound !== 0) A.play('title', true, 0.5);
};

// the wipe bar: near-black with a hot leading edge and a short accent trail
function drawWipe(p) {
  const e = p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2;   // ease in-out
  const x = e * (W + 90) - 90;
  ui.fillStyle = C.ink;
  ui.fillRect(0, 0, Math.max(0, x), H);
  if (x > 0) {
    const g = ui.createLinearGradient(x - 46, 0, x, 0);
    g.addColorStop(0, 'rgba(255,196,0,0)');
    g.addColorStop(1, 'rgba(255,196,0,0.30)');
    ui.fillStyle = g;
    ui.fillRect(x - 46, 0, 46, H);
    ui.fillStyle = C.accent;
    ui.fillRect(x - 3, 0, 3, H);
  }
}

// ---- toasts (short messages, e.g. "Progress reset") -----------------------
const toasts = [];
R3D.toast = function (msg, ms) {
  toasts.push({ msg: msg, t: 0, life: ms || 2600 });
  if (toasts.length > 3) toasts.shift();
};
function drawToasts(dt) {
  for (let i = toasts.length - 1; i >= 0; i--) {
    toasts[i].t += dt;
    if (toasts[i].t > toasts[i].life) toasts.splice(i, 1);
  }
  let y = 78;
  for (const t of toasts) {
    const k = t.t / t.life;
    const a = k < 0.1 ? k / 0.1 : (k > 0.85 ? (1 - k) / 0.15 : 1);
    const w = Math.min(W - 40, measure(t.msg, 13, '700') + 40);
    const x = (W - w) / 2;
    ui.save();
    ui.globalAlpha = Math.max(0, Math.min(1, a));
    panel(x, y, w, 34, { r: 2, fill: 'rgba(10,12,15,0.94)', borderColor: C.accent2 });
    tag(t.msg, W / 2, y + 11, 5, C.white, 13, 1);
    ui.restore();
    y += 40;
  }
}

R3D._loop = function () {
  requestAnimationFrame(function frame(ts) {
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (ts - last) / 1000 || 0.016);
    last = ts;
    clock += dt;
    R3D.clock = clock;
    R3D.pollInput();
    ui.setTransform(physScale, 0, 0, physScale, 0, 0);

    if (trans.dir === 1) {
      trans.t = Math.min(1, trans.t + dt / 0.10);
      if (scene) { R3D.clearHits(); scene.update(dt); scene.draw(); }
      drawWipe(trans.t);
      if (trans.t >= 1) {
        const nx = pending; pending = null;
        applyScene(nx);
        trans.t = 0; trans.dir = -1;
      }
    } else if (trans.dir === -1) {
      trans.t = Math.min(1, trans.t + dt / 0.12);
      if (scene) { R3D.clearHits(); scene.update(dt); scene.draw(); }
      drawWipe(1 - trans.t);
      if (trans.t >= 1) trans.dir = 0;
    } else {
      if (scene) {
        if (scene.menuMusic && !(scene.musicT > 0)) R3D.ensureMenuMusic();
        R3D.clearHits();
        scene.update(dt);
        scene.draw();
      }
    }
    drawToasts(dt);
    dragState.dx = 0;      // drag deltas are per frame
    R3D.clearPressed();
  });
};

// ------------------------------------------------------------------ misc helpers
// A plain, slightly lit backdrop - the panels are supposed to be the thing
// that carries the interface, so the background stays quiet.
R3D.drawBackground = function () {
  const g = ui.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#1b1f26');
  g.addColorStop(0.55, '#111419');
  g.addColorStop(1, '#08090b');
  ui.fillStyle = g;
  ui.fillRect(0, 0, W, H);
  // a soft pool of light behind the content
  const v = ui.createRadialGradient(W * 0.42, H * 0.42, 20, W * 0.42, H * 0.42, W * 0.75);
  v.addColorStop(0, 'rgba(150,170,200,0.10)');
  v.addColorStop(1, 'rgba(0,0,0,0)');
  ui.fillStyle = v;
  ui.fillRect(0, 0, W, H);
};

// fullscreen (user gesture driven)
R3D.toggleFullscreen = function () {
  const el = document.documentElement;
  if (!document.fullscreenElement) {
    if (el.requestFullscreen) el.requestFullscreen().catch(() => {});
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
  } else if (document.exitFullscreen) {
    document.exitFullscreen().catch(() => {});
  }
};

layout();

})();
