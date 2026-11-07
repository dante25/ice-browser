// Ice smoke test: pokreće pravi Ice s debug portom i provjerava sigurnosne funkcije.
// Ice se u testu pokreće dva puta, da se provjeri da izuzeci prežive restart.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const ICE = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const PORT = 9333;
// Zaseban folder podataka: test ne dira tvoj pravi Ice profil (i radi dok je Ice otvoren)
const DATA = `${os.homedir()}/.cache/ice-test-profile`;
fs.rmSync(`${DATA}/exceptions.json`, { force: true }); // svaki test kreće bez izuzetaka

const results = [];
const logs = [];
const check = (name, ok, info) => results.push(`${ok ? 'OK  ' : 'FAIL'} ${name}${info ? `  (${info})` : ''}`);

async function launch() {
  const proc = spawn(`${ICE}/node_modules/.bin/electron`, ['.', `--user-data-dir=${DATA}`, `--remote-debugging-port=${PORT}`, 'https://example.org'], {
    cwd: ICE,
    env: {
      ...process.env,
      ICE_DEBUG: '1',
      ICE_TEST_BLOCK: 'example.net', // tačan host
      ICE_TEST_BLOCK_WILD: 'iana.org,github.com', // domen sa poddomenama; github.com je zaštićena platforma
      ICE_TEST_PERMISSION: 'deny',
    },
  });
  const grab = (d) => logs.push(...String(d).split('\n').filter((l) => l.includes('[ice]')));
  proc.stdout.on('data', grab);
  proc.stderr.on('data', grab);

  let targets;
  for (let i = 0; i < 40; i++) {
    try { targets = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (targets.find((t) => t.type === 'page')) break; } catch {}
    await sleep(500);
  }
  const page = targets?.find((t) => t.type === 'page');
  if (!page) throw new Error('Ice se nije pokrenuo');
  const ws = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0;
  const waiters = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); const w = waiters.get(d.id); if (w) { waiters.delete(d.id); d.error ? w.rej(new Error(d.error.message)) : w.res(d.result); } };
  const cdp = (method, params = {}) => { const i = ++id; ws.send(JSON.stringify({ id: i, method, params })); return new Promise((res, rej) => waiters.set(i, { res, rej })); };
  const evalJs = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result?.value;
  const href = () => evalJs('location.href');
  const go = async (url, wait = 5000) => { await cdp('Page.navigate', { url }); await sleep(wait); return href(); };
  const current = async () => { const h = await cdp('Page.getNavigationHistory'); return h.entries[h.currentIndex].url; };
  await cdp('Page.enable');
  await sleep(3000);
  const stop = async () => { ws.close(); proc.kill(); await sleep(1500); };
  return { cdp, evalJs, href, go, current, stop };
}

