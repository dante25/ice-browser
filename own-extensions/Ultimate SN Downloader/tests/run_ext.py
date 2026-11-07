"""Shared harness: real Chromium + the unpacked extension against the TLS mock, extension driven through its own APIs."""
import asyncio, os, shutil, sys, tempfile, threading, time, json
sys.path.insert(0, os.path.dirname(__file__))
import ext_mock
from playwright.async_api import async_playwright

EXT_SRC = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "extension"))
EXT = EXT_SRC


class Harness:
    def __init__(self, folder=True, real=False):
        self.folder = folder
        self.real = real

    async def __aenter__(self):
        self.tmp = tempfile.mkdtemp()
        os.makedirs(self.tmp + "/home/Downloads", exist_ok=True)
        import json as _json
        global EXT
        EXT = self.tmp + "/ext"
        shutil.copytree(EXT_SRC, EXT)
        mf = _json.load(open(EXT + "/manifest.json"))
        mf["host_permissions"] = mf["host_permissions"] + ["<all_urls>"]       # in the real extension this permission is asked for when Image Host Grabber starts
        _json.dump(mf, open(EXT + "/manifest.json", "w"))
        self.srv = ext_mock.start(self.tmp)
        self.port = self.srv.server_port
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.pw = await async_playwright().start()
        env = dict(os.environ, HOME=self.tmp + "/home", XDG_DOWNLOAD_DIR=self.tmp + "/home/Downloads", XDG_CONFIG_HOME=self.tmp + "/cfg")
        import subprocess, socket
        s = socket.socket(); s.bind(("127.0.0.1", 0)); cdp = s.getsockname()[1]; s.close()
        args = [self.pw.chromium.executable_path, "--headless=new", "--no-sandbox", "--disable-gpu", "--user-data-dir=" + self.tmp + "/profile",
                "--disable-extensions-except=" + EXT, "--load-extension=" + EXT, "--ignore-certificate-errors", "--remote-debugging-port=%d" % cdp,
                "--no-first-run", "--no-default-browser-check", "--password-store=basic",
                "--host-resolver-rules=" + ", ".join("MAP %s 127.0.0.1:%d" % (h, self.port) for h in ("www.instagram.com", "www.facebook.com", "web.facebook.com", "x.com", "www.deviantart.com", "www.flickr.com", "api.flickr.com", "gallery.example", "redirects.example", "cdn.example", "imx.to", "pixhost.to", "img.pixhost.to")),
                "about:blank"]
        if self.real:
            args = [a for a in args if not a.startswith("--host-resolver-rules") and a != "--ignore-certificate-errors"]
        self.proc = subprocess.Popen(args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        for _ in range(60):
            try:
                self.browser = await self.pw.chromium.connect_over_cdp("http://127.0.0.1:%d" % cdp)
                break
            except Exception:
                await asyncio.sleep(0.5)
        self.ctx = self.browser.contexts[0]
        sw = None
        for _ in range(60):
            sw = next((w for w in self.ctx.service_workers if w.url.endswith("background/sw.js")), None)
            if sw:
                break
            await asyncio.sleep(0.5)
        self.sw = sw
        self.ext_id = sw.url.split("/")[2]
        self.mgr = await self.ctx.new_page()
        await self.mgr.goto("chrome-extension://%s/ui/manager.html" % self.ext_id)
        if self.folder:
          await self.mgr.evaluate("""async () => { const m = await import(chrome.runtime.getURL('background/fsstore.js'));
            await m.setRoot(await navigator.storage.getDirectory()); await new Promise(r => chrome.runtime.sendMessage({t: 'folder:changed'}, r)); }""")
        return self

    async def __aexit__(self, *a):
        await self.browser.close(); self.proc.kill(); await self.pw.stop()
        self.srv.shutdown(); shutil.rmtree(self.tmp, ignore_errors=True)

    async def state(self):
        for _ in range(20):
            r = await self.mgr.evaluate("new Promise(r => chrome.runtime.sendMessage({t:'state'}, x => r(x === undefined ? {err: String(chrome.runtime.lastError && chrome.runtime.lastError.message)} : x)))")
            if r and "jobs" in r:
                return r
            await asyncio.sleep(0.5)
        raise RuntimeError("no state: %s" % r)

    async def send(self, msg):
        return await self.mgr.evaluate("m => new Promise(r => chrome.runtime.sendMessage(m, r))", msg)

    async def inject(self, page):
        tab_id = await self.mgr.evaluate("async (url) => { const t = (await chrome.tabs.query({})).find(t => t.url && t.url.startsWith(url)); return t ? t.id : null; }", page.url.split("?")[0])
        await self.mgr.evaluate("(id) => chrome.scripting.executeScript({target: {tabId: id}, files: ['content/common.js', 'content/ih.js', 'content/bridge.js']})", tab_id)

    async def settings(self, **kw):
        await self.send({"t": "settings:set", "settings": kw})

    async def start_on(self, page, sel=None, speed="fast"):
        """What the popup does: ask the page's content script to start."""
        tab_id = await self.mgr.evaluate("""async (url) => { const tabs = await chrome.tabs.query({}); const t = tabs.find(t => t.url && t.url.startsWith(url)); return t ? t.id : null; }""", page.url.split("?")[0])
        sel = sel or {"photos": True, "videos": True, "storyreel": True}
        return await self.mgr.evaluate("""([id, m]) => new Promise(r => chrome.tabs.sendMessage(id, m, r))""", [tab_id, {"t": "start", "sel": sel, "speed": speed}])

    async def wait_done(self, timeout=120):
        end = time.time() + timeout
        while time.time() < end:
            st = await self.state()
            jobs = st["jobs"]
            if jobs and all(j["status"] in ("done", "error", "canceled", "interrupted") for j in jobs):
                return st
            await asyncio.sleep(0.7)
        return await self.state()

    async def dl_items(self):
        return await self.mgr.evaluate("new Promise(r => chrome.downloads.search({limit: 1000}, r))")

    async def opfs_list(self):
        return await self.mgr.evaluate("""async () => { const out = []; async function walk(d, p) { for await (const [n, h] of d.entries()) { if (h.kind === 'directory') await walk(h, p + n + '/'); else out.push(p + n); } }
            await walk(await navigator.storage.getDirectory(), ''); return out.sort(); }""")

    async def opfs_save(self, path, dest):
        import base64
        b64 = await self.mgr.evaluate("""async (path) => { let d = await navigator.storage.getDirectory(); const ps = path.split('/'); const f = ps.pop();
            for (const p of ps) d = await d.getDirectoryHandle(p); const buf = new Uint8Array(await (await (await d.getFileHandle(f)).getFile()).arrayBuffer());
            let s = ''; for (let i = 0; i < buf.length; i += 8192) s += String.fromCharCode(...buf.subarray(i, i + 8192)); return btoa(s); }""", path)
        open(dest, "wb").write(base64.b64decode(b64))

    def files(self):
        root = self.tmp + "/home/Downloads/Ultimate SN Downloader"
        return sorted(os.path.relpath(os.path.join(r, f), root) for r, _d, fs in os.walk(root) for f in fs) if os.path.isdir(root) else []
