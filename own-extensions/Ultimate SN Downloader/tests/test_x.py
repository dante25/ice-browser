import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness
import sites_mock, mock_sites

async def run(sel):
    async with Harness() as h:
        mock_sites.STATE["log"].clear()
        page = await h.ctx.new_page()
        await page.goto("https://x.com/bob/media")
        await asyncio.sleep(2)
        r = await h.start_on(page, sel)
        assert r.get("ok"), r
        st = await h.wait_done(240)
        return st, [p for m, p in mock_sites.STATE["log"] if p.startswith("/cdn/")], await h.opfs_list()

async def main():
    photos, videos = sites_mock.x_expected()
    st, cdn, files = await run({"photos": True, "videos": True, "storyreel": False})
    j = st["jobs"][0]
    print("X all:", j["status"], j["downloaded"], "expected", photos + videos, "| files", len(files), "| totals", st["totals"]["x"])
    assert j["status"] == "done" and j["downloaded"] == photos + videos == len(files) and st["totals"]["x"] == photos + videos, j
    assert not any("alice" in f for f in files) and not any(("xp_90" in p or "xv_90" in p) for p in cdn), "someone else's media was downloaded"
    assert any("xv_1_hi.mp4" in p for p in cdn) and not any("xv_1_lo" in p for p in cdn), "must take the best mp4 variant"
    assert any(f.startswith("X/bob/media/") for f in files), files[:2]
    st, cdn, files = await run({"photos": True, "videos": False, "storyreel": False})
    assert st["jobs"][0]["downloaded"] == photos == len(files), st["jobs"][0]
    st, cdn, files = await run({"photos": False, "videos": True, "storyreel": False})
    assert st["jobs"][0]["downloaded"] == videos == len(files), st["jobs"][0]
    print("OK x: photos / videos / all, best mp4, only the profile's own media")
asyncio.run(main())
