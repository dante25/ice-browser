/* Ultimate SN Downloader — Flickr scanner, the method of the installed "Flickr Metaligh Images Downloader":
   no API key, no download button needed - the page's own embedded data lists every size the viewer can show:
   "displayUrl":"//live.staticflickr.com/..._k.jpg","width":2048,"height":1365 . The LARGEST size by area is taken.
   Photo page: its own HTML. Photostream / album: the photo links of the page (scrolled like a person), each photo from the listing's data or its own page,
   then the next page. */
(function () {
  var FL = {};
  USD.sites.fl = FL;

  FL.match = function () { return location.hostname === 'www.flickr.com'; };

  FL.describe = function () {
    var p = location.pathname.split('/').filter(Boolean);
    var home = { site: 'fl', type: 'home', id: '', label: '' };
    if (p[0] !== 'photos' || !p[1]) return home;
    var alias = decodeURIComponent(p[1]);
    if ((p[2] === 'albums' || p[2] === 'sets') && p[3]) return { site: 'fl', type: 'album', id: p[3], user: alias, label: alias + ' · album ' + p[3] };
    if (/^\d+$/.test(p[2] || '')) return { site: 'fl', type: 'photo', id: p[2], user: alias, label: alias + ' · photo ' + p[2] };
    if (!p[2] || /^page\d+$/.test(p[2])) return { site: 'fl', type: 'photostream', id: alias, user: alias, label: alias + ' · photostream' };
    return home;
  };
  function samePage(url) { try { var a = new URL(url, location.origin); return a.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, ''); } catch (e) { return false; } }
  FL.samePage = samePage;
  FL.plan = function () { return [{ part: 'photos', url: location.pathname }]; };

  // ---- the installed extension's two patterns (displayUrl + width + height), skipping avatars; every photo id keeps its LARGEST size
  function sizesOf(html) {
    var found = [], seen = {}, res = [/"([a-z0-9]+)":\{"displayUrl":"([^"]+\.jpe?g[^"]*)","width":(\d+),"height":(\d+)/g, /"displayUrl":"([^"]+\.jpe?g[^"]*)","width":(\d+),"height":(\d+)/g];
    res.forEach(function (re, n) {
      var m;
      while ((m = re.exec(html)) !== null) {
        var url = (n ? m[1] : m[2]).replace(/\\\//g, '/'), w = Number(n ? m[2] : m[3]), h = Number(n ? m[3] : m[4]);
        if (url.indexOf('//') === 0) url = 'https:' + url;
        if (/buddyicons|default/.test(url) || seen[url]) continue;
        seen[url] = 1;
        found.push({ url: url, w: w, h: h });
      }
    });
    return found;
  }
  function largestById(html) {
    var best = {};
    sizesOf(html).forEach(function (s) {
      var m = s.url.match(/\/(\d{5,})_[0-9a-f]+/);
      if (!m) return;
      if (!best[m[1]] || s.w * s.h > best[m[1]].w * best[m[1]].h) best[m[1]] = s;
    });
    return best;
  }

  function item(id, alias, size) {
    return { site: 'fl', key: String(id), kind: 'photo', url: size.url, owner: alias, postId: String(id), code: String(id), ptype: 'photo', index: 0, takenAt: 0, caption: '', w: size.w, h: size.h };
  }

  async function pagePhoto(ctx, alias, id) {
    await ctx.gate('api');
    var r = await USD.rpc('fetch', { url: '/photos/' + encodeURIComponent(alias) + '/' + id + '/', method: 'GET', plain: true, headers: { accept: 'text/html' } });
    var short = (r.text || '').length < 3000 ? r.text : '';
    if (USD.looksBlocked(r.status, short)) { await ctx.blocked('Flickr ' + r.status); return null; }
    if (r.status !== 200) return null;
    var sizes = largestById(r.text || '');
    return sizes[id] || null;
  }

  FL.scanStep = async function (ctx, step) {
    var d = FL.describe(), total = 0;
    ctx.status(d.type === 'photo' ? 'Photo' : 'Photos');
    if (d.type === 'home') throw USD.Err('notfound', 'Open a Flickr photostream, album or photo first.');
    var html = String(await USD.rpc('html', { limit: 6000000 }) || '');
    if (d.type === 'photo') {
      var one = largestById(html)[d.id];
      if (!one) one = await pagePhoto(ctx, d.user, d.id);
      if (!one) throw USD.Err('notfound', 'No image sizes found on this page. Reload it once and try again.');
      ctx.scanned(1);
      return ctx.emit([item(d.id, d.user, one)], 'photos');
    }
    // photo ids of this page, in page order, after the page has been scrolled so that every thumbnail is on it
    var ids = [], seen = {}, idle = 0, lastCount = -1;
    function links() {
      var out = [];
      Array.prototype.forEach.call(document.querySelectorAll('a[href*="/photos/"]'), function (a) {
        var m = (a.getAttribute('href') || '').match(/\/photos\/[^\/]+\/(\d{5,})/);
        if (m && !seen[m[1]]) { seen[m[1]] = 1; out.push(m[1]); }
      });
      return out;
    }
    ids = links();
    while (idle < 3) {
      ctx.checkCancel();
      window.scrollBy(0, Math.max(700, window.innerHeight * 0.9));
      await ctx.gate('scroll');
      ids = ids.concat(links());
      if (ids.length === lastCount) idle++; else idle = 0;
      lastCount = ids.length;
    }
    ctx.total(ids.length);
    var listing = largestById(html), count = 0;
    ctx.log('flickr page: ' + ids.length + ' photo links, ' + Object.keys(listing).length + ' with sizes in the listing');
    for (var i = 0; i < ids.length; i++) {
      ctx.checkCancel();
      var id = ids[i], size = listing[id];
      if (!size) size = await pagePhoto(ctx, d.user, id);
      count++; ctx.scanned(count);
      if (size) total += ctx.emit([item(id, d.user, size)], 'photos');
    }
    // next page of the stream / album
    var next = document.querySelector('a[rel="next"]') || Array.prototype.filter.call(document.querySelectorAll('a[href]'), function (a) { return /^next$/i.test((a.textContent || '').trim()); })[0];
    var href = next && next.getAttribute('href');
    if (href && ids.length && !ctx.state.stopPaging) {
      var nu = new URL(href, location.origin);
      if (nu.pathname !== location.pathname) await ctx.navigate({ part: 'photos', url: nu.pathname + nu.search });
    }
    return total;
  };
})();
