// Tests an Ice .deb without installing it: unpack, start Ice headless, check the result.
// Usage: NODE_PATH=$(npm root -g) node core-build/test/test-deb.mjs <file.deb>
import { createRequire } from 'module'; import { execFileSync } from 'child_process';
import fs from 'fs'; import os from 'os'; import path from 'path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const deb = path.resolve(process.argv[2]);
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-deb-'));
execFileSync('dpkg', ['-x', deb, root]);
const exe = path.join(root, 'opt/ice-browser/chrome');
const ids = fs.readFileSync(new URL('../README.md', import.meta.url), 'utf8').match(/^\| ([a-p]{32}) \| ([\w-]+) \|/gm)
  .map(l => l.split('|').map(x => x.trim())).map(([, id, dir]) => ({ id, dir }));
let fails = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fails++; };
const ctx = await chromium.launchPersistentContext(fs.mkdtempSync(path.join(os.tmpdir(), 'ice-prof-')), {
  executablePath: exe, headless: true, args: ['--no-sandbox'],
  ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'] });
await new Promise(r => setTimeout(r, 15000));
const workers = ctx.serviceWorkers().map(w => new URL(w.url()).host);
const pages = ctx.pages().map(p => p.url());
const withSw = ids.filter(b => !['screenshot-youtube', 'youtube-nonstop', 'google-images-viewer', 'ice-newtab', 'ice-shield'].includes(b.dir));
for (const b of withSw) ok(workers.includes(b.id), `ugrađena funkcija radi: ${b.dir}`);
// dodaci bez pozadinske skripte (npr. ice-uvoz: samo stranica) se ne broje među servis-workere
const addonDirs = fs.readdirSync(path.join(root, 'opt/ice-browser/dodaci'))
  .filter(d => JSON.parse(fs.readFileSync(path.join(root, 'opt/ice-browser/dodaci', d, 'manifest.json'), 'utf8')).background?.service_worker);
ok(workers.length >= withSw.length + addonDirs.length, `dodaci rade (${addonDirs.join(', ')}); ukupno servis-workera: ${workers.length}`);
ok(pages.every(u => u === 'about:blank' || u.startsWith('chrome://newtab') || u.startsWith('chrome-extension://') && false || u === 'chrome://new-tab-page/'), `nema dobrodošlica-tabova (otvoreno: ${pages.join(' , ')})`);
const p = await ctx.newPage();
try {
  await p.goto('chrome://extensions'); await p.waitForTimeout(1500);
  const text = await p.evaluate(() => document.querySelector('extensions-manager')?.shadowRoot?.textContent || '');
  ok(!/Adblock for Youtube|Default Quality Adjuster|Tab Session Manager/.test(text), 'ugrađene funkcije nisu na chrome://extensions');
} catch (e) { ok(false, 'chrome://extensions: ' + e.message); }
for (const [url, what] of [['chrome://ice-panel/#features', 'Ice panel (kartice)'], ['chrome://settings/iceAdvanced', 'Postavke → Napredne funkcije']]) {
  try { const r = await p.goto(url); await p.waitForTimeout(1500);
    const t = await p.evaluate(() => document.body.innerText + (document.querySelector('settings-ui')?.shadowRoot?.textContent || ''));
    ok(r && r.ok() !== false && t.length > 20, `${what} se otvara`);
    await p.screenshot({ path: path.join(path.dirname(deb), url.replace(/\W+/g, '_') + '.png') });
  } catch (e) { ok(false, `${what}: ${e.message}`); }
}
await ctx.close();
console.log(fails ? `\n${fails} provjera NIJE prošlo` : '\nSve provjere prošle');
process.exit(fails ? 1 : 0);
