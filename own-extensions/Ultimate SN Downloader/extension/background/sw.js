/* Ultimate SN Downloader — service worker: job registry, pacing (anti-ban), cooldown, download queue, progress window. */
import { PROFILES, FB_PROFILES, nextDelay, cooldownFor } from './throttle.js';
import { getRoot, permission, writeFile } from './fsstore.js';
import { parseHostFile, setHosts, hostCount, matchRule, isDirectImage, runStringRule, needsPage, isFunctionRule, baseName } from './ih.js';

const DEFAULTS = { ihMinKB: 20, speed: 'normal', subfolder: '', layout: '{site}/{owner}/{type}', template: '{owner}_{date}_{code}_{index}', photos: true, videos: true, storyreel: true };
const SITE_NAME = { ig: 'Instagram', fb: 'Facebook', x: 'X', da: 'DeviantArt', fl: 'Flickr', ih: 'Images' };
const SITE_TABS = { ig: ['https://www.instagram.com/*'], fb: ['https://www.facebook.com/*', 'https://web.facebook.com/*'], x: ['https://x.com/*', 'https://twitter.com/*'],
  da: ['https://www.deviantart.com/*'], fl: ['https://www.flickr.com/*'], ih: ['http://*/*', 'https://*/*'] };
const SITES = Object.keys(SITE_NAME);
const strict = site => site === 'fb' || site === 'x';          // sites that punish request volume: slower profiles
const S = { jobs: {}, settings: { ...DEFAULTS }, block: Object.fromEntries(Object.keys(SITE_NAME).map(k => [k, { until: 0, level: 0, last: 0 }])),
  totals: { ig: 0, fb: 0, x: 0, da: 0, fl: 0, ih: 0, bytes: 0 }, pendingKeys: new Set(), pacing: Object.fromEntries(Object.keys(SITE_NAME).map(k => [k, { next: 0, count: 0, hour: [] }])),
  ports: {}, waiting: {}, dl: {}, names: [], folder: { set: false, name: '', permission: 'none' }, managerWindow: null };
chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [9001], addRules: [{ id: 9001, priority: 1,
  action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: 'https://www.deviantart.com/' }] },
  condition: { requestDomains: ['wixmp.com', 'deviantart.net', 'deviantart.com'], resourceTypes: ['xmlhttprequest', 'other'], tabIds: [-1] } }] }).catch(() => {});
let nextJobId = 1, ready = null, saveTimer = null, seenTimer = null, broadcastTimer = null;

// ------------------------------------------------------------------ persistence
async function load() {
  const st = await chrome.storage.local.get(['jobs', 'settings', 'block', 'totals', 'nextJobId']);
  chrome.storage.local.remove(['seen_ig', 'seen_fb']);          // older versions kept a download history: it is gone for good
  S.settings = { ...DEFAULTS, ...(st.settings || {}) };
  if (st.block) for (const k of Object.keys(SITE_NAME)) S.block[k] = { ...S.block[k], ...(st.block[k] || {}) };
  S.totals = { ig: 0, fb: 0, x: 0, da: 0, fl: 0, ih: 0, bytes: 0, ...(st.totals || {}) };
  nextJobId = st.nextJobId || 1;
  S.jobs = st.jobs || {};
  for (const j of Object.values(S.jobs)) {
    if (['done', 'error', 'canceled', 'interrupted'].includes(j.status)) continue;
    // work that was running when the browser closed: scanning cannot continue by itself, queued files can
    if (!j.scanDone && !j.navigating) { j.scanDone = true; j.scanInterrupted = true; j.note = 'Scan stopped when the browser was closed. Queued files are still saved - press Resume to continue the scan.'; }
    j.cursors = j.cursors || {}; j.partsDone = j.partsDone || {}; j.failedItems = j.failedItems || []; j.doneKeys = j.doneKeys || {};
    j.paused = j.paused || false;
    for (const m of j.queue) S.pendingKeys.add(m.site + ':' + m.key);
  }
  for (const k of Object.keys(SITE_NAME)) pumpDownloads(k);
}
function ensure() { return ready || (ready = load()); }
ensure();

function saveSoon() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => chrome.storage.local.set({ jobs: S.jobs, settings: S.settings, block: S.block, totals: S.totals, nextJobId }), 1200);
}
function publicJob(j) { const { queue, steps, cursors, partsDone, failedItems, doneKeys, unknown, ...rest } = j; return { ...rest, queued: queue.length, failedKept: (failedItems || []).length, canResume: !!(j.cursors && Object.keys(j.cursors).length) }; }
function broadcastSoon() {
  if (broadcastTimer) return;
  broadcastTimer = setTimeout(() => {
    broadcastTimer = null;
    chrome.runtime.sendMessage({ t: 'state:update', ...snapshot() }).catch(() => {});
  }, 250);
  saveSoon();
}
function snapshot() {
  return { jobs: Object.values(S.jobs).sort((a, b) => b.id - a.id).map(publicJob), block: S.block, settings: S.settings, now: Date.now(), names: S.names, folder: S.folder, totals: S.totals, ihCount: S.ihCount || 0 };
}

