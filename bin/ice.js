#!/usr/bin/env node
// Ice: pokreće ungoogled-chromium s Iceovim profilom, postavkama i ugrađenim funkcijama.
//   ice [adrese...]                 otvori Ice
//   ice --features                  spisak ugrađenih funkcija
//   ice --feature <key> on|off      uključi/isključi funkciju s prekidačem
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createBuiltins, SIDEBAR_ID } = require('../src/builtins');

const HOME = os.homedir();
const CONFIG = process.env.ICE_CONFIG || path.join(HOME, '.config/Ice');
const DATA = path.join(HOME, '.local/share/ice');
// Motor: ICE_CHROME (čuvar testira kandidata) > korisnikov (čuvar ga ažurira) > onaj iz .deb paketa
const BUNDLED = path.join(__dirname, '..', 'chromium', 'chrome');
const USER_CHROME = path.join(DATA, 'chromium/current/chrome');
const CHROME = process.env.ICE_CHROME || (fs.existsSync(USER_CHROME) ? USER_CHROME : BUNDLED);
const PROFILE = process.env.ICE_PROFILE || path.join(CONFIG, 'chromium');

const args = process.argv.slice(2);
const builtins = createBuiltins(CONFIG, DATA);

// Radi li Ice s ovim profilom? SingletonLock je simbolički link na "host-pid".
function isRunningProfile() {
  try {
    const pid = Number(fs.readlinkSync(path.join(PROFILE, 'SingletonLock')).split('-').pop());
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

// Tema: auto (prati sistem), light ili dark; ice --theme <izbor>
const UI_FILE = path.join(CONFIG, 'ui.json');
const ui = (() => { try { return JSON.parse(fs.readFileSync(UI_FILE, 'utf8')); } catch { return {}; } })();
function resolveTheme() {
  if (ui.theme === 'chromium') return 'none';
  if (ui.theme === 'light' || ui.theme === 'dark') return ui.theme;
  const r = require('child_process').spawnSync('gsettings', ['get', 'org.gnome.desktop.interface', 'color-scheme'], { encoding: 'utf8' });
  return /dark/.test(r.stdout || '') ? 'dark' : 'light';
}
if (args[0] === '--theme') {
  if (!['light', 'dark', 'auto', 'chromium'].includes(args[1])) { console.error('Upotreba: ice --theme light|dark|auto|chromium'); process.exit(1); }
  fs.mkdirSync(CONFIG, { recursive: true });
  fs.writeFileSync(UI_FILE, JSON.stringify({ ...ui, theme: args[1] }));
  console.log(`Tema: ${args[1]} (vrijedi od sljedećeg pokretanja Icea)`);
  process.exit(0);
}

if (args[0] === '--features') {
  for (const b of builtins.list()) console.log(`${b.enabled ? '[x]' : '[ ]'} ${b.key.padEnd(22)} ${b.name}${b.group === 'always' ? '  (uvijek)' : ''}`);
  process.exit(0);
}
if (args[0] === '--feature') {
  const [, key, state] = args;
  if (!['on', 'off'].includes(state)) { console.error('Upotreba: ice --feature <key> on|off'); process.exit(1); }
  try { builtins.setEnabled(key, state === 'on'); } catch (e) { console.error(e.message); process.exit(1); }
  console.log(`${key}: ${state === 'on' ? 'uključeno' : 'isključeno'} (vrijedi od sljedećeg pokretanja Icea)`);
  process.exit(0);
}

if (args[0] === '--import-chrome') {
  if (isRunningProfile()) { console.error('Zatvori Ice prije prenosa.'); process.exit(1); }
  const { importChrome } = require('../src/import-chrome');
  console.log('Prenos iz Google Chromea u Ice:');
  importChrome({ chromeBin: CHROME, userDataDir: PROFILE, passwords: !args.includes('--skip-passwords') })
    .then((r) => process.exit(Object.values(r).some((v) => String(v).startsWith('GREŠKA')) ? 1 : 0))
    .catch((e) => { console.error('Greška:', e.message); process.exit(1); });
  return;
}

// Uvoz iz drugog browsera (Chrome, Chromium, Brave, Edge, Vivaldi, Opera, Firefox); podaci se dodaju
if (args[0] === '--import-list' || args[0] === '--import') {
  const { sources, importBrowser } = require('../src/import-browser');
  const list = sources();
  if (args[0] === '--import-list' || !args[1]) {
    if (!list.length) console.log('Nije pronađen nijedan drugi browser.');
    list.forEach((s, i) => console.log(`${String(i + 1).padStart(2)}  ${s.label}  [${s.can.join(', ')}]`));
    if (args[0] === '--import') console.log('Upotreba: ice --import <broj> [--only bookmarks,history,passwords,settings]');
    process.exit(0);
  }
  if (isRunningProfile()) { console.error('Zatvori Ice prije uvoza (ili koristi Ice panel: Ice postavke, Uvoz iz drugog browsera).'); process.exit(1); }
  const src = list[Number(args[1]) - 1];
  if (!src) { console.error('Nepoznat broj. Spisak: ice --import-list'); process.exit(1); }
  const only = args.includes('--only') ? String(args[args.indexOf('--only') + 1] || '').split(',').filter(Boolean) : [];
  console.log(`Uvoz iz: ${src.label}`);
  try {
    const r = importBrowser({ source: src.id, what: only, chromeBin: CHROME, userDataDir: PROFILE, log: console.log });
    console.log(`Rezervna kopija prijašnjeg Ice profila: ${r.backup}`);
    process.exit(r.failed ? 1 : 0);
  } catch (e) { console.error('Greška:', e.message); process.exit(1); }
}

// Ponovno pokretanje (iz Ice panela, npr. za zakazani uvoz): zatvori Ice, sačekaj, pokreni ponovo
if (args[0] === '--restart') {
  (async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    try { process.kill(Number(fs.readlinkSync(path.join(PROFILE, 'SingletonLock')).split('-').pop()), 'SIGTERM'); } catch { /* već zatvoren */ }
    for (let i = 0; i < 60 && isRunningProfile(); i++) await sleep(250);
    await sleep(1500); // sync pri zatvaranju prvo pročita profil
    const env = { ...process.env }; delete env.ICE_SESSION; delete env.ICE_FOREGROUND;
    spawn(process.execPath, [__filename], { env, detached: true, stdio: 'ignore' }).unref();
    process.exit(0);
  })();
  return;
}

if (!fs.existsSync(CHROME)) {
  console.error('Chromium za Ice nije instaliran. Pokreni: npm run guardian -- --install');
  process.exit(1);
}

// Iceove postavke u Chromiumovom profilu (upisuju se prije pokretanja, ostale postavke ostaju tvoje)
function applyDefaults() {
  const file = path.join(PROFILE, 'Default', 'Preferences');
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let p = {};
  try { p = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* prvi start */ }
  // HTTPS-first radi Ice Shield; Chromiumov HTTPS-only u ungoogled-chromiumu prikazuje praznu stranicu
  p.https_only_mode_enabled = false;
  p.webrtc = { ...(p.webrtc || {}), ip_handling_policy: 'default_public_interface_only' }; // bez lokalne IP
  p.browser = { ...(p.browser || {}), has_seen_welcome_page: true };
  p.enable_do_not_track = true;
  // Raspored: Ice panel desno (umjesto glavnog menija), dugme Home, novi tab kao početna, Ice ikona zakačena na traku
  p.side_panel = { ...(p.side_panel || {}), is_right_aligned: true };
  p.browser = { ...p.browser, show_home_button: true };
  p.homepage_is_newtabpage = true;
  p.extensions = { ...(p.extensions || {}) };
  const pinned = new Set(p.extensions.pinned_extensions || []);
  pinned.add(SIDEBAR_ID);
  p.extensions.pinned_extensions = [...pinned];

  // Uvijek uključene funkcije ne smiju ostati isključene (npr. nakon klika u Chromiumovim menijima)
  const info = builtins.info();
  const always = new Set(info.filter((f) => f.group === 'always' || f.ice).map((f) => f.id).filter(Boolean));
  for (const [id, e] of Object.entries(p.extensions.settings || {})) {
    if (always.has(id)) { delete e.disable_reasons; e.state = 1; }
  }

  // Traka s bookmarksima: izbor iz Ice panela se primjenjuje jednom (poslije i dalje radi Ctrl+Shift+B)
  if (typeof ui.bookmarkBar === 'boolean') {
    p.bookmark_bar = { ...(p.bookmark_bar || {}), show_on_all_tabs: ui.bookmarkBar };
    const { bookmarkBar, ...rest } = ui;
    fs.writeFileSync(UI_FILE, JSON.stringify(rest));
  }

  // Pri pokretanju uvijek nova početna stranica (bez vraćanja starih tabova)
  p.session = { ...(p.session || {}), restore_on_startup: 5 };
  delete p.session.startup_urls;

  // Tema: auto (prati sistem), light, dark ili chromium (Chromiumova zadana). Bira se u Ice panelu
  // (Ice postavke) ili komandom "ice --theme ...". Primjenjuje se pri pokretanju.
  const themeId = (info.find((f) => f.group === 'theme') || {}).id;
  if (themeId) p.extensions.theme = { ...(p.extensions.theme || {}), id: themeId };
  else if (resolveTheme() === 'none') p.extensions.theme = { id: '', system_theme: 0 };
  const flagsFile = path.join(PROFILE, 'ice-flags.json');
  const flags = (() => { try { return JSON.parse(fs.readFileSync(flagsFile, 'utf8')); } catch { return {}; } })();

  // Jednokratno: stare sesije (npr. tabovi iz testova) idu u backup
  if (!flags.sessionsCleaned) {
    const sess = path.join(PROFILE, 'Default', 'Sessions');
    if (fs.existsSync(sess)) fs.renameSync(sess, path.join(PROFILE, `backup-sessions-${Date.now()}`));
    flags.sessionsCleaned = true;
  }
  fs.writeFileSync(flagsFile, JSON.stringify(flags));
  // Most prema Ice panelu (izbor teme): manifest native messaging hosta u profilu
  const hostDir = path.join(PROFILE, 'NativeMessagingHosts');
  fs.mkdirSync(hostDir, { recursive: true });
  const wrapper = path.join(DATA, 'ice-host');
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(wrapper, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, 'ice-host.js')}"\n`, { mode: 0o755 });
  fs.writeFileSync(path.join(hostDir, 'ice.host.json'), JSON.stringify({
    name: 'ice.host', description: 'Ice panel', path: wrapper, type: 'stdio', allowed_origins: [`chrome-extension://${SIDEBAR_ID}/`],
  }));
  fs.writeFileSync(file, JSON.stringify(p));
}

