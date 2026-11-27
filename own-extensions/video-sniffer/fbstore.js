// Facebook only, MAIN world, document_start. The mechanism of the ESUIT "Video Downloader for Facebook" extension:
// Facebook's module loader (window.__d) is wrapped so that the Relay publish queue exposes its record store
// (window.___rs). Every video the page has received (feed, reels, watch) is then read from that store by its
// id: playable_url (SD), playable_url{quality:HD}, the MPEG-DASH playlist and video_delivery_response.progressive_urls.
(() => {
  if (!/(^|\.)facebook\.com$/.test(location.hostname) || window[Symbol.for('__vsFbStore')]) return;
  window[Symbol.for('__vsFbStore')] = true;

  const MODULE = 'relay-runtime/store/RelayPublishQueue';
  const PATCH = (src) =>
    src.replace(/,(\w+)=new\((\w+)\("relay-runtime\/mutations\/RelayRecordSourceProxy"/, ',$1=window["___rs"]=new($2("relay-runtime/mutations/RelayRecordSourceProxy"');

  // Rebuild a module factory from patched source text (same way ESUIT does it).
  let fnId = 0;
  window.__vsFn = window.__vsFn || {};
  function rebuild(src) {
    const body = src.slice(src.indexOf('{') + 1, src.lastIndexOf('}'));
    const params = (src.replace(/(\/\/.*$)|(\/\*[\s\S]*?\*\/)/gm, '').match(/\(([^)]*)\)/)?.[1] || '').split(',').map((s) => s.trim()).filter(Boolean);
    const key = `f${++fnId}`;
    try {
      const c = document.createElement('script');
      c.text = `window.__vsFn["${key}"]=function(${params.join(',')}){${body}}`;
      (document.head || document.documentElement).appendChild(c).remove();
      if (window.__vsFn[key]) return window.__vsFn[key];
    } catch {}
    return new Function(...params, body); // CSP allows eval on facebook.com
  }

  let patched = false;
  function wrapArgs(args) {
    try {
      if (!patched && args[0] === MODULE && typeof args[2] === 'function') {
        patched = true;
        const src = args[2].toString();
        const out = PATCH(src);
        if (out !== src) args[2] = rebuild(out);
      }
    } catch (e) {
      console.debug('[Video Sniffer] store patch failed', e);
    }
    return args;
  }
  const proxyOf = (fn) => new Proxy(fn, { apply: (t, self, a) => t.apply(self, wrapArgs(a)) });

  let d = window.__d;
  if (d) {
    if (d.toString().includes('__d_stub')) delete window.__d;
    else d = proxyOf(d);
  }
  Object.defineProperty(window, '__d', {
    configurable: true,
    get: () => d,
    set: (v) => {
      d = proxyOf(v);
    },
  });

  // Store path reader: "^x" linked record, "^^x" linked records, "x{$1}" field with arguments, "*" stop here.
  function sf(id, path, args) {
    const rs = window.___rs;
    let cur = typeof id === 'string' ? rs?.get(id) : id;
    if (cur == null) return undefined;
    const split = (s) => {
      const [name, a] = s.split('{');
      return a ? [name, (args || {})[a.slice(0, -1)] || {}] : [name, {}];
    };
    const parts = path
      .replace(/\[(\d+)\]/g, '.$1')
      .replace(/\((.*?)\.(.*?)\)/g, '($1_*_*_*_*_$2)')
      .split('.')
      .map((p) => p.replaceAll('_*_*_*_*_', '.'));
    for (const p of parts) {
      if (p === '*') return cur;
      if (p.startsWith('^^')) cur = cur.getLinkedRecords(...split(p.slice(2)));
      else if (p.startsWith('^')) cur = cur.getLinkedRecord(...split(p.slice(1)));
      else if (/^\d+$/.test(p)) cur = cur[Number(p)];
      else cur = cur.getValue(...split(p));
      if (cur == null) return cur;
    }
    return cur;
  }

  const DELIVERY = {
    video_delivery_request: {
      dash_manifest_requests: [{}],
      dash_manifest_url_requests: [{}],
      hls_playlist_url_requests: [{}],
      progressive_url_requests: [{ quality: 'SD' }, { quality: 'HD' }],
    },
  };

  function readVideo(id) {
    const out = { sd: '', hd: '', mpd: '' };
    const guard = (f) => {
      try {
        return f();
      } catch {
        return undefined;
      }
    };
    out.sd = guard(() => sf(id, 'playable_url')) || '';
    out.hd = guard(() => sf(id, 'playable_url{$1}', { $1: { quality: 'HD' } })) || '';
    out.mpd =
      guard(() => sf(id, 'playlist{$1}', { $1: { scrubbing_preference: 'MPEG_DASH' } })) ||
      guard(() => sf(id, '^video_delivery_response{$1}.^^dash_manifests[0].manifest_xml', { $1: DELIVERY })) ||
      '';
    guard(() => sf(id, '^video_delivery_response{$1}.^^progressive_urls.*', { $1: DELIVERY }))?.forEach((rec) => {
      const q = guard(() => sf(rec.getDataID(), '^metadata.quality'));
      const u = guard(() => sf(rec.getDataID(), 'progressive_url'));
      if (u && q === 'HD' && !out.hd) out.hd = u;
      if (u && q === 'SD' && !out.sd) out.sd = u;
    });
    return out;
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.data?.__vsniffer !== 3) return;
    let result = null;
    try {
      result = { store: !!window.___rs, ...readVideo(String(e.data.id)) };
    } catch {}
    window.postMessage({ __vsniffer: 4, req: e.data.req, result }, '*');
  });
})();
