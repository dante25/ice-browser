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
