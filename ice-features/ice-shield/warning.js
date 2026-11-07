// #danger|<adresa>  ili  #https|<adresa>
const [kind, enc] = location.hash.slice(1).split('|');
const url = decodeURIComponent(enc || '');
let host = '';
try { host = new URL(url).hostname; } catch { /* neispravna adresa */ }

const TEXT = {
  danger: {
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
const t = TEXT[kind] || TEXT.danger;
document.querySelector('h1').textContent = t.title;
document.getElementById('text').textContent = t.body;
document.getElementById('go').textContent = t.go;
document.getElementById('host').textContent = host;
document.title = `${t.title}: ${host}`;

document.getElementById('back').onclick = () => chrome.tabs.update({ url: 'chrome://newtab/' });
document.getElementById('go').onclick = async () => {
  if (!host) return;
  const r = await chrome.runtime.sendMessage({ type: 'proceed', kind: kind === 'https' ? 'https' : 'danger', url });
  if (r?.ok) location.replace(url);
};
