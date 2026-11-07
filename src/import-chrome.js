// Prenos iz Google Chromea u Iceov (Chromium) profil: bookmarks, historija, lozinke, dozvole po
// stranicama, zoom, jezici, zadani pretraživač. Chrome se samo čita (kopije baza). Ice mora biti zatvoren.
// Lozinke: dešifruju se Chromeovim ključem iz keyringa i ponovo šifruju Iceovim; nigdje se ne ispisuju.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const HOME = os.homedir();
const CHROME_PROFILES = [
  path.join(HOME, '.var/app/com.google.Chrome/config/google-chrome/Default'),
  path.join(HOME, '.config/google-chrome/Default'),
];

function sqlite() { return require('node:sqlite').DatabaseSync; }

function withCopy(src, fn) {
  const DatabaseSync = sqlite();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-import-'));
  try {
    fs.copyFileSync(src, path.join(tmp, 'db'));
    const db = new DatabaseSync(path.join(tmp, 'db'), { readOnly: true });
    try { return fn(db); } finally { db.close(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

const meta = (db) => Object.fromEntries(db.prepare("SELECT key, value FROM meta WHERE key IN ('version','last_compatible_version')").all().map((r) => [r.key, Number(r.value)]));

// ---------- Ključevi (GNOME keyring) ----------
const KEY_PY = `
import sys, gi, secrets
gi.require_version('Secret', '1')
from gi.repository import Secret
app, create = sys.argv[1], sys.argv[2] == '1'
svc = Secret.Service.get_sync(Secret.ServiceFlags.NONE)
items = svc.search_sync(None, {'application': app}, Secret.SearchFlags.ALL | Secret.SearchFlags.UNLOCK | Secret.SearchFlags.LOAD_SECRETS, None)
if items:
    sys.stdout.write(items[0].get_secret().get_text()); sys.exit(0)
if not create: sys.exit(3)
schema = Secret.Schema.new('chrome_libsecret_os_crypt_password_v2', Secret.SchemaFlags.DONT_MATCH_NAME, {'application': Secret.SchemaAttributeType.STRING})
pw = secrets.token_urlsafe(16)
Secret.password_store_sync(schema, {'application': app}, Secret.COLLECTION_DEFAULT, 'Chromium Safe Storage', pw, None)
sys.stdout.write(pw)
`;
function keyringSecret(app, create = false) {
  const env = process.env[`ICE_TEST_KEY_${app.toUpperCase()}`]; // samo za testove
  if (env !== undefined) return env;
  const r = spawnSync('python3', ['-I', '-c', KEY_PY, app, create ? '1' : '0'], { encoding: 'utf8' });
  if (r.status === 3) return null;
  if (r.status !== 0) throw new Error('Ne mogu pročitati keyring (treba python3-gi i libsecret).');
  return r.stdout;
}
const derive = (secret) => crypto.pbkdf2Sync(secret, 'saltysalt', 1, 16, 'sha1');
const IV = Buffer.alloc(16, 0x20);

function decrypt(blob, keys) {
  if (!blob || !blob.length) return null;
  const buf = Buffer.from(blob);
  const key = keys[buf.subarray(0, 3).toString('latin1')];
  if (!key) return null;
  const d = crypto.createDecipheriv('aes-128-cbc', key, IV);
  const out = Buffer.concat([d.update(buf.subarray(3)), d.final()]);
  if (out.toString('utf8').includes('�')) throw new Error('neispravno dešifrovano');
  return out;
}
function encrypt(plain, key) {
  const c = crypto.createCipheriv('aes-128-cbc', key, IV);
  return Buffer.concat([Buffer.from('v11'), c.update(plain), c.final()]);
}

// ---------- Koraci ----------
function bookmarks(chrome, ice) {
  const roots = {};
  for (const file of ['AccountBookmarks', 'Bookmarks']) {
    const p = path.join(chrome, file);
    if (!fs.existsSync(p)) continue;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const [k, node] of Object.entries(data.roots || {})) {
      if (!node?.children) continue;
      if (!roots[k]) roots[k] = node;
      else roots[k].children.push(...node.children); // lokalni dodaju se na račun
    }
  }
  if (!roots.bookmark_bar) throw new Error('Chrome nema bookmarksa.');
  // Nova jedinstvena ID numeracija (račun i lokalni bookmarksi imaju preklapajuće ID-ove)
  let id = 0;
  let count = 0;
  const renum = (n) => { n.id = String(++id); delete n.guid; if (n.type === 'url') count++; (n.children || []).forEach(renum); };
  const out = { roots: {}, version: 1 };
  for (const k of ['bookmark_bar', 'other', 'synced']) {
    out.roots[k] = roots[k] || { children: [], name: k === 'other' ? 'Other bookmarks' : 'Mobile bookmarks', type: 'folder' };
    renum(out.roots[k]);
  }
  fs.writeFileSync(path.join(ice, 'Bookmarks'), JSON.stringify(out, null, 3));
  fs.rmSync(path.join(ice, 'Bookmarks.bak'), { force: true });
  return `${count}`;
}

function history(chrome, ice) {
  const DatabaseSync = sqlite();
  const src = path.join(chrome, 'History');
  const dst = path.join(ice, 'History');
  const cm = withCopy(src, meta);
  const im = withCopy(dst, meta);
  if (cm.last_compatible_version > im.version) throw new Error(`Chromeova historija (v${cm.version}) je novija nego što Ice podržava (v${im.version}).`);
  for (const ext of ['', '-journal', '-wal', '-shm']) fs.rmSync(dst + ext, { force: true });
  fs.copyFileSync(src, dst);
  const db = new DatabaseSync(dst, { readOnly: true });
  const n = db.prepare('SELECT count(*) AS n FROM urls').get().n;
  const d = db.prepare('SELECT count(*) AS n FROM downloads').get().n;
  db.close();
  return `${n} adresa, ${d} preuzimanja`;
}

function passwords(chrome, ice) {
  const DatabaseSync = sqlite();
  const chromeSecret = keyringSecret('chrome');
  if (chromeSecret === null) throw new Error('Chromeov ključ nije u keyringu.');
  const keys = { v10: derive('peanuts'), v11: derive(chromeSecret) };
  const iceKey = derive(keyringSecret('chromium', true));

  const dst = path.join(ice, 'Login Data');
  const out = new DatabaseSync(dst);
  const im = meta(out);
  const cols = out.prepare('PRAGMA table_info(logins)').all().map((c) => c.name).filter((c) => c !== 'id');
  let added = 0, failed = 0, never = 0, empty = 0;
  out.exec('BEGIN');
  try {
    for (const file of ['Login Data', 'Login Data For Account']) {
      const src = path.join(chrome, file);
      if (!fs.existsSync(src)) continue;
      withCopy(src, (db) => {
        const cm = meta(db);
        if (cm.last_compatible_version > im.version) throw new Error(`Chromeove lozinke (v${cm.version}) su novije nego što Ice podržava (v${im.version}).`);
        const have = new Set(db.prepare('PRAGMA table_info(logins)').all().map((c) => c.name));
        const use = cols.filter((c) => have.has(c));
        const ins = out.prepare(`INSERT OR REPLACE INTO logins (${use.join(',')}) VALUES (${use.map(() => '?').join(',')})`);
        const sel = db.prepare(`SELECT ${use.join(',')} FROM logins`);
        sel.setReadBigInts(true); // Chromeova vremena su veća od JS broja
        for (const r of sel.all()) {
          if (r.blacklisted_by_user) never++;
          else if (!r.password_value || !r.password_value.length) { empty++; continue; }
          else {
            try { r.password_value = encrypt(decrypt(r.password_value, keys), iceKey); } catch { failed++; continue; }
          }
          ins.run(...use.map((c) => r[c]));
          added++;
        }
      });
    }
    if (failed && !added) throw new Error('Nijedna lozinka se nije dala dešifrovati (pogrešan ključ?).');
    out.exec('COMMIT');
  } catch (e) {
    out.exec('ROLLBACK');
    throw e;
  } finally {
    out.close();
  }
  return `${added - never} lozinki, ${never} "nikad ne spremaj"${empty ? `, ${empty} bez lozinke (passkey i sl.)` : ''}${failed ? `, ${failed} NIJE uspjelo` : ''}`;
}

function preferences(chrome, ice) {
  const cp = JSON.parse(fs.readFileSync(path.join(chrome, 'Preferences'), 'utf8'));
  const file = path.join(ice, 'Preferences');
  const ip = JSON.parse(fs.readFileSync(file, 'utf8'));
  const types = ['geolocation', 'notifications', 'media_stream_camera', 'media_stream_mic', 'clipboard', 'midi_sysex', 'popups', 'sound', 'automatic_downloads'];
  const ex = cp.profile?.content_settings?.exceptions || {};
  ip.profile ||= {}; ip.profile.content_settings ||= {}; ip.profile.content_settings.exceptions ||= {};
  let n = 0;
  for (const t of types) {
    if (!ex[t]) continue;
    ip.profile.content_settings.exceptions[t] = { ...ex[t], ...(ip.profile.content_settings.exceptions[t] || {}) };
    n += Object.keys(ex[t]).length;
  }
  if (cp.partition?.per_host_zoom_levels) { ip.partition ||= {}; ip.partition.per_host_zoom_levels = cp.partition.per_host_zoom_levels; }
  if (cp.intl) ip.intl = { ...(ip.intl || {}), ...cp.intl };
  if (cp.default_search_provider_data) ip.default_search_provider_data = cp.default_search_provider_data;
  fs.writeFileSync(file, JSON.stringify(ip));
  return `${n} dozvola po stranicama, zoom, jezici, zadani pretraživač`;
}

// Prvo pokretanje Chromiuma u pozadini da napravi svoje baze (ako ih još nema)
function initProfile(chromeBin, userDataDir) {
  const ice = path.join(userDataDir, 'Default');
  if (['History', 'Login Data', 'Preferences'].every((f) => fs.existsSync(path.join(ice, f)))) return;
  spawnSync(chromeBin, [`--user-data-dir=${userDataDir}`, '--headless=new', '--no-first-run', '--disable-gpu', 'about:blank'], { timeout: 12000, stdio: 'ignore' });
}

async function importChrome({ chromeBin, userDataDir, passwords: withPasswords = true, log = console.log }) {
  const chrome = process.env.ICE_CHROME_PROFILE || CHROME_PROFILES.find((p) => fs.existsSync(p));
  if (!chrome) throw new Error('Chrome profil nije pronađen.');
  initProfile(chromeBin, userDataDir);
  const ice = path.join(userDataDir, 'Default');

  // Rezervna kopija svega što mijenjamo
  const backup = path.join(userDataDir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const f of ['Bookmarks', 'History', 'Login Data', 'Preferences']) if (fs.existsSync(path.join(ice, f))) fs.copyFileSync(path.join(ice, f), path.join(backup, f));

  const steps = [['bookmarks', bookmarks], ['historija', history], ['postavke', preferences]];
  if (withPasswords) steps.splice(2, 0, ['lozinke', passwords]);
  const report = {};
  for (const [name, fn] of steps) {
    try { report[name] = fn(chrome, ice); } catch (e) { report[name] = `GREŠKA: ${e.message}`; }
    log(`  ${name.padEnd(10)} ${report[name]}`);
  }
  if (!withPasswords) log('  lozinke    preskočeno');
  log('  autofill   nije prenesen: Chromeova baza (v160) je novija nego što Chromium 156 može otvoriti');
  log(`Rezervna kopija prijašnjeg Ice profila: ${backup}`);
  return report;
}

module.exports = { importChrome, encrypt, decrypt, derive, keyringSecret };
