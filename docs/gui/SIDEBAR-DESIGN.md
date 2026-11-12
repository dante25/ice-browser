# Ice sidebar — dizajn (patch `ice-20-sidebar-rail`)

Prva, minimalna verzija koraka 2 i 3 iz `GUI-PLAN.md`. Patch:
`core-build/patches-next/ice-20-sidebar-rail.patch` (primjenjuje se nakon ungoogled patcheva).

## Klase i datoteke

| Datoteka | Šta radi |
|---|---|
| `chrome/browser/ui/views/ice/ice_rail_view.{h,cc}` | `ice::IceRailView` — uska traka (56 dp) s ikonama. |
| `chrome/browser/ui/views/ice/ice_overlay_panel.{h,cc}` | `ice::IceOverlayPanel` — panel "Funkcije" (300 dp) preko stranice. |
| `frame/browser_view.cc` | U `BrowserView::AddedToWidget()` pravi traku (samo normalni prozori), odmah iznad sadržaja u z-redoslijedu. |
| `frame/layout/browser_view_layout.h` | Novo polje `BrowserViewLayoutViews::ice_rail`. |
| `frame/layout/browser_view_tabbed_layout_impl.cc` | Raspored trake (vidi dolje). |
| `toolbar/toolbar_view.{h,cc}` | `ToolbarView::SetIceRailButtons()` — sakriva ⋮ i avatar u toolbaru i preusmjerava `GetAppMenuControl()` / `GetAvatarToolbarButtonInterface()` na dugmad u traci (`views::ViewTracker`, bez visećih pokazivača). |
| `chrome/browser/ui/BUILD.gn` | Nove datoteke u target `ui` (isti blok kao `browser_view.cc`). |

## Raspored

`BrowserViewTabbedLayoutImpl::CalculateProposedLayout()`: nakon što je postavljen top
container (tabovi + toolbar), traka dobija lijevu ivicu preostalog područja
(`x`, `y` = dno toolbara, širina = `GetPreferredSize().width()` = 56, visina = do dna), a
`params.InsetHorizontal(56, leading)` sužava područje za infobar i sadržaj. Traka zato ide
od toolbara do dna prozora, kao u maketi. U fullscreenu (`is_fullscreen(window_state)`)
traka je sakrivena i sadržaj dobija punu širinu. Širina se smanjuje ako bi sadržaj ostao uži
od `kContentsContainerMinimumWidth`.

## Dugmad (odozgo prema dolje)

1. **Hamburger** — `IceRailAppMenuButton` (podklasa `BrowserAppMenuButton`, ikona
   `views::kMenuOpenIcon`). Otvara isti Chromium meni (`AppMenuModel`) kao ⋮. Pošto ga
   `ToolbarView::GetAppMenuControl()` vraća, Alt+F/Alt+E (`BrowserView::ShowAppMenu`),
   oznaka za ažuriranje (`AppMenuIconController`) i bubble-i vezani za meni idu na traku.
2. **Oznake / Historija / Preuzimanja / Postavke** — `ToolbarButton` + postojeće komande
   `IDC_SHOW_BOOKMARK_MANAGER`, `IDC_SHOW_HISTORY`, `IDC_SHOW_DOWNLOADS`, `IDC_OPTIONS`
   (`chrome::ExecuteCommand`). Ikone: `kStarIcon`, `vector_icons::kHistoryIcon`,
   `kDownloadIcon`, `kSettingsIcon`.
3. **Funkcije** — `ToolbarButton` (ikona `vector_icons::kChromeExtensionIcon`), otvara/zatvara
   panel.
4. **Avatar** (dno, iznad je razmak s flex 1) — nova instanca `AvatarToolbarButton`.
   Profilni meni (`ProfileMenuCoordinator`) se sidri preko element-ID-a na *vidljivo*
   avatar dugme, a to je sada ovo u traci (ono u toolbaru je sakriveno).

Boje: pozadina `kColorToolbar`, desna linija `kColorToolbarContentAreaSeparator`, ikone
standardne boje toolbar dugmadi — prate svijetlu/tamnu temu preglednika.

## Overlay panel

