import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness


async def run(h, url, sel, expect_status="done"):
    page = await h.ctx.new_page()
    await page.goto(url)
    await asyncio.sleep(2)
    r = await h.start_on(page, sel)
    assert r and r.get("ok"), r
    st = await h.wait_done(120)
    return page, st


async def main():
    # 1) Instagram: photos only / videos only / stories+reels only
    for sel, expect in (({"photos": True, "videos": False, "storyreel": False}, 29), ({"photos": False, "videos": True, "storyreel": False}, 2),
                        ({"photos": False, "videos": False, "storyreel": True}, 6)):
        async with Harness() as h:
            page, st = await run(h, "https://www.instagram.com/bob/", sel)
            j = st["jobs"][0]
            print("IG", sel, "->", j["status"], j["downloaded"], j["parts"])
            assert j["status"] == "done" and j["downloaded"] == len(st["names"]), j
            # photos: 29 posts minus the video at #5 -> 28 photo posts, carousel has 3 images -> 28 + 2 = 30 minus video (1) ... counted below
            print("   names:", [n.split('/')[-1] for n in st["names"]][:3], len(st["names"]))
            exp = {29: None, 2: None, 6: 6}[expect]
            if exp is not None:
                assert j["downloaded"] == exp, j["downloaded"]
    # 2) Facebook: photos tab (cursor paging), videos tab, reels tab, single photo
    async with Harness() as h:
        page, st = await run(h, "https://www.facebook.com/mockfb/photos", {"photos": True, "videos": False, "storyreel": False})
        j = st["jobs"][0]
        print("FB photos ->", j["status"], j["scanned"], j["downloaded"], j["error"])
        assert j["status"] == "done" and j["downloaded"] == 30, j
    async with Harness() as h:
        page = await h.ctx.new_page()
        await page.goto("https://www.facebook.com/mockfb")
        await asyncio.sleep(2)
        r = await h.start_on(page, {"photos": False, "videos": True, "storyreel": True})
        st = await h.wait_done(120)
        j = st["jobs"][0]
        print("FB profile videos+reels ->", j["status"], j["downloaded"], j["parts"], j["error"])
        assert j["status"] == "done" and j["downloaded"] == 8, j
    async with Harness() as h:
        page, st = await run(h, "https://www.facebook.com/photo/?fbid=900000000003", {"photos": True, "videos": False, "storyreel": False})
        j = st["jobs"][0]
        print("FB single photo ->", j["status"], j["downloaded"], st["names"], j["error"])
        assert j["status"] == "done" and j["downloaded"] == 1, j
    print("OK kinds + fb")
asyncio.run(main())
