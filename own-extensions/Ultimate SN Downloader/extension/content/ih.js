/* Ultimate SN Downloader — Image Host Grabber (page side). Collects every link of the page the way ImageHostGrabber does
   (document.links, javascript-wrapped urls, anonymizers removed, duplicates dropped) and hands them to the extension, which turns each link into an
   image with the host file (direct image links, image host pages, redirects). Injected on demand into pages that are not one of the known sites. */
(function () {
  var IH = {};
  USD.sites.ih = IH;

  IH.match = function () { return /^https?:$/.test(location.protocol); };

  function unanonymize(url) {
    var m = unescape(url).match(/^https?:\/\/.+(https?:\/\/.+)/);
    return m && !/^https?:\/\/[^/]*facebook\.com\//.test(url) ? m[1] : url;
  }

  function collect() {
    var links = [], seen = {};
    function scan(doc) {
      var as = doc.links || [];
      for (var i = 0; i < as.length; i++) {
        var a = as[i], url;
        var wrapped = (a.href || '').match(/javascript.+('|")(http.+?)\1/);
        url = wrapped ? wrapped[2] : a.href;
        if (!url) continue;
        url = unanonymize(url);
        if (!/^https?:\/\//i.test(url) || seen[url]) continue;
        seen[url] = 1;
        links.push({ url: url });
      }
      var frames = doc.querySelectorAll ? doc.querySelectorAll('iframe, frame') : [];
      for (var f = 0; f < frames.length; f++) { try { if (frames[f].contentDocument) scan(frames[f].contentDocument); } catch (e) { /* cross-origin frame */ } }
    }
    scan(document);
    return links;
  }

  // ImageFap shows a gallery 24 (normal view) or 100 (one-page view) pictures per page. Whatever page the user is on, walk the one-page-view pages
  // (page=0,1,2.. until one has no picture) and take the photo links from all of them, so the whole gallery is found without touching the url.
  function imagefapGallery() {
    if (!/(^|\.)imagefap\.com$/i.test(location.hostname)) return null;
    var m = location.pathname.match(/^\/pictures\/(\d+)/) || (location.pathname === '/gallery.php' && location.search.match(/[?&]gid=(\d+)/));
    return m ? m[1] : null;
  }
  async function imagefapLinks(gid, ctx) {
    var links = [], seen = {};
    for (var page = 0; page < 300; page++) {
      ctx.status('Reading gallery page ' + (page + 1) + ' (' + links.length + ' pictures)');
      var res = await fetch('/pictures/' + gid + '/?gid=' + gid + '&page=' + page + '&view=2', { credentials: 'include' });
      if (!res.ok) { if (page === 0) throw USD.Err('notfound', 'ImageFap gallery page answered ' + res.status + '.'); break; }
      var html = await res.text(), re = /href="(\/photo\/(\d+)\/[^"]*)"/g, m, fresh = 0;
      while ((m = re.exec(html)) !== null) {
        if (seen[m[2]]) continue;
        seen[m[2]] = 1; fresh++;
        links.push({ url: new URL(m[1].replace(/&amp;/g, '&'), location.href).href, id: m[2] });
      }
      if (!fresh) break;                                           // an empty page is the end of the gallery
      await new Promise(function (r) { setTimeout(r, 350 + Math.random() * 350); });
    }
    return links;
  }

  // A photo page lists the full-size links (<a imageid=".." original="..">) of the ~24 pictures around it, so one request covers a window of the gallery:
  // 393 pictures need about 17 requests instead of 393. ImageFap answers fast repeat requests with an empty page (HTTP 200, no picture, for minutes),
  // so requests are few and spaced, and that empty page is recognised and reported instead of being counted as "no image".
  async function imagefapResolve(photos, ctx) {
    var full = {}, out = [], requests = 0, blocked = false;
    for (var i = 0; i < photos.length; i++) {
      var id = photos[i].id;
      if (!full[id] && !blocked) {
        ctx.status('Reading ImageFap pictures (' + out.length + ' of ' + photos.length + ')');
        if (requests) await new Promise(function (r) { setTimeout(r, 1500 + Math.random() * 1500); });
        requests++;
        var res = await fetch(photos[i].url, { credentials: 'include' }), html = res.ok ? await res.text() : '';
        var tags = html.match(/<a\b[^>]*\bimageid\s*=\s*("|')\d+\1[^>]*>/ig) || [];
        tags.forEach(function (tag) {
          var iid = (tag.match(/\bimageid\s*=\s*("|')(\d+)\1/i) || [])[2], u = (tag.match(/\boriginal\s*=\s*("|')(.*?)\1/i) || [])[2];
          if (iid && u) full[iid] = new URL(u.replace(/&amp;/g, '&'), location.href).href;
        });
        if (!tags.length) blocked = true;                          // no picture list at all: ImageFap is limiting this browser
      }
      if (full[id]) out.push({ url: full[id] });
      else if (!blocked) out.push({ url: photos[i].url });         // not in its own window (unexpected): the host file rule takes it from its page
    }
    if (blocked) {
      if (!out.length) throw USD.Err('blocked', 'ImageFap is limiting requests from this browser (it answers with an empty page). Wait about 15-30 minutes and start again.');
      ctx.status('ImageFap started limiting requests: ' + out.length + ' of ' + photos.length + ' pictures were found - start again later for the rest.');
    }
    return out;
  }

  IH.describe = function () {
    var gid = imagefapGallery();
    return { site: 'ih', type: 'page', id: location.hostname, label: document.title || location.hostname, links: collect().length,
      note: gid ? 'ImageFap gallery - every page of the gallery is read' : '' };
  };

  IH.scan = async function (ctx) {
    ctx.status('Collecting links');
    var gid = imagefapGallery();
    var links = gid ? await imagefapResolve(await imagefapLinks(gid, ctx), ctx) : collect();
    if (!links.length) throw USD.Err('notfound', 'This page has no links to follow.');
    ctx.total(links.length);
    await ctx.send({ t: 'ih:links', links: links, page: { url: location.href, title: document.title } });
    return links.length;
  };
})();
