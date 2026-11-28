const $ = id => document.getElementById(id);
let state = { jobs: [], block: {}, settings: {}, folder: { name: '', permission: 'none' } };
const sw = msg => new Promise(r => chrome.runtime.sendMessage(msg, r));
const fmtB = n => n > 1073741824 ? (n / 1073741824).toFixed(2) + ' GB' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : n > 1024 ? Math.round(n / 1024) + ' KB' : n + ' B';
const fmtT = ms => { const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60); return (h ? h + ':' + String(m).padStart(2, '0') : m) + ':' + String(s % 60).padStart(2, '0'); };
const LABEL = { scanning: 'Scanning', downloading: 'Downloading', paused: 'Paused', cooling: 'Cooling down', done: 'Done', error: 'Error', canceled: 'Canceled', interrupted: 'Interrupted' };
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

async function fs() { return import(chrome.runtime.getURL('background/fsstore.js')); }
async function chooseFolder() {
  try {
    const h = await showDirectoryPicker({ id: 'usn', mode: 'readwrite', startIn: 'downloads' });
    const m = await fs();
    await m.setRoot(h);
    await m.permission(h, true);
    await sw({ t: 'folder:changed' }); refresh();
  } catch (e) { if (e && e.name !== 'AbortError') alert('Could not open the folder picker: ' + e.message); }
}
async function allowFolder() {
  const m = await fs(), h = await m.getRoot();
  if (h) await m.permission(h, true);
  await sw({ t: 'folder:changed' }); refresh();
}

function retryBtn(j) {
  if (j.status === 'interrupted' || j.status === 'canceled') return '<button class="primary" data-a="retry">Resume' + (j.canResume ? ' where it stopped' : '') + '</button>';
  if (j.status === 'error') return '<button class="primary" data-a="retry">Retry' + (j.canResume ? ' from where it stopped' : '') + '</button>';
  if (j.failed && j.failedKept) return '<button class="primary" data-a="retry">Retry ' + j.failed + ' failed</button>';
  return '';
}

function render() {
  const now = Date.now();
  const t = state.totals || { bytes: 0 };
  $('totals').textContent = 'Total downloaded: ' + Object.keys(SITES).filter(k => t[k]).map(k => SITES[k].name + ' ' + t[k]).join(' · ') + (Object.keys(SITES).some(k => t[k]) ? ' · ' : '') + fmtB(t.bytes || 0);
  const f = state.folder || {};
  $('folderBtn').textContent = f.set ? '📁 ' + (f.name || 'Folder') : '📁 Choose folder';
  const ban = $('folderBan');
  if (!f.set) { ban.hidden = false; ban.innerHTML = '<span><b>Choose where to save the files.</b> The extension writes straight into that folder, so nothing shows up in Chrome\'s download list.</span><button id="fb_choose" class="primary">Choose folder…</button>'; }
  else if (f.permission !== 'granted') { ban.hidden = false; ban.innerHTML = '<span>Chrome needs your OK to write into <b>' + esc(f.name) + '</b> again.</span><button id="fb_allow" class="primary">Allow</button>'; }
  else ban.hidden = true;
  $('banners').innerHTML = Object.keys(SITES).filter(s => (state.block[s] || {}).until > now).map(s =>
    `<div class="ban"><span><b>${SITES[s].name}</b> asked us to slow down. Scanning resumes in ${fmtT(state.block[s].until - now)}. Files already found keep downloading.${state.block[s].reason ? ' <i class="muted">(' + esc(state.block[s].reason) + ')</i>' : ''}</span><button data-clr="${s}">Resume now (risky)</button></div>`).join('');
  $('empty').hidden = state.jobs.length > 0;
  $('jobs').innerHTML = state.jobs.map(j => {
    const end = j.endedAt || now, active = !['done', 'error', 'canceled', 'interrupted'].includes(j.status);
    const pct = j.found ? Math.min(100, Math.round((j.downloaded + j.failed) / j.found * 100)) : 0;
    const scanning = j.status === 'scanning' || j.status === 'cooling';
    const parts = Object.entries(j.parts || {}).map(([k, v]) => `${k} ${v}`).join(' · ');
    return `<div class="job" data-id="${j.id}">
      <div class="top"><span class="badge ${j.site}">${(SITES[j.site] || {}).badge || '?'}</span><div class="title" title="${esc(j.url || '')}">${esc(j.label)}</div><span class="chip ${j.status}">${LABEL[j.status] || j.status}${scanning && j.phase ? ' · ' + esc(j.phase) : ''}</span></div>
      <div class="bar ${scanning && !j.found ? 'scan' : ''}"><i style="width:${scanning && !j.found ? 100 : pct}%"></i></div>
      <div class="stats"><span>Scanned <b>${j.scanned}</b>${j.total && j.scanned < j.total ? ' / ' + j.total : ''}</span><span>Found <b>${j.found}</b></span><span>Downloaded <b>${j.downloaded}</b> / ${j.found}</span>${j.skipped ? `<span title="The same media showed up twice in this download">Duplicates <b>${j.skipped}</b></span>` : ''}${j.failed ? `<span style="color:var(--err)">Failed <b>${j.failed}</b></span>` : ''}<span>${fmtB(j.bytes)}</span><span>⏱ <b>${fmtT(end - j.startedAt)}</b></span></div>
      ${parts ? `<div class="muted" style="font-size:11px;margin-top:4px">${esc(parts)}</div>` : ''}
      ${j.note ? `<div class="note">${esc(j.note)}</div>` : ''}${j.warn ? `<div class="note">${esc(j.warn)}</div>` : ''}${j.error ? `<div class="err">${esc(j.error)}</div>` : ''}${j.failed && j.failWhy && j.failWhy.length ? `<div class="err">Why files failed: ${j.failWhy.map(esc).join(' · ')}</div>` : ''}
      <div class="acts">${active ? (j.paused ? '<button data-a="resume">Resume</button>' : '<button data-a="pause">Pause</button>') + '<button data-a="cancel">Cancel</button>' : retryBtn(j)}<button data-a="remove">Remove</button></div>
    </div>`;
  }).join('');
}

