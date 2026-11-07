// Popravke grešaka u originalnim ekstenzijama. Originalni kod (chrome-extensions/) se ne dira:
// pri pokretanju Ice napravi popravljenu kopiju u ~/.config/Ice/patched/. Ako update ekstenzije
// promijeni kod pa pravilo više ne odgovara, Ice to prijavi i učita original (ništa se ne pokvari).
// Svaka popravka je opisana i u chrome-extensions/FIXES.md.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const PATCHES = {
  'yt-hide-cards': [
    {
      id: 'hide-cards-unhandled-sendmessage',
      file: 'src/service-worker.min.js',
      why: 'Pri svakom učitavanju YouTubea šalje poruku prije nego što je content script spreman i ne hvata grešku ("Receiving end does not exist").',
      find: 'chrome.tabs.sendMessage(e,{urlChanged:n.url})',
      replace: 'chrome.tabs.sendMessage(e,{urlChanged:n.url}).catch(()=>{})',
    },
  ],
};

function hashOf(rules) {
  return crypto.createHash('sha256').update(JSON.stringify(rules.map((r) => ({ ...r, manifest: r.manifest ? r.sig : undefined })))).digest('hex').slice(0, 10);
}

// Vraća folder koji treba učitati: popravljenu kopiju, ili original ako nema/ne odgovara pravilo.
// extra: dodatna pravila (npr. izmjene manifesta { id, sig, manifest: (m) => void })
function prepare(key, srcDir, userDataDir, log = () => {}, extra = []) {
  const rules = [...(PATCHES[key] || []), ...extra];
  if (!rules.length) return srcDir;
  const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));
  const outDir = path.join(userDataDir, 'patched', `${key}-${manifest.version}-${hashOf(rules)}`);
  if (fs.existsSync(path.join(outDir, '.ice-patched'))) return outDir;

  // Prvo provjeri da sva pravila odgovaraju, tek onda kopiraj
  for (const r of rules) {
    if (r.manifest) continue;
    const text = fs.readFileSync(path.join(srcDir, r.file), 'utf8');
    const n = text.split(r.find).length - 1;
    if (n !== 1) {
      console.warn(`[ice] popravka "${r.id}" ne odgovara (${n} mjesta) u verziji ${manifest.version}; učitavam original.`);
      return srcDir;
    }
  }
  // Obriši stare popravljene kopije samo ove funkcije (druge verzije/pravila)
  for (const old of fs.existsSync(path.join(userDataDir, 'patched')) ? fs.readdirSync(path.join(userDataDir, 'patched')) : []) {
    if (old.startsWith(`${key}-`)) fs.rmSync(path.join(userDataDir, 'patched', old), { recursive: true, force: true });
  }
  fs.cpSync(srcDir, outDir, { recursive: true });
  // Chromeov potpis sadržaja više ne bi odgovarao izmijenjenim fajlovima
  fs.rmSync(path.join(outDir, '_metadata'), { recursive: true, force: true });
  for (const r of rules) {
    if (r.manifest) {
      const mf = path.join(outDir, 'manifest.json');
      const m = JSON.parse(fs.readFileSync(mf, 'utf8'));
      r.manifest(m);
      fs.writeFileSync(mf, JSON.stringify(m, null, 1));
      continue;
    }
    const f = path.join(outDir, r.file);
    fs.writeFileSync(f, fs.readFileSync(f, 'utf8').replace(r.find, r.replace));
    log('popravka primijenjena:', key, r.id);
  }
  fs.writeFileSync(path.join(outDir, '.ice-patched'), JSON.stringify(rules.map((r) => r.id)));
  return outDir;
}

module.exports = { prepare, PATCHES };
