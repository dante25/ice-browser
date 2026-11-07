import asyncio, sys, os, time
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness
import mock_sites

def cdn(prefix):
    return [p for m, p in mock_sites.STATE["log"] if p.startswith("/cdn/" + prefix)]

async def run(opts, block_after=0, speed="fast"):
    async with Harness() as h:
        await h.settings(cooldownMin=0.05)
        h.srv.H.fb_block_after = block_after
        h.srv.H.enrich_calls = 0
        mock_sites.STATE["log"].clear()
        page = await h.ctx.new_page()
        await page.goto("https://www.facebook.com/media/set/?set=a.1")
        await asyncio.sleep(2)
        tab = await h.mgr.evaluate("async () => (await chrome.tabs.query({})).find(t => t.url.includes('facebook.com/media')).id")
        r = await h.mgr.evaluate("([id, m]) => new Promise(r => chrome.tabs.sendMessage(id, m, r))", [tab, {"t": "start", "sel": {"photos": True, "videos": False, "storyreel": False}, "speed": speed, "opts": opts}])
        assert r.get("ok"), r
        st = await h.wait_done(240)
        return st, h.srv.H.enrich_calls

async def main():
    st, calls = await run({"fullSize": True}, block_after=3)
    j = st["jobs"][0]
    big, small = cdn("fbbig_"), cdn("fbs_")
    print("blocked mid-way:", j["status"], j["downloaded"], "| enrich calls", calls, "| full-size files", len(big), "| grid-size files", len(small), "| block level", st["block"]["fb"]["level"])
    assert j["status"] == "done" and j["downloaded"] == 8 and len(big) == 8 and not small and st["block"]["fb"]["level"] == 1, (j, big, small)
    st, calls = await run({"fullSize": False})
    j = st["jobs"][0]
    print("full size off:", j["status"], j["downloaded"], "| enrich calls", calls)
    assert j["status"] == "done" and j["downloaded"] == 8 and calls == 0, j
    st, calls = await run({"fullSize": True}, speed="quiet")
    j = st["jobs"][0]
    print("quiet mode:", j["status"], j["downloaded"], "| enrich calls", calls)
    assert j["status"] == "done" and j["downloaded"] == 8 and calls == 0, j
    print("OK fb block handling")
asyncio.run(main())
