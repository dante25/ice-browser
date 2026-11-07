import asyncio, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness

async def job(h):
    return (await h.state())["jobs"][0]

async def wait_final(h, timeout=150):
    end = time.time() + timeout
    while time.time() < end:
        j = await job(h)
        if j["status"] in ("done", "error", "interrupted", "canceled"):
            return j
        await asyncio.sleep(0.5)
    return await job(h)

async def main():
    # 1) the scan dies half way (server errors) -> "Retry" continues from the saved cursor instead of starting over
    async with Harness() as h:
        h.srv.H.fail_after_c1 = True
        page = await h.ctx.new_page()
        await page.goto("https://www.instagram.com/bob/")
        await asyncio.sleep(2)
        await h.start_on(page)
        j = await wait_final(h)
        print("1st run:", j["status"], j["downloaded"], "| error:", j["error"][:90], "| canResume:", j["canResume"])
        assert j["status"] == "error" and j["canResume"] and 0 < j["downloaded"] < 37, j
        first = j["downloaded"]
        h.srv.H.fail_after_c1 = False
        await h.send({"t": "job:retry", "jobId": j["id"]})
        j = await wait_final(h)
        print("after retry:", j["status"], j["downloaded"], [l for l in j["log"] if "resuming" in l])
        assert j["status"] == "done" and j["downloaded"] == 37, j
        assert any("posts: resuming from the saved cursor" in l for l in j["log"]), j["log"]
        assert len(await h.opfs_list()) == 37
    # 2) some files fail to download (CDN busy) -> "Retry failed" saves only those, no requests to Instagram
    async with Harness() as h:
        h.srv.H.cdn_fail = "img_1"
        page = await h.ctx.new_page()
        await page.goto("https://www.instagram.com/bob/")
        await asyncio.sleep(2)
        await h.start_on(page)
        j = await wait_final(h, 200)
        print("failed run:", j["status"], j["downloaded"], "failed", j["failed"], "kept", j["failedKept"])
        assert j["failed"] > 0 and j["failedKept"] == j["failed"], j
        total = j["downloaded"] + j["failed"]
        h.srv.H.cdn_fail = ""
        import mock_sites
        before = len([1 for m, p in mock_sites.STATE["log"] if p == "/graphql/query"])
        await h.send({"t": "job:retry", "jobId": j["id"]})
        j = await wait_final(h, 100)
        after = len([1 for m, p in mock_sites.STATE["log"] if p == "/graphql/query"])
        print("after retry failed:", j["status"], j["downloaded"], "graphql calls added:", after - before)
        assert j["status"] == "done" and j["downloaded"] == total and j["failed"] == 0 and after == before, j
    print("OK resume + retry failed")
asyncio.run(main())
