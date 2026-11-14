# Ice: komande

Ice se pokreće iz menija aplikacija (ikona Ice) ili komandom `ice`.

## Pokretanje
```bash
ice                          # otvori Ice
ice https://primjer.ba       # otvori stranicu
ice --features               # spisak ugrađenih funkcija
ice --feature video-sniffer off   # isključi funkciju s prekidačem (sn-downloader, video-sniffer, yt-multiselect)
```

## Tema
Bira se u Ice panelu (Ice postavke, Tema) ili komandom; primjenjuje se pri sljedećem pokretanju:
```bash
ice --theme auto       # prati sistem (svijetla/tamna)
ice --theme light      # Ice svijetla
ice --theme dark       # Ice tamna
ice --theme chromium   # Chromiumova zadana (bez Ice teme)
```

## Uvoz iz drugog browsera
U Iceu: Ice panel, Ice postavke, **Uvoz iz drugog browsera** (ili Meni, Uvoz iz drugog browsera). Odabereš browser i
šta se uvozi; Ice se sam zatvori, uveze i ponovo otvori. Podaci se dodaju postojećim, ništa se ne briše.
Podržano: Chrome, Chromium, Brave, Edge, Vivaldi, Opera (bookmarks, historija, lozinke, dozvole stranica i zoom; svi profili)
i Firefox (bookmarks, historija; lozinke preko CSV fajla u chrome://password-manager/settings).

Iz terminala (Ice mora biti zatvoren):
```bash
ice --import-list                        # pronađeni browseri i profili
ice --import 1                           # uvezi sve iz browsera broj 1
ice --import 1 --only bookmarks,history  # samo odabrano (bookmarks, history, passwords, settings)
```

## Traka s bookmarksima
`Ctrl+Shift+B` je pali i gasi odmah. Isto u Ice panelu (Ice postavke, Izgled) i u chrome://settings/appearance.

## Zamjena Ice profila Chromeovim (Ice mora biti zatvoren)
Za razliku od uvoza, ovo ZAMJENJUJE Iceove bookmarkse i historiju Chromeovim.
```bash
ice --import-chrome                   # sve, uključujući lozinke
ice --import-chrome --skip-passwords  # sve osim lozinki
```
Prije prenosa se pravi rezervna kopija Ice profila (`~/.config/Ice/chromium/backup-...`).

## Sync preko Google Drivea
Jednom: odobri Drive (samo Iceovi fajlovi), pa postavi sync lozinku.
```bash
rclone config create ice-drive drive scope=drive.file
ice --sync-setup
```
Poslije toga sync radi sam: pri zatvaranju Icea šalje profil, pri pokretanju preuzima noviji s drugog uređaja.
Ručno (Ice zatvoren za preuzimanje):
```bash
ice --sync-push      # pošalji sada
ice --sync-pull      # preuzmi noviji (--force: preuzmi bez obzira)
ice --sync-status    # stanje
```
Šta se sinkronizuje: bookmarks, lozinke, dozvole po stranicama, zoom, jezici, zadani pretraživač.
Na Driveu je jedan fajl `Ice Sync/profil.icesync`, šifriran sync lozinkom (AES-256-GCM). Bez lozinke se ne može otvoriti.
Pravilo: zadnja izmjena pobjeđuje; prije svakog preuzimanja pravi se rezervna kopija (`~/.config/Ice/chromium/backup-sync-...`).
Log: `~/.config/Ice/sync.log`

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
