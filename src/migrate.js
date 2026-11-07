// Kompletna migracija iz Google Chromea u Ice.
// Chrome fajlovi se samo čitaju (kopija baza, original se ne dira). Ništa ne ide na mrežu.
// Ispisuju se samo brojevi, nikad sadržaj (lozinke, adrese, historija).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const importers = require('./importers');

function profileDir() {
  if (process.env.ICE_CHROME_PROFILE) return process.env.ICE_CHROME_PROFILE;
  const p = importers.findChromeProfile();
  if (!p) throw new Error('Chrome profil nije pronađen.');
  return p;
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return {}; }
}

function withDb(src, fn) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-migrate-'));
  try {
    const copy = path.join(tmp, 'db');
    fs.copyFileSync(src, copy);
    const db = new DatabaseSync(copy, { readOnly: true });
    try { return fn(db); } finally { db.close(); }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

const writePrivate = (file, data) => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, data, { mode: 0o600 });
};

// Chrome vrijeme: mikrosekunde od 1601-01-01 -> ISO datum
const chromeTime = (t) => (t && Number(t) > 0 ? new Date(Number(BigInt(t) / 1000n) - 11644473600000).toISOString() : null);

// ---------- Lozinke ----------

// Ključ "Chrome Safe Storage" iz GNOME keyringa. Čita ga mali python program i
// predaje direktno ovom procesu; ključ se nigdje ne ispisuje ni ne sprema.
const KEY_PY = `
import sys, gi
gi.require_version('Secret', '1')
from gi.repository import Secret
svc = Secret.Service.get_sync(Secret.ServiceFlags.NONE)
items = svc.search_sync(None, {'application': 'chrome'}, Secret.SearchFlags.ALL | Secret.SearchFlags.UNLOCK | Secret.SearchFlags.LOAD_SECRETS, None)
if not items: sys.exit(3)
sys.stdout.write(items[0].get_secret().get_text())
`;

function chromeKeys() {
  const keys = { v10: crypto.pbkdf2Sync('peanuts', 'saltysalt', 1, 16, 'sha1') };
  let secret = process.env.ICE_TEST_CHROME_KEY; // samo za testove
  if (secret === undefined) {
    const r = spawnSync('python3', ['-I', '-c', KEY_PY], { encoding: 'utf8' });
    if (r.status === 3) throw new Error('Chromeov ključ nije u keyringu.');
    if (r.status !== 0) throw new Error('Ne mogu pročitati keyring (treba python3-gi i libsecret).');
    secret = r.stdout;
  }
  keys.v11 = crypto.pbkdf2Sync(secret, 'saltysalt', 1, 16, 'sha1');
  return keys;
}

function decrypt(blob, keys) {
  if (!blob || !blob.length) return null;
  const buf = Buffer.from(blob);
  const prefix = buf.subarray(0, 3).toString('latin1');
  const key = keys[prefix];
  if (!key) return null;
  const d = crypto.createDecipheriv('aes-128-cbc', key, Buffer.alloc(16, 0x20));
  const text = Buffer.concat([d.update(buf.subarray(3)), d.final()]).toString('utf8');
  // Pogrešan ključ ponekad "prođe" provjeru paddinga i da smeće; to odbacujemo
  if (text.includes('�')) throw new Error('neispravno dešifrovano');
  return text;
}

async function migratePasswords(prof, dir, safeStorage) {
  const keys = chromeKeys();
  const entries = [];
  const neverSave = [];
  let noPassword = 0, failed = 0;
  for (const file of ['Login Data', 'Login Data For Account']) {
    const src = path.join(prof, file);
    if (!fs.existsSync(src)) continue;
    withDb(src, (db) => {
      // Chrome vremena su veća od JS Number.MAX_SAFE_INTEGER, pa ih čitamo kao tekst
      for (const r of db.prepare('SELECT origin_url, action_url, username_value, password_value, signon_realm, CAST(date_created AS TEXT) AS date_created, CAST(date_last_used AS TEXT) AS date_last_used, times_used, blacklisted_by_user FROM logins').all()) {
        if (r.blacklisted_by_user) { neverSave.push(r.origin_url); continue; }
        let password;
        try { password = decrypt(r.password_value, keys); } catch { failed++; continue; }
        if (!password) { noPassword++; continue; }
        entries.push({
          name: (() => { try { return new URL(r.origin_url).hostname; } catch { return r.signon_realm; } })(),
          url: r.origin_url,
          action: r.action_url,
          username: r.username_value,
          password,
          note: '',
          created: chromeTime(r.date_created),
          lastUsed: chromeTime(r.date_last_used),
          timesUsed: r.times_used,
          source: file === 'Login Data' ? 'lokalno' : 'google-račun',
        });
      }
    });
  }
  if (failed && !entries.length) throw new Error('Nijedna lozinka se nije dala dešifrovati (pogrešan ključ?).');
  const vault = await importers.writeVault(dir, safeStorage, { version: 1, importedFrom: 'chrome', entries, neverSave });
  return { passwords: entries.length, neverSave: neverSave.length, noPassword, failed, out: vault };
}

