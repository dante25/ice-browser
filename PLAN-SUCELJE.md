# Ice: plan ugrađenih funkcija (faza sučelja)

Zapisano 2026-11-07, po tvom diktatu. Još ništa nije započeto.

## 1. Ugrađeno, s prekidačem u postavkama
Potpuna integracija u browser, iste funkcije kao original.
- **Ultimate SN Downloader** (tvoj, `/mnt/B62E9F772E9F2EFD/ZORIN OS/Ultimate SN Downloader/extension`), plus posebno sučelje za Android verziju
- **Video Sniffer** (tvoj, `/mnt/B62E9F772E9F2EFD/ZORIN OS/video-sniffer`), plus posebno sučelje za Android verziju
- **Multiselect for YouTube**

## 2. Ugrađeno, uvijek uključeno (bez prekidača)
- Bookmarks clean up
- Chrome Tab Counter
- Go Back With Backspace
- Default Quality Adjuster for YouTube (mora biti identična originalu, sa svim funkcijama)
- Enable Right Click for Google Chrome
- Hide Anything - Element Hider for Chrome
- Hide Labels and End Cards on YouTube
- Permanent Progress Bar for YouTube
- Screenshot YouTube
- Search by Image
- Tab Session Manager
- Webmail Ad Blocker
- YouTube NonStop
- Adblock for YouTube

Napomena: zadnje tri (Webmail Ad Blocker, YouTube NonStop, Adblock for YouTube) napisane su poslije prekida poruke zbog baterije. Pretpostavka je da spadaju u ovu grupu; potvrdi.

## 3. Ad blockeri: odluka zavisi od updatea
Sada koristiš 3-4 blockera koji se redovno ažuriraju (Adblock Plus, AdBlock, uBlock Origin Lite, Adblock for YouTube, Webmail Ad Blocker).
- Ako se mogu ugraditi u Ice bez ekstenzija **i** da se sami ažuriraju: ugrađujemo.
- Ako ne mogu da se ažuriraju: ostaju ekstenzije.

Za provjeru: blockeri se uglavnom sastoje od dva dijela, liste pravila (EasyList, uBO liste, AdGuard liste), koje se mogu automatski osvježavati kao naše phishing liste, i koda koji te liste primjenjuje.

## 4. Sve ostalo: ekstenzije za uvoz
Ostale ekstenzije iz Chromea (od 36 prenesenih) ostaju kao ekstenzije koje Ice može učitati:
Google Translate, GIF Blocker, Free Download Manager, BestPrice Assistant, LM Civitai Extension, Adblock Plus, AdBlock, uBlock Origin Lite (ako blockeri ostanu ekstenzije), Turbo Downloader for Instagram, Theater Mode for YouTube, Don't Close Window With Last Tab, Claude, Tampermonkey BETA, Emoji Keyboard by JoyPixels, Copy Cookies, Video Download Helper, Free VPN (VeePN), Close duplicate tab, Flickr Images Downloader.

Ekstenzije su već kopirane u `~/.config/Ice/extensions/` (vidi `extensions.json`).

## Otvoreno
- Potvrditi grupu za Webmail Ad Blocker, YouTube NonStop i Adblock for YouTube.
- Istražiti ad blockere (tačka 3), pa odlučiti.
- Prvo gledamo kod originalnih ekstenzija, da ugrađene verzije budu iste.

## Izvorni kod ekstenzija (kopirano iz Google Chrome profila, 2026-11-07)
- `own-extensions/`: tvoje dvije (Ultimate SN Downloader 0.11.2, Video Sniffer 1.1.4)
- `chrome-extensions/`: 15 iz ove liste, tačno onakve kakve su u Chromeu (vidi `chrome-extensions/INDEX.json`: verzija, ID i odakle je kopirano). Sve su Manifest V3.
- Ostale ekstenzije iz Chromea (za uvoz) su u `~/.config/Ice/extensions/` i nisu u repozitoriju.
- Ovo je tuđi kod (Chrome Web Store): repozitorij mora ostati privatan, a licence provjeriti prije svake javne objave.
