/* Ultimate SN Downloader — Facebook scanner (method of "My FB Photos": the page's own pagination query + cursor, then the full-size
   photo through CometPhotoRootContentQuery). doc_id snapshot below comes from the original extension's bundled configuration; the page's
   own module registry / recorded requests win when they are newer. */
(function () {
  var FB = {};
  USD.sites.fb = FB;

  var CFG = {
    CometPhotoRootContentQuery: { docId: '28348096281527746', vars: { feedbackSource: 65, feedLocation: 'COMET_MEDIA_VIEWER', privacySelectorRenderLocation: 'COMET_MEDIA_VIEWER',
      renderLocation: 'comet_media_viewer', useDefaultActor: false, isMediaset: true, nodeID: '', mediasetToken: '', focusCommentID: null,
      __relay_internal__pv__GHLShouldChangeSponsoredDataFieldNamerelayprovider: true, __relay_internal__pv__CometUFIShareActionMigrationrelayprovider: true,
      __relay_internal__pv__CometUFICommentAvatarStickerAnimatedImagerelayprovider: false, __relay_internal__pv__IsWorkUserrelayprovider: false,
      __relay_internal__pv__CometUFIReactionsEnableShortNamerelayprovider: false, __relay_internal__pv__CometImmersivePhotoCanUserDisable3DMotionrelayprovider: false } }
  };
  var ALLOWED = /(Photo|Album|Media|Video|Reel)/, FORBIDDEN = /(Mutation|Delete|Create|Edit|Save|Like|Comment|Reaction|Notification|Story|Feed|Chat)/;
  var BLOCK_PAGE = ['temporarily blocked', "you're temporarily blocked", 'you’re temporarily blocked', 'we limit how often', 'try again later', 'this feature is temporarily'];

  FB.samePage = samePage;
  FB.match = function () { return /(^|\.)facebook\.com$/.test(location.hostname); };

  FB.describe = function () {
    var u = new URL(location.href), q = u.searchParams, parts = u.pathname.split('/').filter(Boolean), path = u.pathname.toLowerCase();
    var out = function (type, id, label, extra) { return Object.assign({ site: 'fb', type: type, id: id, label: label }, extra || {}); };
    if (!parts.length || (parts[0] === 'watch' && !q.get('v')) || ['home.php', 'marketplace', 'gaming', 'friends', 'notifications', 'messages', 'bookmarks'].indexOf(parts[0]) >= 0)
      return out('home', '', '');
    if (parts[0] === 'photo' || path === '/photo.php' || path === '/photo/') return out('photo', q.get('fbid') || '', 'Photo ' + (q.get('fbid') || ''), { set: q.get('set') || '' });
    if (parts[0] === 'watch' && q.get('v')) return out('video', q.get('v'), 'Video ' + q.get('v'));
    if (parts[0] === 'reel' && parts[1]) return out('video', parts[1], 'Reel ' + parts[1]);
    if (parts[0] === 'stories' && parts[1]) return out('story', parts[2] || parts[1], 'Story ' + (parts[2] || parts[1]), { bucket: parts[1] });
    var vi = parts.indexOf('videos');
    if (vi >= 0 && parts[vi + 1] && /^\d+$/.test(parts[vi + 1])) return out('video', parts[vi + 1], 'Video ' + parts[vi + 1]);
    if (parts[0] === 'media' && parts[1] === 'set' || (parts[0] === 'media' && q.get('set'))) return out('album', q.get('set') || '', 'Album', { set: q.get('set') || '' });
    if (parts[0] === 'groups' && parts[1]) return out('group', parts[1], 'Group ' + parts[1]);
    var base, name;
    if (path === '/profile.php') { name = q.get('id') || ''; base = '/profile.php?id=' + name; }
    else { name = parts[0]; base = '/' + parts[0]; }
    var tab = path === '/profile.php' ? (q.get('sk') || '') : (parts[1] || '');
    if (tab === 'albums' && parts[2]) return out('album', parts[2], 'Album', { set: parts[2] });
    return out('profile', name, name, { base: base, tab: tab });
  };

  function tabUrl(d, tab) {
    if (d.base.indexOf('?') >= 0) return d.base + '&sk=' + tab;
    return d.base + '/' + (tab === 'photos' ? 'photos' : tab);
  }

  // which pages to scan for the chosen groups; each step is {part, url, ptype}
  FB.plan = function (sel, target) {
    var d = FB.describe();
    if (target) return [{ part: target.type === 'story' ? 'stories' : 'videos', url: location.pathname + location.search, single: true, vid: String(target.id), kind: target.type }];
    if (d.type === 'profile') {
      var steps = [];
      if (sel.photos) steps.push({ part: 'photos', url: tabUrl(d, 'photos'), ptype: 'photo', owner: d.id });
      if (sel.videos) steps.push({ part: 'videos', url: tabUrl(d, 'videos'), ptype: 'video', owner: d.id });
      if (sel.storyreel) steps.push({ part: 'reels', url: tabUrl(d, 'reels'), ptype: 'reel', owner: d.id });
      // start with the step that is the page the user is already on
      var here = steps.findIndex(function (s) { return samePage(s.url); });
      if (here > 0) steps.unshift(steps.splice(here, 1)[0]);
      return steps;
    }
    if (d.type === 'story') return [{ part: 'stories', url: location.pathname + location.search, single: true, vid: d.id, kind: 'story' }];
    if (d.type === 'photo' || d.type === 'video') return [{ part: d.type === 'photo' ? 'photos' : 'videos', url: location.pathname + location.search, ptype: d.type, single: true, owner: '' }];
    return [{ part: d.type === 'group' ? 'photos' : 'photos', url: location.pathname + location.search, ptype: 'photo', owner: d.id, all: true }];
  };
  function samePage(url) {
    try { var a = new URL(url, location.origin); return a.pathname.replace(/\/$/, '') === location.pathname.replace(/\/$/, '') && (a.search === location.search || !a.search); } catch (e) { return false; }
  }

  // the video a <video> element on the page belongs to (for the hover button)
  FB.videoTarget = function (video) {
    var node = video, hit = null;
    for (var depth = 0; node && depth < 14 && !hit; depth++, node = node.parentElement) {
      var a = node.querySelector && node.querySelector('a[href*="/reel/"], a[href*="/videos/"], a[href*="/watch/?v="], a[href*="/watch?v="]');
      if (a) hit = a.getAttribute('href');
    }
    var h = hit || location.pathname + location.search;
    var m = h.match(/\/reel\/(\d+)/) || h.match(/\/videos\/(?:[^\/]+\/)?(\d+)/) || h.match(/[?&]v=(\d+)/);
    if (m) return { type: 'video', id: m[1] };
    var st = location.pathname.match(/\/stories\/[^\/]+\/(\d+)/);
    if (st) return { type: 'story', id: st[1] };
    return null;
  };

  // ---------------------------------------------------------------- one step
  async function pageText(ctx) {
    var t = String(await USD.rpc('text') || '').toLowerCase();
    if (BLOCK_PAGE.some(function (m) { return t.indexOf(m) >= 0; }) && t.indexOf('photos') < 0) await ctx.blocked('Facebook shows a block notice');
    if (/log in to facebook|log into facebook|create new account/.test(t) && t.indexOf('password') >= 0) throw USD.Err('login', 'Facebook shows the login page - log in first.');
  }

  function fbTemplate(tpls) {
    var best = null;
    tpls.forEach(function (t) {
      if (!ALLOWED.test(t.name) || FORBIDDEN.test(t.name) || /PhotoRoot|PhotoViewer|MediaViewer/.test(t.name)) return;
      if (t.vars.indexOf('cursor') < 0 && t.vars.indexOf('after') < 0) return;
      var rank = /Pagination|Grid|Collection|Album/.test(t.name) ? 0 : 1;
      if (!best || rank < best[0]) best = [rank, t.name];
    });
    return best && best[1];
  }

  async function collect(ctx, step, found) {
    var seenCaps = 0, idle = 0, cycles = 0, lastH = 0, triedCursor = false, tplName = null;
    var cursor = null, hasNext = false;
    function takeDoc(doc, text) {
      var before = Object.keys(found).length;
      USD.fbWalk(doc, step.owner, step.ptype === 'reel' ? 'reel' : step.ptype === 'video' ? 'video' : 'photo', found);
      var c = USD.fbConnection(doc);
      if (c) { cursor = c[0]; hasNext = c[1]; }
      return Object.keys(found).length - before;
    }
    function drain() {
      var gained = 0;
      for (; seenCaps < USD.captured.length; seenCaps++) {
        var c = USD.captured[seenCaps];
        if (c.text.length < 3000 && USD.looksBlocked(0, c.text)) { ctx.pendingBlock = c.text.slice(0, 160); continue; }
        USD.parsePayload(c.text).forEach(function (d) { gained += takeDoc(d, c.text); });
      }
      return gained;
    }
    async function dump() {
      var blobs = await USD.rpc('dump');
      (Array.isArray(blobs) ? blobs : []).forEach(function (t) {
        t = String(t || '').trim();
        if (!t || (t[0] !== '{' && t[0] !== '[')) return;
        try { takeDoc(JSON.parse(t), t); } catch (e) {}
      });
    }

    seenCaps = 0;
    await pageText(ctx); await dump(); drain();
    ctx.scanned(Object.keys(found).length);
    var maxIdle = 4;
    while (idle < maxIdle) {
      ctx.checkCancel();
      if (ctx.pendingBlock) { var why = ctx.pendingBlock; ctx.pendingBlock = null; await ctx.blocked(why); }
      var before = Object.keys(found).length;
      window.scrollBy(0, Math.max(700, window.innerHeight * 0.9));
      var h = document.documentElement.scrollHeight;
      await ctx.gate('scroll');
      drain();
      if (cycles % 6 === 0) await dump();
      if (cycles % 8 === 7) await pageText(ctx);
      cycles++;
      var gained = Object.keys(found).length - before;
      ctx.scanned(Object.keys(found).length);
      if (!triedCursor && cycles >= 1 && ctx.job.speed !== 'quiet') {
        tplName = fbTemplate(await USD.rpc('tpls'));
        if (tplName && cursor) { triedCursor = true; if (await cursorScan(ctx, step, found, tplName, cursor, hasNext)) return; }
      }
      if (gained === 0 && h === lastH) idle += 1; else if (gained === 0) idle += 0.5; else idle = 0;
      lastH = h;
    }
  }

  async function cursorScan(ctx, step, found, tplName, cursor, hasNext) {
    var errors = 0, ck = 'fb:' + step.part;
    if (ctx.resume[ck]) { cursor = ctx.resume[ck]; hasNext = true; ctx.log('continuing from the saved cursor'); }
    while (hasNext && cursor) {
      ctx.checkCancel();
      await ctx.gate('api');
      var r = await USD.rpc('replay', { needle: tplName, set: { $cursor: cursor } });
      var short = (r.text || '').length < 3000 ? r.text : '';
      if (USD.looksBlocked(r.status, short)) { await ctx.blocked('page query ' + r.status + ' ' + String(short).slice(0, 120)); continue; }
      if (r.status !== 200) { if (++errors >= 2) return false; continue; }
      var docs = USD.parsePayload(r.text), before = Object.keys(found).length, nxt = null;
      docs.forEach(function (d) {
        USD.fbWalk(d, step.owner, step.ptype === 'reel' ? 'reel' : step.ptype === 'video' ? 'video' : 'photo', found);
        var c = USD.fbConnection(d); if (c && (!nxt || c[2] > nxt[2])) nxt = c;
      });
      ctx.scanned(Object.keys(found).length);
      ctx.state.worked = true;
      if (!nxt) return true;
      if (nxt[0] === cursor) return false;
      cursor = nxt[0]; hasNext = nxt[1];
      if (hasNext && cursor) ctx.saveCursor(ck, cursor);
    }
    return true;
  }

  // ---------------------------------------------------------------- full size
  // Full-size version of one photo. A block answer is waited out and the SAME photo is asked again - never saved at grid quality instead.
  async function enrichPhoto(ctx, m, set) {
    var cfg = CFG.CometPhotoRootContentQuery;
    for (var attempt = 0; attempt < 3; attempt++) {
      ctx.checkCancel();
      await ctx.gate('api');
      var r = await USD.rpc('gql', { name: 'CometPhotoRootContentQuery', docId: cfg.docId, base: cfg.vars,
        vars: { nodeID: m.postId, mediasetToken: set || '', isMediaset: !!set } });
      var short = (r.text || '').length < 3000 ? r.text : '';
      if (USD.looksBlocked(r.status, short)) { await ctx.blocked('photo query ' + r.status + ' ' + String(short).slice(0, 100)); continue; }
      if (r.status !== 200) return m;
      var found = {};
      USD.parsePayload(r.text).forEach(function (d) { USD.fbWalk(d, m.owner, m.ptype, found); });
      var best = found[m.key];
      if (best && best.kind === 'photo') {
        best.owner = best.owner || m.owner; best.ptype = m.ptype; best.takenAt = best.takenAt || m.takenAt; best.caption = best.caption || m.caption;
        ctx.state.worked = true;
        return best;
      }
      return m;
    }
    return null;                                          // still blocked: leave it for Resume instead of saving a small copy
  }

  // ---- one video / reel / story: where Facebook keeps its address (the reel page's own data), tried in order:
  //      this page's replies and embedded JSON -> this page's HTML -> the video's own page (/reel/<id>, /watch/?v=<id>)
  var URL_KEYS = ['browser_native_hd_url', 'playable_url_quality_hd', 'hd_src', 'browser_native_sd_url', 'playable_url', 'sd_src'];
  function unescUrl(u) { try { return JSON.parse('"' + u + '"'); } catch (e) { return u.replace(/\\\//g, '/').replace(/\\u0025/g, '%').replace(/\\u0026/g, '&'); } }
  var FIELD_RE = /"(browser_native_hd_url|playable_url_quality_hd|hd_src_no_ratelimit|hd_src|browser_native_sd_url|playable_url|sd_src_no_ratelimit|sd_src|progressive_url)"\s*:\s*"(https?:[^"]+)"/g;
  var RANK = { browser_native_hd_url: 0, playable_url_quality_hd: 1, hd_src_no_ratelimit: 1.2, hd_src: 1.4, browser_native_sd_url: 3, playable_url: 4, sd_src_no_ratelimit: 4.5, sd_src: 5, progressive_url: 3.5 };

  // Every address Facebook has for video `id` inside parsed JSON: the node with that id and everything below it counts (progressive_urls, native, playable, DASH)
  function collectVideoUrls(root, id, out) {
    var stack = [{ o: root, hit: false }];
    while (stack.length) {
      var it = stack.pop(), o = it.o;
      if (!o || typeof o !== 'object') continue;
      if (Array.isArray(o)) { for (var i = 0; i < o.length; i++) stack.push({ o: o[i], hit: it.hit }); continue; }
      var hit = it.hit || String(o.id || '') === id || String(o.video_id || '') === id || String(o.videoId || '') === id || String(o.legacy_fbid || '') === id;
      if (hit) {
        Object.keys(RANK).forEach(function (k) {
          if (typeof o[k] === 'string' && /^https?:/.test(o[k])) {
            var rank = RANK[k];
            if (k === 'progressive_url' && o.metadata && /hd/i.test(String(o.metadata.quality || ''))) rank = 1.5;
            out.urls.push({ url: o[k], rank: rank });
          }
        });
        var dash = o.dash_manifest_xml_string || (typeof o.dash_manifest === 'string' && o.dash_manifest.indexOf('<MPD') >= 0 ? o.dash_manifest : '');
        if (dash && !out.dash) out.dash = dash;
      }
      for (var k2 in o) { var v = o[k2]; if (v && typeof v === 'object') stack.push({ o: v, hit: hit }); }
    }
  }
  function bestOf(out) {
    var urls = out.urls.slice().sort(function (a, b) { return a.rank - b.rank; });
    if (urls.length) return { url: urls[0].url };
    if (out.dash) { var d = USD.parseDash(out.dash); if (d && d.video && d.audio) return { url: d.video.url, dash: d, mergeAlways: true }; if (d && d.video) return { url: d.video.url }; }
    return null;
  }
  function urlFromText(text, id) {
    var best = null, bestRank = 99, m, all = {};
    FIELD_RE.lastIndex = 0;
    while ((m = FIELD_RE.exec(text)) !== null) {
      var near = !id || text.slice(Math.max(0, m.index - 6000), m.index + 6000).indexOf(id) >= 0;
      var rank = RANK[m[1]] + (near ? 0 : 10);
      all[m[2]] = 1;
      if (rank < bestRank) { bestRank = rank; best = m[2]; }
    }
    if (best && (bestRank < 10 || Object.keys(all).length === 1)) return unescUrl(best);
    return '';
  }
  function jsonBlobs(text) {
    var out = [], re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/g, m;
    while ((m = re.exec(text)) !== null) { try { out.push(JSON.parse(m[1])); } catch (e) { /* not json */ } }
    return out;
  }
  function stats(texts, docsN, id) {
    var t = texts.join(' '), c = 0, m; FIELD_RE.lastIndex = 0;
    while ((m = FIELD_RE.exec(t)) !== null) c++;
    return docsN + ' JSON blocks, ' + (t.split(id).length - 1) + ' mentions of the id, ' + c + ' video address fields';
  }

  async function findVideo(ctx, id, kind) {
    var base = { site: 'fb', key: id, kind: 'video', url: '', owner: '', postId: id, code: id, ptype: kind === 'story' ? 'story' : 'video', index: 0, takenAt: 0, caption: '', w: 0, h: 0 };
    var note = [];
    function fromDocs(docs) { var out = { urls: [], dash: '' }; docs.forEach(function (d) { collectVideoUrls(d, id, out); }); return bestOf(out); }
    // 1) what this page has already received / embeds
    var docs = [], texts = [];
    USD.captured.forEach(function (c) { texts.push(c.text); USD.parsePayload(c.text).forEach(function (d) { docs.push(d); }); });
    (await USD.rpc('dump') || []).forEach(function (t) { texts.push(t); try { docs.push(JSON.parse(t)); } catch (e) { /* not json */ } });
    var v = fromDocs(docs);
    if (v) return Object.assign(base, v);
    note.push('this page: ' + stats(texts, docs.length, id));
    // 2) this page's HTML
    var html = String(await USD.rpc('html', { limit: 8000000 }) || '');
    var u = urlFromText(html, id);
    if (u) return Object.assign(base, { url: u });
    // 3) the video's own page
    var pages = kind === 'story' ? [] : ['/reel/' + id + '/', '/watch/?v=' + id];
    for (var i = 0; i < pages.length; i++) {
      ctx.checkCancel();
      await ctx.gate('api');
      var r = await USD.rpc('fetch', { url: pages[i], method: 'GET', plain: true, headers: { accept: 'text/html' } });
      var short = (r.text || '').length < 3000 ? r.text : '';
      if (USD.looksBlocked(r.status, short)) { await ctx.blocked('Facebook ' + r.status); continue; }
      if (r.status !== 200) { note.push(pages[i] + ': HTTP ' + r.status); continue; }
      var t2 = r.text || '', blobs = jsonBlobs(t2);
      var pv = fromDocs(blobs);
      if (pv) return Object.assign(base, pv);
      var u2 = urlFromText(t2, id);
      if (u2) return Object.assign(base, { url: u2 });
      note.push(pages[i] + ': ' + stats([t2], blobs.length, id) + (/log in|log into|login/i.test(t2.slice(0, 20000)) && t2.length < 120000 ? ' (login page?)' : ''));
    }
    ctx.state.videoNote = note.join('; ');
    return null;
  }

  async function enrichVideo(ctx, m) {
    var v = await findVideo(ctx, m.postId, 'video');
    if (v && v.url) { m.url = v.url; m.kind = 'video'; }
    return m;
  }

  FB.scanStep = async function (ctx, step) {
    var d = FB.describe(), set = d.set || new URLSearchParams(location.search).get('set') || '', total = 0, found = {};
    var ptype = step.ptype === 'reel' ? 'reel' : step.ptype === 'video' ? 'video' : 'photo';
    if (step.single && (step.vid || d.type === 'video')) {
      var vid = step.vid || d.id;
      ctx.status(step.kind === 'story' ? 'Story' : 'Video');
      ctx.scanned(1);
      var v = await findVideo(ctx, vid, step.kind || d.type);
      if (!v || !v.url) throw USD.Err('notfound', 'No playable video address found for ' + vid + ' - Facebook did not put it in the page. Open the video itself and try again. [' + (ctx.state.videoNote || '') + ']');
      return ctx.emit([v], 'videos');
    }
    if (step.single) {
      var meta = await USD.rpc('meta');
      var base = { site: 'fb', key: d.id, kind: 'photo', url: (meta && meta.image) || '', owner: '', postId: d.id, code: d.id, ptype: 'photo', index: 0, takenAt: 0, caption: '', w: 0, h: 0 };
      ctx.scanned(1);
      var got = await enrichPhoto(ctx, base, set);
      if (!got || !got.url) throw USD.Err('notfound', 'No image found on this page.');
      return ctx.emit([got], 'photos');
    }
    ctx.status(step.part === 'photos' ? 'Photos' : step.part === 'videos' ? 'Videos' : 'Reels');
    await collect(ctx, step, found);
    var items = Object.keys(found).map(function (k) { return found[k]; });
    ctx.total(items.length);
    var fresh = await ctx.unseen(items);          // no full-size lookup for what is already on disk
    var freshSet = {}; fresh.forEach(function (k) { freshSet[k] = 1; });
    items = items.filter(function (m) { return freshSet[m.key]; });
    var skippedBlocked = 0;
    // grid items first in page order, then the full-size version of each
    for (var i = 0; i < items.length; i++) {
      ctx.checkCancel();
      var m = items[i];
      if (!ctx.wants(m.kind, step.part)) continue;
      if (m.kind === 'photo' && m.postId && (!m.w || m.w < 1000) && ctx.job.opts.fullSize !== false && ctx.job.speed !== 'quiet') {
        m = await enrichPhoto(ctx, m, set);
        if (!m) { skippedBlocked++; continue; }
      }
      else if (m.kind === 'video' && !m.url) m = await enrichVideo(ctx, m);
      if (!m.url) continue;
      total += ctx.emit([m], step.part);
    }
    if (skippedBlocked) ctx.warn(skippedBlocked + ' photo(s) left for Resume because Facebook kept limiting the requests');
    return total;
  };
})();