// ---------- Historija i preuzimanja ----------

function migrateHistory(prof, dir) {
  const src = path.join(prof, 'History');
  if (!fs.existsSync(src)) return { urls: 0, downloads: 0 };
  const { DatabaseSync } = require('node:sqlite');
  const outFile = path.join(dir, 'history.sqlite');
  fs.rmSync(outFile, { force: true });
  fs.mkdirSync(dir, { recursive: true });
  const out = new DatabaseSync(outFile);
  fs.chmodSync(outFile, 0o600);
  out.exec(`
    CREATE TABLE urls (url TEXT PRIMARY KEY, title TEXT, visits INTEGER, typed INTEGER, last_visit TEXT);
    CREATE TABLE downloads (url TEXT, path TEXT, bytes INTEGER, started TEXT, mime TEXT, state INTEGER);
  `);
  const counts = withDb(src, (db) => {
    const urls = db.prepare('SELECT url, title, visit_count, typed_count, CAST(last_visit_time AS TEXT) AS last_visit_time FROM urls').all();
    const insU = out.prepare('INSERT OR REPLACE INTO urls VALUES (?, ?, ?, ?, ?)');
    out.exec('BEGIN');
    for (const u of urls) insU.run(u.url, u.title, u.visit_count, u.typed_count, chromeTime(u.last_visit_time));
    const dls = db.prepare(`SELECT d.target_path, d.total_bytes, CAST(d.start_time AS TEXT) AS start_time, d.mime_type, d.state,
      (SELECT c.url FROM downloads_url_chains c WHERE c.id = d.id ORDER BY c.chain_index DESC LIMIT 1) AS url
      FROM downloads d`).all();
    const insD = out.prepare('INSERT INTO downloads VALUES (?, ?, ?, ?, ?, ?)');
    for (const d of dls) insD.run(d.url, d.target_path, d.total_bytes, chromeTime(d.start_time), d.mime_type, d.state);
    out.exec('COMMIT');
    return { urls: urls.length, downloads: dls.length };
  });
  out.close();
  return { ...counts, out: outFile };
}

// ---------- Postavke, pretraživači, dozvole ----------

const PERMISSION_MAP = {
  geolocation: 'geolocation',
  notifications: 'notifications',
  media_stream_camera: 'media:video',
  media_stream_mic: 'media:audio',
  clipboard: 'clipboard-read',
  midi_sysex: 'midiSysex',
};

// "https://primjer.com:443,*" -> "https://primjer.com"
function patternToOrigin(pattern) {
  const first = pattern.split(',')[0].replace('[*.]', '');
  if (first.includes('*')) return null;
  try { return new URL(first.includes('://') ? first : `https://${first}`).origin; } catch { return null; }
}

function migrateSettings(prof, dir) {
  const prefs = readJson(path.join(prof, 'Preferences'));
  const secure = readJson(path.join(prof, 'Secure Preferences'));
  const p = { ...prefs, ...secure };

  // Pretraživači
  const webData = path.join(prof, 'Web Data');
  const engines = !fs.existsSync(webData) ? [] : withDb(webData, (db) =>
    db.prepare('SELECT short_name, keyword, url, suggest_url, favicon_url FROM keywords').all()
      .map((k) => ({ name: k.short_name, keyword: k.keyword, url: k.url, suggest: k.suggest_url || null, icon: k.favicon_url || null })));
  const def = p.default_search_provider_data?.template_url_data;

  const settings = {
    version: 1,
    importedFrom: 'chrome',
    homepage: p.homepage || null,
    homepageIsNewTab: p.homepage_is_newtabpage ?? null,
    showHomeButton: p.browser?.show_home_button ?? null,
    startup: { restore: p.session?.restore_on_startup ?? null, urls: p.session?.startup_urls || [] },
    search: { default: def ? { name: def.short_name, keyword: def.keyword, url: def.url } : null, engines },
    languages: p.intl?.accept_languages || null,
    downloads: { directory: p.download?.default_directory || null, ask: p.download?.prompt_for_download ?? null },
    showBookmarksBar: p.bookmark_bar?.show_on_all_tabs ?? null,
    zoom: p.partition?.per_host_zoom_levels || {},
    fonts: p.webkit?.webprefs || {},
    theme: p.browser?.theme || null,
  };
  writePrivate(path.join(dir, 'settings.json'), JSON.stringify(settings, null, 1));

  // Dozvole po stranicama -> Iceov permissions.json (Iceove postojeće odluke imaju prednost)
  const permFile = path.join(dir, 'permissions.json');
  const perms = readJson(permFile);
  let permCount = 0;
  const ex = p.profile?.content_settings?.exceptions || {};
  for (const [chromeType, iceKey] of Object.entries(PERMISSION_MAP)) {
    for (const [pattern, v] of Object.entries(ex[chromeType] || {})) {
      if (v.setting !== 1 && v.setting !== 2) continue; // 1 = dozvoljeno, 2 = blokirano
      const origin = patternToOrigin(pattern);
      if (!origin) continue;
      perms[origin] ||= {};
      if (perms[origin][iceKey] === undefined) { perms[origin][iceKey] = v.setting === 1; permCount++; }
    }
  }
  writePrivate(permFile, JSON.stringify(perms, null, 1));

  return { engines: engines.length, permissions: permCount };
}

