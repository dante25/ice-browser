import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness
import mock_sites

async def main():
    async with Harness() as h:
        await h.settings(cooldownMin=0.5)
        mock_sites.STATE["block_after"] = 8
        page = await h.ctx.new_page()
        await page.goto("https://www.instagram.com/bob/")
        await asyncio.sleep(2)
        await h.start_on(page, speed="normal")
        await asyncio.sleep(14)
        await h.mgr.set_viewport_size({"width": 520, "height": 620})
        await h.mgr.screenshot(path="/tmp/shot_manager.png")
        pop = await h.ctx.new_page()
        await pop.set_viewport_size({"width": 340, "height": 420})
        await pop.goto("chrome-extension://%s/ui/popup.html" % h.ext_id)
        await asyncio.sleep(1)
        await pop.screenshot(path="/tmp/shot_popup.png")
asyncio.run(main())
