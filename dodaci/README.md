# Dodaci — ulaz za nove funkcije bez kompajliranja

Svaki folder ovdje koji ima `manifest.json` (obična Chrome ekstenzija, MV3) Ice učita pri startu,
bez kompajliranja browsera. Dovoljno je napraviti novi `.deb` (par minuta, `core-build/package-deb.sh`).

- U paketu: `/opt/ice-browser/dodaci/<ime>/` (samo za čitanje, vlasnik root).
- Učitavaju se kao obične ekstenzije (kao `--load-extension`), kod ostaje netaknut.
- Prekidač u Postavke → Napredne funkcije imaju: `sn-downloader`, `video-sniffer`.
  Ostali dodaci su uvijek uključeni. (Novi prekidač za novi dodatak = mala izmjena jezgre.)
- Statička DNR pravila rade (indeksiraju se u korisnički folder, zakrpa ice-08).

Već uključeno u paket (izvor u repou):
- `sn-downloader` ← `own-extensions/Ultimate SN Downloader/extension`
- `video-sniffer` ← `own-extensions/video-sniffer`
- `ice-shield`    ← `ice-features/ice-shield` (sigurnosni sloj; liste se same ažuriraju)
- + svaki folder u ovom `dodaci/` direktoriju.

- `ice-uvoz` (ovdje u `dodaci/`): uvoz iz drugog browsera. Stranica dodatka razgovara s
  `/opt/ice-browser/uvoz/ice-uvoz.py` (izvor: `core-build/uvoz/`) preko native messaginga `ice.uvoz`.

## Tuđi/vlastiti kod se ne mijenja
`own-extensions/` (SN Downloader, Video Sniffer) ide u paket bajt-za-bajt, bez Iceovih izmjena. Sve što Ice
treba oko njih rješava se izvan njihovog koda (jezgra, launcher, poseban dodatak).

Napomena o kešu: preglednik drži keširanu pozadinsku skriptu dodatka i ne uzima novu samo zato što se fajl
promijenio; nova se učita kad se promijeni IME ulazne skripte u manifestu (`background.service_worker`).