// ---------- Sync preko Google Drivea ----------
const sync = require('../src/sync');
const { keyringSecret } = require('../src/import-chrome');
const syncLog = (m) => fs.appendFileSync(path.join(CONFIG, 'sync.log'), `${new Date().toISOString()} ${m}\n`);
const syncCtx = () => ({ configDir: CONFIG, profileDir: PROFILE, chromiumSecret: keyringSecret('chromium', true) });
const syncOn = () => sync.getPassphrase() && sync.remoteReady();

// Unos bez ispisa na ekran (terminal u "raw" režimu, ništa se ne ponavlja na ekranu)
function askHidden(q) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(q);
    if (!stdin.isTTY) { let d = ''; stdin.setEncoding('utf8'); stdin.on('data', (c) => { d += c; }); stdin.on('end', () => resolve(d.split('\n')[0])); return; }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let s = '';
    const onData = (chunk) => {
      for (const c of chunk) {
        if (c === '\r' || c === '\n') {
          stdin.setRawMode(false); stdin.pause(); stdin.off('data', onData);
          process.stdout.write('\n');
          return resolve(s);
        }
        if (c === '\u0003') { stdin.setRawMode(false); process.stdout.write('\n'); process.exit(130); }
        if (c === '\u007f' || c === '\b') { s = s.slice(0, -1); continue; }
        s += c;
      }
    };
    stdin.on('data', onData);
  });
}

