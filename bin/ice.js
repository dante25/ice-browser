#!/usr/bin/env node
// Ice: pokreće ungoogled-chromium s Iceovim profilom, postavkama i ugrađenim funkcijama.
//   ice [adrese...]                 otvori Ice
//   ice --features                  spisak ugrađenih funkcija
//   ice --feature <key> on|off      uključi/isključi funkciju s prekidačem
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { createBuiltins } = require('../src/builtins');

const HOME = os.homedir();
const CONFIG = path.join(HOME, '.config/Ice');
const DATA = path.join(HOME, '.local/share/ice');
const CHROME = process.env.ICE_CHROME || path.join(DATA, 'chromium/current/chrome'); // ICE_CHROME: čuvar testira kandidata
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
  fs.writeFileSync(file, JSON.stringify(p));
}

// ---------- Sync preko Google Drivea ----------
const sync = require('../src/sync');
const { keyringSecret } = require('../src/import-chrome');
const syncLog = (m) => fs.appendFileSync(path.join(CONFIG, 'sync.log'), `${new Date().toISOString()} ${m}\n`);
const syncCtx = () => ({ configDir: CONFIG, profileDir: PROFILE, chromiumSecret: keyringSecret('chromium', true) });
const syncOn = () => sync.getPassphrase() && sync.remoteReady();

function askHidden(q) {
  return new Promise((resolve) => {
    const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(q)) process.stdout.write(s); };
    rl.question(q, (a) => { rl.close(); process.stdout.write('\n'); resolve(a); });
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
  applyDefaults();
}


const flags = [
  `--user-data-dir=${PROFILE}`,
  '--no-first-run',
  '--no-default-browser-check',
  '--disable-features=DisableLoadExtensionCommandLineSwitch',
  `--load-extension=${builtins.dirs((m) => console.warn('[ice]', m)).join(',')}`,
  '--class=Ice',
  ...args,
];

// CHROME_DESKTOP: da panel/dock prikaže Iceovu ikonu i ime (ice-browser.desktop)
const env = { ...process.env, CHROME_DESKTOP: 'ice-browser.desktop' };
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
