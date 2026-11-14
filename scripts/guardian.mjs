// Ice čuvar: prati nove verzije ungoogled-chromiuma (Iceov motor), skida ih, provjerava SHA-256,
// testira (npm test + test pregleda slika) i tek na tvoje odobrenje (--apply) ih uključuje.
//
//   npm run guardian                    provjeri; ako ima noviji motor, skini i testiraj ga
//   npm run guardian -- --apply         uključi testiranu verziju (stara ostaje za povratak)
//   npm run guardian -- --rollback      vrati prethodnu verziju
//   npm run guardian -- --install       prva instalacija motora (novi računar)
//   npm run guardian -- --quiet         bez obavještenja ako nema ničeg novog
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import crypto from 'node:crypto';

const ICE = path.resolve(new URL('..', import.meta.url).pathname);
const BASE = path.join(os.homedir(), '.local/share/ice/chromium');
const CURRENT = path.join(BASE, 'current');
const STATE_FILE = path.join(os.homedir(), '.config/Ice/guardian.json');
const REPO = 'ungoogled-software/ungoogled-chromium-portablelinux';
const args = process.argv.slice(2);
const opt = (n) => args.includes(n);
const log = (...a) => console.log('[čuvar]', ...a);

const notify = (title, body, urgent = false) =>
  spawnSync('notify-send', ['-a', 'Ice', '-u', urgent ? 'critical' : 'normal', title, body], { stdio: 'ignore' });
const readState = () => { try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); } catch { return {}; } };
const writeState = (s) => { fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true }); fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 1)); };
const installed = () => { try { return fs.readlinkSync(CURRENT); } catch { return null; } };

// "156.0.8078.79-1" -> poređenje po brojevima
const parts = (v) => v.replace('-', '.').split('.').map(Number);
const cmp = (a, b) => { const x = parts(a), y = parts(b); for (let i = 0; i < Math.max(x.length, y.length); i++) if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) - (y[i] || 0); return 0; };

async function getJson(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'ice-guardian', accept: 'application/vnd.github+json', ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) } });
  if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`);
  return r.json();
}

async function latestRelease() {
  const target = args.includes('--target') ? args[args.indexOf('--target') + 1] : null; // samo za provjeru čuvara
  const rels = await getJson(`https://api.github.com/repos/${REPO}/releases?per_page=20`);
  const rel = rels.find((r) => !r.prerelease && !r.draft && (!target || r.tag_name === target));
  if (!rel) throw new Error(`Izdanje ${target} nije pronađeno.`);
  const asset = rel.assets.find((a) => /x86_64_linux\.tar\.xz$/.test(a.name));
  if (!asset?.digest?.startsWith('sha256:')) throw new Error(`Izdanje ${rel.tag_name} nema SHA-256 sumu; ne skidam ga.`);
  return { version: rel.tag_name, url: asset.browser_download_url, sha256: asset.digest.slice(7), size: asset.size, date: rel.published_at };
}

// Skida, provjerava sumu i raspakuje u BASE/<verzija>
async function download(rel) {
  const dir = path.join(BASE, rel.version);
  if (fs.existsSync(path.join(dir, 'chrome'))) return dir;
  const tmp = path.join(BASE, `.dl-${rel.version}`);
  fs.rmSync(tmp, { recursive: true, force: true });
  fs.mkdirSync(tmp, { recursive: true });
  const file = path.join(tmp, 'chromium.tar.xz');
  log(`skidam ${rel.version} (${Math.round(rel.size / 1048576)} MB)...`);
  const r = await fetch(rel.url);
  if (!r.ok) throw new Error(`Skidanje nije uspjelo: HTTP ${r.status}`);
  fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
  const sum = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
  if (sum !== rel.sha256) { fs.rmSync(tmp, { recursive: true, force: true }); throw new Error('SHA-256 se NE poklapa; fajl je obrisan.'); }
  log('SHA-256 provjeren.');
  const x = spawnSync('tar', ['-xJf', file, '-C', tmp, '--strip-components=1']);
  if (x.status !== 0) throw new Error(`Raspakivanje nije uspjelo: ${x.stderr}`);
  fs.rmSync(file);
  fs.renameSync(tmp, dir);
  return dir;
}

function runTests(chrome) {
  const env = { ...process.env, ICE_CHROME: chrome };
  const out = [];
  let ok = 0, fail = 0;
  for (const t of ['test/smoke.mjs', 'test/gimages.mjs']) {
    let last = '';
    for (let attempt = 1; attempt <= 2; attempt++) { // vanjske stranice su ponekad nestabilne
      log(`test ${t} (pokušaj ${attempt})...`);
      const r = spawnSync(process.execPath, [t], { cwd: ICE, env, encoding: 'utf8', timeout: 8 * 60 * 1000 });
      last = `${r.stdout || ''}${r.stderr || ''}`;
      if (r.status === 0) break;
    }
    ok += (last.match(/^OK /gm) || []).length;
    fail += (last.match(/^FAIL/gm) || []).length;
    out.push(...last.split('\n').filter((l) => l.startsWith('FAIL')));
  }
  return { ok, fail, pass: ok > 0 && fail === 0, failures: out };
}