// ------------------------------------------------------------------ jobs
function statusOf(j) {
  if (['done', 'error', 'canceled', 'interrupted'].includes(j.status)) return j.status;
  if (j.paused) return 'paused';
  if (!j.scanDone && Date.now() < S.block[j.site].until) return 'cooling';
  if (!j.scanDone || j.resolving) return 'scanning';
  return 'downloading';
}
function touch(j) {
  j.status = statusOf(j);
  broadcastSoon();
}
function finishIfDone(j) {
  if (!j.scanDone || j.resolving || j.queue.length || j.active || ['done', 'error', 'canceled', 'interrupted'].includes(j.status)) return;
  j.status = j.scanInterrupted ? 'interrupted' : j.error ? 'error' : 'done';
  j.endedAt = Date.now();
  broadcastSoon();
}
function scanView(j) { return { id: j.id, site: j.site, target: j.target || null, sel: j.sel, speed: j.speed, opts: j.opts, steps: j.steps, stepIndex: j.stepIndex, stopAtKnown: j.stopAtKnown, cursors: j.cursors, partsDone: j.partsDone }; }
function createJob(msg, tabId) {
  const id = nextJobId++;
  const sp = PROFILES[msg.speed] ? msg.speed : S.settings.speed;
  const j = { id, site: msg.site, type: msg.type, label: msg.label || msg.type, url: msg.url, target: msg.target || null, sel: msg.sel, speed: sp, opts: msg.opts || {}, steps: msg.steps || [], stepIndex: 0,
    stopAtKnown: !!msg.stopAtKnown, tabId, status: 'scanning', phase: 'Starting', scanned: 0, total: 0, found: 0, downloaded: 0, skipped: 0, failed: 0, bytes: 0,
    startedAt: Date.now(), endedAt: 0, error: '', note: '', warn: '', paused: false, scanInterrupted: false, resolving: 0, unknown: {}, page: msg.page || null, failWhy: [], cursors: {}, partsDone: {}, failedItems: [], doneKeys: {}, scanDone: false, navigating: false, queue: [], active: 0, parts: {}, log: [] };
  S.jobs[id] = j;
  if (!(msg.opts && msg.opts.chromeDl)) openManager();
  broadcastSoon();
  return j;
}
function jobLog(j, msg) { j.log.push(new Date().toLocaleTimeString() + ' ' + msg); if (j.log.length > 60) j.log.shift(); }

// ------------------------------------------------------------------ pacing (the anti-ban part)
const IH_PROFILES = { quiet: { api: [2, 5], scroll: [1, 2], file: [0.6, 1.5], burst: 0, burstBreak: [0, 0], hourlyApi: 0 }, safe: { api: [0.8, 2], scroll: [1, 2], file: [0.3, 0.8], burst: 0, burstBreak: [0, 0], hourlyApi: 0 },
  normal: { api: [0.15, 0.6], scroll: [1, 2], file: [0.05, 0.25], burst: 0, burstBreak: [0, 0], hourlyApi: 0 }, fast: { api: [0, 0.15], scroll: [0.5, 1], file: [0, 0.08], burst: 0, burstBreak: [0, 0], hourlyApi: 0 } };
function profileOf(j) { if (j.site === 'ih') return IH_PROFILES[j.speed] || IH_PROFILES.normal; const set = strict(j.site) ? FB_PROFILES : PROFILES; return set[j.speed] || set.normal; }
// after a block the site stays suspicious for hours: every wait is longer for 12 h (x1.6, x2.2, x2.8 ...)
function slowFactor(site) { const b = S.block[site]; return Date.now() - b.last < 12 * 3600e3 && b.level > 0 ? 1 + 0.6 * Math.min(b.level, 3) : 1; }

