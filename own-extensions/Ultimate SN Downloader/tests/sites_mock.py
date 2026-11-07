"""Fake X, Flickr and DeviantArt for the extension tests. Data generators are shared with the tests so expectations come from the same source."""
import json
from urllib.parse import parse_qs

HTML = "text/html"


# ------------------------------------------------------------------ X
X_PER_PAGE, X_PAGES = 8, 3


def x_tweet(n, base, user="bob"):
    media = []
    if n % 3 == 0:
        media = [{"type": "photo", "media_url_https": "%s/cdn/xp_%d_%d.jpg" % (base, n, j), "original_info": {"width": 2000, "height": 1500}} for j in range(2)]
    elif n % 3 == 1:
        media = [{"type": "video", "original_info": {"width": 1280, "height": 720}, "video_info": {"variants": [
            {"content_type": "application/x-mpegURL", "url": "%s/cdn/xv_%d.m3u8" % (base, n)},
            {"content_type": "video/mp4", "bitrate": 256000, "url": "%s/cdn/xv_%d_lo.mp4" % (base, n)},
            {"content_type": "video/mp4", "bitrate": 832000, "url": "%s/cdn/xv_%d_hi.mp4" % (base, n)}]}}]
    elif n == 5:
        media = [{"type": "animated_gif", "video_info": {"variants": [{"content_type": "video/mp4", "bitrate": 0, "url": "%s/cdn/xg_%d.mp4" % (base, n)}]}}]
    else:
        media = [{"type": "photo", "media_url_https": "%s/cdn/xp_%d_0.jpg" % (base, n), "original_info": {"width": 1000, "height": 1000}}]
    return {"entryId": "tweet-%d" % n, "content": {"entryType": "TimelineTimelineItem", "itemContent": {"tweet_results": {"result": {
        "__typename": "Tweet", "rest_id": str(1000 + n),
        "core": {"user_results": {"result": {"legacy": {"screen_name": user}}}},
        "legacy": {"id_str": str(1000 + n), "created_at": "Wed Oct 10 20:19:24 +0000 2018", "full_text": "tweet %d" % n,
                   "extended_entities": {"media": media}}}}}}}


def x_expected():
    photos = videos = 0
    for n in range(X_PER_PAGE * X_PAGES):
        for m in x_tweet(n, "b")["content"]["itemContent"]["tweet_results"]["result"]["legacy"]["extended_entities"]["media"]:
            if m["type"] == "photo":
                photos += 1
            else:
                videos += 1
    return photos, videos


def x(h, u, base):
    if u.path == "/bob/media" or u.path == "/bob":
        page = ("<html><head><title>bob / X</title></head><body style='height:9000px'><script>"
                "var next=null,busy=false,done=false;"
                "function load(){if(busy||done)return;busy=true;fetch('/i/api/graphql/QID/UserMedia?variables='+encodeURIComponent(JSON.stringify({userId:'1',count:20,cursor:next})),"
                "{headers:{authorization:'Bearer x','x-csrf-token':'t'}}).then(function(r){return r.json()}).then(function(j){var m=JSON.stringify(j).match(/\"cursorType\":\"Bottom\",\"value\":\"(c\\d)\"/);"
                "next=m?m[1]:null;if(!next)done=true;busy=false;});}"
                "load();window.addEventListener('scroll',load);</script></body></html>")
        return h._send(200, page.encode(), HTML)
    if u.path.startswith("/i/api/graphql/") and u.path.endswith("/UserMedia"):
        v = json.loads(parse_qs(u.query).get("variables", ["{}"])[0])
        cur = v.get("cursor")
        page = int(cur[1:]) if cur else 0
        entries = [x_tweet(page * X_PER_PAGE + i, "https://127.0.0.1:%d" % h.server.server_port) for i in range(X_PER_PAGE)]
        # a quoted tweet of somebody else (its media must NOT be downloaded)
        entries.append(x_tweet(900 + page, "https://127.0.0.1:%d" % h.server.server_port, user="alice"))
        if page + 1 < X_PAGES:
            entries.append({"entryId": "cursor-bottom-%d" % page, "content": {"entryType": "TimelineTimelineCursor", "cursorType": "Bottom", "value": "c%d" % (page + 1)}})
        return h._send(200, {"data": {"user": {"result": {"timeline_v2": {"timeline": {"instructions": [{"type": "TimelineAddEntries", "entries": entries}]}}}}}})
    return h._send(404, {})


