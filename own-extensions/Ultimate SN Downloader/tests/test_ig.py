import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness

async def main():
    async with Harness() as h:
        page = await h.ctx.new_page()
        await page.goto("https://www.instagram.com/bob/")
        await asyncio.sleep(2)
        r = await h.start_on(page)
        print("start:", r)
        st = await h.wait_done(150)
        j = st["jobs"][0]
        print({k: j[k] for k in ("status", "scanned", "found", "downloaded", "skipped", "failed", "error", "parts", "note")})
        files = await h.opfs_list()
        print(files[:3])
        print(len(files), files[:3])
        assert j["status"] == "done", j
        assert j["downloaded"] == len(files) == 37, (j["downloaded"], len(files))
        print("OK ig profile: all kinds")
asyncio.run(main())
