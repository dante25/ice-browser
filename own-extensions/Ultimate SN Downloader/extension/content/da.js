/* Ultimate SN Downloader — DeviantArt scanner. No OAuth, no API: the page itself carries its data (window.__INITIAL_STATE__ -> @@entities.deviation)
   and the gallery is paged with ?page=N. Every page is read from that embedded state (page 1 from the open page, the rest as normal page requests with
   your browser login). Image: the artist's download link when there is one, otherwise the largest full view; fallbacks are tried when a link is refused. */
(function () {
  var DA = {};
  USD.sites.da = DA;
  var RESERVED = ['', 'watch', 'topic', 'topics', 'search', 'tag', 'core-membership', 'settings', 'about', 'join', 'users', 'daily-deviations', 'popular', 'notifications', 'messages', 'groups', 'forum', 'shop', 'checkout', 'developers', 'team', 'status-updates'];

  DA.match = function () { return location.hostname === 'www.deviantart.com'; };

  DA.describe = function () {
    var p = location.pathname.split('/').filter(Boolean);
    var home = { site: 'da', type: 'home', id: '', label: '' };
    if (!p.length || RESERVED.indexOf(p[0].toLowerCase()) >= 0) return home;
    if (p[1] === 'art' && p[2]) { var m = p[2].match(/(\d+)$/); return { site: 'da', type: 'deviation', id: m ? m[1] : p[2], user: p[0], label: p[0] + ' · ' + p[2] }; }
    if (p[1] === 'gallery') return { site: 'da', type: p[2] ? 'folder' : 'gallery', id: p[0], user: p[0], label: p[0] + (p[2] ? ' · folder' : ' · gallery') };
    if (!p[1]) return { site: 'da', type: 'profile', id: p[0], user: p[0], label: p[0] + ' · gallery' };
    return home;
  };
  function samePage(url) { try { var a = new URL(url, location.origin); return a.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, ''); } catch (e) { return false; } }
  DA.samePage = samePage;
  DA.plan = function () {
    var d = DA.describe();
    if (d.type === 'deviation') return [{ part: 'art', url: location.pathname, single: true, deviation: d.id, owner: d.user }];
    if (d.type === 'profile') return [{ part: 'gallery', url: '/' + d.id + '/gallery', owner: d.id }];
    return [{ part: 'gallery', url: location.pathname, owner: d.user }];
  };

  // ---------------------------------------------------------------- the embedded state
  function unescapeJsString(lit) {                       // lit = the JS string literal, quotes included
    var s = lit.slice(1, -1), out = '';
    for (var i = 0; i < s.length; i++) {
      var c = s[i];
      if (c !== '\\') { out += c; continue; }
      var n = s[++i];
      if (n === 'n') out += '\n'; else if (n === 'r') out += '\r'; else if (n === 't') out += '\t'; else if (n === 'b') out += '\b'; else if (n === 'f') out += '\f';
      else if (n === '0') out += '\0'; else if (n === 'v') out += '\v';
      else if (n === 'u') { out += String.fromCharCode(parseInt(s.substr(i + 1, 4), 16)); i += 4; }
      else if (n === 'x') { out += String.fromCharCode(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else out += n;                                     // \" \\ \/ \'
    }
    return out;
  }
  function stateOf(html) {
    var m = html.match(/__INITIAL_STATE__\s*=\s*JSON\.parse\(("(?:[^"\\]|\\.)*")\)/);
    if (!m) return null;
    try { return JSON.parse(unescapeJsString(m[1])); } catch (e) { return null; }
  }

  function toMedia(dv, users, ownerName) {
    var media = dv.media || {};
    var author = (dv.author && typeof dv.author === 'object') ? dv.author.username : ((users[dv.author] || {}).username || '');
    var id = String(dv.deviationId);
    var meta = { site: 'da', key: id, owner: author || ownerName || '', postId: id, code: id, ptype: 'art', index: 0, caption: String(dv.title || '').slice(0, 300),
      takenAt: dv.publishedTime ? Math.floor(Date.parse(dv.publishedTime) / 1000) || 0 : 0 };
    if (dv.isVideo) {
      var best = null;
      ((media.types || []).filter(function (t) { return t.b; })).forEach(function (v) { if (!best || (v.h || 0) > (best.h || 0)) best = v; });
      return best ? Object.assign(meta, { kind: 'video', url: best.b, w: best.w || 0, h: best.h || 0, auth: true }) : null;
    }
    // candidates, best first. A token only opens the paths it was issued for, so the plain base URL is the last resort.
    var token = (media.token || [])[0], base = media.baseUri;
    var types = (media.types || []).filter(function (t) { return t.c && /^(fullview|preview)$/.test(t.t); }).sort(function (a, b) { return (b.t === 'fullview') - (a.t === 'fullview') || b.w * b.h - a.w * a.h; });
    var cands = [];
    if (dv.isDownloadable && dv.download && dv.download.url) cands.push({ url: dv.download.url, auth: true, w: dv.download.width || 0, h: dv.download.height || 0 });
    if (base && types[0]) cands.push({ url: base + types[0].c.replace('<prettyName>', media.prettyName || '') + (token ? '?token=' + token : ''), w: types[0].w || 0, h: types[0].h || 0 });
    if (base) cands.push({ url: base + (token ? '?token=' + token : ''), w: 0, h: 0 });
    if (!cands.length) return null;
    return Object.assign(meta, { kind: 'photo', url: cands[0].url, auth: !!cands[0].auth, w: cands[0].w, h: cands[0].h, alts: cands.slice(1) });
  }

  // every deviation of one page (gallery page, folder page or deviation page), in the order of the state
  function itemsOf(html, ownerName, only) {
    var st = stateOf(html);
    if (!st) return { ok: false, items: [] };
    var ent = (st['@@entities'] || {}), devs = ent.deviation || {}, users = ent.user || {}, out = [];
    Object.keys(devs).forEach(function (id) {
      var d = devs[id];
      if (!d || d.isDeleted || (only && String(d.deviationId) !== String(only))) return;
      var m = toMedia(d, users, ownerName);
      if (m) out.push(m);
    });
    return { ok: true, items: out };
  }

  // ---------------------------------------------------------------- scanning
  DA.scanStep = async function (ctx, step) {
    var total = 0, seen = {}, count = 0;
    ctx.status('Gallery');
    var text = String(await USD.rpc('text') || '').toLowerCase();
    if (/log in to deviantart|sign in to deviantart/.test(text) && /password/.test(text)) throw USD.Err('login', 'DeviantArt shows the login page - log in first.');
    var html = String(await USD.rpc('html', { limit: 8000000 }) || '');
    if (step.single) {
      var one = itemsOf(html, step.owner, step.deviation).items;
      if (!one.length) throw USD.Err('notfound', 'No image found on this page. Reload it once and try again.');
      ctx.scanned(1);
      return ctx.emit(one, 'art');
    }
    var cur = new URL(location.href), page = Number(cur.searchParams.get('page') || 1);
    var guard = 0;
    for (;;) {
      ctx.checkCancel();
      var r = itemsOf(html, step.owner);
      if (!r.ok) throw USD.Err('format', 'DeviantArt page ' + page + ' has no readable data (the layout may have changed).');
      var fresh = r.items.filter(function (m) { return !seen[m.key]; });
      fresh.forEach(function (m) { seen[m.key] = 1; });
      count += fresh.length; ctx.scanned(count);
      if (fresh.length) total += ctx.emit(fresh, 'art');
      ctx.saveCursor('da:' + step.part, page);
      if (!fresh.length || ++guard > 3000) break;
      // next page: a normal page request (your login), paced like a person turning pages
      page++;
      var u = new URL(cur.pathname, location.origin); u.searchParams.set('page', String(page));
      await ctx.gate('api');
      var resp = await USD.rpc('fetch', { url: u.pathname + u.search, method: 'GET', plain: true, headers: { accept: 'text/html' } });
      var short = (resp.text || '').length < 3000 ? resp.text : '';
      if (USD.looksBlocked(resp.status, short)) { await ctx.blocked('DeviantArt ' + resp.status + ' ' + String(short).slice(0, 100)); page--; continue; }
      if (resp.status === 404) break;
      if (resp.status !== 200) throw USD.Err('http', 'HTTP ' + resp.status + ' on ' + u.pathname + u.search);
      html = resp.text || '';
    }
    return total;
  };
})();
