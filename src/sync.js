// Ice sync preko Google Drivea (rclone, dozvola samo za Iceove fajlove).
// Paket profila (bookmarks, lozinke, postavke) se šifruje TVOJOM sync lozinkom (AES-256-GCM, scrypt)
// prije slanja: Google vidi samo šifrirani fajl. Sync lozinka se čuva u GNOME keyringu.
//
// Pravilo: zadnja izmjena pobjeđuje. Ice šalje paket pri zatvaranju, a pri pokretanju preuzme
// noviji paket s drugog uređaja (prije toga pravi rezervnu kopiju).
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');
const { spawnSync } = require('child_process');
const { decrypt, encrypt, derive } = require('./import-chrome');

const REMOTE = process.env.ICE_SYNC_REMOTE || 'ice-drive:Ice Sync';
const FILE = 'profil.icesync';
const RCLONE = process.env.ICE_RCLONE || path.join(os.homedir(), '.local/bin/rclone');
const FORMAT = 'ice-sync-1';

// ---------- Sync lozinka (keyring) ----------
const KEYRING_PY = `
import sys, gi
gi.require_version('Secret', '1')
from gi.repository import Secret
schema = Secret.Schema.new('ice.sync', Secret.SchemaFlags.NONE, {'application': Secret.SchemaAttributeType.STRING})
if sys.argv[1] == 'get':
    v = Secret.password_lookup_sync(schema, {'application': 'ice-sync'}, None)
    if v is None: sys.exit(3)
    sys.stdout.write(v)
else:
    Secret.password_store_sync(schema, {'application': 'ice-sync'}, Secret.COLLECTION_DEFAULT, 'Ice sync lozinka', sys.stdin.read(), None)
`;
function getPassphrase() {
  if (process.env.ICE_TEST_SYNC_PASS !== undefined) return process.env.ICE_TEST_SYNC_PASS;
  const r = spawnSync('python3', ['-I', '-c', KEYRING_PY, 'get'], { encoding: 'utf8' });
  return r.status === 0 ? r.stdout : null;
}
function setPassphrase(p) {
  const r = spawnSync('python3', ['-I', '-c', KEYRING_PY, 'set'], { input: p, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Ne mogu spremiti sync lozinku u keyring.');
}

// ---------- Šifrovanje paketa ----------
function seal(obj, passphrase) {
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(passphrase, salt, 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const c = crypto.createCipheriv('aes-256-gcm', key, iv);
  const body = Buffer.concat([c.update(zlib.gzipSync(JSON.stringify(obj))), c.final()]);
  const header = Buffer.from(JSON.stringify({ format: FORMAT, kdf: 'scrypt-N32768-r8-p1', salt: salt.toString('base64'), iv: iv.toString('base64'), tag: c.getAuthTag().toString('base64'), updated: obj.updated, device: obj.device }));
  const len = Buffer.alloc(4);
  len.writeUInt32BE(header.length);
  return Buffer.concat([Buffer.from('ICESYNC1'), len, header, body]);
}
function readHeader(buf) {
  if (buf.subarray(0, 8).toString() !== 'ICESYNC1') throw new Error('Nije Ice sync fajl.');
  const n = buf.readUInt32BE(8);
  return { header: JSON.parse(buf.subarray(12, 12 + n).toString()), body: buf.subarray(12 + n) };
}
function open(buf, passphrase) {
  const { header, body } = readHeader(buf);
  const key = crypto.scryptSync(passphrase, Buffer.from(header.salt, 'base64'), 32, { N: 1 << 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
  const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(header.iv, 'base64'));
  d.setAuthTag(Buffer.from(header.tag, 'base64'));
  try {
    return JSON.parse(zlib.gunzipSync(Buffer.concat([d.update(body), d.final()])));
  } catch {
    throw new Error('Pogrešna sync lozinka (ili oštećen fajl).');
  }
}

// ---------- Profil <-> paket ----------
const sqlite = () => require('node:sqlite').DatabaseSync;
function withCopy(src, fn) {
  const DatabaseSync = sqlite();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-sync-'));
  try {
    fs.copyFileSync(src, path.join(tmp, 'db'));
    const db = new DatabaseSync(path.join(tmp, 'db'), { readOnly: true });
    try { return fn(db); } finally { db.close(); }
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}
const iceKeys = (chromiumSecret) => ({ v10: derive('peanuts'), v11: derive(chromiumSecret) });

function exportProfile(profileDir, chromiumSecret) {
  const p = path.join(profileDir, 'Default');
  const bundle = { format: FORMAT, updated: new Date().toISOString(), device: os.hostname() };
  if (fs.existsSync(path.join(p, 'Bookmarks'))) bundle.bookmarks = JSON.parse(fs.readFileSync(path.join(p, 'Bookmarks'), 'utf8')).roots;
  if (fs.existsSync(path.join(p, 'Login Data'))) {
    const keys = iceKeys(chromiumSecret);
    bundle.passwords = withCopy(path.join(p, 'Login Data'), (db) =>
      db.prepare('SELECT origin_url, action_url, signon_realm, username_element, username_value, password_element, password_value, blacklisted_by_user FROM logins').all()
        .map((r) => {
          let password = null;
          try { password = r.password_value?.length ? decrypt(r.password_value, keys).toString('utf8') : null; } catch { /* preskoči */ }
          return { url: r.origin_url, action: r.action_url, realm: r.signon_realm, userField: r.username_element, user: r.username_value, passField: r.password_element, password, never: !!r.blacklisted_by_user };
        })
        .filter((x) => x.never || x.password !== null));
  }
  const prefs = JSON.parse(fs.readFileSync(path.join(p, 'Preferences'), 'utf8'));
  bundle.settings = {
    contentSettings: prefs.profile?.content_settings?.exceptions || {},
    zoom: prefs.partition?.per_host_zoom_levels || {},
    intl: prefs.intl || {},
    search: prefs.default_search_provider_data || null,
  };
  return bundle;
}

function importProfile(profileDir, bundle, chromiumSecret) {
  const p = path.join(profileDir, 'Default');
  fs.mkdirSync(p, { recursive: true });
  const backup = path.join(profileDir, `backup-sync-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const f of ['Bookmarks', 'Login Data', 'Preferences']) if (fs.existsSync(path.join(p, f))) fs.copyFileSync(path.join(p, f), path.join(backup, f));

  const out = {};
  if (bundle.bookmarks) {
    fs.writeFileSync(path.join(p, 'Bookmarks'), JSON.stringify({ roots: bundle.bookmarks, version: 1 }, null, 3));
    fs.rmSync(path.join(p, 'Bookmarks.bak'), { force: true });
    let n = 0; const walk = (x) => { if (x.type === 'url') n++; (x.children || []).forEach(walk); };
    Object.values(bundle.bookmarks).forEach(walk);
    out.bookmarks = n;
  }
  if (bundle.passwords && fs.existsSync(path.join(p, 'Login Data'))) {
    const DatabaseSync = sqlite();
    const key = derive(chromiumSecret);
    const db = new DatabaseSync(path.join(p, 'Login Data'));
    const cols = new Set(db.prepare('PRAGMA table_info(logins)').all().map((c) => c.name));
    const required = db.prepare('PRAGMA table_info(logins)').all().filter((c) => c.notnull && c.dflt_value === null && c.name !== 'id').map((c) => c.name);
    db.exec('BEGIN');
    db.exec('DELETE FROM logins');
    for (const x of bundle.passwords) {
      const row = Object.fromEntries(required.map((c) => [c, 0]));
      Object.assign(row, {
        origin_url: x.url, action_url: x.action || '', signon_realm: x.realm, username_element: x.userField || '',
        username_value: x.user || '', password_element: x.passField || '', blacklisted_by_user: x.never ? 1 : 0,
        password_value: x.password ? encrypt(Buffer.from(x.password, 'utf8'), key) : Buffer.alloc(0),
      });
      if (cols.has('date_created')) row.date_created = (BigInt(Date.now()) + 11644473600000n) * 1000n;
      const k = Object.keys(row).filter((c) => cols.has(c));
      db.prepare(`INSERT OR REPLACE INTO logins (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((c) => row[c]));
    }
    db.exec('COMMIT');
    db.close();
    out.passwords = bundle.passwords.filter((x) => !x.never).length;
  }
  if (bundle.settings && fs.existsSync(path.join(p, 'Preferences'))) {
    const prefs = JSON.parse(fs.readFileSync(path.join(p, 'Preferences'), 'utf8'));
    prefs.profile ||= {}; prefs.profile.content_settings ||= {};
    prefs.profile.content_settings.exceptions = { ...(prefs.profile.content_settings.exceptions || {}), ...bundle.settings.contentSettings };
    prefs.partition = { ...(prefs.partition || {}), per_host_zoom_levels: bundle.settings.zoom };
    prefs.intl = bundle.settings.intl;
    if (bundle.settings.search) prefs.default_search_provider_data = bundle.settings.search;
    fs.writeFileSync(path.join(p, 'Preferences'), JSON.stringify(prefs));
    out.settings = true;
  }
  out.backup = backup;
  return out;
}

// ---------- Drive (rclone) ----------
function rclone(...args) {
  const r = spawnSync(RCLONE, args, { encoding: 'buffer', timeout: 120000 });
  if (r.error) throw new Error(`rclone nije pronađen (${RCLONE}).`);
  return r;
}
function remoteReady() {
  if (process.env.ICE_SYNC_REMOTE) return true;
  const r = rclone('listremotes');
  return r.status === 0 && r.stdout.toString().split('\n').includes('ice-drive:');
}
function download() {
  const tmp = path.join(os.tmpdir(), `ice-sync-${process.pid}`);
  const r = rclone('copyto', `${REMOTE}/${FILE}`, tmp);
  if (r.status !== 0 || !fs.existsSync(tmp)) return null;
  const buf = fs.readFileSync(tmp);
  fs.rmSync(tmp, { force: true });
  return buf;
}
function upload(buf) {
  const tmp = path.join(os.tmpdir(), `ice-sync-up-${process.pid}`);
  fs.writeFileSync(tmp, buf, { mode: 0o600 });
  const r = rclone('copyto', tmp, `${REMOTE}/${FILE}`);
  fs.rmSync(tmp, { force: true });
  if (r.status !== 0) throw new Error(`Slanje na Drive nije uspjelo: ${r.stderr.toString().slice(-300)}`);
}

// ---------- Stanje ----------
const stateFile = (configDir) => path.join(configDir, 'sync.json');
const readState = (configDir) => { try { return JSON.parse(fs.readFileSync(stateFile(configDir), 'utf8')); } catch { return {}; } };
const writeState = (configDir, s) => fs.writeFileSync(stateFile(configDir), JSON.stringify(s, null, 1));

function push({ configDir, profileDir, chromiumSecret }) {
  const pass = getPassphrase();
  if (!pass) throw new Error('Sync nije podešen. Pokreni: ice --sync-setup');
  const bundle = exportProfile(profileDir, chromiumSecret);
  upload(seal(bundle, pass));
  writeState(configDir, { ...readState(configDir), lastPush: bundle.updated, lastSeen: bundle.updated });
  return { updated: bundle.updated, passwords: bundle.passwords?.filter((x) => !x.never).length || 0 };
}

function pull({ configDir, profileDir, chromiumSecret, force = false }) {
  const pass = getPassphrase();
  if (!pass) throw new Error('Sync nije podešen. Pokreni: ice --sync-setup');
  const buf = download();
  if (!buf) return { status: 'nema-paketa' };
  const { header } = readHeader(buf);
  const st = readState(configDir);
  if (!force && st.lastSeen && header.updated <= st.lastSeen) return { status: 'ažurno', updated: header.updated };
  const bundle = open(buf, pass);
  const r = importProfile(profileDir, bundle, chromiumSecret);
  writeState(configDir, { ...st, lastPull: new Date().toISOString(), lastSeen: header.updated });
  return { status: 'preuzeto', from: header.device, updated: header.updated, ...r };
}

function status({ configDir }) {
  const st = readState(configDir);
  let remote = null;
  try { const b = download(); if (b) remote = readHeader(b).header; } catch { /* nema */ }
  return { configured: !!getPassphrase(), driveConnected: remoteReady(), ...st, remote: remote && { updated: remote.updated, device: remote.device } };
}

module.exports = { push, pull, status, setPassphrase, getPassphrase, remoteReady, seal, open, readHeader, exportProfile, importProfile };
