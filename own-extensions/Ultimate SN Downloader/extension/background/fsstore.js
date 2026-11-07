/* Download folder, the way both original extensions do it: the user picks a folder once (File System Access API), the handle is kept in
   IndexedDB and files are written straight into it - no Chrome download list, no download bubble. */
const open = () => new Promise((res, rej) => {
  const r = indexedDB.open('usn-fs', 1);
  r.onupgradeneeded = () => r.result.createObjectStore('h');
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

export async function getRoot() {
  try {
    const db = await open();
    return await new Promise(res => { const q = db.transaction('h').objectStore('h').get('root'); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); });
  } catch (e) { return null; }
}

export async function setRoot(handle) {
  const db = await open();
  await new Promise((res, rej) => { const q = db.transaction('h', 'readwrite').objectStore('h').put(handle, 'root'); q.onsuccess = res; q.onerror = () => rej(q.error); });
}

// 'granted' | 'prompt' | 'denied' | 'none'. request=true must come from a user gesture in a page.
export async function permission(handle, request = false) {
  if (!handle) return 'none';
  try {
    let p = await handle.queryPermission({ mode: 'readwrite' });
    if (p !== 'granted' && request) p = await handle.requestPermission({ mode: 'readwrite' });
    return p;
  } catch (e) { return 'denied'; }
}

async function uniqueName(dir, name) {
  const dot = name.lastIndexOf('.'), base = dot > 0 ? name.slice(0, dot) : name, ext = dot > 0 ? name.slice(dot) : '';
  for (let n = 0; n < 1000; n++) {
    const candidate = n ? `${base} (${n})${ext}` : name;
    try { await dir.getFileHandle(candidate); } catch (e) { return candidate; }
  }
  return `${base}_${Date.now()}${ext}`;
}

// relPath like "Instagram/bob/post/bob_2023_CODE_1.jpg"; `response` is a fetch Response. Returns the saved size and final path.
export async function writeFile(root, relPath, response) {
  const parts = relPath.split('/').filter(Boolean), file = parts.pop();
  let dir = root;
  for (const p of parts) dir = await dir.getDirectoryHandle(p, { create: true });
  const name = file;                                       // same name = same media: overwrite, never pile up "(1)" copies
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  try { await response.body.pipeTo(w); } catch (e) { try { await w.abort(); } catch (e2) {} try { await dir.removeEntry(name); } catch (e3) {} throw e; }
  const size = (await fh.getFile()).size;
  return { size, path: parts.concat(name).join('/') };
}

