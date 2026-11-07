import asyncio, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness
import sites_mock, mock_sites

async def run(url, min_kb=0):
    async with Harness() as h:
        await h.settings(ihMinKB=min_kb)
        mock_sites.STATE["log"].clear()
        page = await h.ctx.new_page()
        await page.goto(url)
        await asyncio.sleep(1.5)
        await h.inject(page)
        r = await h.start_on(page, {"photos": True, "videos": False, "storyreel": False})
        assert r and r.get("ok"), r
        st = await h.wait_done(120)
        return st, [p for m, p in mock_sites.STATE["log"] if p.startswith("IH ")], await h.opfs_list()

async def main():
    # 1) direct links (the page's thumbnails link straight to the .jpg): all of them, duplicates once, unknown host reported
    st, log, files = await run("https://gallery.example/galleries/one/")
    j = st["jobs"][0]
    print("direct:", j["status"], j["downloaded"], files[:2], "| warn:", j["warn"][:80])
    assert j["status"] == "done" and j["downloaded"] == sites_mock.IH_DIRECT == len(files), j
    assert all(f.startswith("Images/gallery.example/Gallery One - Example/") for f in files), files[:2]
    assert files[0].split("/")[-1].startswith("001_") and "ads.example" in j["warn"], (files[0], j["warn"])
    # 2) links to image hosts, resolved with the REAL host-file rules (imx.to posts a form, pixhost reads <img id="image">), hotlink-protected files need the Referer
    st, log, files = await run("https://redirects.example/set/1")
    j = st["jobs"][0]
    print("hosts:", j["status"], j["downloaded"], [f.split("/")[-1] for f in files][:3], "| error:", j["error"][:80], j["note"][:80], j["warn"][:80])
    assert j["status"] == "done" and j["downloaded"] == sites_mock.IH_IMX + sites_mock.IH_PIXHOST == len(files), j
    names = [f.split("/")[-1] for f in files]
    assert any(n.endswith("img_0.jpg") and n.startswith("00") for n in names), names          # pixhost rule: leading "<digits>_" removed from the name
    assert any("photo_0" in n for n in names), names                                          # imx.to rule: file name from alt (extension added)
    assert all(f.startswith("Images/redirects.example/Set Six/") for f in files), files[:2]
    # 3) minimum file size (ImageHostGrabber default 20 KB): the tiny test files are skipped as thumbnails
    st, log, files = await run("https://gallery.example/galleries/one/", min_kb=20)
    j = st["jobs"][0]
    print("min size 20 KB:", j["status"], j["downloaded"], "skipped", j["skipped"])
    assert j["downloaded"] == 0 and j["skipped"] >= sites_mock.IH_DIRECT and not files, j
    print("OK image host grabber: direct links, host-file rules (function + referer), min size")
asyncio.run(main())
