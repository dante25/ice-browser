"""Android (mobile YouTube, m.youtube.com) changes to the built-ins, applied by gen-android-builtins.py to
copies of the desktop sources. The desktop originals stay unchanged.

PATCHES = { path of the file relative to the repo root: [(original text, replacement), ...] }
Every original text must occur exactly once (or the count given as a third item), otherwise the Android
build stops.
"""

PROGRESS = 'chrome-extensions/permanent-progress-bar-for-youtube/'
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
