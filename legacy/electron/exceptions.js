// Izuzeci koje odobriš na stranici upozorenja ("ipak nastavi").
// Pamte se u ~/.config/Ice/exceptions.json i vrijede 30 dana, pa Ice ponovo pita:
// stranica se u međuvremenu može promijeniti (http stranica dobije https, sigurna postane opasna).
const { jsonStore } = require('./store');

const DAYS = 30;
const KINDS = ['phishing', 'http'];

function createExceptions(file) {
  const store = jsonStore(file, {});
  for (const k of KINDS) store.data[k] ||= {};

  const fresh = (iso) => Date.now() - Date.parse(iso) < DAYS * 24 * 60 * 60 * 1000;

  let pruned = false;
  for (const k of KINDS) {
    for (const [host, added] of Object.entries(store.data[k])) {
      if (!fresh(added)) { delete store.data[k][host]; pruned = true; }
    }
  }
  if (pruned) store.save();

  const view = (k) => ({
    has: (host) => !!store.data[k][host] && fresh(store.data[k][host]),
    add: (host) => { store.data[k][host] = new Date().toISOString(); store.save(); },
    *[Symbol.iterator]() {
      for (const [host, added] of Object.entries(store.data[k])) if (fresh(added)) yield host;
    },
  });

  return {
    phishing: view('phishing'),
    http: view('http'),
    days: DAYS,
    list: () => store.data,
    clear: () => { for (const k of KINDS) store.data[k] = {}; store.save(); },
  };
}

module.exports = { createExceptions };
