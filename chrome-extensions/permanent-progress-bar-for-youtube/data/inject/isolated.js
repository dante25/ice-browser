/* global cloneInto */

let port;
try {
  port = document.getElementById('ypp-gbh7yt');
  port.remove();
}
catch (e) {
  port = document.createElement('span');
  port.id = 'ypp-gbh7yt';
  document.documentElement.append(port);
}

const observe = reason => {
  if (location.href.includes('/watch?') === false) {
    return;
  }
  const p = [...document.querySelectorAll('.html5-video-player')]
    .filter(a => a.offsetHeight)
    .sort((a, b) => b.offsetHeight - a.offsetHeight).shift();
  if (!p) {
    return;
  }
  const e = document.querySelector('.pprogg');
  if (e) {
    if (p && p.contains(e) === false) {
      p.appendChild(e);
    }
    chrome.storage.local.get({
      'period': 2000,
      'chapters': false
    }, prefs => port.dispatchEvent(new CustomEvent('observe', {
      detail: typeof cloneInto !== 'undefined' ? cloneInto(prefs, window) : prefs
    })));

    return;
  }
  if (p) {
    chrome.storage.local.get({
      'hide': false,
      'height': 3,
      'top': true,
      'embed': true,
      'period': 2000,
      'chapters': false,
      'padding': 12,
      'progress-color': '#fe0000',
      'parent-color': 'rgba(255, 255, 255, 0.2)',
      'loaded-color': 'rgba(255, 255, 255, 0.4)',
      'chapter-color': 'rgba(0, 0, 0, 0.5)'
    }, prefs => {
      if (
        (prefs.embed !== false && window.top !== window) ||
        (prefs.top !== false && window.top === window)
      ) {
        const parent = document.createElement('div');
        parent.classList.add('pprogg');
        parent.classList[prefs.hide ? 'add' : 'remove']('hidden');
        parent.style.setProperty('--height', prefs.height + 'px');
        parent.style.setProperty('--padding', prefs.padding + 'px');
        parent.style.setProperty('--parent-color', prefs['parent-color']);
        parent.style.setProperty('--progress-color', prefs['progress-color']);
        parent.style.setProperty('--loaded-color', prefs['loaded-color']);
        parent.style.setProperty('--chapter-color', prefs['chapter-color']);

        const el = document.createElement('div');
        el.dataset.type = 'loaded';
        parent.appendChild(el);
        const pl = document.createElement('div');
        pl.dataset.type = 'progress';
        parent.appendChild(pl);
        p.appendChild(parent);

        port.dispatchEvent(new CustomEvent('observe', {
          detail: typeof cloneInto !== 'undefined' ? cloneInto(prefs, window) : prefs
        }));
      }
    });
  }
};

addEventListener('yt-navigate-finish', () => { // top frame
  observe('navigation');
});
addEventListener('play', () => { // embedded YouTube
  observe('play');
}, true);

chrome.storage.onChanged.addListener(ps => {
  const parent = document.querySelector('.pprogg');

  // top / embed toggles: create or remove the bar in frames they apply to
  if (ps.top || ps.embed) {
    const top = window.top === window;
    chrome.storage.local.get({
      'top': true,
      'embed': true
    }, prefs => {
      const enabled = top ? prefs.top !== false : prefs.embed !== false;
      if (enabled && !document.querySelector('.pprogg')) {
        observe('storage');
      }
      else if (!enabled) {
        document.querySelector('.pprogg')?.remove();
      }
    });
  }

  if (!parent) {
    return;
  }

  if (ps.hide) {
    parent.classList[ps.hide.newValue ? 'add' : 'remove']('hidden');
  }
  if (ps.height) {
    parent.style.setProperty('--height', ps.height.newValue + 'px');
  }
  if (ps.padding) {
    parent.style.setProperty('--padding', ps.padding.newValue + 'px');
  }
  if (ps['parent-color']) {
    parent.style.setProperty('--parent-color', ps['parent-color'].newValue);
  }
  if (ps['progress-color']) {
    parent.style.setProperty('--progress-color', ps['progress-color'].newValue);
  }
  if (ps['loaded-color']) {
    parent.style.setProperty('--loaded-color', ps['loaded-color'].newValue);
  }
  if (ps['chapter-color']) {
    parent.style.setProperty('--chapter-color', ps['chapter-color'].newValue);
  }
});
