// Uvoz iz drugog browsera, Android: bookmarks iz HTML fajla (standardni izvoz svih browsera).
// Na Androidu Ice ne može čitati podatke drugih aplikacija, zato uvoz ide preko fajla.
// Tekst iz fajla se uvijek postavlja kao tekst (nikad kao HTML).
const bm = document.getElementById('bm');
const bmNote = document.getElementById('bmNote');
const lastBox = document.getElementById('last');

function showLast() {
  try {
    const last = JSON.parse(localStorage.getItem('ice-uvoz-last') || 'null');
    if (!last) return;
    lastBox.hidden = false;
    const b = document.createElement('b');
    b.textContent = `Zadnji uvoz · ${new Date(last.when).toLocaleString()}`;
    const d = document.createElement('div');
    d.textContent = last.text;
    lastBox.replaceChildren(b, d);
  } catch (e) {}
}

// Netscape bookmark file: <DL><DT><H3>folder</H3><DL>...</DL><DT><A HREF=...>link</A></DL>
function parse(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const walk = (dl) => {
    const out = [];
    for (const dt of dl.children) {
      if (dt.tagName !== 'DT') continue;
      const a = dt.querySelector(':scope > a');
      const h3 = dt.querySelector(':scope > h3');
      if (a) {
        const url = a.getAttribute('href') || '';
        if (/^(https?|ftp|file|chrome|edge|about):/i.test(url)) out.push({ title: a.textContent.trim() || url, url });
      } else if (h3) {
        // the folder's list is inside the DT or right after it (browsers write both)
        let sub = dt.querySelector(':scope > dl');
        if (!sub && dt.nextElementSibling && dt.nextElementSibling.tagName === 'DL') sub = dt.nextElementSibling;
        out.push({ title: h3.textContent.trim() || 'Folder', children: sub ? walk(sub) : [] });
      }
    }
    return out;
  };
  const top = doc.querySelector('dl');
  return top ? walk(top) : [];
}

async function target() {
  const [root] = await chrome.bookmarks.getTree();
  const kids = root.children || [];
  // "Other bookmarks" (id 2) on desktop; on Android the first writable folder (mobile bookmarks)
  const parent = kids.find((n) => n.id === '2' && !n.unmodifiable) || kids.find((n) => !n.unmodifiable && !n.url) || kids[0];
  const d = new Date();
  return chrome.bookmarks.create({ parentId: parent.id, title: `Uvezeno ${d.toLocaleDateString()}` });
}

async function add(parentId, items, count) {
  for (const it of items) {
    if (it.children) {
      const f = await chrome.bookmarks.create({ parentId, title: it.title });
      count.folders++;
      await add(f.id, it.children, count);
    } else {
      await chrome.bookmarks.create({ parentId, title: it.title, url: it.url });
      count.links++;
    }
  }
}

bm.addEventListener('change', async () => {
  const file = bm.files && bm.files[0];
  if (!file) return;
  bmNote.classList.remove('err');
  bmNote.textContent = 'Uvozim…';
  try {
    const items = parse(await file.text());
    if (!items.length) throw new Error('u fajlu nema bookmarksa (treba HTML izvoz bookmarksa)');
    const count = { links: 0, folders: 0 };
    const folder = await target();
    await add(folder.id, items, count);
    const text = `Bookmarks: ${count.links} linkova, ${count.folders} foldera → "${folder.title}"`;
    bmNote.textContent = 'Gotovo. ' + text;
    try { localStorage.setItem('ice-uvoz-last', JSON.stringify({ when: Date.now(), text })); } catch (e) {}
    showLast();
  } catch (e) {
    bmNote.classList.add('err');
    bmNote.textContent = `Greška: ${e.message}`;
  }
  bm.value = '';
});

showLast();
