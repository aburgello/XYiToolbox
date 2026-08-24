# XYi Toolbox — CEP panel for After Effects

A CEP/React panel replacing a large ScriptUI toolbox (`XYi_Toolbox.jsx`) used by
a DOOH motion-design studio. React frontend in `src/js/`, ExtendScript backend
in `src/jsx/aeft/`, bridged by `evalTS("fnName", ...args)`.

**This file is RULES ONLY — constraints that change what you do.** The reasons,
the bugs, the reverted approaches and the verification notes live in
[`docs/HISTORY.md`](docs/HISTORY.md), which is NOT loaded into context. If a
rule here looks arbitrary or you're about to simplify it away, grep HISTORY.md
first: nearly every line below cost somebody a real afternoon, and several were
re-derived two or three times before anyone wrote them down.

---

## 1. THE NON-NEGOTIABLE CONSTRAINT

**Master `.aep` files must never be opened as their own editable project.**

- Import read-only via `app.project.importFile()`, **or** copy the master to a
  versioned working file FIRST and only ever open/save that copy.
- Never call `app.project.save()` on anything without an explicit,
  pre-validated, different-from-source output path.
- The whole design exists to make overwriting a studio master structurally
  impossible, not merely discouraged.

**Confirmed exceptions — do NOT "align" or "harden" these:**

| Function | Behaviour | Why it's allowed |
|---|---|---|
| `mcIt()` (`tools.ts`) | opens + saves in place | always run against already-localised working copies |
| `jpegLoc()` | copy-first, kept | deliberately unlike its siblings |
| `midcarder()` | opens active project, `save-as` to a NEW name, closes `DO_NOT_SAVE_CHANGES` | original bytes never written |
| `campaignLocaliserGenerate` / `Trott2` | open master directly, always save to a NEW `_V01.aep`, close `DO_NOT_SAVE_CHANGES` | master never written |
| `importComponentsIntoBatchFolder()` | opens + saves in place | user-picked *batch* folder, not a masters root |

**Rules around the exceptions**

- Never assume one tool's exception applies to another — ask the studio.
- `losOpenForEdit()` decides copy-first **per FILE** via
  `hasIsolatedOvToken(name)`. Never turn that into a per-folder trust decision.
- Any NEW open+save exception needs all three together: a masters-root guard
  checked at **write** time (not only in preview), an explicitly user-picked
  folder (never derived from a path convention), and a pre-write confirmation
  naming the exact consequence.
- Don't add a defensive `close()` after `app.open()` — from the panel AE prompts
  normally, and force-closing bins the user's unsaved work.
- Driving AE via AppleScript/`DoScript` suppresses dialogs and lets scripts
  write files they'd have prompted about — test destructive paths on COPIES.

**Known soft spots** — not bugs, but here the constraint rests on user
discipline rather than code: `mcIt()` takes any folder and has no
`hasIsolatedOvToken` guard on the `.aep` filename; `runScript` is a bare `eval`
over the bridge, so a saved custom tool can do anything.

---

## 2. THE EXTENDSCRIPT ENGINE IS NOT A JS ENGINE

Most runtime crashes come from here. `yarn dev` **never executes ExtendScript**,
so this whole class of bug is structurally invisible in browser preview.

- **Only `Array.prototype.indexOf`, `filter` and `map` are polyfilled**
  (`src/jsx/aeft/shared.ts`). Before using `some`/`forEach`/`reduce`/`find`/
  `findIndex`/`includes`, add a polyfill there or write a plain `for` loop.
  Assume anything ES5+ is absent until proven otherwise.
