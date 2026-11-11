// Google Safe Browsing v5 za Ice Shield: lokalne liste heš prefiksa (hashLists:batchGet)
// + potvrda punog heša (hashes:search). Googleu idu samo 4-bajtni prefiksi heševa, nikad adrese.
// Bez API ključa (chrome.storage.local.gsbApiKey) sve je isključeno i ništa se ne šalje.

import * as P from './proto.js';
import * as C from './core.js';
import { urlHashes } from './url.js';

const DB_NAME = 'ice-shield-gsb';
const STORE = 'lists';
const ALARM = 'gsb-update';
const UPDATE_TIMEOUT_MS = 60e3;
const SEARCH_TIMEOUT_MS = 10e3;

const lists = new Map(); // ime -> { prefixes: Uint32Array, checksum, version, updated }
let loaded = null;
let updating = null;
let searchFails = 0;
let searchBackoffUntil = 0;

// ---------- IndexedDB ----------

function openDb() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: 'name' });
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}
async function dbTx(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const out = fn(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(out?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally { db.close(); }
}
const toRecord = (name, r) => ({
  name, prefixes: r.prefixes.buffer.slice(r.prefixes.byteOffset, r.prefixes.byteOffset + r.prefixes.byteLength),
  checksum: Uint8Array.from(r.checksum), version: Uint8Array.from(r.version), updated: r.updated,
});

// ---------- postavke i stanje ----------

export async function settings() {
  const { gsbApiKey = '', gsbEndpoint = '' } = await chrome.storage.local.get(['gsbApiKey', 'gsbEndpoint']);
  return { key: String(gsbApiKey).trim(), endpoint: String(gsbEndpoint || C.DEFAULT_ENDPOINT).trim() };
}
async function getState() { return (await chrome.storage.local.get('gsbState')).gsbState || {}; }
async function setState(patch) {
  const s = { ...(await getState()), ...patch };
  await chrome.storage.local.set({ gsbState: s });
  return s;
}
function summary() {
  const o = {};
  for (const l of C.LISTS) {
    const r = lists.get(l.name);
    o[l.name] = { count: r ? r.prefixes.length : 0, updated: r?.updated || null };
  }
  return o;
}

export function loadLists() {
  return (loaded ||= (async () => {
    try {
      const all = await dbTx('readonly', (s) => s.getAll());
      for (const r of all || []) {
        lists.set(r.name, { prefixes: new Uint32Array(r.prefixes), checksum: new Uint8Array(r.checksum), version: new Uint8Array(r.version), updated: r.updated });
      }
    } catch (e) { console.warn(`[Ice Shield] GSB liste nisu učitane: ${e.message}`); }
  })());
}

async function fetchBytes(url, timeoutMs) {
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(url, { cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', signal: ac.signal });
    if (!r.ok) {
      let msg = `HTTP ${r.status}`;
      try { const j = JSON.parse(await r.text()); if (j?.error?.message) msg += `: ${j.error.message}`; } catch { /* nije JSON */ }
      throw new C.GsbError('kHttpError', msg);
    }
    return new Uint8Array(await r.arrayBuffer());
  } catch (e) {
    if (e instanceof C.GsbError) throw e;
    throw new C.GsbError('kNetworkError', e.name === 'AbortError' ? 'isteklo vrijeme' : e.message);
  } finally { clearTimeout(t); }
}

function schedule(when) {
  // chrome.alarms ne ide ispod 30 s; server ionako traži minimalni razmak
  chrome.alarms.create(ALARM, { when: Math.max(when, Date.now() + 30e3) });
}

// ---------- ažuriranje lista ----------

// force: korisnik je tražio ažuriranje. Preskače čekanje nakon greške (backoff),
// ali ne i minimum_wait_duration koji je Google zadao nakon uspješnog ažuriranja.
export function update({ force = false } = {}) {
  return (updating ||= doUpdate(force).finally(() => { updating = null; }));
}

async function doUpdate(force) {
  const { key, endpoint } = await settings();
  if (!key) { await chrome.alarms.clear(ALARM); return { ok: false, skipped: 'no-key' }; }
  await loadLists();
  const st = await getState();
  const now = Date.now();
  if (st.minWaitUntil && now < st.minWaitUntil) {
    schedule(Math.max(st.nextUpdate || 0, st.minWaitUntil));
    return { ok: false, skipped: 'min-wait', until: st.minWaitUntil };
  }
  if (!force && st.nextUpdate && now < st.nextUpdate) { schedule(st.nextUpdate); return { ok: false, skipped: 'not-yet' }; }

  const names = C.LISTS.map((l) => l.name);
  const versions = names.map((n) => lists.get(n)?.version).filter((v) => v && v.length);
  // Verzije idu paralelno s imenima; ako neka lista nema verziju, traže se sve ispočetka.
  const req = P.base64UrlEncode(P.encodeBatchGetHashListsRequest(names, versions.length === names.length ? versions : []));
  try {
    const body = await fetchBytes(C.batchGetUrl(endpoint, req, key), UPDATE_TIMEOUT_MS);
    let parsed;
    try { parsed = C.validateBatchResponse(P.decodeBatchGetHashListsResponse(body), names); } catch (e) {
      throw e instanceof C.GsbError ? e : new C.GsbError('kParseFromStringError', e.message);
    }
    const listErrors = {};
    const records = [];
    for (const hl of parsed.lists) {
      try {
        const next = { ...(await C.applyHashList(lists.get(hl.name), hl)), updated: now };
        lists.set(hl.name, next);
        records.push(toRecord(hl.name, next));
      } catch (e) {
        // Stari podaci ostaju za provjere, ali sljedeći put se lista traži cijela.
        listErrors[hl.name] = e.message;
        const old = lists.get(hl.name);
        if (old) { old.version = new Uint8Array(0); records.push(toRecord(hl.name, old)); }
      }
    }
    if (records.length) await dbTx('readwrite', (s) => { for (const r of records) s.put(r); });
    const errs = Object.entries(listErrors).map(([n, m]) => `${n}: ${m}`).join('; ');
    const s = await setState({
      enabled: true, lastAttempt: now, lastUpdate: now, errorCount: 0,
      minWaitUntil: now + parsed.minWaitMs, nextUpdate: now + parsed.minWaitMs,
      lastError: errs || null, lastErrorTime: errs ? now : (st.lastErrorTime || null), lists: summary(),
    });
    schedule(s.nextUpdate);
    return { ok: !errs, error: errs || undefined };
  } catch (e) {
    const errorCount = (st.errorCount || 0) + 1;
    const s = await setState({
      enabled: true, lastAttempt: now, errorCount, nextUpdate: now + C.updateBackoffMs(errorCount),
      lastError: e.message, lastErrorTime: now, lists: summary(),
    });
    schedule(s.nextUpdate);
    return { ok: false, error: e.message };
  }
}

// ---------- provjera adrese ----------

const hexToBytes = (hex) => Uint8Array.from(hex.match(/../g), (h) => parseInt(h, 16));

async function cacheGet() {
  try { return (await chrome.storage.session.get('gsbCache')).gsbCache || {}; } catch { return {}; }
}
async function cacheSet(cache) {
  const now = Date.now();
  for (const [k, v] of Object.entries(cache)) if (v.exp <= now) delete cache[k];
  try { await chrome.storage.session.set({ gsbCache: cache }); } catch { /* keš je samo ubrzanje */ }
}

// Vraća { source: 'google', threat: 'URL_PHISHING' | 'URL_MALWARE' | 'URL_UNWANTED' } ili null.
// Na grešku mreže ne blokira (kao Chromium: bez potvrde punog heša nema upozorenja).
export async function check(url) {
  const { key, endpoint } = await settings();
  if (!key) return null;
  await loadLists();
  if (!lists.size) return null;
  const hits = C.localHits(await urlHashes(url), new Map([...lists].map(([n, r]) => [n, r.prefixes])));
  if (!hits.length) return null;

  const now = Date.now();
  const cache = await cacheGet();
  const byHex = new Map();
  const add = (fh) => { if (!byHex.has(fh.fullHash)) byHex.set(fh.fullHash, []); byHex.get(fh.fullHash).push(fh); };
  const toRequest = [];
  for (const p of [...new Set(hits.map((h) => h.prefix))].sort((a, b) => a - b)) {
    const hex = C.toHex(C.prefixBytes(p));
    const c = cache[hex];
    if (c && c.exp > now) c.fullHashes.forEach(add); else toRequest.push(hex);
  }
  if (toRequest.length) {
    if (now < searchBackoffUntil) return null;
    try {
      const req = P.base64UrlEncode(P.encodeSearchHashesRequest(toRequest.map(hexToBytes)));
      const body = await fetchBytes(C.searchUrl(endpoint, req, key), SEARCH_TIMEOUT_MS);
      let res;
      try { res = C.validateSearchResponse(P.decodeSearchHashesResponse(body), toRequest); } catch (e) {
        throw e instanceof C.GsbError ? e : new C.GsbError('kParseError', e.message);
      }
      for (const hex of toRequest) cache[hex] = { exp: now + res.cacheMs, fullHashes: res.fullHashes.filter((f) => f.fullHash.startsWith(hex)) };
      res.fullHashes.forEach(add);
      await cacheSet(cache);
      searchFails = 0;
    } catch (e) {
      searchFails++;
      searchBackoffUntil = now + Math.min(30 * 60e3, 60e3 * 2 ** (searchFails - 1));
      await setState({ lastSearchError: e.message, lastSearchErrorTime: now });
      return null;
    }
  }
  const threat = C.decideThreat(hits, byHex);
  return threat ? { source: 'google', threat } : null;
}

// ---------- pokretanje ----------

async function resetAll() {
  lists.clear();
  loaded = Promise.resolve();
  try { await dbTx('readwrite', (s) => s.clear()); } catch { /* nema baze */ }
  try { await chrome.storage.session.remove('gsbCache'); } catch { /* */ }
}

export async function start() {
  const { key } = await settings();
  if (!key) return;
  const st = await getState();
  if (!(await chrome.alarms.get(ALARM))) {
    if (!st.nextUpdate || Date.now() >= st.nextUpdate) update(); else schedule(st.nextUpdate);
  }
}

export function init() {
  chrome.alarms.onAlarm.addListener((a) => { if (a.name === ALARM) update(); });
  chrome.storage.onChanged.addListener(async (ch, area) => {
    if (area !== 'local' || !(ch.gsbApiKey || ch.gsbEndpoint)) return;
    await updating?.catch(() => {});
    if (ch.gsbEndpoint) await resetAll(); // liste s drugog servera ne vrijede
    searchFails = 0; searchBackoffUntil = 0;
    const { key } = await settings();
    // Novi ključ ili server: počinje se ispočetka (bez backoffa i bez starog čekanja)
    await chrome.storage.local.set({ gsbState: { enabled: !!key, lists: summary() } });
    if (key) update({ force: true }); else await chrome.alarms.clear(ALARM);
  });
  // Stranica s postavkama: "Ažuriraj sada"
  chrome.runtime.onMessage.addListener((msg, sender, reply) => {
    if (msg?.type !== 'gsb-update' || !sender.url?.startsWith(chrome.runtime.getURL('options.html'))) return;
    update({ force: true }).then(reply, (e) => reply({ ok: false, error: e.message }));
    return true;
  });
}

export const _debug = { lists, getState };
