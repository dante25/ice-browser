// Čista logika Google Safe Browsing v5 (bez chrome.* API-ja), da se može testirati u nodeu.
// Izvor: Chromium 156 v5_update_protocol_manager.cc (ParseUpdateResponse), v5_store.cc /
// sb_store.cc (MergeUpdateLoop), v5_search_hashes_util.cc i v5_get_hash_protocol_manager.cc.

import { decodeRice32, validateRice32 } from './rice.js';
import { durationMs } from './proto.js';

export const DEFAULT_ENDPOINT = 'https://safebrowsing.googleapis.com';

// Liste koje Chromium (kLocalListsUseSBv5, desktop) koristi za provjeru adresa:
// GetV5ListName(): SB_THREAT_TYPE_URL_PHISHING -> "se-4b", URL_MALWARE -> "mw-4b", URL_UNWANTED -> "uws-4b"
export const LISTS = [
  { name: 'se-4b', sbType: 'URL_PHISHING' },
  { name: 'mw-4b', sbType: 'URL_MALWARE' },
  { name: 'uws-4b', sbType: 'URL_UNWANTED' },
];
export const PREFIX_SIZE = 4;

// safebrowsingv5.proto ThreatType / ThreatAttribute
export const ThreatType = {
  THREAT_TYPE_UNSPECIFIED: 0, MALWARE: 1, SOCIAL_ENGINEERING: 2, UNWANTED_SOFTWARE: 3,
  POTENTIALLY_HARMFUL_APPLICATION: 4, MALICIOUS_BINARY: 7, SUBRESOURCE_FILTER: 13, TRICK_TO_BILL: 15,
  ABUSIVE_EXPERIENCE_VIOLATION: 20, BETTER_ADS_VIOLATION: 21, NOTIFICATION_ABUSE: 24,
};
export const ThreatAttribute = { THREAT_ATTRIBUTE_UNSPECIFIED: 0, CANARY: 1, FRAME_ONLY: 2 };
const VALID_THREAT_TYPES = new Set(Object.values(ThreatType));
const VALID_ATTRIBUTES = new Set(Object.values(ThreatAttribute));

export const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
export const prefixBytes = (p) => Uint8Array.of(p >>> 24, (p >>> 16) & 255, (p >>> 8) & 255, p & 255);

export class GsbError extends Error {
  constructor(code, detail = '') { super(detail ? `${code}: ${detail}` : code); this.code = code; }
}

// ---------- hashLists:batchGet ----------

export function batchGetUrl(endpoint, reqBase64, key) {
  return `${endpoint.replace(/\/+$/, '')}/v5/hashLists:batchGet?$req=${reqBase64}&$ct=application/x-protobuf&key=${encodeURIComponent(key)}`;
}
export function searchUrl(endpoint, reqBase64, key) {
  return `${endpoint.replace(/\/+$/, '')}/v5/hashes:search?$req=${reqBase64}&$ct=application/x-protobuf&key=${encodeURIComponent(key)}`;
}

// Provjera odgovora kao V5UpdateProtocolManager::ParseUpdateResponse.
// requested: imena lista istim redom kao u zahtjevu. Vraća { lists, minWaitMs }.
export function validateBatchResponse(resp, requested) {
  if (resp.hashLists.length !== requested.length) throw new GsbError('kMismatchedSizeError', `${resp.hashLists.length} != ${requested.length}`);
  let minWait = null;
  resp.hashLists.forEach((hl, i) => {
    if (!hl.name || hl.name !== requested[i]) throw new GsbError('kMismatchedNameError', `${hl.name} != ${requested[i]}`);
    if (hl.additionsPrefixSize !== null && hl.additionsPrefixSize !== PREFIX_SIZE) throw new GsbError('kMismatchedPrefixLengthError', hl.name);
    try {
      if (hl.additionsFourBytes) validateRice32(hl.additionsFourBytes.riceParameter, hl.additionsFourBytes.entriesCount);
      if (hl.compressedRemovals) validateRice32(hl.compressedRemovals.riceParameter, hl.compressedRemovals.entriesCount);
    } catch (e) { throw new GsbError('kInvalidRiceFieldError', `${hl.name}: ${e.code}`); }
    const hasChanges = !!hl.additionsFourBytes || !!hl.compressedRemovals;
    if (hasChanges && !hl.sha256Checksum.length) throw new GsbError('kChecksumMissingError', hl.name);
    if (hl.sha256Checksum.length && hl.sha256Checksum.length !== 32) throw new GsbError('kChecksumSizeError', hl.name);
    const w = hl.minimumWaitDuration ? durationMs(hl.minimumWaitDuration) : 0;
    if (w < 0) throw new GsbError('kNegativeDurationError', hl.name);
    if (minWait === null || w < minWait) minWait = w;
  });
  return { lists: resp.hashLists, minWaitMs: minWait ?? 0 };
}

