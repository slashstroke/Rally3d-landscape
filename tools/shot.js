// Development helper: screenshot the game in a given state with headless
// Chrome, driven over the DevTools protocol so the timing is exact (the
// in-app browser can be unresponsive while the app window is in the
// background, and --virtual-time-budget races the screen transitions).
//
//   node tools/shot.js race cam=hood speed=6 name=hood
//
// Extra key=value pairs are passed to game/_shot.html as query params.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const CHROME_CANDIDATES = [
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
];
const PORT = 9333;
const BASE = process.env.R3D_BASE || 'http://localhost:8091';

const args = process.argv.slice(2);
let name = 'shot';
const query = [];
for (const a of args) {
  if (a.startsWith('name=')) name = a.slice(5);
  else query.push(a);
}
const scene = (query.find((q) => q.startsWith('scene=')) || 'scene=title').slice(6);
const q = query.filter((x) => !x.startsWith('scene=')).join('&');
const url = `${BASE}/game/_shot.html?scene=${scene}${q ? '&' + q : ''}`;

const chrome = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
if (!chrome) { console.error('no chrome found'); process.exit(1); }

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'r3dshot-'));
const proc = spawn(chrome, [
  '--headless=new', '--disable-gpu', '--use-gl=angle', '--use-angle=swiftshader',
  '--hide-scrollbars', '--mute-audio', '--no-first-run', '--no-default-browser-check',
  `--user-data-dir=${profile}`, `--remote-debugging-port=${PORT}`,
  '--window-size=880,495', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function targetWs() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
      const page = list.find((t) => t.type === 'page');
      if (page) return page.webSocketDebuggerUrl;
    } catch (e) { /* not up yet */ }
    await sleep(250);
  }
  throw new Error('chrome did not start');
}

function cdp(ws) {
  let id = 0;
  const pending = new Map();
  ws.addEventListener('message', (ev) => {
    const msg = JSON.parse(ev.data);
    if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  });
  return (method, params) => new Promise((res, rej) => {
    const myId = ++id;
    pending.set(myId, (m) => (m.error ? rej(new Error(m.error.message)) : res(m.result)));
    ws.send(JSON.stringify({ id: myId, method, params: params || {} }));
  });
}

(async () => {
  const wsUrl = await targetWs();
  const ws = new WebSocket(wsUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  const send = cdp(ws);
  await send('Page.enable');
  await send('Runtime.enable');
  // a headless page is treated as hidden, which throttles requestAnimationFrame
  // to a crawl - the game loop would never advance
  await send('Emulation.setFocusEmulationEnabled', { enabled: true });
  await send('Emulation.setDeviceMetricsOverride', {
    width: 880, height: 495, deviceScaleFactor: 1, mobile: false,
  });
  await send('Page.navigate', { url });
  // wait for the harness to signal that it has set the scene up
  let ready = false;
  let title = '';
  for (let i = 0; i < 80; i++) {
    await sleep(250);
    try {
      const r = await send('Runtime.evaluate', { expression: 'document.title', returnByValue: true });
      title = (r.result && r.result.value) || '';
      if (title === 'ready') { ready = true; break; }
      if (title.startsWith('error')) break;
    } catch (e) { /* keep waiting */ }
  }
  await sleep(1200);            // let the transition and the first frames settle
  try {
    const dy = await send('Runtime.evaluate', { expression: 'window.__carY', returnByValue: true });
    if (dy.result && dy.result.value !== undefined) console.log('carY=' + dy.result.value);
  } catch (e) { /* ignore */ }
  const shot = await send('Page.captureScreenshot', { format: 'png' });
  const out = path.join(__dirname, '..', 'shots', name + '.png');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, Buffer.from(shot.data, 'base64'));
  console.log(out + (ready ? '' : '  (harness title: ' + title + ')'));
  ws.close();
  proc.kill();
  await sleep(300);
  try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {}
  process.exit(0);
})().catch((e) => { console.error(e.message); proc.kill(); process.exit(1); });
