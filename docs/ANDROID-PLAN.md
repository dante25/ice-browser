# Ice za Android — plan (POSLIJE desktop verzije: jezgra, pa GUI)

## Ideja korisnika
Ice za Android s potpuno funkcionalnim Chrome ekstenzijama, na osnovi **Kiwi Browser** koda,
s istim ugrađenim funkcijama i dodacima kao desktop Ice.

## Prije bilo kakvog builda — istraživanje (kao Faza 1 za desktop)
1. Kiwi Browser: status (koliko znam ugašen početkom 2025, kod objavljen — PROVJERITI), licenca,
   na kojoj verziji Chromiuma je zadnji kod, koliko bi koštalo prenijeti ga na noviju verziju.
2. Uporediti s Chromium 156 "desktop Android" podrškom za ekstenzije (u kodu 156 postoji, npr.
   sidePanel ima platformu `desktop_android`) — možda je novija osnova bolja od starog Kiwija.
3. Šta stvarno radi od ekstenzija na telefonu: webRequest, downloads, popupi, offscreen, sidePanel,
   service workeri — test s našim ekstenzijama (Video Sniffer, SN Downloader, Quality Adjuster...).
4. Konkurencija (Firefox Android, Lemur, Quetta, Edge...) — šta im ne radi, gdje Ice može biti bolji.
5. Build: alati, trajanje, .apk, potpisivanje, ažuriranja.

## Šta se prenosi s desktopa
- Kod ugrađenih funkcija, dodataka i Ice Shielda (JavaScript) — isti.
- Zakrpe jezgre (ice-01..08) — uglavnom, uz provjeru.
- GUI — NE: Android interfejs je Java, piše se poseban dizajn za mali ekran.
