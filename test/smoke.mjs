// Ice smoke test: pokreće pravi Ice (ungoogled-chromium + ugrađene funkcije) u testnom profilu
// i provjerava zaštite i ugrađene funkcije preko DevTools protokola.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const ICE = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 9333;
const PROFILE = process.env.ICE_TEST_PROFILE || `${os.homedir()}/.cache/ice-test-profile`;
fs.rmSync(PROFILE, { recursive: true, force: true });

const results = [];
const check = (name, ok, info) => results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${info !== undefined ? `  (${info})` : ''}`);

const proc = spawn(process.execPath, [`${ICE}/bin/ice.js`, `--remote-debugging-port=${PORT}`, 'https://example.org/'], {
  env: { ...process.env, ICE_PROFILE: PROFILE, ICE_FOREGROUND: '1' },
  detached: true,
  stdio: ['ignore', 'ignore', 'pipe'],
});
const errLines = [];
proc.stderr.on('data', (d) => errLines.push(...String(d).split('\n')));
const stop = async () => { try { process.kill(-proc.pid, 'SIGTERM'); } catch {} await sleep(1500); };

const json = async (p) => (await fetch(`http://127.0.0.1:${PORT}${p}`)).json();
function connect(wsUrl) {
  const ws = new WebSocket(wsUrl);
  let id = 0; const w = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (w.has(d.id)) { w.get(d.id)(d); w.delete(d.id); } };
  const cdp = (method, params = {}) => new Promise((r) => { w.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expression) => {
    const d = await cdp('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    return d.result?.result?.value ?? `ERR ${d.result?.exceptionDetails?.exception?.description?.slice(0, 100)}`;
  };
  return new Promise((r) => { ws.onopen = () => r({ ws, cdp, ev }); });
}

try {
  let targets = [];
  for (let i = 0; i < 60; i++) { try { targets = await json('/json'); if (targets.some((t) => t.type === 'page')) break; } catch {} await sleep(500); }
  await sleep(4000);
  targets = await json('/json');
  const page = await connect(targets.find((t) => t.type === 'page' && !t.url.startsWith('chrome-extension')).webSocketDebuggerUrl);
  await page.cdp('Page.enable');
  const go = async (url, wait = 5000) => { await page.cdp('Page.navigate', { url }); await sleep(wait); return page.ev('location.href'); };

  // Ice Shield worker
  let shield = null;
  for (const t of targets.filter((x) => x.type === 'service_worker' && x.url.startsWith('chrome-extension://'))) {
    const s = await connect(t.webSocketDebuggerUrl);
    if ((await s.ev('chrome.runtime.getManifest().name')) === 'Ice Shield') { shield = s; break; }
    s.ws.close();
  }
  check('Ice Shield radi', !!shield);
  if (!shield) throw new Error('nema Ice Shield workera');
  const size = await shield.ev('iceShield.ensure().then(() => iceShield.size())');
  check('liste opasnih stranica učitane (> 500.000 domena)', size > 500000, `${size} domena`);
  await shield.ev("iceShield.test.exact.add('example.net'); iceShield.test.wild.add('iana.org'); iceShield.test.wild.add('github.com'); true");

  // 1) HTTPS samo
  let u = await go('http://example.com/');
  check('http -> https', u === 'https://example.com/', u);
  u = await go('http://neverssl.com/', 9000);
  check('upozorenje kad HTTPS ne radi', u.includes('/warning.html#https|'), u.slice(0, 80));
  check('upozorenje kaže "nema sigurnu vezu"', /nema sigurnu vezu/.test(await page.ev('document.title')));
  await page.ev("document.getElementById('go').click()");
  await sleep(7000);
  const h = await page.cdp('Page.getNavigationHistory');
  u = h.result ? h.result.entries[h.result.currentIndex].url : (await page.ev('location.href'));
  check('"nastavi" otvara http verziju', /^http:\/\/([a-z0-9-]+\.)?neverssl\.com\//.test(u), u);
  u = await go('http://neverssl.com/', 7000);
  check('http izuzetak vrijedi (bez ponovnog upozorenja)', !u.includes('warning.html'), u);
  u = await go('http://localhost:9/', 3000);
  check('lokalne adrese ostaju http', !u.includes('warning.html') && !u.startsWith('https://localhost'), u);

  // 2) Opasne stranice
  u = await go('https://example.net/', 5000);
  check('opasna stranica blokirana', u.includes('/warning.html#'), u.slice(0, 70));
  check('upozorenje kaže "Opasna stranica"', /Opasna stranica/.test(await page.ev('document.title')));
  await sleep(1000);
  await page.ev("document.getElementById('back').click()");
  await sleep(4000);
  u = await page.ev('location.href');
  check('"nazad" vodi na novi tab', !u.includes('warning.html'), u);
  u = await go('https://www.iana.org/');
  check('wildcard: poddomena blokirana', u.includes('/warning.html#'), u.slice(0, 50));
  u = await go('https://github.com/', 6000);
  check('zaštićena platforma (github.com) nije blokirana', u.startsWith('https://github.com'), u);

  // 3) "Ipak otvori" i izuzetak
  await go('https://example.net/', 5000);
  await page.ev("document.getElementById('go').click()");
  await sleep(5000);
  u = await page.ev('location.href');
  check('"ipak otvori" otvara stranicu', u === 'https://example.net/', u);
  const ex = await shield.ev("chrome.storage.local.get('exceptions').then(r => Object.keys(r.exceptions || {}).join(','))");
  check('izuzetak spremljen', ex.includes('example.net'), ex);
  u = await go('https://example.net/', 5000);
  check('izuzetak vrijedi (bez ponovnog upozorenja)', u === 'https://example.net/', u);
  const forged = await page.ev("typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.sendMessage ? 'moze' : 'ne moze'");
  check('web stranica ne može poslati "ipak otvori"', forged === 'ne moze', forged);

  // 4) GPC
  await go('https://httpbin.org/headers', 6000);
  const body = await page.ev('document.body.innerText');
  check('Sec-GPC: 1 zaglavlje', /"Sec-Gpc":\s*"1"/i.test(body || ''));
  check('navigator.globalPrivacyControl', (await page.ev('navigator.globalPrivacyControl')) === true);

  // 5) Dozvole i WebRTC
  const geo = await page.ev('navigator.permissions.query({name:"geolocation"}).then(r => r.state)');
  check('lokacija nije unaprijed dozvoljena', geo === 'prompt', geo);
  const ips = await page.ev(`new Promise(r => { const pc = new RTCPeerConnection({iceServers:[]}); const c = [];
    pc.onicecandidate = e => { if (e.candidate) c.push(e.candidate.candidate); else r(c); };
    pc.createDataChannel('x'); pc.createOffer().then(o => pc.setLocalDescription(o)); setTimeout(() => r(c), 3000); })`);
  const local = (ips || []).filter((c) => /(\s)(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(c));
  check('WebRTC bez lokalne IP adrese', local.length === 0, `${(ips || []).length} kandidata`);

  // 6) Ugrađene funkcije na YouTubeu
  const worlds = new Set();
  page.ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.method === 'Runtime.executionContextCreated' && d.params.context.auxData?.type === 'isolated') worlds.add(d.params.context.name); });
  await page.cdp('Runtime.enable');
  await go('https://www.youtube.com/watch?v=jNQXAC9IVRw', 12000);
  check('ugrađene funkcije rade na YouTubeu (>= 10)', worlds.size >= 10, `${worlds.size}: ${[...worlds].join(', ').slice(0, 200)}`);

  // 7) Greške ekstenzija u logu
  const errs = [...new Set(errLines.filter((l) => /Uncaught|Extension error|ERROR:.*extension/i.test(l)).map((l) => l.slice(0, 140)))];
  check('bez grešaka ekstenzija u logu', errs.length === 0, errs.slice(0, 3).join(' | '));
} catch (e) {
  results.push(`FAIL test se srušio: ${e.message}`);
} finally {
  await stop();
  // Učitane funkcije (iz profila, poslije gašenja)
  try {
    const prefs = JSON.parse(fs.readFileSync(`${PROFILE}/Default/Preferences`, 'utf8'));
    const n = Object.values(prefs.extensions?.settings || {}).filter((e) => e.location === 8).length;
    const { createBuiltins } = await import(`${ICE}/src/builtins.js`);
    const want = createBuiltins(`${PROFILE}/cfg`, `${PROFILE}/data`).dirs().length;
    results.push(`${n === want ? 'OK  ' : 'FAIL'} učitane ugrađene funkcije (${n} od ${want})`);
  } catch (e) { results.push(`FAIL ne mogu pročitati profil: ${e.message}`); }
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
