// YouTube: the Download button needs direct stream URLs. The request is made the way Video DownloadHelper makes it
// (isolated world, session from /sw.js_data, VISIONOS -> ANDROID_VR -> iOS). The mock page behaves like a page with an
// ad blocker: window.fetch / Response.json in the PAGE strip every stream url - the extension must not be affected.
// Run: node tests/test_youtube_clients.mjs   (needs playwright + openssl)
import { createRequire } from 'module';
import https from 'https'; import fs from 'fs'; import os from 'os'; import path from 'path';
import { execSync } from 'child_process'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-yt-'));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${tmp}/k.pem -out ${tmp}/c.pem -days 2 -subj /CN=www.youtube.com 2>/dev/null`);
const asked = [];
const page = (id) => `<!doctype html><title>Clip ${id} - YouTube</title><div id="movie_player"></div><script>
  // what an ad blocker does in the page
  var of = window.fetch; window.fetch = function () { return of.apply(this, arguments).then(function (r) { return new Response('{"playabilityStatus":{"status":"PRUNED_BY_PAGE"}}', { status: 200 }); }); };
  Response.prototype.json = function () { return Promise.resolve({}); };
  window.ytcfg={get:function(k){return {INNERTUBE_API_KEY:'KEY',VISITOR_DATA:'PAGE_VISITOR',STS:20410}[k]}};
  document.getElementById('movie_player').getPlayerResponse=function(){return {videoDetails:{videoId:'${id}',title:'Clip ${id}'},
    streamingData:{adaptiveFormats:[{itag:137,qualityLabel:'1080p',height:1080,fps:30,mimeType:'video/mp4; codecs="avc1.640028"',bitrate:4e6},{itag:136,qualityLabel:'720p',height:720,fps:30,mimeType:'video/mp4; codecs="avc1.4d401f"',bitrate:2e6}]}}};
</script>`;
const d = []; d[0] = 'en'; d[1] = 'US'; d[3] = '203.0.113.7'; d[11] = ''; d[12] = ''; d[13] = 'VIS_FROM_SW'; d[16] = '2.2026'; d[17] = 'X11'; d[18] = ''; d[61] = ['x', 'APPINSTALL']; d[79] = 'Europe/Sarajevo'; d[86] = 'Chrome'; d[87] = '156.0'; d[103] = 'DEVEXP'; d[107] = 'ROLLOUT';
const SWDATA = ")]}'" + JSON.stringify([[null, null, [[d], 'APIKEY']]]);
const srv = https.createServer({ key: fs.readFileSync(tmp + '/k.pem'), cert: fs.readFileSync(tmp + '/c.pem') }, (rq, rs) => {
  const u = new URL(rq.url, 'https://www.youtube.com');
  if (u.pathname === '/sw.js_data') { rs.writeHead(200, { 'content-type': 'application/json' }); return rs.end(SWDATA); }
  if (rq.method === 'POST' && u.pathname === '/youtubei/v1/player') {
    let b = ''; rq.on('data', (x) => (b += x)); rq.on('end', () => {
      const j = JSON.parse(b), c = j.context.client;
      asked.push({ v: j.videoId, name: c.clientName, visitorHdr: rq.headers['x-goog-visitor-id'], cn: rq.headers['x-youtube-client-name'], cv: rq.headers['x-youtube-client-version'], c, sts: j.playbackContext?.contentPlaybackContext?.signatureTimestamp, key: u.searchParams.get('key'), alt: u.searchParams.get('alt') });
      rs.writeHead(200, { 'content-type': 'application/json' });
      const good = { playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: [
        { itag: 137, qualityLabel: '1080p', height: 1080, fps: 30, mimeType: 'video/mp4; codecs="avc1.640028"', contentLength: '5000', url: 'https://rr1.googlevideo.com/videoplayback?itag=137' },
        { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, audioQuality: 'AUDIO_QUALITY_MEDIUM', contentLength: '900', url: 'https://rr1.googlevideo.com/videoplayback?itag=140' }] } };
      if ((j.videoId === 'GOODVIDEO01' || j.videoId === 'SHORTVID004') && c.clientName === 'VISIONOS') return rs.end(JSON.stringify(good));
      if (j.videoId === 'SECONDVID02' && c.clientName === 'ANDROID_VR') return rs.end(JSON.stringify(good));
      rs.end(JSON.stringify({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you are not a bot' }, streamingData: { adaptiveFormats: [{ itag: 137, qualityLabel: '1080p', mimeType: 'video/mp4' }] } }));
    }); return;
  }
  rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  // a Shorts page: no #movie_player for this video at all (its player is #shorts-player, here not even ready)
  if (u.pathname.startsWith('/shorts/')) return rs.end('<!doctype html><title>Short clip - YouTube</title><div id="shorts-player"></div><script>window.ytcfg={get:function(k){return {STS:20410}[k]}};</script>');
  rs.end(page(u.searchParams.get('v') || 'x'));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const ctx = await chromium.launchPersistentContext(tmp + '/profile', { headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=MAP www.youtube.com 127.0.0.1:${srv.address().port}`] });
try {
  let sw; for (let i = 0; i < 60 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await new Promise((r) => setTimeout(r, 500)); }
  const yt = async (id, shorts) => { const p = await ctx.newPage(); await p.goto('https://www.youtube.com/' + (shorts ? 'shorts/' : 'watch?v=') + id); await p.waitForTimeout(6000);
    const all = await sw.evaluate(() => chrome.storage.session.get(null)); await p.close();
    return Object.entries(all).filter(([k]) => k.startsWith('yt:')).map(([, v]) => v).find((v) => v.id === id); };
  const good = await yt('GOODVIDEO01');
  console.log('good:', JSON.stringify(good && { client: good.streams?.client, video: good.streams?.video?.length, audio: !!good.streams?.audio, diag: good.diag }));
  ok(good && good.streams && good.streams.video.length === 1 && good.streams.audio, 'direct streams found although the page strips them (Download button is shown)');
  ok(good?.streams?.client === 'VISIONOS' && /Safari/.test(good.streams.ua || ''), 'first client (VISIONOS) answered; its User-Agent goes to the download');
  const a = asked.find((x) => x.v === 'GOODVIDEO01') || {};
  ok(a.visitorHdr === 'VIS_FROM_SW' && a.c?.visitorData === 'VIS_FROM_SW' && a.c?.rolloutToken === 'ROLLOUT' && a.c?.remoteHost === '203.0.113.7', 'session comes from /sw.js_data (visitor data, rollout token, remote host), not from the page');
  ok(a.cn === '101' && a.cv === '1.02' && a.c?.platform === 'MOBILE' && a.c?.osName === 'visionOS' && /Safari/.test(a.c?.userAgent || '') && !('browserName' in a.c), 'VISIONOS context as in VDH');
  ok(a.sts === 20410 && a.key === null && a.alt === 'json', 'signature timestamp sent; url as VDH (alt=json, no key)');
  const second = await yt('SECONDVID02');
  ok(second?.streams?.client === 'ANDROID_VR' && second.diag.length === 2, 'VISIONOS refused -> ANDROID_VR answered');
  const b = asked.find((x) => x.v === 'SECONDVID02' && x.name === 'ANDROID_VR') || {};
  ok(b.cn === '28' && b.c?.androidSdkVersion === 32 && b.c?.deviceModel === 'Quest 3' && b.c?.clientFormFactor === 'SMALL_FORM_FACTOR', 'ANDROID_VR context as in VDH');
  const short = await yt('SHORTVID004', true);
  console.log('short:', JSON.stringify(short && { title: short.title, formats: short.formats?.length, client: short.streams?.client, video: short.streams?.video?.map((v) => v.label) }));
  ok(short && short.streams && short.streams.video.length === 1 && short.streams.video[0].label === '1080p', 'Shorts: detected from the address alone (no player data), streams found with their quality labels');
  const bad = await yt('BADVIDEO003');
  console.log('bad:', JSON.stringify(bad && { streams: !!bad.streams, diag: bad.diag }));
  ok(bad && !bad.streams && bad.diag && bad.diag.length === 3 && /LOGIN_REQUIRED/.test(bad.diag[0]), 'nothing found: YouTube\'s answer to each of the 3 clients is recorded for the popup');
  ok(asked.filter((x) => x.v === 'BADVIDEO003').map((x) => x.name).join() === 'VISIONOS,ANDROID_VR,iOS' || asked.filter((x) => x.v === 'BADVIDEO003').length === 6, 'order VISIONOS, ANDROID_VR, iOS; at most two rounds');
} finally { await ctx.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
process.exit(fail ? 1 : 0);
