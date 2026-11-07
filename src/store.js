// Mali JSON spremnik u ~/.config/Ice (samo vlasnik može čitati).
const fs = require('fs');
const path = require('path');

function jsonStore(file, fallback) {
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    data = fallback;
  }
  return {
    data,
    save() {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, JSON.stringify(data, null, 1), { mode: 0o600 });
    },
  };
}

module.exports = { jsonStore };