// SHA-256 nad sortiranim prefiksima zapisanim big-endian (VerifyChecksumInternal)
export async function checksum(prefixes) {
  const be = new Uint8Array(prefixes.length * 4);
  const dv = new DataView(be.buffer);
  for (let i = 0; i < prefixes.length; i++) dv.setUint32(i * 4, prefixes[i]);
  return new Uint8Array(await crypto.subtle.digest('SHA-256', be));
}
const sameBytes = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// SBStore::MergeUpdateLoop: removals su indeksi u STAROJ sortiranoj listi.
export function merge(oldPrefixes, additions, removals) {
  const out = new Uint32Array(oldPrefixes.length + additions.length);
  let i = 0, j = 0, r = 0, o = 0;
  while (i < oldPrefixes.length || j < additions.length) {
    let fromOld = i < oldPrefixes.length;
    if (fromOld && j < additions.length) {
      if (oldPrefixes[i] === additions[j]) throw new GsbError('kAdditionsHasExistingPrefixFailure');
      fromOld = oldPrefixes[i] < additions[j];
    }
    if (fromOld) {
      if (r < removals.length && removals[r] === i) { i++; r++; continue; }
      out[o++] = oldPrefixes[i++];
    } else {
      if (j > 0 && additions[j] <= additions[j - 1]) throw new GsbError('kAdditionsNotSorted');
      out[o++] = additions[j++];
    }
  }
  if (r < removals.length) throw new GsbError('kRemovalsIndexTooLargeFailure');
  return out.slice(0, o);
}

// V5Store::ApplyUpdateInternal/ProcessUpdate. old = { prefixes: Uint32Array, checksum: Uint8Array }.
// Vraća novo stanje liste { prefixes, checksum, version }.
export async function applyHashList(old, hl) {
  let removals = new Uint32Array(0), additions = new Uint32Array(0);
  try {
    if (hl.compressedRemovals) removals = decodeRice32(hl.compressedRemovals);
  } catch (e) { throw new GsbError('kRiceDecodingRemovalsFailure', e.code || e.message); }
  try {
    if (hl.additionsFourBytes) additions = decodeRice32(hl.additionsFourBytes);
  } catch (e) { throw new GsbError('kRiceDecodingAdditionsFailure', e.code || e.message); }
  const base = hl.partialUpdate && old ? old.prefixes : new Uint32Array(0);
  const expected = hl.sha256Checksum.length ? hl.sha256Checksum : (hl.partialUpdate && old ? old.checksum : new Uint8Array(0));
  if (!expected || !expected.length) throw new GsbError('kChecksumMismatchFailure', 'nema kontrolnog zbira');
  const prefixes = merge(base, additions, removals);
  const sum = await checksum(prefixes);
  if (!sameBytes(sum, expected)) throw new GsbError('kChecksumMismatchFailure');
  return { prefixes, checksum: Uint8Array.from(expected), version: Uint8Array.from(hl.version) };
}

// Backoff kao kV5UpdateBackoffPolicy: 30 min * 2^(n-1), jitter 0.5, najviše 24 h
export function updateBackoffMs(errorCount, rnd = Math.random()) {
  const base = Math.min(30 * 60e3 * 2 ** Math.max(0, errorCount - 1), 24 * 3600e3);
  return Math.round(base * (1 - 0.5 * rnd));
}

// ---------- pretraga ----------

export function contains(sorted, v) {
  let lo = 0, hi = sorted.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] === v) return true;
    if (sorted[mid] < v) lo = mid + 1; else hi = mid - 1;
  }
  return false;
}