- **Never `.match()` a file or folder name** — the argument compiles as a regex
  and real names contain `(`, `+`, `[`. Use `.indexOf(...) !== -1`.
  *(Live violation: `locIt`'s `combinationExists` in `tools.ts`.)*
- **Never `instanceof <AE host class>`** — duck-type on the method you're about
  to call, e.g. `typeof layer.sourceRectAtTime === "function"`.
- **Never identify an AE DOM object with `===`** — two accesses return different
  wrappers. Use `propertyIndex` or another value-based id.
- **Never fetch a camera/light-only transform property via
  `layer.property("<display name>")`** — matchName collisions (Point of Interest
  ≡ Anchor Point) resolve against the wrong property on other layer types. Use
  `layer.transform.*`.
- **Never fetch an EFFECT parameter by display name either — use its
  matchName.** Display names change between AE point releases. The Transform
  effect's uniform-scale slot reports as `"Scale"` on AE ≤26.2 and
  `"Scale Height"` on 26.3+, so Auto AR's `transformFx.property("Scale")`
  returned null on one artist's newer AE and the `if (scaleProp)` guard
  skipped the whole scale rig in silence, for months, in both this port and
  the original `XYi_AutAR.jsx`. `ADBE Geometry2-0003` is stable across
  versions and languages. A null lookup must be **reported, never
  `continue`d past** — a rig that half-applies and claims success is the
  actual bug here.
- **`File.name` / `Folder.name` are URI-ENCODED — decode before comparing.**
  They are the name portion of a URI, so anything outside ASCII arrives
  percent-escaped, and macOS stores accents DECOMPOSED: Finland's
  `…BioRexSeinäjoki…` reads back as `…BioRexSeina%CC%88joki…`. Normalising that
  raw is silently catastrophic — stripping the punctuation keeps the HEX, so
  the key grows a literal `cc88` and matches nothing, with no error anywhere.
  Use `decodeURI`/`File.decode` (or `displayName`), and fold accents to ASCII
  as well, or the precomposed spelling of the same name keys differently again.
  `artwork.ts`'s `decodeName()`/`foldAccents()` do both; `team.ts` and
  `tools.ts` decode but do not fold. Czechia, Poland and Serbia are all one
  accented site name away from this.
- **An EFFECT'S POINT PROPERTIES ARE WRITE-ONLY.** `setValue` and
  `setValueAtTime` work on Corner Pin, Bezier Warp and CC Cylinder; READING one
  back throws `invalid numeric result (divide by zero?)`, from `.value` and
  `valueAtTime` alike, and so does any compound param (CC Cylinder's Position,
  Rotation, Light). So a tool that places geometry must OWN it — the panel is
  the only copy, AE is written to and never asked. Do not build a "read the
  comp back into the panel" feature on these without probing first.
- **Masks apply in LAYER space, BEFORE effects; layer Scale applies AFTER
  them.** A mask on a corner-pinned layer is warped along with the picture, so
  composing a mask with a warp means precomping the warped layer and masking
  THAT (`insitu.ts`'s `<Face> SHAPE`). The same ordering is what lets a wrapped
  CC Cylinder be scaled up to fill its own comp.
- **A scripted Puppet pin is not a pin.** `ADBE FreePin3`, its Mesh Atom and its
  PosPin Atoms all add successfully and every `canAddProperty` says yes — but a
  scripted pin has `Vtx Index -1` and the first `setValue` on its position
  throws. The mesh is UI-only. Anything puppet-shaped must start from pins an
  artist placed (`puppeteer.ts` refuses to rig an unbound one).
- **Effect matchNames, measured rather than assumed:** Bezier Warp is
  `ADBE BEZMESH` (`ADBE Bezier Warp` is refused); CC Power Pin's corners start
  at `-0002`, not `-0001`; CC Cylinder at Radius 100 covers `0.321` of its
  layer's width (1/PI — the width IS the circumference) and leaves the height
  untouched. Numbers like these come from rendering a frame and reading it
  back, never from reasoning.
- **Never walk a property tree upward via `propertyGroup(1)` in a collector** —
  it returns the PARENT and blows up exponentially. This froze AE solid once.
- Return `{success, error}` shapes; never throw across the bridge.
- ES6 source, compiled to ES3. Function-based, no classes.

### The bridge

- **Pass nested objects across `evalTS` as JSON STRINGS.** Arguments are
  `JSON.stringify`'d and spliced into eval'd ExtendScript *source*, and nested
  arrays-of-objects lose their values in transit. Flat objects of scalars
  survive. Return values are a proper serialisation round-trip and are safe.
  *(Live risk: `deliveryChecklistQueue(rows)` still takes an array of objects.)*
- `evalTSSafe` (15s timeout, toasts on failure) for user-initiated actions;
  `quietEvalTS` for decorative lookups that must never toast; raw `evalTS` only
  where a call legitimately blocks for minutes (the render watch — a timeout
  would misreport every long render as a failure).
- Return `null` from a one-click `run()` on user cancel, never a fake error.

### The network-mounted team folder

- **Never gate a team-folder FILE operation on `File.exists`/`Folder.exists`.**
  It returns `false` for files that plainly exist on the studio NAS. Attempt the
  real operation (`open`/`read`/`remove`) and treat its failure as the answer.
  `.exists` is only trustworthy on a *directory*.
- Prefer `folder.getFiles()` with **no mask** + manual name compare over
  `getFiles(mask)` and over `new File(fsName + "/name").exists`.
- `Folder.create()` does not create intermediate levels — create each in turn.
- Every NAS feature must degrade **silently**: an unmounted share is a normal
  state, never an error toast.

### Windows `file://` → fs path

Decode percent-escapes, **then** strip a leading slash only when a drive letter
follows. `file:///C:/Users/…` sliced naively leaves `/C:/Users/…`, which `fs`
rejects with a confusing ENOENT. POSIX paths must be left alone. Never hand
`location.href.slice(7)` straight to `fs`.
*(Live defect: `lib/utils/bolt.ts:357` and `:371`.)*

---

## 3. BUILD TARGET AND CSS

Target is **`chrome74`** (`vite.config.ts`). Banned, with the alternative:

| Banned | Since | Use instead |
|---|---|---|
| `color-mix()` | Cr111 | precomputed hex/rgba literals |
| `:has()` | Cr105 | a plain class |
| `aspect-ratio` | Cr88 | padding-box trick (`height:0; padding-bottom:62.5%`) |
| `@container` | Cr105 | plain `@media` |
| `min()`/`max()`/`clamp()` | Cr79 | fixed values or `@media` |
| `overflow-wrap: anywhere` | Cr80 | `break-word` |
| cascade layers, `@property` | — | (why Tailwind v3, not v4) |

**Open question, unresolved and worth settling:** 413 flex `gap` declarations
ship in the built CSS, and flex `gap` is Chrome 84. Either the real CEF host is
newer than the declared target, or a lot of spacing is silently broken in AE.
One look at a docked panel answers it.

Known violations of the table above: `OVLibrary.scss` (`aspect-ratio` ×2),
`PreFlightModal.scss` (`min()`), `Tooltip.scss` and `NameAudit.scss`
(`overflow-wrap: anywhere`).

**Other CSS rules**

- Keep `build.cssCodeSplit: false`. CEP's production loader has zero
  CSS-injection logic, so a lazy chunk's stylesheet would never get a `<link>`.
  **A styling bug that only reproduces from an installed ZXP and never in
  `yarn dev` is a build-pipeline bug, not a component bug.**
- Keep `inlineDynamicImports: true` — a runtime chunk fetch visibly resets the
  panel mid-interaction.
- `src/js/index.scss`'s global `button:hover`/`:active` (`$active: #20639b`)
  paints over any custom button. Any `<button>` with its own background must
  re-declare both states.
- `--cat-glow` is tuned for hover (0.35 alpha). Never use it as a resting fill.
  A `var(--x, fallback)` fallback does **not** apply when the var is defined.
- Never use a CSS `transform` to centre an element Framer Motion animates
  `x`/`y`/`scale`/`rotate` on — its inline style wins. Use flexbox.
- Prefer per-item explicit `delay: index * n` over nested `staggerChildren`.
- A positioned element paints above non-positioned siblings regardless of
  z-index — promote content above an ambient background with
  `position: relative; z-index: 1`.
- **Never wrap a stretch-sized element (flex:1 / grid cell) in `<Tooltip>`** —
  its inner span carries `flex: 0 0 auto !important` and silently defeats the
  sizing. This shipped twice before it was written down.
- Never revert Tooltip's bubble to `position:absolute` under its wrapper — it
  must stay `createPortal` + `position:fixed` or an `overflow` ancestor clips it.
- A `<button>` that is a flex container does not stretch its children in
  Chromium — set `align-items: stretch`.
- A shared row class with `flex: 1` means "fill width" in a row and "fill
  height" in a column. Scope an override at the new usage site; never change the
  shared base rule.
- Verify a tool's `.scss` is actually imported before adding rules
  (`tools/CSVLocaliser.scss` is dead; its rules live in `formTool.scss`).
- Write real characters (`…`, `—`) in JSX, never backslash escapes.
- Nothing on the always-visible home screen animates perpetually — the ambient
  background is one-shot on purpose.

**z-index order:** toasts/video 1000 · CommandPalette 1900 · Dialog 2000, so a
confirm raised by a palette action still wins.

---

## 4. ARCHITECTURE

**Screens.** `main.tsx` is a thin coordinator holding one `Screen` union
(`home` | `category` | `tool`); `backTo` carries the previous screen.

- `localise` → `screens/LocaliseScreen.tsx` (bespoke)
- **Bespoke has THREE modes**, chosen once at the door: `multi` (equal-panel
  tiling), `regions` (masters placed on a traced board) and `insitu` (the build
  on a photo of the site). Insitu takes the whole page from
  `tools/InsituBoard.tsx` and shares none of the region machinery — a quad over
  a photograph has no board size, no guides and no running order, and threading
  a third value through forty `mode === "multi"` branches would put a third
  meaning on every one of them.
- **One screen, one library card.** A `BespokeTemplate` can carry BOTH a region
  layout and an `insitu` payload (faces as a JSON string, per the bridge rule),
  so a screen laid out either way shows up in both boards with the same
  filtering. Never start a second library for a second kind of layout.
- `tools` → `screens/ToolsScreen.tsx` → `RailScreen`
- `review` → jumps straight to the `review-hub` tool
- `deliver` → jumps straight to the `delivery-hub` tool
- `CategoryScreen.tsx` is the generic fallback and is currently **unreachable** —
  every category has bespoke routing.

**Adding a tool** = `tools/X.tsx` + `X.scss` + ExtendScript in
`src/jsx/aeft/*.ts` + one entry in **`toolRegistry.tsx`'s `TOOLS`**.

- A one-click action with no inputs goes in `Toolset.tsx`'s `ACTIONS` instead,
  not its own `TOOLS` entry.
- A **Localise** tool needs BOTH a registry entry AND an entry in
  `LocaliseScreen.tsx`'s `TOOLS_ROW` — that screen is bespoke, not a
  master-detail list.
- Populate `ToolEntry.actions` with each real button's exact visible label; it
  drives search and ⌘K.
- Register it or it is invisible to search and ⌘K (`CSVLocaliser.tsx` is live
  but unregistered, and therefore unfindable).

**Shared primitives — use these, don't re-roll them:** `Dialog` (never
`window.alert/confirm/prompt`; natives show the panel's `file://` path),
`StatusIcon` (never a local CheckCircle/AlertCircle ternary), `CheckboxToggle`
(never a native checkbox), `Tooltip`, `Droplet`, `Dropdown`, `SegmentedToggle`
(needs a unique `name` or two instances share one Framer `layoutId`),
`ArcadeFrame`, `ToolErrorBoundary`.

**Input.** Prefer **mouse events over pointer events** for anything beyond a
plain click — the macOS AE CEP host doesn't reliably dispatch Pointer Events.
For real keyboard input outside a text field, focus a hidden `<input>`
(opacity 0, 1px, `pointer-events:none`, re-focused on a ~400ms interval) and
release `registerKeyEventsInterest` with `"[]"` on unmount. **The keygrab must
stand down when `document.activeElement` is already editable**, or it pulls the
caret out of your own text field several times a second.

**Theming.** `themes.ts`'s `applyTheme()` writes `--ov-accent`/`--ov-bg` to
`:root`. Key off **`var(--ov-accent, #fallback)`**. Category tint (`--cat-*`)
comes from `categoryStyleVars()` as an inline style and cascades into mounted
tools — it is NOT set at `:root`, so portaled content (Dialog, DragOverlay) must
re-apply it. Compute blends in JS; never `color-mix()`.

**Persistence.** `app.settings` section **`"XYiToolbox"`**, one key per feature,
tab-separated lines (JSON only where a real map is needed).

- **Never store USER-AUTHORED text in a delimited value — use JSON.** There is
  no separator that expression code, a script body, or a filename can't
  contain. Expressions Bank stored `id|name|tag|code|uses|description` joined
  by `\t`: a tab in the code (anything pasted from an editor) silently DROPPED
  the whole entry on the next load, and a `|` (i.e. `||`) truncated the code —
  both reported "saved" and lost the work invisibly. Delimited lines are fine
  only for fields the app itself generates and controls.

- Add every new personalisation key to `team.ts`'s `PROFILE_KEYS`, or it won't
  travel with profiles.
- **Never put a credential in `PROFILE_KEYS`** — profiles go to a shared folder.
  `WrikeApiToken` is excluded deliberately, as are content libraries,
  `UsefulFolders` and usage history.
- **Never rename a live `app.settings` key or a game id** — artists have data
  under it. Renames are user-facing strings only (hence `MotionToolsEasePresets`
  surviving the Motion Tools → XYTools rename).
- Merge a saved tool order over `TOOLS`' own order and append unknowns; never
  persist the merged list back.

**Team folder / shared state**

- An empty or failed read must NEVER replace rows already on screen —
  distinguish "no data" from "couldn't read", and keep the last good board
  marked stale.
- When a shared-file call site changes, grep for the other half: a write moved
  without its read is a silently dead feature.
- Never post to a shared board from an untagged machine — refuse rather than
  guess a name.
- A shared campaign can be **retired** (`teamSetCampaignRetired`). It is a
  FLAG, not a delete: it never removes the shared row and never touches
  anyone's local list — it marks pickers and stops `teamSyncShared` pulling
  into either campaign list. Never "finish the job" by deleting local rows
  from a shared file.
- Campaign reachability (`locLibCampaignStatus`) is the one place `.exists`
  is allowed on a team path, because the target is a DIRECTORY. `false` means
  "not mounted right now", never "gone" — never auto-remove on it.
- Keep the read fallback chain (`arcade/` → `misc/` → root) until every machine
  has written at least once.
- Adding an arcade game = a `MACHINES` entry in `ArcadeHub.tsx` **plus** its
  `teamArcadePost` call. The grid is fixed at 2 columns — add games in pairs.
- **A championship season is a FILTER over `stamp.slice(0,7)`, never a reset.**
  Nothing is deleted and nothing is written when a month turns over, so past
  seasons are `overallStandings()` with an older key — a hall of fame for free
  and no way for two panels opening on the 1st to race each other. Never "tidy
  up" by pruning last month's rows.
- **A game pays championship points only with `MIN_PLAYERS_PER_GAME` entrants**
  (4 — the number of paying places). Without it, more cabinets makes the title
  *easier* to farm: winning a 2-person board is 150, third in a busy one is 60,
  so the best move becomes finding the machine nobody plays. A game below the
  threshold must also not count towards `MIN_GAMES_TO_RANK`, or a dead cabinet
  is a free entry towards qualifying.

**Folders starting with `_` are excluded from every scan.** The one exception is
Naming Audit, which skips only `Auto-Save`/`_Archive`/`_Old`/`_DEV`.

---

## 5. DOMAIN RULES

- `buildMastersIndex` must recurse depth-first at the point a folder is met —
  the scorer keeps `diff <= min`, so walk order decides tie-breaks.
- Never loosen the CSV "already built" matcher into a fuzzy match. A false
  "already built" silently loses a deliverable; a false "new" costs one re-run.
- Same for OV Swap's `scanOvSwap`: exact normalised name only, never
  `findBestComponentFile`. A wrong pair puts another component's artwork into
  a finished deliverable; an unmatched row costs one manual pick. It scopes to
  the ACTIVE COMP by studio decision — don't widen it to the project, and
  don't "optimise" a footage swap into `FootageItem.replace()`, which reaches
  every comp.
- Campaign matching uses token boundaries on the FILENAME side only.
- Never re-add Artwork to the CSV built-row core match — `reshapeSpecs` defaults
  it to `"DOOH"`, and a field that can silently default cannot be required.
- **`app.project.item(i)` IS FLAT** — it walks every item at every depth, so
  "the first FolderItem named X" is not the project's X. An imported sibling
  project brings its own `Composition/Main` AND its own `Footage`. Measured in
  one Brazil working copy: four folders named `Footage`, the project's own one
  third in the enumeration — MC It! and JPEG Loc both read an imported
  project's stray logo instead of the artwork, reporting `0/1 replaced` across
  eleven projects with every downstream filter taking the blame. Use
  `ownProjectFolder` (`tools.ts`): root-level wins, otherwise refuse one under
  a `.aep` ancestor. Root is `parentFolder.parentFolder == null`, never the
  name `"Root"` — that is a display name. Same rule when walking "every comp in
  the project" across a batch: exclude comps whose ancestor folder name ends
  `.aep`.
- Never re-derive Master Tools' preset comp sizes from an aspect ratio; they are
  literal artist-tuned pixel values. Re-read the live `XYi_Toolbox.jsx`
  `ComSiz(w,h)` wiring.
- Batch Match transform modes are an explicit user choice — never infer one.
- Each `DELIVERY_TEMPLATE_BITRATES_MBPS` value needs a hand-built,
  identically-named AE Output Module Template; AE's API cannot create them.
- Ease **influence** is portable; ease **speed** is absolute and tied to one
  keyframe. Presets store influence only.

**Naming conventions** (confirmed against real studio folders):
`<mastersRoot>/AE/<Creative>/<stem>.aep`, with the comp inside named identically
to the filename stem. Renders mirror the tree under `Renders/`, paired by
identical stem. QUAD is a keyword token, not a ratio.

**Masters are on BOTH conventions, permanently.** Everything already on disk
keeps the legacy `…_1920x858_10sec_OV` form (masters were never renamed);
everything written from 2026-08 onward uses the new
`…_1920x858px_15s_OV` form. **Any parser that reads a master filename must
accept both** — size with or without `px`, duration as `s` or `sec`.
`nameGeneratorParse` (`localise.ts`), `durationMatchesPath` (`tools.ts`) and
`parseMasterFilename` (`review.ts`, OV Library) all do; a new one must too.
A master that fails to parse is **silently dropped, not reported** — the
symptom is a file missing from OV Library or "no master matched", never an
error. Naming Audit's `masters` mode therefore flags neither convention.

**JPG_PNG writes an ASPECT-RATIO token that AE does not.** The mech pipeline's
folders and sheets carry it next to the pixel size — `..._Metrobus
_9x16_1080x1920px_10s_FR` against AE's `..._Metrobus_1080x1920px_10s_FR` — and
the casing and spacing are not reliable either. Anything pairing a deliverable
to its mech sheet must key on `artwork.ts`'s `deliverableKey()`, which drops a
token of the form `<≤2 digits>x<≤2 digits>` and nothing else. Dropping it is
safe because the ratio is redundant with the size beside it; a SIZE (three
digits and up) is never dropped, so two deliverables can still never collide.

**A SIZE IS ONLY A SIZE WHEN IT IS A TOKEN.** `/(\d+x\d+)/` takes the FIRST
match in a filename, and site names carry that shape — a grid, a wall, a bank of
screens: `Hoyts3x3`, `Westfield4x3`, `2x2`. `FID_INTL_TVSpot_DOOH_Hoyts3x3_
1920x1080_30s_NZ_V01.mov` parsed as `3x3` and failed Delivery's import of every
component selected with it; MCit had the same bug on the same shape, where it
silently swapped nothing. Read a size only where it is delimited — between
underscores or at either end, optional `px` — via `firstSizeToken` (`tools.ts`).
`sanitiseSiteToken`/`guardSiteToken` defuse this when the toolbox WRITES a name;
the readers have to hold their end up for names people wrote themselves.

**Delimited is not enough on a JPG_PNG name — a RATIO is delimited too.**
`_9x16_` sits between underscores exactly like a size, so `firstSizeToken` also
requires **three digits each side** (the same test as `artwork.ts`'s
`isRatioToken`; the smallest real size in the tree is `3552x128`). Without it
MCit read `9x16` as the resolution of a `..._9x16_2440x2160px_...` mech export
and matched it against nothing.

**`/\d+x\d+px?/` REQUIRES the `p`** — the `?` binds to the `x` alone, so that
regex fires only on the new `1920x1080px` spelling and walks straight past a
legacy `1920x1080` and past a `9x16` ratio. Anchor it per token and make the
whole suffix optional: `/^\d+x\d+(?:px)?$/`. Anchoring is what keeps a site's
grid (`Hoyts3x3`) inside the identity. *(`jpegLocGimme` (`localise.ts`) carried
the unfixed regex and a bare `/\d+x\d+/i` for its resolution until 2026-08-24;
both now match MC It!'s.)*

**`\b` DOES NOT SEPARATE A NUMBER FROM ITS UNIT.** `\b` needs a NON-WORD
character, and a digit is a word character — so `/\bk(b|ilo)/i` matches
`950 KB` and does not match `950KB`, which is how a person actually types it.
Both spellings are in the same spec sheet. In `pdfSpecs.ts` the glued one fell
past every unit test to the unitless branch and Delivery autofilled **950 MB
against a real cap of 950 KB** — a thousand times the allowance, with no flag,
because a bare 950 is an ordinary MB figure. `2GB` had the same hole inverted
(read as 2 MB), and `800kbps` in the bitrate column as 800 Mbps. Lex the unit
off the token (`cellNumbers` already does) and use THAT; keep the `\b` tests
only for spelled-out forms (`800 kilobytes`), which carry no unit token.

**A DEDICATED `PNG`/`JPG` FOLDER IS NOT ALL TARGETS.** Measured in a real
Brazil working copy, `Footage/PNG` held three FORGOTTEN_ISLAND logo variants
and an `Asset 1@4x.png` beside the two artwork slots — and one logo ends `_1`,
which is the trailing number MCit pairs on, so without a gate it is swapped for
the deliverable's `_BR1` export and reported as a clean replacement. Gate on the
CREATIVE ONLY (`mcItCreativeOf`): the target carries the MASTER's identity —
no site token, the master's size, the master's duration
(`…_PortalToParadise_DOOH_3840x586px_10s_OV1.png` against a deliverable's
`…_PortalToParadise_DOOH_DufryEZ_512x96px_15s`) — so `PORTALTOPARADISE` is all
they share and it is enough. Report those as **skipped**, not `no-match`: they
are not this deliverable's artwork and never will be.

**MCit's artwork slot is an EXACT match, and no number is itself a slot.**
`_OV2` → `_BR2`, and `_OV` → `_BR`. The real Batch_2 mech output offers
`_BR.jpg`, `_BR2.jpg`, `_BR_ARTWORK_1.jpg` and `_BR_ARTWORK_2.jpg` for one
deliverable; exact equality picks `_BR.jpg` for an unnumbered original and
leaves nothing to guess at. Relaxing it to "skip the filter when the original
has no number" turns one exact answer into four candidates and a question.

**The masters tree is a SIBLING CAMPAIGN, and art edits live in `Tiffs` OR
`Edit`.** `XY026040_…_Markets` holds the territories; `XY026039_…_Masters` holds
`Support/Motion_Components`. Find it by testing each level's siblings for that
folder (`findMotionComponents`), never by pattern-matching a job number or a
`_Masters` suffix. Inside a creative, `Tiffs` (also spelled `TIFFs`) holds one
`.aep` per piece of artwork, named after the tiff, so a sheet's ART row pairs to
it; `Edit` holds cuts of the whole spot (`FID_PORTALTOPARADISE_EDIT_10sec`)
whose names pair to nothing by design and are offered, never matched. Plenty of
creatives have neither folder — an empty list is a normal answer, not a fault.

---

## 6. VERIFYING WORK

- **Audit per-BUTTON, not per-tab.** Forward: every `evalTS("name")` resolves to
  a real export. Reverse: every original `.onClick` maps to something. Watch for
  dynamic dispatch (names held in data structures) before declaring anything
  dead.
- **Use `grep -a` / `rg --text` on `src/jsx`.** `localise.ts` contains a literal
  NUL byte, so grep treats it as binary and silently skips it — this produced
  two false "dead call" positives in the 2026-08 audit.
- **Run BOTH tsconfigs** — but know what they do NOT cover. `tsconfig.json`
  sets `exclude: ["./src/jsx"]` and the build config extends it, so
  **`tsc -p tsconfig-build.json` type-checks ZERO files under `src/jsx`**
  (`--listFiles | grep -c src/jsx` is 0). `yarn build` runs that config, so the
  gate never checks the ExtendScript backend at all. The frontend config drags
  `src/jsx` in transitively but types it against DOM `File`/`Folder`, giving
  ~2000 baseline errors that bury real ones. Net effect: a wrong property on an
  ExtendScript object compiles and ships — `bestMatch.fsName` on a
  `MasterIndexEntry` broke every matched row of `csvLocaliserRun` for months.
  **Assume nothing in `src/jsx` is type-checked; exercise it headlessly against
  the built bundle instead.** Neither config catches undefined ExtendScript
  globals either — a bare `BATTLE_DIR` typo once shipped into a build.
- `yarn build` and `yarn zxp` are **gated** by
  `scripts/audit-jsx-precedence.cjs` (source before, bundle after). Fix what it
  flags; don't bypass it.
- Re-read the actual original source before calling a port "1:1" — never assert
  fidelity from memory. Preserve `alert()` calls, dead parameters, exact labels
  and control-flow quirks.
- Don't infer a button's handler from a matching function name — grep the
  literal `X.onClick = Y`.
- Don't assume near-identical copy-pasted functions across sibling files are
  identical. Diff them.
- Diff against the LIVE install
  (`/Applications/Adobe After Effects 2026/Scripts/`), not the
  `~/Documents/toolset` copies.
- Verify an API capability claim against docs or a probe before writing it into
  a comment as fact.
- **Browser preview never runs ExtendScript.** Anything ExtendScript-only needs
  a real-AE pass before you call it done.
- **DRIVE THE BUILT BUNDLE INSIDE AE — it is the only gate `src/jsx` has.**
  `osascript -e 'tell application "Adobe After Effects 2026" to DoScriptFile
  "…"'` with a script that does `$.evalFile(dist/cep/jsx/index.js)`, calls the
  real exports, and writes its answer to a temp file. Two bugs shipped in one
  day for want of this: a `compId` added to the wrong function's return, and a
  `sizeMatch` whose declaration was deleted while two later lines still used it.
  Both compiled clean, and `yarn build` says nothing about either.
- **For geometry, RENDER A FRAME AND LOOK AT IT.** `comp.saveFrameToPng(0,
  file)` is how every corner-pin, warp, drum and mask in `insitu.ts` was
  confirmed — and how three separate "it builds fine" claims turned out to be
  wrong. A build that returns `success: true` has proved nothing about where
  the picture landed.
- **A probe must clean up after itself.** These run against whatever project
  the artist has open: create into a throwaway comp, remove everything you
  made, never `save()`, and check the item count afterwards.
- Don't re-flag the `AnimatePresence`/rAF stall in an automated preview tab as a
  bug — inspect React state directly, or trust a real foregrounded browser.
- Verify low-alpha colours and layout via computed style, not screenshots.

**Already tried and explicitly rejected — don't re-propose:** explanatory
captions on the Localise tools row; left-aligned `.action-grid`.

---

## 7. COMMANDS

```
yarn            install (yarn classic v1, per Bolt CEP convention)
yarn dev        HMR; browser-viewable at http://localhost:3000/main/ (mock data, no AE)
yarn build      build once + symlink into AE's CEP extensions folder   [gated]
yarn zxp        package a signed installer                             [gated]
yarn build:web  browser-only build
```

Testing without studio folders: browser preview validates layout and React
logic only. `node scripts/make-test-masters.cjs` generates a throwaway masters
tree for exercising real scan/reveal paths inside AE.

---

## 8. HOUSEKEEPING

**Deliberately kept but unwired — don't "clean up" without asking:**
`tools/WrikeTasks.tsx` + `hooks/useWrikeTasks.ts` + `lib/utils/wrikeApi.ts`
(unhooked on request), `tools/DeliveryChecklist.tsx` (superseded by
DeliveryHub), `tools/Placeholder.tsx` (`makePlaceholder` now has zero call
sites), `screens/CategoryScreen.tsx` (unreachable fallback).

**Recent, and easy to mistake for orphaned:** `tools/Puppeteer.tsx` +
`jsx/aeft/puppeteer.ts` (registered in `TOOLS`, Tools category),
`tools/InsituBoard.tsx` + `jsx/aeft/insitu.ts` (reached ONLY through Bespoke's
mode chooser, so it has no registry entry of its own), and
`main/lib/detectShapes.ts` (used by both boards' Detect).

**Genuinely orphaned, no live front door:** `tools/TrueCompDuplicator.tsx`
(backend still maintained and reachable from the Toolset grid),
`tools/GsapDemo.tsx`, `gsap/index.ts` (so `gsap.defaults()` never runs and
ScrollTrigger is never registered), `jsx/aeft/aeft-utils.ts` (not in the
barrel), `exportCustomToolsToFile` / `importCustomToolsFromFile` (no UI),
`lib/utils/ppro.ts`.

**Known small defects, unfixed:** `PREFETCH_MAP` key `"find-replace"` vs the
real id `"find-and-replace"`, so that prefetch silently no-ops;
`GsapScreenTransition.scss` is imported by nothing, so the live transition
wrapper ships without its `will-change` hint.

**`cep.config.ts`:** the panel id is `com.xyi.toolbox`, renamed from
`com.xyi.ovlibrary` (OV Library is one tool inside the toolbox, not the
product). The id is CEP's identity key: changing it registers a *new*
extension rather than updating in place, so any machine still holding a
`com.xyi.ovlibrary` folder shows two identical "XYi Toolbox" entries under
Window > Extensions until the old one is deleted. Don't rename it again
casually — settings survive (they live in AE's `app.settings`, sections
`XYiToolbox` / `ExpressionsBank`, not keyed to the id) but saved AE
workspaces reference the panel by id, so every user has to re-add the panel
and re-save their workspace. `zxp.org` must contain no space (it is
spliced unquoted into a shell command). `TOOLBOX_VERSION` lives in
`TeamDroplet.tsx` and is `YYYYMMDD`.

---

## 9. THE ASK AGENT, AND HOW TO REMOVE IT

The agent is opt-in and off by default: `bubbleControl.ts` reads
`xyi.agent.enabled` from localStorage, `AgentBubble` returns null when it is
unset, and nothing is rendered or listened for. A machine that never turns it
on is a machine where it does not exist.

**Every integration point is marked `AGENT-HOOK`.** `grep -rn AGENT-HOOK src/`
is the complete list — 14 sites across 9 files. That marker is load-bearing:
the coupling is small but it is spread thin, and a removal done by reading
imports alone over-cuts `Bespoke.tsx`, where the fill receiver sits between
unrelated state declarations.

Removing it, measured on a real trial:

- **25 files delete outright, ~7,800 lines** — all of `lib/agent/`,
  `AgentBubble`, `AgentChat`, `AskAbout`, `AskIcon`, `agentWrites.ts` and the
  `probe-agent-*` scripts.
- **447 lines of surgery across 9 shared files**, every one a self-contained
  block behind a named import. `Bespoke.tsx` is 253 of those and is the only
  one worth doing by hand.

Half a day, and nothing else in the panel depends on it.