// ---------- Ekstenzije ----------

// Flatpak Chrome vidi raspakovane ekstenzije kroz "document portal" (/run/flatpak/doc/<id>/...).
// Van Flatpaka ta putanja ne postoji, pa tražimo pravi folder.
function resolveExtensionPath(p) {
  if (!p) return null;
  if (fs.existsSync(p)) return p;
  const m = /^\/run\/flatpak\/doc\/([^/]+)\/(.+)$/.exec(p);
  if (!m) return null;
  const portal = path.join('/run/user', String(os.userInfo().uid), 'doc', m[1], m[2]);
  const info = spawnSync('flatpak', ['document-info', portal], { encoding: 'utf8' });
  const origin = /^origin:\s*(.+)$/m.exec(info.stdout || '')?.[1]?.trim();
  if (origin && fs.existsSync(origin)) return origin;
  return fs.existsSync(portal) ? portal : null;
}

function migrateExtensions(prof, dir) {
  const prefs = readJson(path.join(prof, 'Preferences'));
  const secure = readJson(path.join(prof, 'Secure Preferences'));
  const all = { ...prefs.extensions?.settings, ...secure.extensions?.settings };
  const target = path.join(dir, 'extensions');
  fs.mkdirSync(target, { recursive: true });
  const list = [];
  let copied = 0, missing = 0;

  for (const [id, e] of Object.entries(all)) {
    if (e.location !== 1 && e.location !== 4) continue; // 1 = Chrome Web Store, 4 = raspakovana (tvoja)
    let src = null;
    if (e.location === 4) src = resolveExtensionPath(e.path);
    else {
      const base = path.join(prof, 'Extensions', id);
      const versions = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
      if (versions.length) src = path.join(base, versions[versions.length - 1]);
    }
    let manifest = e.manifest || {};
    if (src && fs.existsSync(path.join(src, 'manifest.json'))) manifest = readJson(path.join(src, 'manifest.json'));

    const dest = path.join(target, id);
    if (src) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(src, dest, { recursive: true });
      const data = path.join(prof, 'Local Extension Settings', id);
      if (fs.existsSync(data)) fs.cpSync(data, path.join(target, `${id}.data`), { recursive: true });
      copied++;
    } else missing++;

    list.push({
      id,
      name: manifest.name || null,
      version: manifest.version || null,
      manifestVersion: manifest.manifest_version || null,
      enabled: !(e.disable_reasons && e.disable_reasons.length) && e.state !== 0,
      source: e.location === 1 ? 'chrome-web-store' : 'raspakovana',
      originalPath: e.location === 4 ? (src || e.path) : undefined,
      copied: !!src,
      dir: src ? dest : null,
    });
  }
  // Imena tipa "__MSG_appName__" čitamo iz _locales
  for (const x of list) {
    const m = /^__MSG_(.+)__$/.exec(x.name || '');
    if (!m || !x.dir) continue;
    for (const loc of ['en', 'en_US', 'bs', 'hr', 'sr']) {
      const msgs = readJson(path.join(x.dir, '_locales', loc, 'messages.json'));
      const hit = Object.entries(msgs).find(([k]) => k.toLowerCase() === m[1].toLowerCase());
      if (hit) { x.name = hit[1].message; break; }
    }
  }
  writePrivate(path.join(dir, 'extensions.json'), JSON.stringify({ version: 1, loaded: false, extensions: list }, null, 1));
  return { extensions: list.length, copied, missing, disabled: list.filter((x) => !x.enabled).length };
}

// ---------- Sve zajedno ----------

async function migrateAll(dir, safeStorage, { passwords = true } = {}) {
  const prof = profileDir();
  const report = {};
  const step = async (name, fn) => {
    try { report[name] = await fn(); } catch (e) { report[name] = { error: e.message }; }
  };
  await step('bookmarks', () => importers.importBookmarks(dir, prof));
  await step('autofill', () => importers.importAutofill(dir, safeStorage, prof));
  if (passwords) await step('lozinke', () => migratePasswords(prof, dir, safeStorage));
  await step('historija', () => migrateHistory(prof, dir));
  await step('postavke', () => migrateSettings(prof, dir));
  await step('ekstenzije', () => migrateExtensions(prof, dir));
  return report;
}

module.exports = { migrateAll, decrypt, chromeKeys, patternToOrigin };
