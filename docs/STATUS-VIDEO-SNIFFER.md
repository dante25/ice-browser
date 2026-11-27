# Status: Video Sniffer (`own-extensions/video-sniffer`, v1.2.0)

## Napravljeno
| Datoteka | Što |
|---|---|
| `quick.js` (novo) | ⬇ dugme na svakom videu (hover). Klik šalje zahtjev u background. Na FB-u traži adrese videa po id-u. |
| `inject.js` | Uz postojeće hookove hvata FB/IG GraphQL odgovore (`__vsniffer: 2`) i šalje ih u `quick.js`. |
| `background.js` | Handler `quick`: bira najbolju kvalitetu, direktno `chrome.downloads`, ili offscreen za HLS / spajanje. Normalizira FB `bytestart/byteend` URL-ove (dedup). |
| `offscreen.html/js` (novo) | Dohvat HLS segmenata (najbolja varijanta, AES-128), spajanje DASH video+audio (`mp4merge.js`), vraća blob URL. |
| `manifest.json` | v1.2.0, permission `offscreen`, `quick.js` kao content script. |

## Kako radi klik
1. FB: id videa iz najbližeg linka (`/reel/`, `/videos/`, `/watch/?v=`). Adrese iz uhvaćenih odgovora, pa iz JSON-a u stranici, pa iz `/reel/<id>/` i `/watch/?v=<id>`.
2. Ako DASH ima audio i visinu veću od 720p, spaja se video+audio (offscreen). Inače se uzima najbolji progresivni HD/SD.
3. Ostali sajtovi: `currentSrc`, inače najbolja stavka iz liste sniffera (HLS najbolja varijanta, ili najveći fajl).
4. Ako CDN odbije običan download, ponavlja se kroz offscreen s Referer/Origin stranice.

## Testirano
- Chromium + mock stranica s mp4: ⬇ se pojavi, klik vrati "Download started".
- **Nije provjereno:** da je fajl stvarno na disku, pravi Facebook, DASH spajanje na FB-u, HLS.

## ESUIT mehanizam (`fbstore.js`)
Preuzet iz `esuit arhiva.zip` (ESUIT Video Downloader for Facebook 2.9.2): `window.__d` se omota, modul `relay-runtime/store/RelayPublishQueue` se prepravi da izloži `window.___rs` (Relay store), a video se čita po id-u (`playable_url`, HD, MPEG-DASH playlist, `progressive_urls`). Testirano na lažnom loaderu (store uhvaćen, SD/HD pročitani); **nije testirano na pravom FB-u**. Ako store ne vrati ništa, `quick.js` pada na uhvaćene GraphQL odgovore pa na JSON u stranici.

## Poznato / otvoreno
- `mp4merge.js` radi samo s fragmentiranim MP4 (sidx/moof); ako FB DASH nije takav, pada na progresivni fajl.
- DASH `.mpd` na ostalim sajtovima nije podržan u ⬇ (poruka upućuje na popup/yt-dlp).
