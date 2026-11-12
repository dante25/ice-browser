const $ = id => document.getElementById(id);
let tab = null, desc = null, folderOk = false;
const KEYS = ['photos', 'videos', 'storyreel'];

function sendTab(msg) { return new Promise(res => chrome.tabs.sendMessage(tab.id, msg, r => res(chrome.runtime.lastError ? null : r))); }
function sendSW(msg) { return new Promise(res => chrome.runtime.sendMessage(msg, r => res(r))); }

function syncAll() { $('all').checked = KEYS.every(k => $(k).checked || ($('srRow').hidden && k === 'storyreel')); validate(); }
function validate() { const keys = desc && (desc.site === 'ig' || desc.site === 'fb') ? KEYS : desc && desc.site === 'ih' ? ['photos'] : ['photos', 'videos']; $('start').disabled = !(desc && desc.type !== 'home' && keys.some(k => $(k).checked)); }

async function init() {
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const st = await sendSW({ t: 'state' });
  const s = (st && st.settings) || {};
  folderOk = !!(st && st.folder && st.folder.set && st.folder.permission === 'granted');
  KEYS.forEach(k => { $(k).checked = s[k] !== false; });
  $('speed').value = s.speed || 'normal';
  $('optFull').checked = s.optFull !== false;
  $('optMerge').checked = !!s.optMerge; $('optThumb').checked = !!s.optThumb;
  syncAll();
  const onSite = tab && !!siteOfUrl(tab.url);
  if (!onSite || !/^https?:/.test(tab.url || '')) { $('title').textContent = 'Open Instagram, Facebook, X, DeviantArt or Flickr'; $('sub').textContent = 'Go to a profile, album, group, post or reel, then click again.'; $('badge').textContent = '–'; return; }
  desc = await sendTab({ t: 'describe' });
  if (!desc && siteOfUrl(tab.url) === 'ih') {          // any other page: Image Host Grabber is put into it on demand
    try { await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/common.js', 'content/ih.js', 'content/bridge.js'] }); } catch (e) { /* page not allowed */ }
    desc = await sendTab({ t: 'describe' });
  }
  if (!desc) { $('title').textContent = 'Reload the page once'; $('sub').textContent = 'The extension was installed after this page was opened.'; $('badge').textContent = '!'; return; }
  $('badge').textContent = (SITES[desc.site] || {}).badge || '?'; $('badge').className = 'badge ' + desc.site;
  if (desc.type === 'home') { $('title').textContent = ({ ig: 'Open a profile, post or reel', fb: 'Open a profile, album, group, photo or video', x: 'Open a profile, its Media tab or a post', da: 'Open a gallery, folder or deviation', fl: 'Open a photostream, album or photo' })[desc.site] || 'Open a page to download from'; $('sub').textContent = 'Nothing to download on this page.'; validate(); return; }
  $('title').textContent = desc.label || desc.id;
  if (desc.site === 'ih') { $('sub').textContent = desc.note || (desc.links + ' links on this page'); }
  if (desc.site !== 'ih') $('sub').textContent = ({ profile: 'Profile', post: 'Single post', stories: 'Stories', highlight: 'Highlight', hashtag: 'Hashtag', location: 'Location', saved: 'Saved', photo: 'Photo', video: 'Video', album: 'Album', group: 'Group', gallery: 'Gallery', folder: 'Folder', deviation: 'Deviation', photostream: 'Photostream', album: 'Album', media: 'Media tab', status: 'Post' })[desc.type] || desc.type;
  $('vidOpts').hidden = desc.site !== 'ig'; $('fbOpts').hidden = desc.site !== 'fb';
  if (desc.site === 'ih') { $('videos').parentElement.hidden = true; $('all').parentElement.hidden = true; $('photos').checked = true; $('photos').parentElement.lastChild.textContent = ' Images (direct links, image-host pages, redirects)'; }
  if (desc.site === 'fb') $('srLabel').textContent = 'Reels';
  $('srRow').hidden = !(desc.site === 'ig' || desc.site === 'fb');     // stories / reels exist only on Instagram and Facebook
  $('opts').hidden = false;
  validate();
}

$('all').onchange = () => { KEYS.forEach(k => { $(k).checked = $('all').checked; }); validate(); };
KEYS.forEach(k => { $(k).onchange = syncAll; });
$('manager').onclick = async () => { await sendSW({ t: 'manager:open' }); window.close(); };
$('start').onclick = async () => {
  if (desc && desc.site === 'ih') {              // fetching other sites' pages needs access to them (asked once, here, on the click)
    const have = await chrome.permissions.contains({ origins: ['<all_urls>'] });
    if (!have && !(await chrome.permissions.request({ origins: ['<all_urls>'] }))) { $('msg').textContent = 'Access to other sites is needed to follow the links.'; $('msg').className = 'err'; return; }
  }
  const sel = desc && desc.site === 'ih' ? { photos: true, videos: false, storyreel: false } : { photos: $('photos').checked, videos: $('videos').checked, storyreel: $('storyreel').checked };
  const opts = { merge: $('optMerge').checked, thumb: $('optThumb').checked };
  const settings = { ...sel, speed: $('speed').value, optMerge: opts.merge, optThumb: opts.thumb, optFull: $('optFull').checked };
  await sendSW({ t: 'settings:set', settings });
  const startMsg = { t: 'start', sel, speed: settings.speed, stopAtKnown: false, opts: !$('fbOpts').hidden ? { fullSize: $('optFull').checked } : ($('vidOpts').hidden ? {} : opts) };
  if (!folderOk) {        // no folder yet (or Chrome wants a fresh OK): ask for it in its own window, which starts this download afterwards
    await chrome.storage.session.set({ pendingStart: { tabId: tab.id, windowId: tab.windowId, msg: startMsg } });
    await sendSW({ t: 'folder:window' });
    window.close(); return;
  }
  $('start').disabled = true; $('msg').textContent = 'Starting…'; $('msg').className = 'muted';
  const r = await sendTab(startMsg);
  if (!r || r.error) { $('msg').textContent = (r && r.error) || 'The page did not answer. Reload it and try again.'; $('msg').className = 'err'; validate(); return; }
  window.close();
};
init();
