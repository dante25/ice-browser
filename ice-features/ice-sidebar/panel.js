// Ice panel: traka s ikonama lijevo, sadržaj desno. Sve se otvara unutar panela.
// Tekst iz bookmarksa/historije se uvijek postavlja kao tekst (nikad kao HTML).

const rail = document.getElementById('rail');
const view = document.getElementById('view');
let features = [];
let current = null;

function el(tag, attrs = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k === 'html') { if (v !== undefined) e.innerHTML = v; } // samo za naše ikone, nikad za podatke
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c !== null && c !== undefined && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}
const fav = (url) => {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', url);
  u.searchParams.set('size', '32');
  return el('img', { src: u.toString(), alt: '' });
};
const openUrl = (url, e) => {
  if (e && (e.ctrlKey || e.metaKey || e.button === 1)) chrome.tabs.create({ url, active: false });
  else chrome.tabs.update({ url });
};
const head = (title, ...extra) => el('div', { class: 'head' }, el('h1', {}, title, ...extra));

// ---------- Glavni meni ----------
function viewMenu() {
  const item = (ic, t, fn, s) => el('button', { class: 'item', onclick: fn }, el('span', { class: 'ico', html: icon(ic) }), el('span', { class: 'tt' }, el('span', { class: 't' }, t), s ? el('span', { class: 's' }, s) : null));
  const tabUrl = (u) => () => chrome.tabs.create({ url: u });
  return [
    head('Ice'),
    el('div', { class: 'body' },
      item('tab', 'Novi tab', () => chrome.tabs.create({}), 'Ctrl+T'),
      item('window', 'Novi prozor', () => chrome.windows.create({}), 'Ctrl+N'),
      item('incognito', 'Privatni prozor', () => chrome.windows.create({ incognito: true }), 'Ctrl+Shift+N'),
      el('div', { class: 'grp' }, 'Brzo'),
      item('star', 'Bookmarks', () => show('bookmarks')),
      item('history', 'Historija', () => show('history')),
      item('download', 'Preuzimanja', () => show('downloads')),
      item('puzzle', 'Funkcije', () => show('features')),
      item('download', 'Uvoz iz drugog browsera', () => show('import')),
      el('div', { class: 'grp' }, 'Chromium stranice'),
      item('star', 'Upravljanje bookmarksima', tabUrl('chrome://bookmarks/')),
      item('shield', 'Lozinke', tabUrl('chrome://password-manager/passwords')),
      item('settings', 'Postavke preglednika', tabUrl('chrome://settings/')),
      item('puzzle', 'Ekstenzije', tabUrl('chrome://extensions/')),
    ),
  ];
}

// ---------- Bookmarks ----------
function bmNode(n) {
  if (n.url) {
    return el('button', { class: 'item', title: n.url, onclick: (e) => openUrl(n.url, e), onauxclick: (e) => e.button === 1 && openUrl(n.url, e) },
      el('span', { class: 'ico' }, fav(n.url)), el('span', { class: 't' }, n.title || n.url));
  }
  const wrap = el('div', { class: 'folder' });
  const kids = el('div', { class: 'kids' });
  wrap.append(el('button', { class: 'item', onclick: () => {
    wrap.classList.toggle('open');
    if (!kids.childElementCount) for (const c of n.children || []) kids.append(bmNode(c));
  } }, el('span', { class: 'ico', html: icon('folder') }), el('span', { class: 't' }, n.title || 'Folder'), el('span', { class: 's' }, String((n.children || []).length))), kids);
  return wrap;
}
async function viewBookmarks() {
  const q = el('input', { class: 'search', placeholder: 'Traži bookmarks', type: 'search' });
  const body = el('div', { class: 'body' });
  const [root] = await chrome.bookmarks.getTree();
  const renderTree = () => { body.replaceChildren(...root.children.map((r) => { const f = bmNode(r); f.classList.add('open'); f.querySelector('.kids').append(...(r.children || []).map(bmNode)); return f; })); };
  let timer;
  q.addEventListener('input', () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      if (!q.value.trim()) return renderTree();
      const res = (await chrome.bookmarks.search(q.value.trim())).filter((b) => b.url).slice(0, 200);
      body.replaceChildren(...(res.length ? res.map(bmNode) : [el('div', { class: 'empty' }, 'Ništa nije pronađeno.')]));
    }, 150);
  });
  renderTree();
  const h = head('Bookmarks'); h.append(q);
  return [h, body];
}

