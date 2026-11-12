// Collects media found per tab (network sniffing + reports from the page) in chrome.storage.session.

const EXT = /\.(m3u8|mpd|mp4|m4v|webm|mkv|mov|flv|avi|3gp|mp3|m4a|ogg|opus|wav|f4m)(?:$|[?#\/])/i;
const SEGMENT = /\.(ts|m4s|cmfv|cmfa)(?:$|[?#])/i;
const MIN_FILE_SIZE = 100 * 1024;

function classify(url, contentType = '') {
  const ct = contentType.toLowerCase();
  // YouTube's MSE chunks: not downloadable one by one (use the yt-dlp button instead).
  if (/googlevideo\.com\/videoplayback/i.test(url)) return null;
  if (/\.m3u8(?:$|[?#])/i.test(url) || ct.includes('mpegurl')) return 'hls';
  if (/\.mpd(?:$|[?#])/i.test(url) || ct.includes('dash+xml')) return 'dash';
  if (/\.ism\/manifest/i.test(url)) return 'mss';
  if (SEGMENT.test(url) || ct === 'video/mp2t' || ct === 'video/iso.segment') return null;
  if (ct.startsWith('video/') || ct.startsWith('audio/') || EXT.test(url)) return 'file';
  return null;
}

let queue = Promise.resolve();

function add(tabId, found) {
  queue = queue
    .then(async () => {
      const key = `tab:${tabId}`;
      let list = (await chrome.storage.session.get(key))[key] || [];
      let page = '';
      let title = '';
      try {
        const tab = await chrome.tabs.get(tabId);
        page = tab.url || '';
        title = tab.title || '';
      } catch {}
      const url = found.url.split('#')[0];
      const existing = list.find((i) => i.url === url);
      if (existing) {
        if ((found.size || 0) > (existing.size || 0)) existing.size = found.size;
        if (!existing.sources.includes(found.source)) existing.sources.push(found.source);
      } else {
        list.push({ url, kind: found.kind, type: found.type || '', size: found.size || 0, sources: [found.source], page, title, ts: Date.now() });
      }
      await chrome.storage.session.set({ [key]: list });
      chrome.action.setBadgeText({ tabId, text: String(list.length) });
      chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
    })
    .catch(console.error);
}

// Layer 1: every response the browser receives.
chrome.webRequest.onResponseStarted.addListener(
  (d) => {
    if (d.tabId < 0 || d.statusCode >= 400) return;
    const h = (name) => d.responseHeaders?.find((x) => x.name.toLowerCase() === name)?.value || '';
    const type = h('content-type').split(';')[0].trim();
    const kind = classify(d.url, type);
    if (!kind) return;
    const range = h('content-range').match(/\/(\d+)$/);
    const size = range ? Number(range[1]) : Number(h('content-length')) || 0;
    if (kind === 'file' && size && size < MIN_FILE_SIZE) return;
    add(d.tabId, { url: d.url, kind, type, size, source: 'network' });
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders']
);

// Layer 2/3: URLs reported by the in-page hooks (inject.js via content.js).
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'found' || !sender.tab) return;
  if (msg.main) chrome.storage.session.set({ [`main:${sender.tab.id}`]: msg.main });
  if (msg.youtube) {
    // Never let a post without streams erase the streams already stored for the same video.
    const ytKey = `yt:${sender.tab.id}`;
    queue = queue
      .then(async () => {
        const old = (await chrome.storage.session.get(ytKey))[ytKey];
        if (!msg.youtube.streams && old?.id === msg.youtube.id && old.streams) msg.youtube.streams = old.streams;
        await chrome.storage.session.set({ [ytKey]: msg.youtube });
      })
      .catch(console.error);
  }
  for (const it of msg.items || []) {
    const kind = classify(it.url) || (it.force ? 'file' : null);
    if (kind) add(sender.tab.id, { url: it.url, kind, source: it.source });
  }
});

chrome.webNavigation.onCommitted.addListener((d) => {
  if (d.frameId !== 0) return;
  chrome.storage.session.remove([`tab:${d.tabId}`, `main:${d.tabId}`, `yt:${d.tabId}`]);
  chrome.storage.session.set({ [`url:${d.tabId}`]: d.url.split('#')[0] });
  chrome.action.setBadgeText({ tabId: d.tabId, text: '' });
});

// Single-page apps (YouTube, TikTok...) change the URL without a page load. Drop what is older than
// STALE_MS: the new video may already have been requested (feeds preload the next clip) before this
// event arrives, so recent items stay. The page scripts are told to look again.
const STALE_MS = 30000;
chrome.webNavigation.onHistoryStateUpdated.addListener((d) => {
  if (d.frameId !== 0) return;
  queue = queue
    .then(async () => {
      const urlKey = `url:${d.tabId}`;
      const url = d.url.split('#')[0];
      const prev = (await chrome.storage.session.get(urlKey))[urlKey];
      await chrome.storage.session.set({ [urlKey]: url });
      if (prev === url) return;
      const key = `tab:${d.tabId}`;
      const fresh = ((await chrome.storage.session.get(key))[key] || []).filter((i) => i.ts >= Date.now() - STALE_MS);
      await chrome.storage.session.set({ [key]: fresh });
      chrome.action.setBadgeText({ tabId: d.tabId, text: fresh.length ? String(fresh.length) : '' });
      chrome.tabs.sendMessage(d.tabId, { type: 'reset' }).catch(() => {});
    })
    .catch(console.error);
});

// A tab can be swapped for another (prerender, instant navigation); its list follows it.
chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  const old = `tab:${removedTabId}`;
  const data = (await chrome.storage.session.get(old))[old];
  if (data) await chrome.storage.session.set({ [`tab:${addedTabId}`]: data });
  chrome.storage.session.remove(old);
});

chrome.tabs.onRemoved.addListener((tabId) => chrome.storage.session.remove([`tab:${tabId}`, `url:${tabId}`, `main:${tabId}`, `yt:${tabId}`]));

// Ice: klik na ikonu otvara popup kao prozor unutar prozora preglednika (Chromiumov popup ispod ikone
// zna otići izvan ekrana kad su ikone ekstenzija lijevo od adresne trake).
let iceActionWindow = null;
async function iceOpenAction(tab) {
  if (iceActionWindow) { try { await chrome.windows.remove(iceActionWindow); } catch (e) {} iceActionWindow = null; }
  let b = { width: 440, height: 640, left: 100, top: 80 };
  try {
    const cur = await chrome.windows.getLastFocused();
    if (cur && cur.width > 0 && cur.left !== undefined) {
      const w = Math.min(440, Math.max(300, cur.width - 40)), h = Math.min(640, Math.max(240, cur.height - 80));
      b = { width: w, height: h, left: Math.max(0, Math.round(cur.left + cur.width - w - 20)), top: Math.max(0, Math.round(cur.top + 60)) };
    }
  } catch (e) {}
  const w = await chrome.windows.create({ url: chrome.runtime.getURL('popup.html?tab=' + (tab && tab.id)), type: 'popup', focused: true, ...b });
  iceActionWindow = w.id;
}
chrome.action.onClicked.addListener(iceOpenAction);
chrome.windows.onRemoved.addListener((id) => { if (id === iceActionWindow) iceActionWindow = null; });
globalThis.iceOpenAction = iceOpenAction;
