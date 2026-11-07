// Test pregleda slika: lažna stranica građena kao Google Images (mreža sličica, klik otvara panel
// s velikom slikom). Pravi Google blokira automatske testove, pa se on provjerava ručno.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const ICE = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 9334;
const WEB = 9335;
const PROFILE = `${os.homedir()}/.cache/ice-test-gimages`;
fs.rmSync(PROFILE, { recursive: true, force: true });

const svg = (n, w, h, c) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}"><rect width="100%" height="100%" fill="${c}"/><text x="50%" y="50%" font-size="${w / 6}" text-anchor="middle" fill="#fff">${n}</text></svg>`;
const colors = ['#c0392b', '#2980b9', '#27ae60', '#8e44ad', '#d35400', '#16a085'];
const page = `<!doctype html><html data-ice-test-grid="1"><body style="margin:0;font-family:sans-serif">
<div id="grid" style="display:flex;flex-wrap:wrap;gap:8px;padding:8px;width:60%">
${colors.map((c, i) => `<div role="button" tabindex="0" data-n="${i + 1}"><img alt="slika ${i + 1}" width="120" height="90" src="data:image/svg+xml,${encodeURIComponent(svg(i + 1, 120, 90, c))}"></div>`).join('')}
</div><div id="panel" style="position:fixed;right:0;top:0;width:38%"></div>
<script>
document.getElementById('grid').addEventListener('click', (e) => {
  const t = e.target.closest('[data-n]'); if (!t) return;
  const n = t.dataset.n;
  setTimeout(() => { document.getElementById('panel').innerHTML = '<a href="http://127.0.0.1:${WEB}/izvor' + n + '"><img width="400" src="/big' + n + '.svg"></a>'; }, 300);
});
</script></body></html>`;
const server = http.createServer((req, res) => {
  const m = /^\/big(\d)\.svg$/.exec(req.url);
  if (m) { res.writeHead(200, { 'content-type': 'image/svg+xml' }); return res.end(svg(`VELIKA ${m[1]}`, 1600, 1200, colors[m[1] - 1])); }
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); res.end(page);
}).listen(WEB, '127.0.0.1');

const results = [];
const check = (name, ok, info) => results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${info !== undefined ? `  (${info})` : ''}`);
const proc = spawn(process.execPath, [`${ICE}/bin/ice.js`, `--remote-debugging-port=${PORT}`, '--window-size=1600,900', `http://127.0.0.1:${WEB}/`], {
  env: { ...process.env, ICE_PROFILE: PROFILE, ICE_FOREGROUND: '1' }, detached: true, stdio: 'ignore',
});

try {
  let t = [];
  for (let i = 0; i < 60; i++) { try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.some((x) => x.type === 'page' && x.url.includes(`:${WEB}`))) break; } catch {} await sleep(500); }
  await sleep(2000);
  const ws = new WebSocket(t.find((x) => x.type === 'page' && x.url.includes(`:${WEB}`)).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const w = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); w.get(d.id)?.(d.result); };
  const cdp = (method, params = {}) => new Promise((r) => { w.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (e) => (await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }))?.result?.value;
  const key = async (k, code) => { await cdp('Input.dispatchKeyEvent', { type: 'keyDown', key: k, code, windowsVirtualKeyCode: code === 'ArrowRight' ? 39 : code === 'ArrowLeft' ? 37 : 27 }); await cdp('Input.dispatchKeyEvent', { type: 'keyUp', key: k, code }); };
  const state = () => ev(`(() => { const v = document.getElementById('ice-viewer'); if (!v) return 'nema'; return (v.hidden ? 'zatvoren' : 'otvoren') + '|' + (v.querySelector('.ice-main').getAttribute('src') || '').split('/').pop() + '|' + v.querySelector('.ice-count').textContent + '|' + (v.querySelector('.ice-open-page').href || ''); })()`);

  // Pravi klik mišem na 2. sličicu
  const box = await ev(`(() => { const r = document.querySelectorAll('#grid img')[1].getBoundingClientRect(); return [r.x + r.width / 2, r.y + r.height / 2]; })()`);
  for (const type of ['mousePressed', 'mouseReleased']) await cdp('Input.dispatchMouseEvent', { type, x: box[0], y: box[1], button: 'left', clickCount: 1 });
  await sleep(2500);
  let s = await state();
  check('klik na sliku otvara pregled preko cijele stranice', s.startsWith('otvoren|big2.svg|2 / 6'), s);
  check('link na izvornu stranicu', s.endsWith('/izvor2'), s.split('|')[3]);
  await key('ArrowRight', 'ArrowRight'); await sleep(2500);
  s = await state();
  check('→ sljedeća slika', s.startsWith('otvoren|big3.svg|3 / 6'), s);
  await key('ArrowLeft', 'ArrowLeft'); await sleep(2500);
  s = await state();
  check('← prethodna slika', s.startsWith('otvoren|big2.svg|2 / 6'), s);
  await ev("document.querySelector('#ice-viewer .ice-prev').click()"); await sleep(2500);
  s = await state();
  check('dugme ‹', s.startsWith('otvoren|big1.svg|1 / 6'), s);
  await ev("document.querySelector('#ice-viewer .ice-prev').click()"); await sleep(2500);
  s = await state();
  check('sa prve na zadnju (kružno)', s.startsWith('otvoren|big6.svg|6 / 6'), s);
  if (process.env.ICE_SHOT) {
    const shot = await cdp('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(process.env.ICE_SHOT, Buffer.from(shot.data, 'base64'));
  }
  await key('Escape', 'Escape'); await sleep(500);
  s = await state();
  check('Esc zatvara', s.startsWith('zatvoren'), s);
} catch (e) {
  results.push(`FAIL test se srušio: ${e.message}`);
} finally {
  try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
  server.close();
  await sleep(1500);
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
