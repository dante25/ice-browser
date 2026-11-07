# Ice: komande

Ice se pokreće iz menija aplikacija (ikona Ice) ili komandom `ice`.

## Pokretanje
```bash
ice                          # otvori Ice
ice https://primjer.ba       # otvori stranicu
ice --features               # spisak ugrađenih funkcija
ice --feature video-sniffer off   # isključi funkciju s prekidačem (sn-downloader, video-sniffer, yt-multiselect)
```

## Prenos iz Google Chromea (Ice mora biti zatvoren)
```bash
ice --import-chrome                   # sve, uključujući lozinke
ice --import-chrome --skip-passwords  # sve osim lozinki
```
Prije prenosa se pravi rezervna kopija Ice profila (`~/.config/Ice/chromium/backup-...`).

## Testovi i čuvar (iz foldera projekta)
```bash
cd ~/ice-browser
npm test                           # sigurnosni testovi + pregled slika
npm run guardian                   # provjeri i testiraj noviji motor
npm run guardian -- --apply        # uključi testirani motor
npm run guardian -- --rollback     # vrati prethodni motor
npm run guardian -- --install      # instaliraj motor (novi računar)
npm run install-desktop            # ikona u meniju + komanda ice
```

Dnevni čuvar (systemd, uključen):
```bash
systemctl --user list-timers ice-guardian.timer
journalctl --user -u ice-guardian.service -n 30
systemctl --user disable --now ice-guardian.timer
```

## Novi računar
```bash
git clone https://github.com/dante25/ice-browser ~/ice-browser
cd ~/ice-browser && npm run guardian -- --install && npm run install-desktop
```

## GitHub
```bash
cd ~/ice-browser && git add -A && git commit -m "opis" && git push
```
