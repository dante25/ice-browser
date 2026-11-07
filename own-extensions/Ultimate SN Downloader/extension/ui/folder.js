const $ = id => document.getElementById(id);
const sw = msg => new Promise(r => chrome.runtime.sendMessage(msg, r));
let fsm = null, root = null, pending = null;

async function pickAndSave() {
  const h = await showDirectoryPicker({ id: 'usn', mode: 'readwrite', startIn: 'downloads' });
  await fsm.setRoot(h);
  root = h;
}

// folder is ready -> start the download that was waiting, bring the user back to the page, close this window
async function finish() {
  await sw({ t: 'manager:open' });                    // keep a page of the extension open: Chrome ends the folder permission when the last one closes
  await sw({ t: 'folder:changed' });
  const st = await chrome.storage.session.get('pendingStart');
  pending = st.pendingStart;
  if (pending) {
    await chrome.storage.session.remove('pendingStart');
    try { await chrome.windows.update(pending.windowId, { focused: true }); await chrome.tabs.update(pending.tabId, { active: true }); } catch (e) {}
    await new Promise(res => chrome.tabs.sendMessage(pending.tabId, pending.msg, r => res(r)));
  }
  window.close();
}

async function onGo() {
  $('err').textContent = '';
  try {
    if (!root) await pickAndSave();
    const p = await fsm.permission(root, true);
    if (p !== 'granted') { $('err').textContent = 'Access to the folder was not allowed.'; return; }
    await finish();
  } catch (e) { if (e && e.name !== 'AbortError') $('err').textContent = String(e.message || e); }
}

async function init() {
  fsm = await import(chrome.runtime.getURL('background/fsstore.js'));
  root = await fsm.getRoot();
  if (root) {
    const p = await fsm.permission(root);
    if (p === 'granted') return finish();             // nothing to ask: just start
    $('h').textContent = 'Allow access to "' + root.name + '"';
    $('p').textContent = 'Chrome needs your OK once more to write into this folder. The download starts right after.';
    $('go').textContent = 'Allow';
    $('other').hidden = false;
  }
  $('go').onclick = onGo;
  $('other').onclick = async () => { try { await pickAndSave(); await onGo(); } catch (e) { if (e && e.name !== 'AbortError') $('err').textContent = String(e.message || e); } };
}
init();
