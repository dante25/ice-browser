import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness

async def main():
    async with Harness() as h:
        h.srv.H.fail_reels = True          # Instagram answers HTTP 500 on /api/v1/feed/reels_media/
        page = await h.ctx.new_page()
        await page.goto("https://www.instagram.com/bob/")
        await asyncio.sleep(2)
        await h.start_on(page)
        st = await h.wait_done(240)
        j = st["jobs"][0]
        print(j["status"], j["downloaded"], j["parts"], "| warn:", j["warn"][:160])
        # posts (31) and reels (2) still saved; stories + highlights skipped with a visible warning, job is not an error
        assert j["status"] == "done" and j["downloaded"] == 33 and "Stories skipped" in j["warn"] and "highlight(s) skipped" in j["warn"], j
        print("OK stories 500 is not fatal")
asyncio.run(main())
