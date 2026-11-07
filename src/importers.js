// Uvoz podataka iz Google Chromea u Ice.
// Ništa se ne šalje na mrežu. Chrome fajlovi se samo čitaju, nikad ne mijenjaju.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CHROME_PROFILES = [
  path.join(os.homedir(), '.var/app/com.google.Chrome/config/google-chrome/Default'), // Flatpak
  path.join(os.homedir(), '.config/google-chrome/Default'), // .deb
];

function findChromeProfile() {
  return CHROME_PROFILES.find((p) => fs.existsSync(p));
}

// Pretvara Chromeov čvor u čisti Ice čvor (bez sync metapodataka i ID-ova).
function cleanNode(n) {
  if (n.type === 'url') {
    return { type: 'url', name: n.name, url: n.url, added: n.date_added };
  }
  return {
    type: 'folder',
    name: n.name,
    added: n.date_added,
    children: (n.children || []).map(cleanNode),
  };
}

function countUrls(n) {
  if (n.type === 'url') return 1;
  return (n.children || []).reduce((s, c) => s + countUrls(c), 0);
}

// Bookmarks s Google računa (AccountBookmarks) i lokalni (Bookmarks).
function importBookmarks(userDataDir, profile = findChromeProfile()) {
  if (!profile) throw new Error('Chrome profil nije pronađen.');

  const roots = {};
  for (const file of ['AccountBookmarks', 'Bookmarks']) {
    const p = path.join(profile, file);
    if (!fs.existsSync(p)) continue;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const [key, node] of Object.entries(data.roots || {})) {
      if (!node || typeof node !== 'object' || !node.type) continue;
      const clean = cleanNode(node);
      if (!countUrls(clean)) continue;
      const id = file === 'Bookmarks' ? `local_${key}` : key;
      roots[id] = clean;
    }
  }

  const total = Object.values(roots).reduce((s, n) => s + countUrls(n), 0);
  fs.mkdirSync(userDataDir, { recursive: true });
  const out = path.join(userDataDir, 'bookmarks.json');
  fs.writeFileSync(out, JSON.stringify({ version: 1, importedFrom: 'chrome', roots }, null, 1), { mode: 0o600 });
  return { total, out };
}

// RFC 4180 CSV parser (polja pod navodnicima, zarezi i novi redovi unutar polja).
function parseCsv(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') q = false;
      else field += c;
    } else if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((f) => f !== ''));
}

// Lozinke iz Chromeovog CSV izvoza. Cijeli trezor se šifrira ključem iz
// sistemskog keyringa (safeStorage). Lozinke se nikad ne ispisuju.
// Novi asinhroni safeStorage API, s rezervom na stari ako ga nema.
const enc = {
  available: (s) => (s.isAsyncEncryptionAvailable ? s.isAsyncEncryptionAvailable() : s.isEncryptionAvailable()),
  encrypt: (s, t) => (s.encryptStringAsync ? s.encryptStringAsync(t) : s.encryptString(t)),
  decrypt: async (s, b) => {
    const r = await (s.decryptStringAsync ? s.decryptStringAsync(b) : s.decryptString(b));
    return typeof r === 'string' ? r : r.result;
  },
};

async function importPasswords(csvPath, userDataDir, safeStorage) {
  if (!(await enc.available(safeStorage))) {
    throw new Error('Šifriranje nije dostupno (keyring nije otključan).');
  }
  if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('Keyring nije pronađen; odbijam spremiti lozinke bez pravog šifriranja.');
  }

  const rows = parseCsv(fs.readFileSync(csvPath, 'utf8').replace(/^﻿/, ''));
  const header = rows.shift().map((h) => h.trim().toLowerCase());
  const col = (n) => header.indexOf(n);
  for (const need of ['url', 'username', 'password']) {
    if (col(need) < 0) throw new Error(`CSV nema kolonu "${need}". Je li ovo Chromeov izvoz lozinki?`);
  }

  const entries = rows.map((r) => ({
    name: r[col('name')] || '',
    url: r[col('url')] || '',
    username: r[col('username')] || '',
    password: r[col('password')] || '',
    note: col('note') >= 0 ? r[col('note')] || '' : '',
  })).filter((e) => e.url && e.password);

  const out = await writeVault(userDataDir, safeStorage, { version: 1, entries });
  return { total: entries.length, out };
}

