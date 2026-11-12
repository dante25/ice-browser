// Ice: balon ispod ikone ode izvan ekrana; ako se stranica ipak otvori kao balon, prebacuje se u prozor
try { if (!new URLSearchParams(location.search).get('tab') && chrome.extension.getViews({ type: 'popup' }).includes(window)) { chrome.runtime.sendMessage({ t: 'ice:action-window' }); window.close(); } } catch (e) {}
const list = document.getElementById('list');
const empty = document.getElementById('empty');
let tab;
let key;

const sq = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

// Optional local helper (helper/video-sniffer-helper.py) that runs yt-dlp; null when it is not running
// or yt-dlp is missing, in which case only the copy-command buttons are shown.
const HELPER = 'http://127.0.0.1:47655';
let helper = null;

async function helperCall(path, body) {
  const r = await fetch(HELPER + path, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {});
  return r.json();
}

function fileName(it) {
  try {
    const last = decodeURIComponent(new URL(it.url).pathname.split('/').filter(Boolean).pop() || '');
    return last || new URL(it.url).hostname;
  } catch {
    return it.url;
  }
}

const MIME_EXT = { mp4: 'mp4', webm: 'webm', quicktime: 'mov', 'x-matroska': 'mkv', mpeg: 'mp3', ogg: 'ogg', 'x-flv': 'flv', 'x-m4a': 'm4a', 'mp4a-latm': 'm4a' };

function safeName(s) {
  return (s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120);
}

function extOf(it) {
  try {
    const m = new URL(it.url).pathname.match(/\.([a-z0-9]{2,4})$/i);
    if (m) return m[1].toLowerCase();
  } catch {}
  return MIME_EXT[(it.type || '').split('/')[1]] || 'mp4';
}

// Saved name: the tab title as it is right now, else the video's own file name.
function baseName(it) {
  return safeName(tab.title || it.title) || safeName(fileName(it).replace(/\.[^.]+$/, '')) || 'video';
}

// Direct files often carry their quality in the URL (".../video_720p.mp4").
function guessQuality(url) {
  const m = url.match(/[\/_.\-=](2160|1440|1080|720|576|480|360|240|144)p?(?=[\/_.\-?&]|$)/);
  return m ? `${m[1]}p` : '';
}

function fmtSize(n) {
  if (!n) return '';
  return n > 1e9 ? (n / 1e9).toFixed(2) + ' GB' : n > 1e6 ? (n / 1e6).toFixed(1) + ' MB' : Math.round(n / 1e3) + ' KB';
}

function btn(label, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  b.addEventListener('click', () => onClick(b));
  return b;
}

async function copy(b, text) {
  await navigator.clipboard.writeText(text);
  const old = b.textContent;
  b.textContent = 'Copied';
  setTimeout(() => (b.textContent = old), 1000);
}

function openStream(it, url = it.url) {
  const q = new URLSearchParams({ url, page: it.page || '', name: baseName(it) });
  chrome.tabs.create({ url: chrome.runtime.getURL('downloader.html') + '?' + q });
}

// Many CDNs refuse the bare request chrome.downloads sends (no Origin/Referer), so files are fetched
// by an extension page that presents itself as the site; it then hands the data to the downloads API.
function openFile(it) {
  const q = new URLSearchParams({ url: it.url, page: it.page || '', name: baseName(it), ext: extOf(it), mode: 'file' });
  chrome.tabs.create({ url: chrome.runtime.getURL('downloader.html') + '?' + q });
}

function parseDash(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const byHeight = new Map();
  for (const r of doc.querySelectorAll('Representation')) {
    const set = r.parentElement;
    const mime = r.getAttribute('mimeType') || set.getAttribute('mimeType') || set.getAttribute('contentType') || '';
    if (!mime.includes('video')) continue;
    const height = Number(r.getAttribute('height')) || 0;
    const bandwidth = Number(r.getAttribute('bandwidth')) || 0;
    if (!byHeight.has(height) || byHeight.get(height).bandwidth < bandwidth) byHeight.set(height, { height, bandwidth });
  }
  return [...byHeight.values()].sort((a, b) => b.height - a.height);
}

