// Klik na Ice ikonu (ili Alt+I) otvara/zatvara Ice panel
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

// Ugrađene funkcije se ne prikazuju kao ekstenzije: Chromiumova stranica ekstenzija se zamjenjuje
// Iceovim pregledom funkcija (chrome://extensions/shortcuts ostaje, treba za prečice)
const PANEL = chrome.runtime.getURL('panel.html#page=features');
chrome.tabs.onUpdated.addListener((id, change, tab) => {
  const u = change.url || tab.pendingUrl;
  if (u && /^chrome:\/\/extensions\/?(\?.*)?(#.*)?$/.test(u)) chrome.tabs.update(id, { url: PANEL }).catch(() => {});
});
