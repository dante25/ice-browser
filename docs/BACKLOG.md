# Backlog

## SN Downloader: automatski engine za pravila sajtova
Zabilježeno 2026-11-15 (po zahtjevu korisnika). Sljedeći veći posao nakon trenutnih gradnji.

**Cilj:** zaseban modul unutar ekstenzije koji, kad korisnik otvori sajt s galerijom, sam prepozna kako sajt prikazuje slike i predloži pravilo za host fajl.

**Faza 1 (predložak, bez upisa):**
1. Prepoznavanje kartica: linkovi koji sadrže sličicu i čija adresa prati isti obrazac (npr. `/photo/<broj>`).
2. Prepoznavanje stranice slike: dohvat jedne kartice iz pravog preglednika, traženje `og:image`, `twitter:image`, `contentUrl`, `image_src`.
3. Provjera kandidata: preuzimanje nekoliko slika; mora biti stvarna slika, različita za svaku karticu (logo se odbacuje) i veća od sličice.
4. Pregled: engine prikaže nekoliko pronađenih slika (dimenzije, veličina, izvor) i korisnik potvrđuje jesu li to stvarno velike slike, a ne sličice ili baneri.
5. Uvoz: tek nakon potvrde engine ponudi pravilo za host fajl. Bez potvrde ništa ne upisuje.
   Napomena: engine može provjeriti samo ono što sajt javlja (dimenzije, veličina, razlika među karticama). Ne može znati ima li slika vodeni žig koji je stavio sam sajt.

**Faza 2:** pravilo `CARD` (izvođenje velike slike iz sličice) predlaže se samo kao kandidat, uz ručnu potvrdu, jer obrazac nije generički.

**Pravila koja vrijede:**
- Ništa se ne upisuje u `ihg/stock.xml` automatski. Fajl se dijeli na sve uređaje.
- Engine uzima samo ono što sajt prikazuje u pregledniku. Ne zaobilazi captchu, prijavu niti plaćene originale.

**Otvoreno:** koji sajt je prvi za test (istock ili Alamy, gdje galerija radi).

## Pregled pronađenih slika (UI za engine iznad)
- Ne popup preglednika, nego **panel na stranici** (ubacuje ga content skripta, u zasebnom shadow DOM-u da ne miješa stil sajta). Zatvara se klikom izvan njega.
- Svaka pronađena slika: minijatura, izvor (link stranice slike), dimenzije, i gumb **Uvezi pravilo**.
- Pravilo se piše za **obrazac stranica slika** izveden iz skeniranih kartica (npr. `/photo/<broj>`), a ne za cijelu domenu. Tako pravilo na cijelom sajtu hvata samo stranice slika, ne banere ni sličice.
- Uvoz pravila: upisuje se u postavke ekstenzije (kao ručni uvoz), ne u repo.
- Jedan gumb "Odbaci" po slici, da se obrazac može suziti ako pogodi i nešto što nije slika.
