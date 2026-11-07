// Ice čuvar: prati nove verzije motora (Electron/Chromium), sigurnosne zakrpe i testira update.
// Nikad sam ne mijenja Ice. Kad je update spreman i testovi prođu, ti ga odobriš sa --apply.
//
//   npm run guardian                 provjeri, pa testiraj kandidata ako postoji noviji motor
//   npm run guardian -- --apply      primijeni testirani update na Ice
//   npm run guardian -- --target X   testiraj tačno verziju X (za provjeru samog čuvara)
//   npm run guardian -- --quiet      bez obavještenja na desktopu ako nema ničeg novog
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ICE = path.resolve(new URL('..', import.meta.url).pathname);
const STATE_FILE = path.join(os.homedir(), '.config/Ice/guardian.json');
const WORK = path.join(os.homedir(), '.cache/ice-guardian');
const args = process.argv.slice(2);
const opt = (name) => args.includes(name);
const val = (name) => (args.includes(name) ? args[args.indexOf(name) + 1] : null);

const log = (...a) => console.log('[čuvar]', ...a);

function notify(title, body, urgent = false) {
  spawnSync('notify-send', ['-a', 'Ice', '-u', urgent ? 'critical' : 'normal', title, body], { stdio: 'ignore' });
}

function readState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; }
}
function writeState(s) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1));
}

function currentVersion(dir = ICE) {
  return JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')).devDependencies.electron.replace(/^[^\d]*/, '');
}

const semver = (v) => v.split('.').map(Number);
function cmp(a, b) {
  const x = semver(a), y = semver(b);
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] - y[i];
  return 0;
}

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'ice-guardian' } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

// Sigurnosne zakrpe između dvije verzije, iz Electronovih release notes na GitHubu
async function securityNotes(from, to, releases) {
  const between = releases
    .filter((r) => !r.version.includes('-') && cmp(r.version, from) > 0 && cmp(r.version, to) <= 0)
    .slice(0, 10); // GitHub bez prijave dozvoljava 60 upita na sat
  const cves = new Set();
  let backports = 0;
  for (const r of between) {
    try {
      const rel = await getJson(`https://api.github.com/repos/electron/electron/releases/tags/v${r.version}`);
      for (const m of rel.body.matchAll(/CVE-\d{4}-\d{4,}/g)) cves.add(m[0]);
      if (/backport(ed)? fix/i.test(rel.body)) backports++;
    } catch (e) {
      log(`release notes za ${r.version} nisu dostupne: ${e.message}`);
    }
  }
  return { versions: between.map((r) => r.version), cves: [...cves].sort(), backports };
}

function run(cmd, cmdArgs, cwd, timeoutMs = 10 * 60 * 1000) {
  const r = spawnSync(cmd, cmdArgs, { cwd, encoding: 'utf8', timeout: timeoutMs, env: process.env });
  return { ok: r.status === 0, out: `${r.stdout || ''}${r.stderr || ''}` };
}

function testsPass(out) {
  const ok = (out.match(/^OK /gm) || []).length;
  const fail = (out.match(/^FAIL/gm) || []).length;
  return { ok, fail, pass: ok > 0 && fail === 0 };
}

