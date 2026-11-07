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

## Odluke (2026-11-07)
- **Način ugradnje: originalni kod.** Ice nosi originalni kod svake ekstenzije u sebi i pokreće ga sam (bez prodavnice i ikonica ekstenzija), s prekidačima u postavkama gdje je traženo. Chromeove funkcije koje Electron nema dodaje biblioteka `electron-chrome-extensions`.
- **Greške:** popravljaju se jedna po jedna, kako se koja ekstenzija ugrađuje. Svaka popravka se bilježi u `chrome-extensions/FIXES.md`.
- **Nova ugrađena funkcija (uvijek uključena): pregled slika na Google Images.** Klik na sliku otvara pregled preko cijele stranice (unutar stranice, ne novi prozor), s listanjem lijevo/desno. Pišemo je sami, jer stara ekstenzija za to više ne radi.

Test motora (Electron 45): svih 11 testiranih ekstenzija se učitalo, kod 8 radi na YouTubeu. Nedostaju Chromeove funkcije `commands`, `webNavigation`, `downloads`, `identity`, `tabGroups`.

## Nalazi iz integracije (2026-11-07)
Urađeno: učitavač ugrađenih funkcija (`src/builtins.js`), dodatak za Chromeove funkcije (`src/crx-shims*.js`),
sistem popravki koji preživljava updatee (`src/ext-patches.js`). Svih 17 funkcija se učitava, 15 pozadinskih
dijelova radi bez grešaka, na YouTubeu radi kod 11 funkcija. 19/19 sigurnosnih testova prolazi.

Popravljene greške:
1. `chrome` objekt zaključan (biblioteka) -> Iceove dodatke nije bilo moguće dodati. Rješenje: novi `chrome` kao nastavak zaključanog.
2. Chromium 156 pravi zaseban `browser` objekt bez funkcija biblioteke -> Tab Session Manager se nije pokretao (i sve ekstenzije s webextension-polyfill vidjele bi nepotpune funkcije). Rješenje: `browser` = `chrome`.
3. Hide Labels and End Cards: poruka bez hvatanja greške pri svakom učitavanju YouTubea (greška originala). Popravka u `src/ext-patches.js`.
4. Testovi su ostavljali žive Electron procese koji drže debug port. Rješenje: test pokreće pravi Electron binarni fajl.

**Blokada (odluka čeka):** u Electronu 45
- `chrome.declarativeNetRequest` ne radi (ni blokiranje ni zaglavlja),
- `chrome.webRequest` ekstenzija ne dobija ništa dok Ice koristi bilo koji svoj mrežni filter (phishing, HTTPS-first, GPC),
- nema `chrome.downloads` ni `chrome.bookmarks`.
Pogođeno: Adblock for YouTube, Ultimate SN Downloader, Video Sniffer, Search by Image (dio), Bookmarks clean up.
Opcije: (A) ostati na Electronu i u Iceu napisati DNR, webRequest za ekstenzije, downloads i bookmarks;
(B) prebaciti osnovu Icea na ungoogled-chromium (pun Chromium bez Googlea, sve ekstenzije rade kao u Chromeu).

## Sučelje (2026-11-07)
Uzor: dizajn s lijevim panelom (ikone + meni, panel se otvara unutar prozora), tabovi gore, adresna traka ispod
(nazad, naprijed, osvježi, home lijevo; "+" za novi tab). Uglovi upola manje zaobljeni od uzora.
Boje (tvoja paleta):
- osnovna (umjesto bijele): `#E3FDFF`
- lijevi panel i adresna traka: `#D1F7FF` (bilo #C0F7FF, previše drečavo)
- akcent (bočna traka, kliknuto/označeno): `#94F7FF`
- ostale nijanse palete: `#D1F7FF`, `#49E8FF`
Tamna tema: "svijetlo crna" kao Ubuntu (Yaru) tamna; akcent ostaje `#94F7FF`.
- osnovna: `#2C2C2C`, lijevi panel i adresna traka: `#383838`, tekst: `#F2F2F2`, akcent: `#94F7FF`
- svijetla/tamna se biraju prema sistemskoj postavci (ili ručno)
