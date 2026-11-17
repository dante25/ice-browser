"""Android (mobile YouTube, m.youtube.com) changes to the built-ins, applied by gen-android-builtins.py to
copies of the desktop sources. The desktop originals stay unchanged.

PATCHES = { path of the file relative to the repo root: [(original text, replacement), ...] }
Every original text must occur exactly once, otherwise the Android build stops.
"""

QUALITY = 'chrome-extensions/default-quality-adjuster-for-youtube/inject.js'

PATCHES = {
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
