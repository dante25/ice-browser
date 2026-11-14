# Ice browser: upute za Claude

## Obraćanje
- Korisniku se obraćaj sa "ti" (jednina), nikad sa "vi".

## Projekt
- Pravi projekt je na grani `claude/vibrant-gauss-9sqpu7` (kompajlirani ungoogled-chromium, `core-build/`). `main` je zastario: ne radi na njemu.
- Novi `.deb` bez kompajliranja: izmijeni `core-build/REPACKAGE` i `ICE_DEB_VERSION` u `.github/workflows/repackage.yml` (workflow "Ice repackage").
- `own-extensions/Ultimate SN Downloader` je korisnikova ekstenzija. Njen izvor za Facebook i Instagram su ESUIT Photos Downloader ekstenzije (arhiva: `ariedotcodotnz/esuit-extensions-archive`). Kad nešto na FB/IG ne radi, prvo pročitaj kako to radi ESUIT.
- Ne dodaji ekstenzije ni funkcije koje korisnik nije tražio.
