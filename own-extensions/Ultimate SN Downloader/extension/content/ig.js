/* Ultimate SN Downloader — Instagram scanner.
   Method of the two originals, merged:
   - 4K Stogram: profile -> numeric user id -> feed pages with a cursor, stories and highlights through reels_media
   - IG Media Downloader extension: the page's own GraphQL queries ("PolarisProfilePostsTabContentQuery_connection", doc_id from the
     page's module registry, `after` cursor); the first batch is taken from what the page has already loaded (zero extra requests). */
(function () {
  var IG = {};
  USD.sites.ig = IG;
  var RESERVED = ['', 'direct', 'accounts', 'explore', 'notifications', 'emails', 'about', 'legal', 'web', 'your_activity', 'reels', 'stories', 'p', 'reel', 'tv', 'challenge', 'privacy', 'session'];
  var STORYREEL = { reels: 1, stories: 1, highlights: 1 };

  IG.match = function () { return location.hostname === 'www.instagram.com'; };

  IG.describe = function () {
    var parts = location.pathname.split('/').filter(Boolean);
    var base = { site: 'ig', label: '', type: 'home', id: '' };
    if (!parts.length) return base;
    var i;
    if ((i = parts.findIndex(function (p) { return p === 'p' || p === 'reel' || p === 'tv'; })) >= 0 && parts[i + 1])
      return { site: 'ig', type: 'post', id: parts[i + 1], label: (parts[i] === 'reel' ? 'Reel ' : 'Post ') + parts[i + 1] };
    if (parts[0] === 'stories' && parts[1] === 'highlights' && parts[2]) return { site: 'ig', type: 'highlight', id: parts[2], label: 'Highlight ' + parts[2] };
    if (parts[0] === 'stories' && parts[1]) return { site: 'ig', type: 'stories', id: parts[1], only: parts[2] || '', label: '@' + parts[1] + ' · Stories' };
    if (parts[0] === 'explore' && parts[1] === 'tags' && parts[2]) return { site: 'ig', type: 'hashtag', id: decodeURIComponent(parts[2]), label: '#' + decodeURIComponent(parts[2]) };
    if (parts[0] === 'explore' && parts[1] === 'locations' && parts[2]) return { site: 'ig', type: 'location', id: parts[2], label: 'Location ' + parts[2] };
    if (RESERVED.indexOf(parts[0]) >= 0) return base;
    if (parts[1] === 'saved') return { site: 'ig', type: 'saved', id: parts[0], label: 'Saved posts' };
    return { site: 'ig', type: 'profile', id: parts[0], label: '@' + parts[0], tab: parts[1] || '' };
  };

  // ---------------------------------------------------------------- low level
  async function api(ctx, path, query) {
    await ctx.gate('api');
    var r = await USD.rpc('api', { path: path, query: query });
    return handle(ctx, r, path);
  }

  async function gqlCall(ctx, args) {
    await ctx.gate('api');
    var r = await USD.rpc('gql', Object.assign({ ig: true }, args));
    return handle(ctx, r, args.name);
  }

  async function handle(ctx, r, what) {
    var status = r.status, text = r.text || '';
    var short = text.length < 4000 ? text : '';
    if (status === 0) throw USD.Err('net', (r.error || 'request failed') + ' (' + what + ')');
    if (USD.looksBlocked(status, status === 200 ? '' : short) || (status === 200 && short && /"status":"fail"/.test(short) && USD.looksBlocked(0, short))) {
      if (!ctx.state.worked && !ctx.state.softUsed) {
        ctx.state.softUsed = true;           // the very first call of a session was refused: wait once and retry before calling it a ban
        ctx.log('first request refused (' + status + ') - one soft retry');
        await ctx.sleep(25000 + Math.random() * 20000);
        throw USD.Err('retry', 'soft');
      }
      await ctx.blocked('HTTP ' + status + ' ' + short.slice(0, 160));
      throw USD.Err('retry', 'after block');
    }
    if (status === 401 || /login_required/.test(short)) throw USD.Err('login', 'Instagram says you are not logged in.');
    if (status === 404) throw USD.Err('notfound', what);
    var detail = short ? ': ' + short.replace(/\s+/g, ' ').slice(0, 140) : '';
    if (status >= 500) {                                  // transient server error: wait a little and ask again (twice), then give up on this request
      ctx.state.err5 = (ctx.state.err5 || 0) + 1;
      if (ctx.state.err5 <= 2) { await ctx.sleep(2500 * ctx.state.err5 + Math.random() * 2000); throw USD.Err('retry', 'HTTP ' + status + ' on ' + what + detail); }
      throw USD.Err('http', 'HTTP ' + status + ' on ' + what + detail);
    }
    if (status >= 400) throw USD.Err('http', 'HTTP ' + status + ' on ' + what + detail);
    var docs = USD.parsePayload(text);
    if (!docs.length) throw USD.Err('format', 'unexpected reply to ' + what);
    ctx.state.worked = true;
    return docs[0];
  }

  // retries a request closure after a soft refusal or after a cooldown (the gate waits the cooldown out)
  async function retrying(ctx, fn) {
    var last = null;
    for (var attempt = 0; attempt < 4; attempt++) {
      try { var r = await fn(); ctx.state.err5 = 0; return r; }
      catch (e) { if (e.kind !== 'retry') throw e; last = e; }
    }
    if (last && /^HTTP 5/.test(last.message)) throw USD.Err('http', last.message);
    throw USD.Err('blocked', 'Instagram keeps refusing requests - stopped to protect your account.');
  }

  // a part that cannot be read (stories, highlights...) is reported and skipped; login problems, cancel and bans still stop the job
  async function optional(ctx, label, fn) {
    try { return await fn(); }
    catch (e) {
      if (['login', 'cancel', 'blocked'].indexOf(e.kind) >= 0) throw e;
      ctx.log(label + ' skipped: ' + e.message); ctx.warn(label + ' skipped (' + e.message + ')');
      return 0;
    }
  }

  // ---------------------------------------------------------------- profile id
  function capturedDocs(prefix) {
    var out = [];
    USD.captured.forEach(function (c) {
      if (prefix && c.text.indexOf(prefix) < 0) return;
      USD.parsePayload(c.text).forEach(function (d) { out.push({ doc: d, url: c.url }); });
    });
    return out;
  }

  async function resolveProfile(ctx, username) {
    var found = null;
    capturedDocs('').some(function (c) { var f = USD.igFindUser(c.doc, username); if (f) { found = f; return true; } return false; });
    var count = found && found.user ? Number(found.user.media_count || (found.user.edge_owner_to_timeline_media || {}).count || 0) : 0;
    if (found) return { id: found.id, name: found.user.username || username, count: count };
    var html = await USD.rpc('html', { limit: 3000000 });
    var uid = idFromHtml(html, username);
    if (uid) return { id: uid, name: username, count: 0 };
    // the profile page itself (one normal page request) carries the id in its embedded data
    await ctx.gate('api');
    var r = await USD.rpc('fetch', { url: '/' + encodeURIComponent(username) + '/', method: 'GET', headers: { accept: 'text/html' } });
    if (r.status === 200) { uid = idFromHtml(r.text || '', username); if (uid) return { id: uid, name: username, count: 0 }; }
    // REST fallbacks
    try {
      var d = await api(ctx, '/api/v1/users/web_profile_info/', { username: username });
      var u = d && ((d.data || {}).user || null);
      if (u && u.id) return { id: String(u.id), name: u.username || username, count: ((u.edge_owner_to_timeline_media || {}).count) || 0 };
    } catch (e) { if (e.kind === 'login' || e.kind === 'retry') throw e; }
    try {
      var s = await api(ctx, '/api/v1/web/search/topsearch/', { context: 'blended', query: username, include_reel: 'true' });
      var hit = ((s.users || []).map(function (x) { return x.user || {}; }).filter(function (u) { return String(u.username).toLowerCase() === username.toLowerCase(); }))[0];
      if (hit && (hit.pk || hit.pk_id)) return { id: String(hit.pk || hit.pk_id), name: hit.username, count: 0 };
    } catch (e2) { if (e2.kind === 'login' || e2.kind === 'retry') throw e2; }
    throw USD.Err('notfound', 'Could not find the profile @' + username + ' (not logged in, private, or the page layout changed).');
  }

  function idFromHtml(html, username) {
    var esc = username.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    var pats = [new RegExp('"profile_id":"(\\d+)"'), new RegExp('"id":"(\\d+)","username":"' + esc + '"', 'i'),
      new RegExp('"username":"' + esc + '"[^{}]{0,300}?"id":"(\\d+)"', 'i'), new RegExp('"user_id":"(\\d+)"'),
      new RegExp('"pk":"(\\d+)"[^{}]{0,200}"username":"' + esc + '"', 'i'), new RegExp('"target_id":"(\\d+)"')];
    for (var i = 0; i < pats.length; i++) { var m = html.match(pats[i]); if (m) return m[1]; }
    return '';
  }

  // ---------------------------------------------------------------- GraphQL feeds (what the extension does)
  var FEEDS = {
    posts: { name: 'PolarisProfilePostsTabContentQuery_connection', conn: 'xdt_api__v1__feed__user_timeline', needle: 'ProfilePosts', ptype: 'post',
      vars: function (u, after) { return { username: u.name, after: after, before: null, first: 12, last: null,
        data: { count: 12, include_reel_media_seen_timestamp: true, include_relationship_info: true, latest_besties_reel_media: true, latest_reel_media: true } }; } },
    reels: { name: 'PolarisProfileReelsTabContentQuery_connection', conn: 'xdt_api__v1__clips__user', needle: 'ProfileReels', ptype: 'reel',
      vars: function (u, after) { return { after: after, before: null, first: 12, last: null, data: { include_feed_video: true, page_size: 12, target_user_id: u.id } }; } },
    tagged: { name: 'PolarisProfileTaggedTabContentQuery_connection', conn: 'xdt_api__v1__usertags', needle: 'ProfileTagged', ptype: 'tagged',
      vars: function (u, after) { return { after: after, before: null, first: 12, last: null, user_id: u.id }; } }
  };

  async function graphFeed(ctx, part, user) {
    if (ctx.done[part]) return 0;
    var f = FEEDS[part], total = 0;
    var cursor = '', hasNext = false, got = false;
    if (ctx.resume[part]) {                               // continuing an interrupted run: start at the saved cursor, no need to read the beginning again
      cursor = ctx.resume[part]; hasNext = true; got = true;
      ctx.log(part + ': resuming from the saved cursor');
    } else {
      // 1) what the page already loaded for this feed: free first batch
      capturedDocs(f.conn).forEach(function (c) {
        var items = USD.igWalk(c.doc, f.ptype, user.name).filter(function (m) { return !m.owner || m.owner.toLowerCase() === user.name.toLowerCase() || part === 'tagged'; });
        if (!items.length) return;
        got = true;
        total += ctx.emit(items, part);
        var pi = USD.pageInfo(c.doc, 'xdt_api__');
        cursor = pi[1]; hasNext = pi[0];
      });
    }
    if (!got) {
      // 2) ask for the first batch ourselves, like the extension: doc_id from the page's module registry
      var doc = await retrying(ctx, function () { return gqlCall(ctx, { name: f.name, vars: f.vars(user, null) }); });
      var items0 = USD.igWalk(doc, f.ptype, user.name);
      var pi0 = USD.pageInfo(doc, 'xdt_api__');
      if (!items0.length && !pi0[0]) { if (doc && JSON.stringify(doc).indexOf('"errors"') >= 0) throw USD.Err('format', f.name + ' returned an error'); }
      total += ctx.emit(items0, part);
      cursor = pi0[1]; hasNext = pi0[0];
    }
    var guard = 0;
    while (hasNext && cursor && guard++ < 2000) {
      ctx.saveCursor(part, cursor);                       // survives a closed tab / browser restart
      ctx.checkCancel();
      var d = await retrying(ctx, function () { return gqlCall(ctx, { name: f.name, vars: f.vars(user, cursor) }); });
      var items = USD.igWalk(d, f.ptype, user.name);
      var pi = USD.pageInfo(d, 'xdt_api__');
      var added = ctx.emit(items, part);
      total += added;
      if (!items.length || pi[1] === cursor) break;
      hasNext = pi[0]; cursor = pi[1];
      if (ctx.stopAtKnown && items.length && added === 0) break;
    }
    ctx.partDone(part);
    return total;
  }

  // REST fallback (Stogram's feed/user/<id>/?max_id=) used only when the GraphQL path gives nothing
  async function restFeed(ctx, user) {
    var maxId = '', total = 0, guard = 0;
    while (guard++ < 2000) {
      ctx.checkCancel();
      var q = { count: 12 }; if (maxId) q.max_id = maxId;
      var d = await retrying(ctx, function () { return api(ctx, '/api/v1/feed/user/' + user.id + '/', q); });
      var items = USD.igWalk(d.items || d, 'post', user.name);
      total += ctx.emit(items, 'posts');
      maxId = d.next_max_id;
      if (!maxId || !d.more_available || !(d.items || []).length) break;
    }
    return total;
  }

  // ---------------------------------------------------------------- stories / highlights
  function reelItems(d, id) {
    var reels = d.reels || (d.data && d.data.reels) || {};
    var reel = reels[id] || Object.keys(reels).map(function (k) { return reels[k]; })[0] || (d.reels_media || [])[0] || {};
    return { items: reel.items || [], title: typeof reel.title === 'string' ? reel.title : '', user: (reel.user || {}).username || '' };
  }

  // /api/v1/feed/reels_media/ the way the site's own client calls it; if that is refused, the same call as a form POST
  async function reelsMedia(ctx, id) {
    ctx.state.err5 = 0;
    try { return await retrying(ctx, function () { return api(ctx, '/api/v1/feed/reels_media/', { reel_ids: [id] }); }); }
    catch (e) {
      if (e.kind !== 'http') throw e;
      ctx.log('reels_media GET failed (' + e.message + ') - trying POST');
      ctx.state.err5 = 0;
      return retrying(ctx, async function () {
        await ctx.gate('api');
        var r = await USD.rpc('fetch', { url: '/api/v1/feed/reels_media/', method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: 'reel_ids=' + encodeURIComponent(id) });
        return handle(ctx, r, '/api/v1/feed/reels_media/ (POST)');
      });
    }
  }

  async function stories(ctx, user, only) {
    if (ctx.done.stories && !only) return 0;
    var d = await reelsMedia(ctx, user.id);
    var r = reelItems(d, user.id);
    var media = USD.igWalk(r.items, 'story', user.name);
    if (only) media = media.filter(function (m) { return String(m.postId) === String(only); });       // the one story the button was pressed on
    var n = ctx.emit(media, 'stories');
    if (!only) ctx.partDone('stories');
    return n;
  }

  async function highlights(ctx, user, known) {
    var trays = known;
    if (!trays || !trays.length) {
      try {
        var d = await retrying(ctx, function () { return api(ctx, '/api/v1/highlights/' + user.id + '/highlights_tray/'); });
        trays = (d.tray || []).map(function (t) { return { id: t.id, title: typeof t.title === 'string' ? t.title : '' }; });
      } catch (e) { if (e.kind === 'login') throw e; trays = []; }
    }
    var total = 0, failed = 0, inRow = 0;
    for (var i = 0; i < trays.length; i++) {
      ctx.checkCancel();
      var tray = trays[i], rid = tray.id;
      if (ctx.done['hl:' + rid]) continue;
      try {
        var r = await reelsMedia(ctx, rid);
        var ri = reelItems(r, rid);
        var media = USD.igWalk(ri.items, 'highlight', user.name);
        media.forEach(function (m) { m.sub = tray.title || ri.title; });
        total += ctx.emit(media, 'highlights');
        ctx.partDone('hl:' + rid); inRow = 0;
      } catch (e) {
        if (e.kind !== 'http') throw e;
        failed++; inRow++;
        ctx.log('highlight ' + rid + ' skipped: ' + e.message);
        if (inRow >= 2) throw e;                       // two in a row: Instagram is not serving highlights right now
      }
    }
    if (failed) ctx.warn(failed + ' highlight(s) skipped');
    if (!failed) ctx.partDone('highlights');
    return total;
  }

  // ---------------------------------------------------------------- scan entry
  // the post / reel / story a <video> element belongs to (for the hover button)
  IG.videoTarget = function (video) {
    var node = video;
    for (var depth = 0; node && depth < 16; depth++, node = node.parentElement) {
      var a = node.querySelector && node.querySelector('a[href*="/p/"], a[href*="/reel/"], a[href*="/tv/"]');
      if (a) { var m = (a.getAttribute('href') || '').match(/\/(?:p|reel|tv)\/([A-Za-z0-9_-]+)/); if (m) return { type: 'post', id: m[1] }; }
    }
    var d = IG.describe();
    if (d.type === 'post') return { type: 'post', id: d.id };
    if (d.type === 'stories') return { type: 'stories', id: d.id, only: d.only };
    return null;
  };

  IG.scan = async function (ctx) {
    var d = IG.describe(), sel = ctx.sel, tg = ctx.target;
    if (tg && tg.type === 'post') { ctx.status('Video'); return singlePost(ctx, tg.id); }
    if (tg && tg.type === 'stories') {
      ctx.status('Story');
      var u = await resolveProfile(ctx, tg.id);
      return stories(ctx, u, tg.only);
    }
    var wantPosts = sel.photos || sel.videos, wantSR = sel.storyreel;
    ctx.status('Looking up the page');
    if (d.type === 'post') return singlePost(ctx, d.id);
    if (d.type === 'highlight') {
      var r = await retrying(ctx, function () { return api(ctx, '/api/v1/feed/reels_media/', { reel_ids: ['highlight:' + d.id] }); });
      var ri = reelItems(r, 'highlight:' + d.id);
      var media = USD.igWalk(ri.items, 'highlight', ri.user);
      return ctx.emit(media, 'highlights');
    }
    if (d.type === 'hashtag' || d.type === 'location' || d.type === 'saved') return collection(ctx, d);
    if (d.type !== 'profile' && d.type !== 'stories') throw USD.Err('notfound', 'Open an Instagram profile, post, reel, story or hashtag first.');

    var user = await resolveProfile(ctx, d.id);
    ctx.total(user.count);
    ctx.log('profile', user.name, user.id);
    var first = ctx.state.tray = capturedDocs('highlight:').reduce(function (acc, c) { return acc.concat(USD.igHighlights(c.doc)); }, []);
    var total = 0;
    if (d.type === 'stories') { return optional(ctx, 'Stories', function () { return stories(ctx, user); }); }
    if (wantPosts && !ctx.done.posts) {
      ctx.status('Posts');
      var n = 0;
      try { n = await graphFeed(ctx, 'posts', user); }
      catch (e) { if (['login', 'cancel', 'blocked'].indexOf(e.kind) >= 0) throw e; ctx.log('GraphQL posts failed: ' + e.message); }
      if (!n) { ctx.log('no posts from GraphQL - trying the feed API'); n = await restFeed(ctx, user); }
      total += n;
      ctx.partDone('posts');
      if (d.tab === 'tagged') { ctx.status('Tagged'); total += await graphFeed(ctx, 'tagged', user); }
    }
    if (wantSR) {
      ctx.status('Reels');
      try { total += await graphFeed(ctx, 'reels', user); } catch (e2) { if (['login', 'cancel', 'blocked'].indexOf(e2.kind) >= 0) throw e2; ctx.log('GraphQL reels failed: ' + e2.message); }
      ctx.status('Stories'); total += await optional(ctx, 'Stories', function () { return stories(ctx, user); });
      ctx.status('Highlights'); total += await optional(ctx, 'Highlights', function () { return highlights(ctx, user, first); });
    }
    return total;
  };

  async function singlePost(ctx, code) {
    var id = USD.igShortcodeToId(code);
    var d = await retrying(ctx, function () { return api(ctx, '/api/v1/media/' + id + '/info/'); });
    var items = d.items || (d.data && d.data.items) || [];
    var out = [];
    items.forEach(function (it) { out = out.concat(USD.igItems(it, it.product_type === 'clips' ? 'reel' : 'post', '')); });
    ctx.total(out.length);
    return ctx.emit(out, out.length && out[0].ptype === 'reel' ? 'reels' : 'posts');
  }

  async function collection(ctx, d) {
    var total = 0, maxId = '', page = 1, guard = 0;
    if (d.type === 'saved') {
      while (guard++ < 500) {
        ctx.checkCancel();
        var q = { count: 12 }; if (maxId) q.max_id = maxId;
        var r = await retrying(ctx, function () { return api(ctx, '/api/v1/feed/saved/posts/', q); });
        total += ctx.emit(USD.igWalk(r.items || [], 'saved', ''), 'posts');
        maxId = r.next_max_id;
        if (!maxId || !r.more_available) break;
      }
      return total;
    }
    // hashtag / location: the extension reads the search "media grid"; sections carry the media
    while (guard++ < 500) {
      ctx.checkCancel();
      var query = d.type === 'hashtag' ? { query: '#' + d.id } : { query: d.id };
      if (maxId) query.next_max_id = maxId;
      var res = await retrying(ctx, function () { return api(ctx, '/api/v1/fbsearch/web/top_serp', query); });
      var grid = (res.data || res).media_grid || {};
      var media = [];
      (grid.sections || []).forEach(function (s) { media = media.concat(USD.igWalk(s, d.type, d.id)); });
      total += ctx.emit(media, 'posts');
      maxId = grid.next_max_id;
      if (!grid.has_more || !maxId || !media.length) break;
    }
    return total;
  }
})();
