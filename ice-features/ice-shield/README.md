# Ice Shield

Iceova ugrađena zaštita (MV3 ekstenzija): blokira phishing i malware stranice, HTTPS-first i Global Privacy Control.

## Izvori opasnih stranica

1. **Javne liste** (uvijek uključene): Phishing Database, OpenPhish, URLhaus filter, HaGeZi TIF. Skidaju se svakih 6 sati i provjeravaju lokalno.
2. **Google Safe Browsing v5** (dodatno, samo s API ključem): lokalne liste heš prefiksa `se-4b` (phishing), `mw-4b` (malware) i `uws-4b` (neželjeni softver), iste koje koristi Chromium. Liste se same ažuriraju (`hashLists:batchGet`, djelimična ažuriranja, provjera SHA-256 kontrolnog zbira, poštuje se minimalni razmak koji zada Google). Kad se 4-bajtni prefiks heša adrese nađe u lokalnoj listi, puni heš se potvrđuje preko `hashes:search`; blokira se samo potvrđeno poklapanje. **Googleu se nikad ne šalje adresa, samo kratki prefiksi heševa.**

Bez API ključa Google provjere su isključene i ništa se ne šalje Googleu.

## Kako dobiti API ključ

1. Otvori [Google Cloud Console](https://console.cloud.google.com/) i napravi (ili izaberi) projekat.
2. *APIs & Services → Library* → potraži **Safe Browsing API** → *Enable*.
3. *APIs & Services → Credentials → Create credentials → API key*. Po želji ograniči ključ samo na Safe Browsing API.
4. U Iceu otvori postavke Ice Shielda (stranica ekstenzije → *Opcije*), zalijepi ključ i klikni *Sačuvaj*.
   Tu se vidi i zadnje ažuriranje, broj prefiksa po listi, zadnja greška i dugme *Ažuriraj sada*.

Korištenje Safe Browsing API-ja podliježe Googleovim uslovima korištenja (Google APIs Terms of Service i uslovi za Safe Browsing API). Besplatni Safe Browsing API je namijenjen nekomercijalnoj upotrebi.

## Testovi

```sh
node --test tests/unit.test.mjs                      # protobuf, Rice, URL kanonizacija (vektori iz Chromiuma)
NODE_PATH=$(npm root -g) node tests/e2e.mjs          # Chromium + Playwright + lažni v5 server
```

`gsb/psl.js` (ICANN dio Public Suffix liste) se generiše sa `node tests/gen-psl.mjs <effective_tld_names.gperf>` iz Chromiuma.
