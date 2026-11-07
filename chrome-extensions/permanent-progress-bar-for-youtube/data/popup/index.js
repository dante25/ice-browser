'use strict';

const init = () => chrome.storage.local.get({
  'top': true,
  'embed': true,
  'hide': false
}, prefs => {
  document.getElementById('top').checked = prefs.top;
  document.getElementById('embed').checked = prefs.embed;
  document.getElementById('hide').checked = prefs.hide;
});
init();

for (const id of ['top', 'embed', 'hide']) {
  document.getElementById(id).addEventListener('change', e => chrome.storage.local.set({
    [id]: e.target.checked
  }));
}

document.getElementById('options').addEventListener('click', e => {
  e.preventDefault();
  chrome.runtime.openOptionsPage();
  window.close();
});

document.getElementById('youtube').addEventListener('click', () => {
  chrome.tabs.create({
    url: 'https://youtube.com/'
  });
  window.close();
});

document.getElementById('faqs').addEventListener('click', () => {
  chrome.tabs.create({
    url: chrome.runtime.getManifest().homepage_url
  });
  window.close();
});