// Kopija Icea s novim motorom, odvojena od pravog Icea
function buildCandidate(version) {
  const dir = path.join(WORK, 'candidate');
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  fs.cpSync(ICE, dir, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules`) && !src.includes(`${path.sep}.git`) });
  log(`kandidat: instaliram Electron ${version}...`);
  const inst = run('npm', ['install', '--save-dev', '--save-exact', `electron@${version}`], dir);
  if (!inst.ok) return { dir, installed: false, out: inst.out };
  // Novi Electron skida motor tek pri prvom pokretanju; ovdje ga skidamo odmah, s ponovnim pokušajem
  let out = '';
  for (let attempt = 1; attempt <= 3; attempt++) {
    log(`kandidat: skidam Chromium motor (pokušaj ${attempt})...`);
    out = run('npx', ['install-electron', '--no'], dir).out;
    const v = run(path.join(dir, 'node_modules/.bin/electron'), ['--version'], dir, 60 * 1000);
    if (v.ok && v.out.trim().endsWith(version)) return { dir, installed: true };
    out += v.out;
  }
  return { dir, installed: false, out };
}

function testCandidate(dir) {
  // Testovi koriste prave stranice; jedan ponovljeni pokušaj zbog nestabilnih vanjskih servera
  for (let attempt = 1; attempt <= 2; attempt++) {
    log(`kandidat: sigurnosni testovi (pokušaj ${attempt})...`);
    const t = run('npm', ['test'], dir, 5 * 60 * 1000);
    const res = testsPass(t.out);
    if (res.pass) return { ...res, out: t.out };
    if (attempt === 2) return { ...res, out: t.out };
  }
}

async function check() {
  const state = readState();
  const current = currentVersion();
  const releases = await getJson('https://releases.electronjs.org/releases.json');
  const stable = releases.filter((r) => !r.version.includes('-')).sort((a, b) => cmp(b.version, a.version));
  const latest = stable[0];
  const mine = releases.find((r) => r.version === current);

  let chromeStable = null;
  try {
    const cd = await getJson('https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Linux&num=1');
    chromeStable = cd[0]?.version || null;
  } catch (e) {
    log(`Chrome verzija nije dostupna: ${e.message}`);
  }

  // Electron podržava (krpi) samo zadnje 3 glavne verzije
  const majors = [...new Set(stable.map((r) => semver(r.version)[0]))].slice(0, 3);
  const supported = majors.includes(semver(current)[0]);

  const target = val('--target') || latest.version;
  const targetRel = releases.find((r) => r.version === target);
  if (!targetRel) throw new Error(`Electron ${target} ne postoji.`);

  log(`Ice motor:    Electron ${current} (Chromium ${mine?.chrome ?? '?'})`);
  log(`Najnoviji:    Electron ${latest.version} (Chromium ${latest.chrome}), izašao ${latest.date}`);
  if (chromeStable) log(`Google Chrome: ${chromeStable}`);
  if (!supported) log(`UPOZORENJE: Electron ${semver(current)[0]} više ne dobija sigurnosne zakrpe!`);

  const forced = !!val('--target');
  if (!forced && cmp(target, current) <= 0) {
    log('Ice je na najnovijem motoru. Nema ništa za uraditi.');
    writeState({ ...state, lastCheck: new Date().toISOString(), current, latest: latest.version, chromeStable, supported, status: 'up-to-date' });
    if (!supported) notify('Ice: motor bez zakrpa', `Electron ${semver(current)[0]} više nije podržan.`, true);
    else if (!opt('--quiet')) notify('Ice čuvar', `Motor je ažuran (Electron ${current}).`);
    return;
  }

  const sec = forced ? { versions: [], cves: [], backports: 0 } : await securityNotes(current, target, releases);
  if (sec.versions.length) {
    log(`Nove verzije: ${sec.versions.join(', ')}`);
    log(`Sigurnosne zakrpe: ${sec.cves.length ? sec.cves.join(', ') : 'nema imenovanih CVE-ova'}; izdanja s prenesenim Chromium zakrpama: ${sec.backports}`);
  }

  const cand = buildCandidate(target);
  if (!cand.installed) {
    log('Instalacija kandidata nije uspjela:\n' + cand.out.slice(-1500));
    writeState({ ...state, lastCheck: new Date().toISOString(), status: 'install-failed', candidate: target });
    notify('Ice čuvar: greška', `Electron ${target} se nije instalirao.`, true);
    process.exitCode = 1;
    return;
  }
  const t = testCandidate(cand.dir);
  log(`Testovi: ${t.ok} OK, ${t.fail} FAIL`);
  if (!t.pass) {
    log(t.out.split('\n').filter((l) => l.startsWith('FAIL')).join('\n'));
    writeState({ ...state, lastCheck: new Date().toISOString(), status: 'tests-failed', candidate: target, tests: { ok: t.ok, fail: t.fail } });
    notify('Ice čuvar: testovi pali', `Electron ${target}: ${t.fail} testova nije prošlo. Update NIJE primijenjen.`, true);
    process.exitCode = 1;
    return;
  }

  if (forced && cmp(target, current) <= 0) {
    log(`Testni prolaz za ${target} uspješan (nije noviji od ${current}, pa nije ponuđen za primjenu).`);
    writeState({ ...state, lastCheck: new Date().toISOString(), status: 'up-to-date', current, tests: { ok: t.ok, fail: t.fail } });
    return;
  }

  writeState({
    ...state,
    lastCheck: new Date().toISOString(),
    status: 'ready',
    current,
    candidate: target,
    candidateChrome: targetRel.chrome,
    security: sec,
    tests: { ok: t.ok, fail: t.fail },
  });
  const cveText = sec.cves.length ? `, ${sec.cves.length} sigurnosnih zakrpa` : '';
  log(`SPREMNO: Electron ${target} (Chromium ${targetRel.chrome})${cveText}. Svi testovi prošli.`);
  log('Odobri sa:  npm run guardian -- --apply');
  notify('Ice: update spreman', `Electron ${target} (Chromium ${targetRel.chrome})${cveText}. Odobri: npm run guardian -- --apply`, sec.cves.length > 0);
}

function apply() {
  const state = readState();
  if (state.status !== 'ready' || !state.candidate) {
    log('Nema testiranog updatea za primijeniti. Prvo pokreni: npm run guardian');
    process.exitCode = 1;
    return;
  }
  const before = currentVersion();
  if (cmp(state.candidate, before) <= 0) {
    log(`Kandidat ${state.candidate} nije noviji od trenutnog ${before}; ne vraćam motor unazad.`);
    process.exitCode = 1;
    return;
  }
  log(`Primjenjujem Electron ${state.candidate} (bio ${before})...`);
  const inst = run('npm', ['install', '--save-dev', '--save-exact', `electron@${state.candidate}`], ICE);
  if (!inst.ok) {
    log('Instalacija nije uspjela, Ice je ostao na staroj verziji:\n' + inst.out.slice(-1500));
    process.exitCode = 1;
    return;
  }
  writeState({ ...state, status: 'applied', appliedAt: new Date().toISOString(), previous: before, current: state.candidate });
  fs.rmSync(path.join(WORK, 'candidate'), { recursive: true, force: true });
  log(`Gotovo. Ice je sada na Electronu ${state.candidate}. Vraćanje: npm install --save-dev --save-exact electron@${before}`);
}

try {
  if (opt('--apply')) apply();
  else await check();
} catch (e) {
  log('Greška:', e.message);
  notify('Ice čuvar: greška', e.message, true);
  process.exitCode = 1;
}
