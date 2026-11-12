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
