/* Ultimate SN Downloader — the little button on single videos (Instagram posts / reels / stories, Facebook videos / reels / stories).
   Shows while the mouse is over a <video>; one click downloads just that video with the saved options. No popup, no overlay window. */
(function () {
  var btn = null, current = null, hideTimer = 0, lastMove = 0;

  function site() { for (var k in USD.sites) if (USD.sites[k].match() && USD.sites[k].videoTarget) return { id: k, s: USD.sites[k] }; return null; }

  function ensure() {
    if (btn) return btn;
    btn = document.createElement('div');
    btn.id = 'usn-quick';
    btn.title = 'Download this video (Ultimate SN Downloader)';
    btn.textContent = '⬇';
    btn.style.cssText = 'position:fixed;z-index:2147483647;display:none;width:34px;height:34px;border-radius:50%;background:#2f7cf6;color:#fff;font:700 18px/34px system-ui,sans-serif;text-align:center;cursor:pointer;box-shadow:0 2px 8px rgba(0,0,0,.45);user-select:none;';
    btn.addEventListener('mouseenter', function () { clearTimeout(hideTimer); });
    btn.addEventListener('mouseleave', hideSoon);
    btn.addEventListener('click', async function (e) {
      e.preventDefault(); e.stopPropagation();
      var st = site(); if (!st || !current) return;
      var target = st.s.videoTarget(current);
      if (!target) { flash('✕', 'Open the video, reel or story itself first'); return; }
      flash('…', 'Starting');
      var r = await new Promise(function (res) { try { chrome.runtime.sendMessage({ t: 'quick:start', site: st.id, target: target }, function (x) { res(chrome.runtime.lastError ? null : x); }); } catch (err) { res(null); } });
      if (!r || r.error) flash('✕', (r && r.error) || 'The extension did not answer - reload the page');
      else flash('✓', r.pending ? 'Choose the download folder first' : 'Download started');
    }, true);
    document.documentElement.appendChild(btn);
    return btn;
  }
  function flash(sym, title) { if (!btn) return; btn.textContent = sym; btn.title = title; setTimeout(function () { if (btn) { btn.textContent = '⬇'; btn.title = 'Download this video (Ultimate SN Downloader)'; } }, 2200); }
  function hideSoon() { clearTimeout(hideTimer); hideTimer = setTimeout(function () { if (btn) btn.style.display = 'none'; current = null; }, 700); }

  function videoAt(x, y) {
    var els = document.elementsFromPoint ? document.elementsFromPoint(x, y) : [];
    for (var i = 0; i < els.length; i++) if (els[i].tagName === 'VIDEO') return els[i];
    return null;
  }

  document.addEventListener('mousemove', function (e) {
    var now = Date.now();
    if (now - lastMove < 120) return;
    lastMove = now;
    if (!site()) return;
    var v = videoAt(e.clientX, e.clientY);
    if (!v) { if (current) hideSoon(); return; }
    clearTimeout(hideTimer);
    current = v;
    var r = v.getBoundingClientRect();
    if (r.width < 120 || r.height < 90) return;
    var b = ensure();
    b.style.left = Math.max(4, Math.min(window.innerWidth - 40, r.right - 44)) + 'px';
    b.style.top = Math.max(4, r.top + 10) + 'px';
    b.style.display = 'block';
  }, true);
})();
