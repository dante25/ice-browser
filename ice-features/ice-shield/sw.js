// Ice Shield: blokira phishing i malware stranice (~600.000 domena), lokalno, bez slanja historije ikome.
// Liste se skidaju svakih 6 sati; domeni se drže kao sortirani 53-bitni heševi (~5 MB).

const SOURCES = [
  { id: 'phishing-database', url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt', format: 'domains', match: 'exact' },
  { id: 'openphish', url: 'https://openphish.com/feed.txt', format: 'urls', match: 'exact' },
  { id: 'urlhaus-filter', url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains.txt', format: 'domains', match: 'exact' },
  { id: 'hagezi-tif', url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/tif.mini-onlydomains.txt', format: 'domains', match: 'wildcard' },
];
const MAX_AGE_MS = 6 * 60 * 60 * 1000;
const EXCEPTION_DAYS = 30;
const CACHE = 'ice-shield-v1';

// Velike dijeljene platforme: nikad se ne blokiraju cijele (ni preko wildcard pravila)
const NEVER_BLOCK = new Set([
  'sites.google.com', 'docs.google.com', 'drive.google.com', 'forms.gle', 'storage.googleapis.com',
  'google.com', 'googleusercontent.com', 'github.com', 'gist.github.com', 'raw.githubusercontent.com',
  'githubusercontent.com', 'github.io', 'dropbox.com', 'dropboxusercontent.com', 'onedrive.live.com',
  'live.com', 'sharepoint.com', '1drv.ms', 't.me', 'bit.ly', 'linktr.ee', 'ipfs.io', 'web.archive.org',
  'blogspot.com', 'amazonaws.com', 'cloudfront.net', 'discord.com', 'discordapp.com', 'cdn.discordapp.com',
  'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'appspot.com',
  'gitlab.io', 'gitlab.com', 'r2.dev', 'mediafire.com', 'mega.nz',
]);

const norm = (h) => {
  h = String(h).toLowerCase().replace(/\.$/, '');
  return h.startsWith('www.') ? h.slice(4) : h;
};

// cyrb53: brz 53-bitni heš (sudar je praktično nemoguć na 600.000 domena)
function hash(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function parse(text, format) {
  const out = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line[0] === '#' || line[0] === '!') continue;
    if (format === 'urls') {
      try { line = new URL(line).hostname; } catch { continue; }
    }
    out.push(norm(line.replace(/^\*\./, '')));
  }
  return out;
}

function build(lists) {
  const set = new Set();
  for (const list of lists) for (const h of list) if (!NEVER_BLOCK.has(h)) set.add(hash(h));
  return Float64Array.from(set).sort();
}

function contains(arr, v) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (arr[mid] === v) return true;
    if (arr[mid] < v) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

// "a.b.primjer.com" -> ["a.b.primjer.com", "b.primjer.com", "primjer.com"]
function suffixes(host) {
  const p = host.split('.');
  const out = [];
  for (let i = 0; i < p.length - 1; i++) out.push(p.slice(i).join('.'));
  return out;
}

let tables = { exact: new Float64Array(0), wild: new Float64Array(0) };
let ready = null;
const test = { exact: new Set(), wild: new Set() }; // samo za testove (preko DevTools protokola)

async function cacheGet(key) {
  const r = await (await caches.open(CACHE)).match(`https://ice.invalid/${key}`);
  return r || null;
}
async function cachePut(key, body) {
  await (await caches.open(CACHE)).put(`https://ice.invalid/${key}`, new Response(body));
}

async function refresh({ force = false } = {}) {
  const { meta = {} } = await chrome.storage.local.get('meta');
  const lists = { exact: [], wildcard: [] };
  let changed = false;
  for (const s of SOURCES) {
    let text = null;
    if (force || !meta[s.id] || Date.now() - meta[s.id] > MAX_AGE_MS) {
      try {
        const r = await fetch(s.url, { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        text = await r.text();
        await cachePut(`src-${s.id}`, text);
        meta[s.id] = Date.now();
        changed = true;
      } catch (e) {
        console.warn(`[Ice Shield] lista ${s.id} nije osvježena: ${e.message}`);
      }
    }
    if (text === null) text = await (await cacheGet(`src-${s.id}`))?.text() ?? null;
    if (text) lists[s.match].push(parse(text, s.format));
  }
  if (changed || !tables.exact.length) {
    tables = { exact: build(lists.exact), wild: build(lists.wildcard) };
    await cachePut('exact', tables.exact.buffer);
    await cachePut('wild', tables.wild.buffer);
    await chrome.storage.local.set({ meta, size: tables.exact.length + tables.wild.length });
  }
  return tables.exact.length + tables.wild.length;
}

async function load() {
  const [e, w] = await Promise.all([cacheGet('exact'), cacheGet('wild')]);
  if (e && w) tables = { exact: new Float64Array(await e.arrayBuffer()), wild: new Float64Array(await w.arrayBuffer()) };
  if (!tables.exact.length) await refresh();
  else refresh(); // u pozadini, ako su liste stare
}
const ensure = () => (ready ||= load());

function isBlocked(host) {
  const h = norm(host);
  if (NEVER_BLOCK.has(h)) return false;
  if (test.exact.has(h) || contains(tables.exact, hash(h))) return true;
  for (const s of suffixes(h)) {
    if (NEVER_BLOCK.has(s)) continue;
    if (test.wild.has(s) || contains(tables.wild, hash(s))) return true;
  }
  return false;
}

// Izuzeci: exceptions (opasne stranice, tačan host) i httpExceptions (stranice bez HTTPS-a, s poddomenama)
const fresh = (iso) => !!iso && Date.now() - Date.parse(iso) < EXCEPTION_DAYS * 86400000;
async function isExcepted(host) {
  const { exceptions = {} } = await chrome.storage.local.get('exceptions');
  return fresh(exceptions[norm(host)]);
}

const warningUrl = (kind, url) => `${chrome.runtime.getURL('warning.html')}#${kind}|${encodeURIComponent(url)}`;

// HTTPS-first: pravilo 2 (gpc-rules.json) mijenja http u https PRIJE slanja zahtjeva.
// Ako https ne radi, nudimo http preko upozorenja. Dozvoljeni http hostovi = dinamička "allow" pravila.
const HTTPS_BROKEN = /ERR_(CONNECTION_(REFUSED|RESET|CLOSED|TIMED_OUT)|TIMED_OUT|EMPTY_RESPONSE|SSL_|CERT_|BAD_SSL|INVALID_RESPONSE|TOO_MANY_REDIRECTS|ADDRESS_UNREACHABLE)/;
const upgraded = new Map(); // tabId -> http adresa koju smo prebacili na https

async function syncHttpRules() {
  const { httpExceptions = {} } = await chrome.storage.local.get('httpExceptions');
  for (const [h, t] of Object.entries(httpExceptions)) if (!fresh(t)) delete httpExceptions[h];
  await chrome.storage.local.set({ httpExceptions });
  const old = (await chrome.declarativeNetRequest.getDynamicRules()).map((r) => r.id);
  const hosts = Object.keys(httpExceptions);
  await chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: old,
    addRules: hosts.length ? [{ id: 100, priority: 3, action: { type: 'allow' }, condition: { requestDomains: hosts, resourceTypes: ['main_frame'] } }] : [],
  });
}

chrome.webNavigation.onBeforeNavigate.addListener(async (d) => {
  if (d.frameId !== 0) return;
  let u;
  try { u = new URL(d.url); } catch { return; }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
  if (u.protocol === 'http:') upgraded.set(d.tabId, d.url);
  await ensure();
  if (!isBlocked(u.hostname) || (await isExcepted(u.hostname))) return;
  chrome.tabs.update(d.tabId, { url: warningUrl('danger', d.url) });
});

chrome.webNavigation.onErrorOccurred.addListener((d) => {
  if (d.frameId !== 0) return;
  const httpUrl = upgraded.get(d.tabId);
  if (!httpUrl || !HTTPS_BROKEN.test(d.error)) return;
  let a, b;
  try { a = new URL(httpUrl); b = new URL(d.url); } catch { return; }
  if (b.protocol !== 'https:' || b.hostname !== a.hostname) return;
  upgraded.delete(d.tabId);
  chrome.tabs.update(d.tabId, { url: warningUrl('https', httpUrl) });
});
chrome.webNavigation.onCompleted.addListener((d) => { if (d.frameId === 0) upgraded.delete(d.tabId); });
chrome.tabs.onRemoved.addListener((id) => upgraded.delete(id));

// "Ipak otvori" sa stranice upozorenja (samo Iceove stranice mogu slati poruke; web stranice ne mogu)
chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.type !== 'proceed' || !sender.url?.startsWith(chrome.runtime.getURL('warning.html'))) return;
  (async () => {
    const host = norm(new URL(msg.url).hostname);
    const key = msg.kind === 'https' ? 'httpExceptions' : 'exceptions';
    const store = (await chrome.storage.local.get(key))[key] || {};
    store[host] = new Date().toISOString();
    for (const [h, t] of Object.entries(store)) if (!fresh(t)) delete store[h];
    await chrome.storage.local.set({ [key]: store });
    if (msg.kind === 'https') await syncHttpRules();
    reply({ ok: true });
  })();
  return true;
});

chrome.alarms.create('refresh', { periodInMinutes: 360 });
chrome.alarms.onAlarm.addListener((a) => a.name === 'refresh' && refresh());
chrome.runtime.onStartup.addListener(() => { ensure(); syncHttpRules(); });
chrome.runtime.onInstalled.addListener(() => { ensure(); syncHttpRules(); });

// Za testove i dijagnostiku
self.iceShield = { ensure, refresh, isBlocked, test, size: () => tables.exact.length + tables.wild.length };