# ------------------------------------------------------------------ Flickr (page based, like the installed extension)
FL_TOTAL, FL_PER_PAGE, FL_SSR, FL_ALBUM = 100, 40, 25, 12


def fl_sizes(i, port):
    """The embedded model of a photo: every size the viewer can show. Even ids also have the original, odd ids stop at 'k' (owner disabled Download)."""
    pid = 5000000000 + i
    sz = [("l", 1024, 683), ("k", 2048, 1365), ("h", 1600, 1067)] + ([("o", 4000, 3000)] if i % 2 == 0 else [])
    return ",".join('"%s":{"displayUrl":"\\/\\/127.0.0.1:%d\\/cdn\\/%d_abc123_%s.jpg","width":%d,"height":%d}' % (k, port, pid, k, w, hh) for k, w, hh in sz)


def flickr(h, u, base, host):
    h_port = h.server.server_port
    parts = u.path.strip("/").split("/")
    mock_sites_log = __import__("mock_sites").STATE["log"]
    mock_sites_log.append(("GET", "FL " + u.path))
    if parts[:2] == ["photos", "bob"] and len(parts) == 3 and parts[2].isdigit():            # single photo page
        i = int(parts[2]) - 5000000000
        return h._send(200, ('<html><body><script>modelExport: {"main":{"sizes":{%s}}}</script></body></html>' % fl_sizes(i, h_port)).encode(), HTML)
    if parts[:2] == ["photos", "bob"] and len(parts) >= 3 and parts[2] in ("albums",):
        ids = list(range(FL_ALBUM))
        links = "".join('<a href="/photos/bob/%d/">p</a>' % (5000000000 + i) for i in ids)
        ssr = ",".join('{"id":"%d","sizes":{"data":{%s}}}' % (5000000000 + i, fl_sizes(i, h_port)) for i in ids)
        return h._send(200, ("<html><body>%s<script>modelExport: {%s}</script></body></html>" % (links, ssr)).encode(), HTML)
    if parts[:2] == ["photos", "bob"]:                                                         # photostream, ?page via /pageN
        page = int(parts[2][4:]) if len(parts) > 2 and parts[2].startswith("page") else 1
        ids = list(range((page - 1) * FL_PER_PAGE, min(FL_TOTAL, page * FL_PER_PAGE)))
        links = "".join('<a href="/photos/bob/%d/">p</a>' % (5000000000 + i) for i in ids)
        ssr = ",".join('{"id":"%d","sizes":{"data":{%s}}}' % (5000000000 + i, fl_sizes(i, h_port)) for i in ids[:FL_SSR])
        nxt = '<a rel="next" href="/photos/bob/page%d">Next</a>' % (page + 1) if page * FL_PER_PAGE < FL_TOTAL else ""
        return h._send(200, ("<html><body style='height:3000px'>%s%s<script>modelExport: {%s}</script></body></html>" % (links, nxt, ssr)).encode(), HTML)
    return h._send(404, {})


# ------------------------------------------------------------------ DeviantArt (embedded __INITIAL_STATE__, ?page=N)
DA_TOTAL, DA_PER, DA_VIDEOS = 60, 24, (10, 33)


def da_dev(i, base):
    d = {"deviationId": 7000 + i, "title": "art %d" % i, "author": 1, "publishedTime": "2023-01-02T03:04:05-0800", "isVideo": False, "isDeleted": False,
         "isDownloadable": i % 4 == 0,
         "media": {"baseUri": "%s/cdn/da_%d.jpg" % (base, i), "token": ["TOK%d" % i], "prettyName": "art_%d" % i,
                   "types": [{"t": "150", "w": 150, "h": 108, "c": "/v1/fit/w_150/<prettyName>-150.jpg"},
                             {"t": "preview", "w": 800, "h": 578, "c": "/v1/fill/w_800,h_578/<prettyName>-fullview.jpg"},
                             {"t": "fullview", "w": 800, "h": 578, "c": "/v1/fill/w_800,h_578/<prettyName>-fullview.jpg"}]}}
    if i % 4 == 0:
        d["download"] = {"url": "%s/cdn/da_%d_orig.jpg" % (base, i), "width": 3000, "height": 2000}
    if i in DA_VIDEOS:
        d["isVideo"] = True
        d["isDownloadable"] = False
        d["media"]["types"] = [{"t": "video", "b": "%s/cdn/dav_%d_480.mp4" % (base, i), "h": 480, "w": 640}, {"t": "video", "b": "%s/cdn/dav_%d_720.mp4" % (base, i), "h": 720, "w": 1280}]
    return d