let ice;
try {
  ice = await launch();
  const { cdp, evalJs, href, go, current } = ice;

  // 1) HTTPS-first
  let u = await go('http://example.com/');
  check('http -> https prebacivanje', u === 'https://example.com/', u);

  // 2) Stranica bez HTTPS-a -> upozorenje, pa "nastavi"
  u = await go('http://neverssl.com/', 9000);
  check('upozorenje kad https ne radi', u.startsWith('ice://warning/'), u);
  if (u.startsWith('ice://warning/')) {
    await evalJs('document.querySelector("a.go").click()');
    await sleep(6000);
    // Provjeravamo kuda je Ice otišao (historija), ne da li je neverssl server odgovorio:
    // njihov http server ponekad sam prekine vezu, i van Icea.
    u = await current();
    check('"nastavi" otvara http verziju', /^http:\/\/([a-z0-9-]+\.)?neverssl\.com\//.test(u), u);
  }
  const hist = await cdp('Page.getNavigationHistory');
  const errs = hist.entries.filter((e) => e.url.startsWith('chrome-error://') || e.url === 'https://neverssl.com/').length;
  check('nema stranice greške u historiji', errs === 0, hist.entries.map((e) => e.url.slice(0, 40)).join(' | '));

  // 3) Opasna stranica (test domena example.net)
  u = await go('https://example.net/');
  check('opasna stranica blokirana', u.startsWith('ice://warning/'), u);
  const title = await evalJs('document.title');
  check('upozorenje kaže "Opasna stranica"', title === 'Opasna stranica', title);
  await evalJs('document.querySelector("a.btn").click()');
  await sleep(3000);
  u = await href();
  check('"nazad" vodi sa upozorenja', !u.startsWith('ice://warning/'), u);

  // 4) Wildcard liste (malware): domen blokira i poddomene; velike platforme nikad
  u = await go('https://www.iana.org/');
  check('wildcard: poddomena blokirana', u.startsWith('ice://warning/'), u);
  u = await go('https://iana.org/');
  check('wildcard: sam domen blokiran', u.startsWith('ice://warning/'), u);
  u = await go('https://github.com/', 7000);
  check('zaštićena platforma (github.com) nije blokirana', u.startsWith('https://github.com'), u);

  // 5) Obična stranica ne može sama "kliknuti nastavi"
  await go('https://example.com/');
  await evalJs('location.href = "ice://proceed/?t=lazni"');
  await sleep(2000);
  u = await href();
  check('lažni ice://proceed odbijen', u === 'https://example.com/', u);

  // 6) Dozvole (test odgovor: odbij)
  const geo = await evalJs('new Promise(r => navigator.geolocation.getCurrentPosition(() => r("dozvoljeno"), e => r("odbijeno " + e.code)))');
  check('lokacija odbijena', geo === 'odbijeno 1', geo);
  const notif = await evalJs('Notification.requestPermission()');
  check('obavještenja odbijena', notif === 'denied', notif);
  const q = await evalJs('navigator.permissions.query({name:"camera"}).then(r => r.state)');
  check('kamera nije unaprijed odobrena', q !== 'granted', q);

  // 7) GPC zaglavlje
  await go('https://httpbin.org/headers', 7000);
  const body = await evalJs('document.body.innerText');
  check('Sec-GPC: 1 se šalje', /"Sec-Gpc":\s*"1"/i.test(body || ''), (body || '').includes('Gpc') ? 'nađeno' : 'nema u odgovoru');

  // 8) WebRTC ne otkriva lokalnu IP adresu
  const ips = await evalJs(`new Promise(r => { const pc = new RTCPeerConnection({iceServers:[]}); const c = [];
    pc.onicecandidate = e => { if (e.candidate) c.push(e.candidate.candidate); else r(c); };
    pc.createDataChannel('x'); pc.createOffer().then(o => pc.setLocalDescription(o)); setTimeout(() => r(c), 3000); })`);
  const local = (ips || []).filter((c) => /(\s)(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(c));
  check('WebRTC bez lokalne IP adrese', local.length === 0, `${(ips || []).length} kandidata, lokalnih: ${local.length}`);

  // 9) Prave liste učitane (phishing + malware)
  const sizes = logs.map((l) => /liste opasnih stranica (?:spremne|iz keša): (\d+)/.exec(l)?.[1]).filter(Boolean).map(Number);
  const max = Math.max(0, ...sizes);
  check('liste opasnih stranica učitane (> 500.000 domena)', max > 500000, `${max} domena`);

  // 10) Izuzetak preživi restart
  const ex = JSON.parse(fs.readFileSync(`${DATA}/exceptions.json`, 'utf8'));
  check('izuzetak spremljen na disk', !!ex.http?.['neverssl.com'], Object.keys(ex.http || {}).join(', '));
  await ice.stop();
  ice = await launch();
  u = await ice.go('http://neverssl.com/', 9000);
  check('poslije restarta: dozvoljena http stranica bez ponovnog upozorenja', !u.startsWith('ice://warning/') && !(await ice.current()).startsWith('https://'), await ice.current());
} catch (e) {
  results.push(`FAIL test se srušio: ${e.message}`);
} finally {
  console.log(results.join('\n'));
  console.log('\n--- Ice log ---\n' + logs.filter((l) => /liste|izuzetak|greška|historija/.test(l)).join('\n'));
  await ice?.stop();
  fs.rmSync(`${DATA}/exceptions.json`, { force: true });
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
