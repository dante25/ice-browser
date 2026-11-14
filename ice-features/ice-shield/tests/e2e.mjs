// End-to-end test: Ice Shield u Chromiumu (Playwright) protiv lažnog Safe Browsing v5 servera.
// Pokretanje: NODE_PATH=$(npm root -g) node tests/e2e.mjs
// Ništa ne ide prema Googleu: gsbEndpoint pokazuje na lokalni server, a svi hostovi se
// preko --host-resolver-rules preusmjeravaju na 127.0.0.1.
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

import * as P from '../gsb/proto.js';
import { encodeRice32 } from '../gsb/rice.js';
import { urlExpressions } from '../gsb/url.js';

const require = createRequire(import.meta.url);
let playwright;
try { playwright = require('playwright'); } catch { playwright = require(path.join(execSync('npm root -g').toString().trim(), 'playwright')); }

const EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT_ID = 'lbincgmkngjhncpmjjmghblelehjilfg';
const KEY = 'test-key-123';

const sha = (s) => createHash('sha256').update(Buffer.from(s, 'latin1')).digest();
const prefixOf = (expr) => sha(expr).readUInt32BE(0);
const checksumOf = (vals) => {
  const b = Buffer.alloc(vals.length * 4);
  vals.forEach((v, i) => b.writeUInt32BE(v, i * 4));
  return new Uint8Array(createHash('sha256').update(b).digest());
};
const sorted = (a) => [...new Set(a)].sort((x, y) => x - y);
function randomPrefixes(n, seed) {
  const out = [];
  let x = seed;
  for (let i = 0; i < n; i++) { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; out.push(x); }
  return out;
}

const results = [];
function check(name, ok, extra = '') {
  results.push({ name, ok });
  console.log(`${ok ? 'OK  ' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
}

// ---------- lažni server ----------

const server = http.createServer();
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const PORT = server.address().port;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const PHISH_URL = `http://phish.ice-gsb.test:${PORT}/login/index.html?x=1`;
const CLEAN_URL = `http://clean.ice-gsb.test:${PORT}/`;
const COLLIDE_URL = `http://collide.ice-gsb.test:${PORT}/`;
const LISTS_URL = `http://blocked-by-lists.test:${PORT}/`;

// Prijetnja je upisana kao "phish.ice-gsb.test/login/" (host x prefiks putanje), kao u pravim listama.
const PHISH_EXPR = 'phish.ice-gsb.test/login/';
assert.ok(urlExpressions(PHISH_URL).includes(PHISH_EXPR));
const PHISH_PREFIX = prefixOf(PHISH_EXPR);
const COLLIDE_PREFIX = prefixOf('collide.ice-gsb.test/');

const state = {
  se: sorted([PHISH_PREFIX, COLLIDE_PREFIX, ...randomPrefixes(5000, 1)]),
  mw: sorted(randomPrefixes(3000, 2)),
  uws: sorted(randomPrefixes(1000, 3)),
  version: 1,
};
const log = { batchGet: [], search: [], pages: [] };

function fullList(name, vals) {
  return { name, version: Buffer.from(`v${state.version}`), partialUpdate: false, additionsFourBytes: encodeRice32(vals, 18), minimumWaitDuration: { seconds: 2 }, sha256Checksum: checksumOf(vals) };
}

server.on('request', (req, res) => {
  const u = new URL(req.url, ORIGIN);
  if (u.pathname.startsWith('/v5/')) {
    const reqParam = u.searchParams.get('$req');
    if (u.searchParams.get('key') !== KEY || u.searchParams.get('$ct') !== 'application/x-protobuf' || !reqParam) {
      res.writeHead(403, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 403, message: 'Please use API Key' } }));
      return;
    }
    const raw = P.base64UrlDecode(reqParam);
    if (u.pathname === '/v5/hashLists:batchGet') {
      const r = P.decodeBatchGetHashListsRequest(raw);
      const versions = r.versions.map((v) => Buffer.from(v).toString());
      log.batchGet.push({ names: r.names, versions, url: req.url });
      let lists;
      if (versions.length === 3 && versions.every((v) => v === `v${state.version}`)) {
        // djelimično ažuriranje: iz mw-4b ukloni indekse 0 i 10, dodaj dva nova; se-4b bez promjena
        const removedIdx = [0, 10];
        const added = sorted([5, 0xfffffff0].filter((v) => !state.mw.includes(v)));
        const next = sorted([...state.mw.filter((_, i) => !removedIdx.includes(i)), ...added]);
        state.mw = next;
        state.version++;
        const ver = Buffer.from(`v${state.version}`);
        lists = [
          { name: 'se-4b', version: ver, partialUpdate: true, minimumWaitDuration: { seconds: 2 } },
          { name: 'mw-4b', version: ver, partialUpdate: true, additionsFourBytes: encodeRice32(added, 30), compressedRemovals: encodeRice32(removedIdx, 3), minimumWaitDuration: { seconds: 2 }, sha256Checksum: checksumOf(next) },
          { name: 'uws-4b', version: ver, partialUpdate: true, minimumWaitDuration: { seconds: 2 } },
        ];
      } else {
        lists = [fullList('se-4b', state.se), fullList('mw-4b', state.mw), fullList('uws-4b', state.uws)];
      }
      res.writeHead(200, { 'content-type': 'application/x-protobuf' });
      res.end(Buffer.from(P.encodeBatchGetHashListsResponse(lists)));
      return;
    }
    if (u.pathname === '/v5/hashes:search') {
      const prefixes = P.decodeSearchHashesRequest(raw).hashPrefixes.map((p) => Buffer.from(p));
      log.search.push({ prefixes: prefixes.map((p) => p.toString('hex')), url: req.url });
      const fullHashes = [];
      for (const p of prefixes) {
        if (p.readUInt32BE(0) === PHISH_PREFIX) fullHashes.push({ fullHash: sha(PHISH_EXPR), details: [{ threatType: 2 }] });
        if (p.readUInt32BE(0) === COLLIDE_PREFIX) {
          const other = Buffer.from(sha('collide.ice-gsb.test/'));
          other[31] ^= 0xff; // isti 4-bajtni prefiks, drugi puni heš
          fullHashes.push({ fullHash: other, details: [{ threatType: 2 }] });
        }
      }
      res.writeHead(200, { 'content-type': 'application/x-protobuf' });
      res.end(Buffer.from(P.encodeSearchHashesResponse({ fullHashes, cacheDuration: { seconds: 300 } })));
      return;
    }
    res.writeHead(404); res.end(); return;
  }
  log.pages.push({ host: req.headers.host, path: req.url, gpc: req.headers['sec-gpc'] });
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(`<!doctype html><title>stranica</title><h1>STRANICA ${req.headers.host}${req.url}</h1>`);
});