`IceOverlayPanel` = `views::BubbleDialogDelegate` (ne `BubbleDialogDelegateView`, čiji je
konstruktor u 156 ograničen) + widget u vlasništvu klijenta (`CLIENT_OWNS_WIDGET`,
`MakeCloseSynchronous`). Sidro je cijela traka, strelica `LEFT_TOP` → panel je desno od
trake, vrh poravnat s trakom, visina = visina trake, širina 300 dp. To je poseban widget
iznad stranice, pa se stranica ne pomjera i ne mijenja veličinu.

Zatvaranje: Escape (standardno za dijalog), gubitak fokusa (klik bilo gdje van panela),
ponovni klik na "Funkcije", komanda iz trake, ulazak u fullscreen (traka postane nevidljiva).
"Funkcije" dugme reaguje na *pritisak*, a klik koji je upravo zatvorio panel (gubitkom
fokusa) ne otvara ga ponovo (zaštita 300 ms). Sadržaj je zasad samo naslov "Funkcije".

## Poznati nedostaci / neprovjereno

- Patch nije kompajliran (nema build okruženja); API-ji su provjereni ručno na 156 izvoru.
- App meni se i dalje otvara s `MenuAnchorPosition::kTopRight` (kod `AppMenu`), pa se lijevo
  od dugmeta "sudara" s ivicom ekrana; plan je da se sadržaj menija prikaže u panelu (korak 3/4).
- Natpisi trake (Oznake, Historija, …, Funkcije) su fiksni na bosanskom (TODO: grd/lokalizacija).
- Avatar u traci ne poštuje ungoogled flag `--show-avatar-button=never`; avatar "chip" s
  tekstom (npr. "Paused") se u 56 dp odsijeca. Isto važi za tekst oznake ažuriranja na hamburgeru.
- F10/Alt-fokus toolbara (`SetPaneFocusAndFocusAppMenu`) ne može fokusirati dugme u traci
  (nije u toolbar panelu) — fokusira prvo dugme toolbara.
- Uz vertikalne tabove traka stoji desno od vertikalne trake tabova; uz bočni panel s lijeve
  strane — desno od njega.
- Minimalna širina prozora (`GetMinimumSize`) ne uračunava traku.
- Panel ne mijenja visinu ako se prozor promijeni dok je otvoren.

## Ice panel (patch `ice-21-ice-panel`)

Panel više nije placeholder: `IceOverlayPanel` drži `views::WebView` sa stranicom
**chrome://ice-panel** (`chrome/browser/ui/webui/ice/ice_panel_ui.{h,cc}`,
`IcePanelUIConfig` u `chrome_web_ui_configs.cc`). HTML/CSS/JS su ugrađeni kao C++ raw
stringovi (`ice_panel_resources.h`, generiše `docs/gui/ice-panel/gen-resources.py` iz
`docs/gui/ice-panel/panel.{html,css,js}`) i služe se preko `SetRequestFilter` — bez grit-a.
CSP: `script-src 'self'`, `style-src 'self'`, `img-src 'self' data:`, Trusted Types ostaju.

- **Funkcije** → `#features`, **hamburger** → `#menu` (Alt+F i dalje otvara Chromiumov app meni).
  WebContents panela se čuva dok je panel zatvoren (brzo ponovno otvaranje, stranica osvježava
  stanje na `visibilitychange`).
- `IcePanelHandler` (chrome.send, samo za dokument chrome://ice-panel): `getState`, `setPref`
  (3 prekidača; "restart pending" se računa u odnosu na vrijednost pri prvoj promjeni),
  `storageGet`/`storageSet` (`extensions::StorageFrontend`, local/sync, samo Ice ekstenzije;
  ekstenzija dobija `chrome.storage.onChanged`), `openPopup` (popup ekstenzije u panelu, nativna
  traka "‹ Nazad"), `openOptions`, `runCommand` (IDC_* preko `chrome::ExecuteCommand`, `restart` →
  `chrome::AttemptRestart`), `close`.
- Escape: neobrađeni tasteri iz stranice idu na akceleratore bubble-a
  (`UnhandledKeyboardEventHandler`); `window.close()` iz popupa zatvara panel.

Snimci: `panel-funkcije-{light,dark}.png`, `panel-meni-{light,dark}.png` (Playwright, 300×700, mock).
