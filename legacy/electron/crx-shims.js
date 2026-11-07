// Glavni dio dodatka za Chromeove funkcije (vidi crx-shims.preload.js).
const path = require('path');
const { ipcMain } = require('electron');

const PRELOAD = path.join(__dirname, 'crx-shims.preload.js');

function setup(ses, { log = () => {} } = {}) {
  // PRIJE preloada od electron-chrome-extensions (on zaključa chrome objekt), pa se setup()
  // mora pozvati prije `new ElectronChromeExtensions(...)`.
  ses.registerPreloadScript({ id: 'ice-crx-shims-worker', type: 'service-worker', filePath: PRELOAD });
  ses.registerPreloadScript({ id: 'ice-crx-shims-frame', type: 'frame', filePath: PRELOAD });

  const handlers = {
    'commands.getAll': (ext) =>
      Object.entries(ext.manifest.commands || {}).map(([name, c]) => ({
        name,
        description: c.description || '',
        shortcut: '',
      })),
  };

  // Poziv smije doći samo od same ekstenzije (njen worker ili njena stranica)
  async function handle(senderUrl, extId, fn, ...args) {
    if (!senderUrl || !senderUrl.startsWith(`chrome-extension://${extId}/`)) throw new Error('Nedozvoljen poziv.');
    const ext = ses.extensions.getExtension(extId);
    if (!ext) throw new Error('Nepoznata funkcija.');
    const h = handlers[fn];
    if (!h) throw new Error(`Ice još ne podržava ${fn}.`);
    log('crx:', ext.name, fn);
    return h(ext, ...args);
  }

  ipcMain.handle('ice-crx', (event, extId, fn, ...args) => handle(event.senderFrame?.url, extId, fn, ...args));

  const workers = new WeakSet();
  ses.serviceWorkers.on('running-status-changed', ({ runningStatus, versionId }) => {
    if (runningStatus !== 'starting') return;
    const sw = ses.serviceWorkers.getWorkerFromVersionID(versionId);
    if (!sw || !sw.scope?.startsWith('chrome-extension://') || workers.has(sw)) return;
    workers.add(sw);
    sw.ipc.handle('ice-crx', (_event, extId, fn, ...args) => handle(sw.scope, extId, fn, ...args));
  });
}

module.exports = { setup };
