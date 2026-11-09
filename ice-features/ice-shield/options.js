// Postavke Ice Shielda: API ključ za Google Safe Browsing i stanje lokalnih lista.
const $ = (id) => document.getElementById(id);
const LISTS = [['se-4b', 'phishing / socijalni inženjering'], ['mw-4b', 'malware'], ['uws-4b', 'neželjeni softver']];
const fmt = (t) => (t ? new Date(t).toLocaleString('bs-BA') : '–');

async function render() {
  const { gsbApiKey = '', gsbState: st = {} } = await chrome.storage.local.get(['gsbApiKey', 'gsbState']);
  if (document.activeElement !== $('key')) $('key').value = gsbApiKey;
  const on = !!gsbApiKey;
  $('state').textContent = on ? 'uključeno' : 'isključeno (nema API ključa)';
  $('state').className = on ? 'on' : 'off';
  $('update').disabled = !on;
  $('remove').disabled = !on;
  $('last').textContent = fmt(st.lastUpdate);
  $('next').textContent = on ? fmt(st.nextUpdate) : '–';
  $('lists').replaceChildren(...LISTS.map(([name, label]) => {
    const tr = document.createElement('tr');
    const n = st.lists?.[name]?.count ?? 0;
    for (const [text, cls] of [[name, ''], [label, ''], [n.toLocaleString('bs-BA'), 'num']]) {
      const td = document.createElement('td');
      td.textContent = text;
      if (cls) td.className = cls;
      tr.append(td);
    }
    return tr;
  }));
  const errs = [st.lastError && `${st.lastError} (${fmt(st.lastErrorTime)})`, st.lastSearchError && `provjera: ${st.lastSearchError} (${fmt(st.lastSearchErrorTime)})`].filter(Boolean);
  $('error').textContent = errs.length ? errs.join(' · ') : '–';
  $('error').className = errs.length ? 'err' : '';
}

const say = (t) => { $('msg').textContent = t; };

$('show').onclick = () => {
  const k = $('key');
  k.type = k.type === 'password' ? 'text' : 'password';
  $('show').textContent = k.type === 'password' ? 'Prikaži' : 'Sakrij';
};
$('save').onclick = async () => {
  const key = $('key').value.trim();
  if (!key) { say('Unesi ključ.'); return; }
  await chrome.storage.local.set({ gsbApiKey: key });
  say('Sačuvano. Liste se preuzimaju…');
};
$('remove').onclick = async () => {
  await chrome.storage.local.remove('gsbApiKey');
  $('key').value = '';
  say('Ključ uklonjen; Google provjere su isključene.');
};
$('update').onclick = async () => {
  $('update').disabled = true;
  say('Ažuriram…');
  try {
    const r = await chrome.runtime.sendMessage({ type: 'gsb-update' });
    if (r?.ok) say('Liste su ažurirane.');
    else if (r?.skipped === 'min-wait') say(`Google traži pauzu između ažuriranja; sljedeće je moguće ${fmt(r.until)}.`);
    else say(`Greška: ${r?.error || 'nepoznata'}`);
  } catch (e) { say(`Greška: ${e.message}`); }
  render();
};

chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && (ch.gsbState || ch.gsbApiKey)) render(); });
render();