// ---------- Historija ----------
async function viewHistory() {
  const q = el('input', { class: 'search', placeholder: 'Traži historiju', type: 'search' });
  const body = el('div', { class: 'body' });
  const render = async () => {
    const items = await chrome.history.search({ text: q.value.trim(), maxResults: 150, startTime: 0 });
    let day = '';
    const out = [];
    for (const h of items) {
      const d = new Date(h.lastVisitTime).toLocaleDateString('bs-BA', { weekday: 'long', day: 'numeric', month: 'long' });
      if (d !== day) { day = d; out.push(el('div', { class: 'grp' }, d)); }
      out.push(el('button', { class: 'item', title: h.url, onclick: (e) => openUrl(h.url, e), onauxclick: (e) => e.button === 1 && openUrl(h.url, e) },
        el('span', { class: 'ico' }, fav(h.url)),
        el('span', { class: 'tt' }, el('span', { class: 't' }, h.title || h.url), el('span', { class: 's' }, new URL(h.url).hostname))));
    }
    body.replaceChildren(...(out.length ? out : [el('div', { class: 'empty' }, 'Nema historije.')]));
  };
  let timer;
  q.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 200); });
  await render();
  const h = head('Historija', el('button', { onclick: () => chrome.tabs.create({ url: 'chrome://history/' }) }, 'Sve')); h.append(q);
  return [h, body];
}

// ---------- Preuzimanja ----------
async function viewDownloads() {
  const items = await chrome.downloads.search({ orderBy: ['-startTime'], limit: 60 });
  const name = (p) => p.split('/').pop();
  const size = (b) => (b > 1e9 ? `${(b / 1e9).toFixed(1)} GB` : b > 1e6 ? `${(b / 1e6).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1e3))} KB`);
  const state = (d) => (d.state === 'complete' ? (d.exists ? size(d.fileSize || d.totalBytes) : 'obrisano') : d.state === 'in_progress' ? `${Math.round((100 * d.bytesReceived) / (d.totalBytes || 1))}%` : 'prekinuto');
  const body = el('div', { class: 'body' }, ...(items.length ? items.filter((d) => d.filename).map((d) => el('button', {
    class: 'item', title: d.filename,
    onclick: () => d.state === 'complete' && d.exists && chrome.downloads.open(d.id),
    oncontextmenu: (e) => { e.preventDefault(); chrome.downloads.show(d.id); },
  }, el('span', { class: 'ico', html: icon('file') }), el('span', { class: 'tt' }, el('span', { class: 't' }, name(d.filename)), el('span', { class: 's' }, state(d))))) : [el('div', { class: 'empty' }, 'Nema preuzimanja.')]));
  return [head('Preuzimanja', el('button', { onclick: () => chrome.tabs.create({ url: 'chrome://downloads/' }) }, 'Sve')), el('p', { class: 'note' }, 'Klik otvara fajl, desni klik pokazuje folder.'), body];
}

