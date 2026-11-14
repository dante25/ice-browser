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
const detail = (site, i) => site === 'newstock' ? `/pic/${700 + i}/` : site === 'shutterstock' ? `/x/p${900000 + i}z` : site === 'dreamstime' ? `/stock-photo-model-${i}-image${50000000 + i}` : site === 'pexels' ? `/photo/shot-${3000 + i}/` : `/photo_${100000 + i}_woman-${i}.html`;
const srv = https.createServer({ key: fs.readFileSync(tmp + '/k.pem'), cert: fs.readFileSync(tmp + '/c.pem') }, (rq, rs) => {
  const h = rq.headers.host.split(':')[0], u = new URL(rq.url, 'https://' + h), p = u.pathname;
  const site = /newstock/.test(h) ? 'newstock' : /dreamstime/.test(h) ? 'dreamstime' : /pexels/.test(h) ? 'pexels' : /shutterstock/.test(h) ? 'shutterstock' : '123rf';
  if (h === 'previews.123rf.com' || h === 'us.123rf.com') { dsHits.rf.push(h + u.pathname); const b = JPG; rs.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': b.length }); return rs.end(b); }
  if (h === 'fr.123rf.com' && /^\/photo_\d+_/.test(p)) dsHits.rfPage++;
  if (h === 'hostfile.example') {   // the rules file the extension downloads: the shipped file plus a rule for a site the extension has never heard of
    newHits.hostfile++;
    const extra = `<host id="newstock.com">\n<urlpattern>^https?:\\/\\/www\\.newstock\\.com\\/pic\\/(\\d+)\\/?$</urlpattern>\n<searchpattern><![CDATA[CARD: ${JSON.stringify({ thumb: '^https?:\\/\\/www\\.newstock\\.com\\/t\\/(\\d+)\\.jpg', make: 'https://www.newstock.com/big/{t1}-{l1}.jpg' })}]]></searchpattern>\n</host>\n`;
    rs.writeHead(200, { 'content-type': 'application/xml', 'access-control-allow-origin': '*' });
    return rs.end(fs.readFileSync(path.join(SRC, 'ihg/stock.xml'), 'utf8').replace('</root>', extra + '</root>'));
  }
  if (h === 'www.newstock.com' && p.startsWith('/big/')) { newHits.big.push(p); const b = JPG; rs.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': b.length }); return rs.end(b); }
  if (h === 'www.newstock.com' && /^\/pic\/\d+\/?$/.test(p)) newHits.page++;
  if (h === 'thumbs.dreamstime.com') { dsHits.direct.push(u.pathname + u.search); const b = JPG; rs.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': b.length }); return rs.end(b); }
  if (h === 'www.dreamstime.com' && /-image\d+/.test(p)) dsHits.page++;
  if (p.startsWith('/t/')) { const b = JPG.subarray(0, 800); rs.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': b.length }); return rs.end(b); }
  if (p.startsWith('/img/')) { const b = /logo/.test(p) ? JPG.subarray(0, 800) : JPG; rs.writeHead(200, { 'content-type': 'image/jpeg', 'content-length': b.length }); return rs.end(b); }
  rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  const pg = Number(u.searchParams.get('pg') || 1);
  if (p === '/gallery') {
    let b = ''; for (let k = 0; k < PER; k++) b += `<a href="${detail(site, (pg - 1) * PER + k)}">${site === 'newstock' ? `<img src="/t/${(pg - 1) * PER + k}.jpg">` : site === 'shutterstock' ? '<img src="/img/thumb.jpg" width=50>' : site === '123rf' ? `<img src="https://us.123rf.com/450wm/usr/usr1907/usr19070000${(pg - 1) * PER + k}/usr19070000${(pg - 1) * PER + k}-woman-${(pg - 1) * PER + k}.jpg?ver=6">` : 'pic'}</a>`;
    b += '<a href="/x/p999999z">Menu item without a picture</a>';
    if (site === 'dreamstime') { b += `<a href="/gallery?pg=1">1</a><a href="/gallery?pg=${pg + 1}">${pg + 1}</a><a href="/gallery?pg=${pg + 5}">far</a>`; if (pg >= PAGES) b = b.replace(/<a href="\/gallery\?pg=\d+">(?:\d+|far)<\/a>/g, ''); }
    b += '<a href="/about">About</a><a href="/img/logo-small.jpg">logo</a>';
    return rs.end(`<!doctype html><title>Gallery</title>${pg < PAGES && site !== 'dreamstime' ? `<link rel="next" href="/gallery?pg=${pg + 1}">` : ''}<body>${b}</body>`);
  }
  if (site === 'shutterstock' && p === '/x/p999999z') { return rs.end('<!doctype html><title>Menu</title>nothing'); }
  const id = (p.match(/(\d+)/g) || []).pop();
  const og = site === 'pexels' ? `https://${h}/img/pexels-${id}.jpeg?auto=compress&cs=tinysrgb&w=1200&h=630` : `https://${h}/img/${site}-${id}.jpg?s=preview`;
  rs.end(`<!doctype html><title>Picture</title><meta property="og:image" content="${og.replace(/&/g, '&amp;')}"><body>picture ${id}</body>`);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const hosts = ['www.dreamstime.com', 'thumbs.dreamstime.com', 'www.pexels.com', 'fr.123rf.com', 'www.shutterstock.com', 'us.123rf.com', 'previews.123rf.com', 'www.newstock.com', 'hostfile.example'];
const newHits = { page: 0, big: [], hostfile: 0 };
const dsHits = { page: 0, direct: [], rfPage: 0, rf: [] };
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const ctx = await chromium.launchPersistentContext(tmp + '/profile', { headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=${hosts.map((x) => `MAP ${x} 127.0.0.1:${srv.address().port}`).join(', ')}`] });
try {
  let sw; for (let i = 0; i < 60 && !sw; i++) { sw = ctx.serviceWorkers().find((w) => w.url().endsWith('background/sw.js')); if (!sw) await new Promise((r) => setTimeout(r, 500)); }
  const id = sw.url().split('/')[2];
  const mgr = await ctx.newPage(); await mgr.goto(`chrome-extension://${id}/ui/manager.html`);
  await mgr.evaluate(async () => { const m = await import(chrome.runtime.getURL('background/fsstore.js')); await m.setRoot(await navigator.storage.getDirectory()); await new Promise((r) => chrome.runtime.sendMessage({ t: 'folder:changed' }, r)); });
  await mgr.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ t: 'settings:set', settings: { ihMinKB: 5 } }, r)));
  // the rules file: point the extension at the mock address and download it (as it does by itself every few hours)
  await mgr.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ t: 'settings:set', settings: { ihUpdateUrl: 'https://hostfile.example/stock.xml' } }, r)));
  const upd = await mgr.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ t: 'ih:update' }, r)));
  const stat = await mgr.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ t: 'ih:status' }, r)));
  console.log('update ->', JSON.stringify(upd), '| status', JSON.stringify(stat));
  ok(upd.ok && upd.hosts === 33, `rules downloaded from the update address (32 shipped + 1 new = 33), got ${upd.hosts}`);
  for (const host of hosts.filter((x) => !/^(thumbs|us|previews|hostfile)\./.test(x))) {
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
  for (const [needle, label] of [['dreamstime', 'Dreamstime'], ['pexels', 'Pexels'], ['123rf', '123rf (fr.)'], ['shutterstock', 'Shutterstock (addresses no rule knows, picture cards found by their thumbnail)'], ['newstock', 'newstock.com (a site only the downloaded rules file knows)']]) {
    const n = jpg.filter((f) => f.toLowerCase().includes(needle)).length;
    ok(n === PER * PAGES, `${label}: all ${PER * PAGES} pictures of the ${PAGES}-page gallery saved (not only the first page), got ${n}`);
  }
  ok(dsHits.page === 0, `Dreamstime: no picture page was fetched (address computed from the link), fetched ${dsHits.page}`);
  ok(dsHits.direct.length === 12 && dsHits.direct.every((x) => /^\/b\/stock-photo-model-\d+-5\d{7}\.jpg\?w=992$/.test(x)), `Dreamstime: 12 requests to thumbs.dreamstime.com/b/<title>-<id>.jpg?w=992, got ${dsHits.direct.length} e.g. ${dsHits.direct[0]}`);
  ok(dsHits.rfPage === 0, `123rf: no picture page was fetched, fetched ${dsHits.rfPage}`);
  const rfPrev = dsHits.rf.filter((x) => x.startsWith('previews.123rf.com'));
  ok(rfPrev.length === 12 && rfPrev.every((x) => /^previews\.123rf\.com\/images\/usr\/usr1907\/usr19070000\d+\/1000\d{2}-woman-\d+\.jpg$/.test(x)), `123rf: 12 preview urls built as previews.123rf.com/images/<user>/<folder>/<code>/<id>-<title>.jpg, got ${rfPrev.length} e.g. ${rfPrev[0]}`);
  ok(newHits.page === 0 && newHits.big.length === 12 && newHits.big.every((x) => /^\/big\/\d+-7\d\d\.jpg$/.test(x)), `newstock.com: 12 images from the downloaded CARD rule, no picture page fetched (pages ${newHits.page}, big ${newHits.big.length} e.g. ${newHits.big[0]})`);
  ok(!jpg.some((f) => /logo-small/.test(f)), 'a small direct image link (logo) is skipped as a thumbnail');
  console.log(jpg.filter((f) => !/-5000|pexels-|123rf-/.test(f)).join('\n') || '(only gallery pictures)');
} finally { await ctx.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
process.exit(fail ? 1 : 0);