// Qualities of an HLS master playlist / DASH manifest. Fetched once per URL; null if unreadable.
const variantCache = new Map();
function loadVariants(it) {
  if (!variantCache.has(it.url)) {
    variantCache.set(
      it.url,
      fetch(it.url)
        .then((r) => (r.ok ? r.text() : Promise.reject()))
        .then((text) => (it.kind === 'hls' ? (text.includes('#EXT-X-STREAM-INF') ? parseMaster(text, it.url) : []) : parseDash(text)))
        .catch(() => null)
    );
  }
  return variantCache.get(it.url);
}

function variantRow(label, buttons) {
  const row = document.createElement('div');
  row.className = 'variant';
  const span = document.createElement('span');
  span.textContent = label;
  const acts = document.createElement('div');
  acts.className = 'actions';
  acts.append(...buttons);
  row.append(span, acts);
  return row;
}

async function fillVariants(it, box) {
  let vs = await loadVariants(it);
  if (vs && it.kind === 'hls') {
    // Several bitrates of the same resolution only add clutter: keep the best of each.
    const best = new Map();
    for (const v of vs) if (!best.has(v.height) || !v.height || best.get(v.height).bandwidth < v.bandwidth) best.set(v.height || Symbol(), v);
    vs = [...best.values()];
  }
  const note = (t) => {
    const n = document.createElement('div');
    n.className = 'note';
    n.textContent = t;
    box.append(n);
  };
  if (vs === null) return note('Qualities could not be read here; "Download stream" will try again.');
  if (!vs.length) return note('Single quality.');
  const ref = it.page ? ` --referer ${sq(it.page)}` : '';
  for (const v of vs) {
    if (it.kind === 'hls') {
      box.append(
        variantRow(variantLabel(v), [
          btn('Download', () => openStream(it, v.url)),
          btn('Copy URL', (b) => copy(b, v.url)),
        ])
      );
    } else {
      const sel = v.height ? ` -f ${sq(`bv*[height<=${v.height}]+ba/b[height<=${v.height}]`)}` : '';
      box.append(variantRow(variantLabel(v), [btn('yt-dlp', (b) => copy(b, `yt-dlp${ref}${sel} ${sq(it.url)}`))]));
    }
  }
  if (it.kind === 'hls' && vs.some((v) => v.audio)) note('Audio may be a separate track in this stream; use yt-dlp for a merged file.');
}

// Main detections: seen by the network or tied to the page's main video/player. Everything else
// (API replies, thumbnails, previews, UI sounds) goes under "other" instead of being dropped.
const STRONG = new Set(['network', 'video element', 'player attribute', 'page script', 'meta tag']);
const NOISE = /preview|thumb|sprite|poster|teaser|hover|sound|beep|notification|no_input|failure|success|click/i;

function isMain(it) {
  if (NOISE.test(fileName(it))) return false;
  if (!it.sources.some((s) => STRONG.has(s))) return false;
  const networkOnly = it.sources.length === 1 && it.sources[0] === 'network';
  if (networkOnly && it.kind === 'file' && it.type.startsWith('audio/')) return false;
  return true;
}

let showOther = false;

// Which downloaded file is the one on screen? Players like TikTok's feed fetch several clips (the
// next ones ahead of time) and play them through blob: URLs, so the page only tells us the playing
// video's duration. The duration is read from each mp4's header ('mvhd') and the closest one wins.
const MATCH_TOLERANCE = 0.5;
const durations = new Map();
let playingDuration = null;

