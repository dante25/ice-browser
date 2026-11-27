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

// Facebook/Instagram DASH files are fetched piece by piece (?bytestart=..&byteend=..): one video, many URLs.
function normalizeUrl(u) {
  u = u.split('#')[0];
  if (!/[?&]byte(?:start|end)=/.test(u) || !/fbcdn\.net|cdninstagram\.com/.test(u)) return u;
  try {
    const x = new URL(u);
    x.searchParams.delete('bytestart');
    x.searchParams.delete('byteend');
    return x.href;
  } catch {
    return u;
  }
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
      const url = normalizeUrl(found.url);
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
    // A Facebook piece (?bytestart=..): its content-length is the piece, not the video, so only the total counts.
    const piece = normalizeUrl(d.url) !== d.url.split('#')[0];
    const size = range ? Number(range[1]) : piece ? 0 : Number(h('content-length')) || 0;
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


// ---- One-click download from the button on the video (quick.js) -------------------------------------
const NOISE = /preview|thumb|sprite|poster|teaser|hover|sound|beep|notification|no_input|failure|success|click/i;
const safeName = (s) => (s || '').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').replace(/\s+/g, ' ').trim().replace(/^\.+/, '').slice(0, 120);
const MIME_EXT = { mp4: 'mp4', webm: 'webm', quicktime: 'mov', 'x-matroska': 'mkv', ogg: 'ogg', 'x-flv': 'flv' };

function say(sender, text, title) {
  if (sender.popup) {
    // Started from the popup: progress goes on the toolbar icon of that tab.
    const tabId = sender.tab.id;
    chrome.action.setBadgeText({ tabId, text: text.length > 4 ? '…' : text });
    chrome.action.setBadgeBackgroundColor({ tabId, color: text === '✕' ? '#d93025' : '#1e9e5a' });
    chrome.action.setTitle({ tabId, title: `Video Sniffer: ${title || text}` });
    if (text === '✓' || text === '✕') {
      setTimeout(async () => {
        const n = ((await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`] || []).length;
        chrome.action.setBadgeText({ tabId, text: n ? String(n) : '' });
        chrome.action.setBadgeBackgroundColor({ tabId, color: '#d93025' });
        chrome.action.setTitle({ tabId, title: 'Video Sniffer' });
      }, 6000);
    }
    return;
  }
  chrome.tabs.sendMessage(sender.tab.id, { type: 'qstatus', text, title }, { frameId: sender.frameId }).catch(() => {});
}

async function ensureOffscreen() {
  const has = (await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] })).length;
  if (!has) {
    await chrome.offscreen.createDocument({ url: 'offscreen.html', reasons: ['BLOBS'], justification: 'Fetch stream parts and join them into one video file.' });
  }
}

async function setReferer(page) {
  if (!page?.startsWith('http')) return;
  await chrome.declarativeNetRequest.updateSessionRules({
    removeRuleIds: [4],
    addRules: [
      {
        id: 4,
        priority: 4,
        action: {
          type: 'modifyHeaders',
          requestHeaders: [
            { header: 'Referer', operation: 'set', value: page },
            { header: 'Origin', operation: 'set', value: new URL(page).origin },
          ],
        },
        condition: { resourceTypes: ['xmlhttprequest'], initiatorDomains: [chrome.runtime.id] },
      },
    ],
  });
}

let jobSeq = 0;
const jobSenders = new Map();

// Offscreen page does the heavy part (stream pieces / merge) and returns a blob URL to save.
async function runOffscreen(job, sender) {
  await ensureOffscreen();
  const id = ++jobSeq;
  jobSenders.set(id, sender);
  try {
    const r = await chrome.runtime.sendMessage({ type: 'off:run', id, job });
    if (!r || r.error) throw new Error(r?.error || 'Download helper did not answer');
    await chrome.downloads.download({ url: r.blobUrl, filename: r.filename, conflictAction: 'uniquify' });
    setTimeout(() => chrome.runtime.sendMessage({ type: 'off:revoke', blobUrl: r.blobUrl }).catch(() => {}), 120000);
  } finally {
    jobSenders.delete(id);
  }
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type !== 'off:progress') return;
  const s = jobSenders.get(msg.id);
  if (s) say(s, msg.text, msg.text);
});

function directDownload(url, filename, sender, job) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download({ url, filename, conflictAction: 'uniquify' }, (id) => {
      if (chrome.runtime.lastError || id == null) return reject(new Error(chrome.runtime.lastError?.message || 'Download refused'));
      const on = (d) => {
        if (d.id !== id || !d.state) return;
        if (d.state.current === 'interrupted') {
          chrome.downloads.onChanged.removeListener(on);
          // The CDN refused the bare browser request: fetch it ourselves with the page's Referer.
          say(sender, '…', 'Retrying with page headers');
          runOffscreen({ ...job, mode: 'file', url }, sender).then(resolve, reject);
        } else if (d.state.current === 'complete') {
          chrome.downloads.onChanged.removeListener(on);
        }
      };
      chrome.downloads.onChanged.addListener(on);
      resolve();
    });
  });
}

async function pickFromList(tabId, duration) {
  const items = ((await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`] || []).filter((i) => !NOISE.test(i.url));
  const hls = items.filter((i) => i.kind === 'hls').pop();
  if (hls) return hls;
  const files = items.filter((i) => i.kind === 'file' && !i.type.startsWith('audio/') && i.size > 0).sort((a, b) => b.size - a.size);
  return files[0] || items.filter((i) => i.kind === 'file').pop() || null;
}

// What the Facebook player fetched, from the sniffed list: the efg parameter names the track kind.
function fbTrack(url) {
  try {
    const e = new URL(url).searchParams.get('efg');
    if (!e) return '';
    const t = String(JSON.parse(atob(e.replace(/-/g, '+').replace(/_/g, '/'))).vencode_tag || '');
    return /audio/i.test(t) ? 'audio' : /progressive/i.test(t) ? 'muxed' : t ? 'video' : '';
  } catch {
    return '';
  }
}

async function fbFromList(tabId) {
  const items = ((await chrome.storage.session.get(`tab:${tabId}`))[`tab:${tabId}`] || [])
    .filter((i) => i.kind === 'file' && /fbcdn\.net|facebook\.com/.test(i.url))
    .map((i) => ({ ...i, track: fbTrack(i.url) }))
    .filter((i) => i.track);
  const newest = (list) => list.reduce((m, i) => Math.max(m, i.ts), 0);
  const best = (list) => {
    const t = newest(list);
    return list.filter((i) => i.ts >= t - 30000).sort((a, b) => (b.size || 0) - (a.size || 0))[0];
  };
  const muxed = items.filter((i) => i.track === 'muxed');
  const video = items.filter((i) => i.track === 'video');
  const audio = items.filter((i) => i.track === 'audio');
  if (video.length && audio.length) {
    const v = best(video);
    return { url: muxed.length ? best(muxed).url : '', dash: { video: v.url, audio: best(audio).url, height: 1 } };
  }
  if (muxed.length) return { url: best(muxed).url, dash: null };
  return null;
}

async function quick(msg, sender) {
  const page = msg.page || sender.tab.url;
  const name = safeName(msg.title || sender.tab.title) || 'video';
  await setReferer(page);
  const job = { page, name };

  // Facebook: the page's own data was read by quick.js; DASH (video + audio, up to 1080p) if it beats the HD file.
  // If that found nothing, use what the player itself downloaded (sniffed fbcdn files).
  const fb = msg.fb || (msg.isFb ? await fbFromList(sender.tab.id) : null);
  if (msg.isFb && !fb) throw new Error(msg.fbReason || 'No video address found on this page');
  if (fb) {
    const { url, dash } = fb;
    if (dash?.audio && (!url || dash.height > 720)) {
      try {
        say(sender, '…', `Downloading ${dash.height}p`);
        return await runOffscreen({ ...job, mode: 'dash', video: dash.video, audio: dash.audio, name: `${name} [${dash.height}p]` }, sender);
      } catch (e) {
        if (!url) throw e;
      }
    }
    if (url) return directDownload(url, `${name}.mp4`, sender, job);
    throw new Error('No video address found on this page');
  }

  let src = msg.src && /^https?:/.test(msg.src) ? msg.src : '';
  let kind = src ? (/\.m3u8(?:$|[?#])/i.test(src) ? 'hls' : /\.mpd(?:$|[?#])/i.test(src) ? 'dash' : 'file') : '';
  let type = '';
  if (!src || kind === 'dash') {
    const it = await pickFromList(sender.tab.id, msg.duration);
    if (!it) throw new Error('No video found yet - play it for a second, then click again');
    src = it.url;
    kind = it.kind;
    type = it.type || '';
  }
  if (kind === 'dash') throw new Error('DASH stream: use the extension popup (yt-dlp)');
  if (kind === 'hls') return runOffscreen({ ...job, mode: 'hls', url: src }, sender);
  let ext = 'mp4';
  try {
    ext = new URL(src).pathname.match(/\.([a-z0-9]{2,4})$/i)?.[1]?.toLowerCase() || MIME_EXT[type.split('/')[1]] || 'mp4';
  } catch {}
  return directDownload(src, `${name}.${ext}`, sender, { ...job, ext });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'quick' || !sender.tab) return;
  say(sender, '…', 'Starting');
  quick(msg, sender).then(
    () => say(sender, '✓', 'Download started'),
    (e) => say(sender, '✕', e.message || String(e))
  );
  sendResponse({ ok: true });
});


// ---- Downloads started from the popup (no tab is opened) ------------------------------------------------
const YT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';

async function popdl(msg) {
  const s = { popup: true, tab: { id: msg.tabId } };
  const job = { page: msg.page, name: safeName(msg.name) || 'video' };
  say(s, '…', 'Starting');
  await setReferer(msg.page);
  if (msg.mode === 'file') return directDownload(msg.url, `${job.name}.${msg.ext || 'mp4'}`, s, { ...job, ext: msg.ext });
  if (msg.mode === 'hls') return runOffscreen({ ...job, mode: 'hls', url: msg.url }, s);
  if (msg.mode === 'ytmerge') {
    // googlevideo expects the client its URLs were issued for (visionOS, as in inject.js)
    await chrome.declarativeNetRequest.updateSessionRules({
      removeRuleIds: [3],
      addRules: [
        {
          id: 3,
          priority: 3,
          action: { type: 'modifyHeaders', requestHeaders: [{ header: 'User-Agent', operation: 'set', value: YT_UA }] },
          condition: { requestDomains: ['googlevideo.com'], resourceTypes: ['xmlhttprequest'], initiatorDomains: [chrome.runtime.id] },
        },
      ],
    });
    return runOffscreen({ ...job, mode: 'ytmerge', video: msg.video, vs: msg.vs, audio: msg.audio, as: msg.as }, s);
  }
  throw new Error('Unknown download');
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== 'popdl') return;
  popdl(msg).then(
    () => say({ popup: true, tab: { id: msg.tabId } }, '✓', 'Download started'),
    (e) => say({ popup: true, tab: { id: msg.tabId } }, '✕', e.message || String(e))
  );
  sendResponse({ ok: true });
});
