// Custom host rules (⚙ in the progress window): add through the UI, validation, kept across a host-file import, remove.
// Run: node tests/test_ih_custom.mjs   (needs Playwright + Chromium)
import { createRequire } from 'module';
import path from 'path'; import os from 'os'; import fs from 'fs'; import { fileURLToPath } from 'url';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const ext = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../extension');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'snd-'));
const ctx = await chromium.launchPersistentContext(dir, { channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let [sw] = ctx.serviceWorkers(); if (!sw) sw = await ctx.waitForEvent('serviceworker');
const id = new URL(sw.url()).host;
const page = await ctx.newPage();
await page.goto(`chrome-extension://${id}/ui/manager.html`);
await page.waitForTimeout(800);
const state = () => page.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ t: 'state' }, r)));
const before = (await state()).ihCount;
await page.click('#gear'); await page.click('#ihc summary');
const add = async (v) => { for (const [k, x] of Object.entries(v)) await page.fill('#ihc_' + k, x); await page.click('#ihc_add'); await page.waitForTimeout(300); return page.textContent('#ihc_msg'); };
const check = (c, m) => { if (!c) { console.log('FAIL', m); process.exitCode = 1; } else console.log('ok  ', m); };
check(/valid regular expression/.test(await add({ id: 'bad.example', url: '([', sp: 'LINK2FILE', test: '' })), 'invalid regex rejected');
check(/does not match/.test(await add({ id: 'pics.example', url: '^https?://pics\\.example/v/\\d+', sp: 'ID: big', test: 'https://other.example/v/1' })), 'test link mismatch rejected');
check(/must look like/.test(await add({ id: 'pics.example', url: '^https?://pics\\.example/v/\\d+', sp: 'function broken', test: '' })), 'malformed function rejected');
check(/Rule added/.test(await add({ id: 'pics.example', url: '^https?://pics\\.example/v/\\d+', sp: 'ID: big', test: 'https://pics.example/v/42' })), 'valid rule added');
check((await page.locator('#ihc_list .ihr').count()) === 1, 'rule listed in the UI');
check((await state()).ihCount === before + 1, `host count ${before} -> +1`);
const stored = await page.evaluate(() => chrome.storage.local.get('ihCustom'));
check(stored.ihCustom?.[0]?.id === 'pics.example' && stored.ihCustom[0].sp === 'ID: big', 'rule stored in chrome.storage.local.ihCustom');
// importing a new host file keeps the custom rule
const imp = await page.evaluate(() => new Promise(r => chrome.runtime.sendMessage({ t: 'ih:import', text: '<root><host id="a.example"><urlpattern>^https://a\\.example/</urlpattern><searchpattern>LINK2FILE</searchpattern></host></root>' }, r)));
check(imp.count === 1 && (await state()).ihCount === 2, 'import of a 1-host file -> 1 + 1 custom = 2 hosts');
await page.reload(); await page.waitForTimeout(500); await page.click('#gear'); await page.click('#ihc summary'); await page.waitForTimeout(300);
check((await page.locator('#ihc_list .ihr').count()) === 1, 'custom rule still there after import + reload');
await page.click('#ihc_list button'); await page.waitForTimeout(300);
check((await page.locator('#ihc_list .ihr').count()) === 0 && (await state()).ihCount === 1, 'rule removed');
await ctx.close();
