import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness
import sites_mock, mock_sites

async def run(sel):
    async with Harness() as h:
        mock_sites.STATE["log"].clear()
        page = await h.ctx.new_page()
        await page.goto("https://www.deviantart.com/bob/gallery")
        await asyncio.sleep(2)
        r = await h.start_on(page, sel)
        assert r.get("ok"), r
        st = await h.wait_done(240)
        return st, [p for m, p in mock_sites.STATE["log"] if p.startswith("/cdn/")], await h.opfs_list()

async def main():
    T, V = sites_mock.DA_TOTAL, len(sites_mock.DA_VIDEOS)
    st, cdn, files = await run({"photos": True, "videos": True, "storyreel": False})
    j = st["jobs"][0]
    print("gallery:", j["status"], j["downloaded"], "of", T, "| files", len(files), "| error:", j["error"][:100])
    assert j["status"] == "done" and j["downloaded"] == T == len(files), j
    assert any(p == "/cdn/da_8_orig.jpg" for p in cdn), "downloadable art must try the artist's download link first"
    assert j["failed"] == 0, j["failWhy"]
    assert any(p.startswith("/cdn/da_8.jpg/v1/fill") for p in cdn), "a refused download link must fall back to the full-view URL"
    assert all(f.startswith("DeviantArt/bob/") for f in files), [f for f in files if not f.startswith("DeviantArt/bob/")][:3]     # author is only an id in the page state: still one folder
    assert any(p.startswith("/cdn/da_9.jpg/v1/fill") for p in cdn) and not any(p == "/cdn/da_9.jpg" for p in cdn) and any(p == "/cdn/dav_10_720.mp4" for p in cdn) and not any("dav_10_480" in p for p in cdn), cdn[:5]
    st, cdn, files = await run({"photos": True, "videos": False, "storyreel": False})
    assert st["jobs"][0]["downloaded"] == T - V == len(files), st["jobs"][0]
    st, cdn, files = await run({"photos": False, "videos": True, "storyreel": False})
    assert st["jobs"][0]["downloaded"] == V == len(files), st["jobs"][0]
    print("OK deviantart: gallery with offset paging, originals, videos, photo/video choice")
asyncio.run(main())
