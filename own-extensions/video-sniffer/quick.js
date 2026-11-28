// A small ⬇ on every video: one click saves the best quality straight to Downloads (no new tab, no popup).
(() => {
  if (window.__vsQuick) return;
  window.__vsQuick = true;
  const IS_FB = /(^|\.)facebook\.com$/.test(location.hostname);
  // Facebook: ESUIT's mechanism (fbesuit.js) is injected into the page AFTER it has loaded, as ESUIT does it,
  // and can be switched off in the popup. While it is on, its button sits inside the player.
  let esuitOn = false;
  if (IS_FB) {
    chrome.storage.local.get({ esuit: false }).then((o) => {
      esuitOn = o.esuit === true;
      if (!esuitOn) return;
      const go = () => {
        try {
          const s = document.createElement('script');
          s.src = chrome.runtime.getURL('fbesuit.js');
          s.onload = () => s.remove();
          (document.head || document.documentElement).appendChild(s);
        } catch {}
      };
      if (document.readyState === 'complete') go();
      else window.addEventListener('load', go, { once: true });
    }).catch(() => {});
  }
  let btn = null;
  let current = null;
  let hideTimer = 0;
  let lastMove = 0;
  let busy = false;
  const LABEL = 'Video Sniffer: download this video (best quality)';
  // Ultimate SN Downloader puts its own blue ⬇ in the same corner on Facebook/Instagram ...
  const SHIFT = /(^|\.)(facebook|instagram)\.com$/.test(location.hostname) ? 46 : 0;

  // The page's own GraphQL replies (posted by inject.js): where Facebook keeps every video's addresses.
  const captured = [];
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.__vsniffer !== 2) return;
    captured.push(e.data.text);
    if (captured.length > 400) captured.shift();
  });

  function parsePayload(text) {
    let t = String(text || '').trim();
    if (t.startsWith('for (;;);')) t = t.slice(9);
    try {
      return [JSON.parse(t)];
    } catch {}
    const docs = [];
    for (let line of t.split('\n')) {
      line = line.trim();
      if (line.startsWith('for (;;);')) line = line.slice(9);
      if (line[0] === '{' || line[0] === '[') {
        try {
          docs.push(JSON.parse(line));
        } catch {}
      }
    }
    return docs;
  }

  function ensure() {
    if (btn) return btn;
    btn = document.createElement('div');
    btn.textContent = '⬇';
    btn.title = LABEL;
    btn.style.cssText =
      'position:fixed;z-index:2147483647;display:none;min-width:34px;height:34px;padding:0 6px;box-sizing:border-box;border-radius:17px;background:#1e9e5a;color:#fff;font:700 17px/34px system-ui,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);user-select:none;';
    btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    btn.addEventListener('mouseleave', hideSoon);
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) btn.addEventListener(t, (e) => e.stopPropagation(), true);
    btn.addEventListener('click', onClick, true);
    document.documentElement.appendChild(btn);
    return btn;
  }

  // A failure must be readable, not hidden in a tooltip.
  let toastEl = null;
  function toast(text) {
    if (!btn) return;
    if (!toastEl) {
      toastEl = document.createElement('div');
      toastEl.style.cssText =
        'position:fixed;z-index:2147483647;max-width:340px;padding:8px 12px;border-radius:8px;background:#b3261e;color:#fff;font:13px/1.4 system-ui,sans-serif;box-shadow:0 2px 10px rgba(0,0,0,.5);user-select:text;cursor:text;';
      document.documentElement.appendChild(toastEl);
    }
    const r = btn.getBoundingClientRect();
    toastEl.textContent = `Video Sniffer: ${text}`;
    toastEl.style.left = Math.max(4, Math.min(innerWidth - 350, r.left - 300)) + 'px';
    toastEl.style.top = r.bottom + 8 + 'px';
    toastEl.style.display = 'block';
    clearTimeout(toast.t);
    toast.t = setTimeout(() => (toastEl.style.display = 'none'), 12000);
  }

  function show(sym, title, keep) {
    if (!btn) return;
    if (sym === '✕') toast(title);
    btn.textContent = sym;
    btn.title = title || LABEL;
    if (!keep) {
      clearTimeout(show.t);
      show.t = setTimeout(() => {
        if (btn) {
          btn.textContent = '⬇';
          btn.title = LABEL;
        }
        busy = false;
      }, 3500);
    }
  }

  function hideSoon() {
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => {
      if (btn && !busy) btn.style.display = 'none';
      current = null;
    }, 900);
  }

  // elementsFromPoint skips elements with pointer-events:none, which Facebook puts on its <video> (an overlay
  // takes the clicks). So the videos are tested by their own rectangle instead; the smallest one under the
  // pointer wins (a reel page also holds the next reel's video).
  function videoAt(x, y) {
    let best = null;
    let bestArea = Infinity;
    for (const v of document.getElementsByTagName('video')) {
      const r = v.getBoundingClientRect();
      if (r.width < 160 || r.height < 100 || x < r.left || x > r.right || y < r.top || y > r.bottom) continue;
      if (getComputedStyle(v).visibility === 'hidden') continue;
      const area = r.width * r.height;
      if (area < bestArea) {
        best = v;
        bestArea = area;
      }
    }
    return best;
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      const now = Date.now();
      if (now - lastMove < 100) return;
      lastMove = now;
      if (IS_FB && esuitOn) return; // the button is inside the player (fbesuit.js)
      const v = videoAt(e.clientX, e.clientY);
      if (!v) return current && hideSoon();
      const r = v.getBoundingClientRect();
      if (r.width < 160 || r.height < 100) return;
      clearTimeout(hideTimer);
      current = v;
      const b = ensure();
      b.style.left = Math.max(4, Math.min(innerWidth - 44, r.right - 48 - SHIFT)) + 'px';
      b.style.top = Math.max(4, r.top + 10) + 'px';
      b.style.display = 'block';
    },
    true
  );

  // Facebook: fbesuit.js (page world) asks for the download and shows the progress.
  if (IS_FB) {
    window.addEventListener('message', (e) => {
      if (e.source !== window || e.data?.__vsniffer !== 6) return;
      chrome.runtime.sendMessage({ type: 'quick', isFb: true, fb: e.data.fb, page: e.data.page, title: e.data.title, src: '', duration: 0 }).catch(() => {});
    });
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg?.type === 'qstatus') window.postMessage({ __vsniffer: 7, text: msg.text, title: msg.title }, '*');
    });
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== 'qstatus' || !btn) return;
    const pending = msg.text !== '✓' && msg.text !== '✕';
    show(msg.text, msg.title, pending);
    if (msg.text === '✓' || msg.text === '✕') busy = false;
  });

  async function onClick(e) {
    e.preventDefault();
    e.stopPropagation();
    if (busy || !current) return;
    busy = true;
    show('…', 'Looking for the best quality…', true);
    const v = current;
    const msg = { type: 'quick', page: top === window ? location.href : document.referrer || location.href, title: document.title, duration: v.duration, src: v.currentSrc || v.src || '' };
    try {
      if (IS_FB) {
        msg.isFb = true;
        msg.fb = await findFacebook(v);
        const a = lastAsk;
        if (!msg.fb) msg.fbReason = (
          a?.timedOut ? `Took too long at step "${a.timedOut}" - trying the files the player downloaded`
          : !a ? 'Page script did not answer - reload the Facebook tab (F5) and try again'
          : !a.store ? 'Facebook\'s data store is not hooked - reload the tab (F5), then try again'
          : `This video is not in the page data yet (tried ${a.tried?.length || 0} ids) - let it play for a second, then click again`
        );
      }
      await chrome.runtime.sendMessage(msg);
    } catch (err) {
      show('✕', err.message || String(err));
      busy = false;
    }
  }

  // ---- Facebook: the video's addresses live in the page's JSON (progressive HD/SD files and a DASH manifest).
  const FIELDS = {
    browser_native_hd_url: 0,
    playable_url_quality_hd: 1,
    hd_src_no_ratelimit: 1.2,
    hd_src: 1.4,
    browser_native_sd_url: 3,
    progressive_url: 3.5,
    playable_url: 4,
    sd_src_no_ratelimit: 4.5,
    sd_src: 5,
  };
  const FIELD_RE = new RegExp(`"(${Object.keys(FIELDS).join('|')})"\\s*:\\s*"(https?:[^"]+)"`, 'g');

  function videoId(video) {
    let node = video;
    let href = null;
    for (let d = 0; node && d < 14 && !href; d++, node = node.parentElement) {
      const a = node.querySelector?.('a[href*="/reel/"], a[href*="/videos/"], a[href*="/watch/?v="], a[href*="/watch?v="]');
      if (a) href = a.getAttribute('href');
    }
    const h = href || location.pathname + location.search;
    return (h.match(/\/reel\/(\d+)/) || h.match(/\/videos\/(?:[^/]+\/)?(\d+)/) || h.match(/[?&](?:v|video_id)=(\d+)/) || [])[1] || null;
  }

  function walk(root, id, out) {
    const stack = [[root, false]];
    while (stack.length) {
      const [o, inside] = stack.pop();
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) {
        for (const x of o) stack.push([x, inside]);
        continue;
      }
      const hit = inside || [o.id, o.video_id, o.videoId, o.legacy_fbid].some((x) => String(x || '') === id);
      if (hit) {
        for (const k in FIELDS) {
          if (typeof o[k] !== 'string' || !/^https?:/.test(o[k])) continue;
          let rank = FIELDS[k];
          if (k === 'progressive_url' && /hd/i.test(String(o.metadata?.quality || ''))) rank = 1.5;
          out.urls.push({ url: o[k], rank });
        }
        const mpd = o.dash_manifest_xml_string || (typeof o.dash_manifest === 'string' && o.dash_manifest.includes('<MPD') ? o.dash_manifest : '');
        if (mpd && !out.mpd) out.mpd = mpd;
        // current Facebook layout: video_delivery_response { progressive_urls: [{ progressive_url, metadata: { quality } }], dash_manifests: [{ manifest_xml }] }
        if (typeof o.manifest_xml === 'string' && o.manifest_xml.includes('<MPD') && !out.mpd) out.mpd = o.manifest_xml;
      }
      for (const k in o) if (o[k] && typeof o[k] === 'object') stack.push([o[k], hit]);
    }
  }

  // Per AdaptationSet the largest Representation (FBContentLength / bandwidth). Facebook's DASH files are one
  // file per stream, read in pieces: Initialization range + sidx (indexRange) + the pieces the sidx lists.
  function parseMpd(xml) {
    const doc = new DOMParser().parseFromString(xml, 'text/xml');
    let video = null;
    let audio = null;
    for (const set of doc.getElementsByTagName('AdaptationSet')) {
      const isAudio = /audio/i.test(set.getAttribute('contentType') || set.getAttribute('mimeType') || '') || !!set.getElementsByTagName('AudioChannelConfiguration').length;
      let best = null;
      for (const r of set.getElementsByTagName('Representation')) {
        const size = Number(r.getAttribute('FBContentLength') || r.getAttribute('bandwidth') || 0);
        const url = r.getElementsByTagName('BaseURL')[0]?.textContent?.trim();
        if (!url || (best && size <= best.size)) continue;
        const sb = r.getElementsByTagName('SegmentBase')[0];
        const init = sb?.getElementsByTagName('Initialization')[0]?.getAttribute('range') || '';
        best = {
          url,
          size,
          height: Number(r.getAttribute('height')) || parseInt(r.getAttribute('FBQualityLabel')) || 0,
          index: sb?.getAttribute('indexRange') || '',
          init,
        };
      }
      if (!best) continue;
      if (isAudio) audio = best;
      else video = best;
    }
    return video ? { video, audio, height: video.height } : null;
  }

  // Ask inject.js (page world) for the video's record in Facebook's Relay store (ESUIT's mechanism).
  let reqSeq = 0;
  let lastAsk = null;
  function askStore(id, video) {
    return new Promise((resolve) => {
      const req = ++reqSeq;
      const done = (v) => {
        window.removeEventListener('message', on);
        clearTimeout(t);
        video?.removeAttribute('data-vs-pick');
        lastAsk = v;
        resolve(v?.data || null);
      };
      const on = (e) => {
        if (e.source === window && e.data?.__vsr === 1 && e.data.req === req) done(e.data);
      };
      const t = setTimeout(() => done(null), 2000);
      window.addEventListener('message', on);
      video?.setAttribute('data-vs-pick', '1');
      window.postMessage({ __vsq: 1, id, req, duration: video?.duration || 0 }, '*');
    });
  }

  function fromStore(d) {
    if (!d) return null;
    const url = d.hd || d.sd || '';
    const dash = d.mpd ? parseMpd(d.mpd) : null;
    return url || dash ? { url, dash } : null;
  }

  function bestFrom(out) {
    const urls = out.urls.sort((a, b) => a.rank - b.rank);
    const dash = out.mpd ? parseMpd(out.mpd) : null;
    return urls.length || dash ? { url: urls[0]?.url || '', dash } : null;
  }

  function unesc(u) {
    try {
      return JSON.parse(`"${u}"`);
    } catch {
      return u.replace(/\\\//g, '/').replace(/\\u0025/g, '%').replace(/\\u0026/g, '&');
    }
  }

  function fromText(text, id) {
    let best = null;
    let bestRank = 99;
    let m;
    FIELD_RE.lastIndex = 0;
    while ((m = FIELD_RE.exec(text))) {
      const near = !id || text.slice(Math.max(0, m.index - 6000), m.index + 6000).includes(id);
      let rank = FIELDS[m[1]] + (near ? 0 : 10);
      if (m[1] === 'progressive_url') {
        // the quality of THIS item only: from the item's own '{' to the next progressive_url
        const start = text.lastIndexOf('{', m.index);
        const end = m.index + m[0].length;
        let tail = text.slice(end, end + 400);
        const nx = tail.indexOf('"progressive_url"');
        if (nx >= 0) tail = tail.slice(0, nx);
        if (/"quality"\s*:\s*"HD"/.test(text.slice(Math.max(0, start), m.index) + tail)) rank = (near ? 0 : 10) + 1.5;
      }
      if (rank < bestRank) {
        bestRank = rank;
        best = m[2];
      }
    }
    return best && bestRank < 10 ? { url: unesc(best), dash: null } : null;
  }

  // Scans the JSON blocks of the live page (not its whole HTML: a feed's HTML is tens of MB).
  function fromLivePage(id) {
    const out = { urls: [], mpd: '' };
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      const t = s.textContent;
      if (!t || t.length > 15e6 || !t.includes(id)) continue;
      try {
        walk(JSON.parse(t), id, out);
      } catch {}
    }
    const got = bestFrom(out);
    if (got) return got;
    // not nested under the video's own node: take the address nearest to the id in the raw JSON text
    for (const s of document.querySelectorAll('script[type="application/json"]')) {
      const t = s.textContent;
      if (!t || t.length > 15e6 || !t.includes(id)) continue;
      const f = fromText(t, id);
      if (f) return f;
    }
    return null;
  }

  // A fetched page of the video (/reel/<id>/, /watch/?v=<id>).
  function fromDocument(html, id) {
    const out = { urls: [], mpd: '' };
    const re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g;
    let m;
    while ((m = re.exec(html))) {
      if (!m[1].includes(id)) continue;
      try {
        walk(JSON.parse(m[1]), id, out);
      } catch {}
    }
    return bestFrom(out) || fromText(html, id);
  }

  let step = '';
  const tick = () => new Promise((r) => setTimeout(r, 0)); // let the page breathe between heavy steps

  async function findFacebook(video) {
    // a reel page also holds the NEXT reel's <video>: try the id of the link near this video and the page's own id
    const pageId = (location.pathname.match(/\/reel\/(\d+)/) || location.pathname.match(/\/videos\/(?:[^/]+\/)?(\d+)/) || location.search.match(/[?&]v=(\d+)/) || [])[1] || '';
    const ids = [...new Set([videoId(video) || '', pageId].filter(Boolean))];
    let found = null;
    for (const id of ids.length ? ids : ['']) {
      found = await findOne(video, id);
      if (found || !id) break;
    }
    return found;
  }

  async function findOne(video, id) {
    const run = async () => {
      step = 'Relay store';
      show('…', 'Reading the video data (1/4: page store)…', true);
      const live = fromStore(await askStore(id, video));
      if (live) return live;
      if (!id) return null;
      step = 'received replies';
      show('…', 'Reading the video data (2/4: page replies)…', true);
      await tick();
      const out = { urls: [], mpd: '' };
      for (let i = captured.length - 1; i >= 0; i--) {
        if (captured[i].includes(id)) for (const d of parsePayload(captured[i])) walk(d, id, out);
      }
      const got = bestFrom(out);
      if (got) return got;
      step = 'page data';
      show('…', 'Reading the video data (3/4: page data)…', true);
      await tick();
      const here = fromLivePage(id);
      if (here) return here;
      step = "the video's own page";
      show('…', "Reading the video data (4/4: the video's page)…", true);
      for (const path of [`/reel/${id}/`, `/watch/?v=${id}`]) {
        try {
          const r = await fetch(path, { credentials: 'include', headers: { accept: 'text/html' }, signal: AbortSignal.timeout(6000) });
          if (!r.ok) continue;
          const found = fromDocument(await r.text(), id);
          if (found) return found;
        } catch {}
      }
      return null;
    };
    // Never hang: after 15 s give up and let the background try the files the player downloaded.
    const timeout = new Promise((r) => setTimeout(() => r('timeout'), 15000));
    const res = await Promise.race([run().catch(() => null), timeout]);
    if (res === 'timeout') {
      lastAsk = { ...(lastAsk || {}), timedOut: step };
      return null;
    }
    return res;
  }
})();
