import asyncio, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness
import mock_sites


async def main():
    async with Harness() as h:
        await h.settings(cooldownMin=0.05)                       # 3 s instead of 35 min
        mock_sites.STATE["block_after"] = 3                      # the mock answers 429 after 3 data requests
        page = await h.ctx.new_page()
        await page.goto("https://www.instagram.com/bob/")
        await asyncio.sleep(2)
        r = await h.start_on(page)
        saw_cooling = False
        end = time.time() + 120
        while time.time() < end:
            st = await h.state()
            j = st["jobs"][0]
            if j["status"] == "cooling" or st["block"]["ig"]["until"] > st["now"]:
                saw_cooling = True
            if j["status"] in ("done", "error"):
                break
            await asyncio.sleep(0.4)
        print("cooling seen:", saw_cooling, "| status", j["status"], "| downloaded", j["downloaded"], "| note:", j["note"], "| log tail:", j["log"][-2:])
        assert saw_cooling and j["status"] == "done" and j["downloaded"] == 37, j
        assert len(set(st["names"])) == len(st["names"]) == 37, "duplicate files"
        # run the same profile again: no download history, so it is downloaded again over the same files (no duplicates piling up)
        mock_sites.STATE["block_after"] = None
        r = await h.start_on(page)
        await asyncio.sleep(1)
        end = time.time() + 90
        while time.time() < end:
            st = await h.state()
            j2 = st["jobs"][0]
            if j2["id"] != j["id"] and j2["status"] in ("done", "error"):
                break
            await asyncio.sleep(0.5)
        files = await h.opfs_list()
        print("second run:", j2["status"], "downloaded", j2["downloaded"], "| files on disk", len(files), "| total counter", st["totals"])
        assert j2["downloaded"] == 37 and len(files) == 37 and st["totals"]["ig"] == 74, (j2, len(files), st["totals"])
        # unknown profile -> clear error, not a crash
        p2 = await h.ctx.new_page()
        await p2.goto("https://www.instagram.com/nobody_here/")
        await asyncio.sleep(2)
        await h.start_on(p2)
        end = time.time() + 90
        while time.time() < end:
            st = await h.state()
            j3 = st["jobs"][0]
            if j3["status"] in ("done", "error") and j3["id"] not in (j["id"], j2["id"]):
                break
            await asyncio.sleep(0.5)
        print("unknown profile:", j3["status"], j3["error"][:120])
        assert j3["status"] == "error" and "@nobody_here" in j3["error"], j3
        print("OK block + dedupe + unknown profile")
asyncio.run(main())
