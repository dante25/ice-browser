// Ice - faza 1: samo motor. Bez sučelja (karoserija dolazi kasnije).
// Cilj ove faze: lagan, zaštićen Chromium motor bez pozadinskog saobraćaja.
const path = require('path');
const { app, BrowserWindow, session, safeStorage, protocol, net } = require('electron');
const importers = require('./src/importers');
const interstitial = require('./src/interstitial');
const { Blocklist } = require('./src/blocklists');
const { setupNetwork } = require('./src/network');
const { setupPermissions } = require('./src/permissions');
const { jsonStore } = require('./src/store');
const { createExceptions } = require('./src/exceptions');

app.setName('Ice'); // podaci u ~/.config/Ice
const DEBUG = !!process.env.ICE_DEBUG;
const log = (...a) => DEBUG && console.log('[ice]', ...a);

// --- Uvoz iz Chromea: npm start -- --import-bookmarks | --import-autofill | --import-passwords <fajl.csv> ---
const argv = process.argv;
const CLI_FLAGS = ['--import-all', '--import-bookmarks', '--import-passwords', '--import-autofill', '--list-exceptions', '--clear-exceptions'];
const importMode = CLI_FLAGS.some((f) => argv.includes(f));
if (importMode) {
  app.whenReady().then(async () => {
    const dir = app.getPath('userData');
    try {
      if (argv.includes('--list-exceptions') || argv.includes('--clear-exceptions')) {
        const ex = createExceptions(path.join(dir, 'exceptions.json'));
        if (argv.includes('--clear-exceptions')) { ex.clear(); console.log('Svi izuzeci obrisani.'); }
        const fmt = (k, label) => {
          const hosts = [...ex[k]];
          console.log(`${label} (${hosts.length}):`);
          for (const h of hosts) console.log(`  ${h}  (od ${ex.list()[k][h].slice(0, 10)})`);
        };
        fmt('phishing', 'Opasne stranice koje si ipak otvorio');
        fmt('http', 'Stranice bez HTTPS-a koje si dozvolio');
        console.log(`Izuzeci vrijede ${ex.days} dana.`);
        app.exit(0);
        return;
      }
      if (argv.includes('--import-all')) {
        const { migrateAll } = require('./src/migrate');
        const r = await migrateAll(dir, safeStorage, { passwords: !argv.includes('--skip-passwords') });
        const line = (name, v, fmt) => console.log(`  ${name.padEnd(12)} ${v?.error ? `GREŠKA: ${v.error}` : fmt(v)}`);
        console.log('Prenos iz Chromea u Ice:');
        line('bookmarks', r.bookmarks, (v) => `${v.total}`);
        line('autofill', r.autofill, (v) => `${v.addresses} adresa, ${v.formHistory} unosa u forme (šifrirano)`);
        if (r.lozinke) line('lozinke', r.lozinke, (v) => `${v.passwords} lozinki (šifrirano), ${v.neverSave} "nikad ne spremaj", ${v.noPassword} bez lozinke${v.failed ? `, ${v.failed} nije uspjelo` : ''}`);
        else console.log('  lozinke      preskočeno');
        line('historija', r.historija, (v) => `${v.urls} adresa, ${v.downloads} preuzimanja`);
        line('postavke', r.postavke, (v) => `${v.engines} pretraživača, ${v.permissions} dozvola po stranicama, početna, jezici, zoom...`);
        line('ekstenzije', r.ekstenzije, (v) => `${v.extensions} (${v.copied} kopirano${v.missing ? `, ${v.missing} fajlovi nedostupni` : ''}, ${v.disabled} isključeno u Chromeu)`);
        console.log('Kartice, Google tokeni i kolačići (prijave) namjerno nisu preneseni.');
        app.exit(Object.values(r).some((v) => v?.error) ? 1 : 0);
        return;
      }
      if (argv.includes('--import-bookmarks')) {
        const r = importers.importBookmarks(dir);
        console.log(`Bookmarks uvezeni: ${r.total} -> ${r.out}`);
      }
      if (argv.includes('--import-autofill')) {
        const r = await importers.importAutofill(dir, safeStorage);
        console.log(`Autofill uvezen i šifriran: ${r.addresses} adresa, ${r.formHistory} unosa u forme -> ${r.out}`);
        console.log('Kartice i Google tokeni namjerno nisu uvezeni.');
      }
      const i = argv.indexOf('--import-passwords');
      if (i >= 0) {
        const csv = argv[i + 1];
        if (!csv) throw new Error('Navedi putanju do CSV fajla.');
        const r = await importers.importPasswords(csv, dir, safeStorage);
        console.log(`Lozinke uvezene i šifrirane: ${r.total} -> ${r.out}`);
        console.log(`Sad obriši CSV, u njemu su lozinke kao običan tekst:\n  shred -u "${csv}"`);
      }
      app.exit(0);
    } catch (e) {
      console.error('Greška:', e.message);
      app.exit(1);
    }
  });
}

