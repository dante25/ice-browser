# Ice za Android — plan i stanje

## Odluke korisnika (2026-11-14)
- Sve isto kao desktop Ice: sve funkcionalnosti i sve opcije; razlikuje se samo sučelje (prilagođeno telefonu).
- **Puna podrška za Chrome ekstenzije** (kao na desktopu). Firefox Android otpada (nema punu podršku za Chrome ekstenzije).
- Pravila za sajtove (galerije) su u jednom host fajlu koji se sam ažurira i koristi ga i desktop i Android:
  `own-extensions/Ultimate SN Downloader/extension/ihg/stock.xml` (SN Downloader 0.12.3).

## Šta je istraženo (činjenice, provjereno 2026-11-14)
| Pitanje | Nalaz |
|---|---|
| Kiwi Browser | Zadnji commit 2025-04-08, kod na **Chromiumu 105**. Mrtav i nesiguran, ne koristi se. |
| Osnova | **ungoogled-chromium-android `156.0.8078.79-1`**: ista verzija Chromiuma kao desktop Ice (156.0.8078.79). Aktivan projekat, izdanja do 2026-11. |
| Ekstenzije u toj osnovi | Već su u zakrpama: `Extensions/android-extensions-support.patch` (6230 redova), `Extensions/Ultimatum/load-crx.patch` (instalacija .crx), `Own/enable-extensions-by-default.patch` (`EnableExtensionsAndroid` uključen), `src-fix/fix-android-extensions-core-guards.patch`. README upstreama je zastario (piše da su ekstenzije ukinute na M88). |
| Chromium 156 sam | Ima eksperimentalni "desktop Android" (`is_desktop_android`, `enable_desktop_android_extensions`); ne koristimo ga, upstream ungoogled ima svoj put. |
| Gradnja | Upstream ima GitHub Actions relej (priprema + do 8 dijelova po ~5 h, APK za arm64 i arm). Isti obrazac kao desktop `core-build.yml`. |

## Šta je napravljeno
- `.github/workflows/android-build.yml`: kopija upstream releja, u pripremi dodaje Ice sloj (`android/overlay/apply.sh`: GN opcije iz `flags.ice.gn`, zakrpe iz `overlay/patches/*.patch` se dodaju na kraj `patches/series`). Pokreće se samo promjenom `android/RELEASE` ili ručno.
- **Faza 0 (prva gradnja):** nepromijenjeni upstream + prazan Ice sloj. Dokazuje lanac u ovom repou i daje APK na kojem se na telefonu provjerava šta od ekstenzija radi.

## Tema (odluka korisnika 2026-11-14)
Isti izgled kao desktop Ice (iste boje), **uz podršku za Androidove vlastite teme i boje**. Tri načina, kao `ice --theme` na desktopu, uz svijetlo/tamno/sistem:
1. **Ice** (zadano): tačne boje desktop Icea (`android/overlay/theme/ice-palette.json`, izvučeno iz `ice.css` i tema `ice-theme-light/dark`).
2. **Boje sistema** (Material You): dinamičke boje iz pozadine, Android 12+. Chromium 156 na v31+ već koristi `Theme.Material3Expressive.DynamicColors.DayNight`.
3. **Vlastita boja**: korisnik bira boju, a paleta se izvodi iz nje (Material `DynamicColorsOptions.setContentBasedSource`).
Svijetla/tamna tema prati sistem ili se bira ručno.

Stanje: **paleta i generator gotovi i provjereni na izvornom kodu Chromiuma 156**:
- `android/overlay/theme/gen-android-colors.py` pravi `ice_colors.xml` (zamjena 18 statičkih semantičkih boja iz `ui/android`, plus Material 3 `ThemeOverlay.Ice.Light/Dark`) i zakrpu `ice-30-android-theme.patch` koja ga uključuje u cilj `java_overlay_resources` u `chrome/android/BUILD.gn` (to je Chromiumov mehanizam za zamjenu resursa iz `ui/android`).
- `--check <src>` provjerava da svako ime stvarno postoji u Chromiumu (pogrešno ime ne ruši gradnju, samo ne radi ništa): 18 od 18 postoji. Zakrpa se čisto primjenjuje na `chrome/android/BUILD.gn` iz 156.0.8078.79. Material Components je 1.14.0, pa atributi (`colorSurfaceContainer*`) postoje.
- `apply.sh` je dodaje u gradnju (u sljedećoj gradnji, ne u Fazi 0).
- **Još nije napravljeno:** Java dio koji bira način (Ice / sistem / vlastita boja) i primjenjuje `ThemeOverlay.Ice.*` na aktivnosti, i stranica postavki za izbor. Mapiranje boja na Material uloge je prva procjena i treba ga pogledati na uređaju.

