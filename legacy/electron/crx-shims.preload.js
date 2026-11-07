// Chromeove funkcije za ugrađene funkcije koje ni Electron ni electron-chrome-extensions nemaju.
// Radi samo na chrome-extension:// stranicama i workerima; na običnim web stranicama ne radi ništa.
const { contextBridge, ipcRenderer } = require('electron');

function mainWorld() {
  const g = globalThis;
  const bridge = g.__iceCrx;
  try { delete g.__iceCrx; } catch { /* nije bitno */ }
  const base = g.chrome;
  if (!bridge || !base || !base.runtime) return;
  const id = base.runtime.id;

  // electron-chrome-extensions dodaje svoje funkcije na `chrome` i onda ga zaključa (Object.freeze),
  // pa novi `chrome` pravimo kao nastavak zaključanog (sve njegovo vrijedi, plus naše dodatke).
  // Chromium 156 pravi i ZASEBAN `browser` objekt bez funkcija biblioteke; ekstenzije koje koriste
  // webextension-polyfill (npr. Tab Session Manager) bi bez ovoga vidjele nepotpune funkcije.
  const c = Object.create(base);
  Object.defineProperty(g, 'chrome', { value: c, configurable: true, writable: true, enumerable: true });
  Object.defineProperty(g, 'browser', { value: c, configurable: true, writable: true, enumerable: true });

  const event = () => {
    const ls = new Set();
    return {
      addListener: (f) => ls.add(f),
      removeListener: (f) => ls.delete(f),
      hasListener: (f) => ls.has(f),
      hasListeners: () => ls.size > 0,
    };
  };
  // Chrome API radi i s callbackom i s Promiseom
  const call = (p, cb) => {
    if (typeof cb !== 'function') return p;
    p.then((r) => cb(r), (e) => {
      try { c.runtime.lastError = { message: String((e && e.message) || e) }; cb(undefined); } finally { delete c.runtime.lastError; }
    });
    return undefined;
  };

  // chrome.commands: prečice iz manifesta. Ice ih zasad ne okida (dolazi s postavkama prečica).
  if (!c.commands) {
    c.commands = {
      onCommand: event(),
      onChanged: event(),
      getAll: (cb) => call(bridge.invoke(id, 'commands.getAll'), cb),
    };
  }

  // chrome.identity: Google prijava za ekstenzije nije podržana u Iceu (Google je ne dozvoljava
  // preglednicima koji nisu Chrome). Funkcije postoje da ekstenzija ne padne, ali javljaju grešku.
  if (!c.identity) {
    const no = () => Promise.reject(new Error('Ice ne podržava Google prijavu za ekstenzije.'));
    c.identity = {
      getAuthToken: (opts, cb) => call(no(), typeof opts === 'function' ? opts : cb),
      launchWebAuthFlow: (_opts, cb) => call(no(), cb),
      removeCachedAuthToken: (_opts, cb) => call(Promise.resolve(), cb),
      clearAllCachedAuthTokens: (cb) => call(Promise.resolve(), cb),
      getProfileUserInfo: (opts, cb) => call(Promise.resolve({ email: '', id: '' }), typeof opts === 'function' ? opts : cb),
      getRedirectURL: (p = '') => `https://${id}.chromiumapp.org/${p}`,
      onSignInChanged: event(),
    };
  }
}

const isExtension = process.type === 'service-worker' || (typeof location !== 'undefined' && location.href.startsWith('chrome-extension://'));
if (isExtension) {
  try {
    contextBridge.exposeInMainWorld('__iceCrx', { invoke: (...args) => ipcRenderer.invoke('ice-crx', ...args) });
    contextBridge.executeInMainWorld({ func: mainWorld });
  } catch (e) {
    console.error('[ice] crx-shims:', e);
  }
}