function mvhdDuration(b) {
  for (let i = 4; i < b.length - 36; i++) {
    if (b[i] === 0x6d && b[i + 1] === 0x76 && b[i + 2] === 0x68 && b[i + 3] === 0x64) {
      const dv = new DataView(b.buffer, b.byteOffset + i + 4);
      const v1 = dv.getUint8(0) === 1;
      const timescale = dv.getUint32(v1 ? 20 : 12);
      const duration = v1 ? Number(dv.getBigUint64(24)) : dv.getUint32(16);
      return timescale ? duration / timescale : null;
    }
  }
  return null;
}

async function readUpTo(url, range, limit) {
  const r = await fetch(url, { headers: { Range: range } });
  if (!r.ok) return new Uint8Array();
  const reader = r.body.getReader();
  const chunks = [];
  let got = 0;
  while (got < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
  }
  reader.cancel();
  const out = new Uint8Array(got);
  let at = 0;
  for (const c of chunks) {
    out.set(c, at);
    at += c.length;
  }
  return out;
}

async function fileDuration(it) {
  try {
    for (const range of ['bytes=0-262143', 'bytes=-262144']) {
      const d = mvhdDuration(await readUpTo(it.url, range, 262144));
      if (d) return d;
    }
  } catch {}
  return null;
}

function probeDurations(items) {
  for (const it of items) {
    if (it.kind !== 'file' || durations.has(it.url)) continue;
    durations.set(it.url, null);
    fileDuration(it).then((d) => {
      if (d == null) return;
      durations.set(it.url, d);
      render();
    });
  }
}

function playingItem(items) {
  if (playingDuration == null) return null;
  let best = null;
  let bestDiff = MATCH_TOLERANCE;
  for (const it of items) {
    const d = durations.get(it.url);
    if (d == null) continue;
    const diff = Math.abs(d - playingDuration);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = it;
    }
  }
  return best;
}

// The downloader and this popup both rewrite Referer/Origin for the extension's own requests; the
// popup's rule is removed again when it closes.
async function setReferer() {
  if (!tab.url?.startsWith('http')) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [2],
    addRules: [
      {
        id: 2,
        priority: 2,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: tab.url },
            { header: 'Origin', operation: 'set', value: new URL(tab.url).origin },
          ],
        },
        condition: { resourceTypes: ['xmlhttprequest'], initiatorDomains: [chrome.runtime.id] },
      },
    ],
  });
  addEventListener('pagehide', () => chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [2] }));
}

function runBtn(getBody) {
  return btn('▶ Save', async (b) => {
    b.textContent = 'Sending…';
    try {
      const j = await helperCall('/download', getBody());
      b.textContent = j.ok ? 'Started' : j.error || 'Failed';
    } catch {
      b.textContent = 'Helper offline';
    }
    setTimeout(() => (b.textContent = '▶ Save'), 2500);
    pollJobs();
  });
}

let jobsTimer = 0;
async function pollJobs() {
  clearTimeout(jobsTimer);
  if (!helper) return;
  let jobs;
  try {
    jobs = (await helperCall('/jobs')).jobs;
  } catch {
    return;
  }
  const recent = jobs.filter((j) => Date.now() / 1000 - j.started < 600).slice(0, 4);
  document.getElementById('jobs').replaceChildren(
    ...recent.map((j) => {
      const d = document.createElement('div');
      d.className = 'job';
      d.textContent = `${j.status === 'running' ? `${Math.round(j.progress)}%` : j.status} · ${j.file || j.url}`;
      return d;
    })
  );
  if (recent.some((j) => j.status === 'running')) jobsTimer = setTimeout(pollJobs, 1500);
}

function youtubeId(url) {
  try {
    const u = new URL(url);
    return u.searchParams.get('v') || u.pathname.match(/^\/shorts\/([\w-]+)/)?.[1] || null;
  } catch {
    return null;
  }
}

