// Zaštita od phishinga i malwarea bez Googlea: javne liste se skidaju i provjeravaju lokalno.
// Ice nikome ne šalje koje stranice posjećuješ.
//
// Lakoća: ~600.000 domena drži se kao sortirani nizovi 64-bitnih heševa (~5 MB RAM-a),
// a ne kao skup stringova (~60 MB). Provjera je binarna pretraga, ispod mikrosekunde.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

// exact:    blokira se tačno taj host (i www. varijanta)
// wildcard: blokira se domen i sve njegove poddomene
const SOURCES = [
  {
    id: 'phishing-database',
    url: 'https://raw.githubusercontent.com/Phishing-Database/Phishing.Database/master/phishing-domains-ACTIVE.txt',
    format: 'domains',
    match: 'exact',
  },
  { id: 'openphish', url: 'https://openphish.com/feed.txt', format: 'urls', match: 'exact' },
  // Malware (URLhaus podaci, preko malware-filter projekta)
  {
    id: 'urlhaus-filter',
    url: 'https://malware-filter.gitlab.io/malware-filter/urlhaus-filter-domains.txt',
    format: 'domains',
    match: 'exact',
  },
  // Malware, phishing, prevare, kripto-rudarenje (HaGeZi Threat Intelligence, mini)
  {
    id: 'hagezi-tif',
    url: 'https://raw.githubusercontent.com/hagezi/dns-blocklists/main/wildcard/tif.mini-onlydomains.txt',
    format: 'domains',
    match: 'wildcard',
  },
];

const MAX_AGE_MS = 6 * 60 * 60 * 1000; // liste se osvježavaju svakih 6 sati

// Velike dijeljene platforme: liste ponekad navedu cijeli host (npr. sites.google.com),
// što bi blokiralo milione legitimnih stranica. Takve hostove nikad ne blokiramo cijele,
// niti preko wildcard pravila za njihove poddomene.
const NEVER_BLOCK = new Set([
  'sites.google.com', 'docs.google.com', 'drive.google.com', 'forms.gle', 'storage.googleapis.com',
  'google.com', 'googleusercontent.com', 'github.com', 'gist.github.com', 'raw.githubusercontent.com',
  'githubusercontent.com', 'github.io', 'dropbox.com', 'dropboxusercontent.com', 'onedrive.live.com',
  'live.com', 'sharepoint.com', '1drv.ms', 't.me', 'bit.ly', 'linktr.ee', 'ipfs.io', 'web.archive.org',
  'blogspot.com', 'amazonaws.com', 'cloudfront.net', 'discord.com', 'discordapp.com', 'cdn.discordapp.com',
  'vercel.app', 'netlify.app', 'pages.dev', 'workers.dev', 'web.app', 'firebaseapp.com', 'appspot.com',
  'gitlab.io', 'gitlab.com', 'r2.dev', 'mediafire.com', 'mega.nz',
]);

function normHost(h) {
  h = String(h).toLowerCase().replace(/\.$/, '');
  return h.startsWith('www.') ? h.slice(4) : h;
}

function hash(host) {
  return crypto.createHash('sha256').update(host).digest().readBigUInt64BE(0);
}

function parse(text, format) {
  const hosts = [];
  for (let line of text.split('\n')) {
    line = line.trim();
    if (!line || line[0] === '#' || line[0] === '!') continue;
    if (format === 'urls') {
      try { line = new URL(line).hostname; } catch { continue; }
    }
    hosts.push(normHost(line.replace(/^\*\./, '')));
  }
  return hosts;
}

function sortedHashes(hostLists) {
  const set = new Set();
  for (const list of hostLists) for (const h of list) if (!NEVER_BLOCK.has(h)) set.add(hash(h));
  return BigUint64Array.from(set).sort();
}

function contains(arr, v) {
  let lo = 0, hi = arr.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const x = arr[mid];
    if (x === v) return true;
    if (x < v) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

// "a.b.primjer.com" -> ["a.b.primjer.com", "b.primjer.com", "primjer.com"] (bez samog TLD-a)
function suffixes(host) {
  const parts = host.split('.');
  const out = [];
  for (let i = 0; i < parts.length - 1; i++) out.push(parts.slice(i).join('.'));
  return out;
}

const testSet = (name) => new Set((process.env[name] || '').split(',').filter(Boolean).map(normHost));

class Blocklist {
  constructor(userDataDir, fetchFn) {
    this.dir = path.join(userDataDir, 'blocklists');
    this.fetch = fetchFn;
    this.exact = new BigUint64Array(0);
    this.wild = new BigUint64Array(0);
    // Samo za testiranje: ICE_TEST_BLOCK=host (tačno), ICE_TEST_BLOCK_WILD=domen (s poddomenama)
    this.testExact = testSet('ICE_TEST_BLOCK');
    this.testWild = testSet('ICE_TEST_BLOCK_WILD');
  }

  file(name) { return path.join(this.dir, `${name}.bin`); }

  get size() { return this.exact.length + this.wild.length; }

  loadCached() {
    const load = (name) => {
      try {
        const b = fs.readFileSync(this.file(name));
        return new BigUint64Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
      } catch {
        return new BigUint64Array(0);
      }
    };
    this.exact = load('exact');
    this.wild = load('wild');
    return this.size;
  }

  async refresh({ force = false } = {}) {
    fs.mkdirSync(this.dir, { recursive: true });
    fs.rmSync(path.join(this.dir, 'table.bin'), { force: true }); // stari format (prije malware lista)
    const lists = { exact: [], wildcard: [] };
    let changed = false;
    for (const s of SOURCES) {
      const file = path.join(this.dir, `${s.id}.txt`);
      const fresh = fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs < MAX_AGE_MS;
      let text = null;
      if (force || !fresh) {
        try {
          const r = await this.fetch(s.url);
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          text = await r.text();
          fs.writeFileSync(file, text);
          changed = true;
        } catch (e) {
          console.warn(`[ice] lista ${s.id} nije osvježena: ${e.message}`);
        }
      }
      if (text === null && fs.existsSync(file)) text = fs.readFileSync(file, 'utf8');
      if (text) lists[s.match].push(parse(text, s.format));
    }
    if (changed || !this.exact.length || !this.wild.length) {
      this.exact = sortedHashes(lists.exact);
      this.wild = sortedHashes(lists.wildcard);
      fs.writeFileSync(this.file('exact'), Buffer.from(this.exact.buffer));
      fs.writeFileSync(this.file('wild'), Buffer.from(this.wild.buffer));
    }
    return this.size;
  }

  isBlocked(host) {
    const h = normHost(host);
    if (NEVER_BLOCK.has(h)) return false;
    if (this.testExact.has(h) || contains(this.exact, hash(h))) return true;
    for (const s of suffixes(h)) {
      if (NEVER_BLOCK.has(s)) continue;
      if (this.testWild.has(s) || contains(this.wild, hash(s))) return true;
    }
    return false;
  }
}

module.exports = { Blocklist, normHost };
