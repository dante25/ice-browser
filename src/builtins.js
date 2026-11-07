// Ugrađene funkcije Icea: originalni kod ekstenzija (chrome-extensions/, own-extensions/) i Iceove
// vlastite (ice-features/). Chromium ih učitava pri svakom pokretanju Icea.
//   toggle: može se isključiti (npm start -- --feature <key> off)
//   always: uvijek uključeno
const fs = require('fs');
const path = require('path');
const { jsonStore } = require('./store');
const patches = require('./ext-patches');

const ROOT = path.join(__dirname, '..');

const BUILTINS = [
  // Iceove vlastite
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
  const store = jsonStore(path.join(configDir, 'features.json'), { toggles: {} });
  store.data.toggles ||= {};
  const isEnabled = (b) => b.group === 'always' || store.data.toggles[b.key] !== false;

  // Folderi za --load-extension (s primijenjenim popravkama)
  function dirs(log = () => {}) {
    const out = [];
    for (const b of BUILTINS) {
      if (!isEnabled(b)) continue;
      const dir = path.join(ROOT, b.dir);
      if (!fs.existsSync(path.join(dir, 'manifest.json'))) { log(`nema koda: ${b.name}`); continue; }
      out.push(patches.prepare(b.key, dir, dataDir, log));
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
  };
}

module.exports = { createBuiltins, BUILTINS };