// Za svaki heš adrese: koje lokalne liste sadrže njegov 4-bajtni prefiks.
// hashes: [{hash, prefix}] (url.js urlHashes), lists: Map(ime -> Uint32Array)
export function localHits(hashes, lists) {
  const hits = [];
  for (const h of hashes) {
    const types = [];
    for (const l of LISTS) {
      const arr = lists.get(l.name);
      if (arr && contains(arr, h.prefix)) types.push(l.sbType);
    }
    if (types.length) hits.push({ ...h, sbTypes: types });
  }
  return hits;
}

// v5_search_hashes_util::ParseResponse (bez mrežnog dijela)
export function validateSearchResponse(resp, requestedPrefixesHex) {
  if (!resp.cacheDuration) throw new GsbError('kNoCacheDurationError');
  for (const fh of resp.fullHashes) if (fh.fullHash.length !== 32) throw new GsbError('kIncorrectFullHashLengthError');
  const want = new Set(requestedPrefixesHex);
  const fullHashes = resp.fullHashes
    .filter((fh) => want.has(toHex(fh.fullHash.subarray(0, 4))))
    .map((fh) => ({
      fullHash: toHex(fh.fullHash),
      details: fh.details.filter((d) => VALID_THREAT_TYPES.has(d.threatType) && d.attributes.every((a) => VALID_ATTRIBUTES.has(a))),
    }));
  return { fullHashes, cacheMs: durationMs(resp.cacheDuration) };
}

// IsHashDetailRelevantForLocalChecks (desktop)
export function isRelevantForLocalChecks(d) {
  const canary = d.attributes.includes(ThreatAttribute.CANARY);
  const frameOnly = d.attributes.includes(ThreatAttribute.FRAME_ONLY);
  if (canary && frameOnly) return false;
  switch (d.threatType) {
    case ThreatType.SOCIAL_ENGINEERING: case ThreatType.ABUSIVE_EXPERIENCE_VIOLATION: case ThreatType.BETTER_ADS_VIOLATION:
      return true;
    case ThreatType.MALWARE: case ThreatType.POTENTIALLY_HARMFUL_APPLICATION: case ThreatType.MALICIOUS_BINARY:
    case ThreatType.UNWANTED_SOFTWARE: case ThreatType.TRICK_TO_BILL: case ThreatType.NOTIFICATION_ABUSE:
      return !canary;
    default:
      return false;
  }
}

// MapFullHashDetailToSbThreatType
export function sbThreatType(d) {
  if (d.threatType === ThreatType.SOCIAL_ENGINEERING && d.attributes.includes(ThreatAttribute.CANARY)) return 'SUSPICIOUS_SITE';
  switch (d.threatType) {
    case ThreatType.MALWARE: case ThreatType.POTENTIALLY_HARMFUL_APPLICATION: return 'URL_MALWARE';
    case ThreatType.SOCIAL_ENGINEERING: return 'URL_PHISHING';
    case ThreatType.UNWANTED_SOFTWARE: return 'URL_UNWANTED';
    case ThreatType.TRICK_TO_BILL: return 'BILLING';
    case ThreatType.MALICIOUS_BINARY: return 'URL_BINARY_MALWARE';
    case ThreatType.ABUSIVE_EXPERIENCE_VIOLATION: case ThreatType.BETTER_ADS_VIOLATION: return 'SUBRESOURCE_FILTER';
    case ThreatType.NOTIFICATION_ABUSE: return 'API_ABUSE';
    default: return null;
  }
}
const SEVERITY = { URL_MALWARE: 0, URL_PHISHING: 0, URL_BINARY_MALWARE: 0, URL_UNWANTED: 1 };

// Blokira se samo potvrđeni puni heš čija vrsta prijetnje odgovara listi u kojoj je bio prefiks
// (V5GetHashProtocolManager::DetermineThreatTypeAndMetadata). Vraća 'URL_PHISHING' itd. ili null.
export function decideThreat(hits, fullHashesByHex) {
  let best = null;
  for (const hit of hits) {
    const hex = toHex(hit.hash);
    for (const fh of fullHashesByHex.get(hex) || []) {
      for (const d of fh.details) {
        if (!isRelevantForLocalChecks(d)) continue;
        const t = sbThreatType(d);
        if (!t || !hit.sbTypes.includes(t)) continue;
        if (best === null || (SEVERITY[t] ?? 99) < (SEVERITY[best] ?? 99)) best = t;
      }
    }
  }
  return best;
}