// Direct YouTube download: the downloader page fetches the video (and audio) mp4 and merges them.
function openMerge(info, video, audio, quality) {
  const title = safeName((tab.title || '').replace(/ - YouTube$/, '')) || info.id;
  const q = new URLSearchParams({
    v: video.url,
    vs: video.size || '',
    a: audio?.url || '',
    as: audio?.size || '',
    page: tab.url,
    name: `${title} [${quality}]`,
    mode: 'merge',
  });
  chrome.tabs.create({ url: chrome.runtime.getURL('downloader.html') + '?' + q });
}

// The card lists what the player offers (read from its own data), a Download button where a direct
// mp4 stream exists, and a yt-dlp command for every quality.
function ytCard(info) {
  const el = document.createElement('div');
  el.className = 'item';
  const top = document.createElement('div');
  top.className = 'top';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = 'youtube';
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = info.title || info.id;
  top.append(badge, name);

  const meta = document.createElement('div');
  meta.className = 'meta';
  // The diagnostic part shows what the extension found, so a screenshot is enough to see what is missing.
  const s0 = info.streams;
  const version = chrome.runtime.getManifest?.().version || '?';
  meta.textContent = s0
    ? `v${version} · direct streams: ${s0.video.length} video, ${s0.muxed.length} muxed, audio ${s0.audio ? 'ok' : 'MISSING'} · Download saves video + audio as one mp4. Other qualities: yt-dlp.`
    : `v${version} · no direct streams found yet (reload the page and reopen this popup). yt-dlp works for any quality.`;

  const box = document.createElement('div');
  box.className = 'variants';
  const best = new Map();
  for (const f of info.formats) {
    const k = `${f.label}|${f.fps}`;
    if (!best.has(k) || best.get(k).bitrate < f.bitrate) best.set(k, f);
  }
  const rows = [...best.values()].sort((a, b) => b.height - a.height || b.fps - a.fps || b.bitrate - a.bitrate);
  for (const f of rows) {
    const premium = /premium/i.test(f.label);
    const sel = f.height
      ? `bv*[height=${f.height}]${premium ? '[format_note*=Premium]' : ''}+ba/b[height=${f.height}]`
      : `${f.itag}+ba`;
    const cookies = premium ? ' --cookies-from-browser chrome' : '';
    const label = [f.label, f.codec].filter(Boolean).join(' · ');
    const buttons = [];
    // Direct download exists only for the mp4 streams the page could fetch (not Premium / VP9 / 4K).
    const s = info.streams;
    const stream = !premium && s && (s.video.find((x) => x.height === f.height && x.fps === f.fps) || s.video.find((x) => x.height === f.height));
    const muxed = !premium && s && s.muxed.find((x) => x.height === f.height);
    if (stream && s.audio) buttons.push(btn('Download', () => openMerge(info, stream, s.audio, f.label)));
    else if (muxed) buttons.push(btn('Download', () => openMerge(info, muxed, null, f.label)));
    buttons.push(btn('yt-dlp', (b) => copy(b, `yt-dlp${cookies} -f ${sq(sel)} ${sq(tab.url)}`)));
    if (helper) buttons.push(runBtn(() => ({ url: tab.url, format: sel, cookies: premium })));
    box.append(variantRow(label, buttons));
  }
  if (!rows.length) box.append(variantRow('No qualities reported by the player', []));
  el.append(top, meta, box);
  return el;
}