async function check() {
  const state = readState();
  const cur = installed();
  const rel = await latestRelease();
  let chrome = null;
  try { chrome = (await getJson('https://chromiumdash.appspot.com/fetch_releases?channel=Stable&platform=Linux&num=1'))[0]?.version; } catch { /* nije bitno */ }
  log(`Ice motor:     ${cur || 'nije instaliran'}`);
  log(`Najnoviji:     ${rel.version} (${rel.date.slice(0, 10)})`);
  if (chrome) log(`Google Chrome: ${chrome}`);

  const forced = args.includes('--target');
  if (cur && cmp(rel.version, cur) <= 0 && !forced) {
    log('Ice je na najnovijem motoru.');
    writeState({ ...state, lastCheck: new Date().toISOString(), current: cur, latest: rel.version, chrome, status: 'up-to-date' });
    if (!opt('--quiet')) notify('Ice čuvar', `Motor je ažuran (${cur}).`);
    return;
  }
  const dir = await download(rel);
  const t = runTests(path.join(dir, 'chrome'));
  log(`Testovi: ${t.ok} OK, ${t.fail} FAIL`);
  if (!t.pass) {
    log(t.failures.join('\n'));
    writeState({ ...state, lastCheck: new Date().toISOString(), status: 'tests-failed', candidate: rel.version, tests: t });
    notify('Ice čuvar: testovi pali', `${rel.version}: ${t.fail} testova nije prošlo. Update NIJE uključen.`, true);
    process.exitCode = 1;
    return;
  }
  if (forced && cur && cmp(rel.version, cur) <= 0) {
    log(`Testni prolaz za ${rel.version} uspješan (nije noviji, pa se ne nudi).`);
    if (rel.version !== cur) fs.rmSync(dir, { recursive: true, force: true });
    return;
  }
  writeState({ ...state, lastCheck: new Date().toISOString(), status: 'ready', current: cur, candidate: rel.version, chrome, tests: { ok: t.ok, fail: 0 } });
  log(`SPREMNO: ${rel.version}, svi testovi prošli. Uključi sa: npm run guardian -- --apply`);
  notify('Ice: update motora spreman', `${rel.version} je testiran. Uključi: npm run guardian -- --apply`);
}

function switchTo(version) {
  const tmp = `${CURRENT}.new`;
  fs.rmSync(tmp, { force: true });
  fs.symlinkSync(version, tmp);
  fs.renameSync(tmp, CURRENT); // atomična zamjena
}

function apply() {
  const s = readState();
  const cur = installed();
  if (s.status !== 'ready' || !s.candidate) { log('Nema testiranog updatea. Prvo: npm run guardian'); process.exitCode = 1; return; }
  if (cur && cmp(s.candidate, cur) <= 0) { log(`${s.candidate} nije noviji od ${cur}; ne vraćam unazad.`); process.exitCode = 1; return; }
  switchTo(s.candidate);
  // Čuvaj samo trenutnu i prethodnu verziju
  for (const v of fs.readdirSync(BASE)) if (![s.candidate, cur, 'current'].includes(v) && !v.startsWith('.')) fs.rmSync(path.join(BASE, v), { recursive: true, force: true });
  writeState({ ...s, status: 'applied', previous: cur, current: s.candidate, appliedAt: new Date().toISOString() });
  log(`Ice sada koristi ${s.candidate} (od sljedećeg pokretanja). Povratak: npm run guardian -- --rollback`);
}

function rollback() {
  const s = readState();
  if (!s.previous || !fs.existsSync(path.join(BASE, s.previous, 'chrome'))) { log('Nema prethodne verzije za povratak.'); process.exitCode = 1; return; }
  const cur = installed();
  switchTo(s.previous);
  writeState({ ...s, status: 'rolled-back', current: s.previous, previous: cur });
  log(`Vraćeno na ${s.previous}.`);
}

async function install() {
  if (installed()) { log(`Motor je već instaliran (${installed()}). Za update: npm run guardian`); return; }
  const rel = await latestRelease();
  await download(rel);
  fs.mkdirSync(BASE, { recursive: true });
  switchTo(rel.version);
  writeState({ ...readState(), status: 'installed', current: rel.version, installedAt: new Date().toISOString() });
  log(`Instaliran ${rel.version}.`);
}

try {
  if (opt('--apply')) apply();
  else if (opt('--rollback')) rollback();
  else if (opt('--install')) await install();
  else await check();
} catch (e) {
  log('Greška:', e.message);
  notify('Ice čuvar: greška', e.message, true);
  process.exitCode = 1;
}
