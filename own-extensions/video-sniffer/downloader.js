// Downloads an HLS stream: fetches segments, decrypts AES-128, writes to disk.
const CONCURRENCY = 6;

const params = new URLSearchParams(location.search);
const srcUrl = params.get('url');
const page = params.get('page');
const baseName = (params.get('name') || 'video').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100);
const mode = params.get('mode');
const fileExt = params.get('ext') || 'mp4';

const $ = (id) => document.getElementById(id);
const status = (t) => ($('status').textContent = t);
$('url').textContent = srcUrl;

let segments = [];
let initSegment = null;
let abort = new AbortController();

// Many CDNs check Referer/Origin; extension fetches can't set them, so rewrite them for our own requests.
async function setReferer() {
  if (!page) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [1],
    addRules: [
      {
        id: 1,
        priority: 1,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: page },
            { header: 'Origin', operation: 'set', value: new URL(page).origin },
          ],
        },
        condition: { resourceTypes: ['xmlhttprequest', 'other'], initiatorDomains: [chrome.runtime.id] },
      },
    ],
  });
}

async function get(url, type = 'text') {
  const r = await fetch(url, { credentials: 'include', signal: abort.signal });
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`);
  return type === 'text' ? r.text() : r.arrayBuffer();
}

function parseMedia(text, base) {
  const lines = text.split(/\r?\n/);
  let seq = 0;
  let key = null;
  let map = null;
  const segs = [];
  let live = true;
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-MEDIA-SEQUENCE')) seq = Number(l.split(':')[1]) || 0;
    else if (l.startsWith('#EXT-X-KEY')) {
      const a = attrs(l);
      key = a.METHOD === 'NONE' ? null : { method: a.METHOD, uri: a.URI && abs(a.URI, base), iv: a.IV };
    } else if (l.startsWith('#EXT-X-MAP')) map = abs(attrs(l).URI, base);
    else if (l.startsWith('#EXT-X-ENDLIST')) live = false;
    else if (l.startsWith('#EXTINF')) {
      const uri = lines.slice(i + 1).find((x) => x && !x.startsWith('#'));
      segs.push({ url: abs(uri, base), seq: seq + segs.length, key });
    }
  }
  return { segs, map, live };
}

function ivBytes(seg) {
  const iv = new Uint8Array(16);
  if (seg.key.iv) {
    const hex = seg.key.iv.replace(/^0x/i, '').padStart(32, '0');
    for (let i = 0; i < 16; i++) iv[i] = parseInt(hex.substr(i * 2, 2), 16);
  } else {
    new DataView(iv.buffer).setUint32(12, seg.seq);
  }
  return iv;
}

const keyCache = new Map();
async function decrypt(buf, seg) {
  if (!seg.key) return buf;
  if (seg.key.method !== 'AES-128') throw new Error(`Unsupported encryption: ${seg.key.method}`);
  if (!keyCache.has(seg.key.uri)) {
    keyCache.set(
      seg.key.uri,
      get(seg.key.uri, 'buffer').then((raw) => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt']))
    );
  }
  return crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes(seg) }, await keyCache.get(seg.key.uri), buf);
}

async function loadMedia(url) {
  $('variants').replaceChildren();
  const text = await get(url);
  const { segs, map, live } = parseMedia(text, url);
  if (!segs.length) throw new Error('No segments found in playlist');
  segments = segs;
  initSegment = map;
  status(`${segs.length} segments${live ? ' (live stream: downloads what is available now)' : ''}. Ready.`);
  $('controls').hidden = false;
}

async function init() {
  await setReferer();
  const text = await get(srcUrl);
  if (!text.includes('#EXT-X-STREAM-INF')) return loadMedia(srcUrl);

  // Master playlist: every quality is offered, best first.
  const variants = parseMaster(text, srcUrl);
  if (!variants.length) throw new Error('No qualities found in playlist');
  if (variants.length === 1) return loadMedia(variants[0].url);

  status('Pick a quality:');
  for (const v of variants) {
    const b = document.createElement('button');
    b.textContent = variantLabel(v);
    b.addEventListener('click', () => loadMedia(v.url).catch((e) => status(e.message)));
    $('variants').append(b);
  }
  if (variants.some((v) => v.audio)) status('Pick a quality (this stream may keep audio in a separate track; use the yt-dlp button in the popup if the result has no sound):');
}

async function openSink() {
  const ext = initSegment ? 'mp4' : 'ts';
  if (window.showSaveFilePicker) {
    const handle = await showSaveFilePicker({ suggestedName: `${baseName}.${ext}` });
    const w = await handle.createWritable();
    return { write: (b) => w.write(b), close: () => w.close() };
  }
  const parts = [];
  return {
    write: (b) => parts.push(b),
    close: () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob(parts));
      a.download = `${baseName}.${ext}`;
      a.click();
    },
  };
}

async function start() {
  let sink;
  try {
    sink = await openSink();
  } catch (e) {
    // Closing the save dialog is not an error.
    if (e.name !== 'AbortError') status(`Error: ${e.message}`);
    return;
  }
  abort = new AbortController();
  $('start').disabled = true;
  $('cancel').hidden = false;
  $('bar').hidden = false;
  $('bar').max = segments.length;
  try {
    if (initSegment) await sink.write(await get(initSegment, 'buffer'));
    for (let i = 0; i < segments.length; i += CONCURRENCY) {
      const chunk = segments.slice(i, i + CONCURRENCY);
      const bufs = await Promise.all(chunk.map(async (s) => decrypt(await get(s.url, 'buffer'), s)));
      for (const b of bufs) await sink.write(b);
      $('bar').value = Math.min(i + CONCURRENCY, segments.length);
      status(`Downloading ${$('bar').value} / ${segments.length}`);
    }
    await sink.close();
    status('Done.');
  } catch (e) {
    await sink.close().catch(() => {});
    status(e.name === 'AbortError' ? 'Cancelled (partial file saved).' : `Error: ${e.message}`);
  }
  $('start').disabled = false;
  $('cancel').hidden = true;
}

// Single file (mp4, webm...): fetched here with the page's Referer/Origin (the browser's own downloads
// can't send them), written straight to a temporary file on disk (origin private file system: no size
// limit, nothing held in memory), then saved to Downloads and the temporary file removed.
async function downloadFile() {
  await setReferer();
  $('controls').hidden = false;
  $('start').hidden = true;
  $('cancel').hidden = false;
  $('bar').hidden = false;
  status('Starting download…');
  const root = await navigator.storage.getDirectory();
  for await (const name of root.keys()) if (name.startsWith('vs-') && name.endsWith('.part')) await root.removeEntry(name).catch(() => {});
  const tmpName = `vs-${Date.now()}.part`;
  const fh = await root.getFileHandle(tmpName, { create: true });
  let writer = await fh.createWritable();
  let blobUrl = '';
  try {
    const r = await fetch(srcUrl, { credentials: 'include', signal: abort.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}: the server refused the request`);
    const total = Number(r.headers.get('content-length')) || 0;
    $('bar').max = total || 1;
    let got = 0;
    const t0 = performance.now();
    const reader = r.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      await writer.write(value);
      got += value.length;
      if (total) $('bar').value = got;
      const mbps = got / 1e6 / ((performance.now() - t0) / 1000);
      status(`Downloading ${(got / 1e6).toFixed(1)}${total ? ' / ' + (total / 1e6).toFixed(1) : ''} MB · ${mbps.toFixed(1)} MB/s`);
    }
    await writer.close();
    writer = null;
    status('Saving to Downloads…');
    blobUrl = URL.createObjectURL(await fh.getFile());
    const id = await chrome.downloads.download({ url: blobUrl, filename: `${baseName}.${fileExt}`, conflictAction: 'uniquify', saveAs: false });
    for (;;) {
      await new Promise((res) => setTimeout(res, 700));
      const [d] = await chrome.downloads.search({ id });
      if (!d || d.state === 'complete') break;
      if (d.state === 'interrupted') throw new Error(`Saving failed: ${d.error}`);
    }
  } finally {
    if (writer) await writer.abort().catch(() => {});
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    await root.removeEntry(tmpName).catch(() => {});
  }
  $('bar').value = $('bar').max;
  $('cancel').hidden = true;
  status('Done. Saved to your Downloads folder.');
}

