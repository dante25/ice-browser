'use strict';

const toast = document.getElementById('toast');

const init = () => chrome.storage.local.get({
  'height': 3,
  'top': true,
  'embed': true,
  'hide': false,
  'chapters': false,
  'period': 2000,
  'padding': 12,
  'progress-color': '#ff0000'
}, prefs => {
  document.getElementById('height').value = prefs.height;
  document.getElementById('top').checked = prefs.top;
  document.getElementById('embed').checked = prefs.embed;
  document.getElementById('hide').checked = prefs.hide;
  document.getElementById('chapters').checked = prefs.chapters;
  document.getElementById('period').value = prefs.period / 1000;
  document.getElementById('padding').value = prefs.padding;
  document.getElementById('progress-color').value = prefs['progress-color'];
});
init();

document.getElementById('save').addEventListener('click', () => chrome.storage.local.set({
  'height': Math.max(1, Math.min(20, Number(document.getElementById('height').value))),
  'top': document.getElementById('top').checked,
  'embed': document.getElementById('embed').checked,
  'hide': document.getElementById('hide').checked,
  'chapters': document.getElementById('chapters').checked,
  'period': Math.max(0.5, Math.min(20, parseFloat(document.getElementById('period').value))) * 1000,
  'padding': Math.max(0, Math.min(100, Number(document.getElementById('padding').value))),
  'progress-color': document.getElementById('progress-color').value
}, () => {
  toast.textContent = 'Options saved!';
  setTimeout(() => toast.textContent = '', 750);
  init();
}));

// support
document.getElementById('support').addEventListener('click', () => chrome.tabs.create({
  url: chrome.runtime.getManifest().homepage_url + '&rd=donate'
}));
// reset
document.getElementById('reset').addEventListener('click', e => {
  if (e.detail === 1) {
    toast.textContent = 'Double-click to reset!';
    setTimeout(() => toast.textContent = '', 750);
  }
  else {
    localStorage.clear();
    chrome.storage.local.clear(() => {
      chrome.runtime.reload();
      window.close();
    });
  }
});

if (navigator.userAgent.includes('Firefox') === false) {
  document.getElementById('shortcut').setAttribute('href', '#');
  document.getElementById('shortcut').onclick = () => chrome.tabs.create({
    url: 'chrome://extensions/shortcuts'
  });
}

