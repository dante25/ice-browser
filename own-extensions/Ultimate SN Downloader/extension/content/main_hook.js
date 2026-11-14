/* Ultimate SN Downloader — page-world helper (document_start, MAIN world).
   - passively captures the site's own JSON replies (fetch + XHR) and posts them to the content script
   - records the site's own GraphQL requests (doc_id + variables) so they can be re-sent with another cursor
   - builds GraphQL requests the way the sites' own code does (doc_id from the "<Query>.graphql" module, tokens from getAsyncParams)
   - answers RPC calls from the content script (which cannot see page variables) */
(function () {
  if (window.__usd) return;
  var TAG = '__usd';
  var origFetch = window.fetch;
  var learned = {};
  var tpl = {};
  var LEARN = /^(x-ig-|x-asbd|x-instagram|x-web-|x-bloks|x-fb-|x-csrftoken|x-requested-with)/;
  var CAP = /\/api\/graphql|\/graphql\/query|\/api\/v1\/|\/ajax\/|\/graphql\/|\/i\/api\/|\/services\/rest|\/_puppy\/|\/_napi\//;

  function post(msg) { try { msg[TAG] = 1; window.postMessage(msg, location.origin); } catch (e) {} }
  function learn(name, value) { try { name = String(name).toLowerCase(); if (LEARN.test(name) && value) learned[name] = String(value); } catch (e) {} }
  function req(name) { try { return window.require(name); } catch (e) { return null; } }

  function recordTpl(url, body) {
    try {
      if (!/\/(api\/)?graphql/.test(url) || typeof body !== 'string' || body.indexOf('doc_id') < 0) return;
      var m = body.match(/fb_api_req_friendly_name=([^&]+)/);
      var name = m ? decodeURIComponent(m[1].replace(/\+/g, ' ')) : '';
      if (name) tpl[name] = { url: url.split('?')[0], body: body };
    } catch (e) {}
  }

  var getTpl = {};    // the page's own GET list requests (DeviantArt), by path
  function recordGet(u) { try { if (/\/_puppy\/|\/_napi\//.test(u)) { var a = new URL(u, location.href); getTpl[a.pathname] = a.href; } } catch (e) {} }

  // ---- passive capture
  if (origFetch) {
    window.fetch = function () {
      var a = arguments, p = origFetch.apply(this, a);
      try {
        var u = typeof a[0] === 'string' ? a[0] : ((a[0] && a[0].url) || '');
        if (a[1] && typeof a[1].body === 'string') recordTpl(u, a[1].body);
        if (!a[1] || !a[1].method || /get/i.test(a[1].method)) recordGet(u);
        var h = a[1] && a[1].headers;
        if (h) {
          if (typeof h.forEach === 'function' && !Array.isArray(h)) h.forEach(function (v, k) { learn(k, v); });
          else if (Array.isArray(h)) h.forEach(function (kv) { learn(kv[0], kv[1]); });
          else Object.keys(h).forEach(function (k) { learn(k, h[k]); });
        }
        if (CAP.test(u) && !(a[1] && a[1].__usd)) {
          p.then(function (r) { r.clone().text().then(function (t) { post({ dir: 'cap', url: u, text: t }); }); }).catch(function () {});
        }
      } catch (e) {}
      return p;
    };
  }
  var xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send, xh = XMLHttpRequest.prototype.setRequestHeader;
  XMLHttpRequest.prototype.setRequestHeader = function (k, v) { learn(k, v); return xh.apply(this, arguments); };
  XMLHttpRequest.prototype.open = function (m, u) { this.__usdurl = String(u || ''); if (/get/i.test(m)) recordGet(this.__usdurl); return xo.apply(this, arguments); };
  XMLHttpRequest.prototype.send = function () {
    var self = this;
    try { recordTpl(self.__usdurl || '', arguments[0]); } catch (e) {}
    try {
      if (CAP.test(self.__usdurl || '')) {
        self.addEventListener('load', function () {
          try { var t = (self.responseType === '' || self.responseType === 'text') ? self.responseText : ''; if (t) post({ dir: 'cap', url: self.__usdurl, text: t }); } catch (e) {}
        });
      }
    } catch (e) {}
    return xs.apply(this, arguments);
  };

  // ---- helpers used by the RPC methods
  function csrf() { var m = document.cookie.match(/(?:^|; )csrftoken=([^;]*)/); return m ? decodeURIComponent(m[1]) : ''; }

  function baseHeaders(extra) {
    var h = Object.assign({ 'x-ig-app-id': '936619743392459', 'x-asbd-id': '129477', 'x-requested-with': 'XMLHttpRequest', accept: '*/*' }, learned, extra || {});
    try { var claim = sessionStorage.getItem('www-claim-v2'); if (claim && !h['x-ig-www-claim']) h['x-ig-www-claim'] = claim; } catch (e) {}
    if (!h['x-csrftoken'] && csrf()) h['x-csrftoken'] = csrf();
    return h;
  }

  var GRAPHQL_ONLY = ['x-fb-friendly-name', 'x-fb-lsd', 'x-fb-qpl-active-flows', 'content-type'];
  function doFetch(r) {
    var hdr = r.plain ? Object.assign({}, r.headers || {}) : baseHeaders(r.headers);       // plain: no extra headers (cross-origin APIs such as Flickr's)
    if ((r.method || 'GET') === 'GET') GRAPHQL_ONLY.forEach(function (k) { delete hdr[k]; });   // a REST call must look like the site's own REST calls
    var opts = { method: r.method || 'GET', credentials: 'include', headers: hdr, __usd: true };
    if (r.body !== undefined && r.body !== null) opts.body = r.body;
    return origFetch.call(window, r.url, opts).then(function (res) {
      return res.text().then(function (t) { return { status: res.status, text: t, url: res.url }; });
    }).catch(function (e) { return { status: 0, error: String(e) }; });
  }

  function parseVars(body) {
    var m = body && body.match(/(?:^|&)variables=([^&]*)/);
    if (!m) return null;
    try { return JSON.parse(decodeURIComponent(m[1].replace(/\+/g, ' '))); } catch (e) { return null; }
  }
  function tplDocId(t) { var m = t && t.body.match(/doc_id=(\d+)/); return m && m[1]; }
  function tplFind(needle) {
    var names = Object.keys(tpl);
    for (var i = 0; i < names.length; i++) if (names[i].indexOf(needle) >= 0) return names[i];
    return null;
  }
  function merge(base, over) {
    var v = Object.assign({}, base || {});
    Object.keys(over || {}).forEach(function (k) {
      if (over[k] && typeof over[k] === 'object' && !Array.isArray(over[k]) && v[k] && typeof v[k] === 'object') v[k] = Object.assign({}, v[k], over[k]);
      else v[k] = over[k];
    });
    return v;
  }

  // GraphQL request built like the site's own code: freshest doc_id first ("<Name>.graphql" module), then the recorded one, then `fallbackDoc`
  // ESUIT's step that was missing: the "<Name>.graphql" module is only on the page after the site's own code loaded it. If it is not
  // registered yet, ask the site's Bootloader to fetch it (the same loader the site uses), so the CURRENT doc_id is read instead of a stale one.
  function hasMod(n) { try { return !!req('__debug').modulesMap[n]; } catch (e) { return false; } }
  function loadMod(n, ms) {
    return new Promise(function (res) {
      if (hasMod(n)) return res(true);
      var done = false, t = setTimeout(function () { if (!done) { done = true; res(hasMod(n)); } }, ms || 5000);
      try {
        req('Bootloader').loadModules([n], function () { if (!done) { done = true; clearTimeout(t); res(hasMod(n)); } });
      } catch (e) { done = true; clearTimeout(t); res(false); }
    });
  }
  function gql(a) {
    return loadMod(a.name + '.graphql', 5000).then(function () { return gql1(a); }, function () { return gql1(a); });
  }
  function gql1(a) {
    try {
      var name = a.name, mod = req(name + '.graphql');
      var docId = (mod && mod.params && mod.params.id) || tplDocId(tpl[name]) || a.docId;
      if (!docId) return Promise.resolve({ status: 0, error: 'no doc_id for ' + name });
      var vars = merge(a.base || (tpl[name] ? parseVars(tpl[name].body) : null) || {}, a.vars);
      try {
        var pv = (mod && mod.params && mod.params.providedVariables) || {};
        Object.keys(vars).forEach(function (k) { if (k.indexOf('__relay_internal') === 0) delete vars[k]; });
        Object.keys(pv).forEach(function (k) { if (k.indexOf('__relay_internal') === 0) vars[k] = !!(pv[k] && pv[k].get && pv[k].get()); });
      } catch (e) {}
      if (!vars.scale) { try { vars.scale = req('WebPixelRatio').get(); } catch (e) {} }     // ESUIT adds the page's pixel ratio to every query
      var ap = {}; try { ap = req('getAsyncParams')('POST') || {}; } catch (e) {}
      var av = ''; try { av = req('RelayAPIConfig').actorID; } catch (e) {}
      var body = new URLSearchParams(Object.assign({ av: av }, ap, { fb_api_caller_class: 'RelayModern', fb_api_req_friendly_name: name,
        variables: JSON.stringify(vars), server_timestamps: 'true', doc_id: String(docId) }));
      var h = { 'content-type': 'application/x-www-form-urlencoded', 'x-fb-friendly-name': name };
      if (a.ig) {
        try { h['x-bloks-version-id'] = req('WebBloksVersioningID').versioningID; } catch (e) {}
        try { var pc = req('PolarisConfig'); h['x-csrftoken'] = pc.getCSRFToken(); h['x-ig-app-id'] = pc.getIGAppID(); } catch (e) {}
      }
      var url = a.url || (a.ig ? '/graphql/query' : '/api/graphql/');
      return doFetch({ url: url, method: 'POST', headers: h, body: body.toString() }).then(function (r) { r.docId = String(docId); return r; });
    } catch (e) { return Promise.resolve({ status: 0, error: 'gql: ' + e }); }
  }

  // re-send a recorded request of the page with changed variables
  function replay(a) {
    var name = tplFind(a.needle);
    if (!name) return Promise.resolve({ status: 0, error: 'no template ' + a.needle });
    var t = tpl[name], pairs = [];
    new URLSearchParams(t.body).forEach(function (v, k) {
      if (k === 'variables') {
        var vars = {}; try { vars = JSON.parse(v); } catch (e) {}
        var set = a.set || {};
        Object.keys(set).forEach(function (key) {
          var real = key === '$cursor' ? ('cursor' in vars ? 'cursor' : 'after') : key;
          vars[real] = set[key];
        });
        v = JSON.stringify(vars);
      }
      pairs.push([k, v]);
    });
    var h = { 'content-type': 'application/x-www-form-urlencoded', 'x-fb-friendly-name': name };
    return doFetch({ url: t.url, method: 'POST', headers: h, body: new URLSearchParams(pairs).toString() }).then(function (r) { r.name = name; return r; });
  }

  // GET through the site's own API client when it exists (adds every header the site expects), else a plain same-origin fetch
  function api(a) {
    var qp = new URLSearchParams();                     // arrays become repeated keys (reel_ids=1&reel_ids=2), like the site's own client
    Object.keys(a.query || {}).forEach(function (k) { [].concat(a.query[k]).forEach(function (v) { qp.append(k, v); }); });
    var q = qp.toString();
    var path = a.path + (q ? (a.path.indexOf('?') >= 0 ? '&' : '?') + q : '');
    try {
      var inst = req('PolarisInstapi');
      if (inst && inst.apiGet && !a.plain) {
        var query = {}; Object.keys(a.query || {}).forEach(function (k) { query[k] = a.query[k]; });
        return Promise.resolve(inst.apiGet(a.path, { query: query })).then(function (res) {
          return { status: 200, text: JSON.stringify(res), via: 'instapi' };
        }, function (e) {
          var st = (e && (e.status || (e.xhr && e.xhr.status))) || 0;
          return { status: st || 500, text: String((e && (e.message || e.responseText)) || e), error: String(e), via: 'instapi' };
        });
      }
    } catch (e) {}
    return doFetch({ url: path, method: 'GET' });
  }

  // re-send one of the page's own GET list requests with other query parameters (e.g. offset)
  function getReplay(a) {
    var path = Object.keys(getTpl).filter(function (k) { return k.indexOf(a.needle) >= 0; })[0];
    if (!path) return Promise.resolve({ status: 0, error: 'no GET template ' + a.needle });
    var u = new URL(getTpl[path]);
    Object.keys(a.set || {}).forEach(function (k) { u.searchParams.set(k, a.set[k]); });
    return doFetch({ url: u.href, method: 'GET' });
  }

  var methods = {
    getreplay: getReplay,
    gettpls: function () { return Promise.resolve(Object.keys(getTpl)); },
    fetch: doFetch,
    api: api,
    gql: gql,
    replay: replay,
    tpls: function () { return Promise.resolve(Object.keys(tpl).map(function (n) { return { name: n, vars: Object.keys(parseVars(tpl[n].body) || {}), doc: tplDocId(tpl[n]) }; })); },
    dump: function () {
      var out = [];
      document.querySelectorAll('script[type="application/json"]').forEach(function (s) { out.push(s.textContent); });
      return Promise.resolve(out);
    },
    modules: function (a) {
      var out = [], re = new RegExp(a.pattern || '.', 'i');
      try { var mm = req('__debug').modulesMap || {}; Object.keys(mm).forEach(function (k) { if (/\.graphql$/.test(k) && re.test(k)) out.push(k.replace(/\.graphql$/, '')); }); } catch (e) {}
      return Promise.resolve(out);
    },
    html: function (a) { return Promise.resolve(document.documentElement.innerHTML.slice(0, a.limit || 3000000)); },
    text: function () { return Promise.resolve(document.body ? document.body.innerText.slice(0, 4000) : ''); },
    meta: function () {
      function m(p) { var e = document.querySelector('meta[property="' + p + '"]'); return e ? e.content : ''; }
      return Promise.resolve({ title: document.title, image: m('og:image'), video: m('og:video') || m('og:video:url') || m('og:video:secure_url'), url: location.href });
    }
  };

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (ev.source !== window || !d || d[TAG] !== 1 || d.dir !== 'rpc') return;
    var fn = methods[d.method];
    Promise.resolve(fn ? fn(d.args || {}) : { status: 0, error: 'unknown method ' + d.method }).then(function (result) {
      post({ dir: 'res', id: d.id, result: result });
    }, function (e) { post({ dir: 'res', id: d.id, result: { status: 0, error: String(e) } }); });
  });

  window.__usd = { version: 1 };
})();