## Ice sloj, stanje 2026-11-16 (napravljeno, NIJE gradjeno: čeka tvoj pregled prije pakovanja)
Svaka zakrpa je provjerena na izvornom kodu 156.0.8078.79 tačno onako kako ga gradnja vidi (`android/tools/srcprep.py check`, redoslijed iz `patches/series`): svih 15 se čisto primjenjuje. C++/Java se ovdje ne može kompajlirati (Chromium traži svoj libc++), zato gradnja odmah poslije `gn gen` kompajlira samo Ice .cc fajlove (`overlay/compile-check.sh`), pa greška izađe rano.
- **Brendiranje** (`ice-01-branding.patch`, `overlay/files`, `hook.sh`): ime Ice, paket `org.ice.browser`, ikone (obična, adaptivna, monohromna za Android 13) iz desktop ikone, tekstovi "Chromium" -> "Ice" istim `ice-rebrand.py` kao desktop.
- **Tema** (`ice-30`, `ice-31-color-mode.patch`): Ice boje zadane (dan/noć), Postavke > Tema > Boje: Ice / Sistemske boje (Material You) / Vlastita boja (#RRGGBB). Promjena se odmah primjenjuje na otvorene prozore. Sistemske i vlastita trebaju Android 12+, ispod toga ostaje Ice.
- **Ugrađene ekstenzije i dodaci** (`desktop-patches.txt`, `ice-35-android-builtins.patch`, `builtins/gen-android-builtins.py`): iste desktop zakrpe (ComponentLoader + SHA-256 provjera, DNR, skriveni ugrađeni, Ice nova kartica, dodaci). 17 ugrađenih + dodaci SN Downloader, Video Sniffer, Ice Shield, Ice uvoz idu u APK (assets, nekomprimovano, ~17 MB) i pri prvom pokretanju se raspakuju u `<podaci aplikacije>/ice/` (ponovo samo kad se fajlovi promijene).
- **Postavke > Napredne funkcije** (`ice-36-advanced-settings.patch`): prekidači SN Downloader / Video Sniffer / Multiselect, isti tekstovi i prefovi kao desktop, važe poslije ponovnog pokretanja.
- **Još nije:** Ice nova kartica na telefonu (Android otvara svoju nativnu `chrome-native://newtab`; override iz ekstenzije postoji u kodu, ali treba zakrpa koja nativnu stranicu zamijeni), Ice panel ("Funkcije" i meni; na telefonu kao donji list iz menija), keep-alive po tabu.

## Sljedeće faze
1. **Brendiranje**: ime Ice, paket `org.ice.browser` (instalira se uz Chrome/ungoogled), ikona, tema (iz `core-build/branding`).
2. **Ugrađene funkcije** kao komponentne ekstenzije (prilagoditi desktop zakrpe ice-01/02/05: putanja resursa u APK-u umjesto `DIR_RESOURCES`), Ice Shield.
3. **Sučelje za telefon** (Java, WebUI gdje može): Ice panel i kartice funkcija, meni s ikonama ekstenzija i popupima, postavke Icea, tema, "Funkcije" stranica umjesto chrome://extensions.
4. **Pariteta opcija s desktopom**: sve što Ice na desktopu ima treba dobiti ekvivalent. Desktop-specifično (prenos iz Chromea, Drive sync preko rclone, native messaging host) traži zasebnu izvedbu na Androidu.
5. **Ekstenzije na telefonu**: SN Downloader, Video Sniffer i ostale se testiraju jedna po jedna.

## Poznati rizici (provjeriti na uređaju, ne pretpostavljati)
- SN Downloader piše u folder preko File System Access (`showDirectoryPicker`), a toga na Android Chromiumu nema: treba rezervni put preko `chrome.downloads`.
- `offscreen` dokumenti (ffmpeg.wasm spajanje videa, sandbox za host pravila), `sidePanel`, `webRequest` blokiranje i native messaging na Androidu su nezreli: svaki posebno testirati.
- Svaka puna gradnja traje ~10 h i više; ispravke zakrpi znače nove cikluse. Build tree se čuva samo 1 dan.
- Potpisivanje: za APK koji se može ažurirati preko starog treba tajne `KEYSTORE_B64` i `KEYSTORE_PASS` u repou (bez njih gradnja koristi privremeni ključ).

## Iz starog plana (zadržano)
- Kod ugrađenih funkcija, dodataka i Ice Shielda (JavaScript) je isti kao na desktopu.
- GUI se ne prenosi s desktopa: Android interfejs je Java, piše se poseban dizajn za mali ekran. Prije aplikacije napraviti HTML ljusku veličine telefona (iste teme/boje kao desktop) da se vidi raspored (sidebar/funkcije, hamburger meni, avatar, tabovi, kartice funkcija na dodir).

## Ispravke preko `overlay/files` (2026-11-16)
`android/overlay/files/` se kopira u `src/` poslije svih zakrpa (hook u prep fazi, korak "Refresh Ice files" u svakom part poslu). Dvije Java ispravke su tu kao cijeli fajlovi umjesto u zakrpama, da se build nastavi od sačuvanog stabla (zakrpe ulaze u njegov otisak):
- `DownloadSnackbarController.java`: `ChromeActivity` u 156 nije generička klasa (`instanceof ChromeActivity<?>` nije kompajlirao).
- `IceColorMode.java`: `getMode()` bez vraćanja vrijednosti koja može biti null (NullAway).
Pri sljedećoj gradnji od nule prebaciti ih u `ice-31`/`ice-37` i obrisati odavde.