// ---------- Funkcije ----------
async function extInfo() {
  const all = await chrome.management.getAll();
  return Object.fromEntries(all.map((e) => [e.id, e]));
}
function featIcon(f, info) {
  const e = info[f.id];
  const src = e?.icons?.length ? e.icons.sort((a, b) => a.size - b.size).find((i) => i.size >= 16)?.url : null;
  return src ? el('img', { src, alt: '' }) : el('span', { html: icon('puzzle') });
}
async function viewFeatures() {
  const info = await extInfo();
  const q = el('input', { class: 'search', placeholder: 'Traži funkciju', type: 'search' });
  const body = el('div', { class: 'body' });
  const render = () => {
    const f = features.filter((x) => !x.ice && x.name.toLowerCase().includes(q.value.trim().toLowerCase()));
    const row = (x) => {
      const e = info[x.id];
      const on = e ? e.enabled : false;
      const sw = x.group === 'toggle' ? el('span', { class: `sw${on ? ' on' : ''}`, title: on ? 'Isključi' : 'Uključi', onclick: async (ev) => {
        ev.stopPropagation();
        await chrome.management.setEnabled(x.id, !on);
        Object.assign(info, await extInfo());
        render();
      } }) : null;
      return el('button', { class: 'item', onclick: () => show(`feature:${x.key}`) }, el('span', { class: 'ico' }, featIcon(x, info)), el('span', { class: 't' }, x.name), sw);
    };
    body.replaceChildren(
      el('div', { class: 'grp' }, 'S prekidačem'), ...f.filter((x) => x.group === 'toggle').map(row),
      el('div', { class: 'grp' }, 'Uvijek uključeno'), ...f.filter((x) => x.group === 'always').map(row),
    );
  };
  q.addEventListener('input', render);
  render();
  const h = head('Funkcije'); h.append(q);
  return [h, body];
}
async function viewFeature(key) {
  const f = features.find((x) => x.key === key);
  const info = await extInfo();
  const e = f && info[f.id];
  if (!f || !e) return [head('Funkcija'), el('div', { class: 'empty' }, 'Ova funkcija nije učitana.')];
  if (!e.enabled) return [head(f.name), el('div', { class: 'empty' }, 'Funkcija je isključena. Uključi je u "Funkcije".')];
  const pages = [];
  if (f.popup) pages.push(['Meni', f.popup]);
  if (f.options) pages.push(['Postavke', f.options]);
  if (!pages.length) return [head(f.name, el('button', { onclick: () => show('features') }, '← Funkcije')), el('div', { class: 'empty' }, 'Ova funkcija radi sama i nema meni.')];
  const frame = el('iframe', { src: `chrome-extension://${f.id}/${pages[0][1]}`, allow: 'clipboard-write' });
  const tabs = el('div', { class: 'tabs' }, ...pages.map(([t, p], i) => el('button', { class: i === 0 ? 'on' : '', onclick: (ev) => {
    tabs.querySelectorAll('button').forEach((b) => b.classList.remove('on'));
    ev.currentTarget.classList.add('on');
    frame.src = `chrome-extension://${f.id}/${p}`;
  } }, t)));
  return [head(f.name, el('button', { onclick: () => show('features') }, '← Funkcije')), el('div', { class: 'frame' }, pages.length > 1 ? tabs : null, frame)];
}

// ---------- Ice postavke ----------
function host(msg) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendNativeMessage('ice.host', msg, (r) => {
      if (chrome.runtime.lastError) return reject(new Error(chrome.runtime.lastError.message));
      r?.ok ? resolve(r) : reject(new Error(r?.error || 'Nije uspjelo.'));
    });
  });
}
const setTheme = (mode) => host({ theme: mode });
function barChips() {
  const note = el('div', { class: 's', style: 'padding:4px 10px;color:var(--muted)' }, 'Traka s bookmarksima: Ctrl+Shift+B je pali i gasi odmah');
  const chips = el('div', { class: 'chips' }, ...[[true, 'Prikaži traku'], [false, 'Sakrij traku']].map(([show, t]) =>
    el('button', { class: 'chip', onclick: async () => {
      try { await host({ cmd: 'bookmark-bar', show }); note.textContent = `${t}: primjenjuje se pri sljedećem pokretanju Icea (odmah: Ctrl+Shift+B).`; } catch (e) { note.textContent = `Greška: ${e.message}`; }
    } }, t)));
  return el('div', { class: 'theme' }, note, chips);
}

