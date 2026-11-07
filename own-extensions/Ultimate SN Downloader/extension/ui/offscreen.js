/* Media worker (offscreen document): fetches Instagram's separate HD video / audio tracks segment by segment (same method as the
   Instagram Media Downloader: init range + sidx index + media ranges via ?bytestart=&byteend=) and joins them with ffmpeg.wasm (-c copy). */
import { FFmpeg } from '../ffmpeg/lib/index.js';

const blobs = new Map();
let ff = null, loaded = false, usedBytes = 0, chain = Promise.resolve();
const MAX_HANDLE = 314572800;   // restart ffmpeg after ~300 MB to free its memory (as the original does)

function range(r) { const [a, b] = r.split('-').map(Number); return { start: a, end: b, length: b - a + 1 }; }

async function fetchRange(url, start, end, tries = 3) {
  const u = url + (url.includes('?') ? '&' : '?') + 'bytestart=' + start + '&byteend=' + end;
  let last;
  for (let i = 0; i < tries; i++) {
    try {
      const r = await fetch(u);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return new Uint8Array(await r.arrayBuffer());
    } catch (e) { last = e; await new Promise(res => setTimeout(res, 500 * 2 ** i)); }
  }
  throw last;
}

// 'sidx' box -> byte ranges of every media segment
function parseSidx(buf, indexStart) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  let o = 0;
  const boxSize = dv.getUint32(o); o += 4;
  if (String.fromCharCode(...buf.slice(o, o + 4)) !== 'sidx') throw new Error('no sidx box in index range');
  o += 4;
  const version = dv.getUint8(o); o += 4;                // version + flags
  o += 4;                                               // reference id
  o += 4;                                               // timescale
  let firstOffset;
  if (version === 0) { o += 4; firstOffset = dv.getUint32(o); o += 4; }
  else { o += 8; firstOffset = Number(dv.getBigUint64(o)); o += 8; }
  o += 2;
  const count = dv.getUint16(o); o += 2;
  let pos = indexStart + boxSize + firstOffset;
  const out = [];
  for (let i = 0; i < count; i++) {
    const size = dv.getUint32(o) & 0x7fffffff; o += 12;
    out.push({ start: pos, end: pos + size - 1 });
    pos += size;
  }
  return out;
}

async function trackBytes(t) {
  const init = range(t.init), idx = range(t.index);
  const initBuf = await fetchRange(t.url, init.start, init.end);
  const idxBuf = await fetchRange(t.url, idx.start, idx.end);
  const segs = parseSidx(idxBuf, idx.start), parts = [initBuf, idxBuf], got = new Array(segs.length);
  for (let i = 0; i < segs.length; i += 10) {
    await Promise.all(segs.slice(i, i + 10).map(async (s, k) => { got[i + k] = await fetchRange(t.url, s.start, s.end); }));
  }
  return new Uint8Array(await new Blob([...parts, ...got]).arrayBuffer());
}

async function loadFFmpeg() {
  if (loaded) return;
  ff = new FFmpeg();
  await ff.load({ coreURL: chrome.runtime.getURL('ffmpeg/ffmpeg-core.js'), wasmURL: chrome.runtime.getURL('ffmpeg/ffmpeg-core.wasm') });
  loaded = true;
}

async function merge(video, audio) {
  if (usedBytes + video.length > MAX_HANDLE && loaded) { ff.terminate(); loaded = false; usedBytes = 0; }
  await loadFFmpeg();
  try {
    await ff.writeFile('video.mp4', video);
    await ff.writeFile('audio.mp4', audio);
    await ff.ffprobe(['-print_format', 'json', '-show_format', '-show_streams', '-select_streams', 'a:0', '-show_entries', 'stream=codec_name', 'audio.mp4', '-o', 'audioInfo.json']);
    const info = JSON.parse(new TextDecoder().decode(await ff.readFile('audioInfo.json')));
    const aac = (info && info.streams && info.streams[0] && info.streams[0].codec_name) === 'aac';
    const rc = await ff.exec(['-i', 'video.mp4', '-i', 'audio.mp4', '-c', 'copy', '-map', '0:v:0', '-map', '1:a:0', '-movflags', '+faststart',
      ...(aac ? ['-bsf:a:0', 'aac_adtstoasc'] : []), '-max_muxing_queue_size', '9999', 'output.mp4']);
    if (rc !== 0) throw new Error('ffmpeg exit code ' + rc);
    usedBytes += video.length;
    return await ff.readFile('output.mp4');
  } catch (e) {
    try { ff.terminate(); } catch (e2) {}
    loaded = false; usedBytes = 0;
    throw e;
  } finally {
    if (loaded) for (const f of ['video.mp4', 'audio.mp4', 'output.mp4', 'audioInfo.json']) { try { await ff.deleteFile(f); } catch (e) {} }
  }
}

function keep(bytes, type) {
  const url = URL.createObjectURL(new Blob([bytes], { type }));
  blobs.set(url, 1);
  setTimeout(() => { if (blobs.delete(url)) URL.revokeObjectURL(url); }, 15 * 60e3);
  return url;
}

// ---- host-file function rules run in a sandboxed iframe; its network requests go through the service worker
let sandbox = null, sandboxReady = null; const runs = new Map(); let runId = 1;
function ensureSandbox() {
  if (sandboxReady) return sandboxReady;
  sandboxReady = new Promise(res => { sandbox = document.createElement('iframe'); sandbox.src = chrome.runtime.getURL('ui/ih_sandbox.html'); sandbox.onload = () => res(); document.body.appendChild(sandbox); });
  return sandboxReady;
}
window.addEventListener('message', async ev => {
  const d = ev.data;
  if (!d || ev.source !== (sandbox && sandbox.contentWindow)) return;
  if (d.type === 'run-result' && runs.has(d.id)) { runs.get(d.id)(d.result); runs.delete(d.id); }
  if (d.type === 'net') {
    const r = await chrome.runtime.sendMessage({ t: 'ih:net', method: d.method, url: d.url, headers: d.headers, body: d.body }).catch(e => ({ error: String(e) }));
    sandbox.contentWindow.postMessage({ type: 'net-result', id: d.id, ...(r || { error: 'no answer' }) }, '*');
  }
});
async function runRule(fn, pageData, pageUrl) {
  await ensureSandbox();
  return new Promise(res => {
    const id = runId++, t = setTimeout(() => { runs.delete(id); res({ status: 'ABORT', error: 'rule timed out' }); }, 45000);
    runs.set(id, r => { clearTimeout(t); res(r); });
    sandbox.contentWindow.postMessage({ type: 'run', id, fn, pageData, pageUrl }, '*');
  });
}

chrome.runtime.onMessage.addListener((msg, sender, respond) => {
  if (!msg || msg.target !== 'offscreen') return;
  if (msg.kind === 'ih:run') { runRule(msg.fn, msg.pageData, msg.pageUrl).then(r => respond({ ok: true, result: r }), e => respond({ ok: false, error: String(e) })); return true; }
  const job = async () => {
    if (msg.kind === 'revoke') { if (blobs.delete(msg.url)) URL.revokeObjectURL(msg.url); return {}; }
    if (msg.kind === 'merge') {
      const [v, a] = await Promise.all([trackBytes(msg.video), trackBytes(msg.audio)]);
      const out = await merge(v, a);
      return { blobUrl: keep(out, 'video/mp4'), size: out.length };
    }
    throw new Error('unknown job ' + msg.kind);
  };
  chain = chain.then(() => job()).then(r => respond({ ok: true, ...r }), e => respond({ ok: false, error: String((e && e.message) || e) }));
  return true;
});
