import asyncio, sys, os, json
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness

async def main():
    async with Harness(real=True) as h:
        await h.settings(ihMinKB=20)
        page = await h.ctx.new_page()
        await page.goto("https://girlsreleased.com/set/54866", wait_until="domcontentloaded")
        await asyncio.sleep(8)
        await h.inject(page)
        print("describe:", await h.mgr.evaluate("""async () => { const t=(await chrome.tabs.query({})).find(t=>t.url&&t.url.includes('girlsreleased')); return await new Promise(r=>chrome.tabs.sendMessage(t.id,{t:'describe'},r)); }"""))
        r = await h.start_on(page, {"photos": True, "videos": False, "storyreel": False})
        print("start", r)
        st = await h.wait_done(300)
        j = st["jobs"][0]
        print({k: j[k] for k in ("status", "scanned", "total", "found", "downloaded", "skipped", "failed", "error", "note", "warn")})
        for l in j["log"][-25:]: print("  ", l[:220])
        files = await h.opfs_list(); print(len(files), files[:3])
asyncio.run(main())
