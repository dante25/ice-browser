/* Ultimate SN Downloader — content-script bridge: answers the popup, runs scan jobs, talks to the service worker. */
(function () {
  if (window.__usnBridge) return;
  window.__usnBridge = true;
  var runningJob = null, cancelled = {}, port = null, hbTimer = null;

  function sw(msg, tries) {
    tries = tries === undefined ? 4 : tries;
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (resp) {
          if (chrome.runtime.lastError) {
            if (tries > 0) return setTimeout(function () { sw(msg, tries - 1).then(resolve); }, 700);
            return resolve(null);
          }
          resolve(resp);
        });
      } catch (e) { resolve(null); }
    });
  }

  function site() {
    for (var k in USD.sites) if (USD.sites[k].match()) return USD.sites[k];
    return null;
  }

  function connect(jobId) {
    try {
      port = chrome.runtime.connect({ name: 'job:' + jobId });
      port.onDisconnect.addListener(function () { port = null; if (runningJob === jobId) setTimeout(function () { connect(jobId); }, 800); });
      clearInterval(hbTimer);
      hbTimer = setInterval(function () { try { port && port.postMessage({ hb: 1 }); } catch (e) {} }, 20000);
    } catch (e) {}
  }

  function makeCtx(job) {
    var seen = 0;
    var ctx = {
      job: job, sel: job.sel, target: job.target || null, state: {}, stopAtKnown: !!job.stopAtKnown, resume: job.cursors || {}, done: job.partsDone || {},
      saveCursor: function (part, cursor) { ctx.resume[part] = cursor; sw({ t: 'cursor', jobId: job.id, part: part, cursor: cursor }, 0); },
      partDone: function (part) { ctx.done[part] = true; sw({ t: 'part:done', jobId: job.id, part: part }, 0); },
      unseen: async function (items) { var r = await sw({ t: 'seen:filter', jobId: job.id, items: items }, 10); return (r && r.keys) || items.map(function (m) { return m.key; }); },
      log: function () { USD.log.apply(null, arguments); sw({ t: 'log', jobId: job.id, msg: [].slice.call(arguments).join(' ') }, 0); },
      checkCancel: function () { if (cancelled[job.id]) throw USD.Err('cancel', 'Cancelled'); },
      sleep: async function (ms) { var end = Date.now() + ms; while (Date.now() < end) { ctx.checkCancel(); await USD.sleep(Math.min(500, end - Date.now())); } },
      gate: async function (kind) {
        ctx.checkCancel();
        var r = await sw({ t: 'gate', jobId: job.id, kind: kind }, 20);
        if (!r || r.cancel) { cancelled[job.id] = true; throw USD.Err('cancel', 'Cancelled'); }
      },
      blocked: async function (reason) { await sw({ t: 'blocked', jobId: job.id, reason: reason }, 20); },
      navigate: async function (step) { await sw({ t: 'job:addstep', jobId: job.id, step: step }); location.href = step.url; await new Promise(function () {}); },
      send: function (m) { return sw(Object.assign({ jobId: job.id }, m), 20); },
      warn: function (text) { sw({ t: 'progress', jobId: job.id, warn: text }, 0); },
      status: function (text) { sw({ t: 'progress', jobId: job.id, phase: text }, 0); },
      scanned: function (n) { sw({ t: 'progress', jobId: job.id, scanned: n }, 0); },
      total: function (n) { if (n) sw({ t: 'progress', jobId: job.id, total: n }, 0); },
      wants: function (kind, part) {
        if (part === 'reels' || part === 'stories' || part === 'highlights') return !!job.sel.storyreel;
        return kind === 'video' ? !!job.sel.videos : !!job.sel.photos;
      },
      emit: function (items, part) {
        if (job.site === 'ig' || job.site === 'x' || job.site === 'da' || job.site === 'fl') { seen += items.length; sw({ t: 'progress', jobId: job.id, scanned: seen }, 0); }
        var keep = items.filter(function (m) { return ctx.wants(m.kind, part); });
        if (keep.length) sw({ t: 'media', jobId: job.id, items: keep, part: part }, 20);
        return keep.length;
      }
    };
    return ctx;
  }

  async function runJob(job) {
    runningJob = job.id; cancelled[job.id] = false;
    connect(job.id);
    var s = USD.sites[job.site], ctx = makeCtx(job);
    try {
      if (s.scanStep) {
        for (var i = job.stepIndex || 0; i < job.steps.length; i++) {
          var step = job.steps[i];
          if (!s.samePage(step.url)) {
            await sw({ t: 'job:step', jobId: job.id, stepIndex: i, navigating: true });
            location.href = step.url;
            return;
          }
          await sw({ t: 'job:step', jobId: job.id, stepIndex: i });
          await s.scanStep(ctx, step);
        }
      } else {
        await s.scan(ctx);
      }
      await sw({ t: 'scan:done', jobId: job.id });
    } catch (e) {
      USD.log('scan failed', e);
      await sw({ t: 'scan:done', jobId: job.id, error: e.message || String(e), kind: e.kind || 'error' });
    } finally {
      if (runningJob === job.id) runningJob = null;
      clearInterval(hbTimer);
      try { port && port.disconnect(); } catch (e2) {}
    }
  }

  chrome.runtime.onMessage.addListener(function (msg, sender, respond) {
    if (!msg || !msg.t) return;
    if (msg.t === 'describe') {
      var s = site();
      var d = s ? s.describe() : { site: '', type: 'home' };
      respond(Object.assign({ busy: !!runningJob }, d));
      return;
    }
    if (msg.t === 'start') {
      var st = site();
      if (!st) return respond({ error: 'Open an Instagram or Facebook page first.' });
      if (runningJob) return respond({ error: 'A scan is already running in this tab.' });
      var d2 = st.describe();
      var steps = st.plan && !msg.resumeJobId ? st.plan(msg.sel, msg.target) : [];
      sw({ t: 'job:create', site: d2.site, type: d2.type, label: msg.target ? ((d2.site === 'ig' ? 'Video ' : 'Video ') + (msg.target.id || '')) : (d2.label || d2.id), url: location.href, sel: msg.sel, speed: msg.speed, opts: msg.opts || {}, steps: steps, stopAtKnown: !!msg.stopAtKnown, resumeJobId: msg.resumeJobId, target: msg.target || null }).then(function (r) {
        if (!r || !r.job) return respond({ error: 'Background service did not answer.' });
        respond({ ok: true, jobId: r.job.id });
        runJob(r.job);
      });
      return true;
    }
    if (msg.t === 'job:cancel') { cancelled[msg.jobId] = true; respond({ ok: true }); return; }
  });

  // after Facebook navigated this tab to the next section the job continues here
  function resume() {
    sw({ t: 'resume' }, 2).then(function (r) {
      if (r && r.job && !runningJob) setTimeout(function () { runJob(r.job); }, 2500);
    });
  }
  if (document.readyState === 'complete') resume(); else window.addEventListener('load', resume);
})();
