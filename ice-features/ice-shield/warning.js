// #danger|<adresa>[|<izvor>|<prijetnja>]  ili  #https|<adresa>
// izvor: lists (javne liste) ili google (Google Safe Browsing)
const [kind, enc, source = '', threat = ''] = location.hash.slice(1).split('|');
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

const THREAT = {
  URL_PHISHING: 'krađa podataka (phishing / socijalni inženjering)',
  URL_MALWARE: 'zlonamjerni softver (malware)',
  URL_UNWANTED: 'neželjeni softver',
};
const src = document.getElementById('source');
if (kind === 'danger' && source === 'google') {
  src.append(`Izvor: Google Safe Browsing${THREAT[threat] ? ` (${THREAT[threat]})` : ''}. Savjet pruža Google (`);
  const a = document.createElement('a');
  a.href = 'https://developers.google.com/safe-browsing/v4/advisory';
  a.target = '_blank';
  a.rel = 'noreferrer';
  a.textContent = 'Advisory provided by Google';
  src.append(a, ').');
} else if (kind === 'danger' && source === 'lists') {
  src.textContent = 'Izvor: javne liste opasnih stranica (Phishing Database, OpenPhish, URLhaus, HaGeZi TIF).';
}

document.getElementById('back').onclick = () => chrome.tabs.update({ url: 'chrome://newtab/' });
document.getElementById('go').onclick = async () => {
  if (!host) return;
  const r = await chrome.runtime.sendMessage({ type: 'proceed', kind: kind === 'https' ? 'https' : 'danger', url });
  if (r?.ok) location.replace(url);
};
