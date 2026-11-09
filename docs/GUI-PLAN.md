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
