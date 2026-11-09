# Bug: crne kutije u ComfyUI tabu nakon duže neaktivnosti (Chrome, zadnjih mjeseci/godinu)

Opis korisnika: tab koji dugo miruje ("zamrzne"), pa pri pomjeranju miša preko praznog prostora
crta prazne crne pravougaonike (dijelovi canvasa se ne iscrtavaju). Prije nije bilo.
Cilj: da ga Ice NEMA, bez da korisnik išta podešava.

## Plan
1. Od korisnika: `chrome://gpu` (kopiran tekst), OS, grafička kartica.
2. Odabrati kandidate (Chromium feature/flag za GPU rasterizaciju/canvas/Graphite/memorijsku politiku).
3. Test na korisnikovoj mašini sa prvim .deb-om (pokretanje s jednim kandidatom po pokretanju).
4. Pobjednika ugraditi kao podrazumijevanu postavku Icea (zakrpa/zastavica), zapisati u izvještaj.
Napomena: ne može se reproducirati u cloud okruženju (nema GPU).

## Nalaz iz korisnikovog chrome://gpu (2026-11-09)
- Zorin OS (GNOME), Wayland, kernel 7.0; Chrome 157 Flatpak (vlastiti Mesa 26.2.5).
- Dvije GPU: NVIDIA (0x10de:0x24dd) + Intel UHD (TGL GT1); Chrome crta na Intelu (render node D1). Optimus.
- Ganesh GL, hardverska rasterizacija, Graphite isključen, tile mode One-copy.
- GPU crash count 0, nema izgubljenog konteksta; u logu samo "Frame latency is negative" (viz display.cc).
- ~~Hipoteza Wayland + hibridna grafika~~ ODBAČENA: korisnik javlja da se isto dešava i na Windowsu.
- Dakle: uzrok je u Chromium motoru (ili u interakciji s ComfyUI canvasom), ne u OS/drajveru. Ice ga nasljeđuje.
- Otvorena pitanja korisniku: (1) samo ComfyUI/RunningHub ili i druge canvas stranice? (2) tab cijelo vrijeme prednji ili pozadinski/minimiziran?
- Sljedeći korak: proučiti Chromium 156 izvor (canvas 2D GPU resursi/hibernacija, tile discard, memorijska politika) i napraviti zakrpu.
