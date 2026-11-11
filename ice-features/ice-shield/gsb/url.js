// Kanonizacija adrese i izrazi (host sufiksi x prefiksi putanje) za Safe Browsing v5,
// prema Chromium 156 components/safe_browsing/core/browser/db/sb_protocol_manager_util.cc
// (CanonicalizeUrl, GenerateHostVariantsToCheckV5, GeneratePathVariantsToCheck, UrlToFullHashes).
// Stringovi su "binarni": svaki znak je jedan bajt (0-255).

import { PSL_NORMAL, PSL_WILDCARD, PSL_EXCEPTION } from './psl.js';

const STANDARD = new Set(['http:', 'https:', 'ftp:', 'ws:', 'wss:']);
const isHex = (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102);

// base::UnescapeBinaryURLComponent: dekodira svaki %XX
function unescapeOnce(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (s.charCodeAt(i) === 37 && i + 2 < s.length && isHex(s.charCodeAt(i + 1)) && isHex(s.charCodeAt(i + 2))) {
      out += String.fromCharCode(parseInt(s.substr(i + 1, 2), 16));
      i += 2;
    } else out += s[i];
  }
  return out;
}
// Unescape(): ponavlja dok se dužina ne prestane mijenjati (najviše 1024 puta)
function unescapeAll(s) {
  let old, n = 0;
  do { old = s.length; s = unescapeOnce(s); } while (old !== s.length && ++n <= 1024);
  return s;
}
// Escape(): %XX (velika slova) za znakove <= 32, >= 127, '#', '%'
function escape(s) {
  let out = '';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    out += c <= 32 || c > 126 || c === 35 || c === 37 ? '%' + c.toString(16).toUpperCase().padStart(2, '0') : s[i];
  }
  return out;
}

// Pojednostavljeni url::ParseStandardUrl za već kanonsku adresu (bez korisnika/lozinke).
function parseStandard(s) {
  const colon = s.indexOf(':');
  const scheme = s.slice(0, colon);
  let i = colon + 1;
  while (s[i] === '/' || s[i] === '\\') i++;
  let j = i;
  while (j < s.length && !'/\\?#'.includes(s[j])) j++;
  const auth = s.slice(i, j);
  let host = auth, port = '';
  const pc = auth.lastIndexOf(':');
  if (pc !== -1 && pc > auth.lastIndexOf(']')) { host = auth.slice(0, pc); port = auth.slice(pc + 1); }
  const rest = s.slice(j);
  const hashAt = rest.indexOf('#');
  const beforeRef = hashAt === -1 ? rest : rest.slice(0, hashAt);
  const ref = hashAt === -1 ? null : rest.slice(hashAt + 1);
  const qAt = beforeRef.indexOf('?');
  const path = qAt === -1 ? beforeRef : beforeRef.slice(0, qAt);
  const query = qAt === -1 ? null : beforeRef.slice(qAt + 1);
  return { scheme, host, port, path, query, ref };
}

const collapse = (s, ch) => s.replace(new RegExp(`\\${ch}{2,}`, 'g'), ch);

// Kanonska putanja kao u url::ReplaceComponents: '\' -> '/', razriješi "." i ".."
function canonPath(path) {
  path = path.replace(/\\/g, '/');
  if (!path.startsWith('/')) path = '/' + path;
  const segs = path.split('/');
  const out = [];
  for (let i = 1; i < segs.length; i++) {
    const seg = segs[i], lastSeg = i === segs.length - 1;
    if (seg === '.' || seg === '..') {
      if (seg === '..') out.pop();
      if (lastSeg) out.push('');
      continue;
    }
    out.push(seg);
  }
  return '/' + out.join('/');
}

function canonHost(host) {
  host = host.toLowerCase();
  // IPv4 u neobičnom obliku (npr. nakon skidanja tačaka) -> isti parser kao za cijelu adresu
  if (/^[0-9a-fx.]+$/.test(host)) {
    try { return new URL(`http://${host}/`).hostname; } catch { /* ostavi kako jeste */ }
  }
  return host;
}

