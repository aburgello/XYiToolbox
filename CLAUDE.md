# XYi Toolbox — CEP Port (After Effects)

## What this project is
A CEP/React port of a large ScriptUI toolbox (`XYi_Toolbox.jsx`, used by a
DOOH motion design studio) that dynamically loads ~65 individual tool
scripts from a `toolset/` folder (renaming, comp/layer utilities, CSV/PDF
localisation, campaign scanning, delivery checklists, and two "library"
browsers). The ScriptUI original is a clunky top button-grid plus a
separate inline listbox-tab mechanism, each launching a standalone popup
window. This port replaces all of that with a single unified panel:
a home screen (logo, version, the always-visible one-click Toolset grid,
then four category cards — Localise/Review/Deliver/Tools) that drills
down into a category's tool list, then into a selected tool's page, with
a back button at each level — see Architecture below. This is NOT a
persistent sidebar (an earlier version of this port was; it got replaced
because forcing a sidebar click for every tool, including simple one-click
button-grid actions, added friction for no benefit — see Architecture's
"one-click tools" note for the resulting Toolset-grid-vs-dedicated-page
rule that decision produced).

**OV Library was the first tool ported and is not special** — it used to
be this project's only panel, but it's now just one entry in the tool
registry (`src/js/main/toolRegistry.tsx`'s `TOOLS` array — moved out of
`main.tsx` in the shell-decomposition refactor, see below) like every
other tool. Don't treat it as more central than any other tool going
forward.

This file exists so a fresh Claude Code session doesn't have to relearn
the constraints that took a long back-and-forth to establish the first
time.

