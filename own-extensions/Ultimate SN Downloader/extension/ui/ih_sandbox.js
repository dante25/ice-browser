/* Runs the host file's function rules (they are code from the host file, so this page is sandboxed: no extension APIs). Network goes out through
   the parent page: a small XMLHttpRequest stand-in asks for it. Same function construction as ImageHostGrabber's own engine. */
(function () {
  var pending = {}, nextNet = 1;

  function XHR() { this.headers = {}; this.status = 0; this.statusText = ''; this.responseText = ''; this.readyState = 0; }
  XHR.prototype.open = function (m, u) { this.method = m; this.url = u; };
  XHR.prototype.setRequestHeader = function (k, v) { this.headers[k] = v; };
  XHR.prototype.send = function (body) {
    var self = this, id = nextNet++;
    pending[id] = function (r) {
      if (r.error) { self.statusText = r.error; if (self.onerror) self.onerror.call(self, new Error(r.error)); return; }
      self.status = r.status; self.statusText = r.statusText || ''; self.responseText = r.text; self.response = r.text; self.readyState = 4;
      self.responseURL = r.finalUrl; self.channel = { URI: { spec: r.finalUrl }, originalURI: { spec: self.url } };
      if (self.onload) self.onload.call(self);
      if (self.onreadystatechange) self.onreadystatechange.call(self);
    };
    parent.postMessage({ type: 'net', id: id, method: this.method, url: this.url, headers: this.headers, body: body === undefined ? null : body }, '*');
  };
  window.XMLHttpRequest = XHR;

  window.addEventListener('message', function (ev) {
    var d = ev.data;
    if (!d) return;
    if (d.type === 'net-result' && pending[d.id]) { pending[d.id](d); delete pending[d.id]; return; }
    if (d.type !== 'run') return;
    var done = function (r) { parent.postMessage({ type: 'run-result', id: d.id, result: r }, '*'); };
    try {
      var src = d.fn, args = src.match(/function\((.+?),(.+?)\)/);
      var body = src.replace(/[\n\f\r]/g, 'NEWLINE').match(/{(.+)}/)[1].replace(/NEWLINE/g, '\n');
      var f = new Function(args[1].trim(), args[2].trim(), body);
      Promise.resolve(f(d.pageData, d.pageUrl)).then(function (r) { done(r || { status: 'ABORT' }); }, function (e) { done({ status: 'ABORT', error: String((e && e.message) || e) }); });
    } catch (e) { done({ status: 'ABORT', error: 'rule could not be built: ' + e }); }
  });
})();