// --- Lakoća: gasimo Googleove servise i pozadinske procese ---
app.commandLine.appendSwitch('disable-background-networking');
app.commandLine.appendSwitch('disable-sync');
app.commandLine.appendSwitch('disable-breakpad');
app.commandLine.appendSwitch('disable-component-update');
app.commandLine.appendSwitch('no-pings');
app.commandLine.appendSwitch('disable-features', 'MediaRouter,OptimizationHints,Translate');

// --- Sigurnost: sandbox za sve procese ---
app.enableSandbox();

// ice:// je Iceov interni protokol (stranice upozorenja)
protocol.registerSchemesAsPrivileged([{ scheme: 'ice', privileges: { standard: true, secure: true } }]);

// Izuzeci koje si odobrio na stranici upozorenja; pamte se 30 dana (exceptions.json)
let allow;
let network;

function isWebUrl(url) {
  try {
    const p = new URL(url).protocol;
    return p === 'https:' || p === 'http:';
  } catch {
    return false;
  }
}

// Klikovi na stranici upozorenja: "nazad" ili "ipak nastavi"
function handleIceLink(contents, url) {
  const cur = contents.getURL();
  if (!cur.startsWith('ice://warning/')) return; // ice:// linkovi rade samo sa stranice upozorenja
  const u = new URL(url);
  if (u.hostname === 'back') {
    const h = contents.navigationHistory;
    if (h.canGoBack()) h.goBack(); else contents.loadURL('about:blank');
  } else if (u.hostname === 'proceed') {
    const t = u.searchParams.get('t');
    if (!t || t !== new URL(cur).searchParams.get('t')) return;
    const p = interstitial.take(t);
    if (!p) return;
    if (p.kind === 'phishing') allow.phishing.add(p.host); // samo tačan host
    else allow.http.add(p.host.replace(/^www\./, '')); // host i njegove poddomene
    log('izuzetak odobren:', p.kind, p.host);
    contents.loadURL(p.url);
  }
}

app.on('web-contents-created', (_e, contents) => {
  // Nema <webview> oznaka
  contents.on('will-attach-webview', (e) => e.preventDefault());
  contents.on('will-navigate', (e, url) => {
    if (url.startsWith('ice://')) {
      e.preventDefault();
      handleIceLink(contents, url);
    } else if (!isWebUrl(url)) {
      e.preventDefault(); // navigacija samo na http/https
    }
  });
  // Novi prozori za sada blokirani (tabovi dolaze u fazi sučelja)
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  // WebRTC ne otkriva tvoju lokalnu IP adresu stranicama
  contents.setWebRTCIPHandlingPolicy('default_public_interface_only');
  network?.watch(contents);

  if (DEBUG) {
    contents.on('did-navigate', (_ev, url, code) => log('stranica:', url, code));
    contents.on('did-fail-load', (_ev, code, desc, url, main) => main && log('greška:', code, desc, url));
  }
});

app.whenReady().then(() => {
  if (importMode) return;
  const dir = app.getPath('userData');
  const ses = session.defaultSession;

  interstitial.register(protocol);

  allow = createExceptions(path.join(dir, 'exceptions.json'));

  const blocklist = new Blocklist(dir, (url) => net.fetch(url));
  log('liste opasnih stranica iz keša:', blocklist.loadCached(), 'domena');
  blocklist.refresh().then((n) => log('liste opasnih stranica spremne:', n, 'domena'));

  network = setupNetwork(ses, { blocklist, interstitial, allow });
  setupPermissions(ses, jsonStore(path.join(dir, 'permissions.json'), {}));

  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    webPreferences: {
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  const target = process.argv.find((a) => /^https?:\/\//.test(a)) || 'https://example.org';
  win.loadURL(target);
});

app.on('window-all-closed', () => { if (!importMode) app.quit(); });
