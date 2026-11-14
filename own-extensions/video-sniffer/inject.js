// Runs inside the page's own JS context at document_start, before the site's scripts.
// Hooks the APIs players use to load video and scans the data they handle for media URLs.
// Only the page's main video counts as "strong"; everything else is reported with weak sources.
(() => {
  if (window.__vsnifferInjected) return;
  window.__vsnifferInjected = true;

  const MEDIA = /\.(?:m3u8|mpd|mp4|m4v|webm|mov|flv|mkv)(?:$|[?#\/])/i;
  const URL_RE = /https?:\/\/[^\s"'<>\\]+?\.(?:m3u8|mpd|mp4|m4v|webm|mov|flv|mkv)\/?(?:\?[^\s"'<>\\]*)?(?![\w.\-])/gi;
  const MAX_SCAN = 2e6;

  const seen = new Set();
  let batch = [];
  let timer = 0;

  function flush() {
    timer = 0;
    if (!batch.length) return;
    window.postMessage({ __vsniffer: 1, items: batch }, '*');
    batch = [];
  }

  function report(raw, source, force = false) {
    let url;
    try {
      url = new URL(raw, location.href).href;
    } catch {
      return;
    }
    if (!/^https?:/.test(url) || seen.has(url + '|' + source)) return;
    if (!force && !MEDIA.test(url)) return;
    seen.add(url + '|' + source);
    batch.push({ url, source, force });
    if (!timer) timer = setTimeout(flush, 200);
  }

  function scanText(text, source) {
    if (typeof text !== 'string' || text.length > MAX_SCAN) return;
    const t = text.replace(/\\\//g, '/').replace(/\\u0026/g, '&').replace(/&amp;/g, '&');
    for (const m of t.match(URL_RE) || []) report(m, source);
  }

  // fetch: request URL + any URL found in text/JSON responses (weak: API replies list many unrelated videos).
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const input = args[0];
      report(typeof input === 'string' ? input : input?.url || String(input), 'fetch');
      p.then((r) => {
        const ct = r.headers.get('content-type') || '';
        const len = Number(r.headers.get('content-length')) || 0;
        if (len < MAX_SCAN && /json|text|javascript|xml/i.test(ct)) {
          r.clone().text().then((t) => scanText(t, 'fetch response')).catch(() => {});
        }
      }).catch(() => {});
    } catch {}
    return p;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      report(String(url), 'xhr');
      this.addEventListener('load', () => {
        try {
          if (this.responseType === '' || this.responseType === 'text') scanText(this.responseText, 'xhr response');
        } catch {}
      });
    } catch {}
    return origOpen.call(this, method, url, ...rest);
  };

  const origParse = JSON.parse;
  JSON.parse = function (text, reviver) {
    const value = origParse.call(this, text, reviver);
    try {
      if (typeof text === 'string' && text.length < MAX_SCAN && /\.(?:m3u8|mpd|mp4|webm|flv|mkv|mov)/i.test(text)) {
        scanText(text, 'JSON config');
      }
    } catch {}
    return value;
  };

  // The main video: the largest visible <video> (playing ones count 4x). Thumbnails, hover previews,
  // hidden players and UI sounds (<audio>) are ignored.
  const shadowRoots = [];

  function mainVideo() {
    let best = null;
    let bestScore = 0;
    for (const root of [document, ...shadowRoots]) {
      for (const v of root.querySelectorAll('video')) {
        if (!v.isConnected) continue;
        const r = v.getBoundingClientRect();
        if (r.width < 300 || r.height < 160 || getComputedStyle(v).visibility === 'hidden') continue;
        const score = r.width * r.height * (!v.paused && !v.ended ? 4 : 1);
        if (score > bestScore) {
          bestScore = score;
          best = v;
        }
      }
    }
    return best;
  }

  // Tell the extension how long the playing video is: blob/MSE players hide the real file URL, but the
  // duration lets the popup pick the matching file out of everything that was downloaded.
  let lastMain = '';
  function sendMain(v) {
    if (!isFinite(v.duration) || v.duration <= 0) return;
    const sig = v.duration.toFixed(3);
    if (sig === lastMain) return;
    lastMain = sig;
    window.postMessage({ __vsniffer: 1, items: [], main: { duration: v.duration } }, '*');
  }

  // YouTube no longer exposes downloadable URLs, but its player still knows every format it can play.
  let lastYoutube = '';
  function scanYouTube() {
    if (!/(^|\.)youtube\.com$/.test(location.hostname)) return;
    const here = new URL(location.href);
    const wanted = here.searchParams.get('v') || here.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
    if (!wanted) return;
    // Shorts play in their own player (#shorts-player); take the player that holds THIS video.
    let pr = null;
    for (const pid of ['shorts-player', 'movie_player']) {
      try {
        const r = document.getElementById(pid)?.getPlayerResponse?.();
        if (r?.videoDetails?.videoId === wanted) {
          pr = r;
          break;
        }
      } catch {}
    }
    // No player data for this video (yet): the id from the address is enough to ask for the streams, as VDH does.
    if (!pr) pr = { videoDetails: { videoId: wanted, title: document.title.replace(/ - YouTube$/, '') } };
    const id = wanted;
    const sd = pr.streamingData || {};
    const formats = [...(sd.adaptiveFormats || []), ...(sd.formats || [])]
      .filter((f) => f.qualityLabel)
      .map((f) => ({
        itag: f.itag,
        label: f.qualityLabel,
        height: f.height || 0,
        fps: f.fps || 0,
        codec: /codecs="([^".]+)/.exec(f.mimeType || '')?.[1] || '',
        bitrate: f.bitrate || 0,
      }));
    const sig = `${id}:${formats.length}`;
    let sts;
    try {
      sts = window.ytcfg?.get?.('STS');
    } catch {}
    const info = { id, title: pr.videoDetails.title || '', formats, sts };
    if (sig !== lastYoutube) {
      lastYoutube = sig;
      // The direct streams are requested by content.js (isolated world), the way Video DownloadHelper does it:
      // a request made from the page goes through whatever other extensions (ad blockers) did to fetch / JSON.
      window.postMessage({ __vsniffer: 1, items: [], youtube: info }, '*');
    }
  }


  document.addEventListener('yt-navigate-finish', () => {
    setTimeout(scanYouTube, 500);
    setTimeout(scanYouTube, 2500);
  });

  function scanMedia() {
    const v = mainVideo();
    if (!v) return;
    sendMain(v);
    const src = v.currentSrc || v.src || v.getAttribute('src');
    if (src) report(src, 'video element', true);
    v.querySelectorAll('source').forEach((s) => s.src && report(s.src, 'video element', true));
  }

  // Players often keep the stream URL in a data-* attribute of the player or its nearest wrappers.
  function scanAround() {
    let el = mainVideo();
    for (let i = 0; el && i < 5; i++, el = el.parentElement) {
      for (const a of el.attributes) {
        if (a.name.startsWith('data-') && a.value.length < 4000) scanText(a.value, 'player attribute');
      }
    }
  }

  let mediaTimer = 0;
  function scheduleMediaScan() {
    clearTimeout(mediaTimer);
    mediaTimer = setTimeout(scanMedia, 300);
  }

  const srcDesc = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'src');
  if (srcDesc?.set) {
    Object.defineProperty(HTMLMediaElement.prototype, 'src', {
      ...srcDesc,
      set(v) {
        scheduleMediaScan();
        return srcDesc.set.call(this, v);
      },
    });
  }

  const observers = new WeakSet();
  function watch(root) {
    if (observers.has(root)) return;
    observers.add(root);
    new MutationObserver(scheduleMediaScan).observe(root, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
    });
    scheduleMediaScan();
  }

  // Shadow DOM (also closed roots): hook attachShadow so we can observe inside.
  const origAttach = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init) {
    const root = origAttach.call(this, init);
    try {
      shadowRoots.push(root);
      watch(root);
    } catch {}
    return root;
  };

  for (const type of ['loadstart', 'durationchange', 'playing']) {
    document.addEventListener(
      type,
      (e) => {
        if (e.target instanceof HTMLVideoElement) scheduleMediaScan();
      },
      true
    );
  }

  // Opt-in probe: if the main video has loaded nothing, give it a short muted play so its real
  // stream URL appears on the network. Playback state is restored afterwards.
  let probe = false;
  let probed = new WeakSet();
  async function probeMain() {
    const v = probe && mainVideo();
    if (!v || probed.has(v) || !v.paused || v.ended || v.readyState > 0) return;
    probed.add(v);
    const wasMuted = v.muted;
    const t = v.currentTime;
    try {
      if (v.preload === 'none') v.preload = 'auto';
      v.muted = true;
      await v.play().catch(() => {});
      await new Promise((r) => setTimeout(r, 1500));
      v.pause();
      v.currentTime = t;
    } catch {}
    v.muted = wasMuted;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || !e.data) return;
    if (e.data.__vsniffer_cfg === 2) return rescan();
    if (e.data.__vsniffer_cfg !== 1) return;
    probe = !!e.data.probe;
    if (probe && document.readyState === 'complete') probeMain();
  });

  // The page changed without a reload (single-page app): forget what was reported and look again.
  function rescan() {
    seen.clear();
    lastMain = '';
    lastYoutube = '';
    streamTries = 0;
    probed = new WeakSet();
    for (const ms of [800, 2000, 4500]) {
      setTimeout(() => {
        scanPage();
        probeMain();
      }, ms);
    }
  }

  function scanPage() {
    watch(document);
    scanMedia();
    scanAround();
    scanYouTube();
    document.querySelectorAll('script:not([src])').forEach((s) => scanText(s.textContent, 'page script'));
    document
      .querySelectorAll('meta[property="og:video"], meta[property="og:video:url"], meta[property="og:video:secure_url"], meta[name="twitter:player:stream"]')
      .forEach((m) => report(m.content, 'meta tag'));
  }

  if (document.readyState === 'loading') {
    watch(document);
    document.addEventListener('DOMContentLoaded', scanPage);
  } else {
    scanPage();
  }

  // Players initialise late, so look again shortly after load.
  window.addEventListener('load', () => {
    scanPage();
    setTimeout(() => {
      scanPage();
      probeMain();
    }, 1500);
    setTimeout(() => {
      scanPage();
      probeMain();
    }, 4000);
  });
})();
