# Ice core build — izvještaj (Faza 1: istraživanje)

Datum: 2026-11-09. Grana: `core-build`.
Izvor Chromiuma: tag `156.0.8078.79` (GitHub mirror `github.com/chromium/chromium`, isti sadržaj kao chromium.googlesource.com; googlesource i source.chromium.org su u ovom okruženju blokirani proxyjem).
Linkovi ispod su oblika `https://github.com/chromium/chromium/blob/156.0.8078.79/<putanja>`.

## Zaključak

1. **Build NE stane u ovo okruženje** (disk, vrijeme, trajnost — tačka 3). **Faza 2 nije pokrenuta.** Nijedan fajl Chromiuma ni build nije preuzet (preuzeto je samo zadnjih 4 MB tarballa da se pročita xz indeks i izmjeri stvarna veličina).
2. Component ekstenzije u Chromiumu 156 **mogu** biti MV3 sa service workerom i **dobijaju sve tražene API-je**. Ali **ne mogu nositi sve ekstenzije potpuno neizmijenjene i identičnog ponašanja** bez dodatnih C++ zakrpa. Konkretne prepreke su u tački 4.

## 1. Component ekstenzije u Chromiumu 156

### Kako se učitavaju
- `ComponentLoader::Add(...)` → `CreateExtension()` → `Extension::Create(root, ManifestLocation::kComponent, manifest, REQUIRE_KEY)`.
  Izvor: `chrome/browser/extensions/component_loader.cc` (linije ~337–420, 643–658).
- Fajlovi se čitaju **ili** iz `resources.pak` (svaki fajl mora imati IDR unos u `chrome/browser/resources/component_extension_resources.grd` i biti mapiran u `ChromeComponentExtensionResourceManager`), **ili** sa diska iz `root_directory` (relativno na `chrome::DIR_RESOURCES`, tj. `<instalacija>/resources/<ime>`). Oba načina čuvaju fajlove bajt-po-bajt.
  Izvor: `component_loader.cc` (konstruktor `ComponentExtensionInfo`), `chrome/browser/extensions/chrome_component_extension_resource_manager.cc`.
- **Allowlist:** `Add()` odbija svaki ID koji nije u `IsComponentExtensionAllowlisted()` (`NOTREACHED`). Zakrpa mora dodati naše ID-jeve.
  Izvor: `chrome/browser/extensions/component_extensions_allowlist/allowlist.cc`.
- **`key` je obavezan:** `GenerateId()` radi `CHECK(!id.empty())` — manifest bez `key` ruši browser.
  Izvor: `component_loader.cc` linije 118–133.

### MV3 + service worker
- Da. Postojeći primjer: Hangout Services MV3 (`chrome/browser/resources/hangout_services/manifest_v3.json`, `"background": {"service_worker": "thunk.js"}`), učitava ga isti `ComponentLoader`.
- Pri promjeni verzije ekstenzije ili verzije browsera, SW se odregistruje i ponovo registruje iz fajlova (`extensions/browser/extension_registrar.cc`, `AddComponentExtension`, linije 575–622).

### API-ji
U `_permission_features.json` / `_api_features.json` nijedan od traženih API-ja nema ograničenje lokacije koje isključuje component ekstenzije: webRequest, declarativeNetRequest, downloads, bookmarks, tabs, storage, scripting, offscreen (MV3), contextMenus, sidePanel (MV3, linux), notifications, alarms, management, webNavigation, unlimitedStorage, activeTab, identity, clipboardRead, tabGroups — sve `extension_types: ["extension", ...]`, `channel: stable`.
Dodatno, `SimpleFeature` daje component ekstenzijama pristup bilo kojoj funkciji (`component_extensions_auto_granted`, default true).
Izvori: `extensions/common/api/_permission_features.json`, `chrome/common/extensions/api/_permission_features.json`, `extensions/common/api/_api_features.json`, `chrome/common/extensions/api/_api_features.json`, `extensions/common/features/simple_feature.cc` (~linija 784–790).

### Razlike u odnosu na instalaciju iz Chrome Web Storea (provjereno u izvoru)

