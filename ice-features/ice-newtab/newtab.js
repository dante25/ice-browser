// Ice nova kartica: pretraga zadanim pretraživačem (chrome.search) ili otvaranje
// adrese, i prečice (najposjećenije stranice + vlastite iz chrome.storage.local).
'use strict';

const MAX_TILES = 11; // + pločica "+" = dva reda po 6
const SCHEME_RE = /^(https?|ftp|file|chrome|chrome-extension|about|view-source|data|blob):/i;
const HOST_RE = /^(localhost|\[[0-9a-f:.]+\]|\d{1,3}(\.\d{1,3}){3}|([a-z0-9¡-￿-]+\.)+[a-z¡-￿]{2,}|[a-z0-9-]+\.local)(:\d{1,5})?([/?#].*)?$/i;
const LOCAL_RE = /^(localhost|\[|\d{1,3}(\.\d{1,3}){3}(:|\/|$)|[a-z0-9-]+\.local(:|\/|$))/i;

// Vraća URL ako je unos adresa, inače null (= pojam za pretragu).
function toUrl(text) {
  const v = text.trim();
  if (!v) return null;
  let candidate = null;
  if (SCHEME_RE.test(v)) candidate = v;
  else if (!/\s/.test(v) && HOST_RE.test(v)) candidate = (LOCAL_RE.test(v) ? 'http://' : 'https://') + v;
  if (!candidate) return null;
  try {
    return new URL(candidate).href;
  } catch {
    return null;
  }
}

function open(url) {
  // tabs.update (bez dozvole "tabs") radi i za chrome:// adrese.
  chrome.tabs.update({ url });
}

const q = document.getElementById('q');
document.getElementById('search').addEventListener('submit', (e) => {
  e.preventDefault();
  const text = q.value.trim();
  if (!text) return;
  const url = toUrl(text);
  if (url) open(url);
  else chrome.search.query({ text, disposition: 'CURRENT_TAB' });
});

// ---- Prečice ----

const store = {
  async get() {
    const { customTiles = [], hiddenSites = [] } =
      await chrome.storage.local.get(['customTiles', 'hiddenSites']);
    return { customTiles, hiddenSites };
  },
  set(obj) {
    return chrome.storage.local.set(obj);
  },
};

function faviconUrl(pageUrl) {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', pageUrl);
  u.searchParams.set('size', '32');
  return u.href;
}

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function makeTile(site, onRemove) {
  const a = document.createElement('a');
  a.className = 'tile';
  a.href = site.url;
  const name = site.title || hostOf(site.url);
  a.title = `${name}\n${site.url}`;
  a.setAttribute('aria-label', name);

  const img = document.createElement('img');
  img.alt = '';
  img.src = faviconUrl(site.url);
  // Ako se favikona ne učita -> prvo slovo naziva.
  img.addEventListener('error', () => {
    const letter = document.createElement('span');
    letter.className = 'letter';
    letter.textContent = name.trim().charAt(0) || '?';
    img.replaceWith(letter);
  });

  const label = document.createElement('span');
  label.className = 'label';
  label.textContent = name;

  const remove = document.createElement('button');
  remove.className = 'remove';
  remove.type = 'button';
  remove.textContent = '×';
  remove.title = 'Ukloni prečicu';
  remove.setAttribute('aria-label', `Ukloni prečicu ${name}`);
  remove.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    onRemove();
  });

  a.append(img, label, remove);
  return a;
}

async function render() {
  const [{ customTiles, hiddenSites }, topSites] = await Promise.all([
    store.get(),
    chrome.topSites.get().catch(() => []),
  ]);
  const box = document.getElementById('tiles');
  const tiles = [];
  const seen = new Set();

  for (const site of customTiles) {
    if (tiles.length >= MAX_TILES) break;
    seen.add(site.url);
    tiles.push(makeTile(site, async () => {
      const cur = await store.get();
      await store.set({ customTiles: cur.customTiles.filter((t) => t.url !== site.url) });
      render();
    }));
  }
  for (const site of topSites) {
    if (tiles.length >= MAX_TILES) break;
    if (/^https?:\/\/(chromewebstore\.google\.com|chrome\.google\.com\/webstore)/.test(site.url)) continue; // zadana pločica Chromiuma
    if (seen.has(site.url) || hiddenSites.includes(site.url)) continue;
    seen.add(site.url);
    tiles.push(makeTile(site, async () => {
      const cur = await store.get();
      await store.set({ hiddenSites: [...new Set([...cur.hiddenSites, site.url])].slice(-200) });
      render();
    }));
  }

  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'tile add';
  add.textContent = '+';
  add.title = 'Dodaj prečicu';
  add.setAttribute('aria-label', 'Dodaj prečicu');
  add.addEventListener('click', openAddDialog);
  tiles.push(add);

  box.replaceChildren(...tiles);
}

// ---- Dodavanje prečice ----

const dialog = document.getElementById('add');
const addTitle = document.getElementById('add-title');
const addUrl = document.getElementById('add-url');
const addError = document.getElementById('add-error');

function openAddDialog() {
  addTitle.value = '';
  addUrl.value = '';
  addError.hidden = true;
  dialog.showModal();
  addUrl.focus();
}

addUrl.addEventListener('input', () => { addError.hidden = true; });

document.getElementById('add-cancel').addEventListener('click', () => dialog.close());

document.getElementById('add-form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const url = toUrl(addUrl.value);
  if (!url || !/^(https?|ftp|file|chrome):/i.test(url)) {
    addError.hidden = false;
    addUrl.focus();
    return;
  }
  const title = addTitle.value.trim() || hostOf(url);
  const cur = await store.get();
  const customTiles = cur.customTiles.filter((t) => t.url !== url);
  customTiles.push({ url, title });
  await store.set({
    customTiles,
    hiddenSites: cur.hiddenSites.filter((u) => u !== url),
  });
  dialog.close();
  render();
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && (changes.customTiles || changes.hiddenSites)) render();
});

render();
