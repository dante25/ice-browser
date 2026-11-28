# Ultimate SN Downloader

One Chrome/Chromium extension that merges **IG Media Downloader**, **My FB Photos** and the useful parts of **4K Stogram** / **Ice Grabber**.
Sites: Instagram, Facebook, **X**, **DeviantArt**, **Flickr**.

## Install (unpacked)
1. `chrome://extensions` → turn on *Developer mode* → *Load unpacked* → pick the `extension/` folder.
2. Reload any open Instagram / Facebook tab once.
3. Open a profile / album / group / post, click the extension icon (or `Alt+Shift+D`), choose **Photos / Videos / Stories & reels / Everything**, **Start download**.
A small progress window opens (no new tab, no overlay on the page): scanned / found / downloaded x / y, size, elapsed time, pause / cancel, cooldown banner.
Files are written **in the background straight into the folder you choose once** (File System Access, like both original extensions) - nothing appears in Chrome's download list or download bubble. First use: the progress window asks you to choose the folder; after a browser restart Chrome may ask you to click *Allow* once. Inside it: `<Site>/<owner>/<type>/…` (sub-folders and file name editable under ⚙).

## How it scans (what it takes from each original)
* **Instagram** – the extension's method: the page's own GraphQL queries (`PolarisProfilePostsTabContentQuery_connection`, doc_id from the page's module registry, `after` cursor). The first batch is what the page already loaded (zero extra requests). Stories/highlights through `reels_media` like Stogram; the Stogram feed API (`feed/user/<id>/?max_id=`) is the automatic fallback.
* **Facebook** – the page's own pagination query is re-sent with the end cursor (scrolling is only used to make the page fire it once); full size through `CometPhotoRootContentQuery` (doc_id snapshot from My FB Photos); videos/reels from the tab's data.
* Profile id is looked up from data the page already has, then the profile page HTML, then REST search – so "profile does not exist" errors only appear when it really cannot be found, with a readable message.

## X, DeviantArt, Flickr
* **X** - open a profile (the extension goes to its *Media* tab) or a post. X signs every request, so nothing is replayed: the Media tab is scrolled like a person does and the page's own replies are read. Photos at original size (`?name=orig`), videos / GIFs as the best mp4. Only the profile's own media. Photos / Videos can be chosen separately.
* **DeviantArt** - no OAuth, your logged-in browser session. The page carries its own data (`__INITIAL_STATE__`) and the gallery is paged with `?page=N`: every page is read from that data and the next page is requested like a person turning pages. Image: the artist's download link when there is one, then the largest full view (`fullview` / `preview` + token), then the plain URL - a refused link falls back to the next. Checked against a real public gallery: full-view links answer 200 JPEG while the plain token URL answers 403 for part of the art.
* **Flickr** - the method of the installed *Flickr Metaligh Images Downloader*: no API key. The page's embedded data lists every size (`"displayUrl":"//live.staticflickr.com/..._k.jpg","width":2048,"height":1365`), the **largest by area** is used - so photos without a Download button work too. Photostream / album: the photo links of the page, each photo from the listing data or from its own photo page, then the next page. (Flickr videos are not supported - the reference extension has none either.)

## Image Host Grabber (any page)
The method of the old Firefox extension *ImageHostGrabber 1.7.0.6*, with its **host file** (`hostf.xml`, 888 hosts, bundled in `extension/ihg/` and importable in ⚙ → *Image host file*).
Open any page with a gallery (a page that is not Instagram / Facebook / X / DeviantArt / Flickr), click the extension: it collects **every link** of the page (`document.links`, javascript-wrapped urls, anonymizers removed, duplicates dropped) and turns each one into an image:
* **direct links** (the link itself ends in `.jpg/.png/...`) - taken as they are;
* **links to image-host pages** (e.g. `imx.to/i/..`, `pixhost../show/..`, and redirect pages) - the link matches a host's `urlpattern`, the page is fetched and the host's `searchpattern` finds the image: the function rules of the host file run unchanged in a sandboxed page (with `httpGet`/`httpPost`/`XMLHttpRequest` available), and the string rules (`LINK2FILE`, `ID:`, `REPLACE:`, a regex over `<img>` tags) work as in the original; statuses `OK / ABORT / RETRY / REQUEUE / REDIRECT` are handled;
* links on hosts the file does not know are counted and listed ("No rule for: …") so a rule can be added to the host file.
**Custom host rules** (0.11.3): ⚙ → *Custom host rules* adds a rule for a host the host file does not know, without editing `hostf.xml`: site name, link pattern (regex of the link), image rule (`LINK2FILE`, `ID: <img id>`, `REPLACE: 'from','to'`, a regex for the `<img>` tag, or `function(pageData, pageUrl) { ... }` - run in the same sandbox as the host file's functions) and an optional test link to check the pattern. Custom rules are stored apart (`chrome.storage.local.ihCustom`), are checked **before** the host file (so one can also override a host-file rule), and stay when a new host file is imported. Test: `node tests/test_ih_custom.mjs`.
**ImageFap** (0.11.2): open any page of a gallery (`/pictures/<id>/…` or `gallery.php?gid=`) and press Start - all pages of the gallery are read automatically (the one-page view, 100 pictures per page, until an empty page). A photo page lists the full-size links (`/images/full/…`, valid for hours) of the ~24 pictures around it, so a gallery of 393 pictures needs about 17 requests, spaced 1.5-3 s apart, not 393 (jpg, png and animated gif all work, thumbnails are never taken; files are named by picture id). ImageFap answers fast repeat requests with an empty page (HTTP 200, no picture) for a while; that is recognised, what was found so far is downloaded and the message says to start again later. The host file rule for `imagefap.com` still handles a single photo-page link found on any other page.
Files: `Images/<site of the page>/<page title>/001_<original name>`; images smaller than the set minimum (default 20 KB, like the original) are skipped as thumbnails; hotlink-protected images get the right `Referer`. Following links to other sites needs the *all sites* permission, which Chrome asks for once when you press Start.

## Button on single videos
Hover a video on Instagram (post, reel, story) or Facebook (video, reel, story): a small **⬇** shows in its corner; **one click** sends just that video straight to **Chrome's own download list** (`Downloads/Ultimate SN Downloader/...`, with Chrome's download bubble) using the options saved in the popup (speed, HD merge / thumbnail, Full size). Nothing to choose, no folder, no extra window. Facebook's video address is looked up in this order: the page's replies and embedded data -> the page's HTML -> the video's own page (`/reel/<id>`, `/watch/?v=<id>`). Stories on Facebook are unverified.

## No download history
Nothing is remembered between runs. A second run of the same profile downloads again over the same file names (no duplicates, no "skipped" surprises). Like both originals the extension only keeps a **lifetime counter** (Total downloaded: Instagram N · Facebook N, shown at the top of the progress window). A job only remembers what it saved itself, so Resume does not repeat work.

## Retry / Resume
Every job keeps where it stopped (feed cursor per section, finished sections, the list of failed files). If the tab is closed, the browser restarts, Instagram/Facebook errors out or you cancel, the job card gets **Resume where it stopped** / **Retry**: the scan continues from the saved cursor instead of the beginning and files already on disk are skipped. **Retry N failed** saves only the failed files again and sends no request to the site at all.

## Video options (Instagram)
Taken from the Instagram Media Downloader's *🎬 Video Options*, same methods:
* **HD auto-merge** – Instagram serves the best quality as separate video and audio tracks (DASH). Both are fetched segment by segment (init range + `sidx` index + `?bytestart=&byteend=`) and joined with ffmpeg.wasm (`-c copy`, `aac_adtstoasc` when needed) in a hidden offscreen page. If the merge fails the normal file is saved instead.
* **Download thumbnail** – the video cover is saved next to it as `<name>.thumbnail.jpg`.

## Facebook limits
Facebook counts the one-request-per-photo "full size" lookups. So Facebook has its own, slower pacing (Safe / Normal / Fast), a break after every 20 / 40 / 80 requests, an hourly cap, and after a block all waits get longer for 12 h. A block is waited out and the *same* photo is asked again - it is never saved at grid quality instead. The popup has **Full size** (on by default): switch it off to skip the per-photo lookups entirely (far fewer requests, grid resolution).

**Quiet** (speed list): the smallest footprint - very slow, nasty-long breaks, hourly cap, and on Facebook only what the page itself loads while it is scrolled (no cursor replay, no per-photo lookups; grid-size photos). Nothing can make a scanner invisible to the site; this just asks for as little as possible.

## Anti-ban
Data requests are paced with random delays (Safe / Normal / Fast), bursts followed by breaks, an hourly cap on *Safe*, block detection (HTTP 429/560 and Instagram/Facebook "wait a few minutes" texts), a persistent cooldown (35 min, ×1.6 on repeats, max 4 h) during which the scan is paused but already found files keep downloading from the CDN. Files come straight from the CDN, which does not count against the account; only the data requests do. Nothing can *guarantee* no ban – fewer requests is the only real protection, so use **Only new items** for repeat runs.

## Tests
`tests/` drives real Chromium with this extension against a local mock of both sites (Playwright): `test_ig.py`, `test_kinds_fb.py`, `test_block.py`, `test_ih.py`, `test_button.py`, `test_x.py`, `test_flickr.py`, `test_da.py`, `test_video.py` (real DASH streams made with ffmpeg; the merged file is checked with ffprobe for video + audio).
