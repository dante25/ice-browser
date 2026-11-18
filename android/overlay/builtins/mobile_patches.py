"""Android (mobile YouTube, m.youtube.com) changes to the built-ins, applied by gen-android-builtins.py to
copies of the desktop sources. The desktop originals stay unchanged.

PATCHES = { path of the file relative to the repo root: [(original text, replacement), ...] }
Every original text must occur exactly once (or the count given as a third item), otherwise the Android
build stops.
"""

PROGRESS = 'chrome-extensions/permanent-progress-bar-for-youtube/'
NONSTOP = 'chrome-extensions/youtube-nonstop/'
HIDECARDS = 'chrome-extensions/hide-labels-and-end-cards-on-youtube/'
SHOT = 'chrome-extensions/screenshot-youtube/'
MULTI = 'chrome-extensions/multiselect-for-youtube/'
GIMG = 'ice-features/google-images-viewer/'
QUALITY = 'chrome-extensions/default-quality-adjuster-for-youtube/inject.js'

PATCHES = {
    # Permanent Progress Bar: ran only on www.youtube.com, and showed the bar only while the desktop player
    # hides its controls (.ytp-autohide), a class the mobile player does not use. Mobile version: also on
    # m.youtube.com, the bar always shown (also in fullscreen), and the mobile site's navigation event.
    PROGRESS + 'manifest.json': [
        ('"*://www.youtube.com/*"', '"*://www.youtube.com/*", "*://m.youtube.com/*"', 3),
    ],
    PROGRESS + 'data/inject/isolated.css': [
        ('/* do not show on miniplayer */', '/* Ice (Android): mobile player, always shown */\n.html5-video-player .pprogg {\n  display: block;\n}\n\n/* do not show on miniplayer */'),
    ],
    PROGRESS + 'data/inject/isolated.js': [
        ("addEventListener('yt-navigate-finish', () => { // top frame",
         "addEventListener('state-navigateend', () => observe('navigation')); // Ice: m.youtube.com\naddEventListener('yt-navigate-finish', () => { // top frame"),
    ],
    # YouTube NonStop: ran only on www/music.youtube.com and stopped with an error on the mobile site,
    # because it watched the desktop app element (ytd-app); the mobile app element is ytm-app.
    NONSTOP + 'manifest.json': [
        ('"https://www.youtube.com/*", "https://music.youtube.com/*"',
         '"https://www.youtube.com/*", "https://m.youtube.com/*", "https://music.youtube.com/*"', 2),
    ],
    NONSTOP + 'autoconfirm.js': [
        ("const appName = isYoutubeMusic ? 'ytmusic-app' : 'ytd-app';",
         "const appName = isYoutubeMusic ? 'ytmusic-app' : (window.location.hostname === 'm.youtube.com' ? 'ytm-app' : 'ytd-app');"),
        ("appObserver.observe(document.querySelector(appName), {",
         "appObserver.observe(document.querySelector(appName) || document.documentElement, {"),
    ],
    # Hide Labels and End Cards: ran and inserted its CSS only on www.youtube.com tabs. The player classes
    # it hides (.ytp-ce-element end cards, .branding-img-container) are the same in the mobile player.
    HIDECARDS + 'manifest.json': [
        ('"https://www.youtube.com/*" ]', '"https://www.youtube.com/*", "https://m.youtube.com/*" ]', 2),
    ],
    HIDECARDS + 'src/service-worker.min.js': [
        ('chrome.tabs.query({url:"*://www.youtube.com/*"}', 'chrome.tabs.query({url:["*://www.youtube.com/*","*://m.youtube.com/*"]}'),
        ('n.url.includes("https://www.youtube.com/")', '(n.url.includes("https://www.youtube.com/")||n.url.includes("https://m.youtube.com/"))'),
    ],
    # Screenshot YouTube: ran only on www.youtube.com and put a "Screenshot" text button into the desktop
    # player's control bar (.ytp-right-controls), which the mobile player does not have. Android: a camera
    # icon in the player's control bar on desktop YouTube (.ytp-right-controls); on mobile YouTube an own
    # small bar over the player's top left corner (never inside YouTube's player elements). The picture goes to the default download folder (Downloads), as before.
    SHOT + 'manifest.json': [
        ('"matches": [ "https://www.youtube.com/*" ]', '"matches": [ "https://www.youtube.com/*", "https://m.youtube.com/*" ]'),
    ],
    SHOT + 'page.js': [
        ("'use strict';\n",
         "'use strict';\n\n"
         "// Ice (Android): own button bar over the mobile player. Never inside YouTube's own player\n"
         "// elements (that broke the player's controls after in-page navigation), and only once the\n"
         "// player has its video; positioned over the player's top left corner.\n"
         "function iceMobileBar() {\n"
         "\tif (location.hostname !== 'm.youtube.com' || !/^\\/(watch|shorts)/.test(location.pathname)) {\n"
         "\t\tvar old = document.querySelector('.ice-syt-bar');\n"
         "\t\tif (old) old.remove();\n"
         "\t\treturn null;\n"
         "\t}\n"
         "\tvar mp = document.getElementById('movie_player');\n"
         "\tif (!mp || !mp.querySelector('video') || !mp.offsetHeight) return null;\n"
         "\tvar bar = document.querySelector('.ice-syt-bar');\n"
         "\tif (!bar) {\n"
         "\t\tbar = document.createElement('div');\n"
         "\t\tbar.className = 'ice-syt-bar';\n"
         "\t}\n"
         "\tvar fs = document.fullscreenElement;\n"
         "\tvar host = fs && fs.contains(mp) ? fs : document.body;\n"
         "\tif (bar.parentElement !== host) host.appendChild(bar);\n"
         "\tvar r = mp.getBoundingClientRect();\n"
         "\tbar.style.top = (r.top + 6) + 'px';\n"
         "\tbar.style.left = (r.left + 6) + 'px';\n"
         "\tbar.style.display = r.bottom > 0 ? 'flex' : 'none';\n"
         "\treturn bar;\n"
         "}\n"
         "window.addEventListener('scroll', function () { iceMobileBar(); }, { passive: true });\n"
         "window.addEventListener('resize', function () { iceMobileBar(); });\n"
         "document.addEventListener('fullscreenchange', function () { iceMobileBar(); });\n"),
        ('screenshotButton.innerHTML = "Screenshot";',
         'screenshotButton.innerHTML = \'<svg viewBox="0 0 24 24" width="24" height="24" style="vertical-align:middle;fill:#fff"><path d="M9 3 7.2 5H4a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-3.2L15 3H9zm3 4.5a5 5 0 1 1 0 10 5 5 0 0 1 0-10zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"/></svg>\';\n'
         'screenshotButton.title = "Screenshot";\n'
         'screenshotButton.setAttribute("aria-label", "Screenshot");'),
        ("\t\t\ttitle = '';", "\t\t\ttitle = document.title.replace(/ - YouTube$/, '').trim();"),
        ('var ytpRightControls = document.getElementsByClassName("ytp-right-controls")[0];',
         'var ytpRightControls = document.getElementsByClassName("ytp-right-controls")[0] || iceMobileBar();'),
        ('let ytpRightControls = document.getElementsByClassName("ytp-right-controls")[0];\n\t\tif (ytpRightControls && isAppended === false) {',
         'let ytpRightControls = document.getElementsByClassName("ytp-right-controls")[0] || iceMobileBar();\n\t\tif (ytpRightControls && (isAppended === false || !ytpRightControls.contains(screenshotButton))) {'),
    ],
    SHOT + 'style.css': [
        ('.SYText {',
         '/* Ice (Android): camera icon in the player control bars */\n'
         '.screenshotButton svg { pointer-events: none; }\n'
         '.ice-syt-bar .screenshotButton {\n\tbackground: transparent;\n\tborder: 0;\n\tpadding: 8px;\n\tmin-width: 40px;\n\tmin-height: 40px;\n}\n'
         '.ice-syt-bar {\n\tposition: fixed;\n\tz-index: 2147483000;\n\tdisplay: flex;\n\tgap: 4px;\n}\n'
         '.ice-syt-bar button {\n\tbackground: rgba(0, 0, 0, 0.55) !important;\n\tcolor: #fff;\n\tborder: 0;\n\tborder-radius: 6px;\n\twidth: auto !important;\n}\n\n'
         '.SYText {'),
    ],
    # Multiselect for YouTube: the selection mode is switched with Ctrl+M or a button in the desktop
    # YouTube top bar - a phone has neither. Android: a switch "Odabir više videa" at the top of the
    # extension's menu (popup); the state comes from the page (the video checkboxes are there or not).
    MULTI + 'popup.html': [
        ('<script src="js/options.js"></script>', '<script src="js/ice-toggle.js"></script>\n    <script src="js/options.js"></script>'),
    ],
    MULTI + 'js/content.js': [
        ('function u(e){const{type:t,value:o}=e;if("command"===t)c(t,o)}',
         'function u(e,x,r){const{type:t,value:o}=e;if("ice-ms-state"===t){r({on:!!document.querySelector("#msfy-video-checkbox")});return}if("command"===t)c(t,o)}'),
    ],
    # Google Images viewer: the same page address on the phone (www.google.com), and the viewer does not
    # depend on Google's internal names, so it already runs on mobile Google; only the layout was for a
    # wide screen (64px sides, big arrows). Phone layout for narrow windows.
    GIMG + 'viewer.css': [
        ('#ice-viewer .ice-next{right:0}',
         '#ice-viewer .ice-next{right:0}\n'
         '/* Ice (Android): narrow screen */\n'
         '@media (max-width:600px){'
         '#ice-viewer .ice-wrap{inset:0 6px;gap:10px}'
         '#ice-viewer img.ice-main{max-height:calc(100vh - 210px)}'
         '#ice-viewer .ice-title{font-size:17px;-webkit-line-clamp:2}'
         '#ice-viewer .ice-domain{font-size:14px;margin-bottom:12px}'
         '#ice-viewer .ice-count{margin-top:12px}'
         '#ice-viewer .ice-close{top:8px;right:8px}'
         '#ice-viewer .ice-nav{width:34px;height:72px;line-height:72px;font-size:30px;background:rgba(60,60,60,.6)}'
         '}'),
    ],
    # Default Quality Adjuster: it waited for the desktop player's settings button (.ytp-settings-button),
    # which m.youtube.com does not have, so it never set the quality. The mobile player (#movie_player)
    # has the same quality API. Also: wait until the player knows its qualities, and re-apply when the
    # mobile site moves to another video (state-navigateend) or a new video loads in the same player.
    QUALITY: [
        ('const[e]=await Promise.all([this.waitForElem("#movie_player"),this.waitForElem(".ytp-settings-button:not(#ScaleBtn)")]);',
         'const[e]=await Promise.all([this.waitForElem("#movie_player")]);'),
        ('async setQuality(){if(',
         'async setQuality(){for(let k=0;k<40&&this.ytPlayer&&!(this.ytPlayer.getAvailableQualityData&&this.ytPlayer.getAvailableQualityData().length);k++)await new Promise(w=>setTimeout(w,250));if('),
        ('document.addEventListener("yt-navigate-finish",this.pageNavigationListener,!0)',
         'document.addEventListener("yt-navigate-finish",this.pageNavigationListener,!0),'
         'document.addEventListener("state-navigateend",()=>{/^\\/(watch|shorts)/.test(location.pathname)&&this.init()},!0),'
         'document.addEventListener("loadeddata",w=>{w.target&&w.target.tagName==="VIDEO"&&this.setQuality()},!0)'),
    ],
}