const SYNC_CMDS = ['--sync-setup', '--sync-push', '--sync-pull', '--sync-status'];
if (SYNC_CMDS.includes(args[0])) {
  (async () => {
    try {
      if (args[0] === '--sync-setup') {
        if (!sync.remoteReady()) { console.error('Drive nije povezan. Pokreni: rclone config create ice-drive drive scope=drive.file'); process.exit(1); }
        console.log('Sync lozinka šifruje tvoj profil prije slanja na Drive. Trebat će ti i na Androidu.');
        console.log('Ako je zaboraviš, paket s Drivea se ne može otvoriti.');
        const a = await askHidden('Sync lozinka (najmanje 10 znakova): ');
        if (a.length < 10) { console.error('Prekratka.'); process.exit(1); }
        const b = await askHidden('Ponovi: ');
        if (a !== b) { console.error('Ne poklapaju se.'); process.exit(1); }
        sync.setPassphrase(a);
        console.log('Sync je podešen. Ice će slati profil pri zatvaranju i preuzimati noviji pri pokretanju.');
        if (!isRunningProfile()) { const r = sync.push(syncCtx()); console.log(`Prvo slanje: ${r.passwords} lozinki + bookmarks i postavke.`); }
      } else if (args[0] === '--sync-push') {
        const r = sync.push(syncCtx());
        console.log(`Poslano na Drive (${r.updated}): bookmarks, ${r.passwords} lozinki, postavke.`);
      } else if (args[0] === '--sync-pull') {
        if (isRunningProfile()) { console.error('Zatvori Ice prije preuzimanja.'); process.exit(1); }
        const r = sync.pull({ ...syncCtx(), force: args.includes('--force') });
        console.log(r.status === 'preuzeto' ? `Preuzeto s uređaja ${r.from}: ${r.bookmarks ?? 0} bookmarksa, ${r.passwords ?? 0} lozinki. Rezervna kopija: ${r.backup}` : `Stanje: ${r.status}`);
      } else {
        console.log(JSON.stringify(sync.status({ configDir: CONFIG }), null, 1));
      }
      process.exit(0);
    } catch (e) { console.error('Greška:', e.message); process.exit(1); }
  })();
  return;
}

