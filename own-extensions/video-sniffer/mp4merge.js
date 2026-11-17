// Merges a video-only and an audio-only fragmented MP4 (YouTube's DASH mp4 formats) into one file:
// the audio track is added to the video's moov under a new track id, and the fragments of both are
// interleaved by time. Nothing is re-encoded.
const dv = (b) => new DataView(b.buffer, b.byteOffset, b.byteLength);
const u32 = (b, o) => dv(b).getUint32(o);
const setU32 = (b, o, v) => dv(b).setUint32(o, v);

function boxes(b, start = 0, end = b.length) {
  const out = [];
  let p = start;
  while (p + 8 <= end) {
    let size = u32(b, p);
    const type = String.fromCharCode(b[p + 4], b[p + 5], b[p + 6], b[p + 7]);
    let hdr = 8;
    if (size === 1) {
      size = Number(dv(b).getBigUint64(p + 8));
      hdr = 16;
    } else if (size === 0) {
      size = end - p;
    }
    if (size < hdr || p + size > end) break;
    out.push({ type, start: p, end: p + size, body: p + hdr });
    p += size;
  }
  return out;
}

const child = (b, box, type) => boxes(b, box.body, box.end).find((x) => x.type === type);
const raw = (b, box) => b.subarray(box.start, box.end);