| Tema | Component ekstenzija | CWS instalacija | Izvor |
|---|---|---|---|
| Statička DNR pravila (`declarative_net_request.rule_resources`) | **Ne učitavaju se.** Instalacija ide sa praznim `ruleset_install_prefs` (TODO crbug.com/40508457); pri učitavanju nema checksuma → `kErrorChecksumNotFound`, ruleset preskočen | rade | `extension_registrar.cc` 597–601; `extensions/browser/api/declarative_net_request/rules_monitor_service.cc` 567–612 |
| Dinamička / session DNR pravila | rade (checksum se ne traži dok pravila ne postoje) | rade | `rules_monitor_service.cc` 621–635 |
| Lokalizacija manifesta (`__MSG_...__`) | na Linuxu `ComponentLoader` **ne lokalizuje** manifest (samo ChromeOS grana zove `LocalizeExtension`) → zakrpa mora to uraditi | radi | `component_loader.cc` 185–213 |
| Host permisije | nikad se ne uskraćuju (nema "on click"/"on site") | korisnik ih može ograničiti | `extensions/browser/extension_util.cc` 343–355 |
| Zabranjeni URL-ovi | `CanExecuteScriptEverywhere()` = true → `scripting`/`tabs.executeScript` rade i na `chrome://` stranicama, Web Storeu, stranicama drugih ekstenzija; ignorišu se policy-blokirani hostovi | zabranjeno | `extensions/common/permissions/permissions_data.cc` 117–131, 128–174, 662–670 |
| `file://` | content skripte s `file://` / `<all_urls>` rade na lokalnim fajlovima bez prekidača | isključeno dok korisnik ne uključi | `extensions/common/utils/content_script_utils.cc` 299–306 |
| `<all_urls>` content skripte na `chrome://` | ne (osim ChromeVox) — isto kao CWS | ne | `content_script_utils.cc` 288–297, `permissions_data.cc` 177–180 |
| Incognito | uvijek uključeno (ako manifest dozvoljava) | isključeno po defaultu | `extension_util.cc` 115–127 |
| `chrome.management.getAll/get` | component ekstenzije se **ne vide** | vide se | `extensions/browser/api/management/management_api.cc` 87–90 |
| Gašenje (disable) | `CanBlockExtension()` = false; ne mogu se onemogućiti kroz normalni mehanizam → `management.onEnabled` nikad ne okida | mogu | `extension_registrar.cc` 838–843 |
| `runtime.onInstalled` | `install` pri prvom učitavanju, `update` pri promjeni verzije, `chrome_update` pri nadogradnji browsera — isto kao CWS | isto | `extension_registrar.cc` 585–601; `extensions/browser/api/runtime/runtime_api.cc` 326–335, 543–575 |
| Storage lokacija | po ID-u (`Local Extension Settings/<id>`, origin `chrome-extension://<id>`) — ista kao inače; isti ID = isti podaci | isto | — |
| Optional permisije (`clipboardRead`, `tabGroups`) | **nije provjereno** kako `permissions.request` radi za component | prompt | — |

Utjecaj na konkretne ekstenzije iz repoa (iz njihovih manifesta/koda):
- **Ice Shield**: koristi statički ruleset `gpc-rules.json` → **ne bi radio** bez zakrpe Chromiuma.
- **Video Sniffer** i **Ultimate SN Downloader**: manifest **nema `key`** → `CHECK` ruši browser. ID-jevi koje main grana koristi (`mljpipojffbomogjpmfplefheflbdfpe`, `jhafboiicnbohoaegfhlbkdpnnkkhohm`, `src/extension-keys.json`) dolaze iz ključa koji main grana **upisuje u kopiju manifesta**. Bez izmjene fajla, ključ bi morao biti ubačen u manifest u memoriji iz C++ koda (fajl ostaje isti, ali manifest koji Chromium vidi nije identičan).
- **Go Back With Backspace**: pri `onInstalled` ubacuje skriptu u sve tabove; kao component bi uspjelo i na `chrome://` stranicama (CWS verzija tu dobije grešku). `management.onEnabled` nikad ne okida.
- 10 ekstenzija koristi `__MSG_` u manifestu (Adblock for YouTube, Default Quality Adjuster, Enable Right Click, Go Back With Backspace, Hide Anything, Multiselect, Permanent Progress Bar, Search by Image, Tab Session Manager, Webmail Ad Blocker) → potrebna lokalizacija u zakrpi.
- Sve ekstenzije bi radile i u incognitu i (gdje matchevi to obuhvataju) na `file://`.

## 2. Sakrivanje i prekidači

