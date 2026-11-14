// Ugrađene funkcije Icea: originalni kod ekstenzija (chrome-extensions/, own-extensions/) i Iceove
// vlastite (ice-features/). Chromium ih učitava pri svakom pokretanju Icea.
//   toggle: može se isključiti (npm start -- --feature <key> off)
//   always: uvijek uključeno
const fs = require('fs');
const path = require('path');
const { jsonStore } = require('./store');
const patches = require('./ext-patches');

const ROOT = path.join(__dirname, '..');
const KEYS = require('./extension-keys.json');
const SIDEBAR_ID = KEYS['ice-sidebar'].id;
const idFromKey = (k) => require('crypto').createHash('sha256').update(Buffer.from(k, 'base64')).digest('hex').slice(0, 32).replace(/[0-9a-f]/g, (c) => String.fromCharCode(97 + parseInt(c, 16)));

const BUILTINS = [
  // Iceove vlastite
  { key: 'ice-sidebar', name: 'Ice panel', dir: 'ice-features/ice-sidebar', group: 'always', ice: true },
  { key: 'ice-shield', name: 'Ice Shield (phishing, malware, GPC)', dir: 'ice-features/ice-shield', group: 'always' },
  { key: 'google-images-viewer', name: 'Pregled slika na Google Images', dir: 'ice-features/google-images-viewer', group: 'always' },
  // S prekidačem
  { key: 'sn-downloader', name: 'Ultimate SN Downloader', dir: 'own-extensions/Ultimate SN Downloader/extension', group: 'toggle' },
  { key: 'video-sniffer', name: 'Video Sniffer', dir: 'own-extensions/video-sniffer', group: 'toggle' },
  { key: 'yt-multiselect', name: 'Multiselect for YouTube', dir: 'chrome-extensions/multiselect-for-youtube', group: 'toggle' },
  // Uvijek uključeno
  { key: 'bookmarks-cleanup', name: 'Bookmarks clean up', dir: 'chrome-extensions/bookmarks-clean-up', group: 'always' },
  { key: 'tab-counter', name: 'Tab Counter', dir: 'chrome-extensions/chrome-tab-counter', group: 'always' },
  { key: 'backspace-back', name: 'Go Back With Backspace', dir: 'chrome-extensions/go-back-with-backspace', group: 'always' },
  { key: 'yt-quality', name: 'Default Quality Adjuster for YouTube', dir: 'chrome-extensions/default-quality-adjuster-for-youtube', group: 'always' },
  { key: 'right-click', name: 'Enable Right Click', dir: 'chrome-extensions/enable-right-click-for-google-chrome', group: 'always' },
  { key: 'hide-anything', name: 'Hide Anything', dir: 'chrome-extensions/hide-anything-element-hider-for-chrome', group: 'always' },
  { key: 'yt-hide-cards', name: 'Hide Labels and End Cards on YouTube', dir: 'chrome-extensions/hide-labels-and-end-cards-on-youtube', group: 'always' },
  { key: 'yt-progress-bar', name: 'Permanent Progress Bar for YouTube', dir: 'chrome-extensions/permanent-progress-bar-for-youtube', group: 'always' },
  { key: 'yt-screenshot', name: 'Screenshot YouTube', dir: 'chrome-extensions/screenshot-youtube', group: 'always' },
  { key: 'search-by-image', name: 'Search by Image', dir: 'chrome-extensions/search-by-image', group: 'always' },
  { key: 'tab-sessions', name: 'Tab Session Manager', dir: 'chrome-extensions/tab-session-manager', group: 'always' },
  { key: 'webmail-adblock', name: 'Webmail Ad Blocker', dir: 'chrome-extensions/webmail-ad-blocker', group: 'always' },
  { key: 'yt-nonstop', name: 'YouTube NonStop', dir: 'chrome-extensions/youtube-nonstop', group: 'always' },
  { key: 'yt-adblock', name: 'Adblock for YouTube', dir: 'chrome-extensions/adblock-for-youtube', group: 'always' },
];