// Šifrira i sprema trezor lozinki (koristi ga i CSV uvoz i direktna migracija iz Chromea)
async function writeVault(userDataDir, safeStorage, data) {
  if (!(await enc.available(safeStorage))) throw new Error('Šifriranje nije dostupno (keyring nije otključan).');
  if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('Keyring nije pronađen; odbijam spremiti lozinke bez pravog šifriranja.');
  }
  fs.mkdirSync(userDataDir, { recursive: true });
  const out = path.join(userDataDir, 'vault.bin');
  fs.writeFileSync(out, await enc.encrypt(safeStorage, JSON.stringify(data)), { mode: 0o600 });
  return out;
}

async function readVault(userDataDir, safeStorage) {
  const p = path.join(userDataDir, 'vault.bin');
  return JSON.parse(await enc.decrypt(safeStorage, fs.readFileSync(p)));
}

// Chromeovi brojevi tipova polja za adrese (FieldType). Nepoznati ostaju kao "type_<broj>".
const FIELD_TYPES = {
  3: 'first_name', 4: 'middle_name', 5: 'last_name', 7: 'full_name', 9: 'email',
  10: 'phone_number', 11: 'phone_city_code', 12: 'phone_country_code',
  13: 'phone_city_and_number', 14: 'phone', 30: 'address_line1', 31: 'address_line2',
  33: 'city', 34: 'state', 35: 'zip', 36: 'country', 60: 'company', 77: 'street_address',
  81: 'dependent_locality', 82: 'sorting_code',
};

// Čita kopiju Chrome baze (original može biti zaključan dok Chrome radi).
function withDbCopy(src, fn) {
  const { DatabaseSync } = require('node:sqlite');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ice-import-'));
  const copy = path.join(tmp, 'db');
  try {
    fs.copyFileSync(src, copy);
    const db = new DatabaseSync(copy, { readOnly: true });
    try { return fn(db); } finally { db.close(); }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// Adrese i historija unosa u forme. Kartice i Google tokeni se namjerno NE uvoze.
// Sve se sprema šifrirano, jer su to lični podaci (adresa, telefon, email).
async function importAutofill(userDataDir, safeStorage, profile = findChromeProfile()) {
  if (!profile) throw new Error('Chrome profil nije pronađen.');
  if (!(await enc.available(safeStorage))) throw new Error('Šifriranje nije dostupno (keyring nije otključan).');
  if (safeStorage.getSelectedStorageBackend?.() === 'basic_text') {
    throw new Error('Keyring nije pronađen; odbijam spremiti lične podatke bez pravog šifriranja.');
  }

  const src = path.join(profile, 'Web Data');
  const data = withDbCopy(src, (db) => {
    const addresses = db.prepare('SELECT guid, label, use_count, use_date, date_modified FROM addresses').all()
      .map((a) => {
        const fields = {};
        for (const t of db.prepare("SELECT type, value FROM address_type_tokens WHERE guid = ? AND value <> ''").all(a.guid)) {
          fields[FIELD_TYPES[t.type] || `type_${t.type}`] = t.value;
        }
        return { label: a.label || '', useCount: a.use_count, lastUsed: a.use_date, modified: a.date_modified, fields };
      })
      .filter((a) => Object.keys(a.fields).length);

    const formHistory = db.prepare('SELECT name, value, date_created, date_last_used, count FROM autofill').all()
      .map((r) => ({ field: r.name, value: r.value, created: r.date_created, lastUsed: r.date_last_used, count: r.count }));

    return { addresses, formHistory };
  });

  fs.mkdirSync(userDataDir, { recursive: true });
  const out = path.join(userDataDir, 'autofill.bin');
  const blob = await enc.encrypt(safeStorage, JSON.stringify({ version: 1, importedFrom: 'chrome', ...data }));
  fs.writeFileSync(out, blob, { mode: 0o600 });
  return { addresses: data.addresses.length, formHistory: data.formHistory.length, out };
}

async function readAutofill(userDataDir, safeStorage) {
  return JSON.parse(await enc.decrypt(safeStorage, fs.readFileSync(path.join(userDataDir, 'autofill.bin'))));
}

module.exports = {
  importBookmarks, importPasswords, readVault, writeVault, importAutofill, readAutofill, parseCsv, findChromeProfile,
};
