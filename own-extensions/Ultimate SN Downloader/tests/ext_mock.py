"""TLS mock of Instagram + Facebook for the extension tests (served under the real host names via --host-resolver-rules)."""
import json, os, ssl, subprocess, sys, tempfile
sys.path.insert(0, "/mnt/B62E9F772E9F2EFD/ZORIN OS/Ice Grabber/tests")
import mock_sites
sys.path.insert(0, os.path.dirname(__file__))
import sites_mock
from urllib.parse import urlparse


def make_cert(d):
    key, crt = os.path.join(d, "k.pem"), os.path.join(d, "c.pem")
    subprocess.run(["openssl", "req", "-x509", "-newkey", "rsa:2048", "-nodes", "-keyout", key, "-out", crt, "-days", "2", "-subj", "/CN=mock",
                    "-addext", "subjectAltName=DNS:www.instagram.com,DNS:www.facebook.com,DNS:web.facebook.com,DNS:x.com,DNS:www.deviantart.com,DNS:www.flickr.com,DNS:api.flickr.com,DNS:gallery.example,DNS:redirects.example,DNS:cdn.example,DNS:imx.to,DNS:pixhost.to,DNS:img.pixhost.to"], check=True, capture_output=True)
    return crt, key


def make_dash(tmp):
    d = os.path.join(tmp, "dash"); os.makedirs(d, exist_ok=True)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=15", "-f", "lavfi", "-i", "sine=frequency=440:duration=3",
                    "-map", "0:v", "-map", "1:a", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", "-f", "dash", "-single_file", "1",
                    "-single_file_name", "s$RepresentationID$.mp4", "-adaptation_sets", "id=0,streams=v id=1,streams=a", os.path.join(d, "out.mpd")], check=True, cwd=d)
    return d