// ---------- Uvoz iz drugog browsera ----------
const WHAT = { bookmarks: 'Bookmarks', history: 'Historija', passwords: 'Lozinke', settings: 'Dozvole stranica i zoom' };
async function viewImport() {
  const back = el('button', { onclick: () => show('settings') }, '← Postavke');
  let data;
  try { data = await host({ cmd: 'import-list' }); } catch (e) { return [head('Uvoz', back), el('div', { class: 'body' }, el('div', { class: 'note' }, `Greška: ${e.message}`))]; }
  const body = el('div', { class: 'body' });
  const last = data.last;
  if (last) {
    body.append(el('div', { class: 'grp' }, `Zadnji uvoz · ${new Date(last.when).toLocaleString()}`));
    if (last.error) body.append(el('div', { class: 'note' }, `Greška: ${last.error}`));
    else body.append(el('div', { class: 'note' }, last.label, ...Object.entries(last.report || {}).map(([k, v]) => el('div', {}, `${k}: ${v}`))));
  }
  body.append(el('div', { class: 'grp' }, 'Odakle'));
  if (!data.sources.length) {
    body.append(el('div', { class: 'note' }, 'Na ovom računaru nije pronađen nijedan drugi browser (Chrome, Chromium, Brave, Edge, Vivaldi, Opera, Firefox).'));
  } else {
    let chosen = data.sources[0];
    const opts = el('div', { class: 'imp-what' });
    const go = el('button', { class: 'chip on imp-go' }, 'Uvezi i ponovo pokreni Ice');
    const note = el('div', { class: 'note' }, 'Podaci se dodaju postojećim, ništa se ne briše. Ice se zatvara i ponovo otvara (otvoreni tabovi se zatvaraju); prije uvoza se pravi rezervna kopija profila.');
    const drawWhat = () => {
      opts.replaceChildren(...Object.entries(WHAT).map(([k, t]) => {
        const can = chosen.can.includes(k);
        return el('label', { class: can ? '' : 'off' }, el('input', { type: 'checkbox', value: k, checked: can ? '' : null, disabled: can ? null : '' }), ` ${t}${can ? '' : ' (nije podržano za ovaj browser)'}`);
      }));
    };
    const list = el('div', { class: 'chips' }, ...data.sources.map((s, i) => el('button', { class: `chip${i ? '' : ' on'}`, onclick: (ev) => {
      list.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      ev.currentTarget.classList.add('on');
      chosen = s; drawWhat();
    } }, s.label)));
    drawWhat();
    go.addEventListener('click', async () => {
      const what = [...opts.querySelectorAll('input:checked')].map((i) => i.value);
      if (!what.length) { note.textContent = 'Odaberi šta se uvozi.'; return; }
      go.disabled = true; note.textContent = 'Zatvaram Ice i uvozim...';
      try { await host({ cmd: 'import-start', source: chosen.id, what }); } catch (e) { go.disabled = false; note.textContent = `Greška: ${e.message}`; }
    });
    body.append(list, el('div', { class: 'grp' }, 'Šta'), opts, go, note);
  }
  body.append(el('div', { class: 'grp' }, 'Iz fajla'),
    el('button', { class: 'item', onclick: () => chrome.tabs.create({ url: 'chrome://settings/importData' }) }, el('span', { class: 'ico', html: icon('star') }), el('span', { class: 'tt' }, el('span', { class: 't' }, 'Bookmarks iz HTML fajla'))),
    el('button', { class: 'item', onclick: () => chrome.tabs.create({ url: 'chrome://password-manager/settings' }) }, el('span', { class: 'ico', html: icon('shield') }), el('span', { class: 'tt' }, el('span', { class: 't' }, 'Lozinke iz CSV fajla'), el('span', { class: 's' }, 'npr. iz Firefoxa'))));
  return [head('Uvoz iz drugog browsera', back), body];
}
function themeChips() {
  const note = el('div', { class: 's', style: 'padding:4px 10px;color:var(--muted)' }, 'Odaberi izgled preglednika');
  const chips = el('div', { class: 'chips' }, ...[['auto', 'Prati sistem'], ['light', 'Svijetla'], ['dark', 'Tamna'], ['chromium', 'Chromium zadana']].map(([m, t]) =>
    el('button', { class: 'chip', onclick: async (ev) => {
      chips.querySelectorAll('.chip').forEach((c) => c.classList.remove('on'));
      ev.currentTarget.classList.add('on');
      note.textContent = 'Primjenjujem...';
      try { await setTheme(m); note.textContent = `Tema: ${t}. Primjenjuje se pri sljedećem pokretanju Icea.`; } catch (e) { note.textContent = `Greška: ${e.message}`; }
    } }, t)));
  return el('div', { class: 'theme' }, note, chips);
}