async function gate(j, kind) {
  const site = j.site, P = profileOf(j), pc = S.pacing[site];
  for (;;) {
    if (j.status === 'canceled') return { cancel: true };
    if (j.paused || Date.now() < S.block[site].until) { touch(j); await sleep(500); continue; }
    break;
  }
  if (j.status === 'canceled') return { cancel: true };
  // hourly cap on data requests ('safe' profile)
  if (kind === 'api' && P.hourlyApi) {
    pc.hour = pc.hour.filter(t => t > Date.now() - 3600e3);
    if (pc.hour.length >= P.hourlyApi) { j.note = 'Hourly request limit of the chosen speed reached - waiting.'; touch(j); await sleep(Math.max(1000, pc.hour[0] + 3600e3 - Date.now())); return gate(j, kind); }
    pc.hour.push(Date.now());
  }
  const wait = Math.max(0, pc.next - Date.now());
  if (wait) await sleep(wait);
  if (kind === 'api') pc.count++;
  const f = slowFactor(site);
  let extra = 0;
  if (kind === 'api' && P.burst && pc.count % P.burst === 0) { extra = nextDelay(P.burstBreak) * 1000 * f; j.note = `Break of ${Math.round(extra / 1000)} s to stay under ${SITE_NAME[site]}'s limit.`; touch(j); }
  else if (j.note && j.note.startsWith('Break of')) j.note = '';
  pc.next = Date.now() + nextDelay(P[kind] || P.api) * 1000 * f + extra;
  if (j.status === 'canceled') return { cancel: true };
  if (extra) await sleep(extra);
  return { ok: true };
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function reportBlock(j, reason) {
  const b = S.block[j.site], now = Date.now();
  if (now - b.last > 12 * 3600e3) b.level = 0;
  const secs = cooldownFor(b.level, S.settings.cooldownMin);
  b.level++; b.last = now; b.until = now + secs * 1000; b.reason = String(reason || '').slice(0, 160);
  j.note = `${SITE_NAME[j.site]} limited this session. Scanning resumes automatically in ${Math.round(secs / 60)} min.`;
  jobLog(j, 'BLOCK ' + reason);
  for (const o of Object.values(S.jobs)) if (o.site === j.site && !o.scanDone) touch(o);
  saveSoon(); broadcastSoon();
  return b.until;
}

// ------------------------------------------------------------------ media in -> queue
// No download history between runs (as in the originals' default): only duplicates inside the same job are dropped (a post that shows up in two tabs).
function accept(j, items, part) {
  let added = 0;
  for (const m of items) {
    const k = m.site + ':' + m.key;
    if (S.pendingKeys.has(k) || j.doneKeys[m.key]) { j.skipped++; continue; }
    S.pendingKeys.add(k);
    j.queue.push(m);
    j.found++; added++;
    j.parts[part] = (j.parts[part] || 0) + 1;
  }
  touch(j);
  pumpDownloads(j.site);
  return added;
}

// ------------------------------------------------------------------ downloads
const pumping = Object.fromEntries(Object.keys(SITE_NAME).map(k => [k, false]));
async function pumpDownloads(site) {
  if (pumping[site]) return;
  pumping[site] = true;
  try {
    for (;;) {
      await ensure();
      const jobs = Object.values(S.jobs).filter(j => j.site === site && j.queue.length && !j.paused && j.status !== 'canceled').sort((a, b) => a.id - b.id);
      if (!jobs.length) break;
      const j = jobs[0], m = j.queue.shift();
      j.active++; touch(j);
      try { await downloadOne(j, m); } catch (e) { j.failed++; if (j.failedItems.length < 2000) j.failedItems.push(m); jobLog(j, 'failed ' + m.key + ': ' + e.message); j.failWhy = [e.message, ...(j.failWhy || []).filter(x => x !== e.message)].slice(0, 3); }
      j.active--;
      S.pendingKeys.delete(m.site + ':' + m.key);
      finishIfDone(j); touch(j);
      const P = profileOf(j);
      await sleep(nextDelay(P.file) * 1000);
    }
  } finally { pumping[site] = false; }
}

function filenameFor(j, m) {
  const st = S.settings;
  if (m.site === 'ih') {                       // Images/<site of the page>/<page title>/<NNN>_<original name>   (ImageHostGrabber: title sub-folder + numbered file names)
    const c = (x, n) => String(x || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, n).replace(/^[ .]+|[ .]+$/g, '') || '_';
    let nm = c(m.fileName || baseName(m.url) || 'image', 120);
    if (!/\.[A-Za-z0-9]{2,5}$/.test(nm)) nm += (new URL(m.url).pathname.match(/\.([A-Za-z0-9]{2,5})$/) || [, 'jpg'])[1].replace(/^/, '.');
    return [...(st.subfolder ? [c(st.subfolder, 60)] : []), 'Images', c(m.owner, 60), c(m.ptype, 80), String((m.index || 0) + 1).padStart(3, '0') + '_' + nm].join('/');
  }
  const d = m.takenAt ? new Date(m.takenAt * 1000).toISOString().slice(0, 10) : '0000-00-00';
  const clean = (s, n) => String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, n || 80).replace(/^[ .]+|[ .]+$/g, '') || '_';
  let ext = (new URL(m.url).pathname.match(/\.(jpe?g|png|webp|heic|mp4|mov|webm)$/i) || [])[1];
  ext = ext ? '.' + ext.toLowerCase() : (m.kind === 'video' ? '.mp4' : '.jpg');
  const sub = st.layout.replace('{site}', SITE_NAME[m.site]).replace('{owner}', clean(m.owner || 'unknown', 60)).replace('{type}', clean(m.ptype, 20)).replace('{kind}', m.kind);
  const base = st.template.replace('{owner}', clean(m.owner || 'unknown', 40)).replace('{date}', d).replace('{code}', clean(m.code || m.postId || m.key, 40))
    .replace('{index}', String((m.index || 0) + 1)).replace('{id}', clean(m.postId || m.key, 40)).replace('{type}', m.ptype).replace('{kind}', m.kind);
  const parts = [...(st.subfolder ? [clean(st.subfolder, 60)] : []), ...sub.split('/').filter(Boolean).map(p => clean(p, 80)), clean(base, 150) + ext];
  return parts.join('/');
}

const swapExt = (name, ext) => name.replace(/\.[A-Za-z0-9]{2,4}$/, '') + ext;
const urlExt = (u, dflt) => { const m = (new URL(u).pathname.match(/\.([A-Za-z0-9]{2,4})$/) || [])[1]; return m ? '.' + m.toLowerCase() : dflt; };

let offscreenOpening = null;
async function ensureOffscreen() {
  if (offscreenOpening) return offscreenOpening;                 // several workers ask at once: they share one creation
  offscreenOpening = (async () => {
    const has = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
    if (has.length) return;
    try { await chrome.offscreen.createDocument({ url: 'ui/offscreen.html', reasons: ['BLOBS', 'WORKERS'], justification: 'Join video and audio tracks (ffmpeg.wasm) and run host-file rules in a sandbox' }); }
    catch (e) { if (!/single offscreen/i.test(String(e && e.message))) throw e; }
  })();
  try { await offscreenOpening; } finally { offscreenOpening = null; }
}
async function offscreen(kind, payload) {
  await ensureOffscreen();
  const r = await chrome.runtime.sendMessage({ target: 'offscreen', kind, ...payload });
  if (!r || !r.ok) throw new Error((r && r.error) || 'media worker failed');
  return r;
}

