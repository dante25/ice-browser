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
    # icon in the player's control bar on both sites - desktop: .ytp-right-controls, mobile: the top bar of
    # the player controls (shown and hidden with the controls), or an own bar in the player if YouTube
    # changes it. The picture goes to the default download folder (Downloads), as before.
    SHOT + 'manifest.json': [
        ('"matches": [ "https://www.youtube.com/*" ]', '"matches": [ "https://www.youtube.com/*", "https://m.youtube.com/*" ]'),
    ],
    SHOT + 'page.js': [
        ("'use strict';\n",
         "'use strict';\n\n"
         "// Ice (Android): the mobile player's control bar\n"
         "function iceMobileBar() {\n"
         "\tif (location.hostname !== 'm.youtube.com' || !/^\\/(watch|shorts)/.test(location.pathname)) return null;\n"
         "\tvar top = document.querySelector('#player-control-overlay .player-controls-top');\n"
         "\tif (top) return top;\n"
         "\tvar mp = document.getElementById('movie_player');\n"
         "\tif (!mp) return null;\n"
         "\tvar bar = mp.querySelector('.ice-syt-bar');\n"
         "\tif (!bar) {\n"
         "\t\tbar = document.createElement('div');\n"
         "\t\tbar.className = 'ice-syt-bar';\n"
         "\t\tmp.appendChild(bar);\n"
         "\t}\n"
         "\treturn bar;\n"
         "}\n"),
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
         '.player-controls-top .screenshotButton, .ice-syt-bar .screenshotButton {\n\tbackground: transparent;\n\tborder: 0;\n\tpadding: 8px;\n\tmin-width: 40px;\n\tmin-height: 40px;\n\tz-index: 60;\n}\n'
         '.ice-syt-bar {\n\tposition: absolute;\n\ttop: 6px;\n\tleft: 6px;\n\tz-index: 60;\n\tdisplay: flex;\n\tgap: 4px;\n}\n'
         '.ice-syt-bar button {\n\tbackground: rgba(0, 0, 0, 0.55) !important;\n\tcolor: #fff;\n\tborder: 0;\n\tborder-radius: 6px;\n\twidth: auto !important;\n}\n\n'
         '.SYText {'),
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
