// Uvoz iz drugog browsera u Ice: Chrome, Chromium, Brave, Edge, Vivaldi, Opera (svi profili) i Firefox.
// Podaci se DODAJU postojećim u Iceu (ništa se ne briše). Izvorni browser se samo čita (kopije baza).
// Ice mora biti zatvoren dok uvoz traje; iz Ice panela se zato uvoz zakazuje i radi pri ponovnom pokretanju.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { encrypt, decrypt, derive, keyringSecret } = require('./import-chrome');

const HOME = process.env.ICE_IMPORT_HOME || os.homedir(); // ICE_IMPORT_HOME: samo za testove
const CHROME_EPOCH = 11644473600000000n; // mikrosekunde između 1601. i 1970.

// keyring: pod kojim imenima browser čuva ključ za lozinke (probaju se redom)
const CHROMIUM_FAMILY = [
  { key: 'chrome', name: 'Google Chrome', keyring: ['chrome'], dirs: ['.config/google-chrome', '.var/app/com.google.Chrome/config/google-chrome'] },
  { key: 'chromium', name: 'Chromium', keyring: ['chromium'], dirs: ['.config/chromium', 'snap/chromium/common/chromium', '.var/app/org.chromium.Chromium/config/chromium'] },
  { key: 'brave', name: 'Brave', keyring: ['brave'], dirs: ['.config/BraveSoftware/Brave-Browser', '.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser', 'snap/brave/current/.config/BraveSoftware/Brave-Browser'] },
  { key: 'edge', name: 'Microsoft Edge', keyring: ['microsoft-edge', 'chromium'], dirs: ['.config/microsoft-edge', '.var/app/com.microsoft.Edge/config/microsoft-edge'] },
  { key: 'vivaldi', name: 'Vivaldi', keyring: ['vivaldi', 'chrome', 'chromium'], dirs: ['.config/vivaldi', '.var/app/com.vivaldi.Vivaldi/config/vivaldi'] },
  { key: 'opera', name: 'Opera', keyring: ['opera', 'chromium', 'chrome'], dirs: ['.config/opera', '.var/app/com.opera.Opera/config/opera'] },
];
const FIREFOX_DIRS = ['.mozilla/firefox', '.config/mozilla/firefox', 'snap/firefox/common/.mozilla/firefox', '.var/app/org.mozilla.firefox/.mozilla/firefox'];

const exists = (...p) => fs.existsSync(path.join(...p));
const readJson = (file, fallback) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; } };

// ---------- Pronalaženje browsera i profila ----------
function chromiumProfiles(root) {
  const isProfile = (d) => exists(d, 'Preferences') && (exists(d, 'Bookmarks') || exists(d, 'History') || exists(d, 'Login Data'));
  const names = readJson(path.join(root, 'Local State'), {})?.profile?.info_cache || {};
  const out = [];
  if (isProfile(root)) out.push({ dir: root, name: '' }); // stara Opera: profil je sam folder
  let entries = [];
  try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { /* nema foldera */ }
  for (const e of entries) {
    if (!e.isDirectory() || !/^(Default|Profile \d+)$/.test(e.name)) continue;
    const dir = path.join(root, e.name);
    if (isProfile(dir)) out.push({ dir, name: String(names[e.name]?.name || (e.name === 'Default' ? '' : e.name)) });
  }
  return out;
}