async function downloadOne(j, m) {
  const opts = j.opts || {};
  let filename = filenameFor(j, m), url = m.url, blobUrl = null;
  if (m.kind === 'video' && (opts.merge || m.mergeAlways) && m.dash && m.dash.video && m.dash.audio) {
    try { const r = await offscreen('merge', { video: m.dash.video, audio: m.dash.audio }); blobUrl = url = r.blobUrl; filename = swapExt(filename, '.mp4'); }
    catch (e) { jobLog(j, 'HD merge failed (' + e.message + ') - saving the normal file'); }
  }
  // first link, then the fallbacks of the scanner (e.g. DeviantArt: download link -> full view -> plain)
  const tries = [{ url, auth: !!m.auth && url === m.url }, ...((url === m.url && m.alts) || []).map(a => ({ url: a.url, auth: !!a.auth }))];
  let lastErr = null, done = false;
  try {
    for (const t of tries) {
      const attempts = tries.length === 1 ? 3 : 2;
      for (let attempt = 1; attempt <= attempts && !done; attempt++) {
        if (j.status === 'canceled') return;
        try {
          const size = opts.chromeDl ? await chromeDownload(t.url, (S.settings.subfolder ? '' : 'Ultimate SN Downloader/') + filename)
            : await saveFile(t.url, filename, t.auth, m.referer || '', m.site === 'ih' ? (Number(S.settings.ihMinKB) || 0) * 1024 : 0);
          j.downloaded++; j.bytes += size; j.doneKeys[m.key] = 1; S.totals[m.site]++; S.totals.bytes += size;
          S.names.push(filename); if (S.names.length > 400) S.names.shift();
          done = true;
        } catch (e) {
          lastErr = e;
          if (e.message === 'TOO_SMALL') { j.skipped++; done = true; break; }       // thumbnails / icons: below the minimum file size
          if (/FORBIDDEN|NOT_FOUND|BAD_CONTENT|INVALID_URL/.test(e.message)) break;       // this link is refused: next one
          await sleep(1500 * attempt + Math.random() * 1500);
        }
      }
      if (done) break;
    }
    if (!done) throw new Error((tries.length > 1 ? 'all ' + tries.length + ' links failed, last: ' : '') + (lastErr ? lastErr.message : 'download failed'));
  } finally {
    if (blobUrl) chrome.runtime.sendMessage({ target: 'offscreen', kind: 'revoke', url: blobUrl }).catch(() => {});
  }
  if (m.kind === 'video' && opts.thumb && m.thumb) {
    try { const tn = swapExt(filename, '') + '.thumbnail' + urlExt(m.thumb, '.jpg'); if (opts.chromeDl) await chromeDownload(m.thumb, (S.settings.subfolder ? '' : 'Ultimate SN Downloader/') + tn); else await saveFile(m.thumb, tn); S.names.push(tn); }
    catch (e) { jobLog(j, 'thumbnail failed: ' + e.message); }
  }
}

// Chrome's own download list (used by the video button: one click, nothing to choose)
function chromeDownload(url, filename) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false }, id => {
      if (chrome.runtime.lastError || id === undefined) return reject(new Error('FORBIDDEN ' + ((chrome.runtime.lastError && chrome.runtime.lastError.message) || 'download refused')));
      const timer = setTimeout(() => { delete S.dl[id]; reject(new Error('timeout')); }, 10 * 60e3);
      S.dl[id] = { resolve: v => { clearTimeout(timer); resolve(v); }, reject: e => { clearTimeout(timer); reject(e); } };
    });
  });
}
chrome.downloads.onChanged.addListener(async d => {
  const h = S.dl[d.id];
  if (!h || !d.state) return;
  delete S.dl[d.id];
  const [it] = await chrome.downloads.search({ id: d.id });
  if (d.state.current === 'complete') h.resolve((it && it.fileSize) || 0);
  else if (d.state.current === 'interrupted') h.reject(new Error(((it && it.error) || 'interrupted') + (/FORBIDDEN|NOT_FOUND|BAD_CONTENT/.test((it && it.error) || '') ? '' : '')));
});

// The chosen download folder (File System Access handle). While the browser has not granted access the job waits, and the progress window asks the user.
async function refreshFolder() {
  const root = await getRoot();
  S.folder = { set: !!root, name: root ? root.name : '', permission: root ? await permission(root) : 'none' };
  broadcastSoon();
  return root;
}

async function saveFile(url, relPath, auth = false, referer = '', minBytes = 0) {
  let root = await refreshFolder(), asked = false;
  while (!root || S.folder.permission !== 'granted') {
    if (!asked) {            // Chrome drops the folder permission when no page of the extension is open: bring the progress window back so one click re-allows it
      asked = true;
      for (const j of Object.values(S.jobs)) if (!['done', 'error', 'canceled', 'interrupted'].includes(j.status)) j.note = 'Chrome needs one click to allow writing to the folder - use the Allow button in the progress window.';
      broadcastSoon(); await openManager(true);
    }
    await sleep(2000); root = await refreshFolder();
  }
  if (asked) for (const j of Object.values(S.jobs)) if (j.note && j.note.startsWith('Chrome needs one click')) j.note = '';
  let resp;
  try { resp = await withReferer(url, referer, () => fetch(url, { credentials: auth ? 'include' : 'omit' })); } catch (e) { throw new Error('network: ' + e.message); }
  if (resp.status === 403 || resp.status === 401) throw new Error('FORBIDDEN (link expired)');
  if (resp.status === 404 || resp.status === 410) throw new Error('NOT_FOUND');
  if (!resp.ok) throw new Error('HTTP ' + resp.status);
  if (minBytes) { const len = Number(resp.headers.get('content-length') || 0); if (len && len < minBytes) { try { await resp.body.cancel(); } catch (e) {} throw new Error('TOO_SMALL'); } }
  const r = await writeFile(root, relPath, resp);
  return r.size;
}

