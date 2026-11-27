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

  // Facebook/Instagram: the site's own GraphQL replies hold every video's HD/DASH addresses (the mechanism of
  // Ultimate SN Downloader's main_hook.js). Passed to quick.js, which looks the clicked video up by its id.
  const CAP = /\/api\/graphql|\/graphql\/query|\/api\/v1\/|\/ajax\/|\/graphql\/|\/_puppy\/|\/_napi\//;
  const capture = (url, text) => {
    try {
      if (/(^|\.)(facebook|instagram)\.com$/.test(location.hostname) && CAP.test(url) && text) window.postMessage({ __vsniffer: 2, url, text }, '*');
    } catch {}
  };

  // ---- Facebook: read the video addresses straight out of the page's own Relay store -----------------------
  // Mechanism of ESUIT Video Downloader for Facebook: facebook.com defines its modules with window.__d(name, deps,
  // factory). The factory of relay-runtime/store/RelayPublishQueue is rewritten so the RecordSourceProxy is kept in
  // window.___rs; every video the page has loaded (feed, reel, watch) is then a record in that store, with
  // playable_url (SD), playable_url(quality:"HD"), the DASH manifest and progressive_urls.
  const IS_FB = /(^|\.)facebook\.com$/.test(location.hostname);
  if (IS_FB && !window.__vsRelay) {
    window.__vsRelay = true;
    const MOD = 'relay-runtime/store/RelayPublishQueue';
    const patch = (src) =>
      src.replace(
        /,(\w+)=new\((\w+)\("relay-runtime\/mutations\/RelayRecordSourceProxy"/,
        ',$1=window.___rs=new($2("relay-runtime/mutations/RelayRecordSourceProxy"'
      );
    const rebuild = (fn) => {
      let src;
      try {
        src = Function.prototype.toString.call(fn);
      } catch {
        return fn;
      }
      const out = patch(src);
      if (out === src) return fn;
      const params = (out.slice(out.indexOf('(') + 1, out.indexOf(')')).replace(/\/\*[\s\S]*?\*\//g, '').match(/[^\s,]+/g) || []).join(',');
      const body = out.slice(out.indexOf('{') + 1, out.lastIndexOf('}'));
      try {
        const s = document.createElement('script');
        s.text = `window.__vsFn=function(${params}){${body}}`;
        (document.head || document.documentElement).appendChild(s).remove();
        if (typeof window.__vsFn === 'function') return window.__vsFn;
      } catch {}
      try {
        return new Function(params, body);
      } catch {
        return fn;
      }
    };
    const wrapD = (d) =>
      new Proxy(d, {
        apply(target, self, args) {
          try {
            if (args[0] === MOD && typeof args[2] === 'function') args[2] = rebuild(args[2]);
          } catch {}
          return target.apply(self, args);
        },
      });
    let dFn = window.__d;
    if (dFn && !String(dFn).includes('__d_stub')) dFn = wrapD(dFn);
    else dFn = undefined;
    Object.defineProperty(window, '__d', {
      configurable: true,
      get: () => dFn,
      set: (v) => {
        dFn = typeof v === 'function' ? wrapD(v) : v;
      },
    });
  }

  // Every record map the store keeps (the same walk ESUIT does with getRoot().__sources).
  function relayMaps() {
    const maps = [];
    try {
      const root = window.___rs?.getRoot?.();
      if (!root) return maps;
      for (const k of Object.keys(root)) {
        const o = root[k];
        if (o && Array.isArray(o.__sources)) {
          for (const src of o.__sources) for (const kk in src) if (src[kk] instanceof Map) maps.push(src[kk]);
        }
      }
    } catch {}
    return maps;
  }
  function relayRec(id) {
    for (const m of relayMaps()) {
      const r = m.get(id);
      if (r) return r;
    }
    return null;
  }
  const refOf = (v) => (v && typeof v === 'object' && v.__ref ? relayRec(v.__ref) : null);

  // { sd, hd, mpd, prog: [{ q, url }] } for one video id, or null when the store has no such video.
  function relayVideo(id) {
    const r = relayRec(id);
    if (!r) return null;
    const out = { sd: '', hd: '', mpd: '', prog: [] };
    const str = (v) => (typeof v === 'string' && /^https?:/.test(v) ? v : '');
    for (const k of Object.keys(r)) {
      const v = r[k];
      if (k === 'playable_url') out.sd = out.sd || str(v);
      else if (/^playable_url\(.*HD/i.test(k)) out.hd = out.hd || str(v);
      else if (k === 'browser_native_hd_url' || k === 'hd_src' || k === 'hd_src_no_ratelimit') out.hd = out.hd || str(v);
      else if (k === 'browser_native_sd_url' || k === 'sd_src' || k === 'sd_src_no_ratelimit') out.sd = out.sd || str(v);
      else if (/^playlist\(.*MPEG_DASH/i.test(k) && typeof v === 'string' && v.includes('<MPD')) out.mpd = out.mpd || v;
      else if (k === 'dash_manifest' && typeof v === 'string' && v.includes('<MPD')) out.mpd = out.mpd || v;
      else if (/^video_delivery_response/.test(k)) {
        const d = refOf(v);
        if (!d) continue;
        for (const kk of Object.keys(d)) {
          if (kk === 'dash_manifests' && Array.isArray(d[kk])) {
            for (const ref of d[kk]) {
              const m = refOf(ref);
              if (m && typeof m.manifest_xml === 'string' && !out.mpd) out.mpd = m.manifest_xml;
            }
          } else if (kk === 'progressive_urls' && Array.isArray(d[kk])) {
            for (const ref of d[kk]) {
              const p = refOf(ref);
              const url = str(p?.progressive_url);
              if (!url) continue;
              const meta = refOf(p.metadata) || p.metadata || {};
              out.prog.push({ q: String(meta.quality || ''), url });
            }
          }
        }
      }
    }
    for (const p of out.prog) {
      if (/^HD$/i.test(p.q)) out.hd = out.hd || p.url;
      else if (/^SD$/i.test(p.q)) out.sd = out.sd || p.url;
    }
    return out.sd || out.hd || out.mpd ? out : null;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.__vsq !== 1) return;
    let data = null;
    try {
      data = relayVideo(String(e.data.id));
    } catch {}
    window.postMessage({ __vsr: 1, req: e.data.req, data, store: !!window.___rs }, '*');
  });

  // The playing Facebook video: list its complete files (not the 0.5 MB pieces the player fetches).
  function scanFacebook() {
    if (!IS_FB) return;
    const h = location.pathname + location.search;
    const id = (h.match(/\/reel\/(\d+)/) || h.match(/\/videos\/(?:[^/]+\/)?(\d+)/) || h.match(/[?&]v=(\d+)/) || [])[1];
    if (!id) return;
    const d = relayVideo(id);
    if (!d) return;
    if (d.hd) report(d.hd, 'Facebook HD', true);
    if (d.sd) report(d.sd, 'Facebook SD', true);
  }

  // fetch: request URL + any URL found in text/JSON responses (weak: API replies list many unrelated videos).
  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const input = args[0];
      const reqUrl = typeof input === 'string' ? input : input?.url || String(input);
      report(reqUrl, 'fetch');
      p.then((r) => {
        if (CAP.test(reqUrl)) r.clone().text().then((t) => capture(reqUrl, t)).catch(() => {});
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
          if (this.responseType === '' || this.responseType === 'text') {
            scanText(this.responseText, 'xhr response');
            capture(String(url), this.responseText);
          }
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
    let pr;
    try {
      pr = document.getElementById('movie_player')?.getPlayerResponse?.();
    } catch {}
    const here = new URL(location.href);
    const wanted = here.searchParams.get('v') || here.pathname.match(/^\/shorts\/([\w-]+)/)?.[1];
    const id = pr?.videoDetails?.videoId;
    if (!id || id !== wanted) return;
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
    const info = { id, title: pr.videoDetails.title || '', formats };
    const cached = streamsCache?.id === id ? streamsCache.streams : null;
    if (sig !== lastYoutube) {
      lastYoutube = sig;
      // Streams found earlier are always resent: a post without them would erase them in the popup.
      window.postMessage({ __vsniffer: 1, items: [], youtube: cached ? { ...info, streams: cached } : info }, '*');
    }
    if (!cached) fetchStreams(info);
  }

  // The web player gets no file URLs from YouTube any more, so the streams are requested the way
  // YouTube's visionOS app does it (the iOS client's URLs stalled after ~28 MB; VDH uses this one).
  // Direct mp4 video + audio URLs come back; the downloader merges them.
  // EXPERIMENTAL: if this stops working, restore the video-sniffer-STABILNO backup.
  const YT_CLIENT = {
    clientName: 'VISIONOS',
    clientVersion: '1.02',
    deviceMake: 'Apple',
    deviceModel: 'RealityDevice17,1',
    osName: 'visionOS',
    osVersion: '26.5.23O471',
    hl: 'en',
    gl: 'US',
  };
  let streamsCache = null; // { id, streams } once the direct streams of a video were found
  let streamsBusy = false;
  let streamTries = 0;
  let streamsTriesFor = '';
  async function fetchStreams(info) {
    if (streamsTriesFor !== info.id) {
      streamsTriesFor = info.id;
      streamTries = 0;
    }
    if (streamsBusy || streamTries >= 4) return;
    streamsBusy = true;
    streamTries++;
    try {
      const key = window.ytcfg?.get?.('INNERTUBE_API_KEY');
      const r = await fetch(`/youtubei/v1/player?prettyPrint=false${key ? `&key=${key}` : ''}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-youtube-client-name': '101', 'x-youtube-client-version': YT_CLIENT.clientVersion },
        body: JSON.stringify({ context: { client: YT_CLIENT }, videoId: info.id, contentCheckOk: true, racyCheckOk: true }),
      });
      const sd = (await r.json()).streamingData || {};
      const all = [...(sd.formats || []), ...(sd.adaptiveFormats || [])].filter((f) => f.url);
      const pick = (f) => ({ itag: f.itag, height: f.height || 0, fps: f.fps || 0, size: Number(f.contentLength) || 0, url: f.url });
      const video = all.filter((f) => /^video\/mp4/.test(f.mimeType) && f.qualityLabel && !f.audioQuality).map(pick);
      const muxed = all.filter((f) => /^video\/mp4/.test(f.mimeType) && f.qualityLabel && f.audioQuality).map(pick);
      const audio = all.filter((f) => /^audio\/mp4/.test(f.mimeType)).sort((a, b) => b.bitrate - a.bitrate)[0];
      if (!video.length && !muxed.length) return;
      const streams = { video, muxed, audio: audio ? pick(audio) : null };
      streamsCache = { id: info.id, streams };
      window.postMessage({ __vsniffer: 1, items: [], youtube: { ...info, streams } }, '*');
    } catch {
      // retried on a later scan
    } finally {
      streamsBusy = false;
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
    scanFacebook();
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
