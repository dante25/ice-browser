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

if (!isRunningProfile()) applyDefaults();

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
const child = spawn(CHROME, flags, { env, detached: !process.env.ICE_FOREGROUND, stdio: process.env.ICE_FOREGROUND ? 'inherit' : 'ignore' });
if (process.env.ICE_FOREGROUND) child.on('exit', (c) => process.exit(c ?? 0));
else child.unref();
