// Shared HLS playlist helpers (loaded by popup.html and downloader.html).
const abs = (u, base) => new URL(u, base).href;

function attrs(line) {
  const out = {};
  for (const m of line.slice(line.indexOf(':') + 1).matchAll(/([A-Z0-9-]+)=("[^"]*"|[^,]*)/g)) out[m[1]] = m[2].replace(/^"|"$/g, '');
  return out;
}

// All variants of a master playlist, best first. Nothing is filtered out.
function parseMaster(text, base) {
  const lines = text.split(/\r?\n/);
  const variants = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].startsWith('#EXT-X-STREAM-INF')) continue;
    const a = attrs(lines[i]);
    const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
    if (!uri) continue;
    const [w, h] = (a.RESOLUTION || '').split('x').map(Number);
    variants.push({ url: abs(uri, base), bandwidth: Number(a.BANDWIDTH) || 0, width: w || 0, height: h || 0, audio: !!a.AUDIO });
  }
  return variants.sort((a, b) => b.height - a.height || b.bandwidth - a.bandwidth);
}

function variantLabel(v) {
  const q = v.height ? `${v.height}p` : 'auto';
  return v.bandwidth ? `${q} · ${(v.bandwidth / 1e6).toFixed(1)} Mbps` : q;
}
