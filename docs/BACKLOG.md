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

Pojašnjenje (korisnik, 2026-11-15): zadano je isključeno za **sve** tabove. Zaštita se uključuje samo za tabove koje korisnik ručno označi opcijom "Keep alive" u meniju tab-a, a isključuje se istom opcijom. Ostali tabovi se ponašaju kao i inače.

## Redoslijed rada na Androidu (2026-11-15)
1. Kompajl (part-03 do part-08) se dovrši bez promjena u kodu.
2. Dok kompajl traje, sučelje se ne piše. Korisnik prikuplja izmjene za sučelje i pozadinsko ponašanje (osnovno je isto kao desktop, plus sitnice).
3. Tek kad korisnik pošalje popis, počinje rad na sučelju.

## Android: traka za ekstenzije ispod adresne trake (zahtjev 2026-11-17)
- Posebna traka odmah ispod adresne trake, visine kao adresna traka ili malo tanja, sa ikonama svih ekstenzija (klizi lijevo/desno ako ih ima više).
- Tap na ekstenziju: za obične ekstenzije popup odozdo (donji panel) sa svim opcijama ekstenzije.
- SN Downloader i Video Sniffer: plutajući popup preko sadržaja stranice (YouTube, galerije). Ostaje otvoren dok se skida i kad se prelazi s taba na tab. Zatvara se SAMO na X / Cancel, nikad tapom na prazan dio stranice (da se slučajno ne prekine).
- Izvedba: kao Chromiumova traka za oznake (TopControlLayer u TopControlsStacker, ista mehanika skrolanja s adresnom trakom); popup sadržaj isti kao sada (ExtensionActionPopupContents).
- Postavke: prekidači "Traka za ekstenzije" i "Bookmark bar" (korisnik ga tako zove; ne "oznake"), svaki se uključuje/isključuje po potrebi, da trake ne zauzimaju ekran kad ne trebaju. Chromium bookmark bar na telefonu ne nudi (samo tablet/desktop): treba je omogućiti i na telefonu.
- Redoslijed: prvo provjeriti na telefonu da se popupi uopšte otvaraju (APK iz run 44016894226), pa onda traka.

## Android: Password Manager (prijava 2026-11-17)
- Chromium 156 na Androidu nema lokalno čuvanje šifri: `CreatePasswordStoreBackend` na Androidu koristi samo Google Play Services backend ("internal backend", postoji samo u Google Chromeu). Bez njega dobija prazan backend, a UI traži "update Google Play Services". Ažuriranje GMS-a ne pomaže. `login_database.cc` i `password_store_built_in_backend.cc` se na Androidu ni ne kompajliraju (BUILD.gn, `is_android` grana).
- Odmah upotrebljivo: Postavke → Autofill → "Autofill using another service" + Android-ov autofill servis (Bitwarden, KeePassDX, Proton Pass…), bez Googlea.
- ODLUKA KORISNIKA (2026-11-17): vratiti originalnu funkciju password managera (lokalno, kao Chromium prije vezivanja za Google / kao desktop Ice).
- Plan:
  1. Spremište: na Androidu kompajlirati `login_database*`, `password_store_built_in_backend*` (components/password_manager/core/browser/password_store/BUILD.gn), `CreatePasswordStoreBackend` -> LoginDatabase + PasswordStoreBuiltInBackend; `IsPasswordManagerAvailable` -> true. Provjeriti OSCryptAsync i AffiliationService na Androidu.
  2. Spremanje ("Sačuvati šifru?", save_update_password_message_delegate) i popunjavanje: postoje, rade sa bilo kojim spremištem; provjeriti da ništa ne traži GMS.
  3. Postavke -> Password Manager: novi ekran (lista, pretraga, prikaz/izmjena/brisanje, uvoz/izvoz CSV) preko PasswordStoreBridge, umjesto otvaranja Googleovog ekrana (CredentialManagerLauncher / PasswordManagerHelper).
  4. Prikaz šifre tek nakon otključavanja ekrana (biometrija/PIN), kao u Chromeu.
