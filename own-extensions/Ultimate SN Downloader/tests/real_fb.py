import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness

async def trial(h, url, button=False):
    page = await h.ctx.new_page()
    await page.goto(url, wait_until="domcontentloaded")
    await asyncio.sleep(7)
    before = len((await h.state())["jobs"])
    if button:
        box = await page.locator("video").first.bounding_box()
        await page.mouse.move(box["x"] + box["width"] / 2, box["y"] + 80)
        await page.mouse.move(box["x"] + box["width"] / 2 + 6, box["y"] + 86)
        await page.wait_for_selector("#usn-quick", state="visible", timeout=10000)
        await page.click("#usn-quick")
    else:
        r = await h.start_on(page, {"photos": False, "videos": True, "storyreel": True})
    for _ in range(100):
        st = await h.state()
        if len(st["jobs"]) > before and st["jobs"][0]["status"] in ("done", "error"):
            break
        await asyncio.sleep(1)
    j = st["jobs"][0]
    print(url[-60:], "button" if button else "popup-path", "->", j["status"], j["downloaded"], j["error"][:150])
    await page.close()

async def main():
    async with Harness(real=True) as h:
        await trial(h, "https://www.facebook.com/reel/1024657837050528/")
        await trial(h, "https://www.facebook.com/watch/?v=1024657837050528", button=True)
        await trial(h, "https://www.facebook.com/61593499949533/videos/1024657837050528/", button=True)
asyncio.run(main())
