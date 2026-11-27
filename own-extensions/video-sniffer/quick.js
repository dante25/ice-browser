// A small ⬇ on every video: one click saves the best quality straight to Downloads (no new tab, no popup).
(() => {
  if (window.__vsQuick) return;
  window.__vsQuick = true;
  const IS_FB = /(^|\.)facebook\.com$/.test(location.hostname);
  let btn = null;
  let current = null;
  let hideTimer = 0;
  let lastMove = 0;
  let busy = false;
  const LABEL = 'Download this video (best quality)';

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
      'position:fixed;z-index:2147483647;display:none;min-width:34px;height:34px;padding:0 6px;box-sizing:border-box;border-radius:17px;background:#2f7cf6;color:#fff;font:700 17px/34px system-ui,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.5);user-select:none;';
    btn.addEventListener('mouseenter', () => clearTimeout(hideTimer));
    btn.addEventListener('mouseleave', hideSoon);
    for (const t of ['mousedown', 'mouseup', 'pointerdown', 'pointerup']) btn.addEventListener(t, (e) => e.stopPropagation(), true);
    btn.addEventListener('click', onClick, true);
    document.documentElement.appendChild(btn);
    return btn;
  }

  function show(sym, title, keep) {
    if (!btn) return;
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

  function videoAt(x, y) {
    for (const el of document.elementsFromPoint(x, y)) if (el.tagName === 'VIDEO') return el;
    return null;
  }

  document.addEventListener(
    'mousemove',
    (e) => {
      const now = Date.now();
      if (now - lastMove < 100) return;
      lastMove = now;
      const v = videoAt(e.clientX, e.clientY);
      if (!v) return current && hideSoon();
      const r = v.getBoundingClientRect();
      if (r.width < 160 || r.height < 100) return;
      clearTimeout(hideTimer);
      current = v;
      const b = ensure();
      b.style.left = Math.max(4, Math.min(innerWidth - 44, r.right - 48)) + 'px';
      b.style.top = Math.max(4, r.top + 10) + 'px';
      b.style.display = 'block';
    },
    true
  );

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
      if (IS_FB) msg.fb = await findFacebook(v);
      if (IS_FB && !msg.fb) throw new Error('Facebook did not give this video\'s address - open the video itself and try again');
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
    return (h.match(/\/reel\/(\d+)/) || h.match(/\/videos\/(?:[^/]+\/)?(\d+)/) || h.match(/[?&]v=(\d+)/) || [])[1] || null;
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
      }
      for (const k in o) if (o[k] && typeof o[k] === 'object') stack.push([o[k], hit]);
    }
  }

  // Per AdaptationSet the largest Representation (FBContentLength / bandwidth), like SN Downloader's parseDash.
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
        if (url && (!best || size > best.size)) best = { url, size, height: Number(r.getAttribute('height')) || 0 };
      }
      if (!best) continue;
      if (isAudio) audio = best;
      else video = best;
    }
    return video ? { video: video.url, audio: audio?.url || '', height: video.height } : null;
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
      const rank = FIELDS[m[1]] + (near ? 0 : 10);
      if (rank < bestRank) {
        bestRank = rank;
        best = m[2];
      }
    }
    return best && bestRank < 10 ? { url: unesc(best), dash: null } : null;
  }

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

  let reqSeq = 0;
  function fromStore(id) {
    return new Promise((resolve) => {
      const req = ++reqSeq;
      const done = (v) => {
        removeEventListener('message', on);
        clearTimeout(t);
        resolve(v);
      };
      const on = (e) => {
        if (e.source !== window || e.data?.__vsniffer !== 4 || e.data.req !== req) return;
        const r = e.data.result;
        if (!r) return done(null);
        const dash = r.mpd ? parseMpd(r.mpd) : null;
        const url = r.hd || r.sd || '';
        done(url || dash ? { url, dash } : null);
      };
      const t = setTimeout(() => done(null), 1500);
      addEventListener('message', on);
      postMessage({ __vsniffer: 3, id, req }, '*');
    });
  }

  async function findFacebook(video) {
    const id = videoId(video);
    if (!id) return null;
    show('…', 'Reading the video data…', true);
    // 0) Facebook's own Relay store, read by video id (the ESUIT method, see fbstore.js)
    const st = await fromStore(id);
    if (st) return st;
    // 1) what the page has received (feed / reel replies), newest first
    const out = { urls: [], mpd: '' };
    for (let i = captured.length - 1; i >= 0; i--) {
      if (captured[i].includes(id)) for (const d of parsePayload(captured[i])) walk(d, id, out);
    }
    const got = bestFrom(out);
    if (got) return got;
    // 2) the page's embedded JSON / HTML, 3) the video's own page
    const here = fromDocument(document.documentElement.innerHTML, id);
    if (here) return here;
    for (const path of [`/reel/${id}/`, `/watch/?v=${id}`, `/video.php?v=${id}`]) {
      try {
        const r = await fetch(path, { credentials: 'include', headers: { accept: 'text/html' } });
        if (!r.ok) continue;
        const found = fromDocument(await r.text(), id);
        if (found) return found;
      } catch {}
    }
    return null;
  }
})();
