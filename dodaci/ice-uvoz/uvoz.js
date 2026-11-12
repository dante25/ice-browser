// Uvoz iz drugog browsera: stranica dodatka (otvara se u Ice panelu ili kao popup).
// Posao radi /opt/ice-browser/uvoz/ice-uvoz.py preko native messaginga ("ice.uvoz").
// Tekst iz hosta se uvijek postavlja kao tekst (nikad kao HTML).
const WHAT = { bookmarks: 'Bookmarks', history: 'Historija', passwords: 'Lozinke', settings: 'Dozvole stranica i zoom' };
const main = document.getElementById('main');
const lastBox = document.getElementById('last');

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== null && v !== undefined && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
function host(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage('ice.uvoz', msg, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      r && r.ok ? resolve(r) : reject(new Error((r && r.error) || 'Nije uspjelo.'));
    });
  });
}

function showLast(last) {
  if (!last) return;
  lastBox.hidden = false;
  lastBox.replaceChildren(el('b', {}, `Zadnji uvoz · ${new Date(last.when).toLocaleString()}`));
  if (last.error) lastBox.append(el('div', { class: 'err' }, `Greška: ${last.error}`));
  else lastBox.append(el('div', {}, last.label), ...Object.entries(last.report || {}).map(([k, v]) => el('div', { class: String(v).startsWith('GREŠKA') ? 'err' : '' }, `${k}: ${v}`)));
}

async function start() {
  let data;
  try { data = await host({ cmd: 'list' }); } catch (e) {
    main.replaceChildren(el('p', { class: 'note err' }, `Uvoz nije dostupan: ${e.message}`));
    return;
  }
  showLast(data.last);
  if (!data.sources.length) {
    main.replaceChildren(el('p', { class: 'note' }, 'Na ovom računaru nije pronađen nijedan drugi browser (Chrome, Chromium, Brave, Edge, Vivaldi, Opera, Firefox).'));
    return;
  }
  let chosen = data.sources[0];
  const what = el('div', { class: 'what' });
  const note = el('p', { class: 'note' }, 'Podaci se dodaju postojećim, ništa se ne briše. Ice se zatvara i ponovo otvara (otvoreni tabovi se zatvaraju). Prije uvoza se pravi rezervna kopija.');
  const go = el('button', { id: 'go' }, 'Uvezi i ponovo pokreni Ice');
  const drawWhat = () => what.replaceChildren(...Object.entries(WHAT).map(([k, t]) => {
    const can = chosen.can.includes(k);
    return el('label', { class: can ? '' : 'off' }, el('input', { type: 'checkbox', value: k, checked: can, disabled: !can }), ` ${t}${can ? '' : ' (nije podržano za ovaj browser)'}`);
  }));
  const list = el('div', { class: 'chips' }, ...data.sources.map((s, i) => el('button', { class: `chip${i ? '' : ' on'}`, onclick: (ev) => {
    list.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
    ev.currentTarget.classList.add('on');
    chosen = s; drawWhat();
  } }, s.label)));
  drawWhat();
  go.addEventListener('click', async () => {
    const sel = [...what.querySelectorAll('input:checked')].map((i) => i.value);
    if (!sel.length) { note.textContent = 'Odaberi šta se uvozi.'; return; }
    go.disabled = true; note.textContent = 'Zatvaram Ice i uvozim...';
    try { await host({ cmd: 'start', source: chosen.id, what: sel }); } catch (e) { go.disabled = false; note.textContent = `Greška: ${e.message}`; note.classList.add('err'); }
  });
  main.replaceChildren(el('h2', {}, 'Odakle'), list, el('h2', {}, 'Šta'), what, go, note,
    el('p', { class: 'note' }, 'Firefox lozinke: izvezi ih u CSV u Firefoxu, pa uvezi u Lozinke → Postavke → Uvoz lozinki.'));
}
start();
