"""No download history: a second run downloads again (overwrites the same files); the lifetime counter keeps counting."""
import asyncio, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness

async def wait_new(h, old_ids, timeout=120):
    end = time.time() + timeout
    while time.time() < end:
        st = await h.state()
        new = [j for j in st["jobs"] if j["id"] not in old_ids]
        if new and new[0]["status"] in ("done", "error"):
            return new[0], st
        await asyncio.sleep(0.5)
    raise AssertionError("job did not finish")

async def main():
    async with Harness() as h:
        page = await h.ctx.new_page()
        await page.goto("https://www.instagram.com/bob/")
        await asyncio.sleep(2)
        await h.start_on(page)
        j1, st = await wait_new(h, [])
        assert j1["downloaded"] == 37 and st["totals"]["ig"] == 37, (j1, st["totals"])
        await h.mgr.evaluate("""async () => { const r = await navigator.storage.getDirectory(); for await (const [n] of r.entries()) await r.removeEntry(n, {recursive: true}); }""")
        await h.start_on(page)
        j2, st = await wait_new(h, [j1["id"]])
        files = await h.opfs_list()
        print("2nd run:", j2["downloaded"], "downloaded,", j2["skipped"], "skipped, on disk", len(files), "| totals", st["totals"])
        assert j2["downloaded"] == 37 and j2["skipped"] == 0 and len(files) == 37 and st["totals"]["ig"] == 74, j2
        stored = await h.mgr.evaluate("new Promise(r => chrome.storage.local.get(null, r))")
        assert "seen_ig" not in stored and "seen_fb" not in stored, list(stored)
    print("OK no history, lifetime counter")
asyncio.run(main())