- **chrome://extensions:** component ekstenzije su **već sakrivene** (`ui_util::ShouldDisplayInExtensionSettings` vraća false osim uz `--show-component-extension-options`). Izvor: `extensions/browser/ui_util.cc` 20–33.
- **Puzzle meni:** **nisu sakrivene.** `ToolbarActionsModel::ShouldAddExtension()` dodaje svaku ekstenziju koja ima action, bez provjere lokacije; `ExtensionsMenuView` prikazuje sve `action_ids()`. Izvor: `chrome/browser/ui/toolbar/toolbar_actions_model.cc` 344–355, `chrome/browser/ui/views/extensions/extensions_menu_view.cc` 203.
  Potrebna zakrpa, npr.: filtrirati component ID-jeve iz menija (`extensions_menu_view.cc` / `extensions_menu_main_page_view.cc`), a akcije ostaviti stalno prikvačene u toolbaru (`SetActionVisibility`) da popup radi kao do sada; iz kontekst menija ikone (`ExtensionContextMenuModel`) ukloniti "Ukloni"/"Upravljaj ekstenzijom". Alternativa: Ice-ova vlastita dugmad/meni koja izvršava istu akciju (`ExtensionActionViewModel::ExecuteUserAction`).
- **Tragovi koji ostaju vidljivi bez dodatnih zakrpa:** `chrome-extension://<id>/...` URL kad se opcije otvaraju u tabu (Multiselect, Permanent Progress Bar, Search by Image, Tab Session Manager imaju `open_in_tab: true`), Task Manager ("Ekstenzija: ..."), `chrome://extensions-internals`, `chrome://inspect`.
- **Prekidač u postavkama (3 ekstenzije):** component ekstenzija se ne može onemogućiti normalnim putem (`CanBlockExtension` = false). Realan način: profilni pref (npr. `ice.builtin.<ime>.enabled`, default true) registrovan u C++, prekidač na `chrome://settings` (WebUI u `chrome/browser/resources/settings`), i `ComponentLoader` koji ne poziva `Add()` kad je pref false. Gašenje u hodu preko `ComponentLoader::Remove()` okida `TriggerOnUninstalled(UNINSTALL_REASON_COMPONENT_REMOVED)` (`extension_registrar.cc` 648–657) — posljedice po podatke nisu provjerene, pa je sigurnija varijanta "primjena nakon restarta".

## 3. Zahtjevi za build ungoogled-chromium 156.0.8078.79-1 i ovo okruženje

### Šta build traži (iz repoa)
- `ungoogled-chromium` tag `156.0.8078.79-1`: `chromium_version.txt` = 156.0.8078.79; izvor je `chromium-156.0.8078.79-lite.tar.xz` sa commondatastorage (`downloads.ini`).
- `ungoogled-chromium-portablelinux` tag `156.0.8078.79-1`: build u Dockeru (`docker/build.Dockerfile`: Debian trixie, Node 24, clang, ninja, ~90 dev paketa), `scripts/build.sh` → patchevi, `gn gen`, `ninja chrome chromedriver`. Clang i Rust se na x86_64 preuzimaju prebuilt (`scripts/shared.sh`, `fix_tool_downloading`).
- GN: `is_official_build=true` (ThinLTO), `symbol_level=0` (`flags.linux.gn`, `flags.gn`).
- RAM: dokumentacija samo kaže da se pri nedostatku RAM-a smanji `-j` ili doda swap (`docs/building.md`, FAQ). Konkretan broj GB ne navodi.
- Vrijeme: njihov CI (`.github/workflows/build-steps.yml`, `.github/scripts/build.sh`) dijeli build na **do 10 uzastopnih dijelova po 5 h** (`_task_timeout=18000`) na standardnom GitHub runneru `ubuntu-latest` (4 vCPU, 16 GB RAM — specifikacija GitHub runnera za javne repoe, nije provjerena u ovoj sesiji). Dakle autori očekuju više od 5 h, a predviđaju do ~50 h na 4 jezgre.

### Izmjereno
- Tarball: **2,01 GB** (HTTP `content-length: 2009554628`). Raspakovano: **10,83 GB** (pročitano iz xz indeksa, 54 bloka).

