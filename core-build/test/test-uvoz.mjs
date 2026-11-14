// Test uvoza (core-build/uvoz/ice-uvoz.py): lažni HOME s Chrome, Brave i Firefox profilom, pravi Chromium profil kao Ice.
// ICE_CHROME=putanja do chrome binarnog fajla (inače Iceov motor).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const ICE = new URL('../..', import.meta.url).pathname;
const T = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-import-test-'));
const HOME = path.join(T, 'home');
process.env.ICE_IMPORT_HOME = HOME;
process.env.ICE_TEST_KEY_CHROME = 'KLJUC-CHROME';
process.env.ICE_TEST_KEY_BRAVE = 'KLJUC-BRAVE';
process.env.ICE_TEST_KEY_CHROMIUM = 'KLJUC-ICE';
const CHROME = process.env.ICE_CHROME || '/opt/ice-browser/chrome';
const { DatabaseSync } = require('node:sqlite');
const { encrypt, decrypt, derive } = require(`${ICE}/src/import-chrome.js`);
const PY = `${ICE}/core-build/uvoz/ice-uvoz.py`;
const py = (args, profile) => spawnSync('python3', ['-I', PY, ...args], { encoding: 'utf8', env: { ...process.env, ICE_PROFILE: profile || path.join(T, 'ice') } });
const sources = () => JSON.parse(py(['--list-json']).stdout);
function importBrowser({ source, what, userDataDir }) {
  const r = py(['--import', source, '--json', ...(what ? ['--only', what.join(',')] : [])], userDataDir);
  const line = r.stdout.split('\n').find((l) => l.startsWith('JSON '));
  if (!line) throw new Error(`uvoz nije vratio rezultat: ${r.stdout} ${r.stderr}`);
  return JSON.parse(line.slice(5));
}

const results = [];
const check = (n, ok, info) => results.push(`${ok ? 'OK  ' : 'FAIL'} ${n}${info !== undefined ? `  (${info})` : ''}`);
const headless = (dir) => spawnSync(CHROME, [`--user-data-dir=${dir}`, '--headless=new', '--no-sandbox', '--no-first-run', '--disable-gpu', '--password-store=basic', 'about:blank'], { timeout: 15000, stdio: 'ignore' });

