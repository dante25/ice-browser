// Test synca: dva lažna Ice profila (dva "uređaja") i lokalni folder umjesto Google Drivea.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ICE = new URL('..', import.meta.url).pathname;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-sync-test-'));
process.env.ICE_SYNC_REMOTE = path.join(T, 'drive');
process.env.ICE_TEST_SYNC_PASS = 'test-sync-lozinka-123';
fs.mkdirSync(process.env.ICE_SYNC_REMOTE);

const sync = require(`${ICE}/src/sync.js`);
const { encrypt, decrypt, derive } = require(`${ICE}/src/import-chrome.js`);
const { DatabaseSync } = require('node:sqlite');
const REF = `${os.homedir()}/.cache/ice-test-profile/Default`; // pravi Chromium profil iz npm test

const results = [];
const check = (n, ok, info) => results.push(`${ok ? 'OK  ' : 'FAIL'} ${n}${info !== undefined ? `  (${info})` : ''}`);

function device(name) {
  const d = path.join(T, name);
  fs.mkdirSync(path.join(d, 'Default'), { recursive: true });
  fs.copyFileSync(`${REF}/Login Data`, path.join(d, 'Default/Login Data'));
  fs.writeFileSync(path.join(d, 'Default/Preferences'), JSON.stringify({ intl: { accept_languages: name === 'laptop' ? 'bs,en' : 'en' } }));
  return d;
}

try {
  // Šifrovanje
  const sealed = sync.seal({ tajna: 'abc', updated: 'x', device: 'y' }, 'lozinka-1234567');
  check('paket je šifriran', !sealed.includes('tajna') && !sealed.includes('abc'));
  check('ispravna lozinka otvara paket', sync.open(sealed, 'lozinka-1234567').tajna === 'abc');
  let rejected = false;
  try { sync.open(sealed, 'pogresna-lozinka'); } catch { rejected = true; }
  check('pogrešna lozinka ne otvara paket', rejected);

  // Uređaj 1 (laptop): bookmarks + lozinka, šalje
  const laptop = device('laptop');
  fs.writeFileSync(path.join(laptop, 'Default/Bookmarks'), JSON.stringify({ roots: { bookmark_bar: { type: 'folder', name: 'Traka', id: '1', children: [{ type: 'url', name: 'Primjer', url: 'https://primjer.ba/', id: '2' }] }, other: { type: 'folder', name: 'Ostalo', id: '3', children: [] } }, version: 1 }));
  const db = new DatabaseSync(path.join(laptop, 'Default/Login Data'));
  const req = db.prepare('PRAGMA table_info(logins)').all().filter((c) => c.notnull && c.dflt_value === null && c.name !== 'id').map((c) => c.name);
  const row = Object.fromEntries(req.map((c) => [c, 0]));
  Object.assign(row, { origin_url: 'https://primjer.ba/', action_url: '', signon_realm: 'https://primjer.ba/', username_element: '', username_value: 'ana', password_element: '', password_value: encrypt(Buffer.from('tajna-šifra-1'), derive('KLJUC-LAPTOP')) });
  const k = Object.keys(row);
  db.prepare(`INSERT INTO logins (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((c) => row[c]));
  db.close();
  const pushed = sync.push({ configDir: laptop, profileDir: laptop, chromiumSecret: 'KLJUC-LAPTOP' });
  check('laptop šalje paket', pushed.passwords === 1, `${pushed.passwords} lozinka`);
  const onDrive = fs.readFileSync(path.join(process.env.ICE_SYNC_REMOTE, 'profil.icesync'));
  check('na "Driveu" nema čitljivih podataka', !onDrive.includes('tajna') && !onDrive.includes('primjer.ba') && !onDrive.includes('ana'));

  // Uređaj 2 (drugi računar, drugi ključ): preuzima
  const pc = device('pc');
  const pulled = sync.pull({ configDir: pc, profileDir: pc, chromiumSecret: 'KLJUC-PC' });
  check('drugi uređaj preuzima paket', pulled.status === 'preuzeto' && pulled.from === os.hostname(), pulled.status);
  const b = JSON.parse(fs.readFileSync(path.join(pc, 'Default/Bookmarks'), 'utf8'));
  check('bookmarks preneseni', b.roots.bookmark_bar.children[0].url === 'https://primjer.ba/');
  const db2 = new DatabaseSync(path.join(pc, 'Default/Login Data'), { readOnly: true });
  const r = db2.prepare('SELECT username_value u, password_value p FROM logins').get();
  db2.close();
  check('lozinka prenesena i šifrirana ključem drugog uređaja', r && r.u === 'ana' && decrypt(r.p, { v11: derive('KLJUC-PC') }).toString() === 'tajna-šifra-1');
  check('postavke prenesene', JSON.parse(fs.readFileSync(path.join(pc, 'Default/Preferences'), 'utf8')).intl.accept_languages === 'bs,en');
  check('rezervna kopija prije preuzimanja', fs.existsSync(path.join(pulled.backup, 'Login Data')));
  const again = sync.pull({ configDir: pc, profileDir: pc, chromiumSecret: 'KLJUC-PC' });
  check('ne preuzima isti paket dvaput', again.status === 'ažurno', again.status);
} catch (e) {
  results.push(`FAIL test se srušio: ${e.stack}`);
} finally {
  fs.rmSync(T, { recursive: true, force: true });
  console.log(results.join('\n'));
  process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
}