// ------------------------------------------------------------------ progress window
// Ice: bez zadane pozicije prozor se na nekim sistemima otvori izvan ekrana (lijevo). Postavlja se
// unutar prozora u kojem je korisnik, uz njegov desni gornji ugao, uvijek u vidljivom dijelu.
async function popupBounds(width, height) {
  try {
    const cur = await chrome.windows.getLastFocused();
    if (cur && cur.width > 0 && cur.left !== undefined) {
      const w = Math.min(width, Math.max(300, cur.width - 40));
      const h = Math.min(height, Math.max(200, cur.height - 80));
      return { width: w, height: h, left: Math.max(0, Math.round(cur.left + cur.width - w - 20)), top: Math.max(0, Math.round(cur.top + 60)) };
    }
  } catch (e) {}
  return { width, height, left: 100, top: 80 };
}
async function openManager(focus = false) {
  try {
    if (S.managerWindow) { try { await chrome.windows.get(S.managerWindow); if (focus) await chrome.windows.update(S.managerWindow, { focused: true }); return; } catch (e) { S.managerWindow = null; } }
    const w = await chrome.windows.create({ url: chrome.runtime.getURL('ui/manager.html'), type: 'popup', ...(await popupBounds(520, 700)), focused: focus });
    S.managerWindow = w.id;
  } catch (e) { /* no window API in this context */ }
}
let folderWindow = null;
async function openFolderWindow() {
  try {
    if (folderWindow) { try { await chrome.windows.update(folderWindow, { focused: true }); return; } catch (e) { folderWindow = null; } }
    const w = await chrome.windows.create({ url: chrome.runtime.getURL('ui/folder.html'), type: 'popup', ...(await popupBounds(460, 330)), focused: true });
    folderWindow = w.id;
  } catch (e) {}
}
chrome.windows.onRemoved.addListener(id => { if (id === folderWindow) folderWindow = null; });
chrome.windows.onRemoved.addListener(id => { if (id === S.managerWindow) S.managerWindow = null; });

// ------------------------------------------------------------------ Image Host Grabber
let ihLoaded = null, ruleSeq = 20000;
async function ihEnsure() {
  if (hostCount()) return;
  if (!ihLoaded) ihLoaded = (async () => {
    let hosts = (await chrome.storage.local.get('ihHosts')).ihHosts;
    if (!hosts || !hosts.length) { hosts = parseHostFile(await (await fetch(chrome.runtime.getURL('ihg/hostf.xml'))).text()); chrome.storage.local.set({ ihHosts: hosts }); }
    setHosts([...(await ihCustom()), ...hosts]);
  })();
  await ihLoaded;
  S.ihCount = hostCount();
}

// Custom host rules, added by hand in the progress window (⚙). Kept apart from the host file (an import of a new
// hostf.xml does not remove them) and checked BEFORE it, so a custom rule also overrides a host-file rule.
const ihCustom = async () => (await chrome.storage.local.get('ihCustom')).ihCustom || [];
async function ihReapply() {
  const hosts = (await chrome.storage.local.get('ihHosts')).ihHosts || [];
  setHosts([...(await ihCustom()), ...hosts]); S.ihCount = hostCount(); ihLoaded = Promise.resolve();
}
function ihCheckRule(r) {
  const id = String((r && r.id) || '').trim(), url = String((r && r.url) || '').trim(), sp = String((r && r.sp) || '').trim(), test = String((r && r.test) || '').trim();
  if (!id || id.length > 100) return { error: 'Site name is required (max 100 characters).' };
  if (!url) return { error: 'Link pattern is required.' };
  let re; try { re = new RegExp(url, 'i'); } catch (e) { return { error: 'Link pattern is not a valid regular expression: ' + e.message }; }
  if (!sp) return { error: 'Image rule is required.' };
  if (/^function\b/.test(sp) && !/^function\s*\(\s*\w+\s*,\s*\w+\s*\)\s*\{[\s\S]*\}$/.test(sp)) return { error: 'A function rule must look like: function(pageData, pageUrl) { ... }' };
  if (test && !re.test(test)) return { error: 'The test link does not match the link pattern.' };
  return { rule: { id, url, sp, post: '', maxThreads: 0 } };
}

// a request from the service worker with a chosen Referer (a worker cannot set that header itself): a one-request rule
async function withReferer(url, referer, fn) {
  if (!referer || url.length > 1500) return fn();
  const id = ++ruleSeq; if (ruleSeq > 29000) ruleSeq = 20000;
  const esc = url.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    await chrome.declarativeNetRequest.updateSessionRules({ addRules: [{ id, priority: 2, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'Referer', operation: 'set', value: referer }] },
      condition: { regexFilter: '^' + esc + '$', resourceTypes: ['xmlhttprequest', 'other'], tabIds: [-1] } }] });
  } catch (e) { return fn(); }
  try { return await fn(); } finally { chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [id] }).catch(() => {}); }
}