## Verifying completeness — audit per-BUTTON, not per-TAB
**Twice during this port, "everything is wired" was claimed and was
wrong** — both times because a *sub-button nested inside a tab* was
missed while the tab itself was counted as "done": first the Campaign
Localiser tab's "Trotting Along"/"PDF to CSV" section, then the same
tab's "JPEG Loc" button. The port is organized by tab/tool, but the
original toolbox's real surface is its **individual click handlers**, and
one tab can contain many. Before ever telling the user a section (or the
whole port) is complete, run the mechanical audit that actually catches
this — do NOT eyeball it:
1. **Forward** (no dead buttons): extract every `evalTS("name")` call
   across `src/js` and confirm each resolves to a real `export` in
   `aeft.ts`. (One-off Node scripts for both directions were used in the
   session that added this note; regex `evalTS(?:<[^>]*>)?\(\s*["'\`]([A-Za-z0-9_]+)`.)
   Watch two false positives: `myFunc` (a JSDoc example in
   `src/js/lib/utils/bolt.ts`) and functions called via dynamic
   `evalTS(fnName as any)` where the name lives in a data structure
   (Adjust's `FIELDS[]`, ExtremeTools01/02, LOS Tools) — those won't
   match a literal-string regex but ARE wired; re-check any "never
   called" export by grepping its bare name as a string anywhere in
   `src/js`.
2. **Reverse** (no missing features): `grep -oE "[A-Za-z0-9_]+\.onClick\s*=\s*[A-Za-z0-9_]+" XYi_Toolbox.jsx`
   lists every clickable action in the original (plus the `.onClick =
   function()` inline ones — Master Tools size presets, the two library
   launchers, Useful Folders row CRUD, CSV/CSVLoc browse). Map EACH to a
   ported function. As of the latest audit, **every handler maps** except
   **one deliberate removal** and **one non-issue**:
   - **Detect Edit (Old)** (`EdDetect`) — intentionally DROPPED, studio-
     confirmed. It's labelled "(Old)"/deprecated in the source; the
     studio said don't carry it over. Not a gap; there's no footnote for
     it anymore (removed from Edit Tools' page).
   - **Delivery UNI** (`DelUnivPreBut`) — commented out in the original
     itself (line ~3145), so correctly absent.
   Everything else — including **Midcarder** and **Wall Queue**, which
   were previously footnoted as not-ported — is now real (see below).
   The three "isn't wired up here" footnotes that used to sit on the Edit
   Tools / Project Buttons / Wall Tools pages are all gone.
3. **Right logic, not just right name**: a same-named button can call the
   wrong ported function. Spot-check provenance comments against the
   original (e.g. confirmed `scaleFit`↔`XYi_Scale_Exp.jsx`,
   `delivery`↔`DelPre`).

**JPEG Loc** (`jpegLoc` in `aeft.ts`, wired in `CampaignLocaliser.tsx`)
is the JPG sibling of MC It!: batch-replaces `.jpg` footage across a
folder of `.aep` projects. Ported from the already-copy-first-patched
`XYi_jpgLoc.jsx`, reusing `losSafeOpenMasterCopy()`. Unlike MC It!/
pingLoc (reverted to in-place save per studio confirmation), jpgLoc was
**kept copy-first** — do not "align" them.

**Midcarder** (`midcarder` in `aeft.ts`, wired in `ProjectButtons.tsx`)
— studio said "bring it in as is," so ported 1:1 from `XYi_MidCarder.jsx`
including its direct `app.open()` of `app.project.file`. **CONFIRMED
EXCEPTION**: it opens whatever project is active (possibly a master), but
each territory's result is `save-as`'d to a NEW `<stem-2chars><ter>.aep`
file, the in-memory project is closed with `DO_NOT_SAVE_CHANGES`, and the
original is only ever RE-OPENED, never written — so the master's bytes
are untouched, same safety logic as MC It!/Campaign Localiser. Do not
harden it to copy-first; the studio wanted it exactly as-is.

**Wall Queue** (`wallQueueUpdate` in `aeft.ts`, wired in `WallTools.tsx`)
— advances a video-wall comp like a conveyor: each panel comp takes the
previous panel's layers, the first panel is emptied, and each selected
layer is fed into the front panel in turn (one conveyor-advance per
selected layer, matching the original's run-nested-script-per-layer
loop). **Ported faithfully with ONE latent bug hardened**: the original
nested `XYI_Wall_Queue.jsx` removed selected layers while iterating
forward over the live `selectedLayers` array (mutation-during-iteration
→ skips layers), which only ever worked because the wrapper selected one
layer at a time. The port snapshots the selected layers into a stable
array up front, so single-select behaviour is identical to the original
but multi-select no longer skips. This was flagged to the user (who'd
asked "what's the issue, can we fix it") before doing it — the earlier
"reads as a bug, don't port" call was an over-flag; the actual behaviour
is intended, only the iteration was fragile.

**Preview harness caveat**: the `AnimatePresence mode="wait"` screen swap
can wedge when the preview tab is driven programmatically (framer-motion
uses `requestAnimationFrame` for exit animations, which the automation
throttles, so `onExitComplete` never fires and the next screen never
mounts). Navigation is fine in a real foregrounded browser. When live
preview navigation hangs, fall back to inspecting the built bundle
(`grep` the `dist/cep/assets/main-*.cjs` and `dist/cep/jsx/*.js`) to
confirm a change shipped, rather than assuming the app is broken.

## Non-negotiable safety constraint
Master `.aep` files must NEVER be opened as their own editable project —
only imported via `app.project.importFile()` (read-only), or if a tool's
job genuinely requires editing one (e.g. batch footage-replacement tools),
it must copy the master to a versioned working file FIRST and only ever
open/edit/save that copy — see `ov_safeOpenMasterCopy()` in the ported
`toolset/*.jsx` files and `XYi_Campaign_CSV.jsx`'s `masterFile.copy(...)`
for the reference pattern. If you add or modify anything that touches a
master: import-only, or copy-first-then-open. Never open the original
directly, never save over it. This is the single most important
constraint in this project — the whole design exists to make overwriting
a studio master file structurally impossible, not just discouraged.

**Known history**: a security-research pass across `toolset/` (pre-port)
found four ScriptUI tools that opened a scanned `.aep` and saved in
place: `XYi_pingLoc.jsx`, `XYi_jpgLoc.jsx`, `XYi_AdjustExtCsv.jsx`,
`XYi_LOSCsv.jsx`. Three of these were genuine violations and were patched
to copy-first via an `ov_safeOpenMasterCopy()` helper: `XYi_jpgLoc.jsx`,
`XYi_AdjustExtCsv.jsx`, `XYi_LOSCsv.jsx` (in the ScriptUI source,
independent of this port). Three more (`XYi_Campaign_Scanner.jsx`,
`XYi_Campaign_Trotter.jsx`, `XYi_Campaign_Trotting2.jsx`) open a master
directly but currently save to a distinct new filename — not violating
today, but fragile — apply the same copy-first fix when any of them get
ported into this panel.

**`XYi_pingLoc.jsx` (the 4th tool) is a DELIBERATE, CONFIRMED EXCEPTION —
do not "fix" it to copy-first.** It was initially patched the same way as
the other three, but the studio confirmed this tool is always run
against a folder of already-localised, territory-specific working
copies, never the pristine masters this rule protects — in-place save is
the correct, intended behavior for it. The copy-first wrapper was
reverted from both `XYi_pingLoc.jsx` and its CEP port (`aeft.ts`'s
`mcIt()`, wired to the "MC It!" button). **The general rule above still
applies to every other tool** — this is a narrow, explicitly-confirmed
exception for one tool's one real, verified usage pattern, not a
precedent for loosening the rule elsewhere. If a similar question comes
up for another tool, ask the studio directly rather than assuming the
same exception applies.

**Localised Library's "Save Into Batch Folder…" is ANOTHER confirmed,
narrow exception — same category as pingLoc/MC It!, opens+saves in
place, not copy-first.** This is the one place in this whole codebase
where a user-picked folder of `.aep` files gets `app.open()`'d and
`app.project.save()`'d directly (`aeft.ts`'s
`importComponentsIntoBatchFolder()`, wired from `LocalisedLibrary.tsx`'s
`handleSaveIntoBatchFolder()`). Confirmed with the user why this is safe:
**"Masters"** (the OV/English versions, approved by Head Office — the
files OV Library's whole campaign system and this rule protect) and
**"batch folders"** (localised delivery batches, e.g. "Batch_01" for
France — working files that get components injected into them as a
normal, expected part of the job) are two structurally different things
in this studio's workflow, not two names for the same folder. The
feature only ever targets whatever folder the user explicitly picks via
`selectBatchFolder()`'s dialog — never auto-derived from a path
convention (same reasoning as everywhere else in this file that avoids
guessing at unverified folder conventions).
- **Defence in depth, not just user trust**: `findMastersRootCollision()`
  in `aeft.ts` cross-checks the picked folder's path against every
  `mastersRoot` saved in OV Library's own campaigns (`loadCampaignsRaw()`
  — same `"OVLibCampaigns"` settings key, reused directly, not
  duplicated) and refuses to proceed (both in the dry-run preview and
  again inside the real write function itself, so a client that skipped
  the preview can't bypass it) if the picked folder is inside, or
  contains, a known Masters root. This can only catch Masters roots that
  have actually been saved as an OV Library campaign on this machine —
  it is a safety net for the realistic "picked the wrong folder in the
  dialog" mistake, not a cryptographic guarantee, and does not replace
  the confirmation dialog.
- **UI flow, deliberately two-phase**: `previewBatchFolderAep()` scans
  and safety-checks the folder WITHOUT opening or saving anything, so
  `LocalisedLibrary.tsx` can show the user an accurate file count and a
  loud confirmation (states plainly that this modifies files on disk,
  can't be undone, and will replace whatever project they currently have
  open) before `importComponentsIntoBatchFolder()` — the function that
  actually writes — ever runs.
- **AE is single-document**: opening file 2 of a batch silently replaces
  file 1 as the active project. `importComponentsIntoBatchFolder()`
  captures `app.project.file` before starting and best-effort reopens it
  once the batch finishes. There is no reliable "unsaved changes" flag
  exposed by ExtendScript's AE DOM to check first — the confirmation
  dialog's warning to save first is the only guard against losing
  unsaved work in whatever project was open when the batch starts. If a
  future session finds a real way to detect project-dirty state, wire it
  in here.
- **If this pattern is ever reused for a new feature**: keep the same
  three pieces together (masters-root guard checked at write-time not
  just preview-time, an explicit user-picked folder never a derived
  path, and a pre-write confirmation naming the exact consequence) — this
  is what makes an open+save exception safe here, not just "the user
  asked for it."

## Commands
- `yarn` — install deps (this project uses yarn classic v1, not npm, per
  Bolt CEP convention — run `yarn set version classic` first if needed)
- `yarn build` — build once, symlinks into AE's CEP extensions folder
- `yarn dev` — HMR dev mode; also viewable in a plain browser at
  `http://localhost:3000/main/` (NOT `/panel/`) WITHOUT After Effects
  running, using built-in mock data (see Testing below)
- `yarn zxp` — package a signed installer

## Architecture
**Shell decomposition refactor**: `main.tsx` used to BE the whole shell
(screens, tool registry, favorites, tool order, all inline in one file).
It's now a thin coordinator only -- everything else moved out into
dedicated files, listed in `main.tsx`'s own header comment:
`toolRegistry.tsx` (`TOOLS`/`CATEGORIES`/`categoryStyleVars`),
`hooks/useFavorites.ts`, `hooks/useToolOrder.ts`, `screens/HomeScreen.tsx`,
`screens/CategoryScreen.tsx`, `screens/ToolScreen.tsx`, `animations.ts`
(shared Framer Motion variants), `ToolErrorBoundary.tsx` (wraps each
mounted tool component so one tool throwing doesn't crash the whole
panel), `lib/utils/evalTSSafe.ts` (a timeout-guarded `evalTS` wrapper for
action buttons that show toasts -- 15s default, resolves
`{success:false, error:"...busy..."}` instead of hanging forever if AE's
bridge is blocked by a modal or heavy render). **Below still describes
the pre-refactor single-file structure in places -- treat file paths as
"where this concept now lives," not literally, and check the actual
file if a path looks wrong.** The `screen` state shape itself (`Screen`
type, still exported from `main.tsx`) and the three-screen model
(home/category/tool) are unchanged by the refactor, only where the code
implementing each one lives.
- `src/jsx/aeft/aeft.ts` — ExtendScript backend for every tool, one
  section per tool, each ported 1:1 from its original `toolset/XYi_*.jsx`.
  Called from a tool's React view via `evalTS("functionName", ...args)`.
  Defensive `{success, error}` return shapes, never throws across the
  bridge.
- `src/js/main/main.tsx` — the shell. Three screens, tracked by a single
  `screen` state (`{type: "home"}` / `{type: "category", categoryId,
  selectedToolId?}` / `{type: "tool", toolId, backTo}` — `backTo` is the
  previous screen, so "Back" always returns one level up regardless of
  how you got there):
  - **Home**: logo + `TOOLBOX_VERSION` (bump by hand, `year.month` like
    the ScriptUI original's "Toolbox 2026.04", not semver) + a global
    search box (searches `TOOLS` by label, shows results inline, each
    result drills into a standalone full-page **Tool** screen) + the
    `<ToolsetTool />` one-click grid rendered directly, always visible,
    no click needed + `CATEGORIES`' cards (Localise/Review/Deliver/
    Tools).
  - **Category**: back button + a **master-detail layout**
    (`.category-master-detail` in `main.scss`) — every `TOOLS` entry
    whose `categories` array includes that category id listed on the
    LEFT (`.category-tool-list`), the selected one's `Component` mounted
    on the RIGHT (`.category-tool-content`). Selecting a different tool
    updates `screen.selectedToolId` in place — no navigation, no full
    page swap. Defaults to the first tool in the category if none
    selected yet. **Deliberately not a card-grid-to-full-page drill
    (that was the original design; changed after actual use showed
    forcing a full navigation for every tool inside a category added
    friction for no benefit — same reasoning as the Toolset-grid-vs-
    dedicated-page split).**
  - **Tool**: back button + the selected tool's `Component`, full width.
    Only reached from the home screen's search results now.
  **To add a new ported tool with real inputs: create
  `src/js/main/tools/X.tsx` + `X.scss`, add its ExtendScript functions to
  `aeft.ts`, and add one entry to the `TOOLS` array with a `categories`
  array** (a tool can belong to more than one — e.g. OV Library is under
  both `"review"` and `"localise"`). Nothing else needs to change.
- **The 4th category, "Tools", is a catch-all for general AE utilities
  that aren't tied to a specific campaign phase** (Random Layers lives
  here) — added deliberately alongside the studio's three named
  categories (Localise/Review/Deliver) since most of the ~23 old
  ScriptUI listbox-tab tools (Name Generator, Adjust, Master of Nulls,
  etc.) will likely end up here too as they get ported, not under one of
  the three business-phase cards.
- **One-click tools with no input fields (the CEP equivalent of
  `XYi_Toolbox.jsx`'s top button-grid) do NOT get their own `TOOLS`
  entry or category-card drill-down** — they go in `tools/Toolset.tsx`'s
  `ACTIONS` array instead, as one button in the always-visible grid on
  the home screen (label, hover tooltip description, and a `run()` that
  calls `evalTS`). Only give a tool its own `tools/X.tsx` page + `TOOLS`
  entry if it actually needs input fields, a scan/list, or persistent
  state (Random Layers needs Minimum/Range fields, so it's a real page;
  Turk It/Save From Comp/Rename Main Comp need nothing but a click, so
  they're grid buttons).
- `src/js/main/tools/*.tsx` + matching `*.scss` — one self-contained
  component per ported tool (or, for `Toolset.tsx`, per one-click action
  group). Each owns its own state and evalTS calls; tools don't share
  state with each other. Each tool's root element should NOT assume it
  fills the whole panel height on its own — it's mounted inside
  `.drill-body` (a flex child with its own height context) or, for
  `Toolset.tsx`, inline in normal document flow on the home screen — see
  `main.scss`'s `.drill-screen`/`.home-screen` rules.
- `src/js/main/shared.scss` — the only cross-tool shared style (currently
  just the `.spin` loading-spinner keyframe). Keep this file tiny —
  tool-specific styling belongs in that tool's own `.scss`.
- `src/js/main/main.scss` — shell chrome only (sidebar layout, tool nav).
  Not tool-specific styling — that lives in each tool's own stylesheet.
- Persistence: `app.settings` section `"XYiToolbox"` is shared across
  the whole toolbox (both this port and the still-live ScriptUI version)
  — e.g. key `"OVLibCampaigns"` for OV Library. Confirmed (from a survey
  of the full `toolset/` folder) as the ONLY settings section name used
  anywhere in this codebase; other known keys include `"UsefulFolders"`
  (shared between `XYi_Toolbox.jsx`'s inline tab and the standalone
  `XYi_Useful_Folders.jsx` — keep both in sync if either gets touched) and
  `"LocLibCampaigns"`/`"LocLibComponents"` (Localised Library — same
  keys the still-live ScriptUI version uses, so campaigns set up in
  either show up in both). Reuse this same section/key-per-tool
  convention for any new tool that needs to persist something.
- `cep.config.ts` — panel id is intentionally left as `com.xyi.ovlibrary`
  even though the product is now "XYi Toolbox" (`displayName`/
  `panelDisplayName` were renamed) — keeping the id stable means the
  already-registered extension just updates in place rather than
  orphaning a stale entry in AE's Extensions menu.

## Tools ported so far
- **OV Library** (`tools/OVLibrary.tsx`) — browse/import campaign master
  AE projects and renders by creative/size. See its own section below for
  naming-convention details. Categories: `["review", "localise"]`. Its
  own dedicated tool page (real inputs: campaign picker, creative list,
  filters).
- **Localised Library** (`tools/LocalisedLibrary.tsx`) — ported 1:1 from
  `XYi_Localised_Library.jsx`. A campaign → territory → component
  library: territories auto-detected from a campaign's Markets root
  folder, components added by hand (naming isn't consistent enough
  across campaigns to auto-pair reliably) or via "Find the Motion" (scans
  every territory, or just the currently-open one, for a "Support_Motion"
  or "Motion_Components" folder and adds every file found inside —
  read-only, skips files already in the library). **JPG_PNG was
  REMOVED from this eager scan** (previously included alongside the two
  motion containers) and now has its own dedicated LAZY section instead
  — see "Localised Library: JPG_PNG lazy browse + 'You may be in…'" further
  down for both that change and the territory-detection suggestion added
  alongside it. Scanned files from Find the Motion land pre-sorted into
  their own PNG/JPG/etc. folders automatically via the existing
  extension-bucketing (`folderForComponent()`, `LocalisedLibrary.tsx`)
  the "mini directories" feature already does.
  Categories: `["localise"]`
  only — **wasn't part of the vertical listbox tab system at all**; in
  the original toolbox it was launched next to the search bar, same as
  OV Library used to be, which is why it wasn't in the "22 listbox-tab
  tools" survey/scaffold batch. Reuses OV Library's `importFile()`/
  `revealFile()` directly (generic, path-based, no need to duplicate).
  The territory→country-code badge (cosmetic only, pairing logic never
  depends on it) reuses the same `TC_COUNTRIES` table Cheeky T Check's
  `territoryCheck()` already has, just the reverse lookup direction
  (`getTerritoryCountryCode()`) — ported from
  `XYi_Cheeky_InvT_Check.jsx`'s `getCountryCode()`.
  **Batch actions (new, not in the original ScriptUI tool)**: each
  component row has a checkbox, plus a "Select all" row, feeding two
  actions in an animated toolbar that appears once anything's checked —
  **"Import Selected (N)"** (`importLocLibComponentsBatch()`, read-only,
  imports into the CURRENT project, same as every other import in this
  app) and **"Save Into Batch Folder…"** (`importComponentsIntoBatchFolder()`,
  the confirmed open+save exception — see "Non-negotiable safety
  constraint" above for the full Masters-vs-batch-folder distinction and
  its guards). The second button is visually marked `.danger` (red
  border) in `LocalisedLibrary.scss` on purpose — it's the one action in
  this tool that writes to disk, and shouldn't look identical to the
  safe one next to it.
- **Random Layers** (`tools/RandomLayers.tsx`) — combines
  `XYi_RandomZ.jsx` + `XYi_RSP.jsx` into one tool (they share the same
  Minimum/Range fields in the original ScriptUI tab). Randomizes Z
  position or start time of the currently SELECTED layers. Categories:
  `["tools"]` (general utility, not tied to a campaign phase). Its own
  dedicated tool page (needs the Minimum/Range fields).
- **Toolset** (`tools/Toolset.tsx`) — the one-click action grid (see
  Architecture above). Real logic so far:
  - **Turk It / Un-Turk It** — bumps every comp's trailing `_VNN` version
    tag up/down in the CURRENTLY OPEN project.
  - **Save From Comp** — saves the currently open project to a new file
    per selected comp, named after that comp. Refuses to run if a
    resulting name would collide with the project's own current filename
    (the one real risk in this tool).
  - **Rename Main Comp** — renames every comp in a "Main" folder to
    match the project's own filename + version tag. Also fixed a latent
    regex mismatch from the original (`/V\d\d/` test vs `/_V\d\d/`
    extraction) to use the same pattern for both.
  - **Organise Folders** — ported from `orgFolWitDel()`. Arranges the
    open project's own comps/footage into standard folders
    (Composition/PreComp/Main, Footage/MOVs/Artwork/Solids/PNG), then
    removes any that end up empty. Only touches the open project.
  - **Frontcard** — ported from `FroCar()`. Imports the studio's brand
    Frontcard template (`importFile` only) and wraps the active comp in
    a new comp with it layered on top. **The template path
    (`/Volumes/newmedia/XYi Design/.../_Landscape.aep` /
    `_Portrait.aep`) is a hardcoded studio NAS mount, kept exactly as
    the original had it** — confirmed with the studio this is a
    consistent mount point on every artist's Mac, not a bug to fix. It
    will NOT resolve on a machine without that share mounted (e.g. this
    dev/test machine), so don't be alarmed if it errors here — that's
    expected until run on a real studio Mac.
  - **Cheeky T Check** — ported from `cheekyTCheck()`/`DT_Check()`
    (`toolset/XYi_Cheeky_DT_Check.jsx`), plus its two dependencies
    ported alongside it as helpers in `aeft.ts`:
    `XYi_Cheeky_N_Check.jsx` → `parseFilenameMeta()` (filename parsing)
    and `XYi_Cheeky_TT_Check.jsx` → `territoryCheck()` (territory-code
    → country-name lookup, `TC_COUNTRIES` table). The underlying
    `cheekyDTCheck(title, artwork, version, campaign, duration,
    territoryCheck, date)` takes the same 7 boolean flags `DT_Check` did
    — `cheekyTCheck()` is just that function called with the button's
    exact fixed args `(false, true, true, false, false, true, true)`.
    Whenever the "Cheeky DT" listbox-tab tool gets ported later, it
    should call `cheekyDTCheck()` directly with its own checkbox values
    instead of duplicating this logic.
    **This one reaches into a "Frontcard" precomp by hardcoded numeric
    layer indices** (3–8 or 11–16, depending on which of two known
    template variants is detected via a specific logo PNG layer name) —
    it's a faithful, direct port of that indexing, but **has not been
    tested against a real Frontcard-based project** and can't be from
    this dev machine. Test carefully on a real one before trusting it.
  - **DRQR** — ported from `toolset/XYi_DRQR.jsx`. Auto-scales a small
    active comp up to double (<1000px) or quad (<500px) resolution via a
    shared `scaleCompToFit()` helper (also ported from
    `XYi_Scaler.jsx`'s `onScaleClick()`'s whole-comp branch, using the
    null-parent scaling technique so cameras/all layers scale together).
    **Deliberately did NOT port** the original's `processLayers()`
    per-layer post-pass — it re-scaled each layer's source via a
    hardcoded `selectedLayers[1]` index that never tracked the actual
    loop variable, which reads as a bug rather than intent, and is
    redundant anyway since `scaleCompToFit()` already scales every layer
    together. Flagged to and confirmed with the studio before dropping it.
  - **Delivery** — ported from `DelPre()`. Strips a selected item's
    `_VNN` suffix, parses its target size from the resulting filename
    (via `parseFilenameMeta`, shared with Cheeky T Check), and wraps it
    in a new comp scaled to that size, trimmed to its work area.
  - **RenderMe!** (`renderMe`, `deliver.ts`) — new, NOT a port of
    anything in `toolset/`. Asked for as working "similar to how Deliver
    works" -- turned out, after actually reading `delivery()`'s real
    body, that this meant the UX shape (a one-click Toolset button) only:
    `delivery()` operates on `app.project.selection` and never touches
    the filesystem or render queue at all, so RenderMe! is its own
    function, not a variant. For the CURRENTLY OPEN, SAVED project: walks
    UP from the `.aep` file, checking at EACH ancestor level whether
    "Renders" exists as a SIBLING of that level (`llFindRendersFolder`,
    same "walk up, check siblings" technique `detectCurrentTerritory`
    already uses in `localise.ts` -- NOT `llFindContainerFolder`'s
    breadth-first downward search, since there's nothing to search
    downward into here, just an unknown number of levels to ascend from a
    known starting point) -- matches the real studio convention confirmed
    from folder screenshots (AE/JPG_PNG/Masters/Mechs/PDFs/PSD/Renders/
    Support_Motion all sit as siblings under one territory/market root).
    Creates (if missing) a same-named subfolder inside Renders matching
    whatever folder the `.aep` is directly inside of, adds the ACTIVE comp
    (`app.project.activeItem`) to the render queue with AE's own DEFAULT
    output module settings (no `applyTemplate()` call at all -- "default"
    taken literally, unlike `deliveryChecklistQueue`'s hardcoded
    `H264_<N>MBPS_MOS` template list), and redirects only the output
    FOLDER to that new Renders subfolder -- reads AE's own just-assigned
    default filename (`om.file.name`, already comp-name + whatever
    extension the current default template produces) before overwriting
    `om.file`, so the filename/extension stay exactly what "default"
    means rather than this function guessing an extension.
    **Two assumptions, flagged in the code, unverified against the real
    "AE" side of the folder tree** (only JPG_PNG's batch structure has
    been confirmed from real screenshots so far):
    1. The `.aep`'s own immediate parent folder IS the batch folder
       (projects sit directly inside e.g. `.../AE/Batch_3/file.aep`, not
       nested another level deeper) -- if wrong, the created Renders
       subfolder gets named after the wrong (too-deep) folder.
    2. "The active comp" is the one meant to be queued -- there's no
       picker UI on a single-click action, so if a project's real
       deliverable comp isn't the active one when this gets clicked, it
       queues the wrong comp. No "Main" folder convention used here
       (that's a real, separate pattern in this codebase -- see
       `renameMainComp`/`makeTextless`/`campaignLocaliserGenerate` -- but
       `delivery()` itself doesn't use it either, so this doesn't either,
       to stay consistent with its own stated model).
  - **Rotate 90CC** — ported from `rotNinty()`. Wraps each selected item
    in a new width/height-swapped comp rotated -90°. Doesn't touch the
    original item.
  - **Edit Markers** — ported from `EdiMar()`. Adds a transparent
    "Edit_Points" solid to the active comp with a marker at every
    layer's inPoint.
  - **Replicator** — ported from `XYI_Replicator.jsx`. Pure filesystem
    copy: recursively copies a source folder into a destination folder,
    skipping files that already exist there, writing a `file_list.txt`
    log. Never overwrites, no AE project touched.
  - **Transform Apply** — ported from `XYi_TransApply.jsx`'s
    `moveTransformsToEffect()`, called with all defaults true (same as
    the button). Moves each selected layer's Transform properties onto
    a Transform *effect*, preserving keyframes/easing, resetting the
    layer's own transform to default.
  - **Swapper** — ported from `XYi_Swapper.jsx`
    (`replaceLayerMatchWidth`). Replaces the one selected layer's source
    with whatever's selected in the Project panel, rescaling/
    repositioning to preserve visual width, anchor ratio, and position.
  - **Make Textless** — ported from `XYi_MakeTXTLS.jsx`. Recursively
    disables every layer labelled yellow (2) inside the first comp found
    in a "Main" folder.
  - **Scale Fit** — ported from `XYi_Scale_Exp.jsx`'s `fitAndScale()`.
    Adds a "Checkbox Control" effect (renamed "Extreme") and a fit/
    fill-to-comp expression on each selected layer's Scale property.
    **Preserved a discrepancy from the original rather than silently
    "fixing" it**: its own comment says step 3 disables the expression
    to bake a value before setting Scale to a fixed 24, but the actual
    code sets `expressionEnabled = true` (not false) — meaning the
    expression stays live and likely makes the final `setValue(24)`
    invisible in practice. Ported exactly as the code behaves, not as
    its comment claims — flag to the studio if 24 was meant to actually
    stick.
  - **Loc it** — ported from `XYi_LocIt.jsx`. Recursively scans a
    source folder for `.aep` files and copies them into
    `_<aspectRatio>_` subfolders under a destination folder, skipping
    any (campaign, duration) combination already present. Copy-only,
    never touches/removes source files.
  - **Mask Separator** — ported from `MasSep()` (originally by
    Christopher R. Green via aenhancers.com). Splits a layer with 2+
    masks into one duplicate layer per mask. The original's
    `confirm()`/`prompt()` dialogs are now `window.confirm`/
    `window.prompt` called from `Toolset.tsx` *before* `evalTS` runs
    (same pattern OV Library uses for "New Campaign") — the recenter
    flag and optional delimited name string are collected in the
    browser context, not from ExtendScript.
  - **Campaign Rename** — ported from `XYI_Campaign_Renamer.jsx`.
    Matches PDF filenames against AE project/QuickTime filenames by
    their shared **size** (WxH) field and borrows the PDF's descriptive
    tokens (screen name/campaign) into the AE-side filename — **this
    matching-by-size is intentional, confirmed with the studio**: PDFs
    carry the screen name that the AE/render side doesn't have yet, and
    size is the shared anchor to line the two up. (Initially flagged
    this as a likely bug before confirming the intent — worth noting
    for future sessions so it isn't re-flagged without checking here
    first.) The rename fallback path (`aeFile.copy()` then
    `aeFile.remove()`) is safe — `.remove()` only runs after `.copy()`
    has already verified success, so content is never lost even on that
    path. **One assumption preserved as-is**: the AE-side filename is
    assumed to have at least 4 tokens before its descriptive part,
    matching the documented studio convention (`ODY_INTL_DGTL_DOOH_...`)
    — a shorter filename than that will duplicate the resolution token
    in the output name. That's a faithful port of the original's exact
    assumption, not a new bug — flag it if a real filename trips it.
  - **MC It!** — ported from `toolset/XYi_pingLoc.jsx`. **Correction to
    an earlier mistake in this file**: this was previously logged as "a
    stub, no real logic exists" based on `MCItBut`'s name matching a
    same-named `MCIt()` function that really is just `alert('MC It!!')`
    — but that assumption was never actually checked against the real
    `.onClick` wiring. `XYi_Toolbox.jsx` actually has
    `MCItBut.onClick = pingLoc` — the `MCIt()`/`XYi_MCIt.jsx` alert is
    dead code nothing calls. The button's real job: batch-replace PNG
    footage across a folder of `.aep` files with the best-matching PNG
    (by resolution + PNG-number token match, then Jaccard/Levenshtein
    filename similarity) from a second folder, saving each file **in
    place**. See the confirmed-exception note under "Non-negotiable
    safety constraint" above for why this one doesn't copy-first like
    the other PNG/JPG-replacement tools — it's deliberate, not a gap.
    **Lesson for future sessions: don't infer a button's real handler
    from a matching function/variable name — grep the actual
    `X.onClick = Y` line.**
  - **To port a remaining stub: find its real logic in
    `toolset/XYi_*.jsx`, add the ExtendScript to `aeft.ts`, then just
    replace that one `stub(...)` call in `ACTIONS` with a real
    `{ id, label, description, icon, run, successText }` entry** —
    nothing else in the grid needs to change.

## Assets
- `src/js/assets/xyi-logo.png` — the studio's actual logo (navy "XYi
  design" wordmark + teal/blue gradient accent), rendered from a supplied
  `XYi_Design_Logo_Teal.ai` file (PDF-compatible under the hood) via
  PyMuPDF (`pip install pymupdf`, then `page.get_pixmap()`), auto-cropped
  to its visible bounding box, and downscaled to 360px wide. If a fresher
  logo export ever needs to replace it, that's the fastest path: PyMuPDF
  can rasterize any PDF-compatible `.ai`/`.pdf` directly, no Illustrator
  or Ghostscript/ImageMagick install needed. **Note**: the studio's own
  exported PNG versions of this logo (`XYi_Design_Logo_Teal.png` and the
  `(1)` copy) were broken — every pixel was pure white (255,255,255) with
  only alpha varying, i.e. no actual color data, likely an export bug on
  their end. Always render from the `.ai`/PDF source directly rather than
  trusting a pre-exported PNG from the studio without checking it first.

Turk It/Un-Turk It, Save From Comp, Rename Main Comp, and Organise Folders
only ever touch the CURRENTLY OPEN project's own comps/layers/filename —
no file dialogs, no scanning, no master files touched, so none of them
carry the master-file risk OV Library's scanning/import logic has to
guard against. Frontcard is the one exception in this batch: it
`importFile()`s a brand template (read-only, safe) but from a hardcoded
path outside the project. Cheeky T Check only touches the open project.

**Deliberately skipped**: `XYi_OpenComp.jsx` isn't wired into
`XYi_Toolbox.jsx` at all (confirmed by grep — no `nested_file` reference
anywhere), so it's an orphaned/WIP file, not part of the toolbox's actual
surface. Revisit only if the studio actually wants real functionality
behind it. (`XYi_MCIt.jsx`'s `alert('MC It!!')` is ALSO dead code, but for
a different reason than originally logged here — see "MC It!" in "Tools
ported so far" above for the correction: the button doesn't call that
function at all.)

## Listbox-tab tools (the 22 non-Toolset tabs)
`XYi_Toolbox.jsx`'s left-side listbox (`verticaltabbedpanel1_nav`) has 22
tabs beyond Random Layers (already ported). All 22 are now **scaffolded**
in `main.tsx`'s `TOOLS` array — visible, categorized, and navigable via
the category master-detail screen (see Architecture) — but each currently
renders via `tools/Placeholder.tsx`'s `makePlaceholder(title,
description)`, a "Not wired up yet" page, not real logic yet. **To port
one for real: find its logic in `XYi_Toolbox.jsx`'s matching inline tab
group (search the tool's function name, e.g. `SafeGen()`) and/or its
nested `toolset/XYi_*.jsx` file, add the ExtendScript to `aeft.ts`, then
swap that one `Component: makePlaceholder(...)` for a real component in
`TOOLS`** — same pattern as the Toolset grid's `stub()` → real entry
swap, nothing else needs to change.

**Five of the 22 are now REAL** (no longer `makePlaceholder()`), all
zero master-file-risk since each only ever touches the active comp/
selected project items — no file dialogs, no scanning:
- **Name Generator** (`tools/NameGenerator.tsx`) — `nameGeneratorGenerate()`
  builds `<FilmTitle>_<INTL|DOM>_DGTL_<Artwork>_<Campaign>_<W>x<H>_<Dur>sec_<Territory>`
  and renames every selected item to it (pure metadata rename, nothing
  saved to disk). `nameGeneratorDetect()`/`nameGeneratorParse()` is a 1:1
  port of `TC_nameBox()` from `XYi_Cheeky_N_Check.jsx` — reverse-parses a
  name back into the fields. "Reset" is client-side only, no aeft.ts call.
- **Scale Composition** (`tools/ScaleComposition.tsx`) — Scale by Width/
  Height/Factor, explicit Width+Height, Multi Comp Scale (scales every
  selected layer's source pre-comp to the active comp's size, then resets
  that layer's own Scale to 100%), Scale Detect, Scale by Name (parses a
  `WIDTHxHEIGHT` token out of the comp's own name), Scale Reset. All
  funnel through `scaleCompositionExplicit()`, which just calls the
  already-ported `scaleCompToFit()` (same null-parent technique DRQR
  uses) — confirmed byte-for-byte identical logic to `XYi_Scaler.jsx`'s
  `onScaleClick()` before reusing it rather than reimplementing.
  **NOT ported: "Guide Scale"** (`XYi_Guide_Scaler.jsx`'s `guider()`,
  reads ruler-guide positions on the active comp to size a selected
  pre-comp layer) — separate, more involved feature, left as a follow-up.
- **Adjust** (`tools/Adjust.tsx`) — Width/Height/Duration/Frame Rate/
  Aspect Ratio, each a direct one-property change with NO null-parent
  scaling (unlike Scale Composition) — e.g. adjusting width alone
  visually stretches layer content rather than scaling it proportionally.
  **That's the original `XYi_Adj.jsx` tool's actual behavior, not a
  porting bug** — don't "fix" it to proportionally scale without asking,
  the whole point of this tab vs. Scale Composition is that it doesn't.
  Duration adjustment recursively extends any layer (including nested
  pre-comps) whose outPoint fell short, up to its own source's natural
  length, ported 1:1 from `XYi_Adj.jsx`'s `adjustLayers()`.
- **Safe Generator** (`tools/SafeGenerator.tsx`) — draws a full-frame
  "ViewSafe" red solid as an alpha-inverted track matte plus a "SafeZone"
  solid sized either by edge margin (`safeGenerate()`) or explicit total
  size (`safeGenerateFull()`) — the matte dims everything OUTSIDE the
  safe area to 50% opacity, standard broadcast-safe visualization.
- **Master of Nulls** (`tools/MasterOfNulls.tsx`) — three one-click
  buttons on one page (fields not needed, but kept as its own `TOOLS`
  entry rather than moved to the Toolset grid since it was already a
  dedicated listbox tab): **Master Null** (`masterNullAll()`, was already
  inline in `XYi_Toolbox.jsx` as `MasNul()` — parents every unparented
  layer in the active comp to a new centered 3D null), **Master Selected
  Null** (`masterNullSelected()`, ported from `XYI_MasterNullSelected.jsx`
  — parents only the SELECTED layers to a new null placed above the
  topmost one, preserving any existing hierarchy), **Parental Guidance**
  (`parentInformer()`, ported from `XYI_ParentInformer.jsx` — read-only,
  reports which layers are parented to each selected layer via an alert-
  style message, no undo group needed since nothing changes).

Categorization (per explicit instruction: default everything to
Localise except named exceptions, discretion given for the Tools
bucket):
- **Localise**: Name Generator, Campaign Localiser, Edit Generator,
  Generate Cue Sheet, Cheeky DT, CSV Localiser, Check
- **Deliver**: originally Delivery Checklist + Adjust (Adjust also in
  Tools). **Superseded -- see "Deliver category overhaul: DeliveryHub"
  below.** Deliver is no longer a master-detail category at all; Adjust is
  Tools-only now.
- **Tools**: Scale Composition, Adjust, Safe Generator, Edit Tools, Find
  and Replace, Master of Nulls, Wall Tools, Extreme Tools 01, Extreme
  Tools 02, LOS Tools, Master Tools, Project Buttons, Timesheet Tracker,
  Useful Folders (plus Random Layers, already there)

**Campaign Localiser's "Generate Files" / "Generate Files (don't
replace)" / "AEP Thief" are now REAL, ported from
`toolset/XYi_Campaign_Scanner.jsx`'s `campLoc(path, sartre, false)` and
`toolset/XYi_Copy_AEP.jsx`** (`tools/CampaignLocaliser.tsx`,
`aeft.ts`'s `campaignLocaliserGenerate()`/`copyAep()`/
`scanMastersForBestMatch()`). **This is ANOTHER confirmed, deliberate
exception to the copy-first rule — like MC It!, but for a different
reason: the studio explicitly asked to retain this logic EXACTLY as the
original, including its direct `app.open()` on the matched master.**
That's safe in practice (not just "trust the instruction blindly")
because the result is always saved to a brand-new file
(`<newCompName>_V01.aep`) in the *localisation file's* folder — never
back to the master's own path — and the project is closed with
`CloseOptions.DO_NOT_SAVE_CHANGES` afterward. The master's on-disk bytes
are never modified. **If this logic is ever changed to save in place,
that becomes a real violation — don't introduce one.** Reuses
`cheekyDTCheck()` and `drqr()` directly (already-ported logic, not
reimplemented) for the auto-QC-and-preview-scale step the original
does on each generated variant.

**"Trotting Along" (Trott!/Trott 2.0) and "PDF to CSV" are now REAL too**
(same `tools/CampaignLocaliser.tsx` page, `aeft.ts`'s
`campaignLocaliserTrott()`/`campaignLocaliserTrott2()`/
`pdfToCsvGenerate()`). All three walk a folder of client PDFs sitting in
a `"PDFs"` folder somewhere under a territory root, match each PDF to a
master by filename, and mirror the PDFs folder's relative path into a
sibling `"AE"` output folder.
- **Trott!** (`XYi_Campaign_Trotter.jsx`) and **Trott 2.0**
  (`XYi_Campaign_Trotting2.jsx`) both `app.open()` the matched master
  directly, no copy-first — **the SAME confirmed exception Campaign
  Localiser's "Generate Files" already has**, for the identical reason:
  the result always saves to a brand-new `_V01.aep` under the derived AE
  folder, never back to the master's path, closed with
  `DO_NOT_SAVE_CHANGES` right after. Both buttons pop TWO native folder
  dialogs in sequence when clicked (Master/loc folder, then PDF folder)
  — this happens inside `aeft.ts`, not as pre-selected React state,
  matching `TroAlo()`/`TroAloTwo()` exactly (each does its own
  `Folder.selectDialog()` for the masters path before calling `campLoc()`,
  which does a second one for the PDF folder).
- **Trott 2.0 differs from Trott! in matching strategy, not just
  version number**: Trott! uses simple filename-token stripping
  (`trotGimmeV1()`) plus the Duration/Artwork/Campaign override fields
  when their "Use X" checkboxes are on. Trott 2.0 pre-scans every master
  `.aep` under the masters path and Jaccard-matches each PDF's own
  filename against them (`trotJaccardHybrid()`/`trotGimmeV2()`) to
  auto-detect campaign/artwork/duration — **its
  Duration/Artwork/ArtworkOn/Campaign/CampaignOn parameters are accepted
  but never used**, confirmed dead in the original (the toolbox tab
  shares one set of fields across both buttons, so the signature has to
  match even though Trott 2.0 ignores them — same class of quirk as
  Build From CSV's page/art/tt).
- **PDF to CSV** (`XYi_PDF_to_CSV.jsx`) never opens any project — just
  scans filenames and writes a `Campaign_Data.csv` next to the PDFs'
  mirrored AE folder. Zero master-file risk. Reuses the same Jaccard
  matching as Trott 2.0 (same "Based on Campaign Localiser Logic"
  comment in the original) rather than a third copy.
- **A subtle but real fidelity trap, caught by diffing the three
  original files directly instead of assuming they matched**: all three
  have their own `findPDFsFolder()`/`findTerrFolder()` copy-pasted
  in-file. `findTerrFolder()` really is identical across all three
  (only comments differ). `findPDFsFolder()` is NOT — `XYi_PDF_to_CSV.jsx`'s
  copy has an extra fallback (`if (aeFolderPath == "") aeFolderPath =
  startFolder.fsName`) that neither Trotting file has. Ported as two
  separate functions (`trotFindPDFsFolder()` for both Trotting tools,
  `pdfCsvFindPDFsFolder()` for PDF to CSV) rather than one shared helper
  — **don't assume near-identical-looking copy-pasted functions across
  sibling files are actually identical; diff them.**
- `nameGeneratorParse()` (Name Generator's `TC_nameBox()` port) gained a
  `duration` field for this batch of tools — Trott 2.0/PDF to CSV both
  need the same filename-duration extraction Name Generator's "Detect
  Name" already had access to internally but didn't expose. Purely
  additive; existing callers don't read the new field.

**Correction: "Find and Replace" is NOT unfinished** — the earlier survey
note above was wrong. Its `FinAndRepTab.add(...)` calls for the two text
fields and three buttons (`original`/`replaceWith`/`RepComBut`/
`RepAllBut`/`RepResetBut`) sit ~900 lines further down in
`XYi_Toolbox.jsx` than the tab's own group declaration — added later,
out of the original declaration order, which is what made two
independent surveys of the declaration block alone miss them. The
feature is fully wired and now REAL (`tools/FindReplace.tsx`,
`aeft.ts`'s `findReplace()`). Lesson: a tab appearing empty at its
declaration site doesn't mean the tab is unfinished — grep the whole
file for the tab's variable name before concluding that.

**Six more of the 22 are now REAL**, ported in the same batch as Find
and Replace, all zero master-file risk (comp/layer/project-item only,
or a local file-open dialog with no `app.open()` on a project):
- **Edit Tools** (`tools/EditTools.tsx`) — Fuse Shots
  (`editToolsFuseShots()`) and Snuggle Layers
  (`editToolsSnuggleLayers()`) are real. **"Detect Edit (Old)" is
  intentionally dropped** (studio-confirmed) — labelled "(Old)"/
  deprecated in the source; its logic (`XYi_EdDec.jsx`'s gateDetect())
  is a fragile precompose-based frame-difference analysis. The studio
  said don't carry it over. (Earlier drafts of this file called it
  "NOT ported yet"; it's now a permanent, confirmed removal.)
- **Wall Tools** (`tools/WallTools.tsx`) — Generate Wall / Generate Wall
  Aspect Ratio (`wallGenerate()`/`wallGenerateAspect()`, ported from
  `XYi_WallGen.jsx`'s `createGrid()`), Focal Organiser
  (`focalOrganiser()`, ported from `XYi_DistCalc.jsx`), and **Wall Queue
  (`wallQueueUpdate()`) are ALL real now** — Wall Queue was ported later
  (see its dedicated entry above, including the multi-select hardening).
  The earlier "reads as a bug, deliberately NOT ported" call here was an
  over-flag; corrected.
- **Extreme Tools 01** (`tools/ExtremeTools01.tsx`) — both the landscape
  (`extremeToolsLandscape()`, `XYi_ExtremeTools.jsx`) and portrait
  (`extremeToolsPortrait()`, `XYi_ExtremeTools_Port.jsx`) surround-video-
  wall comp generators are real — brand-new comps/solids only, no file
  access at all. Opens the resulting "Main Comp" in the viewer via
  `openCompInViewer()` (ported from `XYi_OpenComp.jsx`'s
  `openCompByName()` — a normal `layer.openInViewer()` UI action,
  unrelated to the master-file "never open a project" rule, which is
  specifically about `app.open()`-ing a `.aep` file).
  **Extreme Tools 02 is now REAL** (this line used to say "NOT ported";
  it was ported in a later batch) — Build From CSV
  (`extBuildCompFromCsv()`, `XYi_BuildExtCsv.jsx`, import-only) and
  Adjust From CSV (`extAdjustCsvApplyToProjects()`, `XYi_AdjustExtCsv.jsx`,
  already copy-first-patched, reuses `losSafeOpenMasterCopy()`). See the
  "Extreme Tools 02 is now REAL" entry above for details.
- **Master Tools** (`tools/MasterTools.tsx`) — Auto AR
  (`autoAspectRatio()`, ported 1:1 from `XYi_AutAR.jsx` — builds Point/
  Slider Control "rig" effects per named aspect-ratio preset on each
  selected layer, then drives a real Transform effect via a generated
  interpolation expression; entirely effects/expressions, touches no
  files), Velocity Scaler (`velocityScaler()`, `XYi_VelSca.jsx`), the
  Aspect Ratio/Extreme-format one-click comp resizer grids (both share
  `resizeCompositionCentered()`, ported from `XYi_CompSize.jsx`'s
  `resizeCompCentered()`), and Transform Apply - Scale/Position (reuse
  the already-ported `transformApply()`, which was refactored to take
  its 5 original `(doAnchor, doPos, doRot, doScale, doOp)` boolean flags
  as optional args instead of hardcoding them all `true` — the plain
  "Transform Apply" grid button still calls it with no args).
- **Project Buttons** (`tools/ProjectButtons.tsx`) — Shape to Masks
  (`shapeToMasks()`, `XYi_ShapeCon.jsx`), C4D Line Art (`c4dLineArt()`,
  `XYi_C4DLineart_Front.jsx` — reads a C4D-exported CSV via a normal
  `File.openDialog()`, no project/master file touched), Optimal
  Placement (`optimalPlacement()`, `XYi_Optimal_Placement.jsx`), and
  Detail-Preserving Scale (`detailPreservingScale()`, the inline
  `PreDetSca()`), and **Midcarder (`midcarder()`) are ALL real now**.
  Midcarder was ported later once the studio confirmed "bring it in as
  is" — it's a CONFIRMED master-touching exception (see its dedicated
  entry above). The earlier "deliberately NOT ported, needs confirmation"
  status here is resolved; kept the copy-first-free, save-as-then-reopen
  logic exactly as the original had it, per the studio's instruction.
- **Useful Folders** (`tools/UsefulFolders.tsx`) — full CRUD (add via
  `Folder.selectDialog()`, rename, remove, reveal in Explorer/Finder),
  persisted via the SAME `app.settings` section/key
  (`"XYiToolbox"`/`"UsefulFolders"`) the still-live ScriptUI tab uses —
  shortcuts added in either show up in both.

**LOS Tools is now REAL** (`tools/LOSTools.tsx`, `aeft.ts`'s
`losApplyCsvToProjects()` + `losSafeOpenMasterCopy()`/
`losFindBestComponentFile()`/etc. helpers) — a faithful port of the
already-safety-patched `XYi_LOSCsv.jsx` (copy-first `app.open()`, part
of the original 4-tool fix earlier this session), so no new safety work
was needed here, only wiring. For each .aep in a chosen project folder:
matches a same-size-token CSV, opens a VERSIONED COPY (never the
original), replaces a named target layer's source in every comp under a
"Main" folder with the best-matching component file (hybrid Jaccard +
Levenshtein + Jaro-Winkler string scoring, ported 1:1), then saves and
closes that copy. The project's own on-disk bytes are never touched.

**Corrected after user follow-up**: the first pass of this port silently
changed three things vs. the original that shouldn't have changed —
caught by the user asking directly whether the behavior had been
altered, not by any review step. All three are now fixed to match
`XYi_LOSCsv.jsx` exactly:
1. The original shows 7 different `alert()` popups at specific failure
   points during the batch (no matching CSV, no ART row, no Main folder,
   missing component file, import failed, import returned null, replace
   source failed). The first pass replaced all of these with a silent
   `skipped++` counter — dropped every one of those alerts. Restored.
2. On a failed layer replacement, the original's inner loop does
   `continue` (keep scanning the same comp for another layer that also
   happens to be named `TARGET_LAYER_NAME`) — the first pass used `break`
   (abandon the comp on first failure) instead, a real control-flow
   difference for the edge case of a comp with more than one layer
   sharing that name. Restored to `continue`.
3. The original has no closing summary — it just finishes silently once
   every `.aep` is processed. The first pass invented a "Processed X
   project(s), skipped Y" final message with counters that don't exist
   in the source. Removed.

**Lesson for this codebase**: "ported faithfully" claims should be
checked against the actual original source line-by-line when it matters
(safety-patched, master-touching tools especially), not asserted from
memory of having read it earlier. `alert()` calls are easy to drop
silently while restructuring control flow into this port's usual
`{success, error}`-return convention — watch for that specifically when
porting any script that uses `alert()` for mid-batch user feedback
rather than a single final result.

**Four more of the 22 are now REAL**, all zero master-file risk:
- **Edit Generator** (`tools/EditGenerator.tsx`) — ported from
  `XYi_EdGen.jsx`'s `EditGen()`/`EditGenNoFirst()`. **Bug fix vs. the
  original**: the "Exclude First Image / Sequence" checkbox was wired to
  `checkbox3.text` (a STRING, not the checkbox object) and then checked
  `.value` on that string — always `undefined`, so the checkbox never
  did anything in the original; it now takes `excludeFirst` as a real
  boolean. Same class of fix as Rename Main Comp's regex mismatch
  earlier this session — check `editGeneratorArrange()`'s comment in
  `aeft.ts` before assuming any XYi_*.jsx checkbox/field wiring is
  correct just because it looks plausible.
- **Generate Cue Sheet** (`tools/GenerateCueSheet.tsx`,
  `aeft.ts`'s `generateCueSheet()`) — ported from `XYi_Cue.jsx`.
  **Also deletes layers it detects as exact duplicates from the active
  comp as a side effect** — the original's actual behavior (matches by
  an identical name+in/out-point signature), not something introduced
  in porting. Surfaced explicitly in the tool page's own copy so it's
  not a surprise.
- **Cheeky DT** (`tools/CheekyDT.tsx`) — the general-purpose version of
  Cheeky T Check. Wires up 7 checkboxes directly to the ALREADY-PORTED
  `cheekyDTCheck()` (no new aeft.ts logic needed — this tab was always
  just `DT_Check()` called with the checkbox values instead of the
  fixed args Cheeky T Check uses) plus a Territory Check button reusing
  the already-ported `getTerritoryCountryCode()`.
- **Check** (`tools/Check.tsx`) — a QC grab-bag, all independent and
  self-contained: Aspect Ratio Rename (`checkAspectRatioRename()`,
  `XYi_Aspect_Rename.jsx` — adds/strips a `_<ratio>_` filename prefix in
  a chosen folder), Effects Used (`checkEffectsUsed()`,
  `XYi_EffCheck.jsx` — read-only report), Comp / Footage Details
  (`checkCompFootageDetails()`, `XYi_CompCheck.jsx` — read-only report),
  File Name Check (`checkFileNameCheck()` — reuses `nameGeneratorParse()`
  rather than duplicating `XYi_Cheeky_N_Check.jsx`'s `TC_nameBox()`
  logic a second time), Marker Comment Guide (`checkMarkerGuide()`,
  `XYi_Markers.jsx` — writes every marker's comment across the whole
  project to a Desktop .txt), and Render Check (`checkRenderCheck()`,
  `XYi_Render_Check.jsx` — imports MOVs + matching images from two
  chosen folders into brand-new comps; never opens an existing project).

**CSV Localiser is now REAL** (`tools/CSVLocaliser.tsx`, `aeft.ts`'s
`csvLocaliserRun()`) — ported from `XYi_Campaign_CSV.jsx`'s
`campLocCSV()`. **Turned out NOT to need a safety exception at all**: the
earlier flag above assumed it might need the same "confirmed exception"
treatment as Campaign Localiser, but reading the actual source showed
it's already copy-first in the original (`masterFile.copy(workingCopy)`
then `app.open(workingCopy)` — the master itself is never opened). This
is in fact the file this whole project's copy-first safety pattern is
modeled on (`ov_safeOpenMasterCopy()` in the patched jpgLoc/AdjustExtCsv/
LOSCsv all cite it as the reference). Lesson: "likely needs the same
exception" was a reasonable guess but still a guess — reading the file
resolved it definitively without needing to ask the studio. Paste CSV
text (a `[METADATA]` block with `Territory:`/`Batch:`/`Source Folder:`
lines, then Artwork/Campaign/Size/Duration rows) against a rememberd AEP
source path (persisted via `app.settings`, same `"CSVLocLastPath"` key
the ScriptUI version uses); each row is matched to the closest-aspect-
ratio master via the same `scanMastersForBestMatch()` Campaign Localiser
uses, copied to a new working file, localised, and saved. Territory name
→ code reuses `getTerritoryCountryCode()` (no duplicate lookup table).
Ported with the same alert()-per-row-failure / alert()-on-final-count
behavior as LOS Tools, for the same fidelity reason (see below).

**Extreme Tools 02 is now REAL** (`tools/ExtremeTools02.tsx`) — both
halves:
- **Build From CSV** (`extBuildCompFromCsv()`, `XYi_BuildExtCsv.jsx`) —
  import-only, no master risk. Builds a single new comp from a CSV of
  positioned/masked/sequenced assets (imports each, or a red placeholder
  solid if missing/oversized), then slices `ART`-type masked regions
  into their own sub-comps. **The `page`/`art`/`tt` parameters are
  accepted but never used** — matches the original exactly (the toolbox
  passes all 4 fields into `buildCompFromCSV(dur, page, art, TT)` but
  only `dur` is ever read inside; same class of dead-parameter quirk as
  Edit Generator's checkbox, kept rather than "cleaned up").
- **Adjust From CSV** (`extAdjustCsvApplyToProjects()`,
  `XYi_AdjustExtCsv.jsx`) — already safety-patched at the source-file
  level (copy-first via `ov_safeOpenMasterCopy()`, the exact same helper
  LOS Tools uses — reused directly via `losSafeOpenMasterCopy()` rather
  than redefined, since the function bodies are identical). **Has NO
  pre-selection fields in the toolbox tab at all** — clicking the button
  pops both folder-select dialogs directly (CSV folder, then AEP
  folder), silently doing nothing if either is cancelled. The React page
  matches this exactly (a single button, no folder-path state) —
  don't add picker fields here without checking the original again.

**All 22 of the original listbox-tab tools are now real** — the port is
complete for every tool that has a button/tab/listbox entry pointing at
it in `XYi_Toolbox.jsx`. `tools/Placeholder.tsx`'s `makePlaceholder()`
is no longer used anywhere but is kept for the ~60 still-fully-unported
`XYi_*.jsx` files that aren't wired into any tab/button yet (see the
"Listbox-tab tools" section below for that count and the rule for
porting one of those independently).

**Fidelity policy, confirmed explicitly by the user after a real
mistake**: LOS Tools' first port silently dropped the original's
`alert()` calls, changed a `continue` to a `break` on a failure path,
and invented a summary message that didn't exist in the source (caught
only because the user asked directly whether behavior had changed, not
by any review step — see the LOS Tools entry above for the fixed
version). The user then confirmed: keep the small number of deliberate
bug fixes already made (Edit Generator's dead checkbox, Rename Main
Comp's regex mismatch — both documented at each fix site) and don't
introduce more without flagging them first, but every tool ported
**after** that point (CSV Localiser, Extreme Tools 02, Delivery
Checklist, Timesheet Tracker) was held to strict 1:1 fidelity —
including alert() calls, dead/unused parameters, exact button/field
labels, and control-flow quirks. **Before claiming any port is
"faithful" or "1:1," re-read the actual original source file being
ported, not a summary or memory of having read it earlier** — that's
what the LOS Tools mistake actually was: an inaccurate summary of
fidelity, not a deliberate deviation.

**Delivery Checklist and Timesheet Tracker are now REAL** (the two tabs
that loaded separate injected files rather than building UI inline in
`XYi_Toolbox.jsx`). Both are zero master-file risk:
- **Delivery Checklist** (`tools/DeliveryChecklist.tsx`, `aeft.ts`'s
  `deliveryChecklistLoadComps()`/`deliveryChecklistQueue()`) — ported
  from `XYi_Delivery_Checklist.jsx` ("Bitrate Delivery Panel"). Loads
  selected comps, takes a target size (MB) per row, computes the
  required bitrate, queues each comp with the closest
  `H264_*MBPS_MOS` Output Module template (rounding DOWN, never
  exceeding target; the 50 template is `Mbps` not `MBPS` — quirk kept),
  and points output at a `_Delivery` folder next to the comp's `.mov`
  source. Render-queue only. Comps are tracked across the bridge by
  `item.id`/`itemByID()` since the selection can change between Load
  and Queue. Constants/math ported 1:1 (192kbps audio reserve, 0.1Mbps
  floor, decimal MB convention).
- **Timesheet Tracker** (`tools/TimesheetTracker.tsx`, `aeft.ts`'s
  `timesheetGetLists()`/`timesheetStartInfo()`/
  `timesheetProjectFileName()`/`timesheetCopyToClipboard()`) — ported
  from `XYi_AE_Timesheet_Link.jsx`. The timer runs in React
  (setInterval, replacing the original's `app.scheduleTask()` label
  hack); ExtendScript supplies only what needs AE: job/territory
  auto-detection from the saved project's folder path (nearest
  `XY<digits>` folder = job code, nearest exact territory-name folder =
  territory), comp/file names, and the pbcopy/clip clipboard trick.
  JSON payload shape is 1:1 (version 5, M/D/YYYY date, 12-hour
  timeLogged, **including the original's exportDate quirk of local time
  with a hardcoded `.000Z` suffix** — the downstream React timesheet
  app expects exactly that, don't "fix" it to real UTC). **The three
  data arrays (351 jobs / 100 territories / 47 categories) were
  extracted VERBATIM from the original by a throwaway Node script, not
  retyped** — when the studio updates the job list in
  `XYi_AE_Timesheet_Link.jsx`, re-extract rather than hand-editing
  `TS_DEFAULT_JOBS` in `aeft.ts`. The React dropdowns fetch these lists
  over the bridge at mount (small clearly-labeled mock fallback in
  browser preview).

**Timesheet Tracker and Useful Folders are both multi-category by
explicit request**: `categories: ["tools", "review"]` for Timesheet
Tracker, `categories: ["tools", "localise", "review"]` for Useful
Folders — same pattern as OV Library (`["review", "localise"]`) or
Adjust (`["tools", "deliver"]`), just user-requested placements rather
than inferred from the tool's function. If either tool's category list
looks incomplete later, check with the user before assuming it's a bug
— it may just not have been asked for yet.

**Correction to an earlier note in this file**: this used to say "~60
tools remain in `toolset/` fully unported." That was written early in
the session, before most of the toolbox had been ported, and was never
corrected as things got wired — don't trust a stale count like that
again without re-verifying. A real reachability check (does
`XYi_Toolbox.jsx` reference this filename, directly or transitively
through another file it loads?) across all 69 `.jsx` files in
`toolset/toolset/` found only **4 genuinely orphaned files**, all now
confirmed harmless, none representing missing functionality:
- `XYi_Useful_Folders.jsx` — not missing anything; a standalone twin of
  the already-ported inline "Useful Folders" tab, sharing the same
  `app.settings` key on purpose (see that tool's entry above).
- `XYi_Cheeky_T_Check.jsx` — a dead, superseded predecessor of Cheeky T
  Check (hardcoded numeric layer indices, its own inline territory
  table) — replaced by `XYi_Cheeky_DT_Check.jsx`, which IS ported
  (`cheekyTCheck()`/`cheekyDTCheck()`). Leftover cruft from before a
  rewrite, not a missing tool.
- `XYi_Jaccard.jsx` — a scratch/test file, not a tool: a standalone demo
  of the Jaccard+Levenshtein matching algorithm with a hardcoded test
  array and a debug `alert()`. The real algorithm is already inlined in
  MC It's and LOS Tools' matching logic.
- `XYi_JPEG_Delivery_Name.jsx` — genuinely orphaned and looks
  unfinished: stitches together two unrelated blocks (a comp-creation
  snippet, then a separate JPEG batch-rename function) with no single
  clear entry point and no button pointing at it anywhere. Reads like
  an abandoned experiment, same category as the already-documented
  `XYi_OpenComp.jsx` false alarm and `XYi_MCIt.jsx` dead code.

**Every other file in `toolset/toolset/` is reachable from the toolbox's
UI and has been ported.** If a new `XYi_*.jsx` file shows up later, run
the same check before assuming it's unwired: grep `XYi_Toolbox.jsx` and
every already-ported file that itself does `eval(nested_file.read())`
for the new filename, since references chain through more than one
level (e.g. Extreme Tools 01's two functions are the only things that
reference `XYi_OpenComp.jsx` — it's not in `XYi_Toolbox.jsx` directly).

## OV Library naming conventions (confirmed against real studio folders
during development — not assumed)
- Masters: `<mastersRoot>/AE/<Creative>/<...>_<width>x<height>_<duration>sec<suffix>.aep`,
  e.g. `ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV.aep`. The comp
  inside the file is named identically to the filename stem — confirmed
  across a real ~29-file campaign folder.
- Renders: `<mastersRoot>/Renders/<Creative>/` mirrors the `AE/` tree; a
  render is matched to a master by identical filename stem (extension
  aside). **This pairing convention is UNVERIFIED against a real render
  filename** — if renders come back "no matching render found" when one
  clearly exists on disk, check this first.
- QUAD is a named print/OOH format keyword, not a width/height ratio —
  detected by an explicit `QUAD` token in the filename, matching the
  existing studio tooling's stopword list (`Trotting2.jsx`). **Never
  confirmed against a real QUAD master file** — if one exists and lands in
  the wrong orientation group, this detection needs revisiting.
- Folders starting with `_` (e.g. `_DEV`, `_old`, `_archive`,
  `_TERRITORY_TEMPLATE`) are excluded from every scan across this whole
  toolset, not just OV Library.

## Known unknowns / most likely first bugs
- `aeft.ts`'s OV Library functions have been built and type-check/build
  cleanly, but **have not yet been run against a real `.aep`/render file
  on disk** — only against `scripts/make-test-masters.cjs`'s empty
  placeholders, browser mock data, and (as of the sidebar-shell rewrite)
  a real local AE test confirmed the scan/import/UI flow works end to
  end. The render-pairing and QUAD-detection caveats above are still
  unverified against real files.
- `Turk It`/`Un-Turk It` has been type-checked and built but not yet
  exercised inside a real AE project with actual `_VNN`-suffixed comps.

## Packaged ZXP gotcha: every tool's own CSS was never loading (fixed)
Found from a real install, not preview: after `yarn zxp` and installing in
real AE, the vertical category tool-list looked fine but every individual
tool's own page was essentially unstyled -- described as "styling on the
submenus was non existent except for the buttons." Root cause was in the
build pipeline, not any tool's own code:

- CEP has no native ESM/dynamic-`import()` support, so `vite-cep-plugin`'s
  production output uses a hand-rolled, synchronous `require()` module
  loader (a big inline `<script>` at the top of the built `index.html`
  that fetches each `.cjs` chunk via a blocking `XMLHttpRequest` and
  `eval`s it with `new Function(...)`) instead of a real browser
  `<script type="module">`/`import()`. That loader only knows how to
  fetch and eval JS text -- it has **zero CSS-injection logic**.
- Vite's default `cssCodeSplit: true` still happily generated a separate
  `.css` file per lazily-loaded chunk -- since every tool in
  `toolRegistry.tsx`'s `TOOLS` is `React.lazy(() => import("./tools/X"))`,
  that's one `.css` file per tool (confirmed: 8 extra files sitting in
  `dist/cep/assets` alongside `main-*.css` before the fix). Nothing ever
  created a `<link>` for any of them -- only the ONE static `<link
  rel="stylesheet">` for the eager main entry's own CSS (`main.scss`,
  `Dialog.scss`, `CommandPalette.scss`, `shared.scss` -- everything
  reachable without a lazy import) ever actually loaded.
- **This is why it was invisible in `yarn dev` browser preview no matter
  how thoroughly the UI got tested that way**: the dev server uses Vite's
  real ESM pipeline, which DOES auto-inject a lazy chunk's CSS the moment
  that chunk is imported -- completely different code path from the
  production `vite build` output this bug only exists in. Same class of
  trap as the ExtendScript-only bugs elsewhere in this file (invisible in
  preview, only surfaces the first time something runs for real) --
  just on the frontend build side instead of the ExtendScript side this
  time. **If a future styling bug only reproduces from an installed ZXP
  and never in `yarn dev`, suspect the build pipeline before suspecting
  the component's own code.**
- **Fix**: `vite.config.ts`'s `build.cssCodeSplit: false` -- forces every
  reachable stylesheet (shell + all 25 tools) into the one CSS file that
  was already always being linked, rather than teaching the custom loader
  to also inject per-chunk `<link>` tags. No real bundle-size/load-time
  cost that matters for a panel installed and loaded from local disk.
  Verified at the build-artifact level (only one `.css` file now
  generated, confirmed linked in `index.html`, confirmed it contains both
  shell classes like `.category-tool-list` AND tool-specific classes like
  `.component-row`/`.creatives-grid`) -- this fix can't be verified via
  `yarn dev` (never reproduced the bug to begin with) or this project's
  usual browser-preview workflow; it needs a real `yarn zxp` + reinstall
  in AE to see confirmed fixed, the same way the original bug was found.

## ExtendScript engine gotchas found the first time this ran for real
Browser preview mode (`yarn dev`) **never executes ExtendScript at all** --
it only exercises the React side, falling back to mock data the moment
`evalTS` fails to find a bridge. That means an entire class of bug is
structurally invisible in preview no matter how much of it you test, and
only surfaces the first time a tool actually runs inside real AE. Two were
found and fixed this way; assume there may be more lurking in
less-exercised tools, not just these two:

1. **Missing `Array.prototype` ES5 methods.** ExtendScript's JS engine
   doesn't have `indexOf`, `filter`, or `map` on arrays, even though
   `String.prototype.indexOf` and `Array.prototype.sort` have always been
   there -- a well-known, long-documented ExtendScript limitation, not a
   bug in any specific function. Surfaced as a real
   `ReferenceError: Function uniquePages.indexOf is undefined` the first
   time `extBuildCompFromCsv` ("Build From CSV") ran for real. **Fixed
   with feature-checked polyfills near the top of `aeft.ts`** (before the
   OV Library section) for exactly the three methods actually used in this
   file (`indexOf`, `filter`, `map` -- checked via grep, no `forEach`/
   `some`/`reduce`/etc. in use, so no polyfill was added for those). If a
   future port introduces one of those, add its polyfill there too rather
   than assuming the engine has it because "it's basic JS."
2. **`.match()` used as a substring check on real folder names.**
   `getTerritoryCountryCode()` and `territoryCheck()` did
   `someString.match(userInput)` to check "does this string contain that
   one" -- `.match()` treats its argument as a *regex pattern*, and a real
   territory folder name containing regex-special characters (parentheses,
   `+`, etc. -- e.g. `"APAC (ex. China)"`) throws a `SyntaxError` instead
   of just not matching. **Fixed by switching both to
   `.indexOf(...) !== -1`**, which has the same substring semantics with
   no regex-injection risk. This specifically broke Localised Library,
   which calls `getTerritoryCountryCode()` once per territory on open --
   real territories with regex-unsafe names threw once each, and the UI's
   generic `safeEvalTS` catch-all mislabeled every one of them as "No CEP
   bridge detected" even though the bridge was fine, which is what made
   this look like a connection problem instead of a thrown exception.
   **If you ever add a new `.match()` call fed by a folder/file name (not
   a fixed, known-clean string like a country code), use `.indexOf()`
   instead** unless you genuinely need regex features and have escaped the
   input first.
3. **`LocalisedLibrary.tsx`'s `safeEvalTS` now distinguishes a genuine
   missing bridge from a real thrown ExtendScript exception** (shows
   `e.message` for the latter instead of the same hardcoded "no bridge"
   string for both) -- this is what made bug #2 traceable in the first
   place instead of being permanently misdiagnosed as a connectivity
   issue. Other tool files share the same `safeEvalTS` pattern
   (`OVLibrary.tsx` and others per the file-header comment) and have the
   same generic-catch flaw; not fixed everywhere yet, only where it
   actually mattered for this bug.
4. **Country-code badge lookups still produced error toasts against a
   real ~40-territory campaign, even after bug #2 was fixed.** Confirmed
   these weren't the same regex-crash bug: the toasts showed the exact
   generic "No CEP bridge detected" text (per fix #3, a real thrown
   exception would show its own `.message` instead), meaning `evalTS`
   genuinely resolved to `undefined` for a handful of calls -- most
   likely an occasional CEP bridge hiccup surfacing only at real scale
   (tens of sequential round-trips in one campaign), not something
   earlier testing with 2-3 mock territories could have caught. Rather
   than chase an intermittent bridge issue, fixed the actual design bug
   underneath it: a **decorative, unrequested lookup (a territory's
   country-code badge) was wired through `safeEvalTS`, which always
   shows a toast on any failure** -- so a purely cosmetic thing not
   loading was interrupting the user exactly like a real action failing
   would. Added `quietEvalTS` (same file) for this one call site: same
   bridge call, but returns `null` on any failure instead of pushing a
   toast, indistinguishable from a territory whose name genuinely has no
   match in the lookup table. Also switched the per-territory loop from
   sequential (`for...await`) to `Promise.all`, since these are
   independent lookups and a real territory list makes the sequential
   version's cumulative latency actually noticeable. **If a future
   lookup is similarly decorative/non-actionable, use `quietEvalTS`, not
   `safeEvalTS`** -- reserve toast-on-failure for things the user
   directly asked for (New Campaign, Remove, Add Component, etc.).

## Testing without the real studio folders
No real Masters folder is assumed to be available, but a real local AE
install IS available for testing (confirmed working). Two ways to test,
in order of how much they actually verify:
1. **UI only, no AE needed**: `yarn dev`, open `http://localhost:3000/main/`
   in a regular browser. The CEP bridge doesn't exist outside a real AE
   host, so tools that call `evalTS` fall back to mock data / a clear
   "no bridge" message instead of crashing — see each tool's own
   fallback handling (OV Library's is the most developed, via
   `safeEvalTS()`/`MOCK_*` constants).
2. **Real AE, fake local data** (for OV Library specifically): run
   `node scripts/make-test-masters.cjs` (`.cjs` because this project's
   `package.json` sets `"type": "module"`) to generate a throwaway folder
   matching the naming convention above, then point "New Campaign" at it.

## OV Library visual polish pass (dynamic accents, motion, skeletons)
Four additions to `OVLibrary.tsx`/`OVLibrary.scss`, chosen deliberately for
things that reward *repeated real use* over hours, not just first
impressions -- this panel stays open all day (see Testing section), so
anything that's delightful once but naggy on the twentieth repeat was
ruled out (an always-on ambient background animation, for instance).

- **Dynamic per-thumbnail accent color.** `sampleDominantColor()` draws a
  loaded `<video>`'s current frame onto a tiny (24x14) offscreen canvas,
  averages the pixels, then lifts the result toward a punchier version of
  the same hue (a raw average of real footage reads as muddy/broken, not
  branded) and returns an `rgb(...)` string. Set once per `CreativeCard`/
  `VariantBlock` via `onLoadedData` (not on every hover) and applied as a
  `--card-accent` CSS custom property, which the SCSS uses for that card's
  border/glow/hover-shadow instead of the fixed `--ov-accent`/category
  color everything else uses. **Wrapped in try/catch and silently returns
  null on any failure** (falls back to the existing fixed accent) --
  canvas pixel reads can be blocked by cross-origin taint rules depending
  on exactly how CEP ends up serving the panel (dev server origin vs a
  packaged `file://` load), and this is a pure visual nicety that must
  never be allowed to break a card. **Can't be exercised in `yarn dev`
  browser preview against the mock dataset** -- `MOCK_RENDERS`' paths
  don't point to real files on disk, so the `<video>` never actually
  loads a frame and `onLoadedData` never fires; verify this one against
  real footage inside AE, or by pointing mock data at a real local video.
  **Confirmed via a real AE screenshot that `--card-accent` was NOT
  resolving** (card showed the fixed fallback blue, not an extracted
  color) -- consistent with the canvas-taint risk flagged above being a
  real, not just theoretical, failure mode in the packaged panel. Not
  yet root-caused further; if you pick this up, start by checking
  whether `ctx.getImageData()` actually throws in that environment
  (wrap `sampleDominantColor()`'s try/catch with a one-time
  `console.error` to find out) rather than assuming it's still just the
  mock-data-path limitation.
- **Creative grid hover-lift clipping.** `.creatives-grid` has
  `overflow-y: auto` (so a campaign with many creatives scrolls instead
  of pushing the variants list off-screen) with zero top padding --
  hovering a top-row card lifts it via `transform: translateY(-2px)`,
  and that scroll container's own clipping box sits flush against the
  cards' edges, so the lifted card's top edge (and everyone's
  box-shadow) gets clipped by the grid itself. Reads as "the card slides
  behind the Creatives heading above it," but it's a clipping issue, not
  a stacking/z-index one. **Fixed with `padding: 4px 4px 6px 2px` +
  matching negative `margin` on `.creatives-grid`** -- the padding gives
  the lift/shadow room to render without being clipped, and the equal
  negative margin cancels the padding's effect on the grid's own
  position/height so nothing shifts for anyone not hovering a card.
- **Hover-zoom on thumbnails.** A second, smaller `transform: scale()` on
  the `<video>` itself (not just the card's existing lift), scoped so
  hovering reads as "peeking into the shot" rather than only "the card
  moved." `.creative-card-play-hint` adds a play-triangle overlay that's
  always in the DOM but invisible until hover, confirming "this thumbnail
  plays" without a permanent icon cluttering every card at rest.
- **Skeleton/shimmer loading placeholders** (`SkeletonCard`/
  `SkeletonVariantBlock`, `.shimmer`/`.shimmer-bar` + `ov-shimmer-sweep`
  keyframe) replace the old spinner+"Scanning…" text row during
  `loadingCreatives`/`loadingVariants`, matching the real card/row layout
  so the grid's shape doesn't jump once real content replaces them.
- **Toast/status success micro-animation, now app-wide via `StatusIcon.tsx`.**
  Originally shipped as an inline `motion.span` in OVLibrary.tsx's toast
  rendering, with `rotate: -45deg` and `damping: 15` -- visibly too big a
  bounce for something that fires on every single completed action, all
  day. Pulled out into a shared `src/js/main/StatusIcon.tsx` component
  with calmer values (`scale` only, no rotate, `damping: 24`) and rolled
  out to **every tool file** that shares the app-wide `{ type: "success" |
  "error" }` status pattern -- that's 21 other files (`LocalisedLibrary.tsx`
  and `Toolset.tsx`'s toast stacks, plus 19 inline `tool-status`-banner
  tools from `CampaignLocaliser.tsx` to `Adjust.tsx`), not just OV
  Library. Error still renders as a plain `AlertCircle`, no animation --
  a failure shouldn't get the same celebratory motion as a success. The
  ring-pulse keyframe (`ov-success-ring`) and `.status-success-icon`
  class live in `shared.scss` (every tool already imports it), not
  per-tool, so there's nothing to duplicate when wiring up a new tool.
  **3 files were deliberately left alone**: `TimesheetTracker.tsx`,
  `DeliveryChecklist.tsx`, `UsefulFolders.tsx` only ever render an error
  banner, no success case, so there was nothing to swap.
- **Skeleton/shimmer loading placeholders**, also now shared
  (`.shimmer`/`.shimmer-bar` + `ov-shimmer-sweep` keyframe moved from
  `OVLibrary.scss` into `shared.scss`). OV Library's `SkeletonCard`/
  `SkeletonVariantBlock` and Localised Library's `SkeletonTerritoryRow`
  each compose these generic primitives into their own tool-specific
  layout -- the shimmer itself isn't duplicated, only the shape around it.
  Only applied where a tool has a genuine async list-scan (`loadingCreatives`/
  `loadingVariants` in OV Library, `loadingTerritories` in Localised
  Library) -- the simple one-click tools' `busy` boolean during a single
  action doesn't need a skeleton, that's a different UI problem (a
  button-level spinner), not addressed here.

**Dynamic per-thumbnail accent + hover-zoom stay OV-Library-only,
deliberately** -- they're both keyed off having real video content
(`sampleDominantColor()` needs a loaded `<video>` frame to sample), which
no other tool has. Don't force these onto a tool with no thumbnails just
for consistency's sake.

**If you add a new tool with this status pattern**, just render
`<StatusIcon type={status.type} />` -- don't reintroduce a local
`CheckCircle2`/`AlertCircle` ternary, that's exactly the copy-paste this
component replaced across 22 files.

## Drag-and-drop reorderable category tool lists
Each category screen's vertical tool list (the left column when you click
Localise/Review/Deliver/Tools) can be drag-reordered by the user, not just
by editing `TOOLS`' own array order in source. Deliberately scoped to
*only* these vertical lists -- Toolset's action grid is a wrapping grid,
not a single-axis list, and drag-and-drop reordering across a wrapping
grid (figuring out which row/gap the cursor is hovering between) is a
meaningfully harder UX problem than list reordering; not attempted here.

- **`aeft.ts`**: `loadAllToolOrders()` (one round-trip for all 4
  categories at once) / `saveToolOrder(categoryId, toolIds)`. Persisted
  via `app.settings`, same section/tab-separated-lines convention as
  everything else -- grouped near Useful Folders since both are general
  app-shell preferences, not tied to one specific tool's own data. No
  ScriptUI equivalent to stay compatible with (the original toolbox's
  tabs weren't reorderable), so this key is CEP-only.
- **`main.tsx`**: `Main` loads all 4 categories' saved orders once at
  mount (`toolOrder` state) -- silently no-ops on failure (no toast),
  same reasoning as `LocalisedLibrary.tsx`'s `quietEvalTS`: this is a
  background preference load, and the panel is fully usable with the
  default (`TOOLS` array) order either way.
- **A saved order is merged over `TOOLS`' own order, not a full
  replacement** -- any tool not present in the saved order (added to
  `TOOLS` after the user last reordered that category) is appended at
  the end rather than silently vanishing from the list. Always re-derive
  this merge from `TOOLS` fresh; never persist the full merged list back
  as if it were the saved order, or a removed/renamed tool id would
  linger forever.
- **Uses Framer Motion's `Reorder.Group`/`Reorder.Item` primitive**
  (already available -- `motion` is used throughout this app) via a
  dedicated `ToolListEntry` component, one per row, since
  `useDragControls()` needs a fresh hook instance per row to track which
  specific item is mid-drag. **`dragListener={false}` + a dedicated
  `GripVertical` handle, not a whole-row drag** -- deliberate: the row is
  ALSO the click target that navigates to the tool, and `Reorder.Item`'s
  default behavior listens for drag-start anywhere on the element, which
  fights with "just trying to click it" on a full-width row. The handle
  calls `dragControls.start(e)` on `onPointerDown`; the label/icon span
  keeps its own `onClick` for navigation, fully independent hit areas.
- **Verified via direct React-fiber invocation of the `onReorder`
  callback**, not a simulated drag gesture -- synthetic `PointerEvent`
  sequences reliably fail to trigger Framer Motion's gesture recognizer
  in this automated preview environment (a known limitation of testing
  pointer-based drag outside real browser input, not a product bug).
  Confirmed the full loop instead: invoke `onReorder` → state updates →
  UI re-renders in new order → order survives navigating away and back
  (`toolOrder` lives in `Main`, above the screen-keyed `AnimatePresence`,
  so it isn't affected by screen-level remounts) → newly-selected default
  tool correctly follows the new `orderedTools[0]`, not the original
  array's first entry.

## Custom Dialog.tsx replaces window.alert()/confirm()/prompt()
Every native dialog call across the app (16 call sites in `Toolset.tsx`,
`OVLibrary.tsx`, `LocalisedLibrary.tsx`, `UsefulFolders.tsx`) is now
`alertDialog()`/`confirmDialog()`/`promptDialog()` from `src/js/main/Dialog.tsx`
instead. **Reason, not just polish**: native dialogs always show the
calling page's own origin in their title bar -- for a CEP panel, that's
the literal `file:///Library/Application Support/Adobe/CEP/extensions/
com.xyi.ovlibrary/main/index.html` path, which reads as a broken/scary
error to anyone not expecting it. That's inherent browser/CEF chrome and
can't be styled or suppressed away; not using the native dialog at all
was the only fix.

Same call-and-await contract as the native versions (`await
confirmDialog(...)` returns `boolean`, `await promptDialog(...)` returns
`string | null`, `await alertDialog(...)` resolves once dismissed), so
converting a call site is almost always a 1:1 swap -- see the diff in any
of the four files above for the pattern. Implementation is a single
`<DialogHost />` mounted once at the app root (`main.tsx`'s `app-shell`,
alongside the logo easter egg), using the same singleton-via-module-scope
pattern as `Tooltip.tsx`'s `activeTooltip` -- only one dialog can ever be
open at a time, matching how the native versions behaved too.

**If you add a new tool that needs a confirm/prompt/alert, use these, not
`window.*`** -- reintroducing a native call brings back the file:// URL
problem for that one call site.

**Fourth dialog kind added: `selectDialog(message, options, defaultIndex?)`**
-- resolves to the chosen option's index, or `null` if cancelled. Same
call-and-await contract as the other three. Added for Toggle By Label
(needs the user to pick one of 17 label colors before running) rather than
repurposing `promptDialog`'s free-text input, which would let a typo
silently match nothing. Renders a plain `<select>` styled with the same
`.dialog-input` class the prompt's `<input>` already uses.

## Toggle By Label / Comp Duration -- new tools found outside the
## original 22-listbox-tab + Toolset survey
Two more one-click Toolset actions, ported from `ToggleByLabel.jsx` and
`XYi_CompDuration.jsx` -- found and handed over separately, not part of
either the original vertical-listbox survey or the Toolset grid's
original button set. Both are genuinely new (confirmed nothing like
either existed anywhere in `TOOLS`/`ACTIONS` before adding them). Neither
needed its own dedicated `tools/X.tsx` page -- both fit the existing
one-click-grid convention once their picker step is folded into the
button's own `run()`, using `selectDialog`/`promptDialog` the same way
Mask Separator already does for its own pre-run prompts.
- **Toggle By Label** (`toggleLayersByLabel(labelIndex)` in `aeft.ts`) --
  `selectDialog` picks one of the 17 label colors (0-16, same order AE's
  own Label Color preferences use), then toggles `enabled` on every layer
  in the active comp with that label. Active-comp-only, zero master-file
  risk.
- **Comp Duration…** (`setCompDuration(seconds)` in `aeft.ts`) -- ONE
  grid button, not five: `selectDialog` offers 10s/15s/20s/30s/"Custom…",
  and picking "Custom…" chains into a second `promptDialog` for the exact
  value (validated 0 < n &le; 10800). **Preserved one non-obvious business
  rule from the original exactly, not just the preset behavior**: a comp
  named with an unversioned/`_v0N` tag AND labelled red (label 1) silently
  gets +5 seconds added on top of whatever was requested -- a studio
  convention baked into the source script, easy to drop by accident while
  porting just the headline "set duration" feature.
- **Both `run()`s can now return `null`, not just `ActionResult`** --
  `ActionEntry.run`'s type changed from `() => Promise<ActionResult>` to
  `() => Promise<ActionResult | null>`, where `null` means "the user
  cancelled a picker dialog, nothing ran, show no toast." Distinct from
  both a real success/failure AND from `evalTSSafe`'s own `undefined`
  no-bridge sentinel. Both `ToolsetTool`'s and `CommandPalette.tsx`'s own
  `runAction()` handle it: the grid just does nothing (tile stays as-is,
  no toast); the palette drops back to its search list instead of closing
  the whole overlay. **If a future one-click action's `run()` needs a
  pre-run picker that can be cancelled, return `null` on cancel rather
  than inventing a fake error message for it** -- an "error" toast reading
  "Cancelled" for a deliberate user cancel is exactly the kind of noise
  this app's toast conventions elsewhere already try to avoid.

## CheckboxToggle.tsx -- native `<input type="checkbox">` swept out project-wide
The unstyled-native-checkbox problem first fixed for DeliveryHub's Audio
toggle (see the Droplet.tsx entry below for that one's own history) turned
out to be scattered across the whole app -- a project-wide grep for
`type="checkbox"` found 11 more live occurrences across 6 tool files
(CSVLocaliser, CampaignLocaliser x2, CheekyDT, EditGenerator x3,
GenerateCueSheet x3, OVLibrary's orientation filters x4). Rather than
re-apply the icon-toggle markup an 11th+ time, it's now a shared
component, `src/js/main/CheckboxToggle.tsx`/`.scss`, alongside
Tooltip.tsx/Dialog.tsx/Droplet.tsx as this app's other shared UI
primitives -- `<CheckboxToggle checked={} onChange={} label={} />`,
same call shape everywhere it's used.
- **`DeliveryChecklist.tsx`'s own checkbox was deliberately NOT converted**
  -- that file is the superseded, unregistered tool DeliveryHub replaced
  (see the Deliver category overhaul entry below); it's dead code, not
  reachable from the UI, so it wasn't worth touching.
- **Existing wrapper classes were preserved where they carried real
  layout** (`.radio-row`, `.loc-checkbox-row`, `.filter-row`) -- each of
  these previously had a nested `label { display:flex; gap:Npx; }` rule
  that no longer matches anything (the element is a `<button>` now, not a
  `<label>`), left as harmless dead CSS rather than hunted down and
  deleted across 6 files for a cosmetic difference of a couple of pixels
  of gap -- `CheckboxToggle`'s own default spacing already matches
  closely enough that nothing visibly changed.
- **Verification note**: confirmed via a clean `tsc`/`vite build` across
  all 8 touched files (0 errors) and a final project-wide re-grep for
  `type="checkbox"` (only the dead DeliveryChecklist.tsx file left). Full
  visual re-verification of every one of the 11 call sites hit an
  unusually persistent `AnimatePresence` rAF-stall in the browser-preview
  harness that session (see "Preview harness caveat" above) -- confidence
  here rests on the component already being visually proven correct for
  the nearly-identical DeliveryHub Audio toggle case, not a fresh
  screenshot of all 11.

## Droplet.tsx -- anchored popover, replaces the grid's own modal pickers
Toggle By Label and Comp Duration's `selectDialog()` modal (previous entry
above) felt heavy for a quick pick, per direct feedback -- replaced with
an inline dropdown that reveals right below the clicked button instead of
a centered full-panel modal. **Only the Toolset GRID's own rendering
changed** -- `ACTIONS`' `run()` functions (the `selectDialog`/
`promptDialog` flow) are UNTOUCHED and still there, still used by
`CommandPalette.tsx` when either action is found via search there. That's
a deliberate split, not an oversight: a droplet anchors to a specific
button's DOM position, which the palette's floating overlay doesn't have
a stable equivalent of (its result rows are about to disappear behind a
running/status view the moment one's selected) -- the modal fallback is
the right fit for that context, the droplet is the right fit for the grid.

- **`src/js/main/Droplet.tsx`/`.scss`** -- a new shared component, NOT
  Toolset-specific despite only being used there today (lives alongside
  Tooltip.tsx/Dialog.tsx as a third shared-overlay pattern). Positioning
  is deliberately adapted from **Tooltip.tsx's already-solved** portal +
  `position:fixed` + edge-clamping math (see that file's own header
  comment for the full clipping-bug history this pattern already fixed
  once) rather than reinvented -- portals to `document.body`, escapes any
  scrolling ancestor's overflow, flips above the trigger if there's not
  enough room below. Differs from Tooltip in exactly the ways a click-
  triggered, interactive panel needs to: no hover/mouseleave logic at
  all, closes on outside click / Escape / the content's own `close()`
  call, and content is an arbitrary render-prop (buttons, an input) not
  fixed text. Same singleton-via-module-scope pattern as Tooltip's
  `activeTooltip` (`activeDroplet` here) -- opening one force-closes any
  other, so two can never be open at once.
- **`ToggleByLabelDropletBody`** (`Toolset.tsx`) -- real color swatches
  (`LABEL_SWATCH_COLORS`, index-matched to `LABEL_COLORS`) instead of a
  text dropdown, per direct request. Approximated from AE's well-known
  default Label Color preferences -- **not queried from AE itself and not
  guaranteed to match a customized palette** (AE lets users change these
  in preferences; there's no single "true" value to fetch that would
  always be right anyway). "None" (index 0) renders a `Ban` icon instead
  of an empty circle so it still reads as a deliberate option. Picking a
  swatch closes the droplet immediately (optimistic) and reports through
  the SAME toast stack every other Toolset action already uses -- no new
  feedback mechanism invented for this one case.
- **`CompDurationDropletBody`** (`Toolset.tsx`) -- preset chips (10/15/20/
  30s) + a "Custom…" toggle that reveals an inline number field in place,
  chaining two dialogs into one droplet instead of two stacked modals.
  Needed its own real component (not inline logic in the `children`
  render-prop) specifically because it has its own local state (is the
  custom field showing, its value) -- calling hooks from a plain function
  invoked conditionally (only while the droplet is open) would violate
  the Rules of Hooks; a proper child component sidesteps that entirely.
- **`.swatch-none` class, not `:has(svg)`** -- the first version of the
  "None" swatch's distinct styling used `:has()`, which **is not
  supported on this project's chrome74 build target** (same class of
  gotcha as `color-mix()`, already documented above) -- would have looked
  fine in an ordinary browser preview and silently just not applied in
  the real packaged panel. Caught before shipping, not after; if a future
  style rule is tempted to reach for `:has()`, don't -- use a plain class
  instead, same as here.
- **Grid rendering special-cases exactly two action IDs**
  (`"toggle-by-label"`, `"comp-duration"`) to wrap them in `<Droplet>`
  instead of the plain click-runs-`run()` button every other `ACTIONS`
  entry uses -- see the `renderButton()` closure in `ToolsetTool`'s render
  loop, reused for both paths so the button's own look/animation/tooltip
  stays identical either way, only what `onClick` does (open a droplet vs.
  call `runAction`) and an `.active` class while a droplet is open differ.
  `reportResult()` was factored out of `runAction()` so both the plain
  path and the two droplet bodies' direct `evalTSSafe()` calls share the
  exact same toast-reporting logic (undefined -> no-bridge message,
  success/failure -> `successText()`/`error`) instead of it being
  duplicated three times.

## Deliver category overhaul: DeliveryHub replaces the master-detail list
Per direct request: the Deliver category used to be a normal master-detail
list (Delivery Checklist + Adjust, pick one on the left, its page on the
right) -- now it's ONE bespoke guided page, `tools/DeliveryHub.tsx`, id
`"delivery-hub"`. Intent: select the MOV(s)/comps to deliver -> click
Delivery (wraps them into properly-sized comps) -> adjust frame rate
inline if needed -> the same page's checklist calculates bitrate and
queues the render -- one page, top to bottom, not several menus to hop
between.

- **Deliver is the ONLY category that skips the master-detail screen.**
  `HomeScreen.tsx`'s category-card `onClick` special-cases
  `category.id === "deliver"` to navigate straight to `{type:"tool",
  toolId:"delivery-hub", backTo:{type:"home"}}` instead of `{type:
  "category", categoryId:"deliver"}` -- **`CategoryScreen.tsx` itself was
  NOT touched**, Localise/Review/Tools still work exactly as before. This
  was a deliberate, narrow, single-category special case, not a
  generalized "categories can have zero or one tool" mechanism -- don't
  extend this pattern to another category without it being asked for the
  same way.
- **`toolRegistry.tsx`**: `"delivery-checklist"` (standalone) is REMOVED,
  fully replaced by `"delivery-hub"` (`categories: ["deliver"]`, label
  "Deliver" so it reads sensibly in global search/Command Palette
  results). `"adjust"` is now `categories: ["tools"]` only (was `["tools",
  "deliver"]`) -- the Frame Rate field DeliveryHub embeds directly is a
  separate, minimal inline control calling the SAME `adjustFrameRate()`
  aeft.ts function Adjust's own page already used; Adjust's other fields
  (Width/Height/Duration/Aspect Ratio) were deliberately NOT pulled in,
  they stay Tools-only as asked.
- **`tools/DeliveryChecklist.tsx`/`.scss` are unregistered but NOT
  deleted** -- fully superseded (DeliveryHub's checklist section calls the
  exact same `deliveryChecklistLoadComps()`/`deliveryChecklistQueue()`
  backend), but left on disk rather than unilaterally deleted. Safe to
  delete outright once confirmed nobody wants the file kept for
  reference.
- **`deliveryChecklistQueue()` gained an optional per-row `maxMbps` cap**
  (`aeft.ts`) -- the bitrate-cap feature asked for alongside the redesign.
  `sizeMB` (target file size) and `maxMbps` (a hard ceiling, e.g. an ad
  network's "must stay under 30 Mbps") can conflict -- **the cap always
  wins**: if the bitrate required to hit the target size would exceed
  `maxMbps`, the capped value is used instead for template selection,
  which means the resulting file will likely land BELOW the requested
  target size. The queue log says so explicitly
  (`"*** Capped to N Mbps -- resulting file will likely be SMALLER..."`)
  rather than silently applying the cap with no explanation. Template
  selection itself is unchanged: `deliveryFindTemplateName()` still rounds
  DOWN to the nearest of a fixed, prebuilt bitrate list, matched to
  Output Module Template names via `deliveryFormatTemplateName()`
  ("H264_<N>MBPS_MOS").
  - **Re-curated to a bigger, evenly-spaced list, replacing the original
    15-value set**: `DELIVERY_TEMPLATE_BITRATES_MBPS = [0.6, 0.8, 1, 1.4,
    2, 2.8, 3, 4, 6, 8, 10, 12, ..., 60]` (0.6 up through 4 by hand-picked
    steps, then every 2 Mbps up to 60) — every one of these values needs
    a REAL, identically-named Output Module Template built by hand in AE
    first; adding a value here with no matching template just makes that
    row's `applyTemplate()` silently fall through to AE's defaults (see
    `appliedOK`/`mp4Note` handling below), and building a template in AE
    without adding its value here makes it invisible to this picker.
  - **The old 50 → "H264_50Mbps_MOS" lowercase-casing exception is GONE.**
    That inconsistency was tied to one specific pre-existing template
    name; the re-curated list's 50 is a fresh, consistently-uppercase
    `"H264_50MBPS_MOS"` template, confirmed explicitly with the studio
    rather than assumed. `deliveryFormatTemplateName()` no longer has a
    special case for any value — **if a future studio-provided template
    ever needs non-standard casing again, re-add a special case there,
    don't assume uppercase always holds.**
- **Confirmed, not assumed: After Effects' ExtendScript API cannot create
  or edit H.264 Output Module Templates programmatically.** There's no
  scripting path to define a new named template with an arbitrary bitrate
  baked in -- `OutputModule.applyTemplate(name)` can only apply a template
  that a human already built once via Edit > Templates > Output Module in
  the AE UI and saved under that exact name. This is exactly why
  `deliveryFindTemplateName()` works by matching against a fixed list
  instead of generating the precise bitrate needed -- confirmed by the
  fact the ORIGINAL ScriptUI tool this was ported from already worked this
  same way (round to the nearest of a small prebuilt set), which wouldn't
  make sense if arbitrary template creation were possible. **If the studio
  ever needs a bitrate this list doesn't cover, the fix is building one
  more Output Module Template by hand in AE and adding its value to
  `DELIVERY_TEMPLATE_BITRATES_MBPS`** -- there's no way to make this
  fully dynamic from the panel.

## Ambient background blobs on DeliveryHub AND the 3 remaining category
## screens (Localise/Review/Tools)
Same soft-corner-blob pattern now lives in two places, added at two
different points but sharing one design: a `position:absolute` blob layer
(`z-index:0`) behind the real content (promoted to `z-index:1` via a
wrapper -- positioned elements stack above non-positioned ones regardless
of z-index value, so this promotion is required, not optional, same
gotcha HomeScreen.tsx's own ambient blobs already had to account for),
breathing opacity + a hint of scale on a slow ~10s loop via Framer Motion,
respecting `useReducedMotion()`.
- **`DeliveryHub.tsx`/`.scss`**: `.dh-ambient-bg`/`.dh-ambient-blob`, fixed
  Deliver-orange color (`rgba(251,146,60,...)`), since this page only ever
  represents one category.
- **`CategoryScreen.tsx`** (shared by Localise/Review/Tools --
  `main.scss`'s `.category-ambient-bg`/`.category-ambient-blob`): the
  SAME per-category-tinted approach, but here the color has to vary by
  `categoryId` (this one component serves 3 different categories), so
  each blob gets an extra `category-ambient-blob--${categoryId}` modifier
  class. **Deliberately reuses the EXACT low-alpha rgba values
  HomeScreen.scss's own `.ambient-blob-localise`/`-review`/`-tools`
  already use** (not the sharper `--cat-glow` CSS variable, which is
  tuned for the home screen's category-card HOVER highlight at 0.35 alpha
  -- much too strong for a permanent background wash) -- a category's own
  page reads as a continuation of its home-screen identity, both places
  using the same tuned color, not two independently-invented tints.
  `ToolScreen.tsx` (search-result single-tool pages) does NOT get this --
  a tool can belong to more than one category, so there's no single
  "right" tint to give it; only `CategoryScreen.tsx` renders these
  elements, even though the shared `.drill-screen` class (and its new
  `position: relative`) is technically also present on `ToolScreen.tsx` --
  harmless there since it never renders the blob markup itself.
- **Verifying this in the browser preview harness**: confirmed via direct
  React-state inspection (not just DOM) that navigating between
  categories dispatches correctly even when the documented
  `AnimatePresence` rAF-stall (see "Preview harness caveat" above) blocks
  the DOM from visually catching up in this automated tab -- same
  non-bug, don't re-flag it in a future session.

## Turk It / Un-Turk It now also syncs the Frontcard version text
Ported from `XYi_TurkIt_V02.jsx`, an updated version of the already-real
`turkIt()` handed over separately (not from the original survey). The
original tool only ever renamed the comp's own `_VNN` tag; this version
found a Frontcard precomp in the same comp (a layer whose name contains
"Frontcard") and additionally set its own layer 14's Source Text to match
the new version string (e.g. "V02") -- so a Frontcard-based project's
visible version text no longer silently falls out of step with the comp's
real tag until someone updates it by hand. **Applies to BOTH directions**
-- confirmed with the user (their V02 source file has identical sync
logic in both the increment and decrement button handlers) rather than
assuming only Turk It needed it. Same hardcoded layer-14 index and silent
try/catch as the source script -- a locked or missing layer 14 skips that
one comp's Frontcard sync without aborting the whole batch rename.
**Untestable in browser preview** -- needs a real Frontcard-based project
open in real AE to verify; same class of ExtendScript-only bug risk as
everything else in this file that can't be exercised outside a real host.

## LOS Tools / JPGLoc: copy-first is now conditional on an isolated "OV"
## filename token, not unconditional
Both tools batch-process every `.aep` in a chosen folder, replacing
footage/component sources. Both used to copy-first unconditionally
(`losSafeOpenMasterCopy()`) regardless of what kind of file was actually
found. **Changed at the user's explicit direction, with a concrete rule
they specified themselves** (not inferred): their real workflow runs
these against a folder of files already renamed for one territory (e.g.
"..._FR_...") -- once a file's name has dropped the "_OV" master suffix,
it's their own working copy at that point, and they want it edited and
saved in place like MC It! already does, not silently forked into a new
`_VNN` copy.

- **`hasIsolatedOvToken(name)`** (`aeft.ts`, next to `losSafeOpenMasterCopy`)
  -- regex `/(^|[_\s])OV([_\s.]|$)/i`, matches "OV" only as its own
  token (start-of-string or `_`/space before it, `_`/space/`.`/end-of-
  string after it). Matches the established Masters suffix convention
  documented above ("...`_10sec_OV.aep`"). Deliberately NOT a plain
  substring check -- "MOVE", "COVER", "APPROVED" etc. must not trip it.
- **`losOpenForEdit(file)`** -- the new decision point both tools now call
  instead of `losSafeOpenMasterCopy()` directly: copy-first (unchanged
  existing behavior) if the file's name still carries the OV token,
  otherwise `app.open(file)` directly so the caller's own `.save()`
  writes back to that same file. **This is a per-FILE check, not a
  per-folder trust decision** -- a stray un-localised master sitting in an
  otherwise-safe batch folder by mistake still gets caught and goes
  copy-first, exactly as before.
- **`losApplyCsvToProjects` (LOS Tools)**: single call-site swap
  (`losSafeOpenMasterCopy(projFile)` -> `losOpenForEdit(projFile)`); the
  existing `proj.save(); proj.close(CloseOptions.SAVE_CHANGES);` at the
  end already works correctly either way, since `proj` is just whichever
  project is now active regardless of which path opened it.
- **`jpegLoc` (JPGLoc)**: same swap, plus two things that had to change
  because the original assumed every file was always a copy: (1) it used
  to call `losSafeOpenMasterCopy()` without even capturing the returned
  `Project`, checking the `app.project` global instead -- now captures
  `losOpenForEdit()`'s return value directly, since a `null` open failure
  needs to be caught regardless of which path was taken; (2) the closing
  `alert()` used to unconditionally claim "written to a new copy" for
  every file, which would now be actively wrong for in-place replacements
  -- it now tracks `copiedCount`/`replacedInPlaceCount` and reports both
  numbers accurately.
- **Deliberately NOT touched**: `extAdjustCsvApplyToProjects` (Extreme
  Tools 02's "Adjust From CSV") is a THIRD caller of
  `losSafeOpenMasterCopy()` that reuses the same helper but is a
  genuinely separate tool the user didn't ask about -- left on pure
  copy-first. Apply the same `losOpenForEdit()` swap there too if this
  ever comes up for that tool specifically; don't assume the same
  exception silently applies without asking, same rule this file already
  states for every other master-file exception.

## Global quick-open (CommandPalette.tsx) -- Ctrl/Cmd+K, any screen
Added as an open-ended improvement while iterating solo, not from a
specific user request -- flagging that here since everything else in this
file traces back to an explicit ask. Fills a real, confirmed gap rather
than a speculative one: `HomeScreen.tsx` already had its own search box,
but it only existed on the home screen, only searched `TOOLS` (dedicated
tool pages), and had no idea `tools/Toolset.tsx`'s ~19 one-click grid
buttons (Turk It, Frontcard, etc.) existed at all -- there was previously
no way to search for those from anywhere, home included.

- **`src/js/main/CommandPalette.tsx`/`.scss`** -- mounted once in
  `main.tsx` (`<CommandPalette screen={screen} onNavigate={setScreen} />`,
  alongside `<DialogHost />`), so it's a sibling of every screen rather
  than owned by one. A small always-visible "⌘K" pill, fixed bottom-right
  (`z-index: 900`), is the discoverable entry point; `Ctrl/Cmd+K` is a
  second, module-independent global `keydown` listener (mounted
  unconditionally, not just while the palette is open) so the shortcut
  works regardless of which screen is showing -- the same pattern
  `HomeScreen.tsx`'s own `Cmd/Ctrl+F`/`/` search-focus shortcut already
  used, generalized from one screen to the whole app.
- **Search set**: every `TOOLS` entry (+ its `actions` labels, same data
  `HomeScreen.tsx`'s search already reads) UNION every `Toolset.tsx`
  `ACTIONS` entry (label + description). `ACTIONS`/`ActionEntry`/
  `ActionResult` are now exported from `Toolset.tsx` specifically so this
  file can search and run them -- each entry's `run()` was already fully
  self-contained (no dependency on `ToolsetTool`'s own component state),
  so nothing in `Toolset.tsx` needed to change beyond adding `export`.
- **Ranking, empty query, and selection**:
  - Empty query shows favorites (`useFavorites(TOOLS)`, same hook/data
    `HomeScreen.tsx`'s star icon already populates) instead of nothing or
    an unranked dump of all ~44 entries.
  - Non-empty query ranks: whole-tool label match → Toolset action label
    match → tool inner-action match (e.g. "Trott 2.0") → Toolset action
    matched only via its *description* text. That last tier exists
    deliberately (so searching by what a button does, not just its name,
    still works) but is ranked last on purpose -- an early version put it
    level with label matches, which put e.g. "Scale Fit" above "Cheeky T
    Check" for the query "check" (matched via Scale Fit's description
    mentioning "checkbox effect") with no visible reason why it was there.
  - Selecting a `TOOLS` hit navigates via `onNavigate({..., backTo:
    screen, autoAction})` -- `backTo` is the LIVE current screen (prop
    threaded from `main.tsx`), not hardcoded to home like
    `HomeScreen.tsx`'s own search (`backTo: {type:"home"}`) gets to do
    since it only ever runs from home. This is the one real generalization
    of the existing `Screen`/`autoAction`/`backTo` mechanism this feature
    needed -- everything else reuses it as-is.
  - Selecting a Toolset `ACTIONS` hit does NOT navigate -- it runs
    in place (no tool page needed for a one-click action) and shows an
    inline running/result state inside the palette card itself, then
    auto-closes after ~1.6s. Deliberately not routed through a new
    app-wide toast system -- `ToolsetTool` already has its own local toast
    stack for the grid itself, and duplicating that plumbing for one
    feature wasn't worth it.
- **Re-entrancy guard, found via testing, not speculative**: the first
  version gated a running action only on the `running` React state.
  Testing surfaced a real double-invocation -- one Enter press produced
  two `evalTS("turkIt","up")` calls (confirmed by a duplicated console log
  at the identical timestamp) -- most likely from a Vite HMR module swap
  transiently leaving two mounted listeners during iteration, not
  something that can happen in the shipped production build. Fixed
  properly rather than dismissed as a dev-only artifact anyway, since
  `running` (state) updates are async/batched and can't reliably prevent
  a second call arriving before the first one's `setRunning` flushes: a
  synchronous `runningRef = useRef(false)` guard now gates `runAction`
  instead, closing the race regardless of what causes two calls to land
  close together. Re-verified clean (exactly one log per Enter press) on
  a fresh tab load after the fix.
- **z-index**: overlay sits at `1900` -- above toasts/video-player (`1000`)
  but below `Dialog.tsx`'s `2000` on purpose. Running an action from here
  can pop a REAL confirm/prompt dialog on top of the palette (Mask
  Separator does exactly this), which should always win rather than being
  trapped behind the palette overlay.
- **Verifying this in the browser preview harness**: screen-transition
  results (does `backTo` really point at the right screen after
  navigating away and hitting Back) hit the same `AnimatePresence`
  rAF-throttling stall already documented above under "Preview harness
  caveat" -- confirmed the underlying `screen` React state updates
  correctly via direct fiber inspection when the DOM wouldn't visibly
  progress. Same for the backdrop-click-to-close path: `open` correctly
  flips to `false` in state; the overlay `<div>` lingering in the DOM
  after that is the animation's exit transition stalling in the automated
  tab, not the close handler failing. Don't mistake either symptom for a
  real bug in a future session -- check the React state directly (or just
  trust a real foregrounded browser/AE) before assuming broken code.

## Custom creative thumbnails (OV Library)
A creative's card preview normally comes from `scanRendersForCreative()`'s
"first render found" heuristic -- a directory scan has no way to know
which render is actually the most representative one, and GUTTERS/HELMET-
style creatives with zero matched renders get no preview at all. Users can
now override this per creative, persisted per campaign (so two campaigns
that happen to share a creative name, e.g. "HORSE", never leak each
other's override):

- **`aeft.ts`**: `loadThumbOverrides(campaign)`, `selectCreativeThumbnail()`
  (native file picker, not a typed-in path -- avoids typo'd/invalid paths
  entirely), `setCreativeThumbnailOverride(campaign, creative, path)`,
  `clearCreativeThumbnailOverride(campaign, creative)`. Persisted via
  `app.settings`, same `SETTINGS_SECTION`/tab-separated-lines convention
  as campaigns and Localised Library's components.
- **`OVLibrary.tsx`**: `CreativeCard` shows a small override icon
  (`ImagePlus`) top-right of the thumbnail, but only after **a deliberate
  1s hover hold** (its own `showOverride` state + `setTimeout`, separate
  from the existing video-preview hover) -- not instantly on hover, for
  the same reason Toolset's tooltips got a delay: it shouldn't pop up on
  every card the cursor sweeps past while just scanning the grid. Click
  opens the file picker; right-click resets to the auto-detected preview
  if an override is active (`.active` class gives the icon a filled/tinted
  look as the "there's an override here, and right-click does something"
  signal). `thumbOverrides[name] || creativePreviews[name]` is the actual
  merge -- override always wins when present.
- Both the click and context-menu handlers call `e.stopPropagation()` --
  without it, clicking the icon would also fire the card's own `onClick`
  (which selects the creative), since the icon sits inside the card.

## Home screen: hover-only version tag + one-shot ambient background
Two more additions, both scoped to the home screen only (`main.tsx`/`main.scss`).

- **"Toolbox {version}" only shows on logo hover**, not as a permanent
  line under the logo. `.version` is `position: absolute; opacity: 0`
  (out of flow, so it never reserves vertical space while hidden) and
  revealed via `.logo:hover ~ .version` -- a sibling combinator, not a
  `.home-header:hover` rule, since hovering the glow blob or the empty
  margin around the logo shouldn't also trigger it. **It was originally
  positioned directly below the logo (`top: 100%`), but that put it right
  where `.home-search` starts -- close enough that the two visually
  collided the moment it faded in.** Moved to the logo's right instead
  (`top: 50%` + `translateY(-50%)` for vertical centering, `margin-left:
  54px` = half the logo's own max-width + an 8px gap), which stays clear
  of the search box in any panel width. If you ever need to reposition
  this again, re-check against `.home-search` specifically, not just
  "does it look fine at rest" -- the collision only shows up once it's
  actually visible.
- **One-shot ambient background** (`.home-ambient-bg`, four
  `.ambient-blob`s tinted with the same four hues as `CATEGORY_COLORS`).
  Fades/scales in once on mount (staggered ~150ms per blob) and then
  holds still -- deliberately NOT a looping/continuous animation. This
  panel stays open for hours (see Testing section) -- something always in
  motion behind content people are staring at all day either fades into
  background noise (wasted) or becomes actively annoying (worse than
  wasted), with little middle ground. A single reveal gets the "not just
  flat gray" richness without that cost. **Keep it this way if extending
  this pattern elsewhere** -- don't add `repeat: Infinity` to make it
  "more alive" without discussing the always-on tradeoff first.
  - **Positioned `position: fixed`, not `position: absolute`**, so it
    stays pinned to the panel itself rather than scrolling away with
    `.home-screen`'s content (which has its own `overflow-y: auto`).
  - **`.home-content` (wrapping everything except the ambient layer)
    needs its own `position: relative; z-index: 1`.** This isn't
    optional/cosmetic -- CSS's stacking order paints *positioned*
    elements above *non-positioned* ones regardless of DOM order or a
    `z-index: 0`/`auto` value, so without this, the fixed ambient
    background (a positioned element) would render on TOP of the
    header/search/toolset/category-row (plain static-flow content)
    even though it comes first in the markup. If a future change makes
    the ambient background start covering real content, check this
    z-index/position pairing first before assuming it's a DOM-order bug.
  - Colors are hand-kept in sync with `CATEGORY_COLORS` in `main.tsx` --
    there's no shared source of truth between that TS table and this
    SCSS. Update both if a category's color ever changes.
  - **Settle-in motion + softer feathering, tuned after the first pass
    looked flat.** Each blob starts offset 80px further into its own
    corner (`x`/`y` in the `initial` prop -- bumped up from an initial
    36px, which read as too subtle to register as intentional movement)
    and springs inward to rest (`type: "spring", stiffness: 45, damping:
    12` on `x`/`y`/`scale` -- NOT a duration/easeOut tween, a spring's
    natural deceleration is what sells "arriving into place" rather than
    just fading up).
  - **Opacity is a separate 3-keyframe tween, not tied to the same
    spring as position.** `animate={{ opacity: [0, 1, 0.55], ... }}`
    with its own `transition.opacity = { duration: 1.8, times: [0, 0.4, 1],
    ease: "easeInOut" }`, overridden independently from the `x`/`y`/`scale`
    spring -- Framer Motion allows a different transition config per
    animated property within one `transition` object, which is what makes
    "peak bright while arriving, then dim to rest" possible without also
    changing how the position settles. Peaking at full opacity first is
    what makes the arrival itself clearly visible; resting dimmer than
    that peak (0.55, not 1) is what keeps the panel from staying
    permanently as bright as the arrival moment once it's done moving --
    a static "always at full strength" background under an always-visible
    home screen row started to feel too present after living with it.
    **Verified via manual timed sampling** (re-navigate home, poll
    `getComputedStyle` every 200ms for several seconds): position settles
    to `transform: none` by ~1.2s, opacity peaks near 1 around the same
    time, then decays smoothly to exactly 0.55 by ~2s and holds there with
    zero further change through at least 2.4s -- confirms it's genuinely
    one-shot, not an accidental loop. If retuning either curve, re-verify
    with the same sampling approach rather than eyeballing a screenshot --
    a screenshot only ever catches one frame, and the whole point of this
    animation is how it changes over ~2 seconds.
  - The gradient itself went from 2 stops (`color → transparent`) to 3
    (`color → color at ~45% alpha → transparent`) with the blob's own
    blur raised from 70px to 110px and size from 340px to 420px -- a
    2-stop radial gradient still reads as a soft-edged *disc* once
    blurred, since the alpha ramp between the two stops is fairly steep;
    the extra mid-stop plus a wider blur spreads that ramp out until
    there's no perceptible edge left, just a wash. If this ever looks
    "disc-y" again after a color/size tweak, check the gradient stop
    count and blur radius before assuming it's a positioning issue.
  - **Localise's peak alpha is deliberately the lowest of the four**
    (`0.1`/`0.045`, versus review/deliver/tools' `0.16`/`0.15`/`0.16`
    range), found by testing a real docked-in-AE screenshot rather than
    the browser-preview window alone -- at matching alphas, the top-left
    (teal) corner visibly dominated the other three. Two effects compound
    in the same direction there: teal/cyan reads as perceptibly brighter
    than purple/orange/pink at equal alpha against a dark background
    (true regardless of this app), and localise's corner is also closest
    to the panel's own title bar/logo/search -- the first place the eye
    lands. **If any category's blob ever looks visually louder than the
    other three again, don't assume it's a positioning bug -- check
    whether it's simply a brighter hue at the same alpha as its siblings
    first**, especially for anything in the teal/cyan/green range.

## Tool-page polish (submenu UI/UX pass)
The shell (home screen, category cards) had a full Framer Motion polish
pass early on; the individual tool pages didn't, and started to feel like
a different, plainer app once you clicked into one. Fixed with three
changes, all additive to the existing `formTool.scss` pattern rather than
a rewrite:
- **Category-color inheritance into tool pages.** `main.tsx` sets
  `categoryStyleVars(categoryId)` (the same function that colors the home
  screen's category cards) as an inline style on `.category-tool-content`
  (category drill-down) and `.drill-body` (the standalone tool screen
  reached from search, using the tool's own `categories[0]`). Because
  `--cat-grad`/`--cat-border`/`--cat-glow`/`--cat-icon` are real CSS
  custom properties, they cascade down through normal inheritance to
  every tool component mounted inside — a tool never needs to know its
  own category color, it just references `var(--cat-border, ...)` with a
  generic `--ov-accent` fallback for contexts with no category (there
  aren't any left, but keep the fallback).
- **CSS-only hover/focus polish, not Framer Motion.** `formTool.scss`'s
  `button:hover` now does `transform: translateY(-1px)` + a category-
  tinted `box-shadow`/`border-color`, and its icon `<svg>` gets a
  `ov-icon-wiggle` keyframe animation (defined once in `shared.scss`,
  NOT duplicated per-file — every tool imports `shared.scss` already, so
  the keyframe is always present in the bundled CSS). Inputs get a
  category-tinted focus ring. Deliberately CSS, not `motion.button`,
  matching the shell's own category-card pattern (CSS handles color/
  shadow, Framer Motion is reserved for actual layout-affecting
  animation) — this got every tool page the same treatment without
  converting ~20 files to Framer components.
  - The four tool pages that predate `formTool.scss` and have their own
    bespoke stylesheets (`OVLibrary.scss`, `LocalisedLibrary.scss`,
    `CampaignLocaliser.scss`, `RandomLayers.scss`) got the identical
    rules copied into their own `button`/`input` selectors by hand —
    they don't import `formTool.scss`, so this couldn't be done in one
    place for those four.
  - **Dense per-row list buttons (OV Library's render rows, Localised
    Library's component rows) deliberately do NOT get the lift/wiggle**
    — only the color/border/glow tint. A hover animation firing
    repeatedly while scanning down a scrolling list reads as busy, not
    polished. Toast-dismiss (X) buttons are untouched entirely (meant to
    stay minimal). If you add a new dense list, follow this split rather
    than applying the full treatment everywhere by default.
- **2-column `.field-grid` layout** (`formTool.scss`) for pages with many
  stacked fields that were wasting the panel's ~550px of content width
  in a single column (Extreme Tools 01 was the worst offender — 7 fields
  × 2 sections required scrolling past the fold). Applied to Extreme
  Tools 01/02 and Wall Tools' multi-field sections. Plain `@media
  (max-width: 420px)` fallback to one column — **deliberately not a
  `@container` query**, which isn't supported on this project's
  `chrome74` build target (caught before shipping, same class of mistake
  as the earlier `color-mix()` incident — check any "modern-sounding"
  CSS feature against chrome74 support before using it here).

## Searchable tool actions (`ToolEntry.actions`)
The home screen's search only ever matched a `TOOLS` entry's own `label`
(e.g. searching "Campaign" finds "Campaign Localiser"), which meant a
button buried inside a tool's page — "Trott 2.0" inside Campaign
Localiser, "Master Null" inside Master of Nulls — was invisible to search
unless you already knew which tool it lived under and clicked in. Fixed
by adding an optional `actions?: string[]` field to `ToolEntry`, listing
the labels of that tool's own inner buttons; `main.tsx`'s search now
`flatMap`s over `TOOLS` producing one `SearchHit` per match — either
`{tool}` (name matched) or `{tool, matchedAction}` (an inner action
matched). Action hits render as a two-line card (`renderToolCard()`'s
`matchedAction` param, `.tool-card-text`/`small` in `main.scss`): the
action label in bold, "in `<Tool Name>`" as a muted caption below.
Clicking either kind navigates to the tool's own page — there's no
deep-link to the specific button itself (that would mean each tool
component exposing an imperative "scroll to and highlight this action"
API, which felt like real added machinery for what's fundamentally a
discovery problem, not a navigation one; the user lands on the right
page and the button they searched for is right there).

**When you port/add a new tool, populate `actions` with every real
button's exact visible label** (skip decorative/reset-only buttons if
they're not worth surfacing, but the primary ones should all be there —
see the existing entries in `main.tsx`'s `TOOLS` array for the pattern).
Deliberately did NOT extend this to `Toolset.tsx`'s one-click grid
(Turk It, Organise Folders, etc.) — those are already all visible on the
home screen with no drill-down required, so they're not a "buried inside
a submenu" discovery problem the way tool-page buttons are.

## Tooltip clipping fix (portal-based, not absolute-positioned)
`Tooltip.tsx`/`Tooltip.scss` were rewritten after a real bug: the bubble
was `position: absolute` nested under its trigger, so even though
`updatePlacement()`'s math correctly measured against the panel viewport
(`window.innerHeight`/`innerWidth`), the RENDERED bubble was still a DOM
descendant of whatever scrolling container the trigger sat inside (every
`.form-tool` page has `overflow-y: auto`; OV Library's render list is its
own scroll region) — CSS `position: absolute` is contained by the
nearest scrolling/overflow ancestor regardless of what the JS-computed
top/left values say, so the top portion of the bubble got visually
clipped off by that ancestor's own edge. Looked like "the tooltip breaks
halfway through."

**Fix**: the bubble is now rendered via `createPortal(..., document.body)`
with `position: fixed` and explicit pixel `top`/`left` computed from
`getBoundingClientRect()` in `updatePosition()` — a portal escapes every
ancestor's overflow AND stacking context, so the only boundary that can
ever clip it is the panel's own edges, which the existing edge-clamping
logic already accounts for. Side effect worth knowing: since the bubble
is no longer a DOM descendant of `.ov-tooltip-wrapper` once portaled,
`.ov-tooltip-wrapper:hover .ov-tooltip-bubble` (the original's CSS-only
show/hide) can never match — visibility is now driven by React state
(`visible`, set from `onMouseEnter`/`onMouseLeave`/`onFocus`/`onBlur`)
and an `.ov-tooltip-ready` class instead of `:hover`. **If you ever touch
Tooltip.tsx again: don't revert to `position: absolute` under the
wrapper** — that's exactly what caused the clipping bug in the first
place, not an incidental implementation detail.

**Second, separate bug found after the portal fix**: the portal fix alone
wasn't enough — in OV Library specifically, the tooltip still looked
"broken," but for a completely different reason. `OVLibrary.scss`'s
`.action-row span { flex: 1; color: #bbb; }` (meant to push the label
text left and the icon buttons right in each master/render row) is a
descendant selector, so it also matches `.ov-tooltip-wrapper` itself
(`Tooltip.tsx` renders its outer element as a `<span>`). That stretched
the wrapper to the row's *full* width (~900px in one repro), and
`updatePosition()` correctly centers the bubble on the wrapper it
measures — so the arrow ended up pointing at the center of the whole row
instead of the actual short "Master (.aep)"/"Render" label text, which
sits left-aligned inside that stretched box. Visually this reads as the
tooltip appearing disconnected from what's under the cursor.

**Fix**: `Tooltip.tsx` now wraps `children` in an inner
`<span ref={contentRef} className="ov-tooltip-content">`, and
`updatePosition()` measures that inner span instead of the outer
`.ov-tooltip-wrapper`. `Tooltip.scss` forces `.ov-tooltip-content` to hug
its own content with `flex: 0 0 auto !important` — `!important` is
deliberate, not laziness: `Tooltip.tsx` is a shared component with no way
to know how deeply a caller's own generic `span { flex: 1 }`-style rule
is nested (OVLibrary's is several classes deep under `.ov-library`, more
specific than any plain two-class selector here could match without it).
**If a tooltip ever again looks positioned somewhere unrelated to its
trigger, check whether an ancestor's CSS is stretching
`.ov-tooltip-wrapper` itself before assuming it's a placement-math bug**
— these two bugs looked identical from a screenshot but had unrelated
causes and unrelated fixes.

**Third, separate tooltip issue**: long unbroken strings (file paths --
this component's most common use -- have no spaces) don't wrap under
plain `white-space: normal`, which only breaks at spaces; past
`max-width` the text just overflows straight past the bubble's border
instead of wrapping. Fixed with `overflow-wrap: anywhere` in
`Tooltip.scss`, which breaks mid-token as a last resort.

**Optional hover delay**: `Tooltip` now takes an optional `delay?: number`
(ms) prop, default `0` (instant, unchanged for most callers e.g. OV
Library's path tooltips). `Toolset.tsx` passes `delay={1500}` for its
always-visible action grid specifically -- sweeping the cursor across a
dense grid of one-click buttons while just scanning it used to pop a
tooltip under the cursor for every button passed over, which read as
spammy rather than helpful; holding on one button for 1.5s is a
deliberate choice, not incidental. The timeout is cleared on
`mouseLeave`/`blur` (moving to a different trigger doesn't carry over a
pending timer) and on unmount.

**Stuck-tooltip bugfix**: bubbles could pile up and never disappear,
because native `mouseenter`/`mouseleave` aren't fully reliable inside a
CEP/Chromium panel -- fast pointer movement, or the cursor leaving
straight off the panel window's own edge instead of crossing back over
another DOM element, can skip firing `mouseleave` entirely, and once that
happens there's no event left to ever close that bubble. Fixed with two
independent safety nets in `Tooltip.tsx`, since either one alone only
covers half the failure mode:
1. **A module-level `activeTooltip` singleton.** At most one tooltip may
   ever be visible at once -- showing any tooltip force-hides whichever
   one was previously active, regardless of whether that one's own
   `mouseleave` ever fired. This is what stops bubbles from *piling up*
   when sweeping across several triggers. Keyed by a stable per-instance
   `idRef` (a plain object from `useRef({})`), not a function reference --
   a closure captured on one render won't still `===` itself after a
   later re-render, which a naive version of this fix would silently
   break.
2. **A `document`-level `mousemove` listener, attached only while that
   instance is visible**, independently re-checks whether the cursor is
   still actually over the trigger's own `getBoundingClientRect()` and
   force-hides if not. This is what catches the single-tooltip case the
   singleton above can't: the *last* tooltip shown, when the cursor exits
   straight off the panel with no other tooltip left to show and force it
   closed.
Both are cheap (one listener only while something's visible; the
singleton is an O(1) pointer swap) and neither depends on figuring out
*why* a given `mouseleave` was missed -- they self-correct regardless of
cause, which matters here since the root cause is a platform-level event
reliability quirk, not something fixable in this component's own logic.

## Search hits auto-fire their matched action
Clicking a search result that matched via `ToolEntry.actions` (not the
tool's own name — e.g. searching "Trott" and clicking the "Trott 2.0 in
Campaign Localiser" card) now does more than navigate: it also clicks the
real button on that tool's page, so the result actually performs the
action rather than just landing near it. `Screen`'s `"tool"` variant
carries an optional `autoAction?: string` (the matched button's exact
label), set only by a search-hit card's `onClick` in `renderToolCard()` —
regular navigation (category list, back/forward) always omits it.

A `useEffect` keyed on the `screen` object watches for that label to
appear as a `<button>` inside `.drill-body` and clicks it once found,
via a `MutationObserver` on `document.body` (5s timeout) rather than a
fixed delay — needed for two reasons, both non-obvious: (1) some tools
(Campaign Localiser, others) load mock/real data asynchronously before
their action buttons exist at all, and (2) the screen swap is wrapped in
`AnimatePresence mode="wait"`, which can delay mounting the new screen's
DOM until the outgoing screen's exit animation finishes — well after this
effect's own commit — so a ref to `.drill-body` captured at effect-run
time is frequently still `null` even though `screen.type` has already
become `"tool"`. Querying `document.querySelector(".drill-body")` fresh
inside the observer callback (not a ref) is what makes this reliable.
A `handledAutoActionRef` (compares the `screen` object by *reference*,
not by value) guards against re-firing on incidental re-renders of the
same tool screen — `setScreen` always creates a fresh object, so even
clicking the same search hit twice still fires twice, as expected.

## Style / conventions
- ExtendScript: ES6 syntax (compiled down to ES3 by the build),
  function-based, no classes, defensive (`{success, error}` return shapes
  rather than throwing across the bridge).
- React: functional components + hooks only, no class components. One
  component + one stylesheet per tool, registered in `main.tsx`'s `TOOLS`
  array — see Architecture above.
- Every scan is read-only. Nothing in `aeft.ts` should ever call
  `app.open()` on a master, or `app.project.save()` on anything without an
  explicit, pre-validated, different-from-source output path (copy-first
  if a tool genuinely needs to edit a master's copy).
- **Tailwind v3** is available (`tailwind.config.js`, `postcss.config.js`
  — both written as ESM `export default` since this project's
  `package.json` sets `"type": "module"`, same gotcha as
  `scripts/make-test-masters.cjs`). Deliberately **v3, not v4** — this
  project's `vite.config.ts` targets `chrome74` for CEF compatibility
  across older AE installs, and v4 leans on newer CSS (cascade layers,
  `color-mix()`, `@property`) that old engine doesn't support.
  **Preflight (`@tailwind base`) is deliberately OFF** (see
  `tailwind.config.js`'s comment) — only `@tailwind utilities` is
  imported (`src/js/main/tailwind.css`, pulled in once by
  `index-react.tsx`), so existing tools' hand-written SCSS keeps working
  unmodified. Use Tailwind utility classNames (`mx-auto`, `text-center`,
  `justify-center`, etc.) freely alongside a tool's own SCSS classes on
  the same elements — that's the intended pattern, not an either/or.
- **`motion` (Framer Motion, published under the new package name
  `motion` — import from `"motion/react"`, not `"framer-motion"`) is
  available** for animation — used for the shell's screen transitions,
  category-card entrance/hover, the sliding tool-list highlight
  (`layoutId`), and icon micro-interactions (see `main.tsx`). Shell was
  redesigned as "modern dark premium + playful icon micro-interactions"
  per explicit direction — animated icons/hover wiggle are intentional,
  not accidental flourish; don't strip them out as "unnecessary" without
  checking here first.
  - **The `chrome74` build target rule applies to CSS animations too,
    not just Tailwind** — avoid modern CSS the old CEF engine doesn't
    support. Hit this directly: an early pass used `color-mix()` for a
    category-card hover gradient and had to be reverted to a plain solid
    color. Check any new CSS feature against chrome74 support before
    using it, the same way Tailwind v4 was ruled out.
  - **Known fragility, worked around**: a `staggerChildren` parent
    variant + child `variants` entrance animation (for the 4 category
    cards) got stuck with only the FIRST child ever animating in — the
    rest stayed at `opacity: 0` permanently. Root cause not fully
    isolated (suspected interaction between nested variant propagation
    and the outer `AnimatePresence` wrapping every screen), but the fix
    was to stop relying on parent-child stagger variant propagation
    entirely: each category card now animates independently with its
    own `initial`/`animate`/`transition` and a manually computed `delay:
    index * 0.06` instead of a shared `staggerChildren` parent. **Prefer
    this per-item-explicit-delay pattern over nested stagger variants
    for any new list/grid entrance animation in this codebase** — it's
    more verbose but doesn't have this failure mode. `whileHover`/
    `whileTap` propagation to a child's own `variants` (used for the
    icon-wiggle effect) did NOT show this problem and is fine to keep
    using as-is.
  - Icon "wiggle" on hover (`iconWiggle` variants object, `main.tsx`) is
    the reusable pattern for animated icons: give the icon a
    `motion.span` wrapper with `variants={iconWiggle}`, and the parent
    button just needs `initial="rest" whileHover="hover"` (or, if the
    parent already uses its own unrelated variants object for something
    else like entrance timing, `whileHover="hover"` alone still works —
    variant-label propagation to children doesn't require the parent's
    own variants object to contain that label).
  - **Second known gotcha, also worked around**: a `motion.span` that's
    also animated with `initial={{y: 4}} animate={{y: 0}}` (used for the
    home screen's rotating search placeholder, `main.tsx`) CANNOT also be
    vertically centered via a CSS `transform: translateY(-50%)` rule —
    Framer Motion sets `transform` directly as an inline style for its
    own `y` animation, and an inline style always wins over a stylesheet
    rule regardless of specificity, so the CSS centering gets silently
    clobbered the moment the animation settles (found via DOM
    measurement in the browser preview — the element was rendering
    ~11px lower than intended, not a large obvious break, the kind of
    bug that's easy to miss without actually measuring). **Fix: never
    use a CSS `transform` for centering/positioning an element Framer
    Motion also animates a transform-driving prop (`x`/`y`/`scale`/
    `rotate`) on.** Use flexbox (`display:flex; align-items:center` on
    the parent) instead — see `.search-input-wrap`/`.search-placeholder`
    in `main.scss` for the working pattern.
  - **Per-category/per-button color identity** (added when the shell
    felt "too flat/grey" on user feedback): the 4 home-screen category
    cards, the tool cards/list entries under them, and the Toolset
    one-click button grid each get a distinct hover accent color instead
    of everything falling back to the same `--ov-accent` blue.
    `CATEGORY_COLORS` (`main.tsx`) maps each category id to a
    `{grad, border, glow, icon}` set; `categoryStyleVars()` turns that
    into inline CSS custom properties (`--cat-grad`/`--cat-border`/
    `--cat-glow`/`--cat-icon`) set per-element via `style={...}`, and
    `main.scss` just references `var(--cat-*)` in the relevant `:hover`
    rules. Toolset buttons use a separate, unrelated `PALETTE` in
    `Toolset.tsx` (cycles by button index, not tied to any category).
    **Both palettes store pre-blended hex/rgba values, not raw hex +
    `color-mix()`** — the chrome74 target rule above applies here too;
    the first pass tried `color-mix(in srgb, var(--btn-accent) 22%,
    #2a2a2a)` for the blended hover background and had to be reverted to
    plain precomputed hex strings per palette entry. If a future palette
    entry needs a blended shade, compute it by hand (or in JS) and store
    the literal value — don't reach for `color-mix()` in this codebase.

## Favorites (home screen only, pinned via search results)
A star toggle button sits next to the home screen's search box
(`.favorites-toggle`) -- clicking it slides open a compact chip row
(`.favorites-row`) of pinned tools above the Toolset grid, empty by
default ("No favorites yet — star a tool from your search results to pin
it here"). Pinning happens from search results specifically, not from
category tool-lists: every search-result card (`renderToolCard` in
`HomeScreen.tsx`) has a small star icon, hidden until the card is
hovered (`.tool-card-favorite { opacity: 0 }`, revealed via
`.tool-card:hover .tool-card-favorite`), that toggles that tool (or that
specific matched action -- see `favoriteKey()`) in/out of favorites.
Clicking a favorite chip navigates the same way a search-hit card does
(including auto-firing the action if the favorite was a specific action,
not the tool as a whole).

**Deliberately scoped to the home screen only** -- the user explicitly
didn't want this competing for space inside category screens, which
already have their own tool list.

- **Persistence**: `loadFavoriteTools()`/`saveFavoriteTools(toolIds)` in
  `aeft.ts`, same `app.settings` convention as tool order/campaigns/
  useful folders (section `"XYiToolbox"`, key `"OVFavoriteTools"`,
  tab-separated). `useFavorites.ts` loads once on mount and silently
  no-ops on failure -- same reasoning as tool order: this is a
  convenience preference, not a user-initiated action, so a failed
  load/save shouldn't produce a toast.
- **Favorite key, not just tool id**: `favoriteKey(toolId, action?)`
  produces `"toolId"` for a whole-tool favorite or `"toolId::action"` for
  one specific action within a tool (e.g. favoriting "Trott 2.0"
  specifically, not all of Campaign Localiser) -- mirrors how search
  results themselves distinguish a tool-name match from an inner-action
  match. `parseFavoriteKey()` reverses it. If you touch this format,
  keep the `::` separator distinct from anything a real tool id or
  action label would ever contain.
- **Verified working end-to-end via a live dev server + real browser**
  (not just browser-preview's mock data path): star a search result →
  toggle button fills gold and the row shows the new chip → clicking the
  chip navigates correctly → a genuine full page reload resets favorites
  to empty (confirms it's real `app.settings`-backed persistence, not
  `localStorage` silently carrying state across reloads -- browser
  preview has no CEP bridge, so this is the expected/correct behavior
  there; verify actual cross-AE-restart persistence in real AE, same
  caveat as every other `app.settings`-backed feature in this project).

## Post-refactor build fixes (this session found and fixed, not part of
## the refactor's own original commit)
The shell-decomposition + favorites refactor above landed with 4 real
`tsc` errors that would have blocked `yarn build`/`yarn zxp` (Vite's dev
server doesn't type-check, so it ran fine in `yarn dev` despite these --
don't assume "the dev server works" means the project actually builds).
All fixed, `tsc -p tsconfig-build.json --noEmit` is clean again:
- `evalTSSafe.ts`: `let timeoutHandle: ReturnType<typeof setTimeout>;`
  (no initializer) → TS couldn't prove it's assigned before use across
  the two closures (`timeoutPromise`'s executor vs. `callPromise`'s
  IIFE), even though `new Promise(executor)` invoking its executor
  synchronously means it genuinely always is. Fixed with a
  definite-assignment assertion (`let timeoutHandle!: ...`), not a
  restructure -- the logic was already correct, only the type-level
  proof was missing.
- `useFavorites.ts`: a `.filter()` type predicate said
  `{ action?: string }` (optional property) when the `.map()` above it
  actually produces `{ action: string | undefined }` (present property,
  possibly-undefined value) -- different shapes in TS's type system.
  Fixed by matching the predicate to what's actually constructed. This
  was also the root cause of two downstream errors in `HomeScreen.tsx`
  (`.tool`/`.action` access on a union that TS couldn't narrow) --
  fixing the predicate resolved both without touching `HomeScreen.tsx`.
- `HomeScreen.tsx` imported `from "../Main"` (capital M) when the real
  file is `main.tsx` (lowercase) -- resolves fine on Windows/macOS's
  case-insensitive filesystems (which is exactly why it shipped without
  anyone noticing locally) but is a real `tsc` error and would break on
  a case-sensitive one (Linux CI, some Docker setups). Fixed to match
  the real filename exactly.
- **The "everything is invisible" visual bug this session first
  suspected was NOT a refactor bug** -- `.screen-fade`/`.home-header`
  appeared permanently stuck at `opacity: 0` in the automated browser
  session used to investigate this. Confirmed via direct DOM inspection
  that Framer Motion's animation was still actively running (fighting a
  manual `style.opacity` override applied via devtools), just severely
  throttled by `requestAnimationFrame` starvation in that
  backgrounded/automated tab -- the exact same known limitation already
  documented elsewhere in this file for the Claude Code preview harness.
  Waiting ~8 real seconds let it complete normally. **If a future
  session sees this "stuck at opacity 0" symptom again, don't assume
  new code broke it -- check whether it's this same rAF-throttling
  artifact first**, especially if the same page renders correctly after
  simply waiting or in a real foregrounded browser tab.

## Wrike Tasks (unhooked, code kept)
A real feature (not a stub) -- sign in with a Wrike permanent API token,
see your assigned Active tasks, filter to due today/tomorrow, expand one
for its description (+ any links found in it), PDF attachments, and
subtasks. Talks to Wrike directly over Node's `https` module (NOT
`fetch()` -- Wrike's API isn't CORS-friendly for arbitrary browser calls;
this panel's `--enable-nodejs` CEP param sidesteps that entirely). Was
tested against a real account and worked, including a real bug fix
(`fields=["description"]` turned out to be an invalid request -- Wrike
rejects it with a 400 because `description` is already a default field on
the single-task endpoint, not opt-in like `subTaskIds` -- fixed by
dropping the `fields` param for that one call).

**As of this note, deliberately DISCONNECTED from the UI** -- the user
asked to "unhook" it while they decide whether to keep building on it, not
because anything was broken. Explicitly NOT deleted, same
"orphaned-but-kept, don't delete" treatment this file already gives
`XYi_OpenComp.jsx`/`XYi_MCIt.jsx` -- don't clean this up as dead code
without asking first.
- **What was actually removed**: `toolRegistry.tsx`'s `WrikeTasksTool`
  lazy import, its `PREFETCH_MAP` entry, and its `TOOLS` array entry (so
  it's gone from every category list, search, and ⌘K) -- and
  `HomeScreen.tsx`'s full-width "Your Wrike" launch button (+ its now-
  unused `KeyRound`/`ArrowRight` imports) that used to sit below the four
  category cards.
- **What was deliberately left in place, fully intact**:
  `tools/WrikeTasks.tsx` + `WrikeTasks.scss`, `hooks/useWrikeTasks.ts`,
  `lib/utils/wrikeApi.ts` (the Node-based Wrike API client), and
  `aeft/shell.ts`'s `loadWrikeApiToken`/`saveWrikeApiToken`
  (`app.settings` key `"WrikeApiToken"`) -- all still there, still
  type-check clean, just nothing imports/renders them anymore. A
  previously-saved token (if the user connected before this) is still
  sitting in `app.settings` untouched.
  - Note: `loadWrikeUserId`/`saveWrikeUserId` (key `"WrikeUserId"`,
    `shell.ts`) is a SEPARATE, unrelated feature (a free-typed ID field
    used by Timesheet Tracker's JSON export) that predates this feature
    and was never part of it -- don't touch it if re-wiring/removing
    Wrike Tasks later, and don't confuse the two keys.
  - `main.scss`'s `.wrike-launch-button` rule was also left in place
    (harmless dead CSS with no button referencing it right now) rather
    than hunted down and deleted -- same reasoning the CheckboxToggle
    rollout note above gives for its own leftover dead selectors.
- **To re-enable**: re-add the `WrikeTasksTool` lazy import + its
  `PREFETCH_MAP` line + its `TOOLS` entry in `toolRegistry.tsx` (the
  removed block's comment there points back to this note), and re-add
  the "Your Wrike" button in `HomeScreen.tsx` below `.category-row` (the
  `.wrike-launch-button` CSS is still there waiting for it). Nothing
  else needs to change -- the feature itself was never touched.

## Motion Tools (new, home-screen tabbed droplet)
A quick-access popover for the layer actions motion designers reach for
constantly, triggered by a button to the LEFT of the home screen's search
box (`HomeScreen.tsx`'s `.search-box-row`, `MotionToolsDroplet.tsx` -- a
`Move`-icon trigger reusing `.favorites-toggle`, opening via the existing
`Droplet.tsx` anchored-popover primitive). Built fresh for this app (not a
port of anything in `toolset/`) -- asked for with "complete freedom" but
one hard requirement (anchor point tools), then explicitly asked to be
"way cooler, like Motion Tools Pro / the best Motion 2 stuff", so it was
expanded from a flat bar into a **5-tab panel** modeled on Mister Horse's
Motion 2 / aescripts' Motion Tools Pro feature set. Backend:
`src/jsx/aeft/motionTools.ts` (barrel-exported from `aeft.ts`). Everything
operates on the active comp's `selectedLayers` (or `selectedProperties`,
for Excite) -- no file dialogs, no master files, pure in-comp edits, each
in its own `beginUndoGroup`.

The panel pushes Motion Tools' teal into the shared `--cat-*` CSS vars
inline (`MT_ACCENT_VARS` in the tsx, mirrored by `$mt-accent` in the scss
-- keep the two literals in sync) so `SegmentedToggle`/`CheckboxToggle`,
which key off `--cat-*`, adopt the tool's colour instead of the fallback
blue.

**Layout trap that shipped TWICE here before being written down: never
wrap this panel's stretch-sized elements (tabs, anchor grid cells, nudge
buttons) in `<Tooltip>`.** Tooltip's inner span carries `flex: 0 0 auto
!important` (needed for its own positioning fix -- see Tooltip.tsx's
header), which silently defeats any `flex: 1`/grid-stretch sizing on the
wrapped element: first the anchor cells rendered tiny and centered, then
the tab bar's five `flex: 1` tabs collapsed to intrinsic width and smashed
to one side. Both fixed by dropping the Tooltip wrapper and using a native
`title` attribute for the hover label instead (`.mt-row--fill` +
un-wrapped children is the working pattern). If some future element in
this panel refuses to fill its row, check for a Tooltip wrapper first.

**Visual layer is Framer Motion** (`motion/react`): the active tab is a
sliding `layoutId="mt-tab-ind"` pill (same technique as `SegmentedToggle`),
and each tab pane is a `motion.div` keyed on the active tab that fades/
slides in. Deliberately **no `AnimatePresence mode="wait"`** for the panes
-- that pattern wedges under the preview harness's rAF throttling (the
sliding pill's position also stalls mid-animation in preview and only
settles once; both animate normally in real AE). A plain key-remount fade
avoids depending on exit animations firing. `useReducedMotion()` collapses
both to instant. Tabs:

- **Anchor** -- `motionToolsSnapAnchor(relX, relY)`. The required part. A
  3x3 reference grid (Photoshop/Figma anchor-selector language) that snaps
  each selected AVLayer's anchor to a corner/edge/center of its own
  content box (`getContentFrameRect()`, independent of current anchor/
  position) and auto-compensates Position so the layer never jumps.
  Compensation accounts for current Scale and Z Rotation. **Known
  approximation, flagged in code**: a 3D layer also rotated on X/Y or
  with a non-default Orientation is only Z-compensated, so slightly off
  for that one case; exact for every 2D layer and any 3D layer rotated
  only on Z.
  - **Real bug found by the user ("anchor extends past the precomp's
    corner instead of landing on it"), fixed.** `sourceRectAtTime()` on
    a precomp layer measures the bounding box of the actual rendered
    PIXEL CONTENT inside the nested comp, not the nested comp's own
    canvas -- a precomp built with full-bleed artwork (content
    deliberately extending past its own comp edges, a common safety
    margin in motion design) reports a box WIDER than the precomp
    itself, so snapping to "Top Left" landed on the edge of that bleed,
    outside the precomp's actual visible frame. **Fix**:
    `getContentFrameRect()` (shared by both `motionToolsSnapAnchor` and
    `getLayerBounds`, since Align/Distribute/Group have the exact same
    root-cause exposure) now checks `layer.source instanceof CompItem`
    first and uses that nested comp's own `{0, 0, width, height}`
    instead of `sourceRectAtTime()` for any precomp layer; real footage/
    solids/text/shapes are unaffected, still `sourceRectAtTime()` as
    before. **Untestable in browser preview** (no real AE bridge, no
    real precomp layers) -- needs a real-AE pass against an actual
    full-bleed precomp to confirm fixed.
- **Align** -- `motionToolsAlign(edge, relativeTo)` +
  `motionToolsDistribute(axis)` + `motionToolsGroup()`. Align 6
  edges/centers to either the **Composition** or the **Selection**'s
  own union bounds (a `SegmentedToggle` picks which); distribute 3+
  layers evenly by center on H/V; Group parents the selection to a new
  null placed at their collective-bounds center. **The Group no-jump
  trick**: the null is given `anchorPoint == position ==` that center,
  which makes it an identity transform, so parenting children to it keeps
  them exactly in place while still giving one pivot handle -- don't
  "simplify" this by leaving the null at its default anchor, that
  reintroduces the jump. Align/distribute use `getLayerBounds()` (a
  comp-space AABB from `sourceRectAtTime` + anchor/position/scale,
  rotation deliberately ignored like every align tool). **Parenting
  caveat, flagged in code**: a parented layer's Position is in parent
  space, so aligning one to the comp mixes coordinate spaces and will be
  off -- same limitation Motion 2 has.
- **Transform** -- the nudge bar. Position (arrows), Scale/Rotation/
  Opacity (±/rotate). **Hold-to-repeat** (`RepeatButton` in the tsx: fires
  once on press, then repeats every 100ms after a 350ms hold -- added
  after direct feedback that click-per-step was "a million clicks";
  repeat ticks are gated on the previous evalTS call settling via a
  `busyRef` so a slow bridge can't queue stale nudges that keep landing
  after release). A **Step field** sets the per-tick amount; **Shift =
  10x** that step (`e.shiftKey` captured at press, matching AE's own
  arrow-key convention). Adds a keyframe at the current time only if the
  property is already animated, else sets the static value.
  - **Real bug found on a real macOS AE install, fixed: nudge buttons did
    nothing when clicked in the actual embedded CEP panel.** `RepeatButton`
    originally used the Pointer Events API
    (`onPointerDown`/`onPointerUp`/`onPointerLeave`/`onPointerCancel`) --
    the ONLY place in this whole panel that did, every other button here
    (Anchor, Align, Distribute, Group) uses plain `onClick` and worked
    fine on the same machine. Confirmed via direct comparison: the exact
    same panel, mirrored through a separate Chrome DevTools remote-debug
    window (a full modern Chrome renderer, not the panel's own embedded
    CEF host), DID respond to the pointer events -- isolating this to the
    macOS AE CEP panel host itself not reliably dispatching Pointer
    Events, not a logic bug in the nudge functions
    (`motionToolsNudgePosition`/`Scale`/`Rotation`/`Opacity` in
    `motionTools.ts` were all correct on inspection and confirmed working
    once the click actually fired). **Fixed by switching `RepeatButton`
    to Mouse Events** (`onMouseDown`/`onMouseUp`/`onMouseLeave`) -- the
    same, known-working input path every other button in this panel
    already relies on via `onClick`. **If a future addition to this app
    needs press-and-hold or any handler beyond a plain click, use mouse
    events, not pointer events** -- this app's actual macOS CEP panel
    host can't be assumed to support the latter, even though it's the
    more "correct" modern browser API and works fine in ordinary Chrome.
- **Sequence** -- `motionToolsSequence(frames, reverse)`. Staggers the
  selected layers in time (Motion 2's "Shifter" in miniature), ordered
  top-to-bottom by layer index (not selection order), `reverse` flips it.
  Anchored to the earliest current `startTime` in the selection so the
  cascade stays put rather than snapping to 0. Whole-frame snapped via
  `frameDuration`.
- **Ease** -- two halves. **Easy Ease** (`motionToolsApplyEase`): a
  `SegmentedToggle` picks the property, In/Out/Both apply AE's Easy Ease
  (`KeyframeEase(0, 33)`) to `Property.selectedKeys`, falling back to
  `nearestKeyIndex(comp.time)` if no keys are box-selected -- a small
  improvement over native F9's "does nothing if nothing's selected".
  **Excite** (`motionToolsExcite(type, strength)`): the Motion 2 headline
  -- adds an **overshoot (signed elastic) or bounce (abs) expression** to
  whatever properties are selected in the timeline (`selectedProperties`,
  filtered to `PropertyType.PROPERTY` + `canSetExpression` +
  **`numKeys>=2`**). The expression rings out AFTER the last keyframe
  (keyframed motion itself untouched -- you have to scrub PAST the last
  key to see anything, now stated in the UI hint); a 1-10 strength slider
  tunes freq/decay (`exciteExpression()`), and an eraser button
  (`motionToolsExciteRemove`) clears expressions off the selected
  properties. **Real bug found by the user's first AE test ("did nothing
  on 2 keyframes"), fixed**: v1 sampled `velocityAtTime()` a tenth of a
  frame before the last key -- with easy-eased keys (the default state of
  most real keys, and exactly what our own Ease buttons produce) velocity
  is ~0 there, so the ring-out amplitude was ~0 and invisible. Now uses
  the AVERAGE velocity across the final keyframe segment
  (`(key(n).value - key(n-1).value) / segment duration`), which captures
  the size/speed of the move into the last key regardless of easing --
  and is why >= 2 keys are required (need a segment to average).
- **Error surface**: a local inline error line at the bottom of the
  droplet (`evalTSSafe`'s `.error`), not the app-wide toast stack -- the
  one home-screen feature with no toast stack to plug into.
- **Untestable in browser preview beyond "calls evalTSSafe and shows an
  error"** -- like every ExtendScript-only feature here, the actual
  transform/expression math needs a real AE session with real layers to
  verify. Confirmed in preview that all 5 tabs render/switch correctly and
  that the no-bridge failure surfaces the same raw `"Cannot read
  properties of undefined (reading 'evalScript')"` every other
  `evalTSSafe` button already shows there (checked against the pre-existing
  "Turk It" button) -- a pre-existing no-bridge quirk, not a Motion Tools
  bug. **Still needs a real-AE pass** on: the anchor no-jump math across
  layer types, align/distribute against real multi-layer selections, the
  Group identity-null trick, and the two Excite expressions actually
  ringing out as intended.

### Two real-AE bugs found after the panel got renamed "XYtools" in the UI

Both reported from an actual studio project (not preview/mock data), both
in `src/jsx/aeft/motionTools.ts`, both now fixed and verified via `tsc -p
tsconfig-build.json` (clean) and `yarn build` (clean). Neither is
verifiable in browser preview -- both are pure ExtendScript-engine
behavior with no browser-visible surface -- so they still want a real-AE
re-test on shape layers + a Position key with a copied ease, but the root
cause and fix for both are well-understood, not guesses.

- **Ease Copy/Paste threw `"Unable to call 'setTemporalEaseAtKey' because
  of parameter 2. Value array does not have 1 elements."`** --
  `motionToolsApplyEase` and `motionToolsPasteEase` both built the
  `KeyframeEase[]` array's length from `prop.value instanceof Array ?
  prop.value.length : 1`, assuming that always matches what
  `setTemporalEaseAtKey` expects. It doesn't always: AE's own
  `keyInTemporalEase`/`keyOutTemporalEase` calls are the actual ground
  truth for a given key's ease dimensionality, and can diverge from
  `prop.value`'s shape (e.g. a Position property with "Separate
  Dimensions" enabled). Fix: derive the ease array length from
  `prop.keyInTemporalEase(keyIndex).length` /
  `...keyOutTemporalEase(keyIndex).length` for that exact key instead of
  from `prop.value`, in both the Easy Ease buttons and Paste Ease. Applies
  once per call site (`motionToolsApplyEase` around the `easyEaseTuple`
  call, `motionToolsPasteEase`'s `dims` calculation).
- **Anchor Point tools, Align, Distribute, and Group into Null all
  silently skipped shape layers** ("No eligible layers selected
  (cameras/lights/audio have no anchor point)" even with shape layers
  selected). Root cause: all four used `if (!(layer instanceof AVLayer))
  continue;` to exclude cameras/lights/audio-only layers (the only layer
  types that genuinely lack `sourceRectAtTime`/a visual anchor) -- but on
  a real AE session, `instanceof AVLayer` does NOT reliably match a
  ShapeLayer object, even though shape layers are conceptually AVLayers
  and Types-for-Adobe's TS defs model them that way. This matches this
  file's other documented ExtendScript-DOM gotchas (`.match()` on
  regex-special substrings, missing `Array.prototype` methods) -- the AE
  DOM's exposed class hierarchy isn't always a real JS prototype chain
  `instanceof` can trust. Fix: replaced every `instanceof AVLayer` gate in
  this file with a duck-typed `typeof layer.sourceRectAtTime ===
  "function"` check -- tests for the actual capability the code needs
  right after (calling `sourceRectAtTime`), which is true for every real
  content layer (solid, footage, precomp, text, shape) and false for
  cameras/lights/audio, without depending on `instanceof` against an
  ExtendScript host class. Fixed in `motionToolsSnapAnchor`,
  `motionToolsAlign`, `motionToolsDistribute`, and `motionToolsGroup` (all
  four had the identical pattern). If another `instanceof <AE host
  class>` check ever misbehaves the same way, duck-typing on the specific
  method/property actually used is the established fix here now, not a
  one-off.

### Follow-up: anchor confirmed fixed; "Paste Ease does nothing" round 2

After the fixes above, the anchor-point tools were confirmed working on
shape layers in real AE. Ease Copy/Paste still "wouldn't paste anything
onto the other one" (two Position layers, both already eased -- copy from
one, paste onto the other), this time with NO error thrown.

Investigation ruled out the data path entirely: `evalTS` serialises each
arg with `JSON.stringify`, so the copied ease object (nested
`inEase`/`outEase` arrays of `{speed, influence}`) round-trips into
ExtendScript as a valid object literal; `evalTSSafe` returns the whole
result object unchanged, so `result.ease` survives back to React and into
the Paste call. The `KeyframeEase(speed, influence)` construction order is
correct, dims match (both 2D Position). In other words the paste was very
likely *succeeding* -- `touched > 0`, no error -- but with **zero feedback
about which keyframe it landed on**. The smoking gun: `motionToolsPasteEase`
falls back to `prop.nearestKeyIndex(comp.time)` when no keyframe is
explicitly selected, so if the timeline keyframe selection wasn't what the
user assumed (easy to lose after clicking around the CEP panel), the ease
gets applied to *a* key near the playhead -- not the one they were looking
at -- and reads as "nothing happened."

Fix is feedback-first, because the operation itself was mechanically fine:
- `motionToolsCopyEase` now returns a `message` naming the exact key +
  layer it read and whether that came from the timeline selection or the
  playhead-nearest fallback.
- `motionToolsPasteEase` now returns a `message` with the count of
  keyframes written, the layer name(s), and -- crucially -- a flag when it
  used the nearest-key fallback because nothing was explicitly selected
  ("nearest to playhead -- select target keyframes to aim it"). Both new
  result types (`CopyEaseResult.message`, `PasteEaseResult`) extend
  `Result`.
- `MotionToolsDroplet.tsx` shows that `message` in the Ease tab's status
  line (`easeStatus` state, reusing `.mt-hint--copied`), replacing the old
  static "Ease copied" text; the resting hint now reads "Ease copied --
  select the target keyframe(s), then Paste." Status clears on tab switch
  and on ease-property change so it never goes stale.
- This is deliberately NOT a blind logic rewrite: the copy/paste mechanics
  are correct for the standard case, so the change makes the behaviour
  *observable* instead of guessing at a phantom bug. The next real-AE test
  is now conclusive -- if paste reports "Pasted ease onto 1 keyframe on
  <layer>" but the curve still looks unchanged, the problem is an
  ease-value/targeting detail to chase from there; if it reports the
  nearest-playhead fallback, the user simply needs a target key selected.
  Verified `tsc -p tsconfig-build.json` + `yarn build` clean; the
  happy-path copy/paste itself is ExtendScript-only and unreachable in
  browser preview (no bridge -> only the error path renders there).

### Follow-up round 3: "pastes bezier but with AE's DEFAULT ease values"

Anchor confirmed fixed and paste now confirmed to fire, but the pasted
ease came out with AE's DEFAULT values: the target keyframe turned bezier
(interp type transferred) but its speed/influence stayed at the default
(speed 0, influence 33.33), not the source's. The tell -- "copies that
keyframes are bezier but no real values, speed stays default" -- is the
exact signature of `new KeyframeEase(undefined, undefined)`, i.e. the
per-dimension `{speed, influence}` values arriving **undefined** at paste
time (a default-constructed KeyframeEase is bezier / influence 33.33 /
speed 0).

Root cause: **the transport of the ease payload back INTO ExtendScript.**
`evalTS` builds its call by splicing `JSON.stringify(arg)` for each
argument directly into the eval'd ExtendScript SOURCE STRING. A flat
object argument survives that (proven -- `trueCompDuplicator` passes
`{suffix, includeNested, updateExpressions}` this way), but our ease was a
**nested array-of-objects** (`{inEase:[{speed,influence}], outEase:[...]}`)
and its inner speed/influence values did not survive being re-parsed as a
source-code object literal by the ExtendScript engine -- they came through
undefined, so paste silently built default KeyframeEases. This is a new,
documented instance of the general "ExtendScript engine ≠ a real JS
engine" gotcha this file already tracks (`.match()`, missing Array protos,
`instanceof` against host classes).

Fix:
- `motionToolsPasteEase` now takes the ease as a **JSON string**
  (`easeJson: string`) and `JSON.parse`s it internally, instead of taking
  a nested object. A single string survives the source-splice intact (it's
  just a quoted string literal) and `JSON.parse` reconstructs the nested
  structure deterministically. `MotionToolsDroplet.tsx`'s
  `handlePasteEase` passes `JSON.stringify(copiedEase)` accordingly.
- Added an `isFiniteNum` guard: after parsing, paste validates the first
  in/out dimension has finite numeric speed AND influence, and returns a
  clear error ("The copied ease has no usable speed/influence values --
  copy the ease again") rather than EVER silently applying AE defaults
  again. This is the belt-and-braces against any future transport
  regression -- a values-lost payload now fails loudly instead of pasting
  a wrong-but-plausible default ease.
- Diagnostics from the earlier attempt are kept: copy's `message` shows
  `[in 33%/0 · out 75%/0]` (values read off the source, computed in
  ExtendScript before any transport), and paste's `message` shows `[AE
  kept: ..]` (read straight back off the target after
  `setTemporalEaseAtKey`). Together these localise any *remaining*
  discrepancy to a single stage: if copy shows real values but paste's "AE
  kept" shows defaults, the loss is post-copy (transport/serialisation,
  now fixed); if "AE kept" matches copy but the curve still looks off,
  that's genuine move-magnitude (same influence, different distance =
  different peak speed, which is correct AE behaviour) or a wrong
  source-key pick (also named in copy's message).
- Verified `tsc -p tsconfig-build.json` + `yarn build` clean. Still
  ExtendScript-only (no bridge in browser preview), so the real
  copy/paste can only be confirmed inside AE.

### Follow-up round 4: multi-keyframe copy + the 33.3% ambiguity

The round-3 diagnostic paid off: a real-AE copy showed `Copied Position
ease from key 1 on "Shape Layer 1" [in 33.3%/0 · out 33.3%/0]`, and paste
"changed nothing". Two findings:
1. **33.3%/speed-0 is a standard Easy Ease AND is exactly what a
   default-constructed KeyframeEase is** -- so a 33.3% source is
   indistinguishable between "value transferred correctly" and "defaulted".
   Any conclusive test of the copy/paste MUST use a deliberately
   non-default ease (e.g. Keyframe Velocity influence 80%). The two layers
   in the repro had visually different velocity curves only because they
   travel different distances (851 vs 782 px) at the same 33.3% ease --
   copy/paste of ease neither can nor should equalise that.
2. **Copy only captured ONE keyframe's ease** (the first selected) and
   pasted it onto every target key. Real design limitation: a two-key move
   with distinct eases on each key can't reproduce from one key's values.

Fix -- copy/paste is now **multi-keyframe**:
- `SerializedEase` became `SerializedKeyEase` (per-keyframe), and
  `motionToolsCopyEase` returns `keys: SerializedKeyEase[]` -- one entry
  per selected source keyframe, captured in ascending timeline order.
- `motionToolsPasteEase` parses the array (still a JSON string over the
  bridge, per round 3) and maps the k-th target key to the k-th copied key
  (target keys also sorted ascending); clamps to the last copied key when
  there are more targets than copied, and a single copied key still lands
  on every target (the "apply this ease everywhere" case).
- Frontend state `copiedEase` -> `copiedKeys` (an array); everything else
  (JSON-string transport, `isFiniteNum` validation, `easeStatus` line)
  unchanged. Copy's message now reads "Copied Position ease from N
  keyframes on <layer> [first key in .. · out ..]".
- Verified `tsc -p tsconfig-build.json` + `yarn build` clean. Reminder for
  the next real-AE test: **copy from a keyframe with a clearly non-default
  ease** (not a plain F9 Easy Ease) so a successful transfer is visible;
  33.3% -> 33.3% is a no-op by definition.

### Follow-up round 5: Position works, Scale (multi-dim) hardening

Position copy/paste confirmed working. "Only Position" is usually just
that the other properties aren't keyframed on the test layer (copy/paste
needs keys on whichever property the Pos/Scale/Rot/Opac toggle selects) --
but there was one genuine dimensional bug waiting for Scale:
`setTemporalEaseAtKey` requires `inEase.length ==
keyInTemporalEase().length` and `outEase.length ==
keyOutTemporalEase().length`, and **Scale is multi-dimensional** (2 on a
2-D layer, 3 on 3-D) whereas Position/Rotation/Opacity are 1-D temporally.
Paste had built both arrays to a single `Math.max()` of the two lengths,
which is fine for symmetric 1-D props but could over/under-fill an array
on Scale and throw "Value array does not have N elements". Fixed by
building the in and out arrays to their OWN native lengths independently
(`keyInTemporalEase().length` / `keyOutTemporalEase().length`), reusing the
source's first dimension when the copied ease has fewer dims than the
target. `tsc`/`yarn build` clean. Scale itself still wants a real-AE
confirm (multi-dim path is ExtendScript-only, unverifiable in preview).

### Follow-up round 6: not a bug -- wrong-property confusion, now guarded

The "Scale doesn't work" report turned out not to be a copy/paste bug at
all: the user had Scale keyframes selected (a real, deliberately-shaped
V-ease, `in 100%/0 · out 33.3%/0`), but the Ease tab's Pos/Scale/Rot/Opac
toggle was still on "Position" -- and Copy read exactly that: "Copied
**Position** ease from 1 keyframe... (nearest to playhead)". The toggle
decides which property the tool acts on; it does NOT look at what's
selected in the timeline to infer that, so a stale toggle silently
substitutes the wrong property's nearest keyframe with no warning. This
is a genuine, repeatable UX trap, not a one-off, so it's now guarded
rather than just explained:

- Both `motionToolsCopyEase` and `motionToolsPasteEase` now check, before
  ever falling back to nearest-to-playhead: "is nothing selected on the
  toggle's own property, but keyframes selected on ANY of the OTHER three
  ease properties?" If so, return a clear error instead of proceeding --
  `"You have Scale keyframes selected, but this tab is set to Position.
  Switch the toggle above to Scale first."` This can't false-positive on
  the legitimate no-selection case (playhead-nearest fallback) because it
  only fires when a DIFFERENT property genuinely has a selection.
- No frontend change needed -- `error` already renders via the existing
  `run()`/`handleCopyEase`/`handlePasteEase` error surface.
- `tsc -p tsconfig-build.json` + `yarn build` clean.
- Once the toggle is switched to match the timeline selection, Scale
  should behave identically to the already-confirmed Position path (the
  round-5 multi-dimension fix already covers Scale's 2/3-D ease arrays).

### Follow-up round 7: the toggle-match requirement itself was the problem

Round 6's guard was technically correct -- the error text ("this tab is
set to Position") was reporting the REAL toggle value the frontend sent,
not a false positive from stale AE selection state -- but real-AE testing
immediately hit it again on Scale keyframes that were genuinely,
visibly selected in the Graph Editor, because the toggle just hadn't been
clicked. Three consecutive rounds tripping on the same toggle/selection
mismatch is a sign the design itself (a manual toggle the user must keep
in sync with whatever they've selected in the Timeline) is the wrong
interaction, not that the guard needed a smarter condition.

Fix: **copy/paste now auto-detects the property from the real timeline
selection**, and only falls back to the Pos/Scale/Rot/Opac toggle when
nothing is explicitly selected on any of the four ease properties:
- Both `motionToolsCopyEase` and `motionToolsPasteEase` scan all four
  `EASE_PROPERTY_NAMES` across the selected layers for `selectedKeys`. If
  exactly one property has a selection, that's used regardless of the
  toggle. If the toggle's own property already has the selection, nothing
  changes (matches the toggle, as before). If MULTIPLE different
  properties have selections at once (genuinely ambiguous -- e.g. you
  multi-selected keyframes across Position and Scale together), it errors
  out asking to select just one, rather than guessing.
- Both functions now return `usedPropertyKey`; the frontend
  (`handleCopyEase`/`handlePasteEase` in `MotionToolsDroplet.tsx`) syncs
  the toggle (`setEaseProperty`) whenever the backend used a different
  property than what the toggle showed, so the UI reflects reality instead
  of silently drifting from what was actually copied/pasted.
- The status message now says so explicitly when it happens: "...( auto-
  detected from your selection -- toggle switched to Scale)" -- visible
  confirmation rather than a silent toggle jump.
- This supersedes round 6's hard-block entirely; round 6's error path is
  gone. `tsc -p tsconfig-build.json` + `yarn build` clean. Confirmed the
  `.map`/`.indexOf` calls in the new ambiguous-selection error path are
  safe -- both are polyfilled in `shared.ts`, which `motionTools.ts`
  already imports (its module body/polyfills run before this file's code).

## Localised Library: "You may be in…" + JPG_PNG lazy browse
Two separate additions to `tools/LocalisedLibrary.tsx`, both real, both
touching the Territories/Folders views.

**"You may be in…" territory suggestion** -- a pinned, accent-bordered
row (`.ll-suggestion`, MapPin icon) above the search box on the
Territories screen, shown when the currently open AE project's saved
file path is detected to sit inside one of the CURRENT campaign's own
scanned territory folders. Click it to jump straight to that territory,
same as clicking its row in the list below.
- **Backend**: `localise.ts`'s `detectCurrentTerritory(territories:
  string[])` -- walks up from `app.project.file`'s parent folder,
  matching each ancestor folder's name (case-insensitive) against the
  PASSED-IN territory list. Same "walk up from the saved file, match a
  folder name" technique Timesheet Tracker's `tsExtractInfoFromPath()`
  (`tools.ts`) already uses for job/territory detection -- but matched
  against THIS campaign's real, scanned territory folder names
  (`scanTerritories`'s own output) rather than a fixed global vocabulary
  like Timesheet Tracker's `TS_TERRITORIES`, since Loc Lib's territory
  list is already derived live from disk per campaign and is strictly
  more accurate for this purpose.
- **Deliberately scoped to the CURRENTLY SELECTED campaign only** --
  doesn't also try to detect which campaign the open project belongs to.
  If the wrong campaign is selected, this just returns null (no
  suggestion shown), a safe/unsurprising fallback, not a bug. Extending
  this to auto-select the right campaign too would be a real, separate
  scope decision (abruptly changing the user's campaign selection out
  from under them) -- don't add that without asking first.
- Called via `quietEvalTS` (no toast on failure -- unsaved project,
  project outside this campaign's tree, or browser preview are all
  normal, expected "no suggestion" outcomes, not errors) inside the same
  `Promise.all` as the per-territory country-code lookups in
  `refreshTerritories`, for the same "don't add a second sequential
  round-trip on top of an already-parallelized decorative batch"
  reasoning documented there.
- `MOCK_DETECTED_TERRITORY` demonstrates this in browser preview (real
  detection needs a real saved project file, which preview never has).

**JPG_PNG lazy browse** -- real user-reported problem, not a
speculative optimization: a real studio JPG_PNG folder turned out to
contain many delivery-batch subfolders (`Batch_1`, `Batch_1_Post`,
`Batch_2`, ... `Bespoke`, `Bespoke_Post`), each full of images, and the
existing eager Auto-Populate scan (which used to treat JPG_PNG as a
third components-container name alongside Support_Motion/
Motion_Components) recursed into ALL of them at once -- "way too
heavy," dumping potentially hundreds of flat components into the
library from one territory. Fixed by removing JPG_PNG from that eager
scan entirely and giving it its own two-step, click-to-fetch flow
instead, live filesystem browse only, never persisted as library data.
- **`llIsComponentsContainerName`** (`localise.ts`) now matches ONLY
  "Support_Motion"/"Motion_Components" -- JPG_PNG intentionally removed.
  If a future session is tempted to re-add it there "for consistency,"
  don't -- that's the exact regression this fix undoes.
- **`scanJpgPngBatches(territoryPath)`** -- locates the territory's
  JPG_PNG folder via `llFindContainerFolder()` and lists ONLY its
  immediate batch subfolders -- does not look inside any of them, which
  is what keeps this step cheap regardless of how many images a batch
  holds. `_`-prefixed folders (`_Delivered`, `_Old` in the real folder
  that prompted this) are excluded, same "underscore-prefixed folders
  are excluded from every scan" convention used everywhere else in this
  toolset. Returns `{jpgPngPath, batches}` -- `jpgPngPath: null` (with
  `success: true`) means genuinely not found, not an error; a
  territory with no print/OOH deliverables yet is a normal outcome.
  **Real bug found on first real-AE test, fixed**: `llFindContainerFolder`
  shipped depth-first (fully search each non-matching folder's whole
  subtree before checking its next sibling), and against a real studio
  tree that latched onto the WRONG folder -- a territory's real,
  top-level JPG_PNG sits next to an "AE" folder, and AE project
  structures commonly have their OWN nested "JPG_PNG" footage-source
  folder buried inside a creative's asset tree. The depth-first search
  recursed into AE (enumerated before JPG_PNG) and matched that
  unrelated NESTED decoy first, stopping immediately -- so
  `jpgPngPath` came back non-null (looked like success) but pointed at
  an empty/wrong folder, and the real batches (`Batch_1` etc.) were
  never seen. **Now breadth-first**: checks every folder at the current
  depth before descending into any of them, guaranteeing the shallowest
  match (the real, intended top-level JPG_PNG) wins over a
  coincidentally-named folder buried deeper in an unrelated subtree.
  Same class of bug to watch for if `llFindComponentFiles`'s own
  Support_Motion/Motion_Components search (a different, older function,
  NOT changed here) is ever reported to find the wrong folder too.
- **`scanJpgPngLevel(folderPath)` -- ONE level at a time, NOT recursive.
  Second real bug, found on a second real-AE test, and the reason this
  isn't still `scanJpgPngBatchFiles`.** The first version recursively
  collected every image anywhere inside a batch, which against a real
  batch folder caused two real, visible problems: (1) it silently
  descended into `_old` (an underscore-prefixed archive folder every
  OTHER scan in this toolset already excludes -- this one just forgot
  to), pulling in stale versions of the same creative; (2) flattening
  every nested creative subfolder into one list meant files that happen
  to share a name rendered as visually indistinguishable "duplicates"
  with no way to tell them apart short of hovering for the full path.
  `scanJpgPngLevel` is a plain single-level directory listing (folders,
  `_`-prefixed excluded same as every other scan here, and JPG/JPEG/PNG
  files, both at that one level only) -- `LocalisedLibrary.tsx` calls it
  once per click as the user drills batch → subfolder → subfolder...,
  keeping files grouped in their REAL folders exactly as they sit on
  disk instead of this file trying to flatten/dedupe them after the
  fact. `scanJpgPngBatches(territoryPath)` still does the one-time FIND
  step (locates the JPG_PNG root via `llFindContainerFolder`) and calls
  this same primitive on the root it finds.
- **`suggestJpgPngMatch(candidateNames)`** -- "current file" quick-access
  suggestion at whatever JPG_PNG level is being browsed, same
  "You may be in…"-style reasoning as `detectCurrentTerritory` but
  matching a creative's JPG/PNG assets instead of a territory.
  **Deliberately does NOT reuse `shared.ts`'s `findBestComponentFile`**
  -- that scorer always returns ITS best guess among the candidates
  given, even when none are genuinely related (its own accept-threshold
  check returns the same `best` either way, effectively dead code);
  fine for MC It!/LOS Tools, wrong for a decorative suggestion where "no
  real match" needs to genuinely mean no suggestion. Uses a plain,
  conservative check instead: a normalized substring match either
  direction, or a majority of meaningful (3+ char) tokens shared.
- **`LocalisedLibrary.tsx`**: a collapsed-by-default "JPG_PNG" accordion
  section (dashed border, matching `.ll-new-folder`'s "this is an
  action, not existing data" look) sits BELOW the regular folder list
  in the Folders view, visually and structurally separate from
  `allFolderNames` -- it's live/lazy, not part of the persisted
  component library. First click scans the JPG_PNG root
  (`jpgPngScanned` gates re-scanning on subsequent expand/collapse of
  the same territory); drilling in from there is a **breadcrumb path
  stack** (`jpgPngStack: {label, path}[]`, NOT a fixed one-level batch
  selection) since a real batch's own internal structure varies (some
  flat, some nesting a subfolder per creative) -- `handleOpenJpgPngFolder`
  pushes a level, `handleJpgPngBack` pops one, `handleJpgPngBreadcrumb`
  jumps to any crumb directly. Every level is scanned fresh (cheap
  enough not to bother caching, and contents can change day to day),
  and the "current file" suggestion is recomputed at each level too. The
  level view reuses the exact same row/checkbox/Import/Reveal UI as the
  regular components-in-folder view, generalized via
  `toggleSelectAllPaths(paths)` (replaces the old folder-only
  `toggleSelectAll`) so both views share one `selectedPaths` set and one
  `handleImportSelected`. **Deliberately does NOT offer "Save Into
  Batch…"** anywhere in the JPG_PNG browse -- that action opens/saves
  `.aep` project files, which doesn't apply to plain JPG/PNG images and
  would be actively misleading to offer there.
- **Layout gotchas, both fixed before shipping (two separate bugs, same
  "root: flex context mismatch" family)**:
  1. `.ll-folder-list` used to carry `flex: 1; overflow-y: auto` itself
     (it was the only scrollable thing in the Folders view). Simply
     appending the JPG_PNG section as its sibling AFTER it would have
     let the folder list's `flex: 1` greedily consume all available
     height, pushing JPG_PNG out of view entirely below the fold with no
     way to scroll to it. Fixed by moving `flex: 1`/`overflow-y: auto`
     onto a new wrapping `.ll-folders-scroll` div around BOTH children,
     leaving `.ll-folder-list` itself as plain block flow.
  2. **Found via a real screenshot, not caught by build/typecheck**:
     `.ll-folder-row` (subfolder rows in the JPG_PNG level view) rendered
     ~660px tall -- one row eating almost the entire panel. Root cause:
     `.ll-folder-row`'s own base rule has `flex: 1` baked in, correct for
     its ORIGINAL context (`.ll-folder-row-wrap`, a flex ROW, where
     flex:1 means "fill available WIDTH" next to a delete button) -- but
     the JPG_PNG level view renders `.ll-folder-row` directly inside
     `.ll-comp-list`, a flex COLUMN, where the exact same `flex: 1` means
     "fill available HEIGHT" instead. Fixed with a scoped override,
     `.ll-comp-list > .ll-folder-row { flex: 0 0 auto; }`, rather than
     touching the shared base rule (which is still correct for its
     original callers). **If a shared row/item class ever gets reused in
     a new flex-column context and something renders way too big along
     the column axis, check for exactly this "flex:1 meant for a row,
     now sitting in a column" mismatch first** -- confirmed via
     `preview_inspect`'s computed `flex-grow`/`height`, not guessable
     from a screenshot alone.
  Both fixed the same way: a scoped override on the NEW usage site, not
  a change to the shared class everyone else still relies on correctly.
- `MOCK_JPG_PNG_ROOT`/`MOCK_JPG_PNG_LEVELS`/`MOCK_OPEN_PROJECT_HINT`
  demonstrate the full flow in browser preview, including a real nested
  drill (`Batch_1` → `Poster_Creative_FR` → its one file) and the
  "current file" suggestion re-evaluating correctly at each level (mock
  hint `"poster"` matches `Poster_Creative_FR`, then once drilled in,
  `Poster_1Sheet_FR.jpg`) -- the "no JPG_PNG folder found" empty state
  (Germany, no entry) still applies too.
- **Verified in browser preview, including a real bug caught this way**:
  France → JPG_PNG → root batches load → `Batch_1` → breadcrumb
  "JPG_PNG › Batch_1", subfolder and file correctly listed separately
  (not flattened) → drilled into the subfolder → breadcrumb extends to
  3 crumbs, suggestion re-targets the file inside → clicked the root
  "JPG_PNG" crumb → correctly jumped all the way back to the batch list
  in one step. The oversized-row layout bug above was FOUND during this
  same verification pass (via screenshot, confirmed via
  `preview_inspect`), not left for a real-AE session to discover.
  What still can't be verified here: the actual filesystem scans
  (`scanJpgPngBatches`/`scanJpgPngLevel`/`suggestJpgPngMatch`) against a
  real JPG_PNG folder -- same "logic verified, real I/O unverified"
  caveat every ExtendScript-only feature in this file carries.

**Follow-up round, from real-AE feedback with a Finder screenshot of a
real `Batch_3` (showing a real `_old` subfolder sitting alongside real
creative folders/files):**
- **Underscore-exclusion re-confirmed, not a bug** -- the user's
  screenshot was explaining WHERE the earlier duplicate-files problem
  came from (a real `_old` folder), not reporting a new leak past the
  fix. Re-verified the exclusion is genuinely unconditional: both
  `scanJpgPngBatches` (the JPG_PNG root) and `scanJpgPngLevel` (every
  level below it) funnel through the SAME `llScanJpgPngLevel` helper,
  which checks `item.name.charAt(0) !== "_"` before ever adding a folder
  to the list -- an excluded folder is never added to `folders`, so
  there is no code path that can later "drill into" or scan its
  contents; there's nothing to click. If `_old` (or `_Old`/`_Delivered`,
  any case) ever appears in the app again, that's either a stale build
  (extension needs reloading/reinstalling after this fix) or a genuinely
  new bug -- not this same one recurring.
- **JPG_PNG row visual redesign, on direct feedback that it looked "very
  similar to the rest" despite the dashed border.** Kept the dashed
  border (explicitly liked) but added: a tiny uppercase "LIVE FOLDER
  BROWSE" caption above it (`.ll-jpgpng-caption`, same micro-label
  language section headings use elsewhere in this app) so the eye gets a
  "this is a different KIND of thing" signal before reaching the row
  itself; a tinted background wash at REST, not just on hover (unlike
  plain folder/territory rows, which are flat gray until hovered); the
  icon in its own small badge (`.ll-jpgpng-icon-badge`) instead of a
  bare glyph; and a bold label. Applied the identical treatment to
  `.ll-suggestion` ("You may be in…" / "Current file…") for visual
  consistency between this app's two "special affordance row" patterns.
  - **Real bug caught while doing this, not cosmetic taste**: the first
    pass used `background: var(--cat-glow, ...)` for the resting
    background, copying the pattern `.ll-count.has` and others already
    use. But `--cat-glow` is a REAL inherited CSS var here (Localised
    Library's category context sets it to `rgba(45, 212, 191, 0.35)` --
    see `categoryStyleVars()`/`CATEGORY_COLORS` in `toolRegistry.tsx`),
    tuned for HOVER-shadow strength elsewhere in the app, not a resting
    fill -- so both `.ll-jpgpng-toggle` and `.ll-suggestion` rendered as
    a near-solid 35%-alpha block at rest instead of a subtle tint. The
    `rgba(..., 0.1)`-style fallback value in the same declaration never
    even applied, because the var WAS defined, just not to the value
    the fallback assumed. Fixed by using a fixed, genuinely low alpha
    (`rgba(45, 212, 191, 0.07-0.08)`) for the resting background instead,
    reserving `--cat-glow` for what it's actually tuned for (the
    stronger `:hover` state, unchanged). **If a future resting-state
    background in this app looks unexpectedly saturated/solid, check
    whether it's using `--cat-glow` (or another hover-tuned var) outside
    a `:hover` block before assuming it's a color-value typo** -- the
    fallback value in a `var(--x, fallback)` declaration is easy to
    misread as "what this actually renders," when a real inherited value
    silently wins instead. Confirmed the fix via `preview_inspect`'s
    computed `background-color` (exactly `rgba(45, 212, 191, 0.07)`),
    not just a screenshot -- a saturated hue at low alpha can still read
    as "strong" in a compressed screenshot even when the underlying
    value is correct, so computed-style inspection is the reliable check
    here, not eyeballing the image.