const alreadyRunning = isRunningProfile();
if (!alreadyRunning) {
  // Noviji profil s drugog uređaja (ako je sync podešen); greška ne smije spriječiti pokretanje
  if (!process.env.ICE_SESSION && syncOn()) {
    try { const r = sync.pull(syncCtx()); syncLog(`pull: ${r.status}${r.from ? ` od ${r.from}` : ''}`); } catch (e) { syncLog(`pull greška: ${e.message}`); }
  }
}

// Uvoz zakazan iz Ice panela: radi se ovdje, dok je Ice zatvoren; ishod čita panel
const PENDING_IMPORT = path.join(CONFIG, 'pending-import.json');
if (!alreadyRunning && fs.existsSync(PENDING_IMPORT)) {
  let out;
  try {
    const job = JSON.parse(fs.readFileSync(PENDING_IMPORT, 'utf8'));
    fs.rmSync(PENDING_IMPORT, { force: true }); // prije uvoza: greška ne smije ponavljati uvoz pri svakom startu
    const r = require('../src/import-browser').importBrowser({ source: job.source, what: job.what, chromeBin: CHROME, userDataDir: PROFILE });
    out = { when: Date.now(), label: r.label, report: r.report, backup: r.backup };
    if (Object.keys(r.report).includes('bookmarks') && !r.report.bookmarks.startsWith('GREŠKA')) ui.bookmarkBar = true; // uvezeni bookmarksi odmah vidljivi
  } catch (e) {
    fs.rmSync(PENDING_IMPORT, { force: true });
    out = { when: Date.now(), error: e.message };
  }
  fs.writeFileSync(path.join(CONFIG, 'last-import.json'), JSON.stringify(out));
}

const loadDirs = builtins.dirs((m) => console.warn('[ice]', m), resolveTheme());
const flags = [
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--load-extension=${loadDirs.join(',')}`,
  '--class=Ice',
  '--show-avatar-button=never', // profil je u Ice panelu, ne na traci
  ...args,
];

// CHROME_DESKTOP: da panel/dock prikaže Iceovu ikonu i ime (ice-browser.desktop)
const env = { ...process.env, CHROME_DESKTOP: 'ice-browser.desktop' };
if (!alreadyRunning) applyDefaults();
const watchForSync = !alreadyRunning && syncOn() && !process.env.ICE_FOREGROUND;
if (watchForSync && !process.env.ICE_SESSION) {
  // Odvoji se od terminala i sačekaj da se Ice zatvori, pa pošalji profil na Drive
  spawn(process.execPath, [__filename, ...args], { env: { ...process.env, ICE_SESSION: '1' }, detached: true, stdio: 'ignore' }).unref();
  return;
}
const child = spawn(CHROME, flags, { env, detached: !process.env.ICE_FOREGROUND && !process.env.ICE_SESSION, stdio: process.env.ICE_FOREGROUND ? 'inherit' : 'ignore' });
if (process.env.ICE_SESSION) {
  child.on('exit', () => {
    try { const r = sync.push(syncCtx()); syncLog(`push: ${r.passwords} lozinki`); } catch (e) { syncLog(`push greška: ${e.message}`); }
    process.exit(0);
  });
} else if (process.env.ICE_FOREGROUND) child.on('exit', (c) => process.exit(c ?? 0));
else child.unref();
