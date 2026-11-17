# Ice za Android: sve sa desktopa + zahtjevi korisnika (jedan build na kraju)

Dogovor 2026-11-17: nema buildova za sitne promjene. Sve se prvo napravi i provjeri koliko se ovdje može
(primjena zakrpa na izvorni kod, testovi ekstenzija), pa tek onda JEDAN build.

## Već u APK-u (provjereno na telefonu ili u buildu)
- [x] Ime/ikona/paket Ice, Ice tema + Boje (Ice / sistem / vlastita)
- [x] Ugrađene ekstenzije (17) + dodaci (SN Downloader, Video Sniffer, Ice Shield, Uvoz)
- [x] Popupi ekstenzija se otvaraju na telefonu
- [x] Postavke > Napredne funkcije (SN Downloader / Video Sniffer / Multiselect)
- [x] Bookmark/preuzimanja trake gore, 2 s
- [x] Ugrađene ekstenzije vidljive u meniju ekstenzija (build 44110016419)

## Za ovaj build
- [x] Ice panel kao desktop (ice-20/21): traka s ikonama na DESNOJ strani (meni, bookmarks, historija, preuzimanja, Funkcije), panel preko stranice; na uskom ekranu iz dugmeta (kod: IceSidePanel.java, pregledan za kompajliranje)
- [x] Funkcije u panelu: sve ugrađene ekstenzije i dodaci, tap = njen popup
- [~] ~~Ekstenzije u bookmark baru~~ OTKAZANO (korisnik 2026-11-17): ekstenzije su u bočnom panelu, u bookmark bar se ne dodaje ništa
- [ ] Password manager: lokalno spremište, "Sačuvati šifru?", popunjavanje, lista šifri, uvoz/izvoz CSV
- [ ] Ice nova kartica (ice-32 / ice-newtab) umjesto Chromiumove nativne
- [ ] Uvoz iz drugog browsera na Androidu: iz fajlova (bookmarks HTML, šifre CSV)
- [ ] Keep-alive po tabu (meni taba, zadano isključeno)
- [x] SN Downloader 0.13.3 (u repou)
- [x] Video Sniffer 1.2.3: bez ikakvog ograničenja veličine (i YouTube spajanje ide preko diska)
- [x] Panel napisan: IceSidePanel.java + ExtensionsToolbarCoordinatorImpl.java + BUILD.gn (overlay); provjera tek u buildu
- [x] Postavke: sve stavke desktop stranice "Napredne funkcije" (ice-10) - provjeriti da su sve prenesene - DA: SN Downloader, Video Sniffer, Multiselect (ice-36), isto kao desktop ice-10

## Prijave s telefona 2026-11-17 (večer)
- [x] (kod napisan, ExternalNavigationHandler.java overlay) Prijava na YouTube/Google u Iceu otvara Chrome umjesto taba u Iceu: Google prijava (accounts.google.com), YouTube i intent:// linkovi prema drugim browserima moraju ostati u Iceu (ExternalNavigationHandler / ExternalNavigationDelegateImpl).
- [x] YouTube ugrađene ekstenzije moraju raditi i na MOBILNOM YouTubeu (m.youtube.com), ne samo u desktop načinu: Android varijante tih ekstenzija (originali ostaju netaknuti za desktop), redom: Default Quality Adjuster, Permanent Progress Bar, YouTube NonStop, Hide Labels/End Cards, Screenshot, Multiselect, Adblock for YouTube (provjeriti).
- [x] Mehanizam za Android verzije ugrađenih ekstenzija: android/overlay/builtins/mobile_patches.py (kopije, originali netaknuti, kontrolne sume od kopija)
- [x] Default Quality Adjuster na m.youtube.com (test s lažnom mobilnom stranicom: original ostaje medium, Android verzija postavi hd720)
- [x] Permanent Progress Bar na m.youtube.com (uvijek vidljiv, i u fullscreenu; test: original nema trake, Android verzija ima i napreduje)
- [x] YouTube NonStop na m.youtube.com (test: automatska pauza blokirana, vlastita pauza radi)
- [x] Hide Labels/End Cards na m.youtube.com (test: end card i watermark sakriveni)
- [x] Screenshot YouTube na m.youtube.com (vlastito dugme 📷 u playeru; test: PNG preuzet)
- [x] Adblock for YouTube: radi na svim *.youtube.com (filtrira podatke, ne izgled), bez izmjene
- [x] Multiselect for YouTube: vezan za desktop sučelje (masthead, guide, desktop mreže) - radi u "Desktop site" načinu
- [x] YouTube se više NE otvara prisilno kao desktop stranica (to je bilo privremeno); "Desktop site" ostaje u meniju
- [x] .gitignore pravilo extensions/ je skrivalo overlay fajlove (side panel, popup fix) - sada su u repozitoriju i pregledani za kompajliranje
