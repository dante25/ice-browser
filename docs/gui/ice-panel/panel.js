'use strict';
// chrome://ice-panel — Ice sidebar panel ("Funkcije" + glavni meni).
// Talks to IcePanelHandler (C++) via chrome.send; replies come back through
// cr.webUIResponse (WebUIMessageHandler::ResolveJavascriptCallback).

const pending = new Map();
let nextId = 0;
window.cr = window.cr || {};
window.cr.webUIResponse = (id, ok, value) => {
  const p = pending.get(id);
  if (!p) return;
  pending.delete(id);
  ok ? p.resolve(value) : p.reject(value);
};
window.cr.webUIListenerCallback = () => {};

function call(name, ...args) {
  const id = name + '_' + (++nextId);
  return new Promise((resolve, reject) => {
    pending.set(id, {resolve, reject});
    chrome.send(name, [id, ...args]);
  });
}
const send = (name, ...args) => chrome.send(name, args);

// ---------------------------------------------------------------- DOM helpers
function el(tag, props, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k) e.append(k);
  return e;
}
const SVGNS = 'http://www.w3.org/2000/svg';
function svg(d, cls) {
  const s = document.createElementNS(SVGNS, 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  if (cls) s.setAttribute('class', cls);
  const p = document.createElementNS(SVGNS, 'path');
  p.setAttribute('d', d);
  s.append(p);
  return s;
}

const I = {
  chev: 'M10 6 8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z',
  puzzle: 'M20.5 11H19V7a2 2 0 0 0-2-2h-4V3.5a2.5 2.5 0 0 0-5 0V5H4a2 2 0 0 0-2 2v3.8h1.5a2.7 2.7 0 0 1 0 5.4H2V20a2 2 0 0 0 2 2h3.8v-1.5a2.7 2.7 0 0 1 5.4 0V22H17a2 2 0 0 0 2-2v-4h1.5a2.5 2.5 0 0 0 0-5z',
  newTab: 'M19 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H5V5h14v14zm-8-2h2v-4h4v-2h-4V7h-2v4H7v2h4z',
  newWindow: 'M4 4h16a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2zm0 4v10h16V8H4z',
  incognito: 'M17.06 13c-1.86 0-3.42 1.33-3.82 3.1-.95-.41-1.82-.3-2.48-.01C10.35 14.31 8.79 13 6.94 13 4.77 13 3 14.79 3 17s1.77 4 3.94 4c2.06 0 3.74-1.62 3.9-3.68.34-.24 1.23-.69 2.32.02.18 2.05 1.84 3.66 3.9 3.66 2.17 0 3.94-1.79 3.94-4s-1.77-4-3.94-4zM6.94 19.86c-1.56 0-2.81-1.28-2.81-2.86s1.26-2.86 2.81-2.86 2.81 1.28 2.81 2.86-1.25 2.86-2.81 2.86zm10.12 0c-1.56 0-2.81-1.28-2.81-2.86s1.25-2.86 2.81-2.86 2.82 1.28 2.82 2.86-1.27 2.86-2.82 2.86zM22 10.5H2V12h20v-1.5zm-6.47-7.87c-.22-.49-.78-.75-1.31-.58L12 2.79l-2.23-.74c-.53-.15-1.09.13-1.29.64L6 9h12l-2.44-6.32z',
  history: 'M13 3a9 9 0 0 0-9 9H1l3.9 3.9L9 12H6a7 7 0 1 1 2.05 4.95l-1.42 1.42A9 9 0 1 0 13 3zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z',
  downloads: 'M5 20h14v-2H5v2zM19 9h-4V3H9v6H5l7 7 7-7z',
  bookmarks: 'M12 17.27 18.18 21l-1.64-7.03L22 9.24l-7.19-.61L12 2 9.19 8.63 2 9.24l5.46 4.73L5.82 21z',
  settings: 'M19.14 12.94c.04-.3.06-.61.06-.94 0-.32-.02-.64-.07-.94l2.03-1.58a.49.49 0 0 0 .12-.61l-1.92-3.32a.49.49 0 0 0-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54a.48.48 0 0 0-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96a.48.48 0 0 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.05.3-.09.63-.09.94s.02.64.07.94l-2.03 1.58a.49.49 0 0 0-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6a3.6 3.6 0 1 1 0-7.2 3.6 3.6 0 0 1 0 7.2z',
  print: 'M19 8H5a3 3 0 0 0-3 3v6h4v4h12v-4h4v-6a3 3 0 0 0-3-3zm-3 11H8v-5h8v5zm3-7a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm-1-9H6v4h12V3z',
  find: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z',
  zoom: 'M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14zM10 7H9v2H7v1h2v2h1v-2h2V9h-2z',
  fullscreen: 'M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z',
  devtools: 'M9.4 16.6 4.8 12l4.6-4.6L8 6l-6 6 6 6 1.4-1.4zm5.2 0 4.6-4.6-4.6-4.6L16 6l6 6-6 6-1.4-1.4z',
  taskManager: 'M3 13h2v-2H3v2zm0 4h2v-2H3v2zm0-8h2V7H3v2zm4 4h14v-2H7v2zm0 4h14v-2H7v2zM7 7v2h14V7H7z',
  about: 'M11 7h2v2h-2zm0 4h2v6h-2zm1-9C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8z',
  exit: 'M10.09 15.59 11.5 17l5-5-5-5-1.41 1.41L12.67 11H3v2h9.67l-2.58 2.59zM19 3H5a2 2 0 0 0-2 2v4h2V5h14v14H5v-4H3v4a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2z',
  restart: 'M17.65 6.35A7.96 7.96 0 0 0 12 4a8 8 0 1 0 7.73 10h-2.08A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z',
};

// ------------------------------------------------------- feature definitions
// Ice controls write straight into each extension's own chrome.storage, with
// exactly the keys/values that extension's code reads (see its popup/options).
const GROUPS = ['YouTube', 'Stranice', 'Tabovi i oznake', 'Sigurnost', 'Preuzimanja', 'Ostalo'];
const ON_OFF_STR = {on: 'true', off: 'false', def: 'true'};
const SPEC = {
  'default-quality-adjuster-for-youtube': {
    group: 'YouTube', short: 'Default Quality Adjuster',
    controls: [
      {type: 'chips', label: 'Zadani kvalitet', area: 'sync', key: 'preferences',
       field: 'quality', def: {quality: 'hd720', isEnabled: true},
       options: [['large', '480p'], ['hd720', '720p'], ['hd1080', '1080p'],
                 ['hd1440', '1440p'], ['hd2160', '4K'], ['highres', '8K']]},
      {type: 'toggle', label: 'Uključeno', area: 'sync', key: 'preferences',
       field: 'isEnabled', def: {quality: 'hd720', isEnabled: true}},
    ]},
  'youtube-nonstop': {
    group: 'YouTube',
    controls: [{type: 'note', text: 'Automatski potvrđuje „Video je pauziran. Nastaviti gledanje?“. Nema postavki.'}]},
  'adblock-for-youtube': {group: 'YouTube'},
  'hide-labels-and-end-cards-on-youtube': {
    group: 'YouTube', short: 'Hide Labels and End Cards',
    controls: [
      {type: 'toggle', label: 'Uključeno', area: 'sync', key: 'HIDE_YT_CARDS:run', ...ON_OFF_STR},
      {type: 'toggle', label: 'Sakrij kartice na kraju videa', area: 'sync', key: 'HIDE_YT_CARDS:hideCards', ...ON_OFF_STR},
      {type: 'toggle', label: 'Sakrij dugme za pretplatu (logo)', area: 'sync', key: 'HIDE_YT_CARDS:hideSubscribe', ...ON_OFF_STR},
      {type: 'toggle', label: 'Sakrij oznake (labels)', area: 'sync', key: 'HIDE_YT_CARDS:hideLabels', ...ON_OFF_STR},
      {type: 'toggle', label: 'I u videima na drugim stranicama', area: 'sync', key: 'HIDE_YT_CARDS:externalWebsites', ...ON_OFF_STR},
    ]},
  'permanent-progress-bar-for-youtube': {
    group: 'YouTube', short: 'Permanent Progress Bar',
    controls: [
      {type: 'toggle', label: 'Stalna traka napretka', area: 'local', key: 'top', def: true},
      {type: 'toggle', label: 'I u ugrađenim videima', area: 'local', key: 'embed', def: true},
      {type: 'toggle', label: 'Privremeno sakrij traku', area: 'local', key: 'hide', def: false},
      {type: 'chips', label: 'Debljina trake', area: 'local', key: 'height', def: 3,
       options: [[2, '2 px'], [3, '3 px'], [4, '4 px'], [6, '6 px'], [8, '8 px']]},
      {type: 'color', label: 'Boja trake', area: 'local', key: 'progress-color', def: '#ff0000'},
    ]},
  'screenshot-youtube': {
    group: 'YouTube',
    controls: [
      {type: 'chips', label: 'Format slike', area: 'sync', key: 'screenshotFileFormat', def: 'png',
       options: [['png', 'PNG'], ['jpeg', 'JPEG'], ['webp', 'WebP']]},
      {type: 'chips', label: 'Snimak ekrana', area: 'sync', key: 'screenshotFunctionality', def: 0,
       options: [[0, 'Sačuvaj'], [1, 'Kopiraj'], [2, 'Oboje']]},
      {type: 'toggle', label: 'Tipka P pravi snimak', area: 'sync', key: 'screenshotKey', def: false},
      {type: 'toggle', label: 'Dugmad za brzinu reprodukcije', area: 'sync', key: 'playbackSpeedButtons', def: false},
    ]},
  'multiselect-for-youtube': {group: 'YouTube'},
  'enable-right-click-for-google-chrome': {
    group: 'Stranice', short: 'Enable Right Click',
    controls: [{type: 'note', text: 'Uključuje se klikom na ikonu ekstenzije na stranici koja blokira desni klik i kopiranje.'}]},
  'hide-anything-element-hider-for-chrome': {group: 'Stranice', short: 'Hide Anything'},
  'search-by-image': {group: 'Stranice'},
  'google-images-viewer': {
    group: 'Stranice', short: 'Pregled slika (Google)',
    controls: [{type: 'note', text: 'Vraća dugme „Prikaži sliku“ na Google slikama. Uvijek uključeno, nema postavki.'}]},
  'webmail-ad-blocker': {
    group: 'Stranice',
    controls: [
      {type: 'host', label: 'Blokiraj reklame u Gmailu', area: 'local', key: 'disabledBlockingHosts', host: 'mail.google.com'},
      {type: 'host', label: 'Blokiraj reklame u Outlooku', area: 'local', key: 'disabledBlockingHosts', host: 'outlook.live.com'},
      {type: 'host', label: 'Blokiraj reklame u Yahoo Mailu', area: 'local', key: 'disabledBlockingHosts', host: 'mail.yahoo.com'},
      {type: 'toggle', label: 'Yahoo: ukloni desnu kolonu', area: 'local', key: 'yahoo-remove-right-side', def: false},
      {type: 'note', text: 'Promjena važi nakon ponovnog učitavanja pošte.'},
    ]},
  'go-back-with-backspace': {
    group: 'Stranice',
    controls: [
      {type: 'toggle', label: 'Ne vraćaj se nazad u apletima (PDF, Flash, chat)', area: 'sync', key: 'disableInApplets', def: true},
    ]},
  'chrome-tab-counter': {
    group: 'Tabovi i oznake', short: 'Tab Counter',
    controls: [
      {type: 'stats', area: 'local', json: true, items: [
        ['tabsOpen', 'Otvoreni tabovi'], ['windowsOpen', 'Otvoreni prozori'],
        ['tabsMax', 'Najviše odjednom'], ['tabsTotal', 'Ukupno otvoreno']]},
      {type: 'color', label: 'Pozadina brojača', area: 'local', key: 'iconBgColor', def: '#FF0000', json: true, upper: true},
      {type: 'color', label: 'Boja broja', area: 'local', key: 'iconTextColor', def: '#FFFFFF', json: true, upper: true},
    ]},
  'tab-session-manager': {group: 'Tabovi i oznake'},
  'bookmarks-clean-up': {group: 'Tabovi i oznake'},
  'ice-shield': {group: 'Sigurnost'},
  'sn-downloader': {group: 'Preuzimanja'},
  'video-sniffer': {group: 'Preuzimanja'},
};

// ------------------------------------------------------------------- storage
function readValue(c, data) {
  let v = data[c.key];
  if (c.json && typeof v === 'string') {
    try { v = JSON.parse(v); } catch (e) {}
  }
  if (c.field) {
    const obj = (v && typeof v === 'object') ? v : c.def;
    return c.field in obj ? obj[c.field] : c.def[c.field];
  }
  return v === undefined ? c.def : v;
}
async function writeValue(f, c, value, data) {
  let v = value;
  if (c.field) {
    const cur = data[c.key];
    v = Object.assign({}, c.def, (cur && typeof cur === 'object') ? cur : {}, {[c.field]: value});
  }
  if (c.json) v = JSON.stringify(v);
  data[c.key] = v;
  await call('storageSet', f.id, c.area, {[c.key]: v});
}

function toggle(checked, label, onChange) {
  const input = el('input', {type: 'checkbox', role: 'switch', 'aria-label': label});
  input.checked = !!checked;
  input.addEventListener('change', () => onChange(input.checked, input));
  return el('label', {class: 'switch'}, input, el('span'));
}

function renderControl(f, c, data) {
  switch (c.type) {
    case 'note':
      return el('p', {class: 'note', text: c.text});
    case 'toggle': {
      const on = c.on !== undefined ? readValue(c, data) === c.on : !!readValue(c, data);
      return el('div', {class: 'opt'}, el('span', {class: 'name', text: c.label}),
          toggle(on, c.label, v => writeValue(f, c, c.on !== undefined ? (v ? c.on : c.off) : v, data)));
    }
    case 'host': {
      const list = () => Array.isArray(data[c.key]) ? data[c.key] : [];
      return el('div', {class: 'opt'}, el('span', {class: 'name', text: c.label}),
          toggle(!list().includes(c.host), c.label, v => {
            const next = list().filter(h => h !== c.host);
            if (!v) next.push(c.host);
            return writeValue(f, c, next, data);
          }));
    }
    case 'chips': {
      const cur = readValue(c, data);
      const chips = el('div', {class: 'chips', role: 'group', 'aria-label': c.label});
      for (const [value, text] of c.options) {
        const b = el('button', {class: 'chip', text, 'aria-pressed': String(value === cur)});
        b.addEventListener('click', async () => {
          for (const o of chips.children) o.setAttribute('aria-pressed', String(o === b));
          await writeValue(f, c, value, data);
        });
        chips.append(b);
      }
      return el('div', {class: 'group'}, el('h3', {text: c.label}), chips);
    }
    case 'color': {
      const input = el('input', {type: 'color', 'aria-label': c.label});
      input.value = String(readValue(c, data) || c.def).toLowerCase();
      input.addEventListener('change', () =>
          writeValue(f, c, c.upper ? input.value.toUpperCase() : input.value, data));
      return el('div', {class: 'opt'}, el('span', {class: 'name', text: c.label}), input);
    }
    case 'stats': {
      const g = el('div', {class: 'stats'});
      for (const [key, label] of c.items) {
        let v = data[key];
        if (c.json && typeof v === 'string') { try { v = JSON.parse(v); } catch (e) {} }
        g.append(el('span', {text: label}), el('b', {text: String(v ?? 0)}));
      }
      return el('div', {class: 'group'}, g);
    }
  }
  return null;
}

async function loadData(f, controls) {
  const areas = {};
  for (const c of controls) {
    if (!c.area) continue;
    const keys = areas[c.area] || (areas[c.area] = new Set());
    if (c.key) keys.add(c.key);
    for (const [k] of c.items || []) keys.add(k);
  }
  const data = {};
  for (const [area, keys] of Object.entries(areas)) {
    const got = await call('storageGet', f.id, area, [...keys]);
    // Same key in two areas does not happen in the specs above.
    Object.assign(data, got || {});
  }
  return data;
}

// ------------------------------------------------------------- features view
let state = null;
const openCards = new Set();

function displayName(f) {
  const s = SPEC[f.dir] || {};
  return s.short || f.name.replace(/[™®]/g, '').trim();
}
function iconBox(src, fallback) {
  return el('span', {class: 'ico'},
      src ? el('img', {src, alt: ''}) : svg(fallback || I.puzzle));
}

async function renderBody(f, body) {
  const spec = SPEC[f.dir] || {};
  const controls = spec.controls || [];
  body.replaceChildren();
  try {
    const data = await loadData(f, controls);
    for (const c of controls) {
      const n = renderControl(f, c, data);
      if (n) body.append(n);
    }
  } catch (e) {
    body.append(el('p', {class: 'note', text: 'Postavke trenutno nisu dostupne.'}));
  }
  const actions = el('div', {class: 'actions'});
  if (f.popup) actions.append(el('button', {class: 'btn' + (controls.length ? '' : ' primary'), text: 'Otvori',
      onclick: () => send('openPopup', f.id)}));
  if (f.options) actions.append(el('button', {class: 'btn', text: 'Postavke',
      onclick: () => send('openOptions', f.id)}));
  if (actions.children.length) body.append(actions);
  if (!body.children.length) body.append(el('p', {class: 'note', text: 'Uvijek uključeno, nema postavki.'}));
}

function card(f) {
  const body = el('div', {class: 'body', hidden: true});
  const head = el('button', {class: 'row', 'aria-expanded': 'false'},
      iconBox(f.icon), el('span', {class: 'name', text: displayName(f)}), svg(I.chev, 'chev'));
  const wrap = el('div', {class: 'card', 'data-name': (displayName(f) + ' ' + f.name).toLowerCase()}, head, body);
  const setOpen = open => {
    wrap.classList.toggle('open', open);
    head.setAttribute('aria-expanded', String(open));
    body.hidden = !open;
    open ? openCards.add(f.id) : openCards.delete(f.id);
    if (open) renderBody(f, body);
  };
  head.addEventListener('click', () => setOpen(!wrap.classList.contains('open')));
  if (openCards.has(f.id)) setOpen(true);
  return wrap;
}

function switchRow(s) {
  const name = s.name.replace(/[™®]/g, '').trim();
  return el('div', {class: 'row', 'data-name': name.toLowerCase()},
      iconBox(s.icon, I.downloads), el('span', {class: 'name', text: name}),
      toggle(s.value, name, async v => {
        const r = await call('setPref', s.pref, v);
        state.restartPending = !!(r && r.restartPending);
        updateRestart();
      }));
}

let restartBox = null;
function updateRestart() {
  if (restartBox) restartBox.hidden = !state.restartPending;
}

function renderFeatures() {
  const list = document.getElementById('list');
  list.replaceChildren();
  const sw = el('section', {}, el('div', {class: 'section', text: 'S prekidačem'}));
  for (const s of state.switches) sw.append(switchRow(s));
  restartBox = el('div', {class: 'restart'},
      el('span', {text: 'Primjenjuje se nakon ponovnog pokretanja.'}),
      el('button', {class: 'btn primary', text: 'Pokreni ponovo', onclick: () => send('runCommand', 'restart')}));
  sw.append(restartBox);
  list.append(sw);
  updateRestart();

  const byGroup = {};
  for (const f of state.features) {
    const g = (SPEC[f.dir] || {}).group || 'Ostalo';
    (byGroup[g] || (byGroup[g] = [])).push(f);
  }
  for (const g of GROUPS) {
    const fs = byGroup[g];
    if (!fs) continue;
    fs.sort((a, b) => displayName(a).localeCompare(displayName(b)));
    list.append(el('section', {}, el('div', {class: 'section', text: g}), fs.map(card)));
  }
  applySearch();
}

function applySearch() {
  const q = document.getElementById('search').value.trim().toLowerCase();
  let any = false;
  for (const sec of document.querySelectorAll('#list section')) {
    let shown = 0;
    for (const item of sec.querySelectorAll('[data-name]')) {
      const ok = !q || item.dataset.name.includes(q);
      item.hidden = !ok;
      if (ok) shown++;
    }
    sec.hidden = !shown;
    any = any || !!shown;
  }
  if (restartBox) restartBox.hidden = !state.restartPending || !!q;
  document.getElementById('empty').hidden = any;
  document.getElementById('empty-q').textContent = q;
}

// ----------------------------------------------------------------- menu view
const MENU = [
  ['Novo', [
    ['newTab', 'Nova kartica', I.newTab, 'Ctrl+T'],
    ['newWindow', 'Novi prozor', I.newWindow, 'Ctrl+N'],
    ['incognito', 'Novi privatni prozor', I.incognito, 'Ctrl+Shift+N'],
  ]],
  ['Pregledanje', [
    ['history', 'Historija', I.history, 'Ctrl+H'],
    ['downloads', 'Preuzimanja', I.downloads, 'Ctrl+J'],
    ['bookmarks', 'Upravitelj oznaka', I.bookmarks, 'Ctrl+Shift+O'],
  ]],
  ['Stranica', [
    ['zoom'],
    ['find', 'Pronađi na stranici', I.find, 'Ctrl+F'],
    ['print', 'Štampaj', I.print, 'Ctrl+P'],
    ['fullscreen', 'Cijeli ekran', I.fullscreen, 'F11'],
  ]],
  ['Alati', [
    ['extensions', 'Ekstenzije', I.puzzle],
    ['taskManager', 'Upravitelj zadataka', I.taskManager, 'Shift+Esc'],
    ['devTools', 'Alati za programere', I.devtools, 'Ctrl+Shift+I'],
  ]],
  ['Ice', [
    ['settings', 'Postavke', I.settings],
    ['about', 'O pregledniku Ice', I.about],
    ['restart', 'Pokreni ponovo', I.restart],
    ['exit', 'Izlaz', I.exit, 'Ctrl+Shift+Q', 'danger'],
  ]],
];

function renderMenu() {
  const menu = document.getElementById('view-menu');
  menu.replaceChildren();
  for (const [title, items] of MENU) {
    const sec = el('section', {}, el('div', {class: 'section', text: title}));
    for (const [cmd, label, icon, key, extra] of items) {
      if (cmd === 'zoom') {
        sec.append(el('div', {class: 'row menu-item'}, svg(I.zoom), el('span', {class: 'name', text: 'Zumiranje'}),
            el('span', {class: 'zoom'},
                el('button', {class: 'btn', text: '−', 'aria-label': 'Umanji', onclick: () => send('runCommand', 'zoomOut')}),
                el('button', {class: 'btn', text: '100 %', 'aria-label': 'Stvarna veličina', onclick: () => send('runCommand', 'zoomReset')}),
                el('button', {class: 'btn', text: '+', 'aria-label': 'Uvećaj', onclick: () => send('runCommand', 'zoomIn')}))));
        continue;
      }
      sec.append(el('button', {class: 'row menu-item' + (extra ? ' ' + extra : ''), onclick: () => send('runCommand', cmd)},
          svg(icon), el('span', {class: 'name', text: label}), key ? el('span', {class: 'key', text: key}) : null));
    }
    menu.append(sec);
  }
}

// ---------------------------------------------------------------------- main
async function showMode() {
  const mode = location.hash === '#menu' ? 'menu' : 'features';
  document.getElementById('title').textContent = mode === 'menu' ? 'Meni' : 'Funkcije';
  document.getElementById('view-menu').hidden = mode !== 'menu';
  document.getElementById('view-features').hidden = mode === 'menu';
  if (mode === 'menu') {
    if (!document.getElementById('view-menu').children.length) renderMenu();
  } else {
    state = await call('getState');
    renderFeatures();
  }
  window.scrollTo(0, 0);
}

document.getElementById('search').addEventListener('input', applySearch);
document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !e.defaultPrevented) {
    const s = document.getElementById('search');
    if (document.activeElement === s && s.value) {
      e.preventDefault();
      s.value = '';
      applySearch();
      return;
    }
    send('close');
  }
});
window.addEventListener('hashchange', showMode);
// The panel's WebContents is kept while the panel is closed: refresh the
// feature list (switch values, loaded add-ons) every time it is shown again.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && location.hash !== '#menu') showMode();
});
showMode();