function makeBox(type, parts) {
  const len = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(8 + len);
  setU32(out, 0, 8 + len);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  let at = 8;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

function trackInfo(b, moov) {
  const trak = child(b, moov, 'trak');
  const tkhd = child(b, trak, 'tkhd');
  const mdhd = child(b, child(b, trak, 'mdia'), 'mdhd');
  return {
    trak,
    tkhd,
    idAt: tkhd.body + (b[tkhd.body] === 1 ? 20 : 12),
    id: u32(b, tkhd.body + (b[tkhd.body] === 1 ? 20 : 12)),
    timescale: u32(b, mdhd.body + (b[mdhd.body] === 1 ? 20 : 12)),
  };
}

// moof+mdat pairs with their start time in seconds (null if the fragment has no tfdt).
function fragmentsOf(b, top, timescale) {
  const out = [];
  for (let i = 0; i < top.length - 1; i++) {
    if (top[i].type !== 'moof' || top[i + 1].type !== 'mdat') continue;
    const traf = child(b, top[i], 'traf');
    const tfhd = child(b, traf, 'tfhd');
    if (u32(b, tfhd.body) & 1) throw new Error('Unsupported fragment layout; use yt-dlp instead');
    const tfdt = child(b, traf, 'tfdt');
    let time = null;
    if (tfdt) time = (b[tfdt.body] === 1 ? Number(dv(b).getBigUint64(tfdt.body + 4)) : u32(b, tfdt.body + 4)) / timescale;
    out.push({ tfhd, time, start: top[i].start, end: top[i + 1].end });
  }
  return out;
}

function mergeFmp4(video, audio) {
  const vTop = boxes(video);
  const aTop = boxes(audio);
  const ftyp = vTop.find((x) => x.type === 'ftyp');
  const vMoov = vTop.find((x) => x.type === 'moov');
  const aMoov = aTop.find((x) => x.type === 'moov');
  if (!ftyp || !vMoov || !aMoov) throw new Error('Unexpected MP4 layout; use yt-dlp instead');
  const vMvex = child(video, vMoov, 'mvex');
  const aMvex = child(audio, aMoov, 'mvex');
  if (!vMvex || !aMvex) throw new Error('Streams are not fragmented MP4; use yt-dlp instead');

  const v = trackInfo(video, vMoov);
  const a = trackInfo(audio, aMoov);
  const audioId = Math.max(v.id, a.id) + 1;

  const aTrak = raw(audio, a.trak).slice();
  setU32(aTrak, a.idAt - a.trak.start, audioId);
  const aTrexBox = boxes(audio, aMvex.body, aMvex.end).find((x) => x.type === 'trex' && u32(audio, x.body + 4) === a.id);
  if (!aTrexBox) throw new Error('Audio track defaults missing; use yt-dlp instead');
  const aTrex = raw(audio, aTrexBox).slice();
  setU32(aTrex, aTrexBox.body - aTrexBox.start + 4, audioId);

  // New moov: the video's own children, the audio trak after the last trak, the audio trex in mvex.
  const kids = boxes(video, vMoov.body, vMoov.end);
  const lastTrak = kids.map((k) => k.type).lastIndexOf('trak');
  const parts = [];
  kids.forEach((k, i) => {
    if (k.type === 'mvhd') {
      const m = raw(video, k).slice();
      setU32(m, k.body - k.start + (m[k.body - k.start] === 1 ? 108 : 96), audioId + 1);
      parts.push(m);
    } else if (k.type === 'mvex') {
      parts.push(makeBox('mvex', [...boxes(video, k.body, k.end).map((c) => raw(video, c)), aTrex]));
    } else {
      parts.push(raw(video, k));
    }
    if (i === lastTrak) parts.push(aTrak);
  });
  const moov = makeBox('moov', parts);

  const vFrags = fragmentsOf(video, vTop, v.timescale);
  const aFrags = fragmentsOf(audio, aTop, a.timescale);
  for (const f of aFrags) setU32(audio, f.tfhd.body + 4, audioId);

  const timed = vFrags.every((f) => f.time != null) && aFrags.every((f) => f.time != null);
  const order = [];
  let i = 0;
  let j = 0;
  while (i < vFrags.length || j < aFrags.length) {
    const takeVideo = j >= aFrags.length || (i < vFrags.length && (timed ? vFrags[i].time <= aFrags[j].time : i <= j));
    order.push(takeVideo ? [video, vFrags[i++]] : [audio, aFrags[j++]]);
  }
  return new Blob([raw(video, ftyp), moov, ...order.map(([b, f]) => b.subarray(f.start, f.end))], { type: 'video/mp4' });
}

// Same merge for streams kept on disk (File / Blob, e.g. in the origin private file system): only the
// small boxes (ftyp, moov, moof) are read into memory; the media data (mdat) of both inputs goes into the
// result as slices of the input files, so the size is not limited by memory.
async function topBoxesOfFile(file) {
  const out = [];
  let p = 0;
  while (p + 8 <= file.size) {
    const h = new Uint8Array(await file.slice(p, Math.min(p + 16, file.size)).arrayBuffer());
    let size = u32(h, 0);
    const type = String.fromCharCode(h[4], h[5], h[6], h[7]);
    let hdr = 8;
    if (size === 1) {
      if (h.length < 16) break;
      size = Number(dv(h).getBigUint64(8));
      hdr = 16;
    } else if (size === 0) {
      size = file.size - p;
    }
    if (size < hdr || p + size > file.size) break;
    out.push({ type, start: p, end: p + size, body: p + hdr });
    p += size;
  }
  return out;
}

// A box read into its own buffer, with offsets relative to that buffer (so the in-memory helpers apply).
async function loadBox(file, box) {
  const b = new Uint8Array(await file.slice(box.start, box.end).arrayBuffer());
  return { b, box: { type: box.type, start: 0, end: b.length, body: box.body - box.start } };
}

async function fragmentsOfFile(file, top, timescale, newTrackId) {
  const out = [];
  for (let i = 0; i < top.length - 1; i++) {
    if (top[i].type !== 'moof' || top[i + 1].type !== 'mdat') continue;
    const { b, box } = await loadBox(file, top[i]);
    const traf = child(b, box, 'traf');
    const tfhd = child(b, traf, 'tfhd');
    if (u32(b, tfhd.body) & 1) throw new Error('Unsupported fragment layout');
    if (newTrackId != null) setU32(b, tfhd.body + 4, newTrackId);
    const tfdt = child(b, traf, 'tfdt');
    let time = null;
    if (tfdt) time = (b[tfdt.body] === 1 ? Number(dv(b).getBigUint64(tfdt.body + 4)) : u32(b, tfdt.body + 4)) / timescale;
    out.push({ time, moof: b, mdat: file.slice(top[i + 1].start, top[i + 1].end) });
  }
  return out;
}

async function mergeFmp4Files(videoFile, audioFile) {
  const vTop = await topBoxesOfFile(videoFile);
  const aTop = await topBoxesOfFile(audioFile);
  const ftypBox = vTop.find((x) => x.type === 'ftyp');
  const vMoovBox = vTop.find((x) => x.type === 'moov');
  const aMoovBox = aTop.find((x) => x.type === 'moov');
  if (!ftypBox || !vMoovBox || !aMoovBox) throw new Error('Unexpected MP4 layout');
  const { b: video, box: vMoov } = await loadBox(videoFile, vMoovBox);
  const { b: audio, box: aMoov } = await loadBox(audioFile, aMoovBox);
  const vMvex = child(video, vMoov, 'mvex');
  const aMvex = child(audio, aMoov, 'mvex');
  if (!vMvex || !aMvex) throw new Error('Streams are not fragmented MP4');

  const v = trackInfo(video, vMoov);
  const a = trackInfo(audio, aMoov);
  const audioId = Math.max(v.id, a.id) + 1;

  const aTrak = raw(audio, a.trak).slice();
  setU32(aTrak, a.idAt - a.trak.start, audioId);
  const aTrexBox = boxes(audio, aMvex.body, aMvex.end).find((x) => x.type === 'trex' && u32(audio, x.body + 4) === a.id);
  if (!aTrexBox) throw new Error('Audio track defaults missing');
  const aTrex = raw(audio, aTrexBox).slice();
  setU32(aTrex, aTrexBox.body - aTrexBox.start + 4, audioId);

  const kids = boxes(video, vMoov.body, vMoov.end);
  const lastTrak = kids.map((k) => k.type).lastIndexOf('trak');
  const parts = [];
  kids.forEach((k, i) => {
    if (k.type === 'mvhd') {
      const m = raw(video, k).slice();
      setU32(m, k.body - k.start + (m[k.body - k.start] === 1 ? 108 : 96), audioId + 1);
      parts.push(m);
    } else if (k.type === 'mvex') {
      parts.push(makeBox('mvex', [...boxes(video, k.body, k.end).map((c) => raw(video, c)), aTrex]));
    } else {
      parts.push(raw(video, k));
    }
    if (i === lastTrak) parts.push(aTrak);
  });
  const moov = makeBox('moov', parts);

  const vFrags = await fragmentsOfFile(videoFile, vTop, v.timescale, null);
  const aFrags = await fragmentsOfFile(audioFile, aTop, a.timescale, audioId);
  const timed = vFrags.every((f) => f.time != null) && aFrags.every((f) => f.time != null);
  const out = [videoFile.slice(ftypBox.start, ftypBox.end), moov];
  let i = 0;
  let j = 0;
  while (i < vFrags.length || j < aFrags.length) {
    const takeVideo = j >= aFrags.length || (i < vFrags.length && (timed ? vFrags[i].time <= aFrags[j].time : i <= j));
    const f = takeVideo ? vFrags[i++] : aFrags[j++];
    out.push(f.moof, f.mdat);
  }
  return new Blob(out, { type: 'video/mp4' });
}
