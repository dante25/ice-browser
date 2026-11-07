# Ice browser

Lagani browser na Chromium motoru (Electron). Prioritet: motor, pa sučelje, pa ekstenzije.

## Faze
1. **Motor (sada):** lagan i zaštićen Chromium, bez pozadinskog saobraćaja.
2. **Sigurnost i updatei:** "čuvar" van browsera prati Chromium/Electron izdanja i CVE liste, diže verziju, gradi, testira, a ti odobriš izdanje.
3. **Sučelje:** tabovi, adresna traka, bočna traka.
4. **Blocker reklama** (u stilu AdGuarda na Androidu, na nivou mreže).
5. **Downloaderi** (društvene mreže, slike i video).

## Pokretanje
```bash
cd ~/ice-browser
npm install
npm start
```
Provjera verzija: `npm run check-chrome`
Sigurnosni test (pokreće Ice i provjerava sve zaštite): `npm test`
Debug log: `ICE_DEBUG=1 npm start`

## Sigurnosna lista za motor
- [x] Sandbox za sve procese (`app.enableSandbox()`)
- [x] `contextIsolation` uključen, `nodeIntegration` isključen
- [x] Bez `<webview>`, navigacija samo http/https
- [x] Sve dozvole (kamera, mikrofon, lokacija) zabranjene
- [x] Googleovi pozadinski servisi ugašeni (sync, pings, component update, breakpad)
- [x] Dozvole po upitu (kamera, mikrofon, lokacija, obavještenja...), odluke se pamte po stranici u `permissions.json`
- [x] Zaštita od phishinga i malwarea bez Googlea: ~600.000 domena (Phishing.Database, OpenPhish, URLhaus preko malware-filter, HaGeZi Threat Intelligence), provjera lokalno, osvježavanje svakih 6 h, ~5 MB RAM-a; velike platforme (GitHub, Google Docs...) se nikad ne blokiraju cijele
- [x] HTTPS-first: http se prebacuje na https; ako https ne radi, upozorenje s izborom "nastavi"
- [x] WebRTC ne otkriva lokalnu IP adresu
- [x] Global Privacy Control (`Sec-GPC: 1`): stranicama "ne prodaji moje podatke"
- [x] Trajni izuzeci za upozorenja: pamte se 30 dana u `exceptions.json` (`--list-exceptions`, `--clear-exceptions`)
- [x] Čuvar za nove verzije motora (vidi ispod)
- [ ] Potpisani update kanal (tek kad Ice dijelimo drugima)

## Čuvar (updatei motora)
```bash
npm run guardian            # provjeri; ako ima noviji motor, testira ga u odvojenoj kopiji
npm run guardian -- --apply # primijeni testirani update (tek na tvoje odobrenje)
```
- Uspoređuje Iceov motor s najnovijim Electronom i Google Chromeom, upozorava ako glavna verzija više ne dobija zakrpe.
- Spisak sigurnosnih zakrpa (CVE) iz Electronovih release notes.
- Kandidat se gradi u `~/.cache/ice-guardian/candidate` i mora proći svih 19 sigurnosnih testova; pravi Ice se ne dira.
- Stanje u `~/.config/Ice/guardian.json`, obavještenje na desktopu.
- `--apply` nikad ne vraća motor unazad i ispisuje komandu za povratak.

Dnevno automatsko pokretanje (systemd timer, uključuje se ručno):
```bash
mkdir -p ~/.config/systemd/user && cp ~/ice-browser/scripts/systemd/ice-guardian.* ~/.config/systemd/user/ && systemctl --user daemon-reload && systemctl --user enable --now ice-guardian.timer
```

## Prenos iz Chromea (sve odjednom)
```bash
npm start -- --import-all                   # sve, uključujući lozinke direktno iz Chromea
npm start -- --import-all --skip-passwords  # sve osim lozinki
```
Čita Chrome profil sa diska (samo čita, kopije baza), ne treba internet. Ispisuje samo brojeve.

| Šta | Gdje u Iceu |
|---|---|
| Bookmarks (račun + lokalni) | `bookmarks.json` |
| Lozinke, direktno, ključem "Chrome Safe Storage" iz keyringa; bez CSV-a | `vault.bin` (šifrirano) |
| Adrese i historija formi | `autofill.bin` (šifrirano) |
| Historija i preuzimanja | `history.sqlite` |
| Pretraživači, početna, jezici, zoom, fontovi, tema | `settings.json` |
| Dozvole po stranicama (kamera, lokacija...) | `permissions.json` (Ice ih odmah koristi) |
| Ekstenzije (Web Store + raspakovane) i njihovi podaci | `extensions/` + `extensions.json` (još se ne učitavaju) |

Namjerno se ne prenose: bankovne kartice, Google tokeni i kolačići (prijave). U Iceu se jednom ponovo prijaviš.
Drugi Chromium profil (npr. Brave): `ICE_CHROME_PROFILE=<putanja do profila> npm start -- --import-all`

## Sinkronizacija
Google od 2021. ne dozvoljava Chrome Sync preglednicima koji nisu Chrome, pa Ice ne može koristiti Google sync.
Plan:
- [x] Kompletan prenos iz Chromea: `npm start -- --import-all` (vidi gore)
- [x] Uvoz bookmarksa iz Chromea: `npm start -- --import-bookmarks` (u `~/.config/Ice/bookmarks.json`)
- [x] Uvoz lozinki iz Chromeovog CSV izvoza: `npm start -- --import-passwords <fajl.csv>` (šifrirano u `~/.config/Ice/vault.bin` ključem iz GNOME keyringa)
- [x] Uvoz adresa i historije formi: `npm start -- --import-autofill` (šifrirano u `~/.config/Ice/autofill.bin`). Kartice i Google tokeni se namjerno ne uvoze.
- [ ] Prikaz bookmarksa i automatsko popunjavanje lozinki i adresa (faza sučelja)
- [ ] Lozinke i dalje dostupne na passwords.google.com
- [ ] Kasnije: vlastiti šifrirani sync za Ice

## Napomene
- Motor: Electron 45.2.3 (Chromium 156). Verzija je zaključana u package.json i mijenja se samo namjerno.
- Update motora nije automatski: podižemo verziju Electrona. Zaostajanje znači poznate sigurnosne rupe.
- Browser ne mijenja sam svoj kod dok radi. Zakrpe idu kroz novo izdanje.
