// Facebook profile photos WITHOUT scrolling: the page embeds the first 8 photos, the rest (16) exist only behind the
// pagination query (ProfileCometAppCollectionPhotosRendererPaginationQuery, id of the collection + cursor) - ESUIT's method.
// Run: node tests/test_fb_direct.mjs     (needs playwright + openssl)
import { createRequire } from 'module';
import https from 'https';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'extension');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'usd-fb-'));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${tmp}/k.pem -out ${tmp}/c.pem -days 2 -subj /CN=www.facebook.com 2>/dev/null`);

const TOTAL = 24, PER = 8, COLL = 'YXBwX2NvbGxlY3Rpb246MTox';
const JPG = Buffer.from('/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=', 'base64');
const edge = (i) => ({ node: { image: { uri: `https://www.facebook.com/img/grid_${i}.jpg`, width: 200, height: 200 }, url: `https://www.facebook.com/photo.php?fbid=${1000 + i}`, node: { __typename: 'Photo', id: String(1000 + i) } }, cursor: 'c' + i });
const pageOf = (from) => ({ id: COLL, pageItems: { edges: Array.from({ length: Math.min(PER, TOTAL - from) }, (_, k) => edge(from + k)),
  page_info: { end_cursor: 'cur' + (from + PER), has_next_page: from + PER < TOTAL } } });
const seen = { page: [], photo: 0, bad: [] };
const HTML = `<!doctype html><html><head><title>Tester</title><script>
  (function(){ var mm={}, mods={};
    function def(n,v){ mm[n]=1; mods[n]=v; }
    def('ProfileCometAppCollectionPhotosRendererPaginationQuery.graphql',{params:{id:'DOC_PAGE',providedVariables:{}}});
    def('CometPhotoRootContentQuery.graphql',{params:{id:'DOC_PHOTO',providedVariables:{}}});
    mods.__debug={modulesMap:mm}; mods.getAsyncParams=function(){return {fb_dtsg:'T',lsd:'L'}}; mods.RelayAPIConfig={actorID:'7'}; mods.WebPixelRatio={get:function(){return 1}};
    window.require=function(n){ if(!(n in mods)) throw new Error('no module '+n); return mods[n]; }; })();
  </script></head><body><h1>Photos</h1>
  <script type="application/json">${JSON.stringify({ require: [[{ __bbox: { result: { data: { node: pageOf(0) } } } }]] })}</script>
  </body></html>`;
const srv = https.createServer({ key: fs.readFileSync(tmp + '/k.pem'), cert: fs.readFileSync(tmp + '/c.pem') }, (rq, rs) => {
  const u = new URL(rq.url, 'https://www.facebook.com');
  if (u.pathname.startsWith('/img/')) { rs.writeHead(200, { 'content-type': 'image/jpeg', 'access-control-allow-origin': '*' }); return rs.end(JPG); }
  if (rq.method === 'POST' && u.pathname === '/api/graphql/') {
    let b = ''; rq.on('data', (d) => (b += d)); rq.on('end', () => {
      const q = new URLSearchParams(b), v = JSON.parse(q.get('variables') || '{}'), doc = q.get('doc_id');
      rs.writeHead(200, { 'content-type': 'text/html' });
      if (doc === 'DOC_PAGE' && v.id === COLL && /^cur\d+$/.test(v.cursor || '')) { seen.page.push(v); return rs.end(JSON.stringify({ data: { node: pageOf(Number(v.cursor.slice(3))) } })); }
      if (doc === 'DOC_PHOTO' && v.nodeID) { seen.photo++; return rs.end(JSON.stringify({ data: { currMedia: { __typename: 'Photo', id: v.nodeID, image: { uri: `https://www.facebook.com/img/full_${v.nodeID}.jpg`, width: 2000, height: 1500 }, owner: { id: '1', name: 'Tester' } } } })); }
      seen.bad.push({ doc, v }); rs.end(JSON.stringify({ errors: [{ message: 'bad request', severity: 'CRITICAL' }] }));
    }); return;
  }
  rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); rs.end(HTML);
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
const port = srv.address().port;
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const ctx = await chromium.launchPersistentContext(tmp + '/profile', { headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=MAP www.facebook.com 127.0.0.1:${port}`] });
try {
  let sw; for (let i = 0; i < 60 && !sw; i++) { sw = ctx.serviceWorkers().find((w) => w.url().endsWith('background/sw.js')); if (!sw) await new Promise((r) => setTimeout(r, 500)); }
  const id = sw.url().split('/')[2];
  const mgr = await ctx.newPage(); await mgr.goto(`chrome-extension://${id}/ui/manager.html`);
  await mgr.evaluate(async () => { const m = await import(chrome.runtime.getURL('background/fsstore.js')); await m.setRoot(await navigator.storage.getDirectory()); await new Promise((r) => chrome.runtime.sendMessage({ t: 'folder:changed' }, r)); });
  const page = await ctx.newPage(); await page.goto('https://www.facebook.com/profile.php?id=1&sk=photos'); await page.waitForTimeout(1500);
  const started = await mgr.evaluate(async () => { const t = (await chrome.tabs.query({})).find((t) => t.url && t.url.startsWith('https://www.facebook.com/')); return new Promise((r) => chrome.tabs.sendMessage(t.id, { t: 'start', sel: { photos: true, videos: false, storyreel: false }, speed: 'fast' }, r)); });
  console.log('start ->', JSON.stringify(started));
  let st; const end = Date.now() + 240000;
  while (Date.now() < end) { st = await mgr.evaluate(() => new Promise((r) => chrome.runtime.sendMessage({ t: 'state' }, r))); if (st && st.jobs && st.jobs.length && st.jobs.every((j) => ['done', 'error', 'canceled', 'interrupted'].includes(j.status))) break; await new Promise((r) => setTimeout(r, 700)); }
  const files = await mgr.evaluate(async () => { const out = []; async function walk(d, p) { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + n + '/'); else out.push(p + n); } } await walk(await navigator.storage.getDirectory(), ''); return out.sort(); });
  const job = st.jobs[0] || {};
  console.log('job:', job.status, job.error || '', '| pagination requests:', seen.page.length, '| full-size requests:', seen.photo, '| bad:', JSON.stringify(seen.bad).slice(0, 300));
  ok(job.status === 'done', 'job finished');
  ok(seen.page.length === 2, `the pagination query was sent for every further page (2), got ${seen.page.length}`);
  ok(seen.page.every((v) => v.id === COLL && v.count === 8 && v.scale === 1), 'variables: id of the collection, count 8, scale from the page');
  ok(files.filter((f) => /\.jpe?g$/i.test(f)).length === TOTAL, `all ${TOTAL} photos saved (not only the 8 in the page), got ${files.filter((f) => /\.jpe?g$/i.test(f)).length}`);
  ok(seen.bad.length === 0, 'no malformed request');
} finally { await ctx.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
process.exit(fail ? 1 : 0);
