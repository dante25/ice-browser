# Ice: sve komande na jednom mjestu

Sve komande se pokreću iz foldera projekta:
```bash
cd ~/ice-browser
```

## Pokretanje
```bash
npm start                          # otvori Ice
npm start -- https://primjer.ba    # otvori Ice na određenoj stranici
ICE_DEBUG=1 npm start              # s debug logom (navigacija, greške, phishing liste)
```

## Prenos iz Chromea
```bash
npm start -- --import-all                   # SVE: bookmarks, lozinke, autofill, historija, postavke, dozvole, ekstenzije
npm start -- --import-all --skip-passwords  # sve osim lozinki
```
Pojedinačno:
```bash
npm start -- --import-bookmarks
npm start -- --import-autofill
npm start -- --import-passwords ~/Downloads/lozinke.csv   # iz Chromeovog CSV izvoza
shred -u ~/Downloads/lozinke.csv                          # obavezno poslije CSV uvoza
```
Drugi Chromium profil (npr. Brave):
```bash
ICE_CHROME_PROFILE=~/.config/BraveSoftware/Brave-Browser/Default npm start -- --import-all
```

## Sigurnost i testovi
```bash
npm test               # 19 sigurnosnih testova na pravom Iceu (HTTPS, phishing, malware, dozvole, izuzeci, GPC, WebRTC)
npm run check-chrome   # verzije: Chrome, Brave, Iceov motor
```

## Izuzeci (stranice koje si "ipak otvorio" na upozorenju)
```bash
npm start -- --list-exceptions    # pregled; vrijede 30 dana
npm start -- --clear-exceptions   # obriši sve
```

## Čuvar (updatei motora)
```bash
npm run guardian                    # provjeri i testiraj noviji motor, ako postoji
npm run guardian -- --apply         # primijeni testirani update (tvoje odobrenje)
npm run guardian -- --target 45.2.2 # testiraj tačno određenu verziju
cat ~/.config/Ice/guardian.json     # zadnje stanje čuvara
```
Vraćanje na prethodni motor (čuvar ispiše tačnu verziju poslije `--apply`):
```bash
npm install --save-dev --save-exact electron@<stara-verzija>
```

Dnevni timer (uključen):
```bash
systemctl --user list-timers ice-guardian.timer       # kad je sljedeća provjera
journalctl --user -u ice-guardian.service -n 30       # log čuvara
systemctl --user start ice-guardian.service           # pokreni provjeru odmah
systemctl --user disable --now ice-guardian.timer     # isključi
systemctl --user enable --now ice-guardian.timer      # ponovo uključi
```

## Gdje su podaci
| Fajl u `~/.config/Ice/` | Šta |
|---|---|
| `bookmarks.json` | bookmarks |
| `vault.bin` | lozinke (šifrirano, GNOME keyring) |
| `autofill.bin` | adrese i historija formi (šifrirano) |
| `history.sqlite` | historija i preuzimanja |
| `settings.json` | postavke iz Chromea |
| `permissions.json` | dozvole po stranicama |
| `extensions/`, `extensions.json` | ekstenzije (kopirane, još se ne učitavaju) |
| `blocklists/` | liste opasnih stranica (phishing + malware) |
| `exceptions.json` | izuzeci s upozorenja (30 dana) |
| `guardian.json` | stanje čuvara |

## GitHub
Privatni repozitorij: https://github.com/dante25/ice-browser (nalog `dante25`, prijava preko `gh`).
```bash
git add -A && git commit -m "opis promjene" && git push   # spremi i pošalji promjene
git status                                                 # šta je promijenjeno
```
`.gitignore` drži lične podatke (lozinke, bookmarks, historija, ekstenzije) van repozitorija.

## Node.js
Instaliran u `~/.local/node` (v26 LTS), komande `node`/`npm` preko `~/.local/bin`.