def deviantart(h, u, base):
    q = {k: v[0] for k, v in parse_qs(u.query).items()}
    if u.path in ("/bob/gallery", "/bob"):
        page = int(q.get("page", 1))
        ids = list(range((page - 1) * DA_PER, min(DA_TOTAL, page * DA_PER)))
        state = {"@@entities": {"deviation": {str(7000 + i): da_dev(i, base) for i in ids}, "user": {"1": {"userId": 1, "username": "bob"}}},
                 "@@streams": {"folder-deviations-gallery--1": {"items": [7000 + i for i in ids[:10]], "nextOffset": 10, "hasMore": True}}}
        html = "<html><head><title>bob DeviantArt</title></head><body>gallery<script>window.__INITIAL_STATE__ = JSON.parse(%s);</script></body></html>" % json.dumps(json.dumps(state))
        return h._send(200, html.encode(), HTML)
    return h._send(404, {})


# ------------------------------------------------------------------ Image Host Grabber: gallery pages + image hosts (the real host file rules run against these)
IH_DIRECT, IH_IMX, IH_PIXHOST = 12, 6, 6


def hosts(h, u, base, host, method):
    import mock_sites
    mock_sites.STATE["log"].append((method, "IH " + host + u.path))
    def jpg(n):
        return h._send(200, mock_sites.jpeg(n % 50), "image/jpeg")
    if host == "gallery.example" and u.path == "/galleries/one/":
        links = "".join('<a href="https://cdn.example/content/0/1/%d.jpg"><img src="https://cdn.example/thumbs/%d.jpg" width="120" height="90"></a>' % (n, n) for n in range(IH_DIRECT))
        links += '<a href="https://ads.example/go.php?x=1">sponsor</a><a href="https://cdn.example/content/0/1/0.jpg">again</a>'      # an unknown host and a duplicate link
        return h._send(200, ("<html><head><title>Gallery One - Example</title></head><body>%s</body></html>" % links).encode(), "text/html")
    if host == "redirects.example" and u.path == "/set/1":
        links = "".join('<a href="https://imx.to/i/abc%d"><img src="https://imx.to/u/t/%d.jpg"></a>' % (n, n) for n in range(IH_IMX))
        links += "".join('<a href="https://pixhost.to/show/6769/%d_img_%d.jpg"><img src="https://img.pixhost.to/thumbs/%d.jpg"></a>' % (n, n, n) for n in range(IH_PIXHOST))
        return h._send(200, ("<html><head><title>Set Six</title></head><body>%s</body></html>" % links).encode(), "text/html")
    if host == "cdn.example":
        n = int("".join(c for c in u.path if c.isdigit())[-3:] or 0)
        return jpg(n)
    if host == "imx.to" and u.path.startswith("/i/"):
        n = u.path.replace("/i/abc", "")
        if method == "POST" and "imgContinue" in getattr(h, "body", ""):
            return h._send(200, ('<html><body><img class="centred" src="https://imx.to/u/i/2023/01/%s.jpg" alt="photo_%s"></body></html>' % (n, n)).encode(), "text/html")
        return h._send(200, b'<html><body><form method="post"><input type="submit" name="imgContinue" value="Continue to image ... "></form></body></html>', "text/html")
    if host == "imx.to" and u.path.startswith("/u/i/"):
        if "imx.to" not in (h.headers.get("Referer") or ""):
            return h._send(403, b"hotlink", "text/plain")
        return jpg(int("".join(c for c in u.path if c.isdigit())[-2:] or 0))
    if host == "pixhost.to" and u.path.startswith("/show/"):
        name = u.path.split("/")[-1]
        return h._send(200, ('<html><body><img id="image" src="https://img.pixhost.to/images/6769/%s" alt="%s"></body></html>' % (name, name)).encode(), "text/html")
    if host == "img.pixhost.to" and u.path.startswith("/images/"):
        if "pixhost.to/show" not in (h.headers.get("Referer") or ""):
            return h._send(403, b"hotlink", "text/plain")
        return jpg(int("".join(c for c in u.path if c.isdigit())[-2:] or 0))
    return h._send(404, {})
