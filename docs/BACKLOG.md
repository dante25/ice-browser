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

## Filter: samo fotografije, bez banera, reklama i logoa
Engine kandidate odbacuje ako:
- je manja od praga (npr. 400 px na dužoj strani) ili je ikona;
- je SVG ili GIF bez sadržaja, ili je format logoa (PNG s prozirnošću, vrlo mali omjer);
- se nalazi u `header`, `nav`, `footer` ili u elementu s oznakom reklame (`ad`, `banner`, `sponsor`, iframe reklamnih mreža);
- je ista slika na većini kartica (logo ili zajednički baner), jer prava fotografija je različita za svaku karticu;
- ima omjer stranica koji odgovara banerima (vrlo širok ili vrlo uzak).
Prag i pravila su postavke engine-a, ne nagađanje: provjeravaju se na tri-četiri sajta prije uvoza.

## Android: tab koji ostaje aktivan (opcija u meniju tab-a)
Zahtjev (2026-11-15): tabovi ne smiju nestati ni se sami osvježavati. Opcija "Keep alive" u meniju koji se otvara držanjem tab-a, uključuje se po tab-u (kao "Lock" u Samsung pregledniku).

Nalaz iz izvora Chromiuma 156:
- Meni tab-a na Androidu: `chrome/android/java/src/org/chromium/chrome/browser/compositor/overlays/strip/TabContextMenuCoordinator.java`, id-ovi u `menuId == R.id.*` lancu (već ima `pin_tab_menu_id`). Nova stavka se dodaje ovdje.
- Chromium već štiti pinned tabove od odbacivanja: `chrome/browser/performance_manager/policies/discard_eligibility_policy.cc` (`IsPinnedTab()`, razlog `kPinnedTab` u `cannot_discard_reason.h`). "Keep alive" može koristiti isti mehanizam: novi razlog `kKeepAlive` uz provjeru tog flaga po tab-u.

Ograničenje: Chromium odbacivanje je jedan put do nestanka tab-a. Drugi je Android sam: pod memorijskim pritiskom OS ubija pozadinske renderere, a tab se tada ponovo učita kad se otvori. To Chromium ne može potpuno spriječiti, samo smanjiti vjerojatnost (`content/browser/android/child_process_importance.cc`). Zato se ne smije obećati da tab "nikad" ne nestane, nego provjeriti na uređaju koliko dugo ostaje živ.

Plan: (1) patch za meni i flag po tab-u, (2) patch za pravilo odbacivanja, (3) test na telefonu: otvoriti 10 tabova, stavi "Keep alive" na dva, čekati, provjeriti koji su se ponovo učitali.
