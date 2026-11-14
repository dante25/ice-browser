// Site modules: the stream address is looked up through the site's API / page data and reported (mock sites).
// Run: node tests/test_sites.mjs   (needs playwright + openssl)
import { createRequire } from 'module';
import https from 'https'; import fs from 'fs'; import os from 'os'; import path from 'path';
import { execSync } from 'child_process'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url); const { chromium } = require('playwright');
const EXT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vs-sites-'));
execSync(`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${tmp}/k.pem -out ${tmp}/c.pem -days 2 -subj /CN=mock 2>/dev/null`);
const HOSTS = ['en.twitcasting.tv', 'twitcasting.tv', 'kick.com', 'web.kick.com', 'chaturbate.com', 'www.canva.com', 'ok.ru', 'vk.com', 'player.vimeo.com'];
const html = (b) => `<!doctype html><title>t</title><body>${b}</body>`;
const srv = https.createServer({ key: fs.readFileSync(tmp + '/k.pem'), cert: fs.readFileSync(tmp + '/c.pem') }, (rq, rs) => {
  const h = rq.headers.host, u = new URL(rq.url, 'https://' + h), p = u.pathname;
  const json = (o) => { rs.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*', 'access-control-allow-headers': '*' }); rs.end(JSON.stringify(o)); };
  const page = (b) => { rs.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); rs.end(html(b)); };
  if (rq.method === 'OPTIONS') { rs.writeHead(204, { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' }); return rs.end(); }
  if (h.endsWith('twitcasting.tv')) return p === '/streamserver.php' ? json({ 'tc-hls': { streams: { high: 'https://cdn.example/tc/' + u.searchParams.get('target') + '/high.m3u8' } } }) : page('room');
  if (h === 'kick.com' && p === '/api/v2/channels/streamer1') return json({ playback_url: 'https://cdn.example/kick/live/master.m3u8' });
  if (h === 'kick.com' && p === '/api/v2/clips/clip_77') return json({ clip: { clip_url: 'https://cdn.example/kick/clip_77.mp4' } });
  if (h === 'kick.com') return page('kick');
  if (h === 'chaturbate.com' && p === '/get_edge_hls_url_ajax/') return json({ success: true, url: 'https://cdn.example/cb/room9/playlist.m3u8' });
  if (h === 'chaturbate.com') return page('room');
  if (h === 'www.canva.com') return page('<script nonce="abc">window.x={"hlsManifestUrl":"https:\\/\\/cdn.example\\/canva\\/v1\\/master.m3u8"}</script>');
  if (h === 'ok.ru') return page(`<div data-options='${JSON.stringify({ flashvars: { metadata: JSON.stringify({ hlsManifestUrl: 'https://cdn.example/ok/55/video.m3u8', movie: { title: 'x' } }) } })}'></div>`);
  if (h === 'vk.com' && p === '/al_video.php') { let b = ''; rq.on('data', (d) => (b += d)); rq.on('end', () => json({ payload: [0, [0, 0, 0, 0, { mvData: { info: [] }, player: { params: [{ hls: 'https://cdn.example/vk/' + new URLSearchParams(b).get('video') + '/index.m3u8' }] } }]] })); return; }
  if (h === 'vk.com') return page('vk');
  if (h === 'player.vimeo.com') return page('<script>window.playerConfig={video:{id:76979871},request:{files:{hls:{default_cdn:"ak",cdns:{ak:{url:"https://cdn.example/vimeo/76979871/master.m3u8?x=1"}}},progressive:[{url:"https://cdn.example/vimeo/76979871/720.mp4"}]}}}</script>');
  page('?');
});
await new Promise((r) => srv.listen(0, '127.0.0.1', r));
let fail = 0; const ok = (c, m) => { console.log((c ? 'OK   ' : 'FAIL ') + m); if (!c) fail++; };
const ctx = await chromium.launchPersistentContext(tmp + '/profile', { headless: false, args: ['--headless=new', '--no-sandbox', `--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`,
  '--ignore-certificate-errors', '--no-proxy-server', `--host-resolver-rules=${HOSTS.map((x) => `MAP ${x} 127.0.0.1:${srv.address().port}`).join(', ')}, MAP cdn.example 127.0.0.1:1`] });
try {
  let sw; for (let i = 0; i < 60 && !sw; i++) { sw = ctx.serviceWorkers()[0]; if (!sw) await new Promise((r) => setTimeout(r, 500)); }
  const visit = async (url) => { const p = await ctx.newPage(); await p.goto(url); await p.waitForTimeout(3500);
    const all = await sw.evaluate(() => chrome.storage.session.get(null)); await p.close();
    return Object.entries(all).filter(([k]) => k.startsWith('tab:')).flatMap(([, v]) => v); };
  const has = (items, url, kind) => items.some((i) => i.url === url && i.kind === kind);
  ok(has(await visit('https://twitcasting.tv/some_user'), 'https://cdn.example/tc/some_user/high.m3u8', 'hls'), 'Twitcasting: live room -> HLS');
  ok(has(await visit('https://kick.com/streamer1'), 'https://cdn.example/kick/live/master.m3u8', 'hls'), 'Kick: channel -> live HLS');
  ok(has(await visit('https://kick.com/streamer1/clips/clip_77'), 'https://cdn.example/kick/clip_77.mp4', 'file'), 'Kick: clip -> mp4');
  ok(has(await visit('https://chaturbate.com/room9/'), 'https://cdn.example/cb/room9/playlist.m3u8', 'hls'), 'Chaturbate: room -> HLS');
  ok(has(await visit('https://www.canva.com/design/abc/watch'), 'https://cdn.example/canva/v1/master.m3u8', 'hls'), 'Canva: watch page -> HLS');
  ok(has(await visit('https://ok.ru/video/55'), 'https://cdn.example/ok/55/video.m3u8', 'hls'), 'OK.ru: player options -> HLS');
  ok(has(await visit('https://vk.com/video-123_456'), 'https://cdn.example/vk/-123_456/index.m3u8', 'hls'), 'VK: al_video.php -> HLS');
  const vim = await visit('https://player.vimeo.com/video/76979871');
  ok(has(vim, 'https://cdn.example/vimeo/76979871/master.m3u8?x=1', 'hls') && has(vim, 'https://cdn.example/vimeo/76979871/720.mp4', 'file'), 'Vimeo: playerConfig -> HLS + mp4');
} finally { await ctx.close(); srv.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
process.exit(fail ? 1 : 0);
