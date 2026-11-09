// Minimalni protobuf (proto3) koder/dekoder za Safe Browsing API v5 poruke.
// Brojevi polja su iz Chromium 156: components/safe_browsing/core/common/proto/safebrowsingv5.proto

const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- čitanje ----------

// Varint kao {lo, hi} (32-bitni dijelovi), da int32/uint32/int64 budu tačni.
function readVarint(buf, st) {
  let lo = 0, hi = 0, shift = 0, b;
  do {
    if (st.pos >= buf.length) throw new Error('protobuf: varint izlazi iz bafera');
    b = buf[st.pos++];
    if (shift < 28) lo |= (b & 0x7f) << shift;
    else if (shift === 28) { lo |= (b & 0x0f) << 28; hi |= (b & 0x7f) >>> 4; }
    else if (shift < 64) hi |= (b & 0x7f) << (shift - 32);
    shift += 7;
    if (shift > 70) throw new Error('protobuf: predug varint');
  } while (b & 0x80);
  return { lo: lo >>> 0, hi: hi >>> 0 };
}

// Rastavi poruku u polja: Map<broj polja, [{wt, v}]>. v je {lo,hi} za varint,
// Uint8Array za length-delimited, {lo,hi} za fixed64, broj za fixed32.
export function parseFields(buf) {
  const fields = new Map();
  const st = { pos: 0 };
  while (st.pos < buf.length) {
    const key = readVarint(buf, st).lo;
    const no = key >>> 3, wt = key & 7;
    if (no === 0) throw new Error('protobuf: polje 0');
    let v;
    if (wt === 0) v = readVarint(buf, st);
    else if (wt === 1) {
      if (st.pos + 8 > buf.length) throw new Error('protobuf: fixed64 izlazi iz bafera');
      const dv = new DataView(buf.buffer, buf.byteOffset + st.pos, 8);
      v = { lo: dv.getUint32(0, true), hi: dv.getUint32(4, true) };
      st.pos += 8;
    } else if (wt === 2) {
      const len = readVarint(buf, st).lo;
      if (st.pos + len > buf.length) throw new Error('protobuf: polje izlazi iz bafera');
      v = buf.subarray(st.pos, st.pos + len);
      st.pos += len;
    } else if (wt === 5) {
      if (st.pos + 4 > buf.length) throw new Error('protobuf: fixed32 izlazi iz bafera');
      v = new DataView(buf.buffer, buf.byteOffset + st.pos, 4).getUint32(0, true);
      st.pos += 4;
    } else throw new Error(`protobuf: nepodržan wire type ${wt}`);
    if (!fields.has(no)) fields.set(no, []);
    fields.get(no).push({ wt, v });
  }
  return fields;
}

const last = (f, no) => { const a = f.get(no); return a ? a[a.length - 1] : undefined; };
const u32 = (f, no) => { const x = last(f, no); return x && x.wt === 0 ? x.v.lo >>> 0 : 0; };
const i32 = (f, no) => { const x = last(f, no); return x && x.wt === 0 ? x.v.lo | 0 : 0; };
const i64 = (f, no) => { const x = last(f, no); return x && x.wt === 0 ? (x.v.hi | 0) * 4294967296 + x.v.lo : 0; };
const bool = (f, no) => { const x = last(f, no); return !!x && x.wt === 0 && (x.v.lo !== 0 || x.v.hi !== 0); };
const bytes = (f, no) => { const x = last(f, no); return x && x.wt === 2 ? x.v : null; };
const str = (f, no) => { const b = bytes(f, no); return b ? dec.decode(b) : ''; };
const msgs = (f, no) => (f.get(no) || []).filter((x) => x.wt === 2).map((x) => x.v);
// repeated enum: packed (wt 2) ili ne (wt 0)
function enums(f, no) {
  const out = [];
  for (const x of f.get(no) || []) {
    if (x.wt === 0) out.push(x.v.lo | 0);
    else if (x.wt === 2) { const st = { pos: 0 }; while (st.pos < x.v.length) out.push(readVarint(x.v, st).lo | 0); }
  }
  return out;
}

