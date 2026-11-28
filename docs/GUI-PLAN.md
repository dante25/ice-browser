# Ice GUI — plan (radi se POSLIJE jezgre)

Slike: `docs/gui/`.
- `ikona.webp` — ikona browsera.
- `tema-svijetla.png`, `tema-tamna.png` — početni dizajn tema (boje, kartice, sidebar "Funkcije").
- `koncept-raspored.webp` — željeni raspored (samo raspored; boje iz tema iznad).

## Zahtjevi korisnika
1. Sidebar (uska traka s ikonama) je **uvijek vidljiv** s lijeve strane.
2. Panel sidebara se otvara kao **popup preko stranice** — ne gura sadržaj stranice udesno.
3. **Hamburger / glavni meni** (Chromium meni: postavke, historija, preuzimanja, sve ostalo) je **u sidebaru**, ne u gornjem desnom uglu. Sadržaj menija se prikazuje integrisan u panel sidebara.
4. **Avatar korisnika** se premješta u sidebar.
5. Tabovi, raspored elemenata i ostalo — po konceptu i temama.

## Pretpostavke (provjeriti s korisnikom na početku GUI faze)
- Boje: svijetla i tamna tema iz `tema-*.png`; koncept služi samo za raspored.
- Avatar: dno trake sidebara.

## Odluke korisnika (2026-11-09)
1. **Kartice funkcija u sidebaru = vlastite Ice kontrole** (ne originalni popup), jer original ne prati temu. Ice upisuje postavke u `chrome.storage` originalne ekstenzije; kod ekstenzije ostaje originalan.
2. **SN Downloader i Video Sniffer** su u `.deb` paketu, u `/opt/ice-browser/dodaci/<ime>`. Učitavaju se kao obične (ne component) ekstenzije, bez izmjena. Popravka = novi `.deb` (planirana opcija ažuriranja u browseru).
3. **Prekidači** samo u glavnim postavkama, sekcija **"Napredne funkcije"**: Ultimate SN Downloader, Video Sniffer, Multiselect for YouTube (default uključeno, primjena nakon restarta). Sve ostale ugrađene funkcije su uvijek uključene.

## Redoslijed GUI faze
1. Postavke → Napredne funkcije (3 prekidača) + učitavanje dodataka iz `/opt/ice-browser/dodaci`.
2. Sidebar: uvijek vidljiva traka, panel kao overlay preko stranice.
3. Glavni (hamburger) meni i avatar u sidebaru; uklanjanje iz gornjeg desnog ugla.
4. Ice kartice funkcija u panelu.
5. Teme (svijetla/tamna), tabovi, ikona.
