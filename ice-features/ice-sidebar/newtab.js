// Ice početna stranica: pretraga (zadani pretraživač) i najposjećenije stranice
const q = document.getElementById('q');
document.getElementById('f').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = q.value.trim();
  if (!v) return;
  const looksLikeUrl = /^[a-z]+:\/\//i.test(v) || (/^[^\s]+\.[a-z]{2,}(\/|:|$)/i.test(v) && !v.includes(' '));
  if (looksLikeUrl) location.href = /^[a-z]+:\/\//i.test(v) ? v : `https://${v}`;
  else chrome.search.query({ text: v, disposition: 'CURRENT_TAB' });
});

const fav = (url) => {
  const u = new URL(chrome.runtime.getURL('/_favicon/'));
  u.searchParams.set('pageUrl', url);
  u.searchParams.set('size', '64');
  return u.toString();
};

chrome.topSites.get((sites) => {
  const box = document.getElementById('tiles');
  for (const s of sites.slice(0, 8)) {
    const a = document.createElement('a');
    a.className = 'tile';
    a.href = s.url;
    a.title = s.url;
    const img = document.createElement('img');
    img.src = fav(s.url);
    img.alt = '';
    const t = document.createElement('span');
    t.textContent = s.title || new URL(s.url).hostname;
    a.append(img, t);
    box.append(a);
  }
});
