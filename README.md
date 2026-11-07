# Ice browser

Ice = **ungoogled-chromium** (Chromium bez Googlea, pun sistem ekstenzija) + Iceove ugrađene funkcije,
zaštite i čuvar. Komande: [KOMANDE.md](KOMANDE.md). Plan ugrađenih funkcija: [PLAN-SUCELJE.md](PLAN-SUCELJE.md).

## Građa
| Dio | Gdje |
|---|---|
| Pokretač (profil, postavke, učitavanje funkcija) | `bin/ice.js` |
| Motor (ungoogled-chromium) | `~/.local/share/ice/chromium/current` |
| Profil (bookmarks, historija, lozinke...) | `~/.config/Ice/chromium` |
| Ice Shield: phishing/malware, HTTPS-first, GPC | `ice-features/ice-shield` |
| Pregled slika na Google Images | `ice-features/google-images-viewer` |
| Originalne ekstenzije (ugrađene) | `chrome-extensions/`, `own-extensions/` |
| Popravke grešaka ekstenzija (preživljavaju updatee) | `src/ext-patches.js` |
| Prenos iz Google Chromea | `src/import-chrome.js` |
| Čuvar motora | `scripts/guardian.mjs` |
| Testovi | `test/smoke.mjs`, `test/gimages.mjs` |
| Stari Electron pokušaj (samo za referencu) | `legacy/electron/` |

## Zaštite
- [x] Phishing i malware: ~600.000 domena (Phishing.Database, OpenPhish, URLhaus/malware-filter, HaGeZi TIF), lokalno, osvježavanje svakih 6 h; velike platforme se nikad ne blokiraju cijele; izuzeci 30 dana
- [x] HTTPS-first: http -> https prije slanja zahtjeva; ako https ne radi, upozorenje s "nastavi"; lokalne adrese ostaju http
- [x] Global Privacy Control (zaglavlje + `navigator.globalPrivacyControl`)
- [x] WebRTC ne otkriva lokalnu IP adresu
- [x] Dozvole (kamera, lokacija...) po upitu, Chromiumov sistem
- [x] Čuvar: novi motor se skida, provjerava SHA-256, testira, uključuje tek na odobrenje (`--apply`), povratak (`--rollback`)

## Zašto ne Electron
Electron nema `declarativeNetRequest`, `downloads`, `bookmarks`, a `webRequest` ekstenzija ne radi uz vlastiti mrežni filter.
Pet ugrađenih funkcija (Adblock for YouTube, oba downloadera, Video Sniffer, Search by Image) zato ne bi radilo.
U ungoogled-chromiumu sve rade (testirano).

## Ograničenja
- Sučelje je Chromiumovo (teme i boje se mogu mijenjati; vlastiti raspored traži kompajliranje Chromiuma).
- Google sync ne radi (Google ga je 2021. isključio za Chromium). Umjesto njega: Iceov šifrirani sync preko Google Drivea (rclone, `src/sync.js`).
- Autofill iz Chromea 157 nije prenesen (baza novija od Chromiuma 156).