// ---------- Chromium ----------

const userDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-shield-e2e-'));
const context = await playwright.chromium.launchPersistentContext(userDir, {
  channel: 'chromium',
  headless: true,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--host-resolver-rules=MAP * 127.0.0.1', '--no-first-run'],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function until(fn, ms = 15000, what = 'uslov') {
  const t0 = Date.now();
  for (;;) {
    const v = await fn().catch(() => null);
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`isteklo čekanje: ${what}`);
    await sleep(200);
  }
}

try {
  const sw = context.serviceWorkers().find((w) => w.url().includes(EXT_ID)) || await context.waitForEvent('serviceworker', { timeout: 15000 });
  check('Ice Shield service worker je pokrenut', sw.url().startsWith(`chrome-extension://${EXT_ID}/`));
  const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
  check('verzija 1.1.0 i options_ui', manifest.version === '1.1.0' && manifest.options_ui?.page === 'options.html');
  await sw.evaluate(() => self.iceShield.ensure());

  const page = await context.newPage();
  const visit = async (url) => {
    await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await sleep(1500); // provjera je asinhrona; dati vremena za eventualno preusmjeravanje
    return page.url();
  };
  const isWarning = (u) => u.startsWith(`chrome-extension://${EXT_ID}/warning.html`);

  // 1. Bez ključa: ništa ne ide prema serveru i ništa se ne blokira
  let u = await visit(PHISH_URL);
  check('bez API ključa: nema blokiranja', !isWarning(u), u);
  check('bez API ključa: nema zahtjeva prema Safe Browsing serveru', log.batchGet.length === 0 && log.search.length === 0);
  const st0 = await sw.evaluate(() => chrome.storage.local.get('gsbState'));
  check('bez API ključa: nema zapisane greške', !st0.gsbState?.lastError);

  // 2. Postavi ključ i lažni server -> liste se preuzmu
  await sw.evaluate(([endpoint, key]) => chrome.storage.local.set({ gsbEndpoint: endpoint, gsbApiKey: key }), [ORIGIN, KEY]);
  const st1 = await until(async () => {
    const { gsbState } = await sw.evaluate(() => chrome.storage.local.get('gsbState'));
    return gsbState?.lists?.['se-4b']?.count > 0 && gsbState;
  }, 20000, 'preuzimanje lista');
  check('liste preuzete (se-4b, mw-4b, uws-4b)', st1.lists['se-4b'].count === state.se.length && st1.lists['mw-4b'].count === state.mw.length && st1.lists['uws-4b'].count === state.uws.length,
    `${st1.lists['se-4b'].count}/${st1.lists['mw-4b'].count}/${st1.lists['uws-4b'].count}`);
  check('batchGet traži iste liste kao Chromium, bez verzija prvi put', JSON.stringify(log.batchGet[0]?.names) === '["se-4b","mw-4b","uws-4b"]' && log.batchGet[0].versions.length === 0);
  check('batchGet URL: /v5/hashLists:batchGet?$req=..&$ct=application/x-protobuf&key=..', /^\/v5\/hashLists:batchGet\?\$req=[A-Za-z0-9_=-]+&\$ct=application\/x-protobuf&key=test-key-123$/.test(log.batchGet[0]?.url || ''));
  check('nema greške nakon ažuriranja', !st1.lastError, st1.lastError || '');
  check('sljedeće ažuriranje poštuje minimum_wait_duration', st1.nextUpdate - st1.lastUpdate === 2000);
  const alarm = await sw.evaluate(() => chrome.alarms.get('gsb-update'));
  check('chrome.alarms zakazan za automatsko ažuriranje', !!alarm);

  // 3. Phishing adresa -> upozorenje (potvrđeno punim hešom)
  u = await visit(PHISH_URL);
  check('phishing adresa (potvrđen puni heš) je blokirana', isWarning(u), u);
  const text = isWarning(u) ? await page.textContent('body') : '';
  check('upozorenje navodi izvor Google Safe Browsing i vrstu prijetnje', /Google Safe Browsing/.test(text) && /phishing/.test(text));
  check('hashes:search pozvan sa 4-bajtnim prefiksom', log.search.length === 1 && log.search[0].prefixes.every((p) => p.length === 8) && log.search[0].prefixes.includes(PHISH_PREFIX.toString(16).padStart(8, '0')));
  check('Googleu ne ide adresa: zahtjev sadrži samo prefikse', log.search.every((s) => !/ice-gsb|login|phish/.test(decodeURIComponent(s.url)) && !Buffer.from(P.base64UrlDecode(new URL(s.url, ORIGIN).searchParams.get('$req'))).toString('latin1').includes('phish')));
  check('URL pretrage: /v5/hashes:search?$req=..&$ct=application/x-protobuf&key=..', /^\/v5\/hashes:search\?\$req=[A-Za-z0-9_=-]+&\$ct=application\/x-protobuf&key=test-key-123$/.test(log.search[0]?.url || ''));

  // 4. Ponovo ista adresa -> keš (cache_duration 300 s), bez novog zahtjeva
  u = await visit(PHISH_URL);
  check('ponovna posjeta: blokirano iz keša, bez novog hashes:search', isWarning(u) && log.search.length === 1, `pretraga: ${log.search.length}`);

  // 5. Čista adresa -> nema blokiranja, nema zahtjeva Googleu
  u = await visit(CLEAN_URL);
  const gpcJs = await page.evaluate(() => navigator.globalPrivacyControl).catch(() => null);
  check('čista adresa nije blokirana', !isWarning(u) && /STRANICA clean\.ice-gsb\.test/.test(await page.textContent('body')), u);
  check('čista adresa: bez hashes:search (nema lokalnog pogotka prefiksa)', log.search.length === 1);

  // 6. Prefiks se poklapa, puni heš ne -> ne blokira
  u = await visit(COLLIDE_URL);
  check('isti prefiks, drugi puni heš: nije blokirano', !isWarning(u) && log.search.length === 2, u);

  // 7. Stare javne liste i dalje rade (izvor: lists)
  await sw.evaluate(() => { self.iceShield.test.exact.add('blocked-by-lists.test'); });
  u = await visit(LISTS_URL);
  check('javne liste i dalje blokiraju (izvor: lists)', isWarning(u) && u.endsWith('|lists|'), u);
  // Napomena: glavni zahtjevi prema .test/localhost nemaju Sec-GPC jer ih postojeća "allow" pravila 3/4
  // (izuzetak od HTTPS-first) imaju veći prioritet; zato se provjeravaju podzahtjevi (favicon).
  const sub = log.pages.filter((p) => p.path === '/favicon.ico');
  check('GPC: Sec-GPC: 1 na podzahtjevima i dalje radi', sub.length > 0 && sub.every((p) => p.gpc === '1'), `${sub.length} podzahtjeva`);
  check('GPC: navigator.globalPrivacyControl === true', gpcJs === true);

  // 7b. HTTPS-first i dalje radi: http -> https (lažni server ne zna TLS) -> upozorenje "https"
  u = await visit(`http://nohttps.example:${PORT}/`);
  check('HTTPS-first: stranica bez HTTPS-a daje upozorenje', u.startsWith(`chrome-extension://${EXT_ID}/warning.html#https|`), u);

  // 8. Stranica s postavkama: stanje + "Ažuriraj sada" -> djelimično ažuriranje s verzijama
  await sleep(2100); // minimum_wait_duration = 2 s
  const opt = await context.newPage();
  await opt.goto(`chrome-extension://${EXT_ID}/options.html`);
  await opt.waitForFunction(() => document.getElementById('state').textContent.includes('uključeno'));
  const tableText = await opt.textContent('#lists');
  check('postavke prikazuju broj prefiksa po listi', tableText.replace(/[.,\s\u00a0]/g, '').includes(`se-4b${'phishing/socijalniinženjering'}${state.se.length}`), tableText.replace(/\s+/g, ' ').slice(0, 120));
  const mwBefore = state.mw.length;
  await opt.click('#update');
  await opt.waitForFunction(() => /ažurirane|Greška|pauzu/.test(document.getElementById('msg').textContent), null, { timeout: 15000 });
  const msg = await opt.textContent('#msg');
  check('"Ažuriraj sada" radi', /ažurirane/.test(msg), msg);
  check('drugi batchGet šalje verzije (djelimično ažuriranje)', log.batchGet.length === 2 && JSON.stringify(log.batchGet[1].versions) === '["v1","v1","v1"]', JSON.stringify(log.batchGet[1]?.versions));
  const st2 = (await sw.evaluate(() => chrome.storage.local.get('gsbState'))).gsbState;
  check('djelimično ažuriranje primijenjeno (uklanjanja + dodavanja, kontrolni zbir OK)', !st2.lastError && st2.lists['mw-4b'].count === state.mw.length && st2.lists['se-4b'].count === state.se.length,
    `mw ${mwBefore} -> ${st2.lists['mw-4b'].count}, očekivano ${state.mw.length}; ${st2.lastError || ''}`);
  const tooSoon = await opt.evaluate(() => chrome.runtime.sendMessage({ type: 'gsb-update' }));
  check('prerano ponovno ažuriranje odbijeno (minimum_wait_duration)', tooSoon?.skipped === 'min-wait' && log.batchGet.length === 2, JSON.stringify(tooSoon));

  // 9. Nakon ponovnog pokretanja service workera liste se učitaju iz IndexedDB
  const persisted = await sw.evaluate(async () => {
    const db = await new Promise((res, rej) => { const r = indexedDB.open('ice-shield-gsb', 1); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const all = await new Promise((res) => { const q = db.transaction('lists').objectStore('lists').getAll(); q.onsuccess = () => res(q.result); });
    db.close();
    return all.map((r) => [r.name, r.prefixes.byteLength / 4, new TextDecoder().decode(r.version)]);
  });
  check('liste su sačuvane u IndexedDB (kompaktno, Uint32)', persisted.length === 3 && persisted.every(([, , v]) => v === 'v2'), JSON.stringify(persisted));

  // 10. Uklanjanje ključa gasi Google provjere
  await opt.click('#remove');
  await sleep(500);
  const searchesBefore = log.search.length;
  await sw.evaluate(() => chrome.storage.session.remove('gsbCache'));
  u = await visit(PHISH_URL);
  check('nakon uklanjanja ključa: nema Google provjere ni blokiranja', !isWarning(u) && log.search.length === searchesBefore, u);
} catch (e) {
  check(`neočekivana greška: ${e.message}`, false);
} finally {
  await context.close();
  server.close();
  fs.rmSync(userDir, { recursive: true, force: true });
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} provjera prošlo`);
process.exit(failed ? 1 : 0);