# New files of the Android versions {path: text}
FILES = {
    MULTI + 'js/ice-toggle.js': r"""// Ice (Android): switch for the selection mode at the top of the popup (on the phone there is no Ctrl+M)
(function () {
  const api = typeof chrome !== 'undefined' ? chrome : browser;
  const box = document.createElement('div');
  box.id = 'ice-ms';
  box.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:12px 16px;margin:0 0 8px;border-bottom:1px solid rgba(128,128,128,.35);font:600 15px system-ui,sans-serif';
  const label = document.createElement('span');
  label.textContent = 'Odabir više videa';
  const sw = document.createElement('input');
  sw.type = 'checkbox';
  sw.setAttribute('role', 'switch');
  sw.style.cssText = 'width:44px;height:24px;accent-color:#37c8e0';
  const note = document.createElement('div');
  note.style.cssText = 'padding:0 16px 8px;font:12px system-ui,sans-serif;opacity:.75';
  box.append(label, sw);
  let tabId = null;
  const state = () => tabId === null ? Promise.resolve(null)
    : api.tabs.sendMessage(tabId, { type: 'ice-ms-state' }).then((r) => r && r.on).catch(() => null);
  const show = (on) => {
    sw.disabled = on === null;
    sw.checked = !!on;
    note.textContent = on === null ? 'Radi na YouTubeu (www.youtube.com): otvori YouTube u ovom tabu.' : '';
  };
  sw.addEventListener('change', async () => {
    const want = sw.checked;
    try { await api.tabs.sendMessage(tabId, { type: 'command', value: 'toggleMultiSelectMode' }); } catch (e) {}
    for (let i = 0; i < 10; i++) {          // the page needs a moment to add or remove the checkboxes
      await new Promise((r) => setTimeout(r, 150));
      const on = await state();
      if (on === want) break;
      if (i === 9) show(on);
    }
    show(await state());
  });
  const put = () => { if (document.body.firstChild !== box) document.body.prepend(box, note); };
  const start = () => {
    put();
    // options.js fills the body later; keep the switch on top
    new MutationObserver(put).observe(document.body, { childList: true });
  };
  if (document.body) start(); else document.addEventListener('DOMContentLoaded', start);
  api.tabs.query({ active: true, currentWindow: true }).then(async (tabs) => {
    tabId = tabs[0] ? tabs[0].id : null;
    show(await state());
  });
})();
""",
}
