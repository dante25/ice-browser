"""The hover button on single videos: IG post, FB reel (data on the page), FB reel from a feed (data on the reel's own page), FB reel with an inline-script address."""
import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness
import mock_sites

async def press(h, page, selector="video"):
    box = await page.locator(selector).first.bounding_box()
    await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 60)
    await page.mouse.move(box["x"] + box["width"] / 2 + 5, box["y"] + 65)
    await page.wait_for_selector("#usn-quick", state="visible", timeout=8000)
    await page.click("#usn-quick")

async def final(h, n):
    import time
    end = time.time() + 90
    while time.time() < end:
        st = await h.state()
        if len(st["jobs"]) >= n and all(j["status"] in ("done", "error") for j in st["jobs"]):
            return st
        await asyncio.sleep(0.5)
    return await h.state()

async def one(url, expect_cdn, selector="video"):
    async with Harness(folder=False) as h:          # NO download folder chosen: the button must still work with one click
        mock_sites.STATE["log"].clear()
        page = await h.ctx.new_page()
        await page.goto(url)
        await asyncio.sleep(1.5)
        await press(h, page, selector)
        st = await final(h, 1)
        j = st["jobs"][0]
        cdn = [p for m, p in mock_sites.STATE["log"] if p.startswith("/cdn/")]
        items = await h.dl_items()
        files = st["names"]
        print(url.split("//")[1][:40], "->", j["status"], j["downloaded"], files[:1], "| chrome downloads:", [(i["state"]) for i in items], "| error:", j["error"][:90])
        assert j["status"] == "done" and j["downloaded"] == 1 == len(files) == len(items) and files[0].endswith(".mp4"), (j, files, items)
        assert items[0]["state"] == "complete" and not await h.opfs_list(), "it must go to Chrome's list, not into a chosen folder"
        pages = [p.url for p in h.ctx.pages]
        assert not any("folder.html" in u or ("manager.html" in u and u != h.mgr.url) for u in pages), pages
        assert any(expect_cdn in p for p in cdn), (expect_cdn, cdn)

async def main():
    await one("https://www.instagram.com/p/CODE5/", "vid_5.mp4")
    await one("https://www.facebook.com/reel/777/", "fbreel_777_hd.mp4")
    await one("https://www.facebook.com/mockfb/feed", "fbreel_888_hd.mp4")
    await one("https://www.facebook.com/reel/555/", "fbreel_555_hd.mp4")          # only progressive_urls
    await one("https://www.facebook.com/reel/999/", "fbreel_999_hd.mp4")          # address only in an inline script
    # only a DASH manifest: the video and audio tracks are fetched and joined
    async with Harness(folder=False) as h:
        mock_sites.STATE["log"].clear()
        page = await h.ctx.new_page()
        await page.goto("https://www.facebook.com/reel/556/")
        await asyncio.sleep(1.5)
        await press(h, page)
        st = await final(h, 1)
        j = st["jobs"][0]
        import subprocess, json
        items = await h.dl_items()
        files = st["names"]
        assert j["status"] == "done" and len(items) == 1 and items[0]["state"] == "complete", (j["status"], j["error"], items)
        dest = items[0]["filename"]
        kinds = sorted(x["codec_type"] for x in json.loads(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=codec_type", "-of", "json", dest], capture_output=True, text=True).stdout)["streams"])
        print("DASH only ->", j["status"], files, kinds)
        assert kinds == ["audio", "video"], kinds
    print("OK video button: IG post, FB reel, FB reel from a feed, progressive_urls, inline-script address, DASH only")
asyncio.run(main())