function createBuiltins(configDir, dataDir) {
  let lastInfo = [];
  const store = jsonStore(path.join(configDir, 'features.json'), { toggles: {} });
  store.data.toggles ||= {};
  const isEnabled = (b) => b.group === 'always' || store.data.toggles[b.key] !== false;

  // Izmjene manifesta: stalni ID za tvoje ekstenzije i dozvola da se njihov meni/postavke
  // prikazuju unutar Ice panela (bez novog prozora ili taba)
  function manifestRules(b, m) {
    const rules = [];
    if (!m.key && KEYS[b.key]) rules.push({ id: 'stalni-id', sig: KEYS[b.key].id, manifest: (x) => { x.key = KEYS[b.key].key; } });
    if (b.ice || m.theme) return rules;
    // Bez stranica dobrodošlice pri svakom pokretanju (vidi src/ice-shim.js)
    const sw = m.background?.service_worker;
    if (sw) {
      rules.push({
        id: 'bez-dobrodoslice', sig: 'shim-1',
        manifest: (x, outDir) => {
          const rel = x.background.service_worker.replace(/^\.\//, '');
          const dir = path.posix.dirname(rel);
          const entry = path.posix.join(dir === '.' ? '' : dir, 'ice-entry.js');
          fs.copyFileSync(path.join(__dirname, 'ice-shim.js'), path.join(outDir, dir === '.' ? '' : dir, 'ice-shim.js'));
          const orig = './' + path.posix.basename(rel);
          fs.writeFileSync(path.join(outDir, entry), x.background.type === 'module'
            ? `import './ice-shim.js';\nimport '${orig}';\n`
            : `importScripts('ice-shim.js', '${path.posix.basename(rel)}');\n`);
          x.background.service_worker = entry;
        },
      });
    }
    const popup = ((m.action || m.browser_action || {}).default_popup || '').split('?')[0].replace(/^\.\//, '');
    const options = (m.options_page || m.options_ui?.page || '').replace(/^\.\//, '');
    const pages = [popup, options].filter(Boolean);
    if (pages.length) {
      rules.push({
        id: 'meni-u-ice-panelu', sig: `${SIDEBAR_ID}:${pages.join(',')}`,
        manifest: (x) => {
          x.web_accessible_resources = [...(x.web_accessible_resources || []), { resources: pages, matches: [], extension_ids: [SIDEBAR_ID] }];
        },
      });
    }
    return rules;
  }

  // Folderi za --load-extension (s primijenjenim popravkama) i opis funkcija za Ice panel
  function dirs(log = () => {}, theme = 'dark') {
    const out = [];
    const info = [];
    for (const b of BUILTINS) {
      if (!isEnabled(b)) continue;
      const dir = path.join(ROOT, b.dir);
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) { log(`nema koda: ${b.name}`); continue; }
      const m = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf8'));
      if (b.key !== 'ice-sidebar') out.push(patches.prepare(b.key, dir, dataDir, log, manifestRules(b, m)));
      const key = m.key || KEYS[b.key]?.key;
      const popup = ((m.action || m.browser_action || {}).default_popup || '').replace(/^\.\//, '');
      const options = (m.options_page || m.options_ui?.page || '').replace(/^\.\//, '');
      info.push({ key: b.key, name: b.name, group: b.group, ice: !!b.ice, id: key ? idFromKey(key) : null, popup: popup || null, options: options || null });
    }
    // Chromium učitava samo JEDNU temu preko komandne linije: light, dark ili none (Chromiumova zadana)
    if (theme === 'light' || theme === 'dark') {
      const d = `ice-features/ice-theme-${theme}`;
      if (fs.existsSync(path.join(ROOT, d, 'manifest.json'))) {
        out.push(path.join(ROOT, d));
        info.push({ key: `ice-theme-${theme}`, name: `Ice tema (${theme === 'light' ? 'svijetla' : 'tamna'})`, group: 'theme', ice: true, id: KEYS[theme === 'light' ? 'ice-theme' : 'ice-theme-dark'].id });
      }
    }
    lastInfo = info;
    // Ice panel se kopira u korisnički folder (program može biti instaliran kao .deb, samo za čitanje)
    // i dobija spisak funkcija (features.json)
    const sidebarSrc = path.join(ROOT, 'ice-features/ice-sidebar');
    if (fs.existsSync(path.join(sidebarSrc, 'manifest.json'))) {
      const live = path.join(dataDir, 'ice-sidebar');
      fs.rmSync(live, { recursive: true, force: true });
      fs.cpSync(sidebarSrc, live, { recursive: true });
      fs.writeFileSync(path.join(live, 'features.json'), JSON.stringify(info, null, 1));
      out.unshift(live);
    }
    return out;
  }

  return {
    list: () => BUILTINS.map((b) => ({ ...b, enabled: isEnabled(b) })),
    setEnabled(key, on) {
      const b = BUILTINS.find((x) => x.key === key);
      if (!b) throw new Error(`Nepoznata funkcija "${key}".`);
      if (b.group !== 'toggle') throw new Error(`"${b.name}" je uvijek uključena.`);
      store.data.toggles[key] = !!on;
      store.save();
    },
    dirs,
    info: () => lastInfo,
  };
}

module.exports = { createBuiltins, BUILTINS, SIDEBAR_ID };
