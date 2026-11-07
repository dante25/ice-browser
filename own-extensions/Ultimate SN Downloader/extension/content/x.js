/* Ultimate SN Downloader — X (Twitter) scanner.
   X signs every API request with per-request tokens, so requests are not replayed: the Media tab is scrolled like a person does and the
   page's own replies are read (passive). Photos: original size (?name=orig). Videos / GIFs: best mp4 variant. */
(function () {
  var X = {};
  USD.sites.x = X;
  var RESERVED = ['', 'home', 'explore', 'notifications', 'messages', 'i', 'settings', 'compose', 'search', 'login', 'logout', 'tos', 'privacy', 'jobs', 'about', 'communities', 'lists', 'bookmarks', 'premium', 'verified-choose'];

  X.match = function () { return /^(www\.)?(x|twitter)\.com$/.test(location.hostname); };

  X.describe = function () {
    var parts = location.pathname.split('/').filter(Boolean);
    var base = { site: 'x', type: 'home', id: '', label: '' };
    if (!parts.length || RESERVED.indexOf(parts[0].toLowerCase()) >= 0) return base;
    if (parts[1] === 'status' && parts[2]) return { site: 'x', type: 'status', id: parts[2], user: parts[0], label: '@' + parts[0] + ' · post ' + parts[2] };
    var type = parts[1] === 'media' ? 'media' : 'profile';
    return { site: 'x', type: type, id: parts[0], label: '@' + parts[0] + ' · Media' };
  };

  function samePage(url) {
    try { var a = new URL(url, location.origin); return a.pathname.replace(/\/$/, '').toLowerCase() === location.pathname.replace(/\/$/, '').toLowerCase(); } catch (e) { return false; }
  }
  X.samePage = samePage;

  X.plan = function () {
    var d = X.describe();
    if (d.type === 'status') return [{ part: 'status', url: location.pathname, single: true, tweet: d.id, owner: d.user }];
    return [{ part: 'media', url: '/' + d.id + '/media', owner: d.id }];
  };

  // ---------------------------------------------------------------- parsing
  function screenName(t) {
    var r = ((t.core || {}).user_results || {}).result || {};
    return (r.legacy && r.legacy.screen_name) || (r.core && r.core.screen_name) || '';
  }
  function bestVideo(variants) {
    var best = null;
    (variants || []).forEach(function (v) { if (/mp4/.test(v.content_type || '') && v.url && (!best || (v.bitrate || 0) > (best.bitrate || 0))) best = v; });
    return best;
  }
  // media of every tweet found in a reply (optionally only tweets of `user`); returns {items, tweets}
  function parseReply(doc, user, onlyTweet) {
    var items = [], tweets = {}, low = (user || '').toLowerCase();
    USD.walk(doc, function (o) {
      var l = o.legacy;
      if (!l || typeof l !== 'object' || !(o.rest_id || l.id_str) || !(l.extended_entities || l.entities || l.full_text !== undefined)) return false;
      var id = String(o.rest_id || l.id_str), author = screenName(o);
      if (low && author.toLowerCase() !== low) return false;
      if (onlyTweet && id !== String(onlyTweet)) return false;
      tweets[id] = 1;
      var media = (l.extended_entities && l.extended_entities.media) || (l.entities && l.entities.media) || [];
      var ts = l.created_at ? Math.floor(Date.parse(l.created_at) / 1000) || 0 : 0;
      media.forEach(function (m, i) {
        var base = { site: 'x', owner: author || user || '', postId: id, code: id, ptype: 'media', index: i, takenAt: ts, caption: String(l.full_text || '').slice(0, 300) };
        if (m.type === 'photo' && m.media_url_https) {
          var u = m.media_url_https, ext = (u.match(/\.(jpg|jpeg|png|webp)$/i) || [, 'jpg'])[1].toLowerCase();
          items.push(Object.assign({ key: id + '_' + i, kind: 'photo', url: u.replace(/\.(jpg|jpeg|png|webp)$/i, '') + '.' + ext + '?name=orig', w: (m.original_info || {}).width || 0, h: (m.original_info || {}).height || 0 }, base));
        } else if ((m.type === 'video' || m.type === 'animated_gif') && m.video_info) {
          var v = bestVideo(m.video_info.variants);
          if (v) items.push(Object.assign({ key: id + '_' + i, kind: 'video', url: v.url, w: (m.original_info || {}).width || 0, h: (m.original_info || {}).height || 0 }, base));
        }
      });
      return false;
    });
    return { items: items, tweets: Object.keys(tweets) };
  }

  // ---------------------------------------------------------------- scanning
  async function pageProblem(ctx) {
    var t = String(await USD.rpc('text') || '').toLowerCase();
    if (/rate limit exceeded|something went wrong\. try reloading/.test(t)) await ctx.blocked('X shows a limit notice');
    if (/log in to x|sign in to x|log in to twitter/.test(t) && t.indexOf('password') >= 0) throw USD.Err('login', 'X shows the login page - log in first.');
  }

  X.scanStep = async function (ctx, step) {
    var seen = 0, total = 0, seenTweets = {}, idle = 0, lastH = 0, cycles = 0, emitted = {};
    function drain() {
      var fresh = 0;
      for (; seen < USD.captured.length; seen++) {
        var c = USD.captured[seen];
        if (c.text.length < 3000 && USD.looksBlocked(0, c.text)) { ctx.pendingBlock = c.text.slice(0, 160); continue; }
        if (c.url.indexOf('/i/api/') < 0) continue;
        USD.parsePayload(c.text).forEach(function (d) {
          var r = parseReply(d, step.single ? '' : step.owner, step.single ? step.tweet : '');
          r.tweets.forEach(function (id) { if (!seenTweets[id]) { seenTweets[id] = 1; fresh++; } });
          var items = r.items.filter(function (m) { return !emitted[m.key]; });
          items.forEach(function (m) { emitted[m.key] = 1; });
          if (items.length) { total += ctx.emit(items, 'media'); ctx.scanned(Object.keys(emitted).length); }
        });
      }
      return fresh;
    }
    ctx.status('Media');
    await pageProblem(ctx);
    if (step.single) {
      for (var i = 0; i < 24 && !Object.keys(emitted).length; i++) { drain(); if (!Object.keys(emitted).length) await ctx.sleep(500); }
      if (!Object.keys(emitted).length) throw USD.Err('notfound', 'No media found in this post. Reload the page once and try again.');
      return total;
    }
    drain();
    while (idle < 6) {
      ctx.checkCancel();
      if (ctx.pendingBlock) { var why = ctx.pendingBlock; ctx.pendingBlock = null; await ctx.blocked(why); }
      window.scrollBy(0, Math.max(700, window.innerHeight * 0.9));
      var h = document.documentElement.scrollHeight;
      await ctx.gate('scroll');
      var fresh = drain();
      if (cycles++ % 8 === 7) await pageProblem(ctx);
      if (fresh === 0 && h === lastH) idle += 1; else if (fresh === 0) idle += 0.5; else idle = 0;
      lastH = h;
    }
    return total;
  };
})();
