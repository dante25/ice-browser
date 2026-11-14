// Gallery on a stock site: the first page has links to picture pages and rel="next"; every picture page publishes its image (og:image).
// Run: node tests/test_stock.mjs   (needs playwright + openssl)
import { createRequire } from 'module';
import https from 'https'; import fs from 'fs'; import os from 'os'; import path from 'path';
import { execSync } from 'child_process'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usd-stock-'));
const EXT = tmp + '/ext'; fs.cpSync(SRC, EXT, { recursive: true });
const mf = JSON.parse(fs.readFileSync(EXT + '/manifest.json', 'utf8')); mf.host_permissions.push('<all_urls>'); fs.writeFileSync(EXT + '/manifest.json', JSON.stringify(mf));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${tmp}/k.pem -out ${tmp}/c.pem -days 2 -subj /CN=mock 2>/dev/null`);
const JPG = Buffer.concat([Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64'), Buffer.alloc(30000, 7)]);
const PER = 4, PAGES = 3;                                                  // 12 pictures in 3 pages
const detail = (site, i) => site === 'dreamstime' ? `/stock-photo-model-${i}-image${50000000 + i}` : site === 'pexels' ? `/photo/shot-${3000 + i}/` : `/photo_${100000 + i}_woman-${i}.html`;
const srv = https.createServer({ key: fs.readFileSync(tmp + '/k.pem'), cert: fs.readFileSync(tmp + '/c.pem') }, (rq, rs) => {
  const h = rq.headers.host.split(':')[0], u = new URL(rq.url, 'https://' + h), p = u.pathname;
  const site = /dreamstime/.test(h) ? 'dreamstime' : /pexels/.test(h) ? 'pexels' : '123rf';
  if (p.startsWith('/img/')) { const b = /logo/.test(p) ? JPG.subarray(0, 800) : JPG; rs.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': b.length }); return rs.end(b); }
  rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  const pg = Number(u.searchParams.get('pg') || 1);
  if (p === '/gallery') {
    let b = ''; for (let k = 0; k < PER; k++) b += `<a href="${detail(site, (pg - 1) * PER + k)}">pic</a>`;
    b += '<a href="/about">About</a><a href="/img/logo-small.jpg">logo</a>';
    return rs.end(`<!doctype html><title>Gallery</title>${pg < PAGES ? `<link rel="next" href="/gallery?pg=${pg + 1}">` : ''}<body>${b}</body>`);
  }
  const id = (p.match(/(\d+)/g) || []).pop();
  const og = site === 'pexels' ? `https://${h}/img/pexels-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630` : `https://${h}/img/${site}-${id}.jpg?s=preview`;
  rs.end(`<!doctype html><title>Picture</title><meta property="og:image" content="${og.replace(/&/g, '&amp;')}"><body>picture ${id}</body>`);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const hosts = ['www.dreamstime.com', 'www.pexels.com', 'fr.123rf.com'];
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const ctx = await chromium.launchPersistentContext(tmp + '/profile', { headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=${hosts.map((x) => `MAP ${x} 127.0.0.1:${srv.address().port}`).join(', ')}`] });
try {
  let sw; for (let i = 0; i < 60 && !sw; i++) { sw = ctx.serviceWorkers().find((w) => w.url().endsWith('background/sw.js')); if (!sw) await new Promise((r) => setTimeout(r, 500)); }
  const id = sw.url().split('/')[2];
  const mgr = await ctx.newPage(); await mgr.goto(`chrome-extension://${id}/ui/manager.html`);
  await mgr.evaluate(async () => { const m = await import(chrome.runtime.getURL('background/fsstore.js')); await m.setRoot(await navigator.storage.getDirectory()); await new Promise((r) => chrome.runtime.sendMessage({ t: 'folder:changed' }, r)); });
  await mgr.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ t: 'settings:set', settings: { ihMinKB: 5 } }, r)));
  for (const host of hosts) {
    const page = await ctx.newPage(); await page.goto(`https://${host}/gallery`); await page.waitForTimeout(1200);
    const started = await mgr.evaluate(async (host) => { const t = (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith('https://' + host + '/')); await chrome.scripting.executeScript({ target: { tabId: t.id }, files: ['content/common.js', 'content/ih.js', 'content/bridge.js'] }); await new Promise((r) => setTimeout(r, 500)); return new Promise((r) => chrome.tabs.sendMessage(t.id, { t: 'start', sel: { photos: true, videos: true, storyreel: true }, speed: 'fast' }, r)); }, host);
    console.log(host, 'start ->', JSON.stringify(started));
    let st; const end = Date.now() + 120000;
    while (Date.now() < end) { st = await mgr.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ t: 'state' }, r))); const j = st?.jobs?.find((x) => x.id === started.jobId); if (j && ['done', 'error', 'canceled', 'interrupted'].includes(j.status)) break; await new Promise((r) => setTimeout(r, 700)); }
    const files = await mgr.evaluate(async () => { const out = []; async function walk(d, p) { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + n + '/'); else out.push(p + n); } } await walk(await navigator.storage.getDirectory(), ''); return out; });
    const mine = files.filter((f) => /\.jpe?g$/i.test(f) && new RegExp(host.replace(/^\w+\./, '').split('.')[0], 'i').test(f.split('_').join('/') + f));
    const j = st.jobs.find((x) => x.id === started.jobId);
    console.log(host, '->', JSON.stringify({ id: j.id, status: j.status, error: j.error, found: j.found, done: j.done, total: j.total, warn: j.warn }), '| jpg files so far:', files.filter((f) => /\.jpe?g$/i.test(f)).length);
    ok(j.status === 'done', `${host}: job finished`);
    await page.close();
  }
  const all = await mgr.evaluate(async () => { const out = []; async function walk(d, p) { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + n + '/'); else out.push(p + n); } } await walk(await navigator.storage.getDirectory(), ''); return out; });
  const jpg = all.filter((f) => /\.jpe?g$/i.test(f));
  for (const [needle, label] of [['dreamstime', 'Dreamstime'], ['pexels', 'Pexels'], ['123rf', '123rf (fr.)']]) {
    const n = jpg.filter((f) => f.toLowerCase().includes(needle)).length;
    ok(n === PER * PAGES, `${label}: all ${PER * PAGES} pictures of the ${PAGES}-page gallery saved (not only the first page), got ${n}`);
  }
  ok(!jpg.some((f) => /logo-small/.test(f)), 'a small direct image link (logo) is skipped as a thumbnail');
  console.log(jpg.filter((f) => !/-5000|pexels-|123rf-/.test(f)).join('\n') || '(only gallery pictures)');
} finally { await ctx.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
process.exit(fail ? 1 : 0);
