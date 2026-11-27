# Zadatak za lokalnu Claude Code sesiju (zalijepi ovo)

Radiš lokalno na laptopu u kloni `ice-browser`, grana `claude/clever-cray-xo999x` (`git pull`).

## Što korisnik traži
1. **Video sniffer opet ne hvata sve videe na Facebooku.**
2. **Nema otvaranja novih tabova** radi preuzimanja. Umjesto 3 klika treba 1: klik na ⬇ ikonu **na samom videu** automatski preuzima **najkvalitetniji** video.

## Najvažnije: izvor mehanizma
Sniffer je napravljen po logici i mehanizmu ekstenzija iz foldera:

`/mnt/B62E9F772E9F2EFD/ZORIN OS/ICE-FINAL-BACKUP-2026-11-27/esuit arhiva`

U njemu su **3 ekstenzije**. Prvo ih pročitaj (manifest, content/inject skripte, background), nađi onu koja pouzdano hvata FB video, i **prenesi njen mehanizam** u `own-extensions/video-sniffer`. Nemoj se oslanjati na `own-extensions/Ultimate SN Downloader`: to nije taj izvor.

## Što je već napravljeno (grana `claude/clever-cray-xo999x`)
Vidi `docs/STATUS-VIDEO-SNIFFER.md`. Ukratko: ⬇ na videu (`quick.js`), preuzimanje bez taba (`background.js` + `offscreen.js`), hvatanje FB odgovora (`inject.js`). FB dio je pisan po SN Downloaderu i **nije testiran na pravom FB-u**, pa ga zamijeni/provjeri po `esuit` mehanizmu.

## Gotovo kad
- ⬇ se pojavi na FB videu (feed, reel, watch), jedan klik, bez novog taba.
- Skida se najbolja kvaliteta (HD, ili DASH video+audio spojeno ako je bolje).
- Videi koje sniffer popup lista na FB-u su kompletni, bez dupliciranih segmenata.
- Provjereno na pravom Facebooku, ne samo na mocku. Datoteka stvarno završi u Downloads.
- Commit i push na istu granu.