export function decodeDuration(buf) {
  const f = parseFields(buf);
  return { seconds: i64(f, 1), nanos: i32(f, 2) };
}
export const durationMs = (d) => (d ? d.seconds * 1000 + Math.floor(d.nanos / 1e6) : 0);

// RiceDeltaEncoded32Bit { uint32 first_value = 1; int32 rice_parameter = 2; int32 entries_count = 3; bytes encoded_data = 4; }
export function decodeRice32(buf) {
  const f = parseFields(buf);
  return { firstValue: u32(f, 1), riceParameter: i32(f, 2), entriesCount: i32(f, 3), encodedData: bytes(f, 4) || new Uint8Array(0) };
}

// HashList: name=1, version=2, partial_update=3, additions_four_bytes=4, compressed_removals=5,
// minimum_wait_duration=6, sha256_checksum=7, metadata=8, additions_eight_bytes=9,
// additions_sixteen_bytes=10, additions_thirty_two_bytes=11
export function decodeHashList(buf) {
  const f = parseFields(buf);
  const additionsField = [4, 9, 10, 11].filter((n) => f.has(n)).pop();
  const add4 = bytes(f, 4);
  const rem = bytes(f, 5);
  const wait = bytes(f, 6);
  const meta = bytes(f, 8);
  let metadata = null;
  if (meta) {
    const m = parseFields(meta);
    metadata = { threatTypes: enums(m, 1), likelySafeTypes: enums(m, 2), description: str(m, 4), hashLength: i32(m, 6) };
  }
  return {
    name: str(f, 1),
    version: bytes(f, 2) || new Uint8Array(0),
    partialUpdate: bool(f, 3),
    additionsPrefixSize: additionsField === undefined ? null : { 4: 4, 9: 8, 10: 16, 11: 32 }[additionsField],
    additionsFourBytes: additionsField === 4 && add4 ? decodeRice32(add4) : null,
    compressedRemovals: rem ? decodeRice32(rem) : null,
    minimumWaitDuration: wait ? decodeDuration(wait) : null,
    sha256Checksum: bytes(f, 7) || new Uint8Array(0),
    metadata,
  };
}

// BatchGetHashListsResponse { repeated HashList hash_lists = 1; }
export function decodeBatchGetHashListsResponse(buf) {
  return { hashLists: msgs(parseFields(buf), 1).map(decodeHashList) };
}

// SearchHashesResponse { repeated FullHash full_hashes = 1; Duration cache_duration = 2; }
// FullHash { bytes full_hash = 1; repeated FullHashDetail full_hash_details = 2; }
// FullHashDetail { ThreatType threat_type = 1; repeated ThreatAttribute attributes = 2; }
export function decodeSearchHashesResponse(buf) {
  const f = parseFields(buf);
  const cd = bytes(f, 2);
  return {
    fullHashes: msgs(f, 1).map((fh) => {
      const g = parseFields(fh);
      return {
        fullHash: bytes(g, 1) || new Uint8Array(0),
        details: msgs(g, 2).map((d) => { const h = parseFields(d); return { threatType: i32(h, 1), attributes: enums(h, 2) }; }),
      };
    }),
    cacheDuration: cd ? decodeDuration(cd) : null,
  };
}

// ---------- pisanje ----------

