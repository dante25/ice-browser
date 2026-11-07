// Dozvole po upitu: stranica traži kameru, lokaciju i slično, a Ice pita tebe.
// Odluke se pamte po stranici u ~/.config/Ice/permissions.json.
const { dialog, BrowserWindow } = require('electron');

// Bezopasne stvari koje se odobravaju bez pitanja
const AUTO_ALLOW = new Set(['fullscreen', 'clipboard-sanitized-write']);

// Osjetljive dozvole: provjera (navigator.permissions) vraća "da" samo ako si odobrio
const SENSITIVE = new Set([
  'media', 'geolocation', 'notifications', 'midi', 'midiSysex', 'clipboard-read', 'display-capture',
  'idle-detection', 'window-management', 'hid', 'serial', 'usb', 'storage-access',
  'top-level-storage-access', 'speaker-selection', 'keyboardLock', 'pointerLock', 'openExternal', 'fileSystem',
]);

const LABELS = {
  'media:video': 'pristup kameri',
  'media:audio': 'pristup mikrofonu',
  'media:audio+video': 'pristup kameri i mikrofonu',
  media: 'pristup kameri ili mikrofonu',
  geolocation: 'tvoju lokaciju',
  notifications: 'slanje obavještenja',
  midi: 'pristup MIDI uređajima',
  midiSysex: 'puni pristup MIDI uređajima',
  'clipboard-read': 'čitanje onoga što si kopirao (clipboard)',
  'display-capture': 'snimanje ekrana',
  'idle-detection': 'praćenje da li si za računarom',
  'window-management': 'upravljanje prozorima na ekranima',
  hid: 'pristup USB/HID uređajima',
  serial: 'pristup serijskim uređajima',
  usb: 'pristup USB uređajima',
  openExternal: 'otvaranje vanjske aplikacije',
  pointerLock: 'zaključavanje miša',
  keyboardLock: 'zaključavanje tastature',
  fileSystem: 'pristup fajlovima',
};

function keyFor(permission, details = {}) {
  if (permission !== 'media') return permission;
  const types = (details.mediaTypes || []).filter(Boolean).slice().sort().join('+');
  return types ? `media:${types}` : 'media';
}

function originOf(url) {
  try {
    const o = new URL(url).origin;
    return o.startsWith('http://') || o.startsWith('https://') ? o : null;
  } catch {
    return null;
  }
}

function setupPermissions(ses, store) {
  const decisions = store.data;

  ses.setPermissionRequestHandler(async (wc, permission, cb, details = {}) => {
    if (AUTO_ALLOW.has(permission)) return cb(true);
    const origin = originOf(details.requestingUrl || wc.getURL());
    if (!origin) return cb(false);

    const key = keyFor(permission, details);
    const saved = decisions[origin]?.[key];
    if (saved !== undefined) return cb(saved);

    if (process.env.ICE_TEST_PERMISSION) return cb(process.env.ICE_TEST_PERMISSION === 'allow');

    const host = new URL(origin).host;
    const { response, checkboxChecked } = await dialog.showMessageBox(BrowserWindow.fromWebContents(wc), {
      type: 'question',
      title: 'Ice: dozvola',
      message: `${host} traži ${LABELS[key] || `dozvolu "${permission}"`}`,
      detail: origin.startsWith('http://') ? 'Pažnja: stranica nema sigurnu vezu (HTTPS).' : '',
      buttons: ['Odbij', 'Dozvoli'],
      defaultId: 0,
      cancelId: 0,
      checkboxLabel: 'Zapamti za ovu stranicu',
      checkboxChecked: true,
    });
    const ok = response === 1;
    if (checkboxChecked) {
      (decisions[origin] ||= {})[key] = ok;
      store.save();
    }
    cb(ok);
  });

  ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details = {}) => {
    if (AUTO_ALLOW.has(permission)) return true;
    if (!SENSITIVE.has(permission)) return true; // ostale provjere: kao Electron po defaultu
    const origin = originOf(requestingOrigin) || requestingOrigin;
    const saved = decisions[origin] || {};
    if (permission === 'media') {
      const t = details.mediaType;
      return Object.entries(saved).some(([k, v]) => v === true && k.startsWith('media') && (!t || t === 'unknown' || k.includes(t)));
    }
    return saved[permission] === true;
  });
}

module.exports = { setupPermissions };
