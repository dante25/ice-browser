// Isolated-world bridge: relays what inject.js (page world) finds to the background worker,
// and passes the "auto-detect" setting into the page.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__vsniffer !== 1) return;
  try {
    chrome.runtime.sendMessage({ type: 'found', items: e.data.items, main: e.data.main, youtube: e.data.youtube }).catch(() => {});
  } catch {}
  if (e.data.youtube && e.data.youtube.id && !e.data.youtube.streams) ytStreams(e.data.youtube);
});

// ---- YouTube: direct stream URLs, the method of Video DownloadHelper 10.7.1.2 (its bundled youtubei.js) ----
// The web player gets no file URLs any more, so the player request is made as YouTube's own apps make it. As in VDH:
//  - from the extension's isolated world, never from the page (page scripts and other extensions rewrite fetch/JSON there);
//  - a session read from /sw.js_data (visitor data, remote host, rollout token...) -> the same request context;
//  - clients in VDH's order: VISIONOS, ANDROID_VR, iOS; the first that returns file URLs wins.
// What every attempt answered is kept in `diag` and shown in the popup when nothing was found.
const YT_BASE = 'https://www.youtube.com';
const YT_CLIENTS = [
  {
    key: 'VISIONOS', id: '101',
    ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 15_7_3) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
    set: (c) => Object.assign(c, { deviceMake: 'Apple', deviceModel: 'RealityDevice17,1', clientVersion: '1.02', clientName: 'VISIONOS', platform: 'MOBILE', osName: 'visionOS', osVersion: '26.5.23O471' }),
    ownUa: true, noBrowser: true,
  },
  {
    key: 'ANDROID_VR', id: '28',
    ua: 'com.google.android.apps.youtube.vr.oculus/1.65.10 (Linux; U; Android 12L; eureka-user Build/SQ3A.220605.009.A1) gzip',
    set: (c) => Object.assign(c, { androidSdkVersion: 32, osName: 'Android', osVersion: '12L', platform: 'MOBILE', deviceMake: 'Oculus', deviceModel: 'Quest 3', clientVersion: '1.65.10', clientFormFactor: 'SMALL_FORM_FACTOR', clientName: 'ANDROID_VR' }),
    ownUa: true,
  },
  {
    key: 'iOS', id: '5',
    ua: 'com.google.ios.youtube/20.11.6 (iPhone10,4; U; CPU iOS 16_7_7 like Mac OS X)',
    set: (c) => Object.assign(c, { deviceMake: 'Apple', deviceModel: 'iPhone10,4', clientVersion: '20.11.6', clientName: 'iOS', platform: 'MOBILE', osName: 'iOS', osVersion: '16.7.7.20H330' }),
    noBrowser: true,
  },
];
let ytSession = null;
async function ytGetSession() {
  if (ytSession) return ytSession;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const s = { hl: 'en', gl: 'US', time_zone: tz, user_agent: navigator.userAgent, note: '' };
  try {
    const r = await fetch(`${YT_BASE}/sw.js_data`, { headers: { 'Accept-Language': 'en-US', Accept: '*/*' } });
    const t = await r.text();
    if (!r.ok || !t.startsWith(")]}'")) throw new Error(`sw.js_data ${r.status}`);
    const d = JSON.parse(t.replace(/^\)\]\}'/, ''))[0][2][0][0];
    const h = d[61];
    Object.assign(s, {
      hl: d[0] || 'en', gl: d[1] || 'US', remote_host: d[3], visitor_data: d[13], os_name: d[17], os_version: d[18], time_zone: d[79] || tz,
      browser_name: d[86], browser_version: d[87], device_make: d[11], device_model: d[12], app_install_data: h && h[h.length - 1],
      device_experiment_id: d[103], rollout_token: d[107],
    });
  } catch (e) {
    s.note = `session: ${String(e && e.message).slice(0, 50)}`;
  }
  ytSession = s;
  return s;
}
function ytContext(s, c) {
  const client = {
    hl: s.hl, gl: s.gl, remoteHost: s.remote_host, screenDensityFloat: 1, screenHeightPoints: 1440, screenPixelDensity: 1, screenWidthPoints: 2560,
    visitorData: s.visitor_data, clientName: 'WEB', clientVersion: '', osName: s.os_name, osVersion: s.os_version, userAgent: s.user_agent,
    platform: 'DESKTOP', clientFormFactor: 'UNKNOWN_FORM_FACTOR', userInterfaceTheme: 'USER_INTERFACE_THEME_LIGHT', timeZone: s.time_zone,
    originalUrl: YT_BASE, deviceMake: s.device_make, deviceModel: s.device_model, browserName: s.browser_name, browserVersion: s.browser_version,
    utcOffsetMinutes: -Math.floor(new Date().getTimezoneOffset()), memoryTotalKbytes: '8000000', rolloutToken: s.rollout_token,
    deviceExperimentId: s.device_experiment_id,
    mainAppWebInfo: { graftUrl: YT_BASE, pwaInstallabilityStatus: 'PWA_INSTALLABILITY_STATUS_UNKNOWN', webDisplayMode: 'WEB_DISPLAY_MODE_BROWSER', isWebNativeShareAvailable: true },
  };
  c.set(client);
  if (c.ownUa) client.userAgent = c.ua;
  if (c.noBrowser) { delete client.browserName; delete client.browserVersion; }
  return { client, user: { enableSafetyMode: false, lockedSafetyMode: false }, request: { useSsl: true, internalExperimentFlags: [] } };
}
async function ytAskPlayer(s, c, info) {
  const context = ytContext(s, c);
  const headers = {
    'Content-Type': 'application/json', Accept: '*/*', 'Accept-Language': '*', 'X-Goog-Visitor-Id': s.visitor_data || '',
    'X-Youtube-Client-Version': context.client.clientVersion, 'X-Youtube-Client-Name': c.id,
  };
  headers['User-Agent'] = c.ua; // as VDH sets it (the browser may keep its own)
  const body = {
    playbackContext: { contentPlaybackContext: { vis: 0, splay: false, lactMilliseconds: '-1', ...(info.sts ? { signatureTimestamp: info.sts } : {}) } },
    videoId: info.id, racyCheckOk: true, contentCheckOk: true, context,
  };
  const r = await fetch(`${YT_BASE}/youtubei/v1/player?prettyPrint=false&alt=json`, { method: 'POST', credentials: 'include', headers, body: JSON.stringify(body) });
  if (!r.ok) return { note: `HTTP ${r.status}` };
  const j = JSON.parse(await r.text());
  const sd = j.streamingData || {};
  const every = [...(sd.formats || []), ...(sd.adaptiveFormats || [])];
  const all = every.filter((f) => f.url);
  const pick = (f) => ({ itag: f.itag, height: f.height || 0, fps: f.fps || 0, size: Number(f.contentLength) || 0, url: f.url });
  const video = all.filter((f) => /^video\/mp4/.test(f.mimeType) && f.qualityLabel && !f.audioQuality).map(pick);
  const muxed = all.filter((f) => /^video\/mp4/.test(f.mimeType) && f.qualityLabel && f.audioQuality).map(pick);
  const audio = all.filter((f) => /^audio\/mp4/.test(f.mimeType)).sort((x, y) => y.bitrate - x.bitrate)[0];
  const ps = j.playabilityStatus || {};
  const note = `${ps.status || 'no status'}${ps.reason ? ` (${String(ps.reason).slice(0, 60)})` : ''}, ${all.length}/${every.length} with url`;
  if (!video.length && !muxed.length) return { note };
  return { note, streams: { video, muxed, audio: audio ? pick(audio) : null, ua: c.ua, client: c.key } };
}
const ytDone = new Map(); // video id -> streams (found) | number of rounds tried
let ytBusy = false;
async function ytStreams(info) {
  if (window !== window.top || !/(^|\.)youtube\.com$/.test(location.hostname)) return;
  const st = ytDone.get(info.id);
  const send = (extra) => { try { chrome.runtime.sendMessage({ type: 'found', items: [], youtube: { ...info, ...extra } }).catch(() => {}); } catch {} };
  if (st && typeof st === 'object') return send({ streams: st });       // found before: a post without streams must not erase them
  if (ytBusy || st >= 2) return;
  ytBusy = true;
  ytDone.set(info.id, (st || 0) + 1);
  const diag = [];
  try {
    const s = await ytGetSession();
    if (s.note) diag.push(s.note);
    for (const c of YT_CLIENTS) {
      let res;
      try {
        res = await ytAskPlayer(s, c, info);
      } catch (e) {
        res = { note: `error ${String(e && e.message).slice(0, 60)}` };
      }
      diag.push(`${c.key}: ${res.note}`);
      if (res.streams) {
        ytDone.set(info.id, res.streams);
        return send({ streams: res.streams, diag });
      }
    }
    send({ diag });
  } finally {
    ytBusy = false;
  }
}

// Background says the page changed without a reload (single-page app).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'reset') window.postMessage({ __vsniffer_cfg: 2 }, '*');
});

const sendCfg = (probe) => window.postMessage({ __vsniffer_cfg: 1, probe }, '*');
try {
  chrome.storage.local.get({ probe: true }).then((o) => sendCfg(o.probe));
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.probe) sendCfg(c.probe.newValue !== false);
  });
} catch {}