async function refresh() { state = await sw({ t: 'state' }); fillSettings(false); render(); }
chrome.runtime.onMessage.addListener(m => { if (m && m.t === 'state:update') { state = m; render(); } });
setInterval(render, 1000);
document.addEventListener('click', async e => {
  const b = e.target.closest('button'); if (!b) return;
  if (b.id === 'fb_choose' || b.id === 'folderBtn') return chooseFolder();
  if (b.id === 'fb_allow') return allowFolder();
  if (b.dataset.ihdel !== undefined) { const r = await sw({ t: 'ih:custom:del', id: b.dataset.ihdel }); ihcRender(r && r.rules || []); return refresh(); }
  if (b.dataset.clr) { await sw({ t: 'block:clear', site: b.dataset.clr }); return refresh(); }
  if (b.dataset.a) { const id = Number(b.closest('.job').dataset.id); await sw({ t: 'job:' + b.dataset.a, jobId: id }); return refresh(); }
});
$('clear').onclick = async () => { await sw({ t: 'jobs:clear' }); refresh(); };
$('gear').onclick = () => { $('settings').hidden = !$('settings').hidden; fillSettings(true); ihcLoad(); };
// ---- custom host rules (Image Host Grabber)
function ihcRender(rules) {
  $('ihc_count').textContent = rules.length ? '(' + rules.length + ')' : '';
  const box = $('ihc_list'); box.textContent = '';
  for (const x of rules) {
    const d = document.createElement('div'), n = document.createElement('b'), c = document.createElement('code'), del = document.createElement('button');
    d.className = 'ihr'; n.textContent = x.id; c.textContent = x.url; c.title = x.sp; del.textContent = 'Remove'; del.dataset.ihdel = x.id;
    d.append(n, c, del); box.append(d);
  }
}
async function ihcLoad() { const r = await sw({ t: 'ih:custom:list' }); ihcRender(r && r.rules || []); }
$('ihc_add').onclick = async () => {
  const r = await sw({ t: 'ih:custom:add', rule: { id: $('ihc_id').value, url: $('ihc_url').value, sp: $('ihc_sp').value, test: $('ihc_test').value } });
  if (!r || r.error) { $('ihc_msg').textContent = (r && r.error) || 'Could not add the rule.'; return; }
  $('ihc_msg').textContent = 'Rule added.'; ['ihc_id', 'ihc_url', 'ihc_sp', 'ihc_test'].forEach(id => { $(id).value = ''; });
  ihcRender(r.rules); refresh();
};
let filled = false;
function fillSettings(force) {
  if (filled && !force) return;
  const s = state.settings || {}; if (!s.speed) return; filled = true;
  $('s_ihmin').value = s.ihMinKB === undefined ? 20 : s.ihMinKB; $('ih_count').textContent = (state.ihCount || 0) + ' hosts';
  $('s_speed').value = s.speed; $('s_folder').value = s.subfolder; $('s_cool').value = s.cooldownMin || 35; $('s_tpl').value = s.template; $('s_layout').value = s.layout;
}
$('ih_import').onclick = () => $('ih_file').click();
$('ih_file').onchange = async () => {
  const f = $('ih_file').files[0]; if (!f) return;
  const r = await sw({ t: 'ih:import', text: await f.text() });
  $('ih_count').textContent = r && r.count ? r.count + ' hosts imported' : (r && r.error) || 'import failed'; $('ih_file').value = '';
};
$('s_save').onclick = async () => {
  await sw({ t: 'settings:set', settings: { ihMinKB: Number($('s_ihmin').value) || 0, speed: $('s_speed').value, subfolder: $('s_folder').value || '', cooldownMin: Number($('s_cool').value) || 35, template: $('s_tpl').value, layout: $('s_layout').value } });
  $('settings').hidden = true; refresh();
};
refresh();
