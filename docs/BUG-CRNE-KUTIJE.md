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