def start(tmp):
    dash_dir = make_dash(tmp)
    srv = mock_sites.start()
    srv.scheme = "https"
    Base = srv.RequestHandlerClass

    class H(Base):
        def end_headers(self):
            origin = self.headers.get("Origin")
            self.send_header("Access-Control-Allow-Origin", origin or "*")
            if origin:
                self.send_header("Access-Control-Allow-Credentials", "true")
            super().end_headers()

        def _send(self, code, body, ctype="application/json"):
            # give the video item #5 an HD DASH manifest + a reel sound, the way Instagram's replies carry them
            if ctype == "application/json" and isinstance(body, dict) and getattr(H, "dash", True):
                base = "https://127.0.0.1:%d" % self.server.server_port
                import re as _re
                mpd = open(os.path.join(dash_dir, "out.mpd")).read().replace("s0.mp4", base + "/cdn/dash_v.mp4").replace("s1.mp4", base + "/cdn/dash_a.mp4")
                # ffmpeg writes <SegmentList>; Instagram's manifests carry <SegmentBase indexRange> + <Initialization range>
                mpd = _re.sub(r'<SegmentList[^>]*>\s*<Initialization range="([^"]+)"\s*/>\s*<SegmentURL mediaRange="[^"]+" indexRange="([^"]+)"\s*/>\s*</SegmentList>',
                              r'<SegmentBase indexRange="\2"><Initialization range="\1"/></SegmentBase>', mpd)
                def walk(o):
                    if isinstance(o, dict):
                        vv = o.get("video_versions")
                        if vv and "vid_5.mp4" in vv[0].get("url", ""):
                            o["video_dash_manifest"] = mpd
                            if getattr(H, "audio_url", True):
                                o["clips_metadata"] = {"original_sound_info": {"progressive_download_url": base + "/cdn/audio_only.m4a", "original_audio_title": "Original audio"}}
                        for v in o.values(): walk(v)
                    elif isinstance(o, list):
                        for v in o: walk(v)
                walk(body)
            return super()._send(code, body, ctype)

        def route(self, method):
            u = urlparse(self.path)
            base = "https://127.0.0.1:%d" % self.server.server_port
            host = (self.headers.get("Host") or "").split(":")[0]
            if host == "www.instagram.com" and u.path == "/p/CODE5/":
                return self._send(200, ('<html><body><article><a href="/p/CODE5/">time</a><video src="%s/cdn/vid_5.mp4" width="480" height="640" controls></video></article></body></html>' % base).encode(), "text/html")
            if host == "www.instagram.com" and u.path.startswith("/api/v1/media/") and u.path.endswith("/info/"):
                return self._send(200, {"items": [mock_sites.ig_item(5, base, "video")]})
            if host == "www.facebook.com" and u.path in ("/reel/777/", "/reel/888/", "/reel/999/", "/reel/555/", "/reel/556/") and "text/html" in (self.headers.get("Accept") or "text/html"):
                vid = u.path.split("/")[2]
                video = '<video src="%s/cdn/fbreel_%s_sd.mp4" width="360" height="640" controls></video>' % (base, vid)
                if vid == "555":                           # logged-in style: only progressive_urls
                    import json as _j
                    blob = {"data": {"media": {"id": "555", "videoDeliveryResponseResult": {"progressive_urls": [
                        {"progressive_url": "%s/cdn/fbreel_555_sd.mp4" % base, "metadata": {"quality": "SD"}}, {"progressive_url": "%s/cdn/fbreel_555_hd.mp4" % base, "metadata": {"quality": "HD"}}]}}}}
                    data = '<script type="application/json">%s</script>' % _j.dumps(blob)
                elif vid == "556":                         # only a DASH manifest (video and audio tracks apart)
                    import json as _j, re as _r
                    mpd = open(os.path.join(dash_dir, "out.mpd")).read().replace("s0.mp4", base + "/cdn/dash_v.mp4").replace("s1.mp4", base + "/cdn/dash_a.mp4")
                    mpd = _r.sub(r'<SegmentList[^>]*>\s*<Initialization range="([^"]+)"\s*/>\s*<SegmentURL mediaRange="[^"]+" indexRange="([^"]+)"\s*/>\s*</SegmentList>', r'<SegmentBase indexRange="\2"><Initialization range="\1"/></SegmentBase>', mpd)
                    blob = {"data": {"media": {"id": "556", "videoDeliveryLegacyFields": {"browser_native_hd_url": None, "browser_native_sd_url": None, "dash_manifest_xml_string": mpd}}}}
                    data = '<script type="application/json">%s</script>' % _j.dumps(blob)
                elif vid == "999":                           # the address only appears in an inline script, escaped like Facebook does
                    data = '<script>var x={"id":"999","playable_url_quality_hd":"%s\\/cdn\\/fbreel_999_hd.mp4"};</script>' % base.replace("/", "\\/")
                else:
                    data = '<script type="application/json">{"data":{"video":{"__typename":"Video","id":"%s","browser_native_sd_url":"%s/cdn/fbreel_%s_sd.mp4","browser_native_hd_url":"%s/cdn/fbreel_%s_hd.mp4"}}}</script>' % (vid, base, vid, base, vid)
                if self.headers.get("Sec-Fetch-Dest") == "document":       # opened by the user: the video is on screen with its data
                    return self._send(200, ("<html><body>%s%s</body></html>" % (video, data)).encode(), "text/html")
                return self._send(200, ("<html><body>%s</body></html>" % data).encode(), "text/html")
            if host == "www.facebook.com" and u.path == "/mockfb/feed":
                return self._send(200, ('<html><body><div><a href="/reel/888/">reel</a><video src="%s/cdn/fbreel_888_sd.mp4" width="360" height="640" controls></video></div></body></html>' % base).encode(), "text/html")
            if host in ("gallery.example", "redirects.example", "cdn.example", "imx.to", "pixhost.to", "img.pixhost.to"):
                return sites_mock.hosts(self, u, base, host, method)
            if host == "x.com" and not u.path.startswith("/cdn/"):
                return sites_mock.x(self, u, base)
            if host in ("www.flickr.com", "api.flickr.com") and not u.path.startswith("/cdn/"):
                return sites_mock.flickr(self, u, base, host)
            if host == "www.deviantart.com" and not u.path.startswith("/cdn/"):
                return sites_mock.deviantart(self, u, base)
            if u.path == "/graphql/query" and method == "POST" and getattr(H, "fail_after_c1", False) and "PolarisProfilePostsTab" in self.body and "c1" in self.body:
                return self._send(500, {"message": "Server error", "status": "fail"})
            if u.path.startswith("/cdn/") and getattr(H, "cdn_fail", "") and H.cdn_fail in u.path:
                return self._send(503, b"busy", "text/plain")
            if u.path == "/api/v1/feed/reels_media/" and method == "GET" and self.headers.get("x-fb-friendly-name"):
                return self._send(500, {"message": "GraphQL header on a REST call", "status": "fail"})     # what the real site seems to do
            if u.path == "/api/v1/feed/reels_media/" and getattr(H, "fail_reels", False):
                return self._send(500, {"message": "Server error", "status": "fail"})
            import re as _re2
            if u.path.startswith("/cdn/da_"):
                mock_sites.STATE["log"].append((method, u.path))
            if _re2.fullmatch(r"/cdn/da_\d+\.jpg", u.path):
                return self._send(401, b"token does not cover this path", "text/plain")      # DeviantArt: the token only opens the /v1/fill/... paths
            if u.path.startswith("/cdn/da_") and u.path.endswith("_orig.jpg"):
                return self._send(403, b"login needed", "text/plain")                         # download link refused (e.g. cookies not accepted)
            if u.path in ("/cdn/dash_v.mp4", "/cdn/dash_a.mp4", "/cdn/audio_only.m4a"):
                from urllib.parse import parse_qs as _pq
                q = {k: v[0] for k, v in _pq(u.query).items()}
                data = open(os.path.join(dash_dir, "s0.mp4" if u.path.endswith("dash_v.mp4") else "s1.mp4"), "rb").read()
                if "bytestart" in q:
                    data = data[int(q["bytestart"]): int(q["byteend"]) + 1]
                self.send_response(200); self.send_header("Content-Type", "video/mp4"); self.send_header("Content-Length", str(len(data))); self.end_headers(); self.wfile.write(data)
                return
            host = (self.headers.get("Host") or "")
            if u.path == "/bob/":
                orig = self._send
                shim = b"window.require=function(n){var m={'PolarisProfileReelsTabContentQuery_connection.graphql':{params:{id:'778',providedVariables:{}}}};if(m[n])return m[n];throw new Error('x')};"
                def send(code, body, ctype="application/json"):
                    if ctype == "text/html":
                        body = body.replace(b"<script>", b"<script>" + shim, 1)
                    orig(code, body, ctype)
                self._send = send
            if u.path == "/media/set/":
                self.path = "/fb/small"                      # album page whose grid only has small thumbnails
            if u.path == "/api/graphql/" and method == "POST" and "CometPhotoRootContentQuery" in self.body:
                H.enrich_calls = getattr(H, "enrich_calls", 0) + 1
                if getattr(H, "fb_block_after", 0) and H.enrich_calls == H.fb_block_after + 1:
                    return self._send(429, {"error": 1357004, "errorSummary": "You're temporarily blocked", "errorDescription": "try again later"})
            if u.path == "/mockfb/photos":
                self.path = "/fb/paged"
            elif u.path == "/mockfb/videos":
                blob = json.dumps({"data": {"node": {"videos": {"edges": [{"node": {"__typename": "Video", "id": str(700000000000 + i),
                                    "playable_url": "%s/cdn/fbvid_%d.mp4" % (base, i)}} for i in range(5)]}}}})
                return self._send(200, ("<html><body style='height:3000px'><script type='application/json'>%s</script></body></html>" % blob).encode(), "text/html")
            elif u.path == "/mockfb/reels":
                blob = json.dumps({"data": {"node": {"reels": {"edges": [{"node": {"__typename": "Video", "id": str(600000000000 + i),
                                    "playable_url": "%s/cdn/fbreel_%d.mp4" % (base, i)}} for i in range(3)]}}}})
                return self._send(200, ("<html><body style='height:3000px'><script type='application/json'>%s</script></body></html>" % blob).encode(), "text/html")
            elif u.path == "/mockfb":
                return self._send(200, b"<html><head><title>mockfb</title></head><body>profile</body></html>", "text/html")
            return super().route(method)

    srv.RequestHandlerClass = H
    srv.H = H
    crt, key = make_cert(tmp)
    ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
    ctx.load_cert_chain(crt, key)
    srv.socket = ctx.wrap_socket(srv.socket, server_side=True)
    return srv