function row(it, playing = false) {
  const el = document.createElement('div');
  el.className = 'item';

  const top = document.createElement('div');
  top.className = 'top';
  const badge = document.createElement('span');
  badge.className = 'badge';
  badge.textContent = it.kind;
  const name = document.createElement('span');
  name.className = 'name';
  name.textContent = fileName(it);
  name.title = it.url;
  top.append(badge, name);

  const meta = document.createElement('div');
  meta.className = 'meta';
  const quality = it.kind === 'file' ? guessQuality(it.url) : '';
  meta.textContent = [playing ? '▶ playing now' : '', quality, fmtSize(it.size), it.type, it.sources.join(', ')]
    .filter(Boolean)
    .join(' · ');

  const actions = document.createElement('div');
  actions.className = 'actions';
  if (it.kind === 'file') {
    actions.append(btn('Download', () => openFile(it)));
  } else if (it.kind === 'hls') {
    actions.append(btn('Download stream', () => openStream(it)));
  }
  actions.append(btn('Copy URL', (b) => copy(b, it.url)));
  const ref = it.page ? ` --referer ${sq(it.page)}` : '';
  actions.append(btn('yt-dlp', (b) => copy(b, `yt-dlp${ref} ${sq(it.url)}`)));
  if (helper) actions.append(runBtn(() => ({ url: it.url, referer: it.page })));

  el.append(top, meta, actions);

  if (it.kind === 'hls' || it.kind === 'dash') {
    const box = document.createElement('div');
    box.className = 'variants';
    el.append(box);
    fillVariants(it, box);
  }
  return el;
}

async function render() {
  const items = ((await chrome.storage.session.get(key))[key] || []).slice().reverse();
  const mainKey = `main:${tab.id}`;
  playingDuration = (await chrome.storage.session.get(mainKey))[mainKey]?.duration ?? null;
  probeDurations(items);
  // The file matching the playing video's duration is the main one; otherwise fall back to the filters.
  const playing = playingItem(items);
  const main = playing ? [playing] : items.filter(isMain);
  const other = items.filter((it) => !main.includes(it));
  const ytKey = `yt:${tab.id}`;
  const yt = (await chrome.storage.session.get(ytKey))[ytKey];
  const ytInfo = yt && yt.id === youtubeId(tab.url) ? yt : null;
  const nodes = main.map((it) => row(it, it === playing));
  if (ytInfo) nodes.unshift(ytCard(ytInfo));
  if (other.length) {
    const toggle = btn(showOther ? 'Hide other detections' : `Show ${other.length} other detections`, () => {
      showOther = !showOther;
      render();
    });
    const wrap = document.createElement('div');
    wrap.className = 'item';
    wrap.append(toggle);
    nodes.push(wrap);
    if (showOther) nodes.push(...other.map((it) => row(it)));
  }
  list.replaceChildren(...nodes);
  empty.hidden = items.length > 0 || !!ytInfo;
}

(async () => {
  const wanted = Number(new URLSearchParams(location.search).get('tab')); // otvoreno kao prozor: tab se predaje u adresi
  tab = wanted ? await chrome.tabs.get(wanted) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0];
  key = `tab:${tab.id}`;
  document.getElementById('tabtitle').textContent = tab.title || tab.url;
  await setReferer().catch(() => {});
  const ping = await helperCall('/ping').catch(() => null);
  const helperLine = document.getElementById('helper');
  if (ping?.ok && ping.ytdlp) {
    helper = ping;
    helperLine.textContent = `yt-dlp ${ping.ytdlp} ready · saves to ${ping.output_dir}`;
    document.getElementById('ytpage').after(runBtn(() => ({ url: tab.url })));
    pollJobs();
  } else if (ping?.ok) {
    helperLine.textContent = 'Helper is running, but yt-dlp is not installed.';
  }
  render();
  const probeBox = document.getElementById('probe');
  chrome.storage.local.get({ probe: true }).then((o) => (probeBox.checked = o.probe));
  probeBox.addEventListener('change', () => chrome.storage.local.set({ probe: probeBox.checked }));
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'session' && (c[key] || c[`main:${tab.id}`] || c[`yt:${tab.id}`])) render();
  });
  document.getElementById('clear').addEventListener('click', async () => {
    await chrome.storage.session.remove(key);
    chrome.action.setBadgeText({ tabId: tab.id, text: '' });
    render();
  });
  document.getElementById('ytpage').addEventListener('click', (e) => copy(e.target, `yt-dlp ${sq(tab.url)}`));
  document.getElementById('ytformats').addEventListener('click', (e) => copy(e.target, `yt-dlp -F ${sq(tab.url)}`));
})();
