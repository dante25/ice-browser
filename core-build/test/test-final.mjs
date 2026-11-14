// Provjera INSTALIRANOG Ice paketa (/opt/ice-browser): dodaci, popup dodataka, uvoz iz drugog browsera.
// Upotreba (nakon "apt install ./ice-browser_*.deb"): NODE_PATH=$(npm root -g) node core-build/test/test-final.mjs
import { createRequire } from 'module'; import { spawnSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const OPT = '/opt/ice-browser';
const UVOZ_ID = JSON.parse(fs.readFileSync(`${OPT}/uvoz/ice.uvoz.json`, 'utf8')).allowed_origins[0].split('/')[2];
const ADDONS = { 'sn-downloader': 'mphpcefjdbdemmjpplkpaidolnacnlgb', 'video-sniffer': 'bpgjpdfphkgemklhkdiemkjbmamdmcgd' };
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-final-'));
const prof = path.join(T, 'prof'), home = path.join(T, 'home'), src = path.join(home, '.config/google-chrome/Default');
fs.mkdirSync(src, { recursive: true });
fs.writeFileSync(path.join(src, 'Preferences'), '{}');
fs.writeFileSync(path.join(src, 'Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', children: [{ type: 'url', name: 'Uvezen', url: 'https://uvezen.example/' }] } } }));
const env = { ...process.env, ICE_IMPORT_HOME: home, ICE_PROFILE: prof, ICE_TEST_KEY_CHROME: 'k', ICE_TEST_KEY_CHROMIUM: 'k2' };
const launch = () => chromium.launchPersistentContext(prof, { executablePath: `${OPT}/chrome`, headless: true, env, args: ['--no-sandbox'],
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'] });

// 0) Launcher: pokreće Ice, upisuje host uvoza u profil i jednom po paketu popravlja registraciju dodataka
{
  const lp = path.join(T, 'launcher-prof');
  const r0 = spawnSync(`${OPT}/ice-browser`, ['--no-sandbox', '--headless=new', '--dump-dom', 'about:blank'], { env: { ...process.env, ICE_PROFILE: lp }, encoding: 'utf8', timeout: 60000 });
  ok(r0.status === 0 && /<html/.test(r0.stdout), `launcher pokreće Ice (izlaz ${r0.status})`);
  const ver = fs.readFileSync(`${OPT}/VERSION`, 'utf8').trim();
  ok(fs.existsSync(path.join(lp, 'ice-paket-verzija')) && fs.readFileSync(path.join(lp, 'ice-paket-verzija'), 'utf8').trim() === ver, `launcher: oznaka paketa u profilu (${ver})`);
  ok(fs.existsSync(path.join(lp, 'NativeMessagingHosts/ice.uvoz.json')), 'launcher: host uvoza upisan u profil');
}
let ctx = await launch();
await new Promise((r) => setTimeout(r, 12000));
// 1) Dodaci: pozadinska skripta radi, popup ispod ikone je onaj iz manifesta
for (const [dir, id] of Object.entries(ADDONS)) {
  const sw = ctx.serviceWorkers().find((w) => new URL(w.url()).host === id);
  ok(!!sw, `${dir}: pozadinska skripta radi (${sw ? new URL(sw.url()).pathname : 'nema'})`);
  if (!sw) continue;
  const want = JSON.parse(fs.readFileSync(`${OPT}/dodaci/${dir}/manifest.json`, 'utf8')).action.default_popup;
  const got = await sw.evaluate(() => chrome.action.getPopup({}));
  ok(got.endsWith('/' + want), `${dir}: popup ispod ikone je uključen (${got.split('/').slice(3).join('/')})`);
  const p = await ctx.newPage();
  try { await p.goto(`chrome-extension://${id}/${want}`); await p.waitForTimeout(1500);
    ok((await p.evaluate(() => document.body.innerText.trim().length)) > 10, `${dir}: stranica popupa se prikazuje i ostaje otvorena`);
  } catch (e) { ok(false, `${dir}: popup: ${e.message}`); }
  await p.close();
}
// 1b) SN Downloader na Facebooku (bez prijave): skripta na stranici postoji i odgovara na zahtjeve
{
  const fb = await ctx.newPage();
  try {
    await fb.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await fb.waitForTimeout(4000);
    const r = await fb.evaluate(async () => {
      const rpc = (method, args, ms = 20000) => new Promise((res) => {
        const id = 900000 + Math.floor(Math.random() * 1e5); const t0 = Date.now();
        const t = setTimeout(() => { removeEventListener('message', h); res({ error: 'timeout ' + method }); }, ms);
        function h(ev) { const d = ev.data; if (ev.source === window && d && d.__usd === 1 && d.dir === 'res' && d.id === id) { clearTimeout(t); removeEventListener('message', h); res({ ms: Date.now() - t0, result: d.result }); } }
        addEventListener('message', h);
        postMessage({ __usd: 1, dir: 'rpc', id, method, args: args || {} }, location.origin);
      });
      const meta = await rpc('meta');
      const f = await rpc('fetch', { url: location.origin + '/robots.txt', method: 'GET', plain: true, headers: { accept: 'text/plain' } });
      return { hook: typeof window.__usd, fetchWrapped: !/\[native code\]/.test(String(window.fetch)), url: location.href,
        meta: meta.error || `${meta.ms} ms, naslov: ${String(meta.result && meta.result.title).slice(0, 40)}`,
        fetch: f.error || `${f.ms} ms, status ${f.result && f.result.status}${f.result && f.result.error ? ' ' + f.result.error : ''}` };
    });
    console.log('     Facebook proba:', JSON.stringify(r));
    ok(r.hook === 'object', 'sn-downloader: skripta na stranici (main_hook) je učitana na facebook.com');
    ok(!/timeout/.test(r.meta), `sn-downloader: zahtjev prema stranici dobija odgovor (${r.meta})`);
    ok(!/timeout/.test(r.fetch), `sn-downloader: mrežni zahtjev sa stranice se završava (${r.fetch})`);
  } catch (e) { console.log('     Facebook proba nije izvedena: ' + e.message.split('\n')[0]); }
  await fb.close();
}
// 2) Dodatak Uvoz: stranica se otvara, host odgovara, nalazi drugi browser
const p = await ctx.newPage();
try {
  await p.goto(`chrome-extension://${UVOZ_ID}/uvoz.html`); await p.waitForTimeout(4000);
  const text = await p.evaluate(() => document.body.innerText);
  ok(/Google Chrome/.test(text) && /Uvezi i ponovo pokreni Ice/.test(text), `uvoz: host odgovara i nalazi Google Chrome (${text.replace(/\n+/g, ' | ').slice(0, 140)})`);
} catch (e) { ok(false, `uvoz: stranica: ${e.message}`); }
// 3) Ice panel prikazuje dodatak Uvoz
try {
  await p.goto('chrome://ice-panel/#features'); await p.waitForTimeout(2500);
  ok(/Uvoz iz drugog browsera/.test(await p.evaluate(() => document.body.innerText)), 'Ice panel: kartica "Uvoz iz drugog browsera"');
} catch (e) { ok(false, `Ice panel: ${e.message}`); }
await ctx.close();
// 4) Uvoz u pravi Ice profil (Ice zatvoren), pa Ice ponovo otvara profil
const r = spawnSync('python3', [`${OPT}/uvoz/ice-uvoz.py`, '--import', '1', '--json'], { env, encoding: 'utf8' });
ok(r.status === 0 && /1 bookmarksa/.test(r.stdout), `uvoz bookmarksa u Ice profil (${(r.stdout + r.stderr).trim().split('\n').slice(1, 3).join(' ; ')})`);
ctx = await launch();
await new Promise((r2) => setTimeout(r2, 6000));
const sw = ctx.serviceWorkers()[0];
await ctx.close();
ok(fs.readFileSync(path.join(prof, 'Default/Bookmarks'), 'utf8').includes('uvezen.example'), 'Ice otvara profil poslije uvoza, bookmark je tu');
console.log(fails ? `\n${fails} provjera NIJE prošlo` : '\nSve provjere prošle');
process.exit(fails ? 1 : 0);