export class Writer {
  constructor() { this.parts = []; this.len = 0; }
  raw(arr) { this.parts.push(arr); this.len += arr.length; return this; }
  varint(n) {
    // n: nenegativan broj do 2^53, ili negativan int32/int64 (kodira se kao 10 bajtova)
    const out = [];
    let lo, hi;
    if (n < 0) { const big = BigInt.asUintN(64, BigInt(n)); lo = Number(big & 0xffffffffn); hi = Number(big >> 32n); }
    else { lo = n % 4294967296; hi = Math.floor(n / 4294967296); }
    while (hi > 0 || lo > 0x7f) {
      out.push((lo & 0x7f) | 0x80);
      lo = ((lo >>> 7) | ((hi & 0x7f) << 25)) >>> 0;
      hi = hi >>> 7;
    }
    out.push(lo);
    return this.raw(Uint8Array.from(out));
  }
  tag(no, wt) { return this.varint(no * 8 + wt); }
  uint(no, n) { return n ? this.tag(no, 0).varint(n) : this; }       // proto3: nula se ne piše
  bool(no, b) { return b ? this.tag(no, 0).varint(1) : this; }
  bytes(no, b, always = false) {
    if (!always && (!b || !b.length)) return this;
    return this.tag(no, 2).varint(b.length).raw(b);
  }
  string(no, s) { return this.bytes(no, enc.encode(s)); }
  msg(no, w) { return this.tag(no, 2).varint(w.len).raw(w.finish()); }
  packed(no, arr) { if (!arr.length) return this; const w = new Writer(); for (const x of arr) w.varint(x); return this.msg(no, w); }
  finish() {
    const out = new Uint8Array(this.len);
    let o = 0;
    for (const p of this.parts) { out.set(p, o); o += p.length; }
    return out;
  }
}

// BatchGetHashListsRequest { repeated string names = 1; repeated bytes version = 2; }
export function encodeBatchGetHashListsRequest(names, versions = []) {
  const w = new Writer();
  for (const n of names) w.string(1, n);
  for (const v of versions) w.bytes(2, v, true);
  return w.finish();
}

// SearchHashesRequest { repeated bytes hash_prefixes = 1; }
export function encodeSearchHashesRequest(prefixes) {
  const w = new Writer();
  for (const p of prefixes) w.bytes(1, p, true);
  return w.finish();
}

// Za testove i lažni server: kodiranje odgovora.
export function encodeDuration({ seconds = 0, nanos = 0 } = {}) {
  return new Writer().uint(1, seconds).uint(2, nanos);
}
export function encodeRice32({ firstValue = 0, riceParameter = 0, entriesCount = 0, encodedData = new Uint8Array(0) }) {
  return new Writer().uint(1, firstValue).uint(2, riceParameter).uint(3, entriesCount).bytes(4, encodedData);
}
export function encodeHashList(h) {
  const w = new Writer().string(1, h.name).bytes(2, h.version).bool(3, h.partialUpdate);
  if (h.additionsFourBytes) w.msg(4, encodeRice32(h.additionsFourBytes));
  if (h.compressedRemovals) w.msg(5, encodeRice32(h.compressedRemovals));
  if (h.minimumWaitDuration) w.msg(6, encodeDuration(h.minimumWaitDuration));
  w.bytes(7, h.sha256Checksum);
  if (h.metadata) {
    const m = new Writer().packed(1, h.metadata.threatTypes || []).string(4, h.metadata.description || '').uint(6, h.metadata.hashLength || 0);
    w.msg(8, m);
  }
  return w;
}
export function encodeBatchGetHashListsResponse(lists) {
  const w = new Writer();
  for (const h of lists) w.msg(1, encodeHashList(h));
  return w.finish();
}
export function encodeSearchHashesResponse({ fullHashes = [], cacheDuration = null }) {
  const w = new Writer();
  for (const fh of fullHashes) {
    const g = new Writer().bytes(1, fh.fullHash);
    for (const d of fh.details || []) g.msg(2, new Writer().uint(1, d.threatType).packed(2, d.attributes || []));
    w.msg(1, g);
  }
  if (cacheDuration) w.msg(2, encodeDuration(cacheDuration));
  return w.finish();
}
export function decodeBatchGetHashListsRequest(buf) {
  const f = parseFields(buf);
  return { names: msgs(f, 1).map((b) => dec.decode(b)), versions: msgs(f, 2) };
}
export function decodeSearchHashesRequest(buf) {
  return { hashPrefixes: msgs(parseFields(buf), 1) };
}

// base64url SA paddingom (kao Chromium Base64UrlEncodePolicy::INCLUDE_PADDING)
export function base64UrlEncode(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_');
}
export function base64UrlDecode(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