function viewSettings() {
  const m = chrome.runtime.getManifest();
  const row = (ic, t, s, fn) => el('button', { class: 'item', onclick: fn }, el('span', { class: 'ico', html: icon(ic) }), el('span', { class: 'tt' }, el('span', { class: 't' }, t), el('span', { class: 's' }, s)));
  return [head('Ice postavke'), el('div', { class: 'body' },
    el('div', { class: 'grp' }, 'Izgled'),
    themeChips(),
    barChips(),
    el('div', { class: 'grp' }, 'Podaci'),
    row('download', 'Uvoz iz drugog browsera', 'Bookmarks, historija, lozinke: Chrome, Brave, Edge, Firefox...', () => show('import')),
    el('div', { class: 'grp' }, 'Sigurnost'),
    row('shield', 'Ice Shield', 'Phishing i malware zaštita, HTTPS-first, GPC: uključeno'),
    row('shield', 'Dozvole stranica', 'Kamera, mikrofon, lokacija...', () => chrome.tabs.create({ url: 'chrome://settings/content' })),
    el('div', { class: 'grp' }, 'Sync'),
    row('sync', 'Google Drive sync', 'Šalje se pri zatvaranju Icea, preuzima pri pokretanju'),
    el('div', { class: 'grp' }, 'O Iceu'),
    row('info', 'Ice', `Panel ${m.version} · ${navigator.userAgent.match(/Chrome\/[\d.]+/)?.[0].replace('Chrome', 'Chromium') || ''}`),
  )];
}

// ---------- Navigacija ----------
const VIEWS = { menu: viewMenu, bookmarks: viewBookmarks, history: viewHistory, downloads: viewDownloads, features: viewFeatures, settings: viewSettings, import: viewImport };
async function show(name) {
  current = name;
  rail.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === name || (name.startsWith('feature:') && b.dataset.v === name)));
  const nodes = name.startsWith('feature:') ? await viewFeature(name.slice(8)) : await VIEWS[name]();
  if (current !== name) return;
  view.replaceChildren(...nodes);
  chrome.storage.local.set({ lastView: name });
}

async function buildRail() {
  const info = await extInfo();
  const btn = (v, title, inner) => el('button', { 'data-v': v, title, onclick: () => show(v), html: typeof inner === 'string' ? inner : undefined }, typeof inner === 'string' ? null : inner);
  const quick = ['yt-quality', 'sn-downloader', 'video-sniffer'].map((k) => features.find((f) => f.key === k)).filter((f) => f && info[f.id]?.enabled);
  rail.replaceChildren(
    btn('menu', 'Meni', icon('menu')),
    btn('bookmarks', 'Bookmarks', icon('star')),
    btn('history', 'Historija', icon('history')),
    btn('downloads', 'Preuzimanja', icon('download')),
    el('div', { class: 'sep' }),
    btn('features', 'Funkcije', icon('puzzle')),
    ...quick.map((f) => btn(`feature:${f.key}`, f.name, featIcon(f, info))),
    el('div', { class: 'grow' }),
    btn('settings', 'Ice postavke', icon('settings')),
  );
}

(async () => {
  try { features = await (await fetch('features.json')).json(); } catch { features = []; }
  await buildRail();
  const { lastView } = await chrome.storage.local.get('lastView');
  // Otvoreno kao običan tab (npr. umjesto chrome://extensions): odmah pregled funkcija
  if (location.hash === '#page=features') { document.body.classList.add('tab'); return show('features'); }
  show(lastView && (VIEWS[lastView] || lastView.startsWith('feature:')) ? lastView : 'features');
})();