try {
  // Pravi Chromium profil: služi kao Ice profil i kao predložak za izvorne browsere
  const iceDir = path.join(T, 'ice');
  headless(iceDir);
  const ice = path.join(iceDir, 'Default');
  if (!fs.existsSync(path.join(ice, 'History'))) throw new Error('Chromium nije napravio profil.');

  function chromiumSource(rel, key, urls, logins) {
    const d = path.join(HOME, rel, 'Default');
    fs.mkdirSync(d, { recursive: true });
    for (const f of ['History', 'History-wal', 'Login Data']) if (fs.existsSync(path.join(ice, f))) fs.copyFileSync(path.join(ice, f), path.join(d, f)); // historija je u WAL režimu
    fs.writeFileSync(path.join(d, 'Preferences'), JSON.stringify({ profile: { content_settings: { exceptions: { notifications: { 'https://vijesti.ba:443,*': { setting: 1 } } } } }, partition: { per_host_zoom_levels: { x: { 'vijesti.ba': { zoom_level: 1.5 } } } } }));
    fs.writeFileSync(path.join(d, 'Bookmarks'), JSON.stringify({ version: 1, roots: {
      bookmark_bar: { type: 'folder', name: 'Bar', id: '1', children: urls.map((u, i) => ({ type: 'url', id: String(10 + i), name: `B ${u}`, url: u, date_added: '13300000000000000' })) },
      other: { type: 'folder', name: 'Other', id: '2', children: [{ type: 'folder', id: '5', name: 'Folder', children: [{ type: 'url', id: '6', name: 'Duboko', url: 'https://duboko.ba/' }] }] },
      synced: { type: 'folder', name: 'Mobile', id: '3', children: [] } } }));
    const h = new DatabaseSync(path.join(d, 'History'));
    urls.forEach((u, i) => {
      const id = h.prepare('INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden) VALUES (?, ?, 2, 0, 13300000000000000, 0)').run(u, `T ${i}`).lastInsertRowid;
      for (const t of [13300000000000000n, 13300000001000000n]) h.prepare('INSERT INTO visits (url, visit_time, from_visit, transition, segment_id, visit_duration) VALUES (?, ?, 0, 805306368, 0, 0)').run(id, t);
    });
    h.close();
    const l = new DatabaseSync(path.join(d, 'Login Data'));
    const req = l.prepare('PRAGMA table_info(logins)').all().filter((c) => c.notnull && c.dflt_value === null && c.name !== 'id').map((c) => c.name);
    for (const [origin, user, pass] of logins) {
      const row = Object.fromEntries(req.map((c) => [c, 0]));
      Object.assign(row, { origin_url: origin, action_url: '', signon_realm: origin, username_element: '', username_value: user, password_element: '', password_value: encrypt(Buffer.from(pass), derive(key)), date_created: 13300000000000000n });
      const k = Object.keys(row);
      l.prepare(`INSERT INTO logins (${k.join(',')}) VALUES (${k.map(() => '?').join(',')})`).run(...k.map((c) => row[c]));
    }
    l.close();
  }
  chromiumSource('.config/google-chrome', 'KLJUC-CHROME', ['https://jedan.ba/', 'https://dva.ba/'], [['https://jedan.ba/', 'ana', 'tajna-1'], ['https://dva.ba/', 'ana', 'tajna-2']]);
  chromiumSource('.config/BraveSoftware/Brave-Browser', 'KLJUC-BRAVE', ['https://dva.ba/', 'https://tri.ba/'], [['https://dva.ba/', 'ana', 'DRUGA'], ['https://tri.ba/', 'ana', 'tajna-3']]);

  // Firefox profil
  const ff = path.join(HOME, '.mozilla/firefox');
  fs.mkdirSync(path.join(ff, 'abc.default'), { recursive: true });
  fs.writeFileSync(path.join(ff, 'profiles.ini'), '[Install123]\nDefault=abc.default\n\n[Profile0]\nName=default\nIsRelative=1\nPath=abc.default\n');
  const p = new DatabaseSync(path.join(ff, 'abc.default/places.sqlite'));
  p.exec(`CREATE TABLE moz_places (id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, typed INTEGER, last_visit_date INTEGER, hidden INTEGER);
    CREATE TABLE moz_historyvisits (id INTEGER PRIMARY KEY, place_id INTEGER, visit_date INTEGER, visit_type INTEGER);
    CREATE TABLE moz_bookmarks (id INTEGER PRIMARY KEY, type INTEGER, fk INTEGER, parent INTEGER, position INTEGER, title TEXT, dateAdded INTEGER, guid TEXT);
    INSERT INTO moz_places VALUES (1, 'https://lisica.ba/', 'Lisica', 3, 1, 1700000000000000, 0), (2, 'place:sort=8', 'Najposjećenije', 0, 0, NULL, 0), (3, 'https://meni.ba/', 'Meni', 0, 0, NULL, 0);
    INSERT INTO moz_historyvisits VALUES (1, 1, 1700000000000000, 2), (2, 1, 1690000000000000, 1), (3, 1, 1680000000000000, 1);
    INSERT INTO moz_bookmarks VALUES (1, 2, NULL, 0, 0, '', 1, 'root________'), (2, 2, NULL, 1, 0, 'menu', 1, 'menu________'), (3, 2, NULL, 1, 1, 'toolbar', 1, 'toolbar_____'), (4, 2, NULL, 1, 2, 'unfiled', 1, 'unfiled_____'),
      (5, 1, 1, 3, 0, 'Lisica', 1700000000000000, 'aaaaaaaaaaaa'), (6, 1, 2, 3, 1, 'Pametni', 1, 'bbbbbbbbbbbb'), (7, 3, NULL, 3, 2, NULL, 1, 'cccccccccccc'),
      (8, 2, NULL, 2, 0, 'Folder FF', 1, 'dddddddddddd'), (9, 1, 3, 8, 0, 'Meni', 1, 'eeeeeeeeeeee');`);
  p.close();

  const list = sources();
  check('pronađeni Chrome, Brave i Firefox', list.length === 3 && ['chrome', 'brave', 'firefox'].every((b) => list.some((s) => s.browser === b)), list.map((s) => s.label).join(' | '));
  const by = (b) => list.find((s) => s.browser === b);

  // 1) Chrome u prazan Ice: sve
  const r1 = importBrowser({ source: by('chrome').id, chromeBin: CHROME, userDataDir: iceDir });
  check('Chrome: bez grešaka', !r1.failed, JSON.stringify(r1.report));
  let bm = JSON.parse(fs.readFileSync(path.join(ice, 'Bookmarks'), 'utf8'));
  check('Chrome: bookmarksi u istom rasporedu', bm.roots.bookmark_bar.children.length === 2 && bm.roots.other.children[0].children[0].url === 'https://duboko.ba/');
  const rows = (file, sql) => { const d = new DatabaseSync(path.join(ice, file), { readOnly: true }); try { return d.prepare(sql).all(); } finally { d.close(); } };
  check('Chrome: historija s posjetama', rows('History', 'SELECT count(*) n FROM urls')[0].n === 2 && rows('History', 'SELECT count(*) n FROM visits')[0].n === 4);
  const pw = () => Object.fromEntries(rows('Login Data', 'SELECT origin_url o, password_value p FROM logins').map((r) => [r.o, decrypt(r.p, { v11: derive('KLJUC-ICE') }).toString()]));
  check('Chrome: lozinke šifrirane Iceovim ključem', pw()['https://jedan.ba/'] === 'tajna-1' && pw()['https://dva.ba/'] === 'tajna-2');
  const prefs = JSON.parse(fs.readFileSync(path.join(ice, 'Preferences'), 'utf8'));
  check('Chrome: dozvole i zoom', !!prefs.profile.content_settings.exceptions.notifications['https://vijesti.ba:443,*'] && prefs.partition.per_host_zoom_levels.x['vijesti.ba'].zoom_level === 1.5);
  check('rezervna kopija', fs.existsSync(path.join(r1.backup, 'History')));

  // 2) Brave u Ice koji već ima podatke: dodaje se, ništa se ne gubi
  const r2 = importBrowser({ source: by('brave').id, chromeBin: CHROME, userDataDir: iceDir });
  bm = JSON.parse(fs.readFileSync(path.join(ice, 'Bookmarks'), 'utf8'));
  const folder = bm.roots.bookmark_bar.children.find((n) => n.name === 'Uvezeno iz Brave');
  check('Brave: bookmarksi u zasebnom folderu, stari ostaju', bm.roots.bookmark_bar.children.length === 3 && folder?.children.length === 3, JSON.stringify(r2.report));
  check('Brave: historija samo nove adrese', rows('History', 'SELECT count(*) n FROM urls')[0].n === 3 && rows('History', 'SELECT count(*) n FROM visits')[0].n === 6);
  check('Brave: nova lozinka dodana, postojeća ostaje Iceova', pw()['https://tri.ba/'] === 'tajna-3' && pw()['https://dva.ba/'] === 'tajna-2', r2.report.lozinke);
  importBrowser({ source: by('brave').id, what: ['bookmarks', 'history'], chromeBin: CHROME, userDataDir: iceDir });
  bm = JSON.parse(fs.readFileSync(path.join(ice, 'Bookmarks'), 'utf8'));
  check('ponovni uvoz ne pravi duplikate', bm.roots.bookmark_bar.children.length === 3 && rows('History', 'SELECT count(*) n FROM visits')[0].n === 6);

  // 3) Firefox: bookmarks i historija
  const r3 = importBrowser({ source: by('firefox').id, chromeBin: CHROME, userDataDir: iceDir });
  bm = JSON.parse(fs.readFileSync(path.join(ice, 'Bookmarks'), 'utf8'));
  const fx = bm.roots.bookmark_bar.children.find((n) => n.name === 'Uvezeno iz Firefox');
  const flat = (n) => (n.type === 'url' ? [n.url] : (n.children || []).flatMap(flat));
  check('Firefox: bookmarksi (bez "place:" i razdjelnika)', fx && flat(fx).sort().join() === 'https://lisica.ba/,https://meni.ba/', JSON.stringify(r3.report));
  const lis = rows('History', "SELECT CAST(u.last_visit_time AS TEXT) t, (SELECT count(*) FROM visits v WHERE v.url = u.id) n FROM urls u WHERE u.url = 'https://lisica.ba/'")[0];
  check('Firefox: historija s tačnim vremenom', lis?.n === 3 && String(lis.t) === '13344473600000000', `${lis?.n} posjeta`);
  check('Firefox: lozinke se ne nude', !by('firefox').can.includes('passwords') && !('lozinke' in r3.report));

  // 4) Chromium i dalje otvara profil, podaci ostaju
  const ids = new Set(); const dup = []; const walk = (n) => { if (ids.has(n.id)) dup.push(n.id); ids.add(n.id); (n.children || []).forEach(walk); };
  Object.values(bm.roots).forEach(walk);
  check('jedinstveni ID-ovi bookmarksa', !dup.length);
  headless(iceDir);
  bm = JSON.parse(fs.readFileSync(path.join(ice, 'Bookmarks'), 'utf8'));
  check('Chromium otvara profil poslije uvoza', bm.roots.bookmark_bar.children.length === 4 && rows('History', 'SELECT count(*) n FROM urls')[0].n === 4 && rows('History', 'PRAGMA integrity_check')[0].integrity_check === 'ok');
} catch (e) {
  results.push(`FAIL test se srušio: ${e.stack}`);
} finally {
  fs.rmSync(T, { recursive: true, force: true });
  console.log(results.join('\n'));
  process.exit(results.some((x) => x.startsWith('FAIL')) ? 1 : 0);
}
