import asyncio, sys, os, subprocess, json
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness


async def one(opts, audio_url=True):
    async with Harness() as h:
        h.srv.H.audio_url = audio_url
        page = await h.ctx.new_page()
        await page.goto("https://www.instagram.com/bob/")
        await asyncio.sleep(2)
        tab = await h.mgr.evaluate("async () => (await chrome.tabs.query({})).find(t => t.url.includes('instagram')).id")
        r = await h.mgr.evaluate("([id, m]) => new Promise(r => chrome.tabs.sendMessage(id, m, r))", [tab, {"t": "start", "sel": {"photos": False, "videos": True, "storyreel": False}, "speed": "fast", "opts": opts}])
        assert r.get("ok"), r
        st = await h.wait_done(180)
        j = st["jobs"][0]
        probe = {}
        for path in await h.opfs_list():
            dest = os.path.join(h.tmp, os.path.basename(path))
            await h.opfs_save(path, dest)
            out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", dest], capture_output=True, text=True)
            try:
                probe[path] = sorted(s["codec_type"] for s in json.loads(out.stdout).get("streams", []))
            except Exception:
                probe[path] = "unreadable"
        print(opts, "audio_url" if audio_url else "dash-audio", "->", j["status"], j["downloaded"], st["names"], list(probe.values()), j["error"] or "", j["log"][-2:])
        return j, st, list(probe.values())


async def main():
    j, st, pr = await one({"merge": True, "thumb": True})
    assert j["status"] == "done" and j["downloaded"] == 1, j
    assert any(n.endswith(".mp4") for n in st["names"]) and any(".thumbnail." in n for n in st["names"]), st["names"]
    assert ["audio", "video"] in pr, ("merged file must hold video AND sound", pr)
    print("OK video options")
asyncio.run(main())
