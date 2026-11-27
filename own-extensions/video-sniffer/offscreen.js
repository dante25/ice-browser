// Runs jobs for the one-click button: single file, HLS stream (best quality) or video+audio merge.
// Returns a blob URL; the background worker saves it with chrome.downloads.
const CONCURRENCY = 6;
const LIMIT = 1.5e9;

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.type === 'off:revoke') URL.revokeObjectURL(msg.blobUrl);
  if (msg?.type !== 'off:run') return;
  run(msg.job, (text) => chrome.runtime.sendMessage({ type: 'off:progress', id: msg.id, text }).catch(() => {}))
    .then((r) => reply(r))
    .catch((e) => reply({ error: e.message || String(e) }));
  return true;
});

async function get(url, type = 'buffer') {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return type === 'text' ? r.text() : r.arrayBuffer();
}

// Streams a file, reporting progress through `tick(bytes)`.
async function fetchAll(url, tick) {
  const r = await fetch(url, { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}: the server refused the request`);
  const total = Number(r.headers.get('content-length')) || 0;
  if (total > LIMIT) throw new Error('Larger than 1.5 GB');
  const parts = [];
  let got = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    parts.push(value);
    got += value.length;
    tick(value.length, total);
  }
  const out = new Uint8Array(got);
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return { bytes: out, type: r.headers.get('content-type') || 'video/mp4' };
}


// ---- Facebook DASH: one file per stream, read in pieces (ESUIT's way) ------------------------------------
// init range (ftyp+moov) + sidx (indexRange) + every piece the sidx lists, joined back into a fragmented MP4.
const rangeOf = (s) => String(s).split('-').map(Number);
const piece = (url, a, b) => `${url}${url.includes('?') ? '&' : '?'}bytestart=${a}&byteend=${b}`;

async function getRange(url, a, b) {
  const r = await fetch(piece(url, a, b), { credentials: 'include' });
  if (!r.ok) throw new Error(`HTTP ${r.status}: the server refused a video piece`);
  return new Uint8Array(await r.arrayBuffer());
}

// Byte ranges of the media pieces listed by the sidx box that starts at file offset `at`.
function sidxRanges(b, at) {
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (String.fromCharCode(b[4], b[5], b[6], b[7]) !== 'sidx') throw new Error('Unexpected index data (no sidx)');
  const size = v.getUint32(0);
  let p = 8;
  const ver = b[p];
  p += 12; // version+flags, reference id, timescale
  let first;
  if (ver === 0) {
    p += 4;
    first = v.getUint32(p);
    p += 4;
  } else {
    p += 8;
    first = Number(v.getBigUint64(p));
    p += 8;
  }
  p += 2;
  const n = v.getUint16(p);
  p += 2;
  let pos = at + size + first;
  const out = [];
  for (let i = 0; i < n; i++, p += 12) {
    const len = v.getUint32(p) & 0x7fffffff;
    out.push([pos, pos + len - 1]);
    pos += len;
  }
  return out;
}

async function dashStream(st, tick) {
  if (!st.init || !st.index) {
    const f = await fetchAll(st.url, (n) => tick(n));
    return f.bytes;
  }
  const [i0, i1] = rangeOf(st.init);
  const [x0, x1] = rangeOf(st.index);
  const [init, sidx] = await Promise.all([getRange(st.url, i0, i1), getRange(st.url, x0, x1)]);
  const refs = sidxRanges(sidx, x0);
  const parts = new Array(refs.length);
  let next = 0;
  const worker = async () => {
    while (next < refs.length) {
      const k = next++;
      parts[k] = await getRange(st.url, refs[k][0], refs[k][1]);
      tick(parts[k].length);
    }
  };
  await Promise.all(Array.from({ length: 8 }, worker));
  const all = [init, sidx, ...parts];
  const out = new Uint8Array(all.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of all) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function progress(say, label) {
  let sum = 0;
  let last = 0;
  return (n) => {
    sum += n;
    if (Date.now() - last > 700) {
      last = Date.now();
      say(`${label} ${(sum / 1e6).toFixed(0)} MB`);
    }
  };
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

function parseMedia(text, base) {
  const lines = text.split(/\r?\n/);
  let seq = 0;
  let key = null;
  let map = null;
  const segs = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.startsWith('#EXT-X-MEDIA-SEQUENCE')) seq = Number(l.split(':')[1]) || 0;
    else if (l.startsWith('#EXT-X-KEY')) {
      const a = attrs(l);
      key = a.METHOD === 'NONE' ? null : { method: a.METHOD, uri: a.URI && abs(a.URI, base), iv: a.IV };
    } else if (l.startsWith('#EXT-X-MAP')) map = abs(attrs(l).URI, base);
    else if (l.startsWith('#EXTINF')) {
      const uri = lines.slice(i + 1).find((x) => x && !x.startsWith('#'));
      segs.push({ url: abs(uri, base), seq: seq + segs.length, key });
    }
  }
  return { segs, map };
}

async function hls(job, say) {
  let url = job.url;
  let text = await get(url, 'text');
  if (text.includes('#EXT-X-STREAM-INF')) {
    const v = parseMaster(text, url)[0];
    if (!v) throw new Error('No qualities found in playlist');
    url = v.url;
    text = await get(url, 'text');
  }
  const { segs, map } = parseMedia(text, url);
  if (!segs.length) throw new Error('No segments found in playlist');
  const keys = new Map();
  const decrypt = async (buf, seg) => {
    if (!seg.key) return buf;
    if (seg.key.method !== 'AES-128') throw new Error(`Unsupported encryption: ${seg.key.method}`);
    if (!keys.has(seg.key.uri)) keys.set(seg.key.uri, get(seg.key.uri).then((raw) => crypto.subtle.importKey('raw', raw, 'AES-CBC', false, ['decrypt'])));
    return crypto.subtle.decrypt({ name: 'AES-CBC', iv: ivBytes(seg) }, await keys.get(seg.key.uri), buf);
  };
  const parts = [];
  if (map) parts.push(await get(map));
  for (let i = 0; i < segs.length; i += CONCURRENCY) {
    const bufs = await Promise.all(segs.slice(i, i + CONCURRENCY).map(async (s) => decrypt(await get(s.url), s)));
    parts.push(...bufs);
    say(`${Math.min(100, Math.round(((i + CONCURRENCY) / segs.length) * 100))}%`);
  }
  const ext = map ? 'mp4' : 'ts';
  return { blob: new Blob(parts, { type: map ? 'video/mp4' : 'video/mp2t' }), filename: `${job.name}.${ext}` };
}

async function run(job, say) {
  let blob;
  let filename = `${job.name}.${job.ext || 'mp4'}`;
  if (job.mode === 'file') {
    const f = await fetchAll(job.url, progress(say, ''));
    blob = new Blob([f.bytes], { type: f.type });
  } else if (job.mode === 'merge') {
    const tick = progress(say, '');
    const [v, a] = await Promise.all([fetchAll(job.video, tick), fetchAll(job.audio, tick)]);
    say('Merging…');
    blob = mergeFmp4(v.bytes, a.bytes);
    filename = `${job.name}.mp4`;
  } else if (job.mode === 'dash') {
    const tick = progress(say, '');
    const [v, a] = await Promise.all([dashStream(job.video, tick), dashStream(job.audio, tick)]);
    say('Merging…');
    blob = mergeFmp4(v, a);
    filename = `${job.name}.mp4`;
  } else if (job.mode === 'hls') {
    ({ blob, filename } = await hls(job, say));
  } else {
    throw new Error('Unknown job');
  }
  return { blobUrl: URL.createObjectURL(blob), filename };
}
