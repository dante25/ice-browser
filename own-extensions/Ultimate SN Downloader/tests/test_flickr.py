import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness
import sites_mock, mock_sites

async def run(url):
    async with Harness() as h:
        mock_sites.STATE["log"].clear()
        page = await h.ctx.new_page()
        await page.goto(url)
        await asyncio.sleep(2)
        r = await h.start_on(page, {"photos": True, "videos": True, "storyreel": False})
        assert r.get("ok"), r
        st = await h.wait_done(300)
        return st, [p for m, p in mock_sites.STATE["log"]], await h.opfs_list()

async def main():
    st, log, files = await run("https://www.flickr.com/photos/bob/")
    j = st["jobs"][0]
    cdn = [p for p in log if p.startswith("/cdn/")]
    fetched = [p for p in log if p.startswith("FL /photos/bob/50")]
    print("photostream:", j["status"], j["downloaded"], "of", sites_mock.FL_TOTAL, "| files", len(files), "| photo pages fetched:", len(fetched), "| error:", j["error"][:100])
    assert j["status"] == "done" and j["downloaded"] == sites_mock.FL_TOTAL == len(files), j
    originals = [p for p in cdn if p.endswith("_o.jpg")]
    ks = [p for p in cdn if p.endswith("_k.jpg")]
    assert len(originals) + len(ks) == sites_mock.FL_TOTAL and len(originals) == 50 and len(ks) == 50, (len(originals), len(ks))   # even ids: original, odd ids (no Download button): largest shown = k
    assert len(fetched) == 30, "only photos that are not in the listing data need their own page"
    st, log, files = await run("https://www.flickr.com/photos/bob/albums/72157600000000000")
    assert st["jobs"][0]["downloaded"] == sites_mock.FL_ALBUM == len(files), st["jobs"][0]
    st, log, files = await run("https://www.flickr.com/photos/bob/5000000003/")
    cdn = [p for p in log if p.startswith("/cdn/")]
    assert st["jobs"][0]["downloaded"] == 1 and any(p.endswith("5000000003_abc123_k.jpg") for p in cdn), (st["jobs"][0], cdn)
    print("OK flickr: stream with paging, album, single photo without Download button (largest size from the page)")
asyncio.run(main())
