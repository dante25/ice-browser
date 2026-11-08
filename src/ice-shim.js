// Ice: ugrađene funkcije ne smiju otvarati stranice dobrodošlice ("hvala što ste instalirali").
// Chromium ekstenzije učitane iz Icea tretira kao tek instalirane pri svakom pokretanju, pa
// onInstalled okida uvijek. Ovaj kod se izvršava PRIJE originalnog koda ekstenzije: dok traje
// onInstalled (30 s), otvaranje tabova, prozora i stranice postavki se preskače. Ostatak onInstalled
// posla (postavke, meniji desnog klika...) radi normalno.
(() => {
  const g = globalThis;
  let until = 0;
  const quiet = () => Date.now() < until;
  const guard = (obj, name) => {
    try {
      const orig = obj && obj[name];
      if (typeof orig !== 'function') return;
      Object.defineProperty(obj, name, {
        configurable: true, writable: true,
        value: function (...args) {
          if (quiet()) {
            const cb = args.find((a) => typeof a === 'function');
            if (cb) try { cb(undefined); } catch { /* ignoriši */ }
            return Promise.resolve(undefined);
          }
          return orig.apply(this, args);
        },
      });
    } catch { /* API je zaključan: ostaje kako jeste */ }
  };
  for (const ns of ['chrome', 'browser']) {
    const c = g[ns];
    if (!c) continue;
    guard(c.tabs, 'create');
    guard(c.windows, 'create');
    guard(c.runtime, 'openOptionsPage');
    try {
      const ev = c.runtime.onInstalled;
      const add = ev.addListener.bind(ev);
      Object.defineProperty(ev, 'addListener', {
        configurable: true, writable: true,
        value: (fn, ...rest) => add((d) => { until = Date.now() + 30000; return fn(d); }, ...rest),
      });
    } catch { /* nema onInstalled */ }
  }
})();
