#!/usr/bin/env node
// Native messaging host: most između Ice panela i pokretača. Chromium ga pokreće samo za Ice panel (allowed_origins).
// Poruke: { theme }, { cmd: 'bookmark-bar', show }, { cmd: 'import-list' }, { cmd: 'import-start', source, what }.
const fs = require('fs');
const os = require('os');
const path = require('path');

const CONFIG = process.env.ICE_CONFIG || path.join(os.homedir(), '.config/Ice');
// Chromium drži ulaz otvorenim dok ne dobije odgovor, pa se čita tačno jedna poruka (4 bajta dužine + JSON)
const read = () => new Promise((resolve) => {
  let buf = Buffer.alloc(0);
  process.stdin.on('data', (c) => {
    buf = Buffer.concat([buf, c]);
    if (buf.length >= 4 && buf.length >= 4 + buf.readUInt32LE(0)) resolve(buf);
  });
  process.stdin.on('end', () => resolve(buf));
});
const send = (obj) => {
  const b = Buffer.from(JSON.stringify(obj));
  const len = Buffer.alloc(4); len.writeUInt32LE(b.length);
  process.stdout.write(Buffer.concat([len, b]));
};

read().then((buf) => {
  try {
    const n = buf.readUInt32LE(0);
    const msg = JSON.parse(buf.subarray(4, 4 + n).toString());
    fs.mkdirSync(CONFIG, { recursive: true });
    const file = path.join(CONFIG, 'ui.json');
    const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
    const ui = readJson(file) || {};
    if (msg.cmd === 'import-list') {
      // Spisak drugih browsera i ishod zadnjeg uvoza (putanje i ključevi ne idu u panel)
      const list = require('../src/import-browser').sources().map(({ id, label, can }) => ({ id, label, can }));
      send({ ok: true, sources: list, last: readJson(path.join(CONFIG, 'last-import.json')) });
    } else if (msg.cmd === 'import-start') {
      const src = require('../src/import-browser').sources().find((s) => s.id === msg.source);
      if (!src) throw new Error('Izvorni browser nije pronađen.');
      const what = (Array.isArray(msg.what) ? msg.what : []).filter((w) => src.can.includes(w));
      if (!what.length) throw new Error('Ništa nije odabrano za uvoz.');
      fs.writeFileSync(path.join(CONFIG, 'pending-import.json'), JSON.stringify({ source: src.id, what }));
      send({ ok: true });
      // Uvoz traži zatvoren Ice: odvojeni proces ga zatvara i pokreće ponovo, a pokretač tada uvozi
      require('child_process').spawn(process.execPath, [path.join(__dirname, 'ice.js'), '--restart'], { detached: true, stdio: 'ignore' }).unref();
    } else if (msg.cmd === 'bookmark-bar') {
      fs.writeFileSync(file, JSON.stringify({ ...ui, bookmarkBar: !!msg.show }));
      send({ ok: true });
    } else {
      if (!['auto', 'light', 'dark', 'chromium'].includes(msg.theme)) throw new Error('Nepoznata tema.');
      fs.writeFileSync(file, JSON.stringify({ ...ui, theme: msg.theme }));
      send({ ok: true, theme: msg.theme });
    }
  } catch (e) {
    send({ ok: false, error: e.message });
  }
  process.stdout.write('', () => process.exit(0));
});
