// Isolated-world bridge: relays what inject.js (page world) finds to the background worker,
// and passes the "auto-detect" setting into the page.
window.addEventListener('message', (e) => {
  if (e.source !== window || !e.data || e.data.__vsniffer !== 1) return;
  try {
    chrome.runtime.sendMessage({ type: 'found', items: e.data.items, main: e.data.main, youtube: e.data.youtube }).catch(() => {});
  } catch {}
});

// Background says the page changed without a reload (single-page app).
chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'reset') window.postMessage({ __vsniffer_cfg: 2 }, '*');
});

const sendCfg = (probe) => window.postMessage({ __vsniffer_cfg: 1, probe }, '*');
try {
  chrome.storage.local.get({ probe: true }).then((o) => sendCfg(o.probe));
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === 'local' && c.probe) sendCfg(c.probe.newValue !== false);
  });
} catch {}
