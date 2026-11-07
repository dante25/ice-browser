// Ice: pregled slika na Google Images.
// Klik na sličicu: Google sam otvori svoj panel s većom slikom; Ice nađe tu sliku (ili originalnu
// adresu iz "imgres" linka) i prikaže je preko cijele stranice. Strelice/tipke ←/→ listaju dalje
// tako što "kliknu" sljedeću sličicu u Googleovoj mreži. Ne zavisi od Googleovih internih imena.
(() => {
  const isImageSearch = () => {
    const q = new URLSearchParams(location.search);
    return q.get('udm') === '2' || q.get('tbm') === 'isch' || location.hostname.startsWith('images.') || document.documentElement.dataset.iceTestGrid === '1';
  };
  if (window.__iceViewer) return;
  window.__iceViewer = true;

  const THUMB = (img) => {
    const s = img.currentSrc || img.src || '';
    return (s.startsWith('data:image') || /encrypted-tbn\d*\.gstatic\.com/.test(s) || img.dataset.iceThumb === '1') && img.width >= 50 && img.height >= 50;
  };
  const thumbs = () => [...document.querySelectorAll('img')].filter((i) => THUMB(i) && !i.closest('#ice-viewer') && i.offsetParent !== null);
  const clickable = (img) => img.closest('a, [role="button"], [jsaction], [data-docid], div[tabindex]') || img;

  // ---------- Prikaz ----------
  const root = document.createElement('div');
  root.id = 'ice-viewer';
  root.hidden = true;
  root.innerHTML = `
    <div class="ice-wrap">
      <div class="ice-left ice-stage"><img class="ice-main" alt=""><div class="ice-size"></div></div>
      <div class="ice-right">
        <div class="ice-title"></div>
        <div class="ice-domain"></div>
        <div class="ice-actions">
          <a class="ice-btn ice-open-page" target="_blank" rel="noopener noreferrer">Posjeti</a>
          <a class="ice-btn ice-open-img" target="_blank" rel="noopener noreferrer">Prikaži sliku</a>
        </div>
        <div class="ice-count"></div>
      </div>
    </div>
    <button class="ice-close" title="Zatvori (Esc)" aria-label="Zatvori"></button>
    <button class="ice-nav ice-prev" title="Prethodna (←)">‹</button>
    <button class="ice-nav ice-next" title="Sljedeća (→)">›</button>`;
  const $ = (s) => root.querySelector(s);
  const main = $('.ice-main');
  document.documentElement.appendChild(root);

  let index = -1;
  let token = 0;

  function show(thumb) {
    const list = thumbs();
    index = list.indexOf(thumb);
    root.hidden = false;
    main.src = thumb.currentSrc || thumb.src;
    main.classList.add('ice-loading');
    $('.ice-count').textContent = index >= 0 ? `${index + 1} / ${list.length}` : '';
    $('.ice-size').textContent = '';
    $('.ice-title').textContent = thumb.alt || '';
    $('.ice-domain').textContent = '';
    $('.ice-open-img').removeAttribute('href');
    $('.ice-open-page').removeAttribute('href');
    const my = ++token;
    findFull(thumb).then((r) => {
      if (my !== token || !r) return;
      const big = new Image();
      big.onload = () => {
        if (my !== token) return;
        main.src = r.img;
        main.classList.remove('ice-loading');
        $('.ice-size').textContent = `${big.naturalWidth} × ${big.naturalHeight} · Slike mogu biti zaštićene autorskim pravima.`;
      };
      big.onerror = () => { if (my === token) main.classList.remove('ice-loading'); };
      big.src = r.img;
      $('.ice-open-img').href = r.img;
      if (r.page) {
        $('.ice-open-page').href = r.page;
        try { $('.ice-domain').textContent = new URL(r.page).hostname.replace(/^www\./, ''); } catch { /* bez domene */ }
      }
    });
  }

  function close() { root.hidden = true; token++; }

  function step(dir) {
    const list = thumbs();
    if (!list.length) return;
    const next = list[(Math.max(index, 0) + dir + list.length) % list.length];
    next.scrollIntoView({ block: 'center' });
    openFrom(next);
  }

  // ---------- Pronalaženje velike slike ----------
  // 1) "imgres?imgurl=" link (Google ga stavlja na sličicu ili u panel); 2) najveća prava slika u panelu
  const fromImgres = (scope) => {
    for (const a of scope.querySelectorAll('a[href*="imgurl="]')) {
      try {
        const u = new URL(a.href, location.href);
        const img = u.searchParams.get('imgurl');
        if (img) return { img, page: u.searchParams.get('imgrefurl') || '' };
      } catch { /* dalje */ }
    }
    return null;
  };
  const isFull = (i) => {
    const s = i.currentSrc || i.src || '';
    return /^https?:/.test(s) && !/gstatic\.com|google\.[a-z.]+\/(images|logos)|googleusercontent\.com\/.*=s\d{2}/.test(s) &&
      !THUMB(i) && !i.closest('#ice-viewer') && i.offsetParent !== null && i.width >= 150;
  };
  const before = new WeakMap();

  function findFull(thumb) {
    const tile = clickable(thumb);
    const quick = fromImgres(tile) || fromImgres(tile.parentElement || tile);
    if (quick) return Promise.resolve(quick);
    return new Promise((resolve) => {
      const t0 = Date.now();
      const tick = () => {
        const linked = fromImgres(document);
        const cand = [...document.images].filter(isFull).sort((a, b) => b.width * b.height - a.width * a.height)[0];
        if (cand && before.get(cand) !== (cand.currentSrc || cand.src)) {
          const page = cand.closest('a[href^="http"]')?.href || linked?.page || '';
          return resolve({ img: cand.currentSrc || cand.src, page });
        }
        if (linked) return resolve(linked);
        if (Date.now() - t0 > 4000) return resolve(null);
        setTimeout(tick, 120);
      };
      tick();
    });
  }

  function openFrom(thumb) {
    for (const i of document.images) before.set(i, i.currentSrc || i.src); // da prepoznamo NOVU veliku sliku
    show(thumb);
    const el = clickable(thumb);
    window.__iceViewerInternalClick = true;
    el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    el.click();
    window.__iceViewerInternalClick = false;
  }

  // ---------- Događaji ----------
  document.addEventListener('click', (e) => {
    if (window.__iceViewerInternalClick || !isImageSearch()) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return; // Ctrl+klik i sl. ostaju Googleovi
    const img = e.target.closest('img') || e.target.closest('a, [role="button"], [jsaction], div[tabindex]')?.querySelector('img');
    if (!img || !THUMB(img) || root.contains(img)) return;
    for (const i of document.images) before.set(i, i.currentSrc || i.src);
    show(img); // Googleov klik ide dalje (otvara njegov panel), mi samo čitamo rezultat
  }, true);

  $('.ice-close').onclick = close;
  $('.ice-prev').onclick = () => step(-1);
  $('.ice-next').onclick = () => step(1);
  root.addEventListener('click', (e) => { if (e.target === root || e.target.classList.contains('ice-wrap') || e.target.classList.contains('ice-stage')) close(); });
  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowRight') { step(1); e.preventDefault(); e.stopPropagation(); }
    else if (e.key === 'ArrowLeft') { step(-1); e.preventDefault(); e.stopPropagation(); }
  }, true);
  // Kotačić miša (i lijevo/desno na touchpadu) lista slike
  let wheelLock = 0;
  root.addEventListener('wheel', (e) => {
    e.preventDefault();
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (Math.abs(d) < 15 || Date.now() < wheelLock) return;
    wheelLock = Date.now() + 350;
    step(d > 0 ? 1 : -1);
  }, { passive: false });
  // Prevlačenje prstom
  let sx = null;
  root.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; }, { passive: true });
  root.addEventListener('touchend', (e) => {
    if (sx === null) return;
    const dx = e.changedTouches[0].clientX - sx;
    sx = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  });
})();
