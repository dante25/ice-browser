"""First use: Start with no folder chosen -> folder window -> one click -> the waiting download starts by itself and the window closes."""
import asyncio, sys, os
sys.path.insert(0, os.path.dirname(__file__))
from run_ext import Harness

async def main():
    async with Harness(folder=False) as h:
        await h.ctx.add_init_script("window.showDirectoryPicker = async () => navigator.storage.getDirectory();")   # the native picker cannot be driven; OPFS is the same API
        page = await h.ctx.new_page()
        await page.goto("https://www.instagram.com/bob/")
        await asyncio.sleep(2)
        info = await h.mgr.evaluate("""async () => { const t = (await chrome.tabs.query({})).find(t => t.url.includes('instagram.com/bob'));
            await chrome.storage.session.set({pendingStart: {tabId: t.id, windowId: t.windowId, msg: {t: 'start', sel: {photos: true, videos: true, storyreel: true}, speed: 'fast', opts: {}}}});
            return await new Promise(r => chrome.runtime.sendMessage({t: 'state'}, r)); }""")
        assert not info["folder"]["set"], info["folder"]
        fw = await h.ctx.new_page()
        await fw.goto("chrome-extension://%s/ui/folder.html" % h.ext_id)
        await fw.click("#go")
        st = await h.wait_done(150)
        j = st["jobs"][0]
        files = await h.opfs_list()
        print("job", j["status"], j["downloaded"], "files", len(files), "| folder window closed:", fw.is_closed())
        assert j["status"] == "done" and j["downloaded"] == len(files) == 37, j
        assert fw.is_closed()
        print("OK folder window starts the download")
asyncio.run(main())
