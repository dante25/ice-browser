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
- [ ] Ice panel kao desktop (ice-20/21): traka s ikonama na DESNOJ strani (meni, bookmarks, historija, preuzimanja, Funkcije), panel preko stranice; na uskom ekranu iz dugmeta
- [ ] Funkcije u panelu: sve ugrađene ekstenzije i dodaci, tap = njen popup
- [ ] Ekstenzije u bookmark baru (desno, 3-4 korištene) + prekidač "Traka za ekstenzije" u Izgled
- [ ] Password manager: lokalno spremište, "Sačuvati šifru?", popunjavanje, lista šifri, uvoz/izvoz CSV
- [ ] Ice nova kartica (ice-32 / ice-newtab) umjesto Chromiumove nativne
- [ ] Uvoz iz drugog browsera na Androidu: iz fajlova (bookmarks HTML, šifre CSV)
- [ ] Keep-alive po tabu (meni taba, zadano isključeno)
- [x] SN Downloader 0.13.3 (u repou)
- [x] Video Sniffer 1.2.3: bez ikakvog ograničenja veličine (i YouTube spajanje ide preko diska)
- [x] YouTube ugrađene ekstenzije (kvalitet, progress bar, nonstop, end cards, screenshot, multiselect) rade samo na www.youtube.com: Ice na Androidu otvara YouTube kao desktop stranicu (component_loader.cc, overlay; korisnik to može promijeniti u postavkama sajta)
- [ ] Panel: IceSidePanel.java + ExtensionsToolbarCoordinatorImpl.java napisani (overlay); treba još BUILD.gn (toolbar/extensions) sa novim izvorom
- [ ] Postavke: sve stavke desktop stranice "Napredne funkcije" (ice-10) - provjeriti da su sve prenesene