// YouTube: separate video and audio mp4 streams, fetched in ranges and merged into one file.
// googlevideo expects the client the URLs were issued for: inject.js passes that client's User-Agent (ua); visionOS is the default.
const YT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const CHUNK = 9.5e6;
const IDLE_MS = 15000;
const MAX_TRIES = 6;
const MERGE_LIMIT = 1.5e9;

async function downloadMerge() {
  const streams = [
    { url: params.get('v'), size: Number(params.get('vs')) || 0 },
    ...(params.get('a') ? [{ url: params.get('a'), size: Number(params.get('as')) || 0 }] : []),
  ];
  if (streams.some((s) => !s.size)) throw new Error('YouTube did not report the stream size; use yt-dlp instead.');
  const total = streams.reduce((n, s) => n + s.size, 0);
  if (total > MERGE_LIMIT) throw new Error('Larger than 1.5 GB: too big to join video and sound on this device.');

  await setReferer();
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [3],
    addRules: [
      {
        id: 3,
        priority: 3,
        action: { type: 'modifyHeaders', requestHeaders: [{ header: 'User-Agent', operation: 'set', value: params.get('ua') || YT_UA }] },
        condition: { requestDomains: ['googlevideo.com'], resourceTypes: ['xmlhttprequest'], initiatorDomains: [chrome.runtime.id] },
      },
    ],
  });
  $('controls').hidden = false;
  $('start').hidden = true;
  $('cancel').hidden = false;
  $('bar').hidden = false;
  $('bar').max = total;

  // Progress per stream, shown every second together with how long no data has arrived, so a
  // stall is visible (and its cause can be told apart: no data vs. a frozen page).
  let got = 0;
  const t0 = performance.now();
  const info = streams.map((s, i) => ({ name: streams.length > 1 ? (i ? 'audio' : 'video') : 'video', got: 0, size: s.size, last: performance.now(), attempt: 0, ctl: null, done: false }));
  const show = () => {
    $('bar').value = got;
    const now = performance.now();
    const mbps = got / 1e6 / ((now - t0) / 1000);
    const parts = info.map((x) => {
      let t = `${x.name} ${(x.got / 1e6).toFixed(1)}/${(x.size / 1e6).toFixed(1)} MB`;
      if (!x.done) {
        const quiet = Math.floor((now - x.last) / 1000);
        if (quiet >= 3) t += ` (no data ${quiet} s)`;
        if (x.attempt > 1) t += ` [try ${x.attempt}/${MAX_TRIES}]`;
      } else t += ' ✓';
      return t;
    });
    status(`Downloading ${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB · ${mbps.toFixed(1)} MB/s — ${parts.join(' · ')}`);
  };
  // Watchdog: a range that gets no data for IDLE_MS is aborted and retried from where it stopped.
  const tick = setInterval(() => {
    const now = performance.now();
    for (const x of info) if (!x.done && x.ctl && now - x.last > IDLE_MS) x.ctl.abort();
    show();
  }, 1000);

  // One range request; a retry continues from the last byte received instead of starting the chunk again.
  const fetchRange = async (x, url, from, to) => {
    const out = new Uint8Array(to - from + 1);
    let part = 0;
    for (let attempt = 1; ; attempt++) {
      x.attempt = attempt;
      const ctl = new AbortController();
      x.ctl = ctl;
      x.last = performance.now();
      const stop = () => ctl.abort();
      abort.signal.addEventListener('abort', stop, { once: true });
      let reader;
      try {
        const u = new URL(url);
        u.searchParams.set('range', `${from + part}-${to}`);
        const r = await fetch(u, { signal: ctl.signal });
        if (!r.ok) {
          const err = new Error(`HTTP ${r.status}: YouTube refused the download`);
          err.fatal = r.status !== 503 && r.status !== 500;
          throw err;
        }
        reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          x.last = performance.now();
          const n = Math.min(value.length, out.length - part);
          out.set(n === value.length ? value : value.subarray(0, n), part);
          part += n;
          x.got += n;
          got += n;
          if (part >= out.length) break;
        }
        if (part !== out.length) throw new Error('connection closed early');
        reader.cancel().catch(() => {});
        return out;
      } catch (e) {
        if (reader) reader.cancel().catch(() => {});
        if (abort.signal.aborted || e.fatal) throw e;
        if (attempt >= MAX_TRIES) throw new Error(`YouTube stopped sending the ${x.name} at ${(x.got / 1e6).toFixed(1)} MB (${MAX_TRIES} attempts): ${e.message}`);
        await new Promise((res) => setTimeout(res, 1000 * attempt));
      } finally {
        abort.signal.removeEventListener('abort', stop);
        x.ctl = null;
      }
    }
  };

  const fetchAll = async ({ url, size }, i) => {
    const x = info[i];
    const out = new Uint8Array(size);
    for (let from = 0; from < size; from += CHUNK) {
      const to = Math.min(from + CHUNK, size) - 1;
      out.set(await fetchRange(x, url, from, to), from);
    }
    x.done = true;
    return out;
  };
  let video, audio;
  try {
    [video, audio] = await Promise.all(streams.map(fetchAll));
  } finally {
    clearInterval(tick);
  }
  show();
  status('Merging video and audio…');
  const blob = audio ? mergeFmp4(video, audio) : new Blob([video], { type: 'video/mp4' });
  const blobUrl = URL.createObjectURL(blob);
  await chrome.downloads.download({ url: blobUrl, filename: `${baseName}.mp4`, conflictAction: 'uniquify' });
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  $('cancel').hidden = true;
  status('Done. Saved to your Downloads folder.');
}

$('start').addEventListener('click', start);
$('cancel').addEventListener('click', () => abort.abort());
(mode === 'merge' ? downloadMerge() : mode === 'file' ? downloadFile() : init()).catch((e) => status(e.name === 'AbortError' ? 'Cancelled.' : `Error: ${e.message}`));
