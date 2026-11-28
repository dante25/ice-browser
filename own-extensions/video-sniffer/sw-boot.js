// Starts the background part. If it crashes while loading (a syntax error, an API this browser lacks...) the
// extension would silently have no background at all; here the error is kept and handed to the popup instead.
try {
  importScripts('background.js');
} catch (e) {
  const err = String((e && e.stack) || e);
  chrome.runtime.onMessage.addListener((_m, _s, reply) => {
    reply({ v: chrome.runtime.getManifest().version, error: err });
  });
}
