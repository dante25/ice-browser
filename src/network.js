// Jedini mrežni filter u Iceu. Electron dozvoljava samo jedan onBeforeRequest
// po sesiji, pa ovdje kasnije dolazi i blocker reklama.
const LOCAL_HOST = /^(localhost|127\.\d+\.\d+\.\d+|\[::1\]|10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+)$|\.(localhost|local|test|lan|internal|home\.arpa)$/;

// Greške koje znače "HTTPS ne radi na ovoj stranici" (veza odbijena, istek, loš certifikat...).
// -105 (nepostojeći domen) nije tu: tada ni http ne bi radio.
// -310 previše preusmjeravanja, -320 neispravan odgovor, -324 prazan odgovor.
const HTTPS_BROKEN_HTTP_ERRORS = new Set([-310, -320, -324]);
function httpsUnavailable(code) {
  return (code <= -100 && code >= -199 && code !== -105) || (code <= -200 && code >= -299) || HTTPS_BROKEN_HTTP_ERRORS.has(code);
}

// Briše neuspjeli https pokušaj iz historije, da "nazad" ne vodi na stranicu greške
function dropFailedEntry(contents, failedUrl) {
  const h = contents.navigationHistory;
  if (typeof h?.removeEntryAtIndex !== 'function') {
    if (process.env.ICE_DEBUG) console.log('[ice] historija: removeEntryAtIndex ne postoji');
    return;
  }
  const entries = h.getAllEntries();
  if (process.env.ICE_DEBUG) console.log('[ice] historija:', h.getActiveIndex(), entries.map((e) => e.url).join(' | '));
  for (let i = entries.length - 1; i >= 0; i--) {
    if (i === h.getActiveIndex()) continue;
    if (entries[i].url === failedUrl || entries[i].url.startsWith('chrome-error://')) {
      const ok = h.removeEntryAtIndex(i);
      if (process.env.ICE_DEBUG) console.log('[ice] historija: brišem', i, entries[i].url, 'aktivni', h.getActiveIndex(), '->', ok);
      return;
    }
  }
}

// http izuzetak za "primjer.com" vrijedi i za "www.primjer.com", "neki.primjer.com"...
function httpAllowed(allowSet, host) {
  for (const a of allowSet) if (host === a || host.endsWith(`.${a}`)) return true;
  return false;
}

function setupNetwork(ses, { blocklist, interstitial, allow }) {
  const upgraded = new Map(); // webContentsId -> host koji smo prebacili na https

  ses.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (d, cb) => {
    let u;
    try { u = new URL(d.url); } catch { return cb({}); }
    const host = u.hostname;

    // 1) Phishing: glavna stranica dobija upozorenje, sve ostalo (slike, skripte) se prekida
    if (!allow.phishing.has(host) && blocklist.isBlocked(host)) {
      if (d.resourceType === 'mainFrame') return cb({ redirectURL: interstitial.create('phishing', d.url) });
      return cb({ cancel: true });
    }

    // 2) HTTPS-first za glavnu stranicu (lokalne adrese se ne diraju)
    if (d.resourceType === 'mainFrame' && u.protocol === 'http:' && !LOCAL_HOST.test(host) && !httpAllowed(allow.http, host)) {
      u.protocol = 'https:';
      if (d.webContentsId != null) upgraded.set(d.webContentsId, host);
      return cb({ redirectURL: u.toString() });
    }

    cb({});
  });

  // Global Privacy Control: stranicama šaljemo "ne prodaji i ne dijeli moje podatke"
  ses.webRequest.onBeforeSendHeaders((d, cb) => {
    d.requestHeaders['Sec-GPC'] = '1';
    cb({ requestHeaders: d.requestHeaders });
  });

  // Ako https ne radi, ponudi povratak na http preko stranice upozorenja
  function watch(contents) {
    contents.on('did-fail-load', (_e, code, _desc, url, isMainFrame) => {
      if (!isMainFrame) return;
      const host = upgraded.get(contents.id);
      if (!host || !httpsUnavailable(code)) return;
      let u;
      try { u = new URL(url); } catch { return; }
      if (u.protocol !== 'https:' || u.hostname !== host) return;
      upgraded.delete(contents.id);
      u.protocol = 'http:';
      const warning = interstitial.create('https', u.toString());
      const onNav = (_ev, navUrl) => {
        if (navUrl !== warning) return;
        contents.off('did-navigate', onNav);
        dropFailedEntry(contents, url);
      };
      contents.on('did-navigate', onNav);
      contents.loadURL(warning).catch(() => contents.off('did-navigate', onNav));
    });
    contents.on('did-navigate', () => upgraded.delete(contents.id));
    contents.on('destroyed', () => upgraded.delete(contents.id));
  }

  return { watch };
}

module.exports = { setupNetwork };
