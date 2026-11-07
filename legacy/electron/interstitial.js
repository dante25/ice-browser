// Stranice upozorenja (ice://warning). Dugme "nastavi" radi samo s jednokratnim
// tokenom i samo sa same stranice upozorenja, pa ga druga stranica ne može zaobići.
const crypto = require('crypto');

const pending = new Map(); // token -> { kind, url, host }

function create(kind, url) {
  const token = crypto.randomBytes(16).toString('hex');
  pending.set(token, { kind, url, host: new URL(url).hostname });
  if (pending.size > 200) pending.delete(pending.keys().next().value);
  return `ice://warning/?t=${token}`;
}

const get = (t) => pending.get(t);
function take(t) {
  const v = pending.get(t);
  pending.delete(t);
  return v;
}

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const TEXT = {
  phishing: {
    title: 'Opasna stranica',
    body: 'Ice je blokirao ovu stranicu jer je na listi opasnih stranica: krađa podataka (phishing), zlonamjerni softver (malware) ili prevara. Takve stranice se često lažno predstavljaju kao banka, Google ili druga poznata stranica, ili pokušavaju podmetnuti virus kroz preuzimanje.',
    go: 'Ipak otvori (ne preporučuje se)',
  },
  https: {
    title: 'Stranica nema sigurnu vezu',
    body: 'Ova stranica ne podržava HTTPS. Sve što pošalješ, uključujući lozinke i poruke, može vidjeti i promijeniti neko na istoj mreži.',
    go: 'Nastavi bez sigurne veze',
  },
};

const STYLE = `
:root{--bg:#fff;--fg:#1d1d1f;--muted:#5c5c66;--accent:#b3261e;--btn:#1d1d1f;--btnfg:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#18181b;--fg:#ececf1;--muted:#a1a1aa;--accent:#f2827a;--btn:#ececf1;--btnfg:#18181b}}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.55 system-ui,sans-serif}
main{max-width:560px;margin:14vh auto 0;padding:0 24px}
h1{font-size:26px;margin:0 0 6px;color:var(--accent)}
.host{font-family:ui-monospace,monospace;color:var(--muted);margin:0 0 20px;word-break:break-all}
.row{display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin-top:28px}
.btn{background:var(--btn);color:var(--btnfg);padding:10px 18px;border-radius:8px;text-decoration:none;font-weight:600}
.go{color:var(--muted);font-size:14px}`;

function page(token) {
  const p = get(token);
  const head = `<!doctype html><html lang="bs"><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`;
  if (!p) return `${head}<title>Ice</title><style>${STYLE}</style><main><p>Ovo upozorenje je isteklo.</p><div class="row"><a class="btn" href="ice://back/">Nazad</a></div></main>`;
  const x = TEXT[p.kind];
  return `${head}<title>${x.title}</title><style>${STYLE}</style><main>
<h1>${x.title}</h1><p class="host">${esc(p.host)}</p><p>${x.body}</p>
<div class="row"><a class="btn" href="ice://back/">Nazad na sigurno</a><a class="go" href="ice://proceed/?t=${token}">${x.go}</a></div>
</main>`;
}

function register(protocol) {
  protocol.handle('ice', (req) => {
    const u = new URL(req.url);
    if (u.hostname === 'warning') {
      return new Response(page(u.searchParams.get('t')), { headers: { 'content-type': 'text/html; charset=utf-8' } });
    }
    return new Response('', { status: 404 });
  });
}

module.exports = { create, get, take, register };
