// Test Ice sučelja: početna stranica, Ice panel (otvoren kao stranica u širini panela) i meniji
// ugrađenih funkcija unutar panela. ICE_SHOTS=folder sprema snimke (svijetla i tamna).
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import { createRequire } from 'node:module';
import { setTimeout as sleep } from 'node:timers/promises';

const require = createRequire(import.meta.url);
const ICE = new URL('..', import.meta.url).pathname.replace(/\/$/, '');
const { SIDEBAR_ID } = require(`${ICE}/src/builtins.js`);
const PORT = 9336;
const PROFILE = `${os.homedir()}/.cache/ice-test-ui`;
fs.rmSync(PROFILE, { recursive: true, force: true });
const SHOTS = process.env.ICE_SHOTS;

const results = [];
const check = (n, ok, info) => results.push(`${ok ? 'OK  ' : 'FAIL'} ${n}${info !== undefined ? `  (${info})` : ''}`);
const proc = spawn(process.execPath, [`${ICE}/bin/ice.js`, `--remote-debugging-port=${PORT}`, '--window-size=1400,900', 'chrome://newtab/'], {
  env: { ...process.env, ICE_PROFILE: PROFILE, ICE_FOREGROUND: '1' }, detached: true, stdio: 'ignore',
});

async function connect(match) {
  let t = [];
  for (let i = 0; i < 60; i++) { try { t = await (await fetch(`http://127.0.0.1:${PORT}/json`)).json(); if (t.some(match)) break; } catch {} await sleep(500); }
  const ws = new WebSocket(t.find(match).webSocketDebuggerUrl);
  await new Promise((r) => (ws.onopen = r));
  let id = 0; const w = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); w.get(d.id)?.(d.result ?? { error: d.error }); };
  const cdp = (method, params = {}) => new Promise((r) => { w.set(++id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (e) => (await cdp('Runtime.evaluate', { expression: e, awaitPromise: true, returnByValue: true }))?.result?.value;
  return { ws, cdp, ev };
}
const shot = async (c, name) => { if (!SHOTS) return; const s = await c.cdp('Page.captureScreenshot', { format: 'png' }); fs.writeFileSync(`${SHOTS}/${name}.png`, Buffer.from(s.data, 'base64')); };

try {
  fs.mkdirSync(SHOTS || os.tmpdir(), { recursive: true });
  const page = await connect((x) => x.type === 'page');
  await sleep(4000);

  // 1) Početna stranica
  await page.cdp('Page.navigate', { url: 'chrome://newtab/' }); await sleep(2500);
  const ntp = await page.ev("document.querySelector('.logo')?.textContent.trim() + '|' + !!document.getElementById('q')");
  check('Ice početna stranica', ntp === 'ice|true', ntp);
  for (const mode of ['light', 'dark']) {
    await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
    await sleep(300); await shot(page, `pocetna-${mode}`);
  }

  // 2) Panel (u širini panela)
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: 380, height: 860, deviceScaleFactor: 1, mobile: false });
  await page.cdp('Page.navigate', { url: `chrome-extension://${SIDEBAR_ID}/panel.html` }); await sleep(2500);
  const rail = await page.ev("[...document.querySelectorAll('.rail button')].map(b => b.title).join(', ')");
  check('traka s ikonama', /Meni/.test(rail) && /Funkcije/.test(rail) && /Ice postavke/.test(rail), rail);
  const feats = await page.ev("[...document.querySelectorAll('.body .item .t')].map(t => t.textContent)");
  check('panel Funkcije: spisak', Array.isArray(feats) && feats.length >= 15, `${feats?.length} funkcija`);
  const toggles = await page.ev("document.querySelectorAll('.body .sw').length");
  check('prekidači za 3 funkcije', toggles === 3, toggles);
  for (const mode of ['light', 'dark']) {
    await page.cdp('Emulation.setEmulatedMedia', { features: [{ name: 'prefers-color-scheme', value: mode }] });
    await sleep(300); await shot(page, `panel-funkcije-${mode}`);
  }

  // 3) Meni funkcije unutar panela (Default Quality Adjuster) i prekidač
  await page.ev("[...document.querySelectorAll('.body .item')].find(b => /Quality/.test(b.textContent)).click()");
  await sleep(3000);
  // Okvir druge ekstenzije je u zasebnom procesu (OOPIF), pa ga tražimo među DevTools metama
  const frames = (await (await fetch(`http://127.0.0.1:${PORT}/json`)).json()).filter((x) => x.type === 'iframe' && x.url.startsWith('chrome-extension://') && !x.url.includes(SIDEBAR_ID));
  const fr = frames[0] && await connect((x) => x.id === frames[0].id);
  const frText = fr ? await fr.ev('document.body.innerText.slice(0, 40)') : '';
  check('meni funkcije se otvara unutar panela', !!frText, `${frames[0]?.url.slice(0, 60)} | ${String(frText).replace(/\n/g, ' ')}`);
  await shot(page, 'panel-quality-dark');
  await page.ev("document.querySelector('[data-v=features]').click()"); await sleep(1500);
  const before = await page.ev("[...document.querySelectorAll('.body .item')].find(b => /Multiselect/.test(b.textContent)).querySelector('.sw').classList.contains('on')");
  await page.ev("[...document.querySelectorAll('.body .item')].find(b => /Multiselect/.test(b.textContent)).querySelector('.sw').click()"); await sleep(1500);
  const after = await page.ev("[...document.querySelectorAll('.body .item')].find(b => /Multiselect/.test(b.textContent)).querySelector('.sw').classList.contains('on')");
  check('prekidač isključuje/uključuje funkciju', before === true && after === false, `${before} -> ${after}`);
  await page.ev("[...document.querySelectorAll('.body .item')].find(b => /Multiselect/.test(b.textContent)).querySelector('.sw').click()"); await sleep(1000);

  // 4) Bookmarks / historija / preuzimanja / meni se otvaraju
  for (const v of ['menu', 'bookmarks', 'history', 'downloads', 'settings']) {
    await page.ev(`document.querySelector('[data-v=${v}]').click()`); await sleep(1200);
    const h = await page.ev("document.querySelector('.head h1')?.firstChild?.textContent");
    check(`panel: ${v}`, !!h, h);
    if (v === 'menu') await shot(page, 'panel-meni-dark');
  }
} catch (e) {
  results.push(`FAIL test se srušio: ${e.message}`);
} finally {
  try { process.kill(-proc.pid, 'SIGTERM'); } catch {}
  await sleep(1500);
  // Postavke rasporeda u profilu
  try {
    const p = JSON.parse(fs.readFileSync(`${PROFILE}/Default/Preferences`, 'utf8'));
    results.push(`${p.side_panel?.is_right_aligned === true ? 'OK  ' : 'FAIL'} panel desno`);
    results.push(`${p.browser?.show_home_button === true ? 'OK  ' : 'FAIL'} dugme Home`);
    results.push(`${(p.extensions?.pinned_extensions || []).includes(SIDEBAR_ID) ? 'OK  ' : 'FAIL'} Ice ikona zakačena`);
    const theme = p.extensions?.theme?.id;
    results.push(`${theme ? 'OK  ' : 'FAIL'} Ice tema aktivna  (${theme})`);
  } catch (e) { results.push(`FAIL profil: ${e.message}`); }
  console.log(results.join('\n'));
  process.exit(results.some((r) => r.startsWith('FAIL')) ? 1 : 0);
}