// Vraća { host, path, query, isIp } ili null za adrese koje se ne provjeravaju.
export function canonicalize(input) {
  let u;
  try { u = new URL(String(input)); } catch { return null; }
  if (!STANDARD.has(u.protocol)) return null;
  u.hash = '';
  u.username = '';
  u.password = '';
  let spec = u.href;
  if (spec.endsWith('#')) spec = spec.slice(0, -1);

  // 2. odkodiraj sve %XX
  const p = parseStandard(unescapeAll(spec));
  // 3. i 4. tačke u hostu; 5. kose crte u putanji
  const host = canonHost(collapse(p.host.replace(/^\.+|\.+$/g, ''), '.'));
  const path = canonPath(collapse(p.path, '/'));
  let rebuilt = `${p.scheme}://${host}${p.port ? ':' + p.port : ''}${path}`;
  if (p.query !== null) rebuilt += '?' + p.query;
  if (p.ref !== null) rebuilt += '#' + p.ref;
  // 6. ponovo odkodiraj, 7. kodiraj <=32, >=127, '#', '%'
  const f = parseStandard(escape(unescapeAll(rebuilt)));
  const isIp = /^\d{1,3}(\.\d{1,3}){3}$/.test(u.hostname) || u.hostname.startsWith('[');
  return { host: isIp ? u.hostname : f.host, path: f.path, query: f.query || '', isIp };
}

// ---------- eTLD+1 (net::registry_controlled_domains, EXCLUDE_PRIVATE_REGISTRIES) ----------

let psl = null;
function rules() {
  return (psl ||= {
    normal: new Set(PSL_NORMAL.split(',')),
    wildcard: new Set(PSL_WILDCARD.split(',')),
    exception: new Set(PSL_EXCEPTION.split(',')),
  });
}

// Vraća eTLD+1, ili '' ako ga nema (jedna labela, ili je host sam registar).
export function domainAndRegistry(host) {
  if (!host || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.startsWith('[')) return '';
  const { normal, wildcard, exception } = rules();
  const labels = host.split('.');
  const n = labels.length;
  let regLabels = 1; // nepoznat registar: zadnja labela (kao Chromium za nepoznate TLD-ove)
  for (let i = 0; i < n; i++) {
    const suffix = labels.slice(i).join('.');
    const parent = i + 1 < n ? labels.slice(i + 1).join('.') : '';
    if (exception.has(suffix)) { regLabels = n - i - 1; break; }
    if (normal.has(suffix) || (parent && wildcard.has(parent))) { regLabels = n - i; break; }
  }
  if (regLabels >= n) return '';
  return labels.slice(n - regLabels - 1).join('.');
}

// GenerateHostVariantsToCheckV5
export function hostVariants(host) {
  if (!host) return [];
  const etld1 = domainAndRegistry(host);
  if (!etld1) return [host];
  const hosts = [etld1];
  if (host.length > etld1.length) {
    let dot = host.length - etld1.length - 1;
    while (hosts.length < 4) {
      dot = host.lastIndexOf('.', dot - 1);
      if (dot === -1 || dot < 0) break;
      hosts.push(host.slice(dot + 1));
    }
    hosts.push(host);
  }
  return hosts;
}

// GeneratePathVariantsToCheck
export function pathVariants(path, query) {
  if (!path) return [];
  const paths = [];
  for (let i = 0; i < path.length && paths.length < 4; i++) {
    if (path[i] === '/') paths.push(path.slice(0, i + 1));
  }
  if (paths.length && paths[paths.length - 1] !== path) paths.push(path);
  if (query) paths.push(path + '?' + query);
  return paths;
}

// Svi izrazi host+putanja koje treba heširati (UrlToFullHashes)
export function urlExpressions(input) {
  const c = canonicalize(input);
  if (!c || !c.host) return [];
  const hosts = c.isIp ? [c.host] : hostVariants(c.host);
  const paths = pathVariants(c.path, c.query);
  const out = [];
  for (const h of hosts) for (const p of paths) out.push(h + p);
  return [...new Set(out)];
}

export async function sha256(binaryString) {
  const b = new Uint8Array(binaryString.length);
  for (let i = 0; i < b.length; i++) b[i] = binaryString.charCodeAt(i) & 0xff;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', b));
}

// [{ expr, hash (32 bajta), prefix (uint32, big-endian prva 4 bajta) }]
export async function urlHashes(input) {
  const out = [];
  for (const expr of urlExpressions(input)) {
    const hash = await sha256(expr);
    out.push({ expr, hash, prefix: ((hash[0] << 24) | (hash[1] << 16) | (hash[2] << 8) | hash[3]) >>> 0 });
  }
  return out;
}
