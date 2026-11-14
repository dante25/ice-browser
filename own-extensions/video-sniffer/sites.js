// Site modules (isolated world): on these sites the stream address is not visible in the page until the player asks for
// it (or never, for live rooms), so it is looked up through the site's own API / page data and reported to the background
// worker like any other detection. The methods are the ones Video DownloadHelper 10.7.1.2 uses for the same sites.
(() => {
  if (window !== window.top) return;
  const host = location.hostname.replace(/^www\./, '');
  const seen = new Set();
  function found(url, kind) {
    try {
      url = new URL(url, location.href).href;
    } catch {
      return;
    }
    if (seen.has(url)) return;
    seen.add(url);
    try {
      chrome.runtime.sendMessage({ type: 'found', items: [{ url, kind, source: 'site', force: true }] }).catch(() => {});
    } catch {}
  }
  const getJson = async (url, opts) => {
    const r = await fetch(url, opts);
    if (!r.ok) throw new Error(`${r.status} ${url}`);
    return r.json();
  };
  const kindOf = (u) => (/\.mpd(?:$|[?#])/i.test(u) ? 'dash' : 'hls');

  // ---- Twitcasting: live room -> streamserver.php -> tc-hls.streams.high
  async function twitcasting() {
    const m = location.href.match(/^(?:https?:\/\/)?(?:[\w-]+\.)*twitcasting\.tv\/([\w:-]+)\/?$/i);
    if (!m) return;
    const j = await getJson(`https://en.twitcasting.tv/streamserver.php?target=${encodeURIComponent(m[1])}&mode=client&player=pc_web`);
    const s = j?.['tc-hls']?.streams || {};
    const u = s.high || s.medium || s.low;
    if (u) found(u, 'hls');
  }

  // ---- Kick: channel (live) / VOD / clip
  async function kickMaster(url, depth = 0) {
    if (depth >= 3) return null;
    const r = await fetch(url);
    if (!r.ok) return null;
    const t = await r.text();
    const direct = t.match(/https:\/\/stream\.kick\.com\/\S+?\/media\/hls\//)?.[0];
    if (direct) return direct + 'master.m3u8';
    const next = t.split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));
    return next ? kickMaster(new URL(next, url).href, depth + 1) : null;
  }
  async function kickOne(type, id) {
    let j;
    if (type === 'channel') j = await getJson(`https://kick.com/api/v2/channels/${id}`);
    else if (type === 'videos')
      j = await getJson(`https://web.kick.com/api/v1/stream/${id}/playback`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ video_player: { player: {} }, video_session: {}, user_session: { non_personalised_ads: true } }),
      });
    else j = await getJson(`https://kick.com/api/v2/clips/${id}`);
    let u = type === 'channel' ? j.playback_url : type === 'videos' ? j.playback_url?.vod : j.clip?.playback_url ?? j.clip?.clip_url ?? j.clip?.video_url;
    if (!u) return;
    if (type === 'videos' && !/master\.m3u8/.test(u)) u = (await kickMaster(u)) || u;
    found(u, /\.m3u8/i.test(u) ? 'hls' : 'file');
  }
  async function kick() {
    const p = location.pathname.split('/').filter(Boolean);
    if (!p.length) return;
    const clip = new URLSearchParams(location.search).get('clip');
    if (clip) return kickOne('clips', clip);
    if (p[1] === 'videos' && p[2]) return kickOne('videos', p[2]);
    if (p[0] === 'video' && p[1]) return kickOne('videos', p[1]);
    if (p[1] === 'clips' && p[2]) return kickOne('clips', p[2]);
    if (p.length === 1 && !['browse', 'following', 'categories', 'search', 'dashboard'].includes(p[0])) return kickOne('channel', p[0]);
  }

  // ---- Chaturbate: room -> get_edge_hls_url_ajax, else initialRoomDossier.hls_source in the page
  async function chaturbate() {
    const m = location.href.match(/^https?:\/\/(?:[\w-]+\.)?chaturbate\.(?<tld>com|eu|global)\/(?<id>[^/?#]+)\/?(?:[?#].*)?$/);
    if (!m || ['tags', 'auth', 'accounts', 'tipping', 'supporter', 'b', 'p', 'female-cams', 'male-cams', 'couple-cams', 'trans-cams'].includes(m.groups.id)) return;
    try {
      const j = await getJson(`${location.origin}/get_edge_hls_url_ajax/`, {
        method: 'POST',
        body: new URLSearchParams({ room_slug: m.groups.id }),
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      });
      if (j.url) return found(j.url, 'hls');
    } catch {}
    const t = await (await fetch(location.href, { credentials: 'same-origin', headers: { Accept: 'text/html' } })).text();
    const d = t.match(/initialRoomDossier\s*=\s*(["'])(.+?)\1/s);
    if (!d) return;
    const src = JSON.parse(JSON.parse(`"${d[2]}"`))?.hls_source;
    if (src) found(src, 'hls');
  }

  // ---- Canva: /watch pages carry hlsManifestUrl in an inline script
  function canva() {
    if (!/canva\.com\/.*\/watch/.test(location.href)) return;
    for (const s of document.querySelectorAll('script[nonce]')) {
      const m = s.textContent.match(/['"]hlsManifestUrl['"]\s*:\s*['"]([^'"]+)['"]/);
      if (m) return found(m[1].replace(/\\u002F/gi, '/').replace(/\\\//g, '/'), 'hls');
    }
  }

  // ---- OK.ru: player options (data-options -> flashvars.metadata)
  function okMeta(doc) {
    for (const n of doc.querySelectorAll('div[data-options]')) {
      try {
        const o = JSON.parse(n.getAttribute('data-options'));
        let md = o?.flashvars?.metadata;
        if (!md) continue;
        if (typeof md === 'string') md = JSON.parse(md);
        const hls = md.hlsManifestUrl || md.ondemandHls || md.hlsMasterPlaylistUrl;
        if (hls) found(hls, 'hls');
        else if (md.dashSepUrl || md.ondemandDash) found(md.dashSepUrl || md.ondemandDash, 'dash');
        else continue;
        return true;
      } catch {}
    }
    return false;
  }
  async function ok() {
    if (okMeta(document)) return;
    const m = location.href.match(/ok\.ru\/(?:video|videoembed|live)\/(\d+)/);
    if (!m) return;
    const t = await (await fetch(`https://ok.ru/videoembed/${m[1]}`)).text();
    okMeta(new DOMParser().parseFromString(t, 'text/html'));
  }

  // ---- VK / VK Video: al_video.php (act=show) -> player params; live.vkvideo.ru has its own API
  async function vk() {
    if (location.hostname === 'live.vkvideo.ru') {
      const m = location.href.match(/^https:\/\/live\.vkvideo\.ru\/([^/]+)(?:\/record\/([^/?]+))?/);
      if (!m) return;
      if (m[2]) {
        const j = await getJson(`https://api.live.vkvideo.ru/v1/blog/${m[1]}/public_video_stream/record/${m[2]}`);
        const u = (j?.data?.record?.data?.[0]?.playerUrls || []).find((f) => f.type === 'ondemand_hls' || f.type === 'hls');
        if (u) found(u.url, 'hls');
      } else {
        const j = await getJson(`https://api.live.vkvideo.ru/v1/channel/${m[1]}/stream/slot/default`);
        const u = (j?.data?.stream?.data?.[0]?.playerUrls || []).find((f) => f.type === 'live_ondemand_hls' || f.type === 'live_hls');
        if (u) found(u.url, 'hls');
      }
      return;
    }
    const id = location.href.match(/(?:^|\/\/)(?:m\.)?(?:vk\.com|vk\.ru|vkvideo\.ru)\/(?:clip|live|video|playlist\/[^/]+\/video)(-?\d+_\d+)/)?.[1]
      || new URLSearchParams(location.search).get('z')?.match(/(?:video|clip)(-?\d+_\d+)/)?.[1];
    if (!id) return;
    const body = new URLSearchParams({ act: 'show', al: '1', video: id });
    const list = new URLSearchParams(location.search).get('list');
    if (list) body.set('list', list);
    const j = await getJson(`${location.origin}/al_video.php`, {
      method: 'POST',
      headers: { 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });
    const p = j?.payload?.[1]?.[4]?.player?.params?.[0];
    const u = p?.hls ?? p?.hls_ondemand ?? p?.hls_live;
    if (u) return found(u, 'hls');
    if (p) for (const q of ['url2160', 'url1440', 'url1080', 'url720', 'url480', 'url360', 'url240']) if (p[q]) return found(p[q], 'file');
  }

  const MODULES = [
    [/(^|\.)twitcasting\.tv$/, twitcasting],
    [/(^|\.)kick\.com$/, kick],
    [/(^|\.)chaturbate\.(com|eu|global)$/, chaturbate],
    [/(^|\.)canva\.com$/, canva],
    [/(^|\.)ok\.ru$/, ok],
    [/(^|\.)(vk\.com|vk\.ru|vkvideo\.ru)$/, vk],
  ];
  const mod = MODULES.find(([re]) => re.test(host))?.[1];
  if (!mod) return;
  let last = '';
  let busy = false;
  async function run() {
    if (busy || last === location.href) return;
    busy = true;
    last = location.href;
    try {
      await mod();
    } catch (e) {
      console.debug('[Video Sniffer] site module:', e);
    } finally {
      busy = false;
    }
  }
  run();
  setInterval(run, 1500); // single-page apps: look again when the address changes
})();
