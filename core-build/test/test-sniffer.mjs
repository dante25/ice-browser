// Poređenje: hvata li Video Sniffer video na istoj stranici u Iceu i u običnom Chromiumu (Playwrightov).
// Upotreba: NODE_PATH=$(npm root -g) node core-build/test/test-sniffer.mjs
import { createRequire } from 'module'; import http from 'http';
import fs from 'fs'; import os from 'os'; import path from 'path';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const REPO = new URL('../..', import.meta.url).pathname;
const VIDEO = 'https://interactive-examples.mdn.mozilla.net/media/cc0-videos/flower.mp4';
const server = http.createServer((q, r) => { r.setHeader('content-type', 'text/html'); r.end(`<!doctype html><title>video test</title><video id=v src="${VIDEO}" muted autoplay playsinline controls width=320></video>`); });
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PAGE = `http://127.0.0.1:${server.address().port}/`;

async function run(label, opts, extraArgs) {
  const prof = fs.mkdtempSync(path.join(os.tmpdir(), 'sniff-'));
  const ctx = await chromium.launchPersistentContext(prof, { headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', ...extraArgs],
    ignoreDefaultArgs: ['--disable-extensions', '--disable-component-extensions-with-background-pages'], ...opts });
  const out = { label };
  try {
    await new Promise((r) => setTimeout(r, 8000));
    const p = await ctx.newPage();
    await p.goto(PAGE); await p.waitForTimeout(9000);
    out.video = await p.evaluate(() => { const v = document.getElementById('v'); return { readyState: v.readyState, currentTime: Math.round(v.currentTime * 10) / 10, error: v.error && v.error.code }; });
    let sw = null;
    for (const w of ctx.serviceWorkers()) { try { if (await w.evaluate(() => chrome.runtime.getManifest().name) === 'Video Sniffer') sw = w; } catch (e) {} }
    out.sw = sw ? new URL(sw.url()).pathname : 'NEMA';
    if (sw) {
      out.found = await sw.evaluate(async () => {
        const s = await chrome.storage.session.get(null);
        const items = Object.entries(s).filter(([k]) => k.startsWith('tab:')).flatMap(([, v]) => (Array.isArray(v) ? v : []));
        return { keys: Object.keys(s).map((k) => k.replace(/\d+/, 'N')), items: items.length, sample: items.slice(0, 2).map((i) => `${String(i.url).slice(-22)} [${i.type || ''} ${i.source || i.via || ''}]`) };
      });
      const tabs = await sw.evaluate(async () => (await chrome.tabs.query({})).map((t) => t.url.slice(0, 30)));
      out.tabs = tabs.length;
    }
  } catch (e) { out.error = e.message.split('\n')[0]; }
  await ctx.close();
  console.log(JSON.stringify(out));
  return out;
}
const ice = fs.existsSync('/opt/ice-browser/chrome') ? await run('Ice', { executablePath: '/opt/ice-browser/chrome' }, []) : null;
const stock = await run('Chromium (Playwright)', {}, ['--disable-features=DisableLoadExtensionCommandLineSwitch', `--load-extension=${REPO}own-extensions/video-sniffer`]);
server.close();
const n = (o) => (o && o.found ? o.found.items : -1);
console.log(`\nVideo Sniffer je uhvatio: Ice ${n(ice)}, obični Chromium ${n(stock)}`);
process.exit(0);