function firefoxProfiles(root) {
  let ini = '';
  try { ini = fs.readFileSync(path.join(root, 'profiles.ini'), 'utf8'); } catch { return []; }
  const out = [];
  for (const sec of ini.split(/^\[/m)) {
    if (!/^Profile/i.test(sec)) continue;
    const get = (k) => (sec.match(new RegExp(`^${k}=(.*)$`, 'm')) || [])[1]?.trim();
    const p = get('Path');
    if (!p) continue;
    const dir = get('IsRelative') === '0' ? p : path.join(root, p);
    if (exists(dir, 'places.sqlite')) out.push({ dir, name: get('Name') || '' });
  }
  return out;
}

function sources() {
  const out = [];
  const seen = new Set();
  const add = (kind, b, p, flavor) => {
    let real; try { real = fs.realpathSync(p.dir); } catch { return; }
    if (seen.has(real)) return; // isti profil dostupan preko dvije putanje
    seen.add(real);
    const label = [b.name, flavor && `(${flavor})`, p.name && p.name !== 'default' && `· ${p.name}`].filter(Boolean).join(' ');
    out.push({ id: p.dir, kind, browser: b.key, label, keyring: b.keyring || [], can: kind === 'firefox' ? ['bookmarks', 'history'] : ['bookmarks', 'history', 'passwords', 'settings'] });
  };
  const flavorOf = (d) => (d.startsWith('.var/app/') ? 'Flatpak' : d.startsWith('snap/') ? 'Snap' : '');
  for (const b of CHROMIUM_FAMILY) for (const d of b.dirs) for (const p of chromiumProfiles(path.join(HOME, d))) add('chromium', b, p, flavorOf(d));
  for (const d of FIREFOX_DIRS) for (const p of firefoxProfiles(path.join(HOME, d))) add('firefox', { key: 'firefox', name: 'Firefox' }, p, flavorOf(d));
  return out;
}

// ---------- Pomoćno: kopija baze (izvor se nikad ne otvara direktno) ----------
function sqlite() { return require('node:sqlite').DatabaseSync; }
function withDbCopy(src, fn) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-import-'));
  try {
    const copy = path.join(tmp, 'db');
    fs.copyFileSync(src, copy);
    if (fs.existsSync(`${src}-wal`)) fs.copyFileSync(`${src}-wal`, `${copy}-wal`); // Firefox: svježi podaci su u WAL-u
    return fn(copy);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
}

// ---------- Bookmarks ----------
// Zajednički oblik: { bar: [čvorovi], other: [čvorovi] }, čvor = { name, url, added } ili { name, children, added }
function readChromiumBookmarks(dir) {
  const out = { bar: [], other: [] };
  const conv = (n) => (n.type === 'url'
    ? (n.url ? { name: n.name || '', url: n.url, added: n.date_added } : null)
    : { name: n.name || '', added: n.date_added, children: (n.children || []).map(conv).filter(Boolean) });
  for (const file of ['AccountBookmarks', 'Bookmarks']) {
    const roots = readJson(path.join(dir, file), {})?.roots || {};
    out.bar.push(...(roots.bookmark_bar?.children || []).map(conv).filter(Boolean));
    out.other.push(...(roots.other?.children || []).map(conv).filter(Boolean));
    const mobile = (roots.synced?.children || []).map(conv).filter(Boolean);
    if (mobile.length) out.other.push({ name: 'Mobilni bookmarksi', children: mobile });
  }
  return out;
}

function readFirefoxBookmarks(dir) {
  const DatabaseSync = sqlite();
  return withDbCopy(path.join(dir, 'places.sqlite'), (copy) => {
    const db = new DatabaseSync(copy);
    try {
      const rows = db.prepare('SELECT b.id, b.type, b.parent, b.title, b.dateAdded AS added, b.guid, p.url FROM moz_bookmarks b LEFT JOIN moz_places p ON p.id = b.fk ORDER BY b.parent, b.position').all();
      const kids = new Map();
      for (const r of rows) { if (!kids.has(r.parent)) kids.set(r.parent, []); kids.get(r.parent).push(r); }
      const when = (r) => (r.added ? String(BigInt(r.added) + CHROME_EPOCH) : undefined);
      const conv = (r) => {
        if (r.type === 1) return r.url && !/^place:/i.test(r.url) ? { name: r.title || r.url, url: r.url, added: when(r) } : null;
        if (r.type === 2) return { name: r.title || '', added: when(r), children: (kids.get(r.id) || []).map(conv).filter(Boolean) };
        return null; // razdjelnik
      };
      const root = (guid) => { const r = rows.find((x) => x.guid === guid); return r ? (kids.get(r.id) || []).map(conv).filter(Boolean) : []; };
      const out = { bar: root('toolbar_____'), other: [...root('menu________'), ...root('unfiled_____')] };
      const mobile = root('mobile______');
      if (mobile.length) out.other.push({ name: 'Mobilni bookmarksi', children: mobile });
      return out;
    } finally { db.close(); }
  });
}

const countUrls = (nodes) => nodes.reduce((s, n) => s + (n.url ? 1 : countUrls(n.children || [])), 0);
const prune = (nodes) => nodes.filter((n) => n.url || (n.children = prune(n.children || [])).length); // bez praznih foldera

function importBookmarks(src, ice) {
  const tree = src.kind === 'firefox' ? readFirefoxBookmarks(src.id) : readChromiumBookmarks(src.id);
  tree.bar = prune(tree.bar); tree.other = prune(tree.other);
  const total = countUrls(tree.bar) + countUrls(tree.other);
  if (!total) return 'nema bookmarksa';

  const now = String(BigInt(Date.now()) * 1000n + CHROME_EPOCH);
  const toChromium = (n) => (n.url
    ? { type: 'url', name: n.name, url: n.url, date_added: n.added || now }
    : { type: 'folder', name: n.name, date_added: n.added || now, date_modified: '0', children: n.children.map(toChromium) });
  const file = path.join(ice, 'Bookmarks');
  const data = readJson(file, { roots: {}, version: 1 });
  data.roots ||= {};
  const rootNames = { bookmark_bar: 'Bookmarks bar', other: 'Other bookmarks', synced: 'Mobile bookmarks' };
  for (const [k, name] of Object.entries(rootNames)) {
    data.roots[k] ||= { children: [], name, type: 'folder', date_added: now, date_modified: '0' };
    data.roots[k].children ||= [];
  }
  const iceCount = (n) => (n.type === 'url' ? 1 : (n.children || []).reduce((s, c) => s + iceCount(c), 0));
  const empty = !Object.keys(rootNames).some((k) => iceCount(data.roots[k]));
  let where;
  if (empty) {
    // Ice još nema bookmarksa: isti raspored kao u izvornom browseru
    data.roots.bookmark_bar.children = tree.bar.map(toChromium);
    data.roots.other.children = tree.other.map(toChromium);
    where = 'raspored kao u izvoru';
  } else {
    // Ice već ima bookmarkse: uvezeni idu u zaseban folder na traci (ponovni uvoz ga zamjenjuje)
    const name = `Uvezeno iz ${src.label}`;
    const kids = tree.bar.map(toChromium);
    if (tree.other.length) kids.push({ type: 'folder', name: 'Ostali bookmarksi', date_added: now, date_modified: '0', children: tree.other.map(toChromium) });
    const bar = data.roots.bookmark_bar.children;
    const old = bar.findIndex((n) => n.type === 'folder' && n.name === name);
    const folder = { type: 'folder', name, date_added: now, date_modified: now, children: kids };
    if (old >= 0) bar[old] = folder; else bar.push(folder);
    where = `folder "${name}" na traci`;
  }
  let id = 0;
  const renum = (n) => { n.id = String(++id); (n.children || []).forEach(renum); };
  for (const k of Object.keys(rootNames)) renum(data.roots[k]);
  delete data.checksum;
  fs.writeFileSync(file, JSON.stringify(data, null, 3));
  fs.rmSync(path.join(ice, 'Bookmarks.bak'), { force: true });
  return `${total} bookmarksa (${where})`;
}

// ---------- Historija ----------
// Dodaju se samo adrese koje Ice još nema, zajedno s njihovim posjetama; postojeće ostaju netaknute.
function importHistory(src, ice) {
  const DatabaseSync = sqlite();
  const srcFile = path.join(src.id, src.kind === 'firefox' ? 'places.sqlite' : 'History');
  if (!fs.existsSync(srcFile)) return 'nema historije';
  return withDbCopy(srcFile, (copy) => {
    const db = new DatabaseSync(path.join(ice, 'History'));
    try {
      db.prepare('ATTACH DATABASE ? AS src').run(copy);
      const maxId = db.prepare('SELECT COALESCE(MAX(id), 0) AS m FROM urls').get().m;
      db.exec('BEGIN');
      try {
        let visits;
        if (src.kind === 'firefox') {
          const E = String(CHROME_EPOCH);
          db.exec(`INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden)
            SELECT p.url, COALESCE(p.title, ''), p.visit_count, COALESCE(p.typed, 0), p.last_visit_date + ${E}, 0
            FROM src.moz_places p
            WHERE p.last_visit_date IS NOT NULL AND p.visit_count > 0 AND (p.url LIKE 'http://%' OR p.url LIKE 'https://%')
              AND NOT EXISTS (SELECT 1 FROM main.urls m WHERE m.url = p.url)`);
          // 805306368 = početak i kraj lanca (posjeta se vidi u historiji); 1 = ukucana adresa
          visits = db.prepare(`INSERT INTO visits (url, visit_time, from_visit, transition, segment_id, visit_duration)
            SELECT m.id, v.visit_date + ${E}, 0, 805306368 + (CASE WHEN v.visit_type = 2 THEN 1 ELSE 0 END), 0, 0
            FROM src.moz_historyvisits v JOIN src.moz_places p ON p.id = v.place_id JOIN main.urls m ON m.url = p.url
            WHERE m.id > ?`).run(maxId);
        } else {
          db.exec(`INSERT INTO urls (url, title, visit_count, typed_count, last_visit_time, hidden)
            SELECT s.url, s.title, s.visit_count, s.typed_count, s.last_visit_time, s.hidden
            FROM src.urls s WHERE NOT EXISTS (SELECT 1 FROM main.urls m WHERE m.url = s.url)`);
          visits = db.prepare(`INSERT INTO visits (url, visit_time, from_visit, transition, segment_id, visit_duration)
            SELECT m.id, v.visit_time, 0, v.transition, 0, v.visit_duration
            FROM src.visits v JOIN src.urls s ON s.id = v.url JOIN main.urls m ON m.url = s.url
            WHERE m.id > ?`).run(maxId);
        }
        const added = db.prepare('SELECT count(*) AS n FROM urls WHERE id > ?').get(maxId).n;
        db.exec('COMMIT');
        return `${added} novih adresa, ${visits.changes} posjeta`;
      } catch (e) { db.exec('ROLLBACK'); throw e; }
    } finally { db.close(); }
  });
}

// ---------- Lozinke (Chromium porodica) ----------
// Dešifruju se ključem izvornog browsera iz keyringa i ponovo šifruju Iceovim; nigdje se ne ispisuju.
// Lozinke koje Ice već ima za istu stranicu i korisnika ostaju Iceove.
function importPasswords(src, ice) {
  if (src.kind !== 'chromium') return 'nije podržano za ovaj browser (izvezi lozinke u CSV pa ih uvezi u chrome://password-manager/settings)';
  const DatabaseSync = sqlite();
  const files = ['Login Data', 'Login Data For Account'].map((f) => path.join(src.id, f)).filter((f) => fs.existsSync(f));
  if (!files.length) return 'nema lozinki';
  const candidates = [];
  for (const app of src.keyring) { const s = keyringSecret(app); if (s !== null && s !== undefined) candidates.push({ v10: derive('peanuts'), v11: derive(s) }); }
  if (!candidates.length) candidates.push({ v10: derive('peanuts') }); // bez keyringa browser koristi samo v10
  const iceKey = derive(keyringSecret('chromium', true));
  const reencrypt = (blob) => {
    for (const keys of candidates) { try { const p = decrypt(blob, keys); if (p) return encrypt(p, iceKey); } catch { /* sljedeći ključ */ } }
    throw new Error('ključ ne odgovara');
  };

  const out = new DatabaseSync(path.join(ice, 'Login Data'));
  let added = 0, failed = 0, never = 0, empty = 0, kept = 0;
  try {
    const info = out.prepare('PRAGMA table_info(logins)').all().filter((c) => c.name !== 'id');
    out.exec('BEGIN');
    try {
      for (const file of files) {
        withDbCopy(file, (copy) => {
          const db = new DatabaseSync(copy, { readOnly: true });
          try {
            const have = new Set(db.prepare('PRAGMA table_info(logins)').all().map((c) => c.name));
            const use = info.filter((c) => have.has(c.name)).map((c) => c.name);
            // Obavezne kolone koje izvor (starija verzija) nema dobijaju praznu vrijednost
            const fill = info.filter((c) => !have.has(c.name) && c.notnull && c.dflt_value === null);
            const blank = (c) => (/INT|BOOL/i.test(c.type) ? 0 : /BLOB/i.test(c.type) ? Buffer.alloc(0) : '');
            const cols = [...use, ...fill.map((c) => c.name)];
            const ins = out.prepare(`INSERT OR IGNORE INTO logins (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`);
            const sel = db.prepare(`SELECT ${use.join(',')} FROM logins`);
            sel.setReadBigInts(true); // vremena su veća od JS broja
            for (const r of sel.all()) {
              const isNever = !!r.blacklisted_by_user;
              if (!isNever) {
                if (!r.password_value || !r.password_value.length) { empty++; continue; }
                try { r.password_value = reencrypt(r.password_value); } catch { failed++; continue; }
              }
              const res = ins.run(...use.map((c) => r[c]), ...fill.map(blank));
              if (!res.changes) kept++;
              else if (isNever) never++;
              else added++;
            }
          } finally { db.close(); }
        });
      }
      if (failed && !added) throw new Error('nijedna lozinka se nije dala dešifrovati (ključ browsera nije u keyringu?)');
      out.exec('COMMIT');
    } catch (e) { out.exec('ROLLBACK'); throw e; }
  } finally { out.close(); }
  return [`${added} lozinki`, never && `${never} "nikad ne spremaj"`, kept && `${kept} već postoji u Iceu`, empty && `${empty} bez lozinke (passkey i sl.)`, failed && `${failed} NIJE uspjelo`].filter(Boolean).join(', ');
}

// ---------- Postavke stranica (Chromium porodica): dozvole i zoom; Iceove postojeće imaju prednost ----------
function importSettings(src, ice) {
  if (src.kind !== 'chromium') return 'nije podržano za ovaj browser';
  const cp = readJson(path.join(src.id, 'Preferences'), null);
  if (!cp) return 'nema postavki';
  const file = path.join(ice, 'Preferences');
  const ip = readJson(file, {});
  const types = ['geolocation', 'notifications', 'media_stream_camera', 'media_stream_mic', 'clipboard', 'midi_sysex', 'popups', 'sound', 'automatic_downloads'];
  const ex = cp.profile?.content_settings?.exceptions || {};
  ip.profile ||= {}; ip.profile.content_settings ||= {}; ip.profile.content_settings.exceptions ||= {};
  const mine = ip.profile.content_settings.exceptions;
  let n = 0;
  for (const t of types) {
    if (!ex[t] || typeof ex[t] !== 'object') continue;
    n += Object.keys(ex[t]).filter((k) => !(mine[t] && k in mine[t])).length;
    mine[t] = { ...ex[t], ...(mine[t] || {}) };
  }
  const zoom = cp.partition?.per_host_zoom_levels;
  if (zoom && typeof zoom === 'object') {
    ip.partition ||= {}; ip.partition.per_host_zoom_levels ||= {};
    for (const [part, hosts] of Object.entries(zoom)) ip.partition.per_host_zoom_levels[part] = { ...hosts, ...(ip.partition.per_host_zoom_levels[part] || {}) };
  }
  fs.writeFileSync(file, JSON.stringify(ip));
  return `${n} dozvola po stranicama, zoom`;
}

const STEPS = { bookmarks: ['bookmarks', importBookmarks], history: ['historija', importHistory], passwords: ['lozinke', importPasswords], settings: ['postavke', importSettings] };

// Prvo pokretanje Chromiuma u pozadini da napravi svoje baze (ako ih još nema)
function initProfile(chromeBin, userDataDir) {
  const ice = path.join(userDataDir, 'Default');
  if (['History', 'Login Data', 'Preferences'].every((f) => fs.existsSync(path.join(ice, f)))) return;
  require('child_process').spawnSync(chromeBin, [`--user-data-dir=${userDataDir}`, '--headless=new', '--no-first-run', '--disable-gpu', 'about:blank'], { timeout: 12000, stdio: 'ignore' });
}

// source: id iz sources(); what: podskup od bookmarks, history, passwords, settings (prazno = sve što izvor nudi)
function importBrowser({ source, what, chromeBin, userDataDir, log = () => {} }) {
  const src = sources().find((s) => s.id === source);
  if (!src) throw new Error('Izvorni browser nije pronađen.');
  const todo = Object.keys(STEPS).filter((k) => src.can.includes(k) && (!what || !what.length || what.includes(k)));
  if (!todo.length) throw new Error('Ništa nije odabrano za uvoz.');
  initProfile(chromeBin, userDataDir);
  const ice = path.join(userDataDir, 'Default');
  fs.mkdirSync(ice, { recursive: true });

  // Rezervna kopija svega što se mijenja
  const backup = path.join(userDataDir, `backup-${new Date().toISOString().replace(/[:.]/g, '-')}`);
  fs.mkdirSync(backup, { recursive: true });
  for (const f of ['Bookmarks', 'History', 'Login Data', 'Preferences']) if (fs.existsSync(path.join(ice, f))) fs.copyFileSync(path.join(ice, f), path.join(backup, f));

  const report = {};
  for (const k of todo) {
    const [name, fn] = STEPS[k];
    try { report[name] = fn(src, ice); } catch (e) { report[name] = `GREŠKA: ${e.message}`; }
    log(`  ${name.padEnd(10)} ${report[name]}`);
  }
  return { label: src.label, report, backup, failed: Object.values(report).some((v) => v.startsWith('GREŠKA')) };
}

module.exports = { sources, importBrowser };