async function ihFetch(method, url, headers, body, referer) {
  const h = { ...(headers || {}) }, ref = h.Referer || h.referer || referer;
  delete h.Referer; delete h.referer;
  return withReferer(url, ref, async () => {
    const ac = new AbortController(), t = setTimeout(() => ac.abort(), 25000);
    try {
      const r = await fetch(url, { method, headers: h, body: body === null || body === undefined ? undefined : body, credentials: 'include', redirect: 'follow', signal: ac.signal });
      const text = await r.text();
      return { status: r.status, statusText: r.statusText, text, finalUrl: r.url };
    } catch (e) { return { error: String((e && e.message) || e) }; } finally { clearTimeout(t); }
  });
}

// one link of the page -> {imgUrl, fileName, referer} | {unknown} | {abort} | {error}
async function ihResolve(j, link, depth = 0) {
  const page = j.page || {}, rule = matchRule(link);
  if (!rule) return isDirectImage(link) ? { imgUrl: link, referer: page.url } : { unknown: true };
  let text = '', pageUrl = link;
  if (isFunctionRule(rule.sp) || needsPage(rule.sp)) {
    const r = rule.post ? await ihFetch('POST', link, { 'Content-Type': 'application/x-www-form-urlencoded' }, rule.post, page.url) : await ihFetch('GET', link, {}, null, page.url);
    if (r.error) return { error: r.error };
    if (r.status !== 200) return { error: 'HTTP ' + r.status };
    text = r.text; pageUrl = r.finalUrl || link;
  }
  if (!isFunctionRule(rule.sp)) {
    const u = runStringRule(rule.sp, link, text, pageUrl);
    return u ? { imgUrl: u, referer: link } : { abort: true };
  }
  const o = await offscreen('ih:run', { fn: rule.sp, pageData: text, pageUrl });
  const res = o.result || {};
  if (res.imgUrl) res.imgUrl = String(res.imgUrl).replace(/&amp;/g, '&');
  switch (res.status) {
    case 'OK': { try { return { imgUrl: new URL(res.imgUrl, pageUrl).href, fileName: res.fileName || '', referer: res.referer || link }; } catch (e) { return { abort: true }; } }
    case 'RETRY': return depth < 3 ? ihResolve(j, res.imgUrl || link, depth + 1) : { abort: true };
    case 'REQUEUE': return depth < 5 && res.imgUrl ? ihResolve(j, res.imgUrl, depth + 1) : { abort: true };
    case 'REDIRECT': return depth < 5 && pageUrl !== link ? ihResolve(j, pageUrl, depth + 1) : { abort: true };
    default: return res.error ? { error: res.error } : { abort: true };
  }
}

