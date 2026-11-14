// Downloads an HLS stream: fetches segments, decrypts AES-128, writes to disk.
const CONCURRENCY = 6;

const params = new URLSearchParams(location.search);
const srcUrl = params.get('url');
const page = params.get('page');
const baseName = (params.get('name') || 'video').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 100);
const mode = params.get('mode');
const fileExt = params.get('ext') || 'mp4';
const FILE_LIMIT = 1e9;

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
        condition: { resourceTypes: ['xmlhttprequest'], initiatorDomains: [chrome.runtime.id] },
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

// Single file (mp4, webm...): fetched here with the page's Referer/Origin, then saved via downloads.
async function downloadFile() {
  await setReferer();
  const r = await fetch(srcUrl, { credentials: 'include', signal: abort.signal });
  if (!r.ok) throw new Error(`HTTP ${r.status}: the server refused the request`);
  const total = Number(r.headers.get('content-length')) || 0;
  if (total > FILE_LIMIT) {
    await r.body.cancel();
    throw new Error('File is larger than 1 GB; use the yt-dlp button in the popup instead.');
  }
  $('controls').hidden = false;
  $('start').hidden = true;
  $('cancel').hidden = false;
  $('bar').hidden = false;
  $('bar').max = total || 1;

  const parts = [];
  let got = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    if (total) $('bar').value = got;
    status(`Downloading ${(got / 1e6).toFixed(1)}${total ? ' / ' + (total / 1e6).toFixed(1) : ''} MB`);
  }
  const blobUrl = URL.createObjectURL(new Blob(parts, { type: r.headers.get('content-type') || 'video/mp4' }));
  await chrome.downloads.download({ url: blobUrl, filename: `${baseName}.${fileExt}`, conflictAction: 'uniquify' });
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  $('cancel').hidden = true;
  status('Done. Saved to your Downloads folder.');
}

// YouTube: separate video and audio mp4 streams, fetched in ranges and merged into one file.
// googlevideo expects the client the URLs were issued for: inject.js passes that client's User-Agent (ua); visionOS is the default.
const YT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const CHUNK = 9.5e6;
const IDLE_MS = 20000;
const MERGE_LIMIT = 1.5e9;

async function downloadMerge() {
  const streams = [
    { url: params.get('v'), size: Number(params.get('vs')) || 0 },
    ...(params.get('a') ? [{ url: params.get('a'), size: Number(params.get('as')) || 0 }] : []),
  ];
  if (streams.some((s) => !s.size)) throw new Error('YouTube did not report the stream size; use yt-dlp instead.');
  const total = streams.reduce((n, s) => n + s.size, 0);
  if (total > MERGE_LIMIT) throw new Error('Larger than 1.5 GB; use yt-dlp instead.');

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

  let got = 0;
  const t0 = performance.now();
  const show = () => {
    $('bar').value = got;
    const mbps = got / 1e6 / ((performance.now() - t0) / 1000);
    status(`Downloading ${(got / 1e6).toFixed(1)} / ${(total / 1e6).toFixed(1)} MB · ${mbps.toFixed(1)} MB/s`);
  };

  // One range request. If no data arrives for IDLE_MS it is retried: YouTube sometimes leaves a
  // connection hanging, which used to freeze the download for good.
  const fetchRange = async (url, from, to) => {
    for (let attempt = 1; ; attempt++) {
      const ctl = new AbortController();
      const stop = () => ctl.abort();
      abort.signal.addEventListener('abort', stop, { once: true });
      let idle;
      const bump = () => {
        clearTimeout(idle);
        idle = setTimeout(() => ctl.abort(), IDLE_MS);
      };
      let part = 0;
      try {
        bump();
        const u = new URL(url);
        u.searchParams.set('range', `${from}-${to}`);
        const r = await fetch(u, { signal: ctl.signal });
        if (!r.ok) {
          const err = new Error(`HTTP ${r.status}: YouTube refused the download`);
          err.fatal = true;
          throw err;
        }
        const out = new Uint8Array(to - from + 1);
        const reader = r.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          bump();
          out.set(value, part);
          part += value.length;
          got += value.length;
          show();
        }
        if (part !== out.length) throw new Error('Incomplete chunk');
        return out;
      } catch (e) {
        got -= part;
        if (abort.signal.aborted || e.fatal) throw e;
        if (attempt >= 3) throw new Error(`YouTube stopped sending data at ${(got / 1e6).toFixed(1)} MB (3 attempts): ${e.message}`);
        status(`Connection stalled at ${(got / 1e6).toFixed(1)} MB, retrying (${attempt}/3)…`);
      } finally {
        clearTimeout(idle);
        abort.signal.removeEventListener('abort', stop);
      }
    }
  };

  const fetchAll = async ({ url, size }) => {
    const out = new Uint8Array(size);
    for (let from = 0; from < size; from += CHUNK) {
      const to = Math.min(from + CHUNK, size) - 1;
      out.set(await fetchRange(url, from, to), from);
    }
    return out;
  };
  const [video, audio] = await Promise.all(streams.map(fetchAll));
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
