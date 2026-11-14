// YouTube: the Download button needs direct stream URLs. Mock youtube.com where the first app client is refused when
// asked with the browser's login and answers when asked without it; a second video is refused by every client.
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
  document.cookie='SID=abc; path=/';
  window.ytcfg={get:function(k){return {INNERTUBE_API_KEY:'KEY',VISITOR_DATA:'VISITOR'}[k]}};
  document.getElementById('movie_player').getPlayerResponse=function(){return {videoDetails:{videoId:'${id}',title:'Clip ${id}'},
    streamingData:{adaptiveFormats:[{itag:137,qualityLabel:'1080p',height:1080,fps:30,mimeType:'video/mp4; codecs="avc1.640028"',bitrate:4e6},{itag:136,qualityLabel:'720p',height:720,fps:30,mimeType:'video/mp4; codecs="avc1.4d401f"',bitrate:2e6}]}}};
</script>`;
const srv = https.createServer({ key: fs.readFileSync(tmp + '/k.pem'), cert: fs.readFileSync(tmp + '/c.pem') }, (rq, rs) => {
  const u = new URL(rq.url, 'https://www.youtube.com');
  if (rq.method === 'POST' && u.pathname === '/youtubei/v1/player') {
    let b = ''; rq.on('data', (d) => (b += d)); rq.on('end', () => {
      const j = JSON.parse(b), name = j.context.client.clientName, cookie = !!rq.headers.cookie;
      asked.push({ v: j.videoId, name, cookie, visitor: rq.headers['x-goog-visitor-id'], cn: rq.headers['x-youtube-client-name'] });
      rs.writeHead(200, { 'content-type': 'application/json' });
      if (j.videoId === 'GOODVIDEO01' && name === 'VISIONOS' && !cookie) return rs.end(JSON.stringify({ playabilityStatus: { status: 'OK' }, streamingData: { adaptiveFormats: [
        { itag: 137, qualityLabel: '1080p', height: 1080, fps: 30, mimeType: 'video/mp4; codecs="avc1.640028"', contentLength: '5000', url: 'https://rr1.googlevideo.com/videoplayback?itag=137' },
        { itag: 140, mimeType: 'audio/mp4; codecs="mp4a.40.2"', bitrate: 128000, audioQuality: 'AUDIO_QUALITY_MEDIUM', contentLength: '900', url: 'https://rr1.googlevideo.com/videoplayback?itag=140' }] } }));
      rs.end(JSON.stringify({ playabilityStatus: { status: 'LOGIN_REQUIRED', reason: 'Sign in to confirm you are not a bot' }, streamingData: { adaptiveFormats: [{ itag: 137, qualityLabel: '1080p', mimeType: 'video/mp4' }] } }));
    }); return;
  }
  rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); rs.end(page(u.searchParams.get('v') || 'x'));
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const ctx = await chromium.launchPersistentContext(tmp + '/profile', { headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=MAP www.youtube.com 127.0.0.1:${srv.address().port}`] });
try {
  let sw; for (let i = 0; i < 60 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await new Promise((r) => setTimeout(r, 500)); }
  const yt = async (id) => { const p = await ctx.newPage(); await p.goto('https://www.youtube.com/watch?v=' + id); await p.waitForTimeout(6000);
    const all = await sw.evaluate(() => chrome.storage.session.get(null)); await p.close();
    return Object.entries(all).filter(([k]) => k.startsWith('yt:')).map(([, v]) => v).find((v) => v.id === id); };
  const good = await yt('GOODVIDEO01');
  console.log('good:', JSON.stringify(good && { client: good.streams?.client, video: good.streams?.video?.length, audio: !!good.streams?.audio, diag: good.diag }));
  ok(good && good.streams && good.streams.video.length === 1 && good.streams.audio, 'direct streams found (Download button is shown)');
  ok(good?.streams?.client === 'VISIONOS anon', 'the client that answered: VISIONOS without login, after the login attempt was refused');
  ok(/Safari/.test(good?.streams?.ua || ''), 'the User-Agent of that client is passed on for the download');
  ok(asked.filter((a) => a.v === 'GOODVIDEO01').length === 2 && asked[0].cookie === true && asked[1].cookie === false, 'first attempt with cookies, second without');
  ok(asked.every((a) => a.visitor === 'VISITOR'), 'visitor id sent');
  const bad = await yt('BADVIDEO002');
  console.log('bad:', JSON.stringify(bad && { streams: !!bad.streams, diag: bad.diag }));
  ok(bad && !bad.streams && bad.diag && bad.diag.length === 6 && /LOGIN_REQUIRED/.test(bad.diag[0]), 'nothing found: every attempt (3 clients x 2) and YouTube\'s answer are recorded for the popup');
  ok(asked.filter((a) => a.v === 'BADVIDEO002').length <= 12, 'no more than two rounds of attempts');
} finally { await ctx.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
process.exit(fail ? 1 : 0);