async function runIh(j, links) {
  await ihEnsure();
  j.resolving++; j.total = Math.max(j.total, links.length); touch(j);
  const queue = links.map((l, i) => ({ ...l, index: i })), page = j.page || {};
  let unresolved = 0;
  const worker = async () => {
    while (queue.length && j.status !== 'canceled') {
      const l = queue.shift(), rule = matchRule(l.url);
      if (rule && (isFunctionRule(rule.sp) || needsPage(rule.sp))) { const g = await gate(j, 'api'); if (g.cancel) break; }       // only requests to other sites are paced
      let r;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try { r = await ihResolve(j, l.url); } catch (e) { r = { error: e.message }; }
        if (!r.error || attempt === 3) break;
        await sleep(800 * attempt);
      }
      j.scanned++;
      if (r.imgUrl) {
        const name = r.fileName || baseName(r.imgUrl) || 'image';
        accept(j, [{ site: 'ih', key: r.imgUrl, kind: 'photo', url: r.imgUrl, owner: page.host || 'page', postId: '', code: name, ptype: page.folder || 'images', index: l.index,
          takenAt: 0, caption: '', fileName: name, referer: r.referer || page.url || '', w: 0, h: 0 }], 'images');
      } else if (r.unknown) { try { const h = new URL(l.url).hostname, own = String(page.host || ''); if (h.replace(/^www\./, '') !== own && !h.endsWith('.' + own)) j.unknown[h] = (j.unknown[h] || 0) + 1; } catch (e) { /* not a url */ } }
      else { unresolved++; jobLog(j, 'no image from ' + l.url.slice(0, 120) + (r.error ? ' (' + r.error + ')' : '')); }
      touch(j);
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  j.resolving--;
  const unk = Object.entries(j.unknown).sort((a, b) => b[1] - a[1]).slice(0, 6).map(([h, n]) => h + ' (' + n + ')');
  if (unk.length) j.warn = 'No rule for: ' + unk.join(', ') + ' - add them to the host file.';
  if (unresolved) j.note = unresolved + ' link(s) gave no image (the host page did not show one).';
  touch(j); finishIfDone(j);
}

// ------------------------------------------------------------------ retry / resume
const waitTab = async (tabId, ms = 45000) => { const end = Date.now() + ms; for (;;) { const t = await chrome.tabs.get(tabId).catch(() => null); if (!t) return false; if (t.status === 'complete') return true; if (Date.now() > end) return false; await sleep(400); } };

async function tabForJob(j) {
  const pattern = SITE_TABS[j.site];
  const tabs = await chrome.tabs.query({ url: pattern });
  let t = tabs.find(x => x.url === j.url) || tabs.find(x => x.id === j.tabId) || tabs[0];
  if (!t) t = await chrome.tabs.create({ url: j.url, active: false });
  else if (t.url !== j.url) t = await chrome.tabs.update(t.id, { url: j.url });
  await waitTab(t.id);
  return t;
}

async function resumeScan(j) {
  const t = await tabForJob(j);
  j.tabId = t.id;
  let ready = false;
  for (let i = 0; i < 80 && !ready; i++) { const r = await chrome.tabs.sendMessage(t.id, { t: 'describe' }).catch(() => null); ready = !!(r && r.site); if (!ready) await sleep(500); }
  if (!ready) throw new Error('The page did not load. Open it and press Resume again.');
  const r = await chrome.tabs.sendMessage(t.id, { t: 'start', resumeJobId: j.id, target: j.target || null, sel: j.sel, speed: j.speed, opts: j.opts, stopAtKnown: j.stopAtKnown }).catch(e => ({ error: String(e) }));
  if (!r || r.error) throw new Error((r && r.error) || 'The page did not answer.');
}

// Retry failed files (no requests to the site at all) and, when the scan did not finish, continue it from the saved cursors.
async function retryJob(j) {
  for (const m of j.failedItems.splice(0)) { const k = m.site + ':' + m.key; if (!S.pendingKeys.has(k)) { S.pendingKeys.add(k); j.queue.push(m); } }
  j.failed = 0; j.endedAt = 0; j.paused = false;
  const needScan = j.status !== 'done' || j.scanInterrupted;
  j.status = needScan ? 'scanning' : 'downloading';
  touch(j);
  pumpDownloads(j.site);
  if (needScan) {
    j.scanDone = false; j.error = ''; j.note = 'Resuming the scan…'; touch(j);
    try { await resumeScan(j); }
    catch (e) { j.scanDone = true; j.error = e.message; j.status = j.queue.length || j.active ? 'downloading' : 'error'; touch(j); finishIfDone(j); }
  }
}

// ------------------------------------------------------------------ messages
chrome.runtime.onConnect.addListener(port => {
  if (!port.name.startsWith('job:')) return;
  const id = Number(port.name.slice(4));
  S.ports[id] = port;
  port.onMessage.addListener(() => {});
  port.onDisconnect.addListener(() => {
    if (S.ports[id] === port) delete S.ports[id];
    // the tab went away while scanning (a navigation of our own is marked)
    setTimeout(async () => {
      await ensure();
      const j = S.jobs[id];
      if (!j || j.scanDone || j.navigating || S.ports[id]) return;
      j.scanDone = true; j.scanInterrupted = true; j.note = 'The page was closed or reloaded during the scan. Files found so far are still saved - press Resume to continue.';
      touch(j); finishIfDone(j);
    }, 4000);
  });
});

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (msg && msg.target === 'offscreen') return false;
  (async () => { try {
    await ensure();
    const j = msg.jobId ? S.jobs[msg.jobId] : null;
    switch (msg.t) {
      case 'job:create': {
        const rj = msg.resumeJobId && S.jobs[msg.resumeJobId];
        if (rj) { Object.assign(rj, { scanDone: false, scanInterrupted: false, error: '', note: '', warn: '', endedAt: 0, paused: false, tabId: sender.tab && sender.tab.id, status: 'scanning', phase: 'Resuming' }); touch(rj); return respond({ job: scanView(rj) }); }
        const job = createJob(msg, sender.tab && sender.tab.id); return respond({ job: scanView(job) });
      }
      case 'cursor': if (j) { j.cursors[msg.part] = msg.cursor; saveSoon(); } return respond({});
      case 'part:done': if (j) { j.partsDone[msg.part] = true; saveSoon(); } return respond({});
      case 'seen:filter':              // for a resumed job: do not look up again what this same job already saved
        return respond({ keys: (msg.items || []).filter(m => !(j && j.doneKeys[m.key]) && !S.pendingKeys.has(m.site + ':' + m.key)).map(m => m.key) });
      case 'job:retry': if (j) await retryJob(j); return respond({});
      case 'resume': {
        const tab = sender.tab && sender.tab.id;
        const cand = Object.values(S.jobs).find(x => x.navigating && x.tabId === tab && !x.scanDone && x.status !== 'canceled');
        if (!cand) return respond({});
        cand.navigating = false; touch(cand);
        return respond({ job: scanView(cand) });
      }
      case 'quick:start': {            // the little button on a video: one click, the file goes straight to Chrome's download list (Downloads/Ultimate SN Downloader/...)
        const tab = sender.tab, site = msg.site, st = S.settings;
        if (!tab) return respond({ error: 'no tab' });
        const startMsg = { t: 'start', sel: { photos: false, videos: true, storyreel: true }, speed: st.speed, stopAtKnown: false, target: msg.target,
          opts: site === 'ig' ? { merge: !!st.optMerge, thumb: !!st.optThumb, chromeDl: true } : { fullSize: st.optFull !== false, chromeDl: true } };
        const r = await chrome.tabs.sendMessage(tab.id, startMsg).catch(e => ({ error: String(e) }));
        return respond(r || {});
      }
      case 'ih:links': {
        if (!j) return respond({});
        const t = String(msg.page && msg.page.title || '').trim();
        const clean = x => String(x || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim().slice(0, 80).replace(/^[ .]+|[ .]+$/g, '');
        let host = ''; try { host = new URL(msg.page.url).hostname.replace(/^www\./, ''); } catch (e) { host = 'page'; }
        j.page = { url: msg.page.url, title: t, host, folder: clean(t) || clean(host) || 'images' };
        j.label = (t || host).slice(0, 80);
        runIh(j, msg.links || []);
        return respond({ queued: (msg.links || []).length });
      }
      case 'ih:net': return respond(await ihFetch(msg.method, msg.url, msg.headers, msg.body));
      case 'ih:import': { const hosts = parseHostFile(String(msg.text || '')); if (!hosts.length) return respond({ error: 'No <host> entries found in that file.' }); await chrome.storage.local.set({ ihHosts: hosts }); await ihReapply(); broadcastSoon(); return respond({ count: hosts.length }); }
      case 'ih:custom:list': return respond({ rules: await ihCustom() });
      case 'ih:custom:add': { const c = ihCheckRule(msg.rule); if (c.error) return respond(c); const rules = [c.rule, ...(await ihCustom()).filter(x => x.id !== c.rule.id)]; await chrome.storage.local.set({ ihCustom: rules }); await ihReapply(); broadcastSoon(); return respond({ ok: true, rules }); }
      case 'ih:custom:del': { const rules = (await ihCustom()).filter(x => x.id !== String(msg.id)); await chrome.storage.local.set({ ihCustom: rules }); await ihReapply(); broadcastSoon(); return respond({ ok: true, rules }); }
      case 'job:addstep': if (j) { j.steps.push(msg.step); j.stepIndex = j.steps.length - 1; j.navigating = true; touch(j); } return respond({});
      case 'job:step': if (j) { j.stepIndex = msg.stepIndex; j.navigating = !!msg.navigating; touch(j); } return respond({});
      case 'gate': return respond(j ? await gate(j, msg.kind) : { cancel: true });
      case 'blocked': if (j) { const until = reportBlock(j, msg.reason || ''); return respond({ until }); } return respond({});
      case 'media': return respond({ added: j ? await accept(j, msg.items, msg.part) : 0 });
      case 'progress':
        if (j) {
          if (msg.scanned !== undefined) j.scanned = Math.max(j.scanned, msg.scanned);
          if (msg.total) j.total = Math.max(j.total, msg.total);
          if (msg.phase) j.phase = msg.phase;
          if (msg.warn) { j.warn = (j.warn ? j.warn + ' · ' : '') + msg.warn; }
          touch(j);
        }
        return respond({});
      case 'log': if (j) jobLog(j, msg.msg); return respond({});
      case 'scan:done':
        if (j) {
          j.scanDone = true;
          if (msg.error && msg.kind !== 'cancel') { j.error = msg.error; j.status = j.queue.length || j.active ? j.status : 'error'; jobLog(j, 'ERROR ' + msg.error); }
          if (msg.kind === 'cancel') j.status = 'canceled';
          touch(j); finishIfDone(j);
          if (j.error && !j.queue.length && !j.active) { j.status = 'error'; j.endedAt = Date.now(); broadcastSoon(); }
        }
        return respond({});
      // ---- from the UI
      case 'state': await refreshFolder(); await ihEnsure(); return respond(snapshot());
      case 'folder:changed': await refreshFolder(); return respond({});
      case 'job:pause': if (j) { j.paused = true; touch(j); } return respond({});
      case 'job:resume': if (j) { j.paused = false; touch(j); pumpDownloads(j.site); } return respond({});
      case 'job:cancel':
        if (j) {
          j.status = 'canceled'; j.scanDone = true; j.endedAt = Date.now();
          for (const m of j.queue) S.pendingKeys.delete(m.site + ':' + m.key);
          j.queue = [];
          if (j.tabId) chrome.tabs.sendMessage(j.tabId, { t: 'job:cancel', jobId: j.id }).catch(() => {});
          touch(j);
        }
        return respond({});
      case 'job:remove':
        if (j) { if (j.tabId && !j.scanDone) chrome.tabs.sendMessage(j.tabId, { t: 'job:cancel', jobId: j.id }).catch(() => {}); for (const m of j.queue) S.pendingKeys.delete(m.site + ':' + m.key); delete S.jobs[j.id]; broadcastSoon(); }
        return respond({});
      case 'jobs:clear':
        for (const x of Object.values(S.jobs)) if (['done', 'error', 'canceled', 'interrupted'].includes(x.status)) delete S.jobs[x.id];
        broadcastSoon(); return respond({});
      case 'block:clear': S.block[msg.site] = { until: 0, level: 0, last: 0 }; broadcastSoon(); return respond({});
      case 'settings:set': S.settings = { ...S.settings, ...msg.settings }; saveSoon(); broadcastSoon(); return respond({ ok: true });
      case 'manager:open': await openManager(); return respond({});
      case 'folder:window': await openManager(false); await openFolderWindow(); return respond({});
      default: return respond({});
    }
  } catch (e) { console.error('[USN] message handler failed', msg && msg.t, e && e.stack); try { respond({ error: String(e && e.stack || e) }); } catch (e2) {} } })();
  return true;
});

// Ice: klik na ikonu otvara popup kao prozor unutar prozora preglednika (Chromiumov popup ispod ikone
// zna otići izvan ekrana kad su ikone ekstenzija lijevo od adresne trake).
let actionWindow = null;
async function openActionWindow(tab) {
  if (actionWindow) { try { await chrome.windows.remove(actionWindow); } catch (e) {} actionWindow = null; }
  const b = await popupBounds(372, 640);
  const w = await chrome.windows.create({ url: chrome.runtime.getURL('ui/popup.html?tab=' + (tab && tab.id)), type: 'popup', focused: true, ...b });
  actionWindow = w.id;
}
chrome.action.onClicked.addListener(openActionWindow);
chrome.windows.onRemoved.addListener(id => { if (id === actionWindow) actionWindow = null; });
globalThis.iceOpenAction = openActionWindow;
