// Generiše gsb/psl.js (samo ICANN dio Public Suffix liste, kao Chromium-ov
// EXCLUDE_PRIVATE_REGISTRIES) iz Chromium-ovog fajla:
//   net/base/registry_controlled_domains/effective_tld_names.gperf
// Upotreba: node tests/gen-psl.mjs <effective_tld_names.gperf>
// Zastavice u gperf fajlu: 0 = obično, 1 = izuzetak (!), 2 = wildcard (*.), 4 = privatno.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = process.argv[2];
if (!src) { console.error('upotreba: node tests/gen-psl.mjs <effective_tld_names.gperf>'); process.exit(1); }
const n = [], e = [], w = [];
let inBody = false;
for (const line of fs.readFileSync(src, 'utf8').split('\n')) {
  if (line === '%%') { inBody = !inBody; continue; }
  if (!inBody) continue;
  const m = /^([^,]+), (\d+)$/.exec(line);
  if (!m) continue;
  const flags = Number(m[2]);
  if (flags & 4) continue; // privatni registri (appspot.com, github.io...) se ne računaju
  if (flags & 1) e.push(m[1]);
  else if (flags & 2) w.push(m[1]);
  else n.push(m[1]);
}
const out = `// Generisano: node tests/gen-psl.mjs (Chromium 156 effective_tld_names.gperf, samo ICANN pravila).
// Ne mijenjati ručno.
export const PSL_NORMAL = ${JSON.stringify(n.join(','))};
export const PSL_WILDCARD = ${JSON.stringify(w.join(','))};
export const PSL_EXCEPTION = ${JSON.stringify(e.join(','))};
`;
const dst = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'gsb', 'psl.js');
fs.writeFileSync(dst, out);
console.log(`psl.js: ${n.length} pravila, ${w.length} wildcard, ${e.length} izuzetaka`);
