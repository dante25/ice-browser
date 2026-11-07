/* Ultimate SN Downloader — shared content-script code (isolated world): page RPC, captured replies, JSON walkers. */
var USD = (function () {
  var TAG = '__usd';
  var U = { sites: {}, captured: [], capListeners: [] };
  var pending = {}, nextId = 1;

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (ev.source !== window || !d || d[TAG] !== 1) return;
    if (d.dir === 'res' && pending[d.id]) { pending[d.id](d.result); delete pending[d.id]; }
    else if (d.dir === 'cap') {
      var c = { url: d.url, text: d.text, at: Date.now() };
      U.captured.push(c);
      if (U.captured.length > 400) U.captured.splice(0, U.captured.length - 400);
      U.capListeners.slice().forEach(function (f) { try { f(c); } catch (e) {} });
    }
  });

  U.sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  U.rpc = function (method, args, timeout) {
    return new Promise(function (resolve) {
      var id = nextId++;
      var t = setTimeout(function () { delete pending[id]; resolve({ status: 0, error: 'timeout ' + method }); }, timeout || 45000);
      pending[id] = function (r) { clearTimeout(t); resolve(r); };
      window.postMessage({ __usd: 1, dir: 'rpc', id: id, method: method, args: args || {} }, location.origin);
    });
  };

  U.log = function () { try { console.debug.apply(console, ['[USN]'].concat([].slice.call(arguments))); } catch (e) {} };

  // ---- errors
  function Err(kind, msg) { var e = new Error(msg); e.kind = kind; return e; }
  U.Err = Err;

  // ---- reply parsing
  U.parsePayload = function (text) {
    var docs = [], t = String(text || '').trim();
    if (t.indexOf('for (;;);') === 0) t = t.slice(9);
    try { docs.push(JSON.parse(t)); return docs; } catch (e) {}
    t.split('\n').forEach(function (line) {
      line = line.trim();
      if (line.indexOf('for (;;);') === 0) line = line.slice(9);
      if (line[0] === '{' || line[0] === '[') { try { docs.push(JSON.parse(line)); } catch (e) {} }
    });
    return docs;
  };

  var BLOCK = ['rate limit', 'try again later', 'temporarily blocked', 'temporarily locked', 'action blocked', 'checkpoint_required', 'challenge_required',
    'feedback_required', 'please wait a few minutes', 'wait a few minutes', 'you\'re temporarily blocked', 'we limit how often', 'too many requests',
    '1357004', '1357001', '1675004', '1404078', 'request is too frequent', 'rate_limit_exceeded'];
  U.looksBlocked = function (status, text) {
    if (status === 429 || status === 560) return true;
    var low = String(text || '').slice(0, 4000).toLowerCase();
    return BLOCK.some(function (m) { return low.indexOf(m) >= 0; });
  };

  // generic deep walk; visit(obj) returns true to skip descending
  U.walk = function (root, visit) {
    var stack = [root];
    while (stack.length) {
      var cur = stack.pop();
      if (Array.isArray(cur)) { for (var i = cur.length - 1; i >= 0; i--) if (cur[i] && typeof cur[i] === 'object') stack.push(cur[i]); }
      else if (cur && typeof cur === 'object') {
        if (visit(cur)) continue;
        var vals = Object.keys(cur);
        for (var j = vals.length - 1; j >= 0; j--) { var v = cur[vals[j]]; if (v && typeof v === 'object') stack.push(v); }
      }
    }
  };

  // ---- Instagram
  function best(cands) {
    var b = null;
    (cands || []).forEach(function (c) { if (c && c.url && (!b || (c.width || 0) > (b.width || 0))) b = c; });
    return b;
  }
  // DASH manifest of a video (separate HD video + audio tracks) -> {video, audio} with the byte ranges needed to fetch them
  U.parseDash = function (xml) {
    if (!xml || typeof xml !== 'string') return null;
    try {
      var doc = new DOMParser().parseFromString(xml, 'text/xml'), out = {};
      var sets = doc.getElementsByTagName('AdaptationSet');
      for (var i = 0; i < sets.length; i++) {
        var set = sets[i], reps = set.getElementsByTagName('Representation'), bestRep = null;
        var isAudio = /audio/i.test(set.getAttribute('contentType') || set.getAttribute('mimeType') || '') || !!set.getElementsByTagName('AudioChannelConfiguration').length;
        for (var r = 0; r < reps.length; r++) {
          var rep = reps[r];
          var size = Number(rep.getAttribute('FBContentLength') || rep.getAttribute('bandwidth') || 0);
          if (!bestRep || size > bestRep.size) bestRep = { el: rep, size: size };
        }
        if (!bestRep) continue;
        var el = bestRep.el, base = el.getElementsByTagName('BaseURL')[0], sb = el.getElementsByTagName('SegmentBase')[0], init = el.getElementsByTagName('Initialization')[0];
        if (!base || !sb || !init) continue;
        var track = { url: (base.textContent || '').trim(), codec: el.getAttribute('codecs') || '', label: el.getAttribute('FBQualityLabel') || '',
          w: Number(el.getAttribute('width') || 0), h: Number(el.getAttribute('height') || 0), index: sb.getAttribute('indexRange'), init: init.getAttribute('range') };
        if (!track.url || !track.index || !track.init) continue;
        if (isAudio) out.audio = track; else out.video = track;
      }
      return out.video || out.audio ? out : null;
    } catch (e) { return null; }
  };
  function dig(o, path) { var cur = o; path.split('.').forEach(function (k) { cur = cur && cur[k]; }); return cur; }

  function igSingle(node, pid, idx) {
    var vv = node.video_versions || [];
    var pk = node.pk ? String(node.pk).split('_')[0] : pid;
    if (node.media_type === 2 || vv.length || node.is_video || node.video_url) {
      var bv = best(vv), url = bv ? bv.url : node.video_url;
      if (url) {
        var cover = best(((node.image_versions2 || {}).candidates) || []);
        return { key: pk + '_' + idx, kind: 'video', url: url, index: idx, w: (bv && bv.width) || node.original_width || 0, h: (bv && bv.height) || node.original_height || 0,
          thumb: (cover && cover.url) || node.thumbnail_src || node.display_url || '', dash: U.parseDash(node.video_dash_manifest),
          audioUrl: dig(node, 'clips_metadata.original_sound_info.progressive_download_url') || dig(node, 'clips_metadata.music_info.music_asset_info.progressive_download_url') || '',
          audioTitle: dig(node, 'clips_metadata.original_sound_info.original_audio_title') || dig(node, 'clips_metadata.music_info.music_asset_info.title') || '' };
      }
    }
    var cands = ((node.image_versions2 || {}).candidates) || [];
    var bi = best(cands), iurl = bi ? bi.url : (node.display_url || node.display_src);
    if (!iurl && node.display_resources) {
      var b2 = best(node.display_resources.map(function (r) { return { url: r.src, width: r.config_width }; }));
      iurl = b2 && b2.url;
    }
    if (iurl) return { key: pk + '_' + idx, kind: 'photo', url: iurl, index: idx, w: (bi && bi.width) || node.original_width || 0, h: (bi && bi.height) || node.original_height || 0 };
    return null;
  }
  function isIgMedia(d) {
    return ('image_versions2' in d || 'video_versions' in d || 'carousel_media' in d || 'display_url' in d) && ('pk' in d || 'id' in d || 'code' in d);
  }
  U.igItems = function (it, ptype, ownerHint) {
    if (it.media && typeof it.media === 'object' && !('pk' in it)) it = it.media;
    var user = it.user || it.owner || {};
    var owner = user.username || ownerHint || '';
    var pid = String(it.pk || it.id || '').split('_')[0];
    var cap = it.caption, caption = cap && typeof cap === 'object' ? (cap.text || '') : (cap || '');
    if (!caption && it.edge_media_to_caption) { var e0 = (it.edge_media_to_caption.edges || [])[0]; caption = e0 ? e0.node.text : ''; }
    var meta = { site: 'ig', owner: owner, postId: pid, code: it.code || it.shortcode || '', ptype: ptype,
      takenAt: Number(it.taken_at || it.taken_at_timestamp || 0), caption: String(caption || '').slice(0, 300) };
    var kids = it.carousel_media || (it.edge_sidecar_to_children && it.edge_sidecar_to_children.edges && it.edge_sidecar_to_children.edges.map(function (e) { return e.node; }));
    var out = [];
    if (it.media_type === 8 || (kids && kids.length)) {
      (kids || []).forEach(function (ch, i) { var m = igSingle(ch, pid, i); if (m) out.push(Object.assign(m, meta)); });
    } else { var m1 = igSingle(it, pid, 0); if (m1) out.push(Object.assign(m1, meta)); }
    out.forEach(function (m) {                      // reel sound / title live on the post, not on carousel children
      if (m.kind === 'video' && !m.audioUrl) {
        m.audioUrl = dig(it, 'clips_metadata.original_sound_info.progressive_download_url') || dig(it, 'clips_metadata.music_info.music_asset_info.progressive_download_url') || '';
        m.audioTitle = m.audioTitle || dig(it, 'clips_metadata.original_sound_info.original_audio_title') || '';
      }
    });
    return out;
  };
  // every Instagram media object anywhere in a reply (GraphQL connections or REST), in order, de-duplicated
  U.igWalk = function (doc, ptype, ownerHint) {
    var out = [], seen = {};
    U.walk(doc, function (o) {
      if (isIgMedia(o)) {
        U.igItems(o, ptype, ownerHint).forEach(function (m) { if (!seen[m.key]) { seen[m.key] = 1; out.push(m); } });
        return true;
      }
      return false;
    });
    return out;
  };
  // [hasNext, endCursor] of the first xdt_api__* connection (or any with page_info when prefix is '')
  U.pageInfo = function (doc, prefix) {
    var res = [false, ''];
    U.walk(doc, function (o) {
      for (var k in o) {
        var v = o[k];
        if (v && typeof v === 'object' && v.page_info && (!prefix || k.indexOf(prefix) === 0)) { res = [!!v.page_info.has_next_page, v.page_info.end_cursor || '']; return true; }
      }
      return false;
    });
    return res;
  };
  U.igFindUser = function (doc, username) {
    var low = String(username || '').toLowerCase(), found = null;
    U.walk(doc, function (o) {
      if (found) return true;
      if (String(o.username || '').toLowerCase() === low) {
        var uid = o.pk || o.id || o.pk_id || o.strong_id__;
        if (uid && /^\d+$/.test(String(uid).split('_')[0])) { found = { id: String(uid).split('_')[0], user: o }; return true; }
      }
      return false;
    });
    return found;
  };
  U.igHighlights = function (doc) {
    var out = [], seen = {};
    U.walk(doc, function (o) {
      if (typeof o.id === 'string' && o.id.indexOf('highlight:') === 0 && !seen[o.id]) {
        seen[o.id] = 1;
        var t = o.title; out.push({ id: o.id, title: typeof t === 'string' ? t : (t && t.text) || '' });
      }
      return false;
    });
    return out;
  };
  U.igShortcodeToId = function (code) {
    var A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_', n = BigInt(0);
    code.slice(0, 11).split('').forEach(function (ch) { n = n * BigInt(64) + BigInt(A.indexOf(ch)); });
    return n.toString();
  };

  // ---- Facebook
  var VIDEO_KEYS = ['browser_native_hd_url', 'playable_url_quality_hd', 'playable_url', 'browser_native_sd_url', 'hd_src', 'sd_src'];
  var PHOTO_PATHS = [['photo_image', 'uri'], ['image', 'uri'], ['viewer_image', 'uri'], ['largest_image', 'uri'], ['full_image', 'uri'], ['photo_image_full', 'uri']];
  function photoUri(n) {
    for (var i = 0; i < PHOTO_PATHS.length; i++) {
      var v = n[PHOTO_PATHS[i][0]];
      if (v && typeof v === 'object' && v[PHOTO_PATHS[i][1]]) return [v[PHOTO_PATHS[i][1]], v.width || 0, v.height || 0];
    }
    return null;
  }
  function fbNode(n, nid, tn, ownerHint, ptype) {
    var owner = '', o = n.owner || n.actors || {};
    if (Array.isArray(o)) o = o[0] || {};
    owner = (o && (o.name || o.username)) || ownerHint || '';
    var ts = Number(n.created_time || n.creation_time || 0);
    var cap = n.message || n.accessibility_caption || '';
    if (cap && typeof cap === 'object') cap = cap.text || '';
    cap = typeof cap === 'string' ? cap.slice(0, 300) : '';
    for (var i = 0; i < VIDEO_KEYS.length; i++) {
      var k = VIDEO_KEYS[i];
      if (n[k] && typeof n[k] === 'string') return { site: 'fb', key: nid || n[k].slice(-40), kind: 'video', url: n[k], owner: owner, postId: nid, code: nid,
        ptype: ptype === 'photo' ? 'video' : ptype, index: 0, takenAt: ts, caption: cap, w: Number(n.width || 0), h: Number(n.height || 0) };
    }
    var pu = photoUri(n);
    if (pu && (!tn || tn === 'Photo' || nid)) {
      if (!pu[0] || pu[0].indexOf('static.xx.fbcdn') >= 0) return null;
      return { site: 'fb', key: nid || pu[0].split('?')[0].slice(-40), kind: 'photo', url: pu[0], owner: owner, postId: nid, code: nid, ptype: ptype,
        index: 0, takenAt: ts, caption: cap, w: Number(pu[1]), h: Number(pu[2]) };
    }
    return null;
  }
  U.fbWalk = function (doc, ownerHint, ptype, found) {
    found = found || {};
    U.walk(doc, function (c) {
      var tn = c.__typename, nid = c.id || c.fbid || c.photo_id || c.video_id;
      var hasVid = VIDEO_KEYS.some(function (k) { return c[k]; });
      if (tn === 'Photo' || tn === 'Video' || (nid && hasVid) || (nid && photoUri(c))) {
        var m = fbNode(c, nid ? String(nid) : '', tn, ownerHint, ptype);
        if (m) {
          var old = found[m.key];
          if (!old || (m.w * m.h) > (old.w * old.h)) found[m.key] = m;
        }
      }
      return false;
    });
    return Object.keys(found).map(function (k) { return found[k]; });
  };
  // the edges/page_info connection with most photos: [cursor, hasNext, count]
  U.fbConnection = function (doc) {
    var bestc = null;
    U.walk(doc, function (c) {
      if (Array.isArray(c.edges) && c.page_info && typeof c.page_info === 'object') {
        var n = U.fbWalk(c.edges, '', 'photo').length;
        if (n && (!bestc || n > bestc[2])) bestc = [c.page_info.end_cursor, c.page_info.has_next_page === true, n];
      }
      return false;
    });
    return bestc;
  };

  // ---- file naming
  U.cleanName = function (s, limit) {
    s = String(s || '').replace(/[\\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/\s+/g, ' ').trim();
    s = s.slice(0, limit || 80).replace(/^[ .]+|[ .]+$/g, '');
    return s || '_';
  };

  return U;
})();
