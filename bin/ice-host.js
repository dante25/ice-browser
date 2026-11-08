#!/usr/bin/env node
// Native messaging host: Ice panel mu šalje izbor teme, a on ga upisuje u ui.json (čita pokretač).
// Chromium ga pokreće samo za Ice panel (allowed_origins), poruka je { theme: auto|light|dark|chromium }.
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
    if (!['auto', 'light', 'dark', 'chromium'].includes(msg.theme)) throw new Error('Nepoznata tema.');
    fs.mkdirSync(CONFIG, { recursive: true });
    const file = path.join(CONFIG, 'ui.json');
    let ui = {}; try { ui = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* prvi put */ }
    fs.writeFileSync(file, JSON.stringify({ ...ui, theme: msg.theme }));
    send({ ok: true, theme: msg.theme });
  } catch (e) {
    send({ ok: false, error: e.message });
  }
  process.exit(0);
});