### Ovo okruženje
- `nproc` = **4** (Intel Xeon 2.1 GHz), `free -g` = **15 GB** RAM, **0 swap**, `df -h /` = **30 GB slobodno** (252 GB ukupno, ali sesija ima fiksnu kvotu).
- Docker 29.9.2 postoji; clang, ninja, gcc postoje.
- Mreža: commondatastorage.googleapis.com i github.com dostupni; chromium.googlesource.com i source.chromium.org **blokirani** (403 od proxyja).
- Vrijeme sesije: tačna maksimalna dužina nije dokumentovana. Jedna pozadinska komanda može trajati najviše 2 h; kontejner je privremen i briše se nakon neaktivnosti — ništa osim onoga što se pushuje na GitHub ne preživljava.

### Procjena
- Disk: tarball 2 + izvor 10,8 + Docker image (~3, procjena) + toolchain (~1, procjena) ≈ 17 GB prije kompajliranja; za `out/` ostaje ~13 GB. Official/ThinLTO `out/` za cijeli `chrome` je vjerovatno veći od toga — **procjena, nije izmjereno**.
- Vrijeme: desetine sati na 4 jezgre (prema CI-u autora), uz 2 h po komandi i privremeni kontejner bez garancije da preživi.
- RAM 15 GB bez swapa: granično za ThinLTO link (CI ima 16 GB i prolazi).

**Odluka: puni build ne stane ovdje. Faza 2 nije pokrenuta.** Za build treba mašina sa ≥ 100 GB slobodnog diska (sigurna margina), ≥ 16 GB RAM (+ swap), više jezgri, i bez vremenskog ograničenja (lokalni PC/WSL ili vlastiti CI runner).

## 4. Može li component mehanizam nositi ekstenzije neizmijenjene?

**Ne u potpunosti.** Razlozi (svi iz izvora iznad):
1. Video Sniffer i Ultimate SN Downloader nemaju `key` → bez ključa u manifestu Chromium pada. Ključ se mora dodati (u fajl ili u memoriji).
2. Statička DNR pravila ne rade za component ekstenzije → Ice Shield (GPC) ne bi radio bez nove C++ zakrpe koja indeksira rulesetove za component (implementacija TODO crbug.com/40508457).
3. Component ekstenzije imaju **više** prava od CWS instalacije (chrome:// i Web Store za `scripting`, `file://`, incognito, nema uskraćenih host permisija, nevidljive za `management`). To nije "identično originalu". Mora se ili prihvatiti ili dodatno zakrpati Chromium da ih vrati na normalna ograničenja.
4. Lokalizacija manifesta na Linuxu ne radi bez zakrpe (rješivo u C++, bez diranja ekstenzija).
5. Puzzle meni, kontekst meni ikone i ostali tragovi traže dodatne UI zakrpe (rješivo).

### Realne alternative (nisam izabrao nijednu)
- **A. Component + dodatne Chromium zakrpe:** ključ za 2 ekstenzije ubačen u memoriji (fajlovi isti, ID-jevi kao na main grani), zakrpa za statički DNR, zakrpe koje component ekstenzijama vraćaju normalna ograničenja (chrome://, file://, incognito), UI zakrpe za skrivanje. Najviše C++ rada; ponašanje se približava originalu, ali je i dalje drugi kod-put nego CWS.
- **B. Normalne ekstenzije koje instalira sam browser, sakrivene u UI-ju:** zakrpa koja pri startu tiho instalira ekstenzije iz direktorija/CRX-ova isporučenih uz browser kao obične (`kInternal`/`kExternal*`) ekstenzije, plus `ManagementPolicy` provider koji zabranjuje uklanjanje/gašenje, plus filtriranje iz chrome://extensions i puzzle menija. Ponašanje API-ja je isto kao kod CWS instalacije (DNR, ograničenja, incognito). Keyless ekstenzije i dalje trebaju ključ za stalni ID.
- **C. Enterprise policy (`ExtensionInstallForcelist`/`ExtensionSettings`) sa lokalnim update manifestom:** ne treba kompajlirati za samu instalaciju; ekstenzije su prave ekstenzije, ne mogu se ukloniti, ali su vidljive kao "instalirao administrator". Skrivanje i dalje traži kompajlirani browser.
- **D. Postojeći pristup (`--load-extension`) ali bez ijedne izmjene manifesta i bez `ice-shim.js`**, samo da se provjeri da li su upravo te izmjene kvarile Video Sniffer i SN Downloader. Ne ispunjava cilj "ugrađeno", ali je brz test hipoteze.

Za sve varijante sa kompajliranjem treba jača mašina (tačka 3).
