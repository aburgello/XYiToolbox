# XYi Toolbox — decision history

**This file is NOT loaded into context.** It is the long-form record of how
this codebase got the way it is: bugs and how they were found, approaches that
were tried and reverted, debugging rounds, and verification notes.

**CLAUDE.md holds the RULES. This file holds the REASONS.** If a rule in
CLAUDE.md looks arbitrary or you're about to "simplify" it, search here first —
most of these constraints cost somebody a real afternoon, and several were
re-derived two or three times before being written down.

Everything below is the previous CLAUDE.md verbatim (as of the 2026-08 accuracy
pass, so it no longer contains the DOOM section or the other corrected claims).
It is kept in one piece rather than reorganised, because its value is that you
can grep it.

---

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
- **`yarn build` and `yarn zxp` are GATED**: both run
  `scripts/audit-jsx-precedence.cjs` over the source before building and over
  the emitted bundle after (`yarn audit:jsx` / `audit:jsx:bundle`). A build
  that fails the gate produces no output — fix the flagged expression, don't
  bypass it.
- `yarn build:web` — a browser-only build (`vite.web.config.ts` +
  `scripts/flatten-web.cjs`); `yarn watch`, `yarn serve`, `yarn symlink`,
  `yarn delsymlink` are the remaining helpers.

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
  - **Home**: logo + `TOOLBOX_VERSION` (bump by hand; format is `YYYYMMDD` e.g. `"20260730"`, NOT `year.month` and not semver. Lives in `TeamDroplet.tsx`, not here, because the Team update-nudge compares against it. Historically it read like
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

> **CORRECTION (2026-08 audit): OV Library is NOT a registered tool any more.**
> There is no `ov-library` entry in `toolRegistry.tsx`. It is now a lazy-loaded
> tab **inside `tools/ReviewHub.tsx`**, which is what the registry entry
> `review-hub` (`categories: ["review"]`) points at. `HomeScreen.tsx`
> special-cases BOTH `review` -> `review-hub` and `deliver` -> `delivery-hub`,
> so neither category ever renders a tool list. Consequently OV Library is a
> poor example of a multi-category tool — it no longer has categories at all.
> `ReviewHub` itself (and `review.ts`'s Review Session surface) is otherwise
> undocumented here.
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

**AND: use `grep -a` / `rg --text` when auditing `src/jsx`.**
`src/jsx/aeft/localise.ts` contains a literal NUL byte (a composite map key
inside `nameAuditScan`), so grep classifies the whole file as BINARY and
silently skips it. A forward-wiring audit run without `-a` reports
`nameAuditScan` and `csvLocaliserResolveMasters` as dead bridge calls when both
are real exports. This produced two false positives in the 2026-08 audit.
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
in `toolRegistry.tsx`'s `TOOLS` array — visible, categorized, and navigable via
the category master-detail screen (see Architecture) — but each currently
renders via `tools/Placeholder.tsx`'s `makePlaceholder(title,
description)`, a "Not wired up yet" page, not real logic yet. **To port
one for real: find its logic in `XYi_Toolbox.jsx`'s matching inline tab
group (search the tool's function name, e.g. `SafeGen()`) and/or its
nested `toolset/XYi_*.jsx` file, add the ExtendScript to `aeft.ts`, then
swap that one `Component: makePlaceholder(...)` for a real component in
`TOOLS`** (NOTE: as of the 2026-08 audit `makePlaceholder` has ZERO call sites
and `tools/Placeholder.tsx` is dead — every registered tool is real, so this
instruction is historical) — same pattern as the Toolset grid's `stub()` → real entry
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
  scaling (unlike Scale Composition). **CORRECTION (2026-07, verified
  against `adjWidth`/`adjHeight` in tools.ts)**: an earlier version of
  this bullet claimed adjusting width alone "visually stretches layer
  content" — wrong. Setting `comp.width`/`comp.height` CROPS or EXTENDS
  the canvas; layers keep their size and position, nothing stretches.
  The one field that genuinely distorts is Aspect Ratio (`pixelAspect`),
  which stretches the RENDERED image horizontally. The still-true core
  point stands: **nothing here rescales content proportionally, and
  that's the original `XYi_Adj.jsx` tool's actual behavior, not a
  porting bug** — don't "fix" it to proportionally scale without asking,
  the whole point of this tab vs. Scale Composition is that it doesn't.
  The tool page's live canvas preview (AdjustPreview) shows exactly this
  crop-vs-stretch split, generated from the field values + the active
  comp's real size.
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

**Timesheet Tracker is multi-category by explicit request** (Useful Folders
is now `categories: []` — removed from every sidebar; the home-screen flyout
calls `loadUsefulFolders` directly and never mounts the tool, so its registered
page is reachable only via search/⌘K): `categories: ["tools", "review"]` for Timesheet
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
  **Superseded 2026-08-06 — masters now come in both forms.** See "Masters
  moved to the new convention too" below; `parseMasterFilename` reads both.
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
  reachable stylesheet (shell + all 38 registered tools) into the one CSS file that
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
  "error" }` status pattern -- that's ~40 other files (`LocalisedLibrary.tsx`
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
component replaced across ~40 files.

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

## Build From CSV also on the Toolset grid (second entry point, not a new tool)
Per user request, Extreme Tools 02's "Build From CSV" button
(`extBuildCompFromCsv()`, already documented above) is now ALSO a
one-click Toolset grid entry (`ACTIONS`' `"build-from-csv"`,
`Toolset.tsx`) -- same backend function, second front door. Unlike the
Toggle By Label/Comp Duration entries below (genuinely new tools with no
prior page), Build From CSV already has a full page with 4 fields
(Page/Art/TT/Duration) -- but per the "Right logic, not just right name"
CLAUDE.md rule and the `extBuildCompFromCsv` comment itself, **Page/Art/TT
are dead parameters the backend never reads**; only Duration does
anything. That's what makes a one-click grid entry viable here without
losing functionality: the grid button's `run()` prompts for Duration only
(`promptDialog`, default "15", validated `>0`), passes empty strings for
the 3 unused fields, and lets `extBuildCompFromCsv`'s own
`File.openDialog()` handle CSV selection same as it always did -- nothing
new added to `aeft.ts`. The dedicated Extreme Tools 02 page is UNCHANGED
and still has all 4 fields for anyone who wants them visible/persisted
across multiple runs; the grid button is a faster path for the common
case (CSV already has its own Page/Art/TT baked in, only Duration varies
run to run in practice).

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

## Master Tools: Aspect Ratio buttons shifted the comp / Auto AR drifted
Real-AE report with screenshots: with an Auto AR rig on the layer, clicking
"[L] 30 Sheet" under Aspect Ratios left the content shoved outside the comp,
with the anchor point looking wrong too. TWO independent porting bugs, both
now fixed; `resizeCompositionCentered()`'s offset MATH was never the
problem (a diagnostic build that once instrumented it has been reverted).

**THE ACTUAL SMOKING GUN, found in a later session (2026-07) by comparing
the layer's Transform values side-by-side after an old-toolbox click vs an
ours click: `resizeCompositionCentered()` was silently SHIFTING EVERY
LAYER'S ANCHOR POINT by (widthOffset, heightOffset) on each resize** --
which is exactly the "anchor point looking wrong" in the original report,
and single-handedly produced the off-center content. Root cause: the port
used `layer.property("Point of Interest")` for the camera-target branch,
but **Point of Interest and Anchor Point share the same matchName ("ADBE
Anchor Point"), so that string lookup on a normal footage/precomp layer
resolves to the layer's ANCHOR POINT** and the "POI" compensation then
moves the anchor. The original `XYi_CompSize.jsx` uses attribute access
(`layer.transform.pointOfInterest`), which is falsy on non-camera layers
-- that difference is load-bearing, not style. Fixed by switching the
whole loop to `layer.transform.*` attribute access AND gating the POI
branch on `typeof layer.sourceRectAtTime !== "function"` (cameras/lights
only -- same duck-type rule motionTools.ts established). **If a port ever
needs a camera/light-only transform property, never fetch it via
`layer.property("<display name>")`** -- matchName collisions make that
resolve against the wrong property on other layer types. Projects resized
by the buggy build carry the damage baked in (anchors moved); fix by
setting the layer's Anchor Point back to its source center (e.g. 960,400
for a 1920x800 precomp) or re-doing the resize from a clean master.

1. **`MasterTools.tsx`'s preset sizes were reconstructed from the ASPECT-RATIO
   table instead of copied from the original's real button values.** This
   matters because Auto AR's rig stores ABSOLUTE layer-space pixel values in
   its Point/Slider controls, hand-tuned by an artist against the real comp
   sizes -- a right-ratio but wrong-size comp lands the content in the wrong
   place at the wrong scale.
   **Never re-derive these from an aspect ratio; they're literal sizes.**
   **SUPERSEDED (2026-07): the "correct" values this fix installed
   (30 Sheet 2416x1080, 48 2160x1080, 96 4320x1080, Extreme 8372x1080,
   Square 1080x1080, P Tall 1080x3048 -- "every landscape preset is 1080
   tall") were themselves WRONG for the studio's live toolbox** -- they came
   from a different/older `XYi_Toolbox.jsx` revision, and the user reported
   the exact same off-center symptom again with screenshots. The LIVE
   toolbox's real `ComSiz(w,h)` wiring (the "// Aspect Ratios" onClick
   block, lines ~3726-3746 of `~/Documents/XYi_Toolbox.jsx`) passes:
   [L] Square 1920x1920, Quad 1440x1080, 1920x1080, 48 Sheet 1920x960,
   30 Sheet 1920x858, 96 Sheet 5760x1440, Extreme 3840x586;
   [P] Square 1920x1920, 1 Sheet 1080x1600, 6 Sheet 1080x1620,
   1080x1920, Tall Portrait 844x2382; Extremes 1080x5760 / 5760x1920 /
   5760x1440 / 5760x1080 / 7424x448. `MasterTools.tsx` now matches these
   exactly. If this ever regresses again, re-read the live
   `~/Documents/XYi_Toolbox.jsx` onClick lines directly -- don't trust any
   remembered/documented set of sizes, including this one.
2. **SUPERSEDED -- this "fix" was itself a REGRESSION.** An earlier session
   removed the "AUTO-CENTER LOGIC" interpolation point (`[source aspect
   ratio, source center]`) from `autoArBuildExpression()` and changed the
   Extreme key to `3550/458` = 7.751, claiming both diverged from
   `XYi_AutAR.jsx`. It was diffing against the WRONG FILE:
   `~/Documents/toolset/XYi_AutAR.jsx` is the old v1
   ("AspectRig_Universal"). **The studio's live install --
   `/Applications/Adobe After Effects 2026/Scripts/toolset/XYi_AutAR.jsx`,
   header "AspectRig_Universal_v2" -- HAS the auto-center point, uses
   Extreme = 6.552901024 (= 3840/586, matching the live Extreme button)
   and 96 = 4.0 (= 5760/1440), builds BOTH [L]+[P] control sets, and drops
   [P] Square** -- i.e. our port's original behavior was right all along
   (it was ported FROM v2). Both reverted back to v2 (2026-07). **When
   diffing any tool against "the original," use the live install under
   `/Applications/Adobe After Effects 2026/Scripts/`, not the
   ~/Documents/toolset copies -- a batch diff found several other files
   that differ between the two locations too** (XYi_BuildExtCsv,
   XYi_Campaign_Scanner, XYi_Cheeky_InvT_Check, XYi_LOSCsv, XYI_Scan, and
   the toolbox itself).

**Both were "ported 1:1" claims in this file that weren't true** -- the same
class of mistake as the LOS Tools incident, and neither was findable by
reading `tools.ts` alone; both needed a line-by-line diff against
`~/Documents/toolset/XYi_AutAR.jsx` + `XYi_CompSize.jsx` and the original's
button-wiring lines. **Layers rigged BEFORE this fix still carry the old
expression baked into them** (expressions live on the layer, not in this
code) -- re-run Auto AR on them to refresh it; `autoArAddControl()` returns
existing controls untouched, so their tuned Pos/Scale values survive.
Deliberately KEPT (not reverted to the original): this port builds BOTH the
[L] and [P] control sets and interpolates over the union, where the original
built only the set matching the comp's current orientation.

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
tool pages), and had no idea `tools/Toolset.tsx`'s 27 one-click grid
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
    an unranked dump of all ~65 entries (38 TOOLS + 27 ACTIONS).
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
see the existing entries in `toolRegistry.tsx`'s `TOOLS` array for the pattern).
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
  component + one stylesheet per tool, registered in `toolRegistry.tsx`'s `TOOLS`
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
    `CATEGORY_COLORS` (`toolRegistry.tsx`) maps each category id to a
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
box (`HomeScreen.tsx`'s `.search-box-row`, `XYToolsDroplet.tsx` -- a
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
- `XYToolsDroplet.tsx` shows that `message` in the Ease tab's status
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
  structure deterministically. `XYToolsDroplet.tsx`'s
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
  (`handleCopyEase`/`handlePasteEase` in `XYToolsDroplet.tsx`) syncs
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

### Follow-up round 8: Snap Anchor was corrupting animated Position

User's question ("shouldn't this just move the anchor without touching
pre-existing animation?") pointed at a real bug in
`motionToolsSnapAnchor`, not user error. Both the anchor and position
compensation were applied via the shared `applyValue()` helper, which for
a KEYFRAMED property calls `prop.setValueAtTime(time, value)` -- that
only creates/edits the ONE keyframe at the current playhead time. Every
OTHER keyframe on Position (or Anchor Point, if ever animated) was left
at its old value, visibly distorting the rest of the animation's shape --
the layer would sit correctly at the current frame but jump/warp
everywhere else, exactly the opposite of what an anchor-point tool should
do (the whole point is the layer looks identical everywhere, not just at
the playhead).

Fix: when Position has keyframes, EVERY keyframe is now shifted by the
same rotation-compensated delta (`rdx`, `rdy` -- already computed from the
anchor's own delta, same math as before) via `posProp.keyValue(k)` /
`setValueAtKey(k, ...)`, preserving the full animated path (spacing,
easing, curve shape) just recentered around the new anchor. Anchor Point
gets the analogous treatment for consistency (set every existing keyframe
to the same new absolute anchor value, since a snap targets one location,
not a per-keyframe delta) -- animated Anchor Point is rare in practice but
was carrying the identical bug. Non-keyframed properties still use a
plain `setValue()`, unaffected. `applyValue()`/`currentOrKeyframedValue()`
remain used elsewhere in this file (Nudge, Align, Distribute, Group) where
touching only the current-time keyframe IS the correct, expected
behaviour for a one-shot nudge -- this fix is specific to
`motionToolsSnapAnchor`, not a change to those helpers themselves.
`tsc -p tsconfig-build.json` + `yarn build` clean; ExtendScript-only, no
browser-observable surface, so real-AE confirmation is still the only way
to verify (this file's usual caveat).

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

## True Comp Duplicator: froze AE solid on real projects

Real-AE report: the tool would run, then AE would lock up completely,
with an "error executing script at line N" dialog appearing only after
force-exiting -- that dialog is AE's response to killing a runaway
ExtendScript call, not a normal thrown error, which is the tell that this
was a hang, not a logic bug that surfaces a clean message.

Root cause, in `trueCompDuplicator`'s `getAllProperties` helper
(`src/jsx/aeft/tools.ts`): its `collectProperties(obj)` walked `obj`'s
children via `numProperties`/`property(i)` (correct, downward), but ALSO
called `collectProperties(obj.propertyGroup(1))` on every object.
`PropertyBase.propertyGroup(countUp)` returns the PARENT of `obj`, not a
child -- so this recursed UPWARD. Every leaf property re-visited its
parent group, which re-ran the numProperties loop over ALL of its
children (including the leaf just visited), each of which recursed into
the parent again, forever climbing back up and re-fanning-out down. For
any layer with a normal property tree depth (Transform, Effects with
their own parameters, Masks, Text, etc. -- i.e. every real layer) this is
exponential blow-up, not a slow-but-finite traversal. It would eventually
either genuinely infinite-loop or take so long AE reads as frozen --
matches the report exactly.

Fix: removed the upward `propertyGroup(1)` branch entirely. The existing
downward `numProperties`/`property(i)` walk already reaches every
descendant property on its own; the upward branch added no properties
the downward walk didn't already find, only the exponential re-traversal.
`tsc -p tsconfig-build.json` + `yarn build` clean. Pure ExtendScript
logic with no browser-observable surface (no bridge in preview) -- the
real fix can only be confirmed by running True Comp Duplicator on a
comp with a normal effects/mask/expression-laden layer in actual AE and
confirming it completes instead of hanging.

## Motion Tools Ease: generic copy/paste, Pos/Scale/Rot/Opac toggle removed

User request after round 7 fully resolved the toggle friction: "would it
be possible to make [ease copy] a global thing... not only on those 4
values but on everything -- e.g. paste Position's easing onto a Mask
Path." Follow-up: "I'd even remove those pos scale rot opac indicators
and just allow for every copy paste." Implemented directly -- the toggle
add nothing once the tool can read intent from the Timeline selection
itself, and removing it eliminates an entire class of bug this session
kept re-discovering (rounds 6-7: toggle drifting out of sync with what's
actually selected).

**Backend (`src/jsx/aeft/motionTools.ts`)** -- Easy Ease (In/Out/Both),
Copy Ease, and Paste Ease no longer take a `propertyKey` argument or look
anything up via the old `EASE_PROPERTY_NAMES` name-to-property map
(removed entirely, along with all the toggle-vs-selection reconciliation
logic from rounds 6-7 -- superseded, not layered on top of). All three now
share one new resolver:

- `getSelectedEaseTargets(comp)` reads `comp.selectedProperties` (the same
  API `motionToolsExcite` already used), filters to leaf `Property`
  objects (`propertyType === PropertyType.PROPERTY`) with `numKeys > 0`,
  and for each resolves its owning layer (`ownerLayer()`, walks up via
  `propertyGroup(1)` until it hits a `Layer`) and which keyframes to act
  on (explicit `selectedKeys`, or the nearest-to-playhead key as a
  fallback). This works on ANY animatable property -- Mask Path, an
  effect's own parameter, a Text Animator property, anything with
  keyframes -- not just the four Transform properties.
- `propertyLabel(prop)` builds a short disambiguating label for messages
  ("Mask 1 > Mask Path", bare "Position" since the ever-present
  "Transform" parent group is skipped as redundant).
- **Easy Ease** now applies to EVERY resolved target at once (was single-
  property): select Position AND Scale keyframes together, Ease Both eases
  both in one click. Properties that don't support temporal ease (Hold-
  only, text documents, markers) are individually skipped with a per-
  property try/catch around just the ease calls, reported as "(skipped:
  X -- no ease support)" rather than aborting the whole batch.
- **Copy** still requires exactly ONE property selected (a copied ease's
  dimensionality is tied to one source) -- errors asking to narrow the
  selection if more than one property has keyframes selected at once, same
  reasoning as round 6/7's ambiguity handling, just simplified since there's
  no toggle to fall back to anymore.
- **Paste** is now BATCH across every resolved target -- paste the same
  copied ease onto Position, Mask Path, and an effect slider simultaneously
  if all three have keyframes selected together, each with its own correct
  per-key dimension matching (the round-5 fix, unchanged). Also wrapped in
  a per-target try/catch so an unsupported target is skipped and reported,
  not a hard failure for the whole paste.
- Kept intact from earlier rounds: JSON-string transport for the copied
  payload (round 3's fix for the "pastes defaults" bug), the finite-number
  validation guard, the `[in x%/y · out x%/y]` diagnostic summaries, and
  the "AE kept: ..." read-back comparison in Paste's confirmation message.

**Frontend (`src/js/main/XYToolsDroplet.tsx`)** -- removed the
Pos/Scale/Rot/Opac `SegmentedToggle` and its `easeProperty` state/
`EASE_PROPERTIES` constant entirely from the Ease tab. `handleCopyEase`/
`handlePasteEase` call `evalTSSafe("motionToolsCopyEase")` /
`evalTSSafe("motionToolsPasteEase", JSON.stringify(copiedKeys))` with no
property argument; the toggle-sync logic from round 7
(`usedPropertyKey`/`setEaseProperty`) is gone since there's no toggle left
to sync. Added a one-line hint under "Easy Ease" explaining it now acts on
whatever's selected in the Timeline/Graph Editor.

**A real ExtendScript pitfall caught before it shipped**: an early draft
used `targets.some(...)` to check whether any paste target used the
nearest-key fallback. `Array.prototype.some` is NOT polyfilled in this
codebase (`shared.ts` only polyfills `indexOf`/`filter`/`map`) and isn't
native in ExtendScript's ES3 engine -- a defensive `targets.some ? ... :
false` guard would have silently and permanently evaluated to `false` in
real AE (no crash, just a feature that quietly never worked), which is a
worse failure mode than an outright error. Replaced with a plain `for`
loop. `.map`/`.indexOf` elsewhere in this change ARE safe (both
polyfilled).

Verified `tsc -p tsconfig-build.json` (clean), `tsc -p tsconfig.json`
(zero `XYToolsDroplet`/new-code errors -- pre-existing "Cannot find
name 'app'" etc. errors against `motionTools.ts` under the frontend
config are expected and unrelated, same as every prior round), and
`yarn build` (clean). Pure ExtendScript + no-bridge-dependent frontend
logic -- the actual "copy Position, paste onto Mask Path" workflow can
only be confirmed in real AE.

## Motion Tools Ease: preset library

Built on top of the generic copy/paste above, per user follow-up asking
for "a library with presets." Scoped via two questions before building:
(1) built-in-only vs. built-in + user-saveable -- chose **built-in +
user-saveable**; (2) single ease shape vs. full multi-keyframe sequence
per preset -- chose **single ease shape**, applied identically to every
target key on apply (matches how presets work in Ease and
Wizz/Keyframe Assistant).

**Backend (`src/jsx/aeft/motionTools.ts`)**:
- Refactored `motionToolsPasteEase`'s write loop out into
  `writeEaseToTargets(targets, keysSrc)` -- takes already-resolved
  `EaseTarget[]` (from `getSelectedEaseTargets`) and a `SerializedKeyEase[]`
  source, writes it onto every target key with the existing per-key
  dimension-matching and per-target try/catch, and returns
  `{touched, landedOn, skipped, keptSummary}`. `motionToolsPasteEase` now
  just parses/validates its JSON payload and calls this; preset
  application reuses the SAME function rather than a second copy of the
  write logic drifting out of sync.
- `EasePreset` interface: `{id, name, isBuiltIn, inType, outType,
  inInfluence, inSpeed, outInfluence, outSpeed}` -- a single ease shape,
  not an array of per-keyframe eases like Copy/Paste's payload.
- `BUILT_IN_EASE_PRESETS`: 6 hardcoded presets (Linear, Standard Ease
  33/33, Ease In Only, Ease Out Only, Soft Ease 15/15, Strong Ease 75/75),
  all `speed: 0` -- pure influence-based shapes, deliberately portable to
  any property/value-range (see the speed-normalization bugfix below for
  why this matters).
- User presets persist via `app.settings` (section `"XYiToolbox"`, key
  `"MotionToolsEasePresets"`, a JSON array) -- same section this studio's
  toolbox already uses for Expressions Bank (`tools.ts`) and campaign
  storage (`localise.ts`), so presets survive AE restarts on this machine.
  `loadUserEasePresets()`/`saveUserEasePresets()` wrap the
  `haveSetting`/`getSetting`/`saveSetting` read-modify-write, matching
  `localise.ts`'s existing guard pattern.
- `motionToolsListEasePresets()` returns built-ins concatenated with user
  presets. `motionToolsSaveEasePreset(name, keysJson)` takes the FIRST
  keyframe of a copied ease (Copy's `keys` payload) and stores it as a new
  named preset. `motionToolsDeleteEasePreset(id)` removes a user preset by
  id (silently no-ops if the id doesn't match anything -- there's no
  delete control on built-ins in the UI, so this is a defensive guard, not
  a reachable user path). `motionToolsApplyEasePreset(id)` looks up a
  preset by id (built-in or user), builds a single-entry `keysSrc`, and
  calls `writeEaseToTargets` -- a single source entry means
  `writeEaseToTargets`'s existing "one ease copied -> lands on every
  target key" behaviour applies the preset identically across however many
  keyframes are selected.

**Frontend (`XYToolsDroplet.tsx`/`.scss`)**: a "Presets" section below
Copy/Paste in the Ease tab -- pill-shaped chips (`.mt-preset-chip`), each
clickable to apply; user presets (not built-ins) get a small trash-icon
delete button. Presets load once on mount (`useEffect` ->
`motionToolsListEasePresets`) rather than lazily on first Ease-tab visit.
When something's currently copied (`copiedKeys` truthy), a save row
appears (name input + `BookmarkPlus` icon button) to save it as a new
preset, calling `motionToolsSaveEasePreset` and replacing the preset list
with the server's authoritative post-save list. Added a `:disabled` state
to the shared `.mt-icon-btn` class (previously undefined -- no existing
usage disabled one) for the save button's empty-name state.

### Bugfix: saved presets carried a copied keyframe's raw (non-portable) speed

Real-AE report, with screenshots: copying a 2-3 keyframe Position
animation with one very fast, spike-shaped move (~200,000 units/sec
peak on the Speed graph) and saving it as a preset, then applying that
preset elsewhere, produced a completely different, warped, asymmetric
curve -- not just a smaller/larger version of the same shape.

Root cause: `motionToolsSaveEasePreset` stored the copied keyframe's
`speed` value VERBATIM into the preset (`inSpeed: fIn.speed`). Temporal
ease has two components with very different portability:
**influence** (a %, relative to the segment -- portable to any keyframe/
property) and **speed** (an ABSOLUTE value/sec, tied to that one
keyframe's own value delta -- meaningless outside that exact context).
A preset saved from a keyframe with a huge, fast move carried that
move's huge absolute speed number into the preset; applying it to an
unrelated keyframe with a totally different value range made AE
reinterpret a wildly out-of-scale absolute velocity, producing the
warped curve in the report -- this is the SAME influence-vs-speed
portability issue flagged much earlier in this session's Copy/Paste
work (round 3-4 diagnostics), just newly relevant because a *preset*
is explicitly meant to be reusable ANYWHERE, unlike a same-property
Copy/Paste where the source and target at least share a value range.

Fix: `motionToolsSaveEasePreset` now forces `inSpeed`/`outSpeed` to `0`
when saving a user preset, keeping only `influence` (and interpolation
type) from the copied keyframe -- exactly matching how every built-in
preset was already defined. A preset is now always a pure, portable
ease SHAPE, never an absolute velocity from wherever it happened to be
copied. `tsc -p tsconfig-build.json` + `yarn build` clean. This only
affects NEWLY saved presets going forward (nothing was in a shipped,
in-use `app.settings` store yet to migrate).

## Motion Tools is now "XYTools" (rename is deliberately PARTIAL)
Renamed for branding. **Only the user-facing strings and the FRONTEND file
names changed** -- `XYToolsDroplet.tsx`/`.scss` are now
`XYToolsDroplet.tsx`/`.scss` (component `XYToolsDroplet`, panel class
`.xytools-panel`, header/trigger labels read "XYTools").

**Everything on the ExtendScript side kept its old name on purpose**: the
backend file is still `src/jsx/aeft/motionTools.ts`, every bridge function is
still `motionTools*`, and the ease presets still persist under the
`app.settings` key **`"MotionToolsEasePresets"`**. That key is live on
artists' machines -- renaming it would silently orphan every preset they've
already saved. The `mt-` CSS class prefix also stayed (pure churn to change).
**Don't "finish" the rename.** Both file headers say so at the top.

## XYTools: two new tabs' worth of features
Tab bar went from 5 to 6: Anchor, Align, **Fit**, Move, **Time** (was
"Stagger"), Ease. All four new backend functions live at the bottom of
`motionTools.ts`, follow the same conventions as the rest of that file
(active comp + `selectedLayers`/`selectedProperties`, own `beginUndoGroup`,
duck-typed `sourceRectAtTime` capability check instead of `instanceof
AVLayer`, `{success, error}` returns) and are **ExtendScript-only -- none of
them are verifiable in browser preview**, same caveat as everything else
here. All are zero master-file risk (pure in-comp edits).

- **Fit tab** -- `motionToolsFit(mode)` with `"cover"` (Fill: covers the
  frame, crops the overflow), `"contain"` (Fit: sits inside it), `"stretch"`
  (exact comp size, distorts -- same deliberately non-proportional behavior
  Adjust has). Measures the layer's own content rect via the existing
  `getContentFrameRect()` (so a precomp uses its own frame, not its bleed --
  the bug already fixed for the anchor tools) and **re-centers the layer in
  the comp**, since fitting without centering leaves it scaled but parked
  where it was. Built for this studio's actual daily job: retargeting one
  creative across a dozen DOOH sizes. Rotation ignored (same axis-aligned
  assumption align/distribute make).
- **Flip** (also Fit tab) -- `motionToolsFlip(axis)` negates one Scale axis.
  **Flips around the ANCHOR POINT with no position compensation** -- that's
  AE's own behavior for a negative scale and the expected result; silently
  re-centering it would be the surprise. The hint text points at the Anchor
  tab for setting the pivot first.
- **Reverse Keyframes** (Time tab) -- `motionToolsReverseKeyframes()` mirrors
  each property's keys about the span they already occupy (first and last key
  stay put), so the animation plays backwards without moving in the timeline.
  Acts on `comp.selectedProperties` if anything's selected there, else falls
  back to every animated property on the selected LAYERS via
  `collectAnimatedProps()`. **That helper walks the property tree DOWNWARD
  ONLY** -- deliberately: adding a `propertyGroup(1)` step (which returns the
  PARENT, not a child) is exactly what froze AE solid in True Comp Duplicator
  (see that section above). Never reintroduce an upward step there.
  Interpolation types, temporal eases, and spatial tangents are all carried
  across and **swapped per key** (a key's in-ease becomes its out-ease), which
  is what makes the reversed curve actually mirror the original instead of
  keeping the same acceleration pointing the wrong way. Roving/edge-key writes
  are individually try/caught (AE throws on roving the first/last key).
- **Trim In/Out to playhead** (Time tab) -- `motionToolsTrim(edge)`, i.e.
  AE's Alt+[ / Alt+] from the panel. Skips (and reports) any layer whose span
  doesn't contain the playhead rather than letting AE throw on an inPoint past
  its outPoint.

## DeliveryHub: auto-load after Delivery, optional MB, matching field order
Three changes, all from direct studio feedback on real use.

- **The Delivery button now loads the comps it just created straight into the
  checklist below** -- previously you clicked Delivery, then went back to the
  Project panel, re-selected those same new comps, and clicked Load. `delivery()`
  (`deliver.ts`) now returns `compIds` (the ids of the comps it made -- purely
  additive; it returned a bare `{success}` before), and DeliveryHub feeds them to
  the new **`deliveryChecklistLoadCompsByIds(ids)`**. **Ids, not the selection**:
  `delivery()` calls `openInViewer()` per comp and the user can click elsewhere
  before the round-trip lands, so re-reading `app.project.selection` afterwards
  would be a race. `deliveryChecklistLoadComps()` and the by-ids variant share
  `deliveryDetectTerritoryCode()` + `deliveryBuildCompEntry()` so both build
  identical rows rather than two copies that drift.
  - Rows are **APPENDED, not replaced** (`appendComps()` in DeliveryHub.tsx),
    deduped by comp id -- clicking Delivery must not wipe rows already loaded and
    configured. It counts the additions from the `rows` closure, NOT inside the
    `setRows` updater: React runs updaters lazily, so a count taken in there is
    still 0 by the time the caller reads it (this was written the wrong way first).
- **A target size (MB) is no longer required to queue.** An empty MB row now
  renders at **`DELIVERY_DEFAULT_MBPS = 26`** (`deliver.ts`) -- a real value in
  `DELIVERY_TEMPLATE_BITRATES_MBPS`, so it always resolves to an actual
  `H264_26MBPS_MOS` template. `deliveryChecklistQueue`'s `sizeMB` is now
  `number | null` (optional, not removed -- the dead `DeliveryChecklist.tsx`
  still passes a plain number and still type-checks). A per-row **Mbps cap still
  outranks the default**, exactly as it already outranks a size-derived bitrate.
  The queue log says which of the two paths a row took. DeliveryHub mirrors the
  value as `DEFAULT_MBPS` purely to label the preview ("26 Mbps" instead of a
  blank tag where the MB tag would be) -- **keep the two literals in step**;
  only the ExtendScript one actually decides the render.
- **The bulk bar's fields are reordered to MB -> fps -> ≤ Mbps, matching the
  row order.** They used to be MB -> ≤ Mbps -> fps, so the bulk field you aimed
  at never sat above the row field it fills.

## RailScreen (Tools/Localise category screens) -- not previously documented here
`screens/RailScreen.tsx` is a shared component powering `ToolsScreen.tsx`
(the "Tools" category's real screen -- a grouped VERTICAL rail: workflow
stages like "Size & Format"/"Layers & Rigging"/"Utility"/"Scripting" on the
left, the selected tool full-width on the right). It superseded the older
generic `CategoryScreen.tsx` master-detail screen for Tools at some earlier
point in this project's history, but that supersession was never written up
here -- worth knowing so a future session doesn't assume `CategoryScreen.tsx`
is still live for any category (per ITS OWN header comment, it currently
isn't -- kept only as a fallback for a hypothetical future category with no
bespoke design yet). **LocaliseScreen does NOT use RailScreen** -- it's a
separate bespoke landing (two big cards + a flat "Utilities" grid), so
everything below is Tools-only today even though RailScreen itself is
written generically (keyed by `categoryId`) in case that changes.

## Toolset edit mode: "emphasise" (star) a tool
Alongside hide/reorder/move/rename, each edit-mode tile has a SECOND badge
at its top-RIGHT (mirroring the top-left hide minus): a star that flags a
tool as one the user reaches for constantly. Purely visual -- it never
filters, moves or reorders anything, so it composes with the other edit-mode
state instead of competing with it. A starred tool renders in normal mode
wearing its group accent AT REST (filled `--btn-bg` background, accent
border, white bold label) instead of only on hover, so a handful of
constantly-used tools pop out of a dense grid while eye-scanning.
- The extra ring is an **inset box-shadow, not a thicker border** -- a
  border-width change would resize the tile and nudge every tile after it in
  the wrapped row.
- Persisted per-machine as `"OVToolsetStarred"` (`shell.ts`'s
  `load/saveStarredToolsetActions`, same tab-separated `app.settings`
  convention as hidden/order/groups/pinned) and included in team.ts's
  `PROFILE_KEYS`, so it travels with a member's profile.
- `unpinLink()` clears an unpinned link's star for the same reason it clears
  its order/group entries -- nothing to restore to.
- **The badge's own CSS must be scoped `.action-edit-face .action-star-btn`,
  not a bare `.action-star-btn`.** Edit tiles sit inside `.action-grid.editing`,
  and `Toolset.scss`'s `.action-grid button { padding: 8px 14px; gap: 6px;
  background; color }` rule is MORE specific (0-2-1 vs 0-2-0) -- it won, the
  badge inherited the grid button's padding, and the 13px star got squeezed
  out of the fixed 20px circle so the badge shipped visibly EMPTY. The
  neighbouring hide badge hides the same problem because its dash is a
  CSS-drawn absolutely-positioned `::after`, not the lucide icon -- which is
  also why both badges render as a DARK disc with a light glyph rather than
  the light disc their declarations ask for. The star badge deliberately
  matches that rendered result (dark disc, grey star, gold when on) rather
  than its sibling's stated intent.
- The star badge is hidden on an already-hidden tile (nothing to emphasise),
  and edit mode previews the emphasis on the tile face itself so starring
  gives feedback without leaving edit mode.
- **Not visually verified in a real panel yet** -- typechecks + builds clean
  and the two new bridge names resolve in `dist/cep/jsx/index.js`, but the
  look wants a real-AE (or dev-server) glance.

## RailScreen edit mode: hide tools, move between stages, reorder -- same
## long-press system as the Toolset grid
Per direct request: bring the Toolset grid's long-press "hold until it
jiggles" personalisation system to the Tools rail too -- hide a tool you
never use, drag a tool into a DIFFERENT stage group (its "category" within
Tools), reorder within/across stages, rename a stage's label. Implemented
as a close mirror of `tools/Toolset.tsx`'s existing edit mode (hidden/
groupOverride/labelOverride + dnd-kit DndContext spanning every group +
DragOverlay), adapted from a wrapping tile grid to a single-column vertical
rail -- see `RailScreen.tsx`'s own header comment for the state shape.

- **Long-press a row's icon/label is the ONLY entry point** -- no visible
  "Edit" button in normal mode, matching Toolset's own choice (the Done bar
  only exists while `editMode` is true). Same 500ms timer + Pointer/Mouse
  dual-handler + `guardClick` swallow-the-post-longpress-click pattern,
  copied verbatim from Toolset.tsx's reasoning (AE's CEP panel doesn't
  reliably fire Pointer Events' press-and-hold, and a stale timer left
  ticking after a quick click can otherwise pop edit mode open on its own
  ~500ms later -- `guardClick`'s unconditional `endPress()` call is the
  actual fix, the dedicated up/leave handlers are just the fast path).
- **Reordering reuses the EXISTING `useToolOrder` hook/`saveToolOrder`
  bridge call unchanged** -- no new order storage. Only two genuinely new
  pieces of state were needed: which tools are hidden, and which stage a
  tool effectively belongs to (`stageOverride`) -- both keyed by
  `categoryId` and persisted via three new `shell.ts` function pairs
  (`loadAllRailHidden`/`saveRailHidden`, `loadAllRailStages`/
  `saveRailStages`, `loadAllRailLabels`/`saveRailLabels`), one JSON blob
  per key covering every category's map in one round trip (same
  "load everything once" shape as `loadAllToolOrders()`). **JSON, not the
  tab-separated convention most of `shell.ts` otherwise uses** -- a stage
  override genuinely needs a `toolId -> stageId` map per category, and
  this codebase already has JSON-in-`app.settings` precedent
  (motionTools.ts's ease presets), so it reuses that rather than inventing
  a fourth ad hoc delimiter scheme.
- **A synthetic `"more"` stage is ALWAYS rendered while editing**, even
  when currently empty, so a tool can be dragged into (or entirely out of)
  the auto-generated "leftover tools with no explicit stage" bucket the
  normal (non-edit) render already had -- same "fixed group list, not
  conditionally rendered" approach Toolset.tsx's `GROUPS` takes for its own
  "custom" group.
- **Jiggle keyframe moved out of `Toolset.scss` into `shared.scss`**
  (`ov-jiggle`, was `toolset-jiggle`) since RailScreen's edit-mode rows now
  use the identical animation -- avoids a second, drifting copy of the same
  four lines. Same "jiggle lives on an INNER face element, never the
  outer draggable wrapper dnd-kit itself drives via inline transform"
  split both files independently arrived at, now explained once in the
  shared keyframe's own comment.
- **`DragOverlay` portals to `document.body`, outside `.rail-hub`'s own DOM
  subtree** -- the `--cat-*` custom properties `categoryStyleVars()` sets
  on `.rail-hub` don't cascade into a portaled subtree, so the dragged
  row's floating copy explicitly re-applies `categoryStyleVars(categoryId)`
  as its own inline style rather than relying on inheritance (same fix
  category this app's other portal-based pieces, e.g. Tooltip/Droplet,
  already needed for the same reason).
- **A hidden tool can still be opened via direct search/⌘K/a deep link** --
  hiding only removes it from the rail's own row list; `selectedTool` is
  looked up against the full unfiltered `ordered` list, not the
  hidden-filtered `flat` one used for the rail's own rendering and
  fallback-select-first-tool logic.
- **Deliberately did NOT touch `CategoryScreen.tsx`** -- it's the generic,
  currently-unused fallback screen (see the RailScreen section just above),
  and the user's request was specifically about the Tools page. If a
  future category ever gets routed through `CategoryScreen.tsx` for real,
  it would need this same treatment built separately (its drag mechanism
  is Framer Motion's `Reorder.Group`, not dnd-kit, so it isn't a drop-in
  port of this implementation).

## Home cascade replays ~1-2s after cold start (GsapScreenTransition dedup)

Real-AE report: "I open the toolbox, it comes in. After 1-2 seconds
(without touching anything) it does the homepage cascading animation
again." A previous session had already added a de-dupe to
`GsapScreenTransition` (module-scope `lastAnimatedKey` + a
`DUPLICATE_MOUNT_WINDOW_MS = 1500` timer) for the CEP host's cold-start
double-mount, plus the `screenKey` prop and `main.tsx`'s module-scope
`persistedScreen`. It did not fix this symptom, and briefly chased an
"async data load re-triggering an entrance animation" theory.

Diagnosis (that theory was a wrong turn): a Framer/GSAP entrance animation
cannot replay without a **remount** or a React `key` change. On home,
`main.tsx`'s `screenKey` is the constant `"home"` and never changes, and
nothing in HomeScreen/Toolset feeds an async-loaded value into a React
`key` (every key is a static id -- `category.id`, `action.id`,
`favoriteKey`, etc.; async loads of theme/order/hidden/pinned only
re-order or filter already-mounted, stably-keyed elements, which React
reconciles without remounting, so Framer's `initial` never re-fires). So
the re-cascade is necessarily a **remount of the whole tree** -- i.e. the
already-documented CEP cold-start double-mount (React root created twice
in the same JS realm) -- just landing 1-2s in on this machine, **past the
1500ms window**, so `now - lastAnimatedAt < 1500` was false and the enter
animation replayed on already-visible content.

Fix (`GsapScreenTransition.tsx`): **removed the time window entirely**;
dedupe now purely on key equality -- skip the enter animation iff
`!exit && screenKey != null && screenKey === lastAnimatedKey`. The timer
was only ever a fragile proxy for "is this the double-mount" (how slow can
a cold start get? unknown -- 1500ms guessed too low). Key equality answers
that directly and is provably safe: every genuine navigation changes
`screenKey` and animates its target (home -> category -> home animates
each hop, because "category" is recorded as `lastAnimatedKey` in between,
so the return to "home" no longer matches) -- therefore a mount whose key
still equals the last-animated key can only be a re-display of the current
screen with no navigation since, which is exactly and only the
double-mount. Reopening the panel is a fresh JS realm that resets the
module var to `null`, so a genuine reopen still animates. Removed
`lastAnimatedAt` and `DUPLICATE_MOUNT_WINDOW_MS`.

### Follow-up: it also replays on FIRST HOVER, and the state is not a plain module var

Second real-AE report after the timer removal: "it loads and does the
animation fine, but the first time I hover a button in the session it
replays the entrance." Investigated exhaustively in browser preview and
**could not reproduce** -- with instrumentation (MutationObserver on
`.home-screen` subtree styles) there were ZERO style mutations / remounts
from: a real `prefetchTool` chunk load (the offline hover-prefetch on
search cards + the existing category-card `onHoverStart` prefetch),
synthetic hover/pointer events, or synthetic `focus`/`visibilitychange`/
`pageshow`. Also ruled out: chunk-load GSAP side effects (the local
`gsap/index.ts` barrel that calls `registerPlugin(ScrollTrigger)` is
imported by NOTHING -- dead code; every gsap component imports raw
`"gsap"`), and Suspense (none on the home screen). So it is a real-AE
CEF-host rAF/visibility/reload behaviour that a normal (even hidden)
browser tab doesn't exhibit.

Mechanism narrowed decisively though: on home the GSAP transition animates
the **whole container** (`tl.to(container, {opacity:1, y:0})`), so "the
entrance replaying" = that enter effect re-ran, and that effect only runs
on **mount** (its deps don't change on hover). So the real-AE re-trigger
is a mount -- a remount OR a full document reload -- happening on first
interaction rather than at a fixed delay (which is also why the earlier
1500ms timer couldn't catch it: the first hover can be much later). The
key-equality dedupe above already handles a React remount (module var
survives within one JS realm). The gap it left: a full CEF **reload /
re-navigation** wipes module state, so `lastAnimatedKey` resets to null
and the guard misses it.

Hardening (`GsapScreenTransition.tsx`): the last-animated key is now
persisted in **`sessionStorage`** (key `"xyi.gsapLastAnimatedKey"`), read
through a module-var cache, instead of a bare module var. sessionStorage
survives a same-origin reload but is empty for a genuinely fresh panel
open (new session) -- exactly the boundary wanted: suppress the spurious
cold-start replay (whether it arrives as a React remount OR a full
reload), still animate a real first open. Wrapped in try/catch (falls back
to the module cache if a CEF config blocks sessionStorage). `get
LastAnimatedKey()`/`setLastAnimatedKey()` replace the bare variable.

Verification: `tsc` + `yarn build` clean. The hidden-tab/frozen-rAF limit
was turned into the actual test -- the skip path sets
`container.opacity = "1"` immediately while the animate path sets `"0"`
(which stays frozen with rAF dead), so container opacity after load
reports which path ran. Confirmed all three cases in preview by driving
real reloads: (A) fresh session (storage cleared) -> **animate** path
(opacity `0`) and it records `"home"`; (B) same-key reload (storage
`"home"`, i.e. the CEF replay case) -> **skip** path (opacity `1`,
transform `none`, shown immediately, no re-cascade); (C) real navigation
home -> Tools -> **animate** path (opacity `0`) and records
`"category:tools"` (no regression). The "no longer replays on first hover"
outcome itself is host-specific and still needs a real-AE confirm -- but
the dedupe now covers both the remount and full-reload mount paths, and a
same-key reload was proven deduped.

## Quick FX ("Effects" tool) — review pass improvements

The Effects tool (`tools/QuickFX.tsx` + `quickFxData.ts`, backend
`jsx/aeft/effects.ts`) one-click-applies a curated list of AE effects by
stable `matchName` to the selected layers, with a "My Combos" section for
recording a layer's whole effect stack and re-applying it. Architecture is
the same generic-action + data-list split as Toolset's ACTIONS. This pass
addressed a review of it:

- **Combos now capture parameter VALUES, not just the effect list** (the
  headline fix). `quickFxGetSelectedLayerEffects` records each effect's
  settings via `captureEffectProps()` — a depth-first walk of the effect's
  leaf properties, keeping `{matchName, value}` for each settable static
  value. Skips: NO_VALUE/CUSTOM_VALUE params (headers, the Curves curve
  shape — no scriptable setValue), LAYER_INDEX/MASK_INDEX (an index that
  means nothing in another comp), and anything keyframed or
  expression-driven (a combo is a static look; setValue would also nuke the
  animation). `quickFxApplyCombo` restores them via `applyEffectProps()`:
  positional zip against the same filter onto the freshly-added effect
  (identical matchName ⇒ identical property tree), with a matchName guard
  that stops on the first mismatch (AE-version structure drift) rather than
  writing a value into the wrong slot. `EffectComboEffect.props` is
  OPTIONAL, so combos saved before this land still load and re-apply (at
  defaults, exactly as before). Known limitation: CUSTOM_VALUE params
  (Curves shape, some LUT/histogram data) can't be scripted, so those
  aren't carried.
- **matchName self-check.** **SUPERSEDED mechanism**: originally added +
  immediately removed every curated matchName on a selected layer; once
  `app.effects` landed, `quickFxVerifyMatchNames` was REWRITTEN as a pure
  membership check against AE's own installed-effects registry (instant,
  no layer/selection/undo group needed) and widened to also cover pinned
  My Effects and every recorded combo's effects — the real staleness risk
  (a third-party plugin uninstalled after pinning/recording). Curated
  entries still arrive as a JSON string so `quickFxData.ts` stays the
  single source of truth; user effects + combos are read from settings
  backend-side.
- **Effect reveal.** `applyEffectToSelectedLayers` now sets the just-added
  effect `.selected = true` (own try/catch, best-effort) so AE highlights
  it in Effect Controls instead of leaving you to hunt for it.
- **undo-group guard.** `applyEffectToSelectedLayers` / `quickFxApplyCombo`
  / the new verify fn only call `endUndoGroup()` in their catch if a group
  was actually begun (`undoOpen` flag) — the early comp/selection returns
  happen before `beginUndoGroup`.
- **Frontend polish.** Status line auto-dismisses after 4s (was lingering
  indefinitely, unlike the Toolset toasts); per-pill disable (`busyId ===
  fx.id` / `comboBusyId === combo.id`) instead of disabling the whole grid
  during a near-instant apply; `errorMessage()` surfaces a real
  ExtendScript rejection verbatim while still mapping BOTH the "no bridge"
  sentinel AND the raw `evalScript` TypeError (no `window.__adobe_cep__`) to
  the clean bridge message; search now also matches `matchName`; combo hints
  updated to say settings ARE saved.
- **Grid droplet: persistent "Open Effects page…" link.** In
  `Toolset.tsx`'s `QuickFxRecentDropletBody`, that link used to show only in
  the empty state, so once you had recents there was no way to reach the
  full curated list from the droplet. It's now a permanent footer whenever
  the bridge is present.

Verified: `tsc -p tsconfig-build.json` (clean) + `tsc -p tsconfig.json`
(no QuickFX/Toolset errors — `effects.ts`'s ambient-globals noise under the
frontend config is expected, same as `motionTools.ts`) + `yarn build`
clean. Browser preview confirmed the Effects page renders (5 sections, 20
pills, verify button), matchName search filters correctly, and the
no-bridge path shows the clean message not a raw TypeError. The actual
effect-apply / value-capture / value-restore is ExtendScript-only and
needs a real-AE pass (record a tuned-look combo, re-apply elsewhere,
confirm the settings come across; run the verify button once to confirm
the curated matchNames).

## Team features batch: Team Folder, profiles, update nudge, shared
## libraries, render-finished toasts, Pre-Flight
Six features built in one approved batch (user picked all four proposals,
then added profiles on top). All frontend surfaces verified in browser
preview (fiber-injected state where the bridge is absent); every
ExtendScript half carries this file's usual "needs a first real-AE pass"
caveat. `tsc -p tsconfig-build.json` + `yarn build` clean, single-chunk
property intact, and a full forward wiring audit (all 17 new evalTS names
resolve in the compiled `dist/cep/jsx/index.js` AND are called from
`src/js`) was run per this file's own audit rule.

- **`src/jsx/aeft/team.ts` (new) -- the Team Folder foundation.** One
  user-picked folder on the NAS (persisted per-machine under
  `"TeamFolderPath"` -- deliberately NOT part of a profile) holding
  `profiles/*.json`, `shared-combos.json`, `shared-expressions.json`, and
  `toolbox-version.txt`. An unmounted share returns null internally and
  every feature degrades quietly -- a laptop away from the studio is a
  normal state, not an error.
- **Profiles** -- named snapshots of every personalisation setting, so an
  artist applies THEIR whole setup on any machine (the direct ask: "she
  could toggle her name and have her preferences applied"). `PROFILE_KEYS`
  in team.ts is the canonical list (Toolset hidden/order/groups/labels/
  pins, rail state, tool orders, favorites, theme+decorations, sfx,
  pinned effects, combos, ease presets, custom tools). **Values are
  snapshotted/restored as OPAQUE STRINGS** -- team.ts never parses a
  store's own format, which keeps it robust as stores evolve. **Applying
  resets keys the profile doesn't carry to `""`** (every loader treats
  empty as default) so the previous user's customisation can't bleed
  through, then the frontend does `window.location.reload()` --
  GsapScreenTransition's sessionStorage dedupe keeps that reload from
  replaying the entrance cascade. **SECURITY: profiles land in a SHARED
  folder -- `WrikeApiToken` (a secret) is explicitly excluded from
  PROFILE_KEYS, as are content libraries (campaigns/LocLib), UsefulFolders
  (machine paths + ScriptUI-shared), and usage history. Keep any future
  credential-bearing setting out of PROFILE_KEYS too.** If a new
  personalisation setting is added to the app, add its key to
  PROFILE_KEYS or it silently won't travel with profiles.
- **UI: `TeamDroplet.tsx`/`.scss`** -- a Users icon in the home search row
  (same droplet pattern as SfxDroplet), gathering folder setup, the
  profile list (apply = confirmDialog naming the consequence -> apply ->
  reload; per-profile delete), save-as row, the update banner, and the
  sync note. Version/sync checks run ONCE per session via module-scope
  guards (home remounts must not re-scan the NAS or re-toast). The
  update nudge is a static yellow dot on the trigger -- deliberately not
  pulsing, per this file's "no perpetual motion on the always-visible
  home screen" rule. Version comparison is plain string inequality +
  lexicographic greater-than against `TOOLBOX_VERSION` (exported from
  TeamDroplet.tsx -- **keep in step with HomeScreen's version text**);
  fine for the zero-padded `YYYYMMDD` format.
- **Shared libraries (combos + expressions)** -- pull: `teamSyncShared()`
  on panel open merges new entries from the shared files into the local
  stores (merge by NAME case-insensitive, imported combos get fresh ids
  -- same rules as quickFxImportCombos). Push: **opt-in per item**, a
  Users-icon "Share to team" button per combo pill (QuickFX.tsx) and per
  expression row (ExpressionsBank.tsx) -- deliberately NOT a blind
  bidirectional whole-store sync, so scratch content doesn't flood the
  team and local deletions don't resurrect. effects.ts's
  `loadCombos`/`saveCombos` were exported for this;
  `expressionsBankLoad`/`expressionsBankSave` already had JSON-string
  interfaces team.ts reuses (no format duplication). Custom tools keep
  their existing file export/import; extend team-sync to them later if
  asked.
- **Render-finished toasts (DeliveryHub)** -- after Queue succeeds,
  `startRenderWatch()` polls `renderWatchSnapshot()` (deliver.ts, read-
  only queue snapshot) and toasts each watched item the moment it's DONE:
  comp name, destination folder, fps, real on-disk MB, and EFFECTIVE
  Mbps computed from actual file size/duration (what the template
  produced, not the requested target). **Raw `evalTS`, deliberately not
  `evalTSSafe`**: bridge calls BLOCK while AE renders, so one poll can
  take the whole render -- that resolving IS the finish signal; a 15s
  timeout would misreport every long render as "AE busy". Long-lived
  toasts (15s) + `sfx.success()`. Watches only items queued/rendering at
  Queue time (old DONE items never re-toast); stops when none pending, on
  unmount, or a 4h cap. **Known limit, stated in the queued toast
  itself: leaving the Deliver page stops the watch** (the component owns
  it) -- promote to a global watcher only if that bites in practice.
- **Pre-Flight (`src/jsx/aeft/preflight.ts` + a `qc`-group Toolset
  button)** -- read-only audit of the open project before handover/
  render: missing footage (`footageMissing`), **effects used anywhere in
  the project vs THIS machine's `app.effects` registry** (the novel
  check -- a third-party plugin missing on the receiving machine
  otherwise fails silently at render), and fonts BEST-EFFORT behind a
  feature gate (`app.fonts.getFontsByPostScriptName`, newer AE only,
  UNVERIFIED -- older AE reports "fonts not checkable" rather than
  pretending they passed). `Pseudo/*` matchNames (expression controls
  saved into projects) are skipped as known-benign. Report renders via
  `alertDialog` (a report wants to be held open, not auto-dismiss in a
  toast); the run() returns `null` after, per the "already reported, no
  toast" convention.
- **Correction that enabled half of this batch**: an earlier session
  claim that "no API exists to enumerate installed effects" was WRONG --
  `app.effects` is exactly that (QuickFX's search-all, the verify
  rewrite, and Pre-Flight's missing-effects check all build on it). The
  corrected headers live in effects.ts/QuickFX.tsx; the lesson (verify
  API capability claims against docs/probes before writing them into
  comments as fact) is recorded in auto-memory.

First-real-AE checklist for this batch: set the Team Folder, save +
apply a profile between two machines, drop a `toolbox-version.txt` and
confirm the dot, share a combo/expression and watch it arrive on
another machine's panel open, queue a real render and wait for the
finished toast's numbers, and run Pre-Flight on a project with a
known-missing footage item + a third-party effect.

### Real-AE round 1 refinements (first office install on the NAS Mac)

Four things surfaced installing on the real office Mac; all fixed.

- **Pre-Flight said "everything installed" while Effect Controls clearly
  showed "Missing: UnMult".** The registry-only check (matchName not in
  `app.effects`) was a real FALSE NEGATIVE: a missing-effect placeholder's
  matchName can read empty or as a registered placeholder depending on AE
  version, so it slips the `!installed[matchName]` test. **Fix
  (`preflight.ts`): flag an effect missing if EITHER its display name
  starts with `"Missing:"` (AE's own placeholder rename -- the
  authoritative signal, exactly what Effect Controls shows) OR its
  matchName isn't in the registry.** Also moved the try/catch to
  PER-EFFECT (was per-layer, so one unreadable placeholder silently
  skipped every remaining effect on that layer) and made the report key
  off name when matchName is blank. **If Pre-Flight ever again passes a
  project with a visibly-missing effect, the `"Missing:"` prefix is the
  check to trust first** -- AE localises effect display names but this
  placeholder prefix has held; if a non-English AE ever shows a
  translated prefix, add it alongside `"Missing:"` here.
- **"Share to team" on an Expressions Bank entry said "Expression not
  found."** The 20 built-in templates live only in the frontend
  (`ExpressionsBank.tsx`'s `MOCK_ENTRIES`) and are never written to
  `app.settings` until the user edits one -- so `teamShareExpression`'s
  id-lookup in the persisted store couldn't find a template. **Fix:
  `teamShareExpression` now takes the FULL entry as a JSON payload
  (`entryJson`), not an id -- the frontend already holds everything the
  shared file needs.** Same lesson applies to any future "share this
  built-in thing" action: pass the payload, don't assume it's persisted.
- **Expressions Bank load now MERGES templates with stored entries**
  (stored wins by name) instead of "stored replaces templates." Needed
  because team-sync can now populate an otherwise-empty store in the
  background, and the old rule made one synced entry hide all 20
  templates. `teamSyncShared` writing into the store no longer erases the
  built-ins from the list.
- **Profiles are now MEMBER SUBFOLDERS, not a flat `profiles/` dir**
  (v2 layout, direct request: pre-create `Antonio/`, `Aaron/`, `Maria/`,
  `Turk/`, `Luke/`, `Jacqui/`, `Nicholas/` as the roster). Each member is
  a subfolder of the team folder; their snapshot is `<member>/profile.json`.
  `teamListProfiles` enumerates subfolders (excluding `_`-prefixed and the
  legacy `profiles/`), returning `{name, hasProfile}` -- a pre-created
  folder with no `profile.json` yet lists greyed/disabled with a "no setup
  yet" tag (roster visible up front). `teamApplyProfile`/`teamDeleteProfile`
  now take the MEMBER NAME, not a filename. **Legacy flat
  `profiles/<name>.json` from v1 is still READ as a fallback** (apply +
  list) so nothing already saved orphans, but saving always writes the
  member-folder layout. Delete removes only the snapshot, never the member
  folder (it's their home for any future per-member data, and may be
  studio-pre-created). The member folder is created automatically by "Save
  current setup as" if it doesn't exist.
- **Theme IS in a profile** (asked directly): `OVTheme` +
  `OVThemeDecorations` are in `PROFILE_KEYS`, so applying a member's
  profile carries their theme too.

### Real-AE round 2: every member stuck on "NO SETUP YET" (NAS path quirk)

Installed on the office Mac (team folder ON the NAS): every member row
showed "NO SETUP YET" even though `Antonio/profile.json` plainly existed
in Finder -- so nobody's setup was ever loadable. Root cause was **how
`profile.json` was detected, not whether it existed**. Two ExtendScript
path forms are unreliable over a network-mounted folder and the code used
BOTH: `folder.getFiles("profile.json")` (a STRING MASK) and
`new File(folder.fsName + "/profile.json").exists` (a stat on a
RECONSTRUCTED path). A first fix attempt tried them as an OR and still
failed -- because both forms are the flaky ones.

**The reliable signal: `folder.getFiles()` with NO mask** -- the exact
same call that DOES reliably enumerate the member folders under the root.
Fix (`team.ts`): `folderProfileFile(folder)` lists the folder with no
mask and name-matches `profile.json` (case-insensitive), returning the
`File` straight from that listing; `memberFolderByName(name)` resolves a
member name by matching the root listing (not a reconstructed path). List
(`teamListProfiles`), apply (`teamApplyProfile`), delete
(`teamDeleteProfile`), AND save-folder-reuse (`teamSaveProfile`) all now
go through these. The reconstructed-path stat stays only as a last-resort
fallback. **Lesson: over a NAS mount, prefer `getFiles()` (no mask) +
manual name compare over BOTH string-mask `getFiles(mask)` and
`new File(fsName + "/name").exists` -- both of the latter proved flaky
here.** ExtendScript-only, so confirmed by build + logic; needs the
real-NAS Mac to verify. Fast diagnostic if it ever recurs (paste into
Script Playground): list the team folder root, and for each child folder
list `getFiles()` -- shows exactly what the scan sees vs what's in Finder.

## "Workspace follows you": machine ownership, guest sessions, live sync

Follow-up to the Team profiles batch above, picking up a parallel
session's open design question ("identity-aware auto-load? live profile
sync? adaptive frequently-used?"). The user's answer reshaped it: everyone
has their OWN station (used 99% of the time) and occasionally hops onto a
colleague's Mac. That kills the value of OS-username detection on open
(your own Mac's local settings already ARE your setup; and hop-ons may
share the host's OS session, so `system.userName` can't identify a guest
anyway) -- what actually matters is making the occasional guest hop
**fresh going in and safe coming out**. Deliberately NOT built:
`system.userName`-based suggestions, and the adaptive "frequently used"
cluster (speculative, layout-shifts-under-you risk; the parallel session
itself flagged it as hold-unless-keen).

Three per-MACHINE local settings (never in PROFILE_KEYS -- a profile must
not carry another machine's ownership tag or backup), in `aeft/team.ts`'s
new "Machine ownership / guest sessions" section:
- `TeamMachineOwner` -- member name this station belongs to. Tagged once
  via a Home icon on each member row in TeamDroplet (grey = untagged,
  teal = this station's owner; clicking the owner's own icon untags).
- `TeamPreGuestBackup` -- **guest-safe apply**. `teamApplyProfile` now
  snapshots the machine's current PROFILE_KEYS into this local key before
  the FIRST non-owner apply (back-to-back guest applies keep the ORIGINAL
  backup, only updating the displayed guest name); applying the tagged
  owner's own profile clears the backup instead (owner reclaiming their
  machine ends the guest session). While a backup exists the Team trigger
  shows a teal dot and the droplet a banner -- "Using <guest>'s setup on
  <owner>'s Mac" -- with one-click `teamRestoreLocalSetup` (writes the
  backup values back over every PROFILE_KEY, clears the backup, reloads
  the panel). The old apply-confirm's "save your setup first!" warning is
  gone -- backup is automatic now, and the dialog says so.
- `TeamLiveSync` -- opt-in toggle (shown only when the machine is tagged):
  `teamAutoSyncProfile` runs once per session from TeamDroplet's existing
  mount block and silently pushes this station's setup to the owner's NAS
  profile, so the snapshot a colleague's machine applies is always the
  latest (effectively "as of end of last session", since settings persist).
  Every skip path returns success with no message (a laptop off the studio
  network must never toast an error). **CRITICAL guard**: it never syncs
  while a guest backup is active -- that would overwrite the owner's NAS
  profile with the GUEST's setup.

Restore-vs-absent-keys note: `app.settings` has no delete API, so keys the
backup recorded as absent are restored as `""` -- every loader in this app
already treats an empty string as its default/empty state (same convention
`teamApplyProfile` has always relied on for keys a profile doesn't carry).

Verified `tsc -p tsconfig-build.json` (clean; frontend-config noise on
team.ts is the usual ambient-globals state) + `yarn build` clean. The
whole flow is app.settings/NAS-side, so the real pass needs AE: tag a
machine, save/apply a colleague's profile, confirm the banner + restore
round-trips the original setup, and confirm live sync updates
`<member>/profile.json`'s savedAt on panel open.

### Fix: "NO SETUP YET" never cleared + per-person member colours

Two follow-ups after real-AE testing of the profiles roster:

- **`hasProfile` false-negative over the NAS.** A member folder plainly
  containing `profile.json` (confirmed in Finder) still showed "NO SETUP
  YET" forever. Root cause: `teamListProfiles` decided `hasProfile` via
  `new File(item.fsName + "/profile.json").exists`, and that reconstructed-
  path stat proved unreliable on a network-mounted team folder (encoding /
  separator / NAS-cache quirks -- the same class of ExtendScript-filesystem
  gotcha this project keeps hitting). Fixed with `memberHasProfile(folder)`:
  checks `folder.getFiles(PROFILE_FILE_NAME).length > 0` FIRST (reads the
  OS's own directory listing, reliable over a mount) and keeps the
  `.exists` path as a fallback OR. Also: `teamAutoSyncProfile` can CREATE
  the owner's profile.json on first run of a session, after the mount's
  initial `refresh()` already listed -- so TeamDroplet now re-`refresh()`es
  when auto-sync reports it actually saved (its `message` is only set on a
  real save, not a skip), clearing the tag same-session instead of only on
  next open.
- **Per-person colours (studio request).** `MEMBER_COLORS` maps each roster
  name (lowercased) to an accent -- Jacqui pink, Antonio blue, Turk red,
  Luke orange, Maria green, Nicholas teal, Aaron purple; unknown names fall
  back to neutral grey. Each row carries its colour as a `--member-color`
  CSS var. A member wears their colour BRIGHT (name + a leading dot, dot
  glowing) once their profile exists (`--set`), and stays muted grey while
  "NO SETUP YET" (`--empty`) so a filled roster reads as a wall of distinct
  colours and empty slots recede. The row's hover outline and the tagged-
  owner Home icon also use `--member-color`.

`tsc` (both configs) + `yarn build` clean. Data-dependent (needs the NAS +
bridge), so the fix itself needs a real-AE pass: confirm a saved member's
row now clears "NO SETUP YET" and lights up in their colour.

### ROOT CAUSE: File.exists lies on the network-mounted team folder

The "NO SETUP YET" saga (multiple rounds of fixing *detection* that never
worked) had a single cause, and it was NOT in the detection logic:

`readTextFile()` opened with `if (!file.exists) return null;`. On the
studio's network-mounted team folder **File.exists returns FALSE for files
that plainly exist** (confirmed: `Antonio/profile.json` visible in Finder,
`.exists` false). EVERY read in team.ts funnels through `readTextFile`, so
that one stat silently broke the whole feature at once:
- profile detection -> `hasProfile` false -> every row "NO SETUP YET"
- `teamApplyProfile` -> null content -> "hasn't saved a setup yet", i.e.
  **importing a colleague's setup was impossible** (the user's actual
  blocker, and the tell that detection wasn't the real problem)
- `teamCheckVersion` / `teamSyncShared` -> quietly no-op'd

Every earlier attempt rewrote how we *detect* the file (mask `getFiles`,
no-mask `getFiles` + name match, reconstructed-path stat). None could work,
because detection and consumption both sat behind the same broken gate.

Fixes:
- `readTextFile` no longer stats. It just attempts `file.open("r")` --
  the authoritative test (opens = readable; fails = unusable regardless of
  what `.exists` claims). `open()` on a genuinely missing file returns
  false, so the "not there" case still yields null; the stat bought nothing.
- `memberProfileContent(folder)` -- detection now proves a profile is
  usable by ACTUALLY READING IT, the same mechanism `teamApplyProfile`
  uses. Detection and consumption can no longer disagree: if a row shows
  as ready, applying it will work.
- `teamApplyProfile` reads via `memberProfileContent` and drops the
  `legacy.exists` gate on its fallback.
- `teamDeleteProfile` no longer gates removal on `.exists` (which made
  Delete a silent no-op on the same mount); it attempts the remove on both
  the listed file and the constructed path.

RULE FOR THIS FILE: never gate a team-folder operation on `File.exists` /
`Folder.exists` for FILES. Attempt the real operation (open/read/remove)
and treat its failure as the answer. `.exists` is only safe-ish for the
root folder mount check (`teamFolder()`), which is a directory and has
behaved.

`tsc -p tsconfig-build.json` + `yarn build` clean. Real-AE confirmed: a
saved profile now clears "NO SETUP YET" and applying a colleague's setup
works. The temporary `debugTrace` field on `teamListProfiles` and the
in-panel yellow debug readout (`TeamDroplet.tsx`) have both been removed
now that the fix is verified.

## Localise section: three-pane workspace + flat tools (restructure)

The Localise section had become a catalogue of tools rather than a surface
for doing the job: the daily driver (CSV Localiser) sat 3 hops deep, 5 of
11 tools were single-action pages, and the landing ran three competing
groupings at once (two big cards + a numbered workflow strip + a utilities
grid).

Final shape, after a round of real-use feedback on the first attempt:

**1. Primary jobs as PANES of one work surface** (`Pane` / `PANES` in
`LocaliseScreen.tsx`) -- a segmented toggle swaps the surface between the
campaign-localisation tools. No navigation, no nesting, and switching is a
toggle. **SUPERSEDED BY v4 (below): this was originally a THREE-pane surface
(CSV Localiser / Trott & Batch / Localised Library); the Localised Library
has since been pulled OUT into its own hero -- the surface is now TWO panes
(CSV Localiser + Trott & Batch), the two halves of "localise a campaign".**

**2. The "Localisation Workflow" strip was removed.** The first pass kept
it as a numbered spine with `->` arrows; feedback was that it implies a
rigid pipeline nobody actually works in order. Those stages are just
tools, so they're now presented as tools: ONE flat `TOOLS_ROW` of plain
rounded buttons separated by a hairline `.ls-tool-divider` instead of
arrows, with no step numbers, merged together with what used to be the
separate "More Utilities" grid.

**3. Run-in-place preserved.** A tool whose whole job is ONE parameterless
backend call executes on the landing (`TOOLS_ROW[].run` -> shared status
line) instead of opening a page containing a single button: PDF to CSV
(`pdfToCsvGenerate`), JPEG Loc (`jpegLoc`), AEP Thief (`copyAep`).

**4. `CampaignLocaliser` de-duplicated** (its own page AND the Batch pane):
- *Generate Files* was TWO near-identical buttons whose only difference was
  the boolean passed to `campaignLocaliserGenerate`. That's a mode, not a
  second action -- now one button + a "Skip files that already exist"
  `CheckboxToggle`.
- *Trott* and *Trott 2.0* were two side-by-side cards, but **2.0 always read
  the same five inputs as v1 while not displaying them** -- it silently
  depended on fields living in the other card. Merged into ONE card: the
  shared inputs stated once, **Trott 2.0 as the primary action**, and the
  original semi-automatic Trott folded behind a `showLegacyTrott`
  disclosure ("Use the original Trott instead").
- The embedded `CSVLocaliserTool` was removed from Campaign Localiser --
  CSV is its own pane now, so keeping it here duplicated it in the same
  surface.

Deliberate limits (NOT silently degraded):
- **Edit Generator and Cue Sheet stayed pages.** They look like one-shots
  (single registry `action`) but aren't: `editGeneratorArrange` takes 6
  params, `generateCueSheet` takes 3 toggles. Bare buttons would run with
  defaults and drop the user's options.
- One-shot tools KEEP their pages registered as a fallback (still reachable
  via search / Command Palette); the row buttons are a faster route, not a
  replacement.
- The old `.ls-card` / `.ls-cards` and `.ls-stage*` SCSS is left in place
  though nothing renders it now.

Verified in browser preview (v3): 3 pane tabs switching correctly (CSV ->
Campaign Localiser -> Localised Library all mount), tools row = 8 flat
buttons with 7 dividers and zero `.ls-flow-arrow`/`.ls-stage-num`
remaining, Trott section renders ONE card titled "Trott 2.0" with the
Duration field visible and the legacy disclosure expanding to "Run
original Trott", no CSV Localiser duplicated inside the Batch pane, and a
run-in-place tool stays on the landing showing its status. `tsc` +
`yarn build` clean. Real-AE pass still wanted for the actual
run-in-place ExtendScript calls.

### v4: Localised Library pulled out into its own hero + Trott default tidy-up

Two direct-feedback follow-ups:

- **Localised Library is no longer a co-equal third pane** -- being
  sandwiched between the two campaign-localisation tools (a segmented tab
  between CSV Localiser and Trott & Batch) flattened the fact that it's a
  different KIND of job (browse/import existing localised components per
  territory, not localise a campaign from masters). It's now a prominent
  full-width **hero** (`.ls-library-hero`, "LIBRARY" eyebrow + BookOpen
  icon badge + description + slide-in arrow) at the TOP of the landing,
  above the work surface. Clicking it opens the Localised Library
  full-width via the SAME `handleSelect("localised-library")` tool-render
  path every other tool page uses (it's a registered `TOOLS` entry) -- so
  it reads as its own destination, not a tab. The `LocalisedLibraryTool`
  inline import in `LocaliseScreen.tsx` was removed (it's lazy-loaded via
  the registry now). The work surface below is now TWO panes, grouped
  under a "LOCALISE A CAMPAIGN" caption (`.ls-section-caption` in
  `.ls-main-head`) so the toggle reads as "two views of one job". The GSAP
  entrance cascade's first tier is now `.ls-library-hero, .ls-main`
  (the old two big `.ls-card` tiles are gone).
- **Trott/Generate defaults** (`CampaignLocaliser.tsx`): "Skip files that
  already exist" now defaults ON (`skipExisting = true`), and the
  Auto-detect toggles default ON (`trotUseArtworkName`/
  `trotUseCampaignName = true`). More importantly, the Duration/DOOH-DINTH/
  Campaign fields were **moved OUT of the Trott 2.0 card and into the
  legacy Trott disclosure only** -- confirmed against `localise.ts` that
  `campaignLocaliserTrott2`'s five params are underscore-prefixed and never
  read (it Jaccard-matches everything automatically), so those fields only
  ever mattered to the original `campaignLocaliserTrott`. Trott 2.0 now
  shows just Masters -> PDFs -> Run; the fields appear only when you expand
  "Use the original Trott instead".

Verified in browser preview (v4): landing shows the LIBRARY hero, a
two-tab LOCALISE A CAMPAIGN surface (CSV Localiser / Trott & Batch only),
and the TOOLS row; the hero opens Localised Library full-width and Back
returns to the landing; Trott 2.0 shows no fields, the legacy disclosure
reveals them on Auto-detect. `tsc` (both configs) + `yarn build` clean.

## Batch Match (new tool) + three real AE-DOM findings

`tools/BatchMatch.tsx` + `jsx/aeft/batchMatch.ts`, registered under Tools
(rail stage "Utility"). Built from a real job: a CC Light Sweep's last
Center keyframe had to be retargeted across a Finland batch. Capture a
property from the open project (whatever is selected in the Timeline),
then write a derived value onto the equivalent property across every
`.aep` in a folder. Two-phase: `batchMatchPreview` (never writes) builds a
per-row current -> proposed table with checkboxes, `batchMatchApply`
writes only the ticked ids. Apply goes through `losOpenForEdit()`, so a
file still carrying an isolated `OV` token is copy-first'd.

**How a property is re-found in another file**: the reference is stored as
its matchName PATH from the layer down (`["ADBE Effect Parade", "CC Light
Sweep", "Center"]`, `["ADBE Transform Group", "ADBE Position"]`) and
re-walked per target. That is what makes it generic across effects and
transforms rather than one-effect-specific, and matchNames survive AE
version/UI-language differences where display names don't.

**Transform modes are an explicit user choice, never inferred**: verbatim
/ scaleSource / scaleComp / offset / multiply, plus an axis mask (write X
only, etc.). Many properties (an effect's Center, a Position) are in
SOURCE- or COMP-pixel space, so the same number means a different place in
a different asset -- in the real batch, `5412.6` on a 3600px-wide PNG had
to become `3382.9` on a 2250px one. There is no safe way to guess which
mode is meant.

### Three findings from running this against real projects

1. **A project that has imported a sibling project carries that sibling's
   ENTIRE `Composition/Main` tree**, inside a folder named `<name>.aep`.
   "Is this comp under a folder called Main" is therefore NOT enough to
   identify a file's own deliverable -- on the real batch that rule alone
   proposed 10 edits where only 3 were genuine (each landscape file wanted
   to edit its imported copies of the portrait comps). **The rule that
   works: exclude any comp with an ancestor folder whose name ends
   `.aep`.** Both filters ship on by default (`requireMainFolder`,
   `excludeImportedAep`). Any future tool that walks "every comp in the
   project" across a batch needs this same exclusion.
2. **Never identify an AE DOM object by `===`.** `bmOccurrenceOf` first
   compared `parent.property(i) === child` to find a property's index
   among its siblings; in ExtendScript two accesses to the same property
   return DIFFERENT wrapper objects, so it never matched, every captured
   path recorded `occurrence: 1` instead of `0`, and resolution then
   looked for a nonexistent second copy of every group -- so the tool
   found nothing in ANY file, including the reference file itself. Use
   `propertyIndex` (or another value-based identifier). Same family as
   this file's other "the AE DOM is not a normal JS object graph" traps
   (`instanceof` against host classes, `.match()` on names). Invisible to
   `tsc` and to browser preview; only a real-AE run surfaces it.
3. **`app.open()` and a dirty project: context-dependent, and the PANEL is
   fine.** Driving AE through AppleScript `DoScript`, `app.open()` silently
   SAVED the currently-open dirty project to disk -- no dialog, mtime and size
   changed (reproduced deliberately on copies). That is an artefact of the
   automation context: `DoScript` suppresses modal dialogs (the same reason a
   `confirm()` deadlocks under it). **From the panel, where `evalScript` runs
   with AE's UI live, AE shows its normal "save changes?" prompt** -- confirmed
   by the studio, who sees that dialog every time they start an MC It! dry run.
   So no panel tool has ever silently written the user's open project, and
   none of them force-close it. `batchMatch` briefly did, as a "fix" for the
   automation-only symptom; that was REVERTED, because force-closing removes
   the user's chance to save and bins unsaved work. **Do not re-add a
   defensive close here.** The thing to remember is narrower: any script this
   repo drives through AppleScript/`DoScript` for testing runs with dialogs
   suppressed, so it can write files the same code would have prompted about
   in the panel -- test destructive paths on COPIES.

Verified: `tsc -p tsconfig-build.json` + `yarn build` clean, all four
bridge names resolve in `dist/cep/jsx/index.js`, and the whole
capture -> preview path was exercised against the real Finland batch in
AE 26.2.1 (correct per-size proposals, correct "already at" idempotence,
`filesWritten: 0`, no mtime changes). **`batchMatchApply` itself has NOT
been run from the panel UI yet** -- the equivalent writes were done by a
one-off script, so the apply path and the React page both still want a
real-panel pass.

## Windows `file://` paths: strip the leading slash before handing to Node fs

**RESCUED FROM A DELETED SECTION — this bug is still live.** A Windows file URL
is `file:///C:/Users/...`, so `slice("file://".length)` (or a bare
`.replace("file://","")`) leaves `/C:/Users/...`, which Node's `fs` rejects with
a baffling `ENOENT ... open '/C:/Users/...'` even though the file is plainly
there. macOS is `file:///Users/...` -> `/Users/...` and is already correct,
which is why a macOS-only studio never sees it.

**RULE: converting a `file://` URL to an fs path = decode percent-escapes
(a real install path contains `%20`), THEN strip a leading slash ONLY when a
drive letter follows** — so POSIX paths are untouched. Never hand
`location.href.slice(7)` straight to `fs`.

**STILL UNFIXED, VERIFIED:** `src/js/lib/utils/bolt.ts:357` and `:371` (the
folder-dialog helpers) both still do a bare
`decodeURIComponent(result.data[0].replace("file://", ""))`. They are shared
plumbing used by many tools, and a CEP folder dialog can't be exercised from
browser preview, so this has never been proven either way on Windows — but by
inspection it has the same defect. `OVLibrary.tsx` already handles the
drive-letter case correctly for its own path->URL direction, so that file is
the reference for the shape of the fix.

## chrome74: use the padding-box trick, not `aspect-ratio`

**RESCUED FROM A DELETED SECTION.** To hold a fixed aspect ratio on this
project's `chrome74` build target, use the percentage padding-box trick
(`height: 0; padding-bottom: 62.5%` for 8:5, with the content absolutely
positioned inside). **`aspect-ratio` is Chrome 88+ and must not be used** — see
the chrome74 rule in "Style / conventions". `arcade/ArcadeFrame.scss` is the
working reference.

**Known violations of this rule, still in the tree:** `tools/OVLibrary.scss`
uses `aspect-ratio: 16 / 9` twice (its two thumbnail boxes), and both survive
into the shipped stylesheet.

## Node `https` vs browser `fetch`: which test to dispatch on

**RESCUED FROM A DELETED SECTION**, because the surviving statement of this
rule is the *opposite* one and the difference matters.

The packaged panel is a `file://` page, so browser `fetch()` fails on any
cross-origin API. The panel runs with `--enable-nodejs` precisely so Node's
`https` can sidestep CORS (`lib/utils/wrikeApi.ts` is the reference).

Two different questions, two different tests — pick the one that matches what
you're actually asking:
- **"Which filesystem am I reading?"** -> dispatch on the URL SCHEME
  (`location.href` starts with `file://`). Node is present in BOTH the packaged
  panel and `yarn dev`, so a "is Node available" test sends the dev-mode
  `http://localhost:3000` URL into `fs.readFileSync` and produces a baffling
  `ENOENT ... open 'http://localhost:3000/...'`.
- **"Do I have a transport that isn't subject to CORS?"** -> dispatch on NODE
  AVAILABILITY. This is what `arcade/cine/tmdb.ts` does, and it is correct for
  that question: the fetch fallback exists only so the game is testable in
  browser preview.


## Arcade eggs: ArcadeFrame + "TIMELINE" (studio-flavoured snake)

> **CORRECTION (2026-08 audit) — THE PER-GAME TRIGGER WORDS BELOW ARE GONE.**
> There are now exactly **two** exact-match words in `HomeScreen.tsx`:
> `jacqui` (theme picker, `:150`) and `arcade` (`:159`), which opens
> `arcade/ArcadeHub.tsx` — a single hub listing every game and its standings.
> `doom`, `timeline`, `daily`, `chain` and `xyinerdle` no longer trigger
> anything. **There is no `ARCADE_GAMES` table**; the game table is `MACHINES`
> in `ArcadeHub.tsx`. Adding a game = a `MACHINES` entry **plus** its
> `teamArcadePost` call. Read the sections below for the per-game design
> reasoning, not for how to reach them.

A second easter-egg game, and the start of a small shared harness for any
more. Trigger: typing the exact word `timeline` into the home search box
reveals a "PUSH THE PLAYHEAD" card; clicking it mounts `arcade/KeyframeSnake.tsx`
over the panel. Same exact-match rule as `jacqui`/`doom`, so a trigger word
can never fire while typing toward a real tool name.

**`arcade/ArcadeFrame.tsx` is the reusable half, and it exists for ONE
reason: AE eats keystrokes before a CEP panel sees them.** That problem is
game-agnostic, so the solution lives there rather than being copy-pasted:
`registerKeyEventsInterest` (released with `"[]"` on unmount, or the game
keeps stealing keys from AE all session) PLUS the focused invisible `<input>`
that actually delivers keys on macOS AE, re-focused on a 400ms interval. Any
future game gets both for free by rendering inside it.

**ArcadeFrame is deliberately NOT an iframe.** The since-removed DOOM egg needed one because
Emscripten can't destroy a runtime and therefore contaminates its page (see
a now-deleted section). A game we wrote ourselves owns its own listeners and
timers and removes them on unmount, so the realm boundary would buy nothing.
Don't "unify" the two.

Two implementation choices in `KeyframeSnake.tsx` worth keeping:
- **The loop is `setInterval`, not `requestAnimationFrame`.** A grid game
  wants a fixed logical tick anyway, but it ALSO makes the game verifiable in
  browser preview, which throttles rAF to death in an automated tab (the
  "Preview harness caveat" above). An rAF loop would be untestable there for
  exactly the reason the old DOOM overlay's exit animation was.
- **Direction input is QUEUED and committed by the tick**, not applied on
  keydown. Otherwise two fast presses inside one tick (right, then down, while
  moving up) reverse the snake into its own neck -- the classic snake bug.
- Live state lives in refs, not React state: the tick runs from an interval
  and would otherwise capture a stale closure. React state carries only what
  the chrome re-renders (score, dead, paused).

Escape CLOSES these games -- deliberately unlike DOOM, where Escape is the
in-game menu key and binding it to quit would make the menu unreachable.

**Cost: ~28 KB of source, versus the ~6.5 MB of assets the removed DOOM egg
carried** -- the size argument that eventually got DOOM deleted. Nothing is
fetched, no licence obligations, no third-party code.

**Adding another game is one entry in `ARCADE_GAMES`** (a table in
HomeScreen.tsx: trigger word, card title/sub, component) plus the component
itself. It's a table specifically so the next one isn't another `isXEgg`
branch threaded through that file. A CHIP-8 player is the obvious next
candidate -- the emulator is ~200 lines and ROMs are ~1 KB each, but it needs
public-domain ROMs (CC0 `chip8Archive`) dropped into `src/js/public/`, which
is a deliberate download decision, not something to add unprompted.

**Verification**: `tsc` (both configs) + `yarn build` clean; `.arcade-*`/
`.ks-*` classes confirmed in the single bundled stylesheet (cssCodeSplit:false
still holding). Driven for real in browser preview: card appears on the
trigger word, canvas mounts at 576x360, board animates between ticks, score
increments exactly once per pickup, wall collision reports "Ran past the work
area", Space restarts with score reset to 0 while `best` correctly persists,
P pauses and freezes the board, and a dead game correctly ignores direction
input. Pixel-sampled the canvas to confirm all three colours render (teal
keyframes, white playhead, orange footage). Untested outside preview: whether
AE actually delivers the keys in the real panel -- that's the same
macOS-CEP-specific unknown the DOOM keyboard work carried, and the one thing browser
preview structurally cannot answer.

## Team folder: game files live in `misc/arcade/`, not loose in `misc/`

`misc/` was becoming "the arcade folder" (word board, XYiNerdle invites/results,
arcade scores, battle rooms) when it's meant to hold whatever odds and ends get
bolted on. Games now sit under `misc/arcade/`.

- **`ARCADE_DIR` + `isArcadeFile(name)` + `sharedDirFor(name)`** (`team.ts`) --
  ONE list decides which shared files are game files, so adding a game means
  touching exactly that list. `readSharedFile` walks **arcade/ → misc/ → root**
  and takes the first hit; `writeSharedFile` always writes to the file's own
  folder. Same self-migrating shape `misc/` itself already used against the
  legacy root: the first write relocates the file, nothing to move by hand,
  nothing orphaned. **Don't remove either fallback until every machine has
  written at least once.**
- **`ensureSharedFolder(dir)`** creates each level in turn -- `Folder.create()`
  does not make intermediate levels in ExtendScript (the same reason
  `battleRoomFolder` already walked its levels by hand).
- **Battle rooms**: `BATTLE_DIR` is now `misc/arcade/battle`, with
  `LEGACY_BATTLE_DIR` still READ per-file (`legacyBattlePlayerPath`) so a match
  already in progress when this build lands doesn't lose its room, and
  `teamBattleCleanup` sweeping BOTH locations so an old room folder isn't left
  behind forever. Rooms are ephemeral, so the legacy read can be dropped after
  about a day.
- **`teamArcadeSweep()` -- the housekeeping that was missing.**
  `teamBattleCleanup` only fires when a match actually REACHES a loser AND the
  winning panel is still open at that moment, so everything else leaked
  forever: rooms from invites nobody accepted, matches abandoned mid-chain,
  panels closed before the final action landed (a real one, `battle/RRTE/`,
  was sitting on the NAS when this was found). The sweep deletes any room
  folder whose newest file is older than `ARCADE_STALE_HOURS` (24) and drops
  invites past the same cutoff. A live game touches its player file every
  turn, so "stale" means abandoned -- and 24h is deliberately far longer than
  a match (minutes) so an in-progress room can never be swept out from under
  two people playing. Invite age is a STRING compare on `nowStamp()`'s
  sortable format, not a re-parsed `Date` out of a `toString()`.
  Called **once per panel session** from `NerdleMenu` (module-scope
  `sweptThisSession`, same guard pattern TeamDroplet's version/sync checks
  use) -- NOT on the 15s lobby poll, since it enumerates folders on a network
  share. Silent either way: nobody asked for it, and an unmounted NAS is
  normal.
- **Known limit, stated rather than designed around**: a machine on an OLDER
  build only looks in `misc/` and the root, so once a file migrates it stops
  seeing it. Acceptable for what lives here (a rolling 30-day board, ephemeral
  invites, live rooms) -- but don't move a file anyone would MISS into a new
  subfolder without leaving the read fallback on both sides.

## MC It! preview: fix an unmatched image by hand

An item the matcher couldn't place used to be a dead end -- the preview said
"No candidate ending in '1' at that resolution." and that image just never got
swapped, even when the right file was sitting in the folder under a slightly
misspelt name. The dry-run modal can now be corrected before Apply.

- **`mcItRankCandidates`** (`tools.ts`) attaches up to 8 suggestions to every
  `no-match` item, **dry run only** (the real run's report is a record of what
  happened; 8 paths per miss would bloat the persisted JSON for no reader).
  **Deliberately NOT `findBestComponentFile`**: that answers "which ONE file
  is the match", exposes no score, and is the load-bearing matcher MC It!/LOS
  Tools/JPEG Loc all depend on -- refactoring it to also rank would risk real
  replacement behaviour for a cosmetic list. This is a cheap separate ordering
  (same extension, then the AEP's resolution, then the trailing number, then
  shared name tokens). Cross-type files are never offered: replacing a .png
  with a .jpg is the one thing MC It! has always refused, and offering it by
  hand would quietly reintroduce it.
- **`mcItPickImage(startFolder)`** is the "Choose a file…" escape hatch for
  when the right image isn't in the suggestions at all -- starts in the folder
  the run scanned. A cancel is `success:true` with no path, not an error.
- **Overrides ride through as `{aep: {itemKey: path}}`** (`mcIt`'s new 5th arg
  `overridesJson`, and `mcItApplyToOpenProject`'s new optional 5th param).
  `itemKey` is `folder + "|" + originalName`, carried on each report item as
  `key` so the modal never re-derives it from the text (reports persisted
  before this still open -- the frontend falls back to computing the same key).
  **An override bypasses every filter, including the Artwork OV-token gate** --
  the user has looked at that exact item and named that exact file, which
  outranks any heuristic here. The only thing it can't bypass is the file not
  existing, which comes back as a normal no-match with a clear reason.
- A project whose ONLY change is a manual fix counts as actionable in the
  modal, so it gets a checkbox and is included in the Apply run.
- **Not verifiable in browser preview**: demoBridge treats `mcIt` as a generic
  action and returns no structured report, so there's no way to render this
  modal without a real AE run. Typechecks + builds clean and both new bridge
  names resolve in `dist/cep/jsx/index.js`; the suggestion quality and the
  override-apply path want a real-AE pass.

## CSV Localiser: rows already built in the AE folder start unticked

Asked for directly, from the real case: open Batch_02 for Croatia when
`<Territory>/AE/Batch_02` already holds most of that batch's sizes, and only
the sizes ADDED to the batch since should be ticked to run.

The scan already peeked at that folder for a boolean (`Batch.done`, seeding the
"Done · Re-run" button). It now keeps the whole `.aep` FILE LIST
(`Batch.existing`, via `readExistingAeps`) and matches each spec row against it
(`matchBuiltRows`, exported from `CSVLocaliser.tsx` so it's unit-testable).
Matched rows are seeded into the existing `excludedRows` overlay, so they start
unticked and Localise runs only the new ones -- no new run-time mechanism, and
ticking one back on re-localises it exactly as before.

- **The site is a PREFERENCE, not a requirement -- learned the hard way.** The
  first version tested each row alone and REQUIRED the row's media-site token in
  the filename. Against the real Egypt Batch_01 it matched NOTHING: those files
  are `PP3_INTL_DGTL_DINTH_JUNGLETUNNEL_640x768_15sec_EG_V01.aep`, i.e. no site
  token at all (built before the Site column existed), while every row carried
  one. Matching is now BATCH-LEVEL with file claiming (`matchBuiltRows`): pass 1
  lets site-carrying rows claim a core-matching file that names that site, pass 2
  gives every remaining row the first unclaimed core match, and **each file can
  only be claimed once** -- which is what still keeps two rows differing only by
  screen from both matching one file.
- **It matches on TOKENS, not by rebuilding the filename.** The generated name
  is `<FilmTitle>_<INTL|DOM>_DGTL_<Artwork>_<CAMPAIGN>[_SITE]_<WxH>_<dur>sec_<CC>_V01.aep`
  and the first two tokens come from whichever MASTER `csvLocaliserRun` picks
  at run time (`scanMastersForBestMatch`) -- the panel can't know them without
  doing the master scan itself. Campaign + size + duration is what the ROW
  determines, and is what makes one deliverable different from another inside
  a batch.
- **ARTWORK IS NOT PART OF THE CORE (dropped 2026-07, studio instruction:
  "just match by size and campaign and duration").** It was the wrong kind of
  check twice over: a Specs PDF is ONE campaign's batch, so the artwork column
  is effectively constant down it and discriminates nothing between rows -- but
  `reshapeSpecs` DEFAULTS it to `"DOOH"` whenever the PDF cell doesn't parse, so
  a batch actually built as DINTH/DFOH read as entirely unbuilt. **Don't re-add
  it.** A field that can silently default is not a field you can require.
- **Campaign is matched with TOKEN BOUNDARIES ON THE FILENAME SIDE ONLY**
  (`tokenised`/`containsAsTokens`), everything else on a strip-all canonical
  form (`canonName`). Boundaries are load-bearing, not tidiness: on plain
  substring matching, campaign "HORSE" matches a HORSESHOE file and "FOH"
  matches "DFOH", marking a row built whose deliverable doesn't exist -- the
  silent drop this whole feature exists to prevent. **But the boundaries must
  NOT be required to line up between the two sides**, which is what the first
  version (`canonTokens`, comparing `_HORSE_` against `_HORSESHOE_`) got wrong:
  a CSV campaign is spelt however the client wrote it ("JungleTunnel") while the
  .aep carries the master's spelling ("..._JUNGLE_TUNNEL_..."), so
  `_JUNGLETUNNEL_` matched nothing and a fully-built Croatia Batch_1 read as
  entirely unbuilt. Now: separators stripped from BOTH sides, but the occurrence
  must begin at a token start and end at a token end in the FILENAME.
  "JUNGLETUNNEL" therefore matches `_JUNGLE_TUNNEL_` while "HORSE" still can't
  match inside `_HORSESHOE_`. All of these are unit-tested.
- **Failure is deliberately asymmetric.** The host sanitises the site token
  with full accent folding (`csvLocSanitiseSiteToken`); the panel only strips
  to A-Z0-9, so an accented site name reads as NOT built. That's the safe
  direction -- the row stays ticked, gets localised, and `skipExisting` on the
  host is the backstop. Never loosen this into a fuzzy match: a false "already
  built" loses a deliverable silently, a false "new" costs one re-run.
- **THE BATCH FOLDER IS FOUND LOOSELY, and that was the actual bug in the
  first real report** (a Denmark Batch_2 whose 12 files were plainly on disk,
  every row still ticked). `csvLocaliserRun` WRITES to `<Source Folder>/AE/<
  paddedBatch>` (`Batch_2` -> `Batch_02`) and the panel only ever looked for
  that exact spelling -- so a folder made by hand, by an older build, or by
  another localisation tool (`Batch_2`, `batch 2`) was invisible, `existing`
  came back empty, and nothing could match no matter how good the matcher was.
  `resolveBatchFolder()` now prefers the padded name then falls back to
  whichever child of `AE/` canonicalises the same (case, separators and a
  leading zero all ignored). **Symptom to recognise: NOTHING in a batch reads
  as built, and the header shows no `N built` -- suspect the folder lookup
  before the matcher.** (Confirmed by replaying the reported batch's real
  filenames through `matchBuiltRows` headlessly: 12/14 matched, sites and all.)
- **Visual**: a built row gets a flat green wash + a solid left rule
  (`.specs-row--built`, a fixed low-alpha green -- NOT `--cat-glow`, which is
  hover-tuned and renders near-solid at rest, the same trap the Localised
  Library JPG_PNG row hit) and reads as "settled", distinct from an excluded
  row's dim strike-through ("discarded"). A row is usually both, and the two
  styles compose. The batch header gains `3 new · 9 built`, so a batch that has
  gained sizes says so without being expanded.
- **A per-batch "Re-check" button** (`refreshBatchBuilt`) re-reads the folder
  without a full re-scan, and the same function runs after a successful
  localise so just-written rows untick themselves. It RE-SEEDS the batch's
  exclusions from disk rather than preserving manual ticks -- that's what's
  being asked for, and the alternative silently hides a genuinely missing row.
- **A long PDF name used to paint over the buttons.** `.specs-batch-name` had
  no truncation, so it couldn't shrink below its content width and spilled out
  of `.specs-batch-main` across Localise/Re-check/MC It! -- the flex ITEM
  shrinks, its CONTENT doesn't. Fixed with `min-width:0` + ellipsis on the name
  and `overflow:hidden` on the button. Only showed up once the header gained a
  third button, so **any new control in that header is a regression risk**.
- **Verified**: `tsc` (both configs) + `yarn build` clean, styles in the
  bundle, and 16 headless assertions on `matchBuiltRows` -- including the real
  Egypt Batch_01 (13 rows with sites vs 13 site-less files: all match, each
  claiming a different file, and one newly-added size correctly the only
  unbuilt row), the two-sites-one-file cases both ways, and the
  HORSE-vs-HORSESHOE / FOH-vs-DFOH discrimination.

## CSV Localiser: batches start collapsed, the open one is highlighted

`expandedBatches` (was `collapsedBatches`, i.e. the set is inverted) -- every
batch now starts CLOSED, because a territory is often several batches deep and
having every row table open at once made it hard to tell which batch you were
actually editing. The open one gets `.is-open`: an accent rule down its left
edge plus a faint wash and a brighter name. **Not an accordion** -- opening a
second batch doesn't close the first, since comparing two batches' rows is a
real thing to want, which is why the highlight has to work with two open.
`runBatch` calls `openBatch(key)` before running: the per-row result lines
render inside that section, so a run started from a collapsed header would
otherwise write its results somewhere invisible. The `.is-open` wash uses a
fixed low alpha, NOT `--cat-glow` (hover-tuned, renders near-solid at rest --
the same trap the Localised Library JPG_PNG row hit).

## WORDMARK (formerly "DAILY"): guesses are now validated (supersedes the "deliberately not" note)

Asked for directly: without validation you can grind the answer out with
gibberish. `arcade/guessWords.ts` is a GENERATED list of every five-letter word
DAILY will accept -- the 5-letter subset of dwyl/english-words' `words_alpha.txt`
(public domain / Unlicense), 15,921 words, ~93 KB, deduped and sorted.
Regenerate by re-filtering that file to `/^[a-z]{5}$/`; never hand-edit it.

- **Two lists, on purpose**: `words.ts` stays the small curated ANSWER list (an
  answer must be common and satisfying), `guessWords.ts` is the permissive
  GUESS list (a guess only has to be a real word). Every answer was verified
  present in the guess list when this was generated -- if you add an answer,
  re-check that, or its day is unwinnable.
- **Permissive is the design**, so the list keeps its obscure entries: rejecting
  a real word someone typed is far more annoying than letting an unusual one
  through. Only outright gibberish bounces.
- **macOS's `/usr/share/dict/words` was tried first and is unusable here** --
  it's Webster's-1934-derived and has NO inflected forms, so it rejects
  "trees", "asked", "moved", "plays". Don't reach for it for this again.
- A rejected guess costs no turn: the row keeps its letters and shakes
  (`.dw-row--reject`), with "Not a word I know." in the flash line.
- Stored as space-separated lines split into a Set lazily on first guess --
  quoted, comma-separated entries would roughly double the file for nothing.

## The arcade is a GRID OF CABINETS now, not a rack-and-screen picker

Asked for directly: the games were "squished on a list on the left side with
the leaderboards on the right, and you have to select the game and then click
play". Both halves of that were real -- one game's scores visible at a time,
and two clicks to start anything.

`ArcadeHub.tsx`/`.scss` are rewritten around one card per game
(`.arc-floor` / `.arc-cabinet`): each carries its own lit marquee in its own
accent, a one-line blurb, who holds it, and its own top 3 -- and **the card
itself is the play button**, so starting a game is one click and no selection
state exists at all (`selected` is gone; only `playing` remains).

- **`--arc` is now set PER CARD, not once for the screen.** Four accents on
  screen at once is most of what makes this read as an arcade rather than a
  list. The top marquee went back to a fixed teal, since with no selection
  there's no accent for it to inherit.
- **The title is the card.** The one-line blurb under each name was removed on
  request and the name grew into the space: the scoreboard's monospace stack,
  uppercase, wide tracking, glowing in the machine's own accent, vertically
  centred in a taller marquee. **No webfont, deliberately** -- CEP can't be
  relied on to fetch one, the panel ships no custom faces, and base64'ing a
  display font is real weight plus a licence question for a joke feature. The
  title WRAPS rather than ellipsising ("PUSH THE PLAYHEAD" doesn't fit a
  half-width cabinet on one line, and a truncated game name reads as broken
  where a second line reads as a bigger sign); grid rows stretch, so a two-line
  title only makes its own row taller and the pair stays level. Centred both
  ways in the marquee, echoing the room's own ARCADE sign above it.
- **A `<button>` that is a flex container does NOT stretch its children in
  Chromium** the way a `<div>` does -- the UA stylesheet centres them. Found
  from a real screenshot: every child sized to its own text, so each cabinet's
  marquee background and underline stopped dead at the end of the title (reads
  exactly like the title is cut off mid-card) and each score rule was a
  different length. Fixed with an explicit `align-items: stretch` on
  `.arc-cabinet`. **Any future flex layout inside a `<button>` in this codebase
  needs the same explicit line** -- it is not the default here even though it is
  everywhere else.
- **The card is a `<button>`, so every child is a `<span>`** -- a `<div>` inside
  a button is invalid markup, and a nested `<button>` (the obvious way to build
  the "Play" chip) would swallow the card's own click. The Play chip is a span
  styled as a button that fills with the machine's colour on card hover.
- **The grid is ALWAYS TWO COLUMNS** (`repeat(2, minmax(0, 1fr))`). It shipped
  as `auto-fit, minmax(210px, 1fr)` and that was wrong in use: an expanded panel
  reflowed it to three across and stranded the fourth game alone on its own row.
  A 2x2 block reads as a set, 3+1 reads as a mistake. `minmax(0, 1fr)` rather
  than plain `1fr` is what lets a track shrink below its content so a long name
  truncates instead of widening the grid. Narrow panels keep both columns and
  just tighten padding/gaps. **A FIFTH GAME ORPHANS ONE AGAIN** -- add them in
  pairs, or revisit the rule then; don't quietly go back to auto-fit.
- **Only 3 lines fit on a face** (`CARD_LINES`), with a `+N more` line rather
  than pretending the board is that short. The full board still lives inside
  each daily game's own screen.
- Entrance uses **per-item explicit delays**, not a stagger parent -- this
  codebase's documented workaround for variant propagation stalling inside an
  `AnimatePresence` wrapper -- and collapses under `useReducedMotion()`.
- **`MACHINES` gained One Sheet** (it had been registered in the old file too)
  and a `blurb` per entry. Adding a game is still one entry here PLUS its
  `teamArcadePost` call -- see the section below for why the second half isn't
  optional.
- **Not visually verified** -- browser automation was unavailable across this
  whole session. Typechecks + builds clean, and the built stylesheet contains
  the new classes with no `.arc-machine`/`.arc-rack` left over, but the cabinet
  faces want a real look.

## The arcade's pixel typeface (embedded, subset, renamed for its licence)

The cabinet names, the ARCADE sign and each game's own title bar are set in a
pixel face -- `src/js/main/arcade/arcadeFont.scss` defines `@font-face` +
a `.arcade-pixel` class, applied in `ArcadeHub.tsx` and `ArcadeFrame.tsx`.

- **Embedded as base64, because a `file://` page cannot fetch a webfont.** Same
  constraint the removed DOOM egg hit with its own assets (see "Windows
  `file://` paths" above). A data: URI is the
  only delivery that works in both `yarn dev` and an installed ZXP.
- **Subset to 1.3 KB** (A-Z, 0-9, a little punctuation) from a 113 KB family.
  **A future game title needing a character outside that set renders in the
  fallback mono**, so re-subset if that happens. Recipe:
  `pip3 install fonttools brotli`, then rename the family in the `name` table
  (see below), then
  `python3 -m fontTools.subset in.ttf --text="ABC...789 !?.,:'&-+" --flavor=woff2 --no-hinting --desubroutinize`,
  then base64 the result into the `src:` url.
- **LICENCE, and the rename is the compliance step, not branding.** The face is
  Press Start 2P by CodeMan38, SIL OFL 1.1, which declares "Press Start 2P" a
  RESERVED FONT NAME. A subset is a Modified Version, and the OFL forbids a
  Modified Version from carrying the reserved name -- so the family is renamed
  to **"XYi Arcade Pixel"** in both the CSS and the font's own `name` table.
  **Don't "fix" it back.** The full licence text ships as
  `src/js/main/arcade/font/OFL.txt` and is copied into the ZXP via
  `cep.config.ts`'s `copyAssets` -- the OFL requires the licence to travel with
  the font, so **removing that copyAssets entry makes the ZXP non-compliant**
  even though the panel still works. `copyAssets` paths are relative to `src/`,
  not the repo root; a root-relative path silently copies nothing.
- **Sizes had to come down everywhere it was applied** -- the face is far wider
  per character than a normal mono and has no weights (synthetic bold just
  smears the pixel grid). Card titles 11px, ARCADE 13px at a third of its old
  tracking, game title bars 10px. Font smoothing is off (`-webkit-font-smoothing:
  none`): antialiasing softens exactly the edges that make it read as pixels.
- Stylesheets in this project never import each other (each is pulled in by its
  own component), so this is shared as a **class**, not a Sass mixin/placeholder.
  Importing the .scss from two components still yields ONE copy of the base64 in
  the bundle -- verified in the built stylesheet.

## The app has a global `button:hover` that will paint over any custom button

`src/js/index.scss` (the app's base sheet, not a tool's) carries
`button:hover { background-color: #20639b }` and the same for `:active`. **Any
`<button>` styled with its own background must set one on `:hover`/`:active`
too, or that flat blue wins.** Hit for real in the arcade: the cabinet cards
turned solid blue on hover and their scores became unreadable, and the marquee's
close/refresh chips had the same leak. `formTool.scss` and `LocaliseScreen.scss`
each carry their own note about opting out of it -- this is the same rule, and
it is easy to miss because at REST everything looks correct.

The arcade's fix doubles as the "lit screen" hover it wanted: the card sets an
explicit background (a radial bloom of its own accent over the base), an outer
glow in that accent, CRT scanlines from an `::before` that fades in, and a
one-notch brightening of the title and score text. The accent's translucent
form is a **precomputed rgba stored per machine** (`glow` in `MACHINES`), not
derived from the hex -- `color-mix()` is unavailable on this project's chrome74
target, the same rule Toolset's PALETTE follows.

## The arcade rack's leaderboard: only ONE game was ever posting to it

Reported directly ("played a round of snake, the leaderboard is empty"). Not a
read bug and not a Team Folder problem -- **nothing was ever written**. The hub
(`ArcadeHub.tsx`) renders one shared store, `misc/arcade/arcade-scores.json` via
`teamArcadeScores`, filtered by game id, and for a long time the only caller of
`teamArcadePost` in the whole app was `CineChainBattle.tsx` on a head-to-head
win. So "Push the Playhead" and "Wordmark" had rack columns that could never
fill, however much anyone played. Fixed by giving each game its own post:

- **Push the Playhead** (`KeyframeSnake.tsx`) -- posts the run on death, via a
  new `die()` that both games-over and reports. Needed a `scoreRef` alongside
  the `score` state: the death path runs inside the `setInterval` tick, where
  React state is a stale closure (the same rule the rest of that file's live
  state already follows). A ZERO-score death posts nothing.
- **Wordmark** (`DailyWord.tsx`) -- posts its STREAK to the rack on a solved
  day, on top of its own detailed board file. The two stores are separate on
  purpose: `shared-wordgame.json` carries the per-day detail the game itself
  renders, the rack store carries one comparable number per game.
- **One Sheet** already posted (a cleanliness number on solved days).

**STILL DELIBERATELY NOT POSTING: solo XYiNerdle.** That machine's rack metric
is Wins and its mode is `"wins"` (count the rows), so a solo run isn't one --
only a real head-to-head win is. Its board being empty means nobody has won a
battle yet, not that it's broken.

**Every post is fire-and-forget** (`.catch(() => undefined)`) and the host
refuses to post from an UNTAGGED machine rather than guessing a name -- so a
station with no Team Folder, no name tag, or an unmounted NAS silently records
nothing. That's the intended degradation everywhere else in this app, but it
does mean "the board is empty" has two causes now: nobody has played, or this
machine can't post. The hub already shows the "tag this machine" note for the
second case; **if a new game is added, add its `teamArcadePost` call at the same
time as its `MACHINES` entry** -- the entry alone gets you a column that stays
empty forever, which is exactly the bug above.

Rounds played before this landed were never recorded and can't be recovered.

## ONE SHEET: the daily film-poster puzzle (4th arcade machine)

Asked for as a Framed-style poster challenge. One film a day, pixelated, six
guesses; hints cost and the board records them. `arcade/PosterDaily.tsx` +
`.scss`, registered as the fourth entry in `ArcadeHub.tsx`'s `MACHINES`
(accent gold `#fbbf24`).

**NAMES vs IDS -- the rule for every arcade machine.** The rack name and frame
title are DISPLAY-ONLY; a game's `id` is the key its rows are filed under in
the shared score files already sitting on the NAS, so renames never touch it.
"One Sheet" is id `"poster"` (file `PosterDaily.tsx`, board
`shared-postergame.json`) and **"Wordmark" is id `"daily"`** (file
`DailyWord.tsx`, board `shared-wordgame.json`) -- both were renamed after
shipping, for flavour ("Daily Word"/"Poster" read as placeholders next to
"Push the Playhead"). Same partial-rename call as XYTools: user-facing strings
only, internals left alone. Renaming an id would orphan every posted row to
save nothing.

- **THE ANSWER LIST IS GENERATED AND COMMITTED** -- `arcade/films.ts` (600
  films, ~24 KB) from `scripts/make-poster-films.cjs`, which pulls TMDB
  `discover?sort_by=vote_count.desc` (the same "most-rated ≈ most widely
  known, and it spans decades" reasoning `cine/tmdb.ts` documents for the
  XYiNerdle starting pool -- NOT `/movie/popular`). Committed rather than
  fetched **because the day's answer has to be a pure function of the date**:
  `discover`'s ordering drifts as vote counts move, so a live query could hand
  two people different films on the same day and the board would be
  meaningless. Never hand-edit it; re-run the script. Same day-math and prime
  stride as `puzzleForDay` (`posterForDay` here) -- 600 films ≈ 1.6 years
  before a repeat.
- **Pixelation is a canvas, not a CSS filter** (CSS has no pixelate): draw the
  poster into an offscreen canvas the size of the block grid, then blow that
  back up with `imageSmoothingEnabled = false`. `STAGE_COLUMNS` roughly
  doubles per guess (7 → 90). We only ever DRAW the cross-origin poster and
  never read pixels back, so the tainted canvas doesn't matter -- **don't add
  `getImageData` here** (that's the same trap OV Library's thumbnail accent
  hit for real).
- **Three hints, deliberately no cast/director** -- year+runtime+genre,
  tagline, plot (TMDB `overview`), via a new `getFilmFacts()` in `cine/tmdb.ts`
  (its own cache, separate from `getCredits` which throws away everything the
  chain game doesn't link on). A film with no tagline shows "none for this
  film" and can't be bought, rather than charging for an empty reveal. Hints
  are frozen once the round ends, or the board would disagree with the screen.
  Cast/director was ruled out on purpose: for a film anyone knows that isn't a
  hint, it's the answer.
- **The board carries guesses AND hints**, which is the whole point -- solving
  in two with the plot handed to you isn't the same round as solving in two
  cold. `teamPostPosterResult`/`teamLoadPosterBoard` (team.ts) write
  `misc/arcade/shared-postergame.json`. It ALSO posts to the hub's cross-game
  store via `teamArcadePost("poster", clean, "")` on a solved day only, where
  `clean = 7 - guesses - hints` (higher is better, 6 = first guess cold) so the
  hub's `mode: "wins"` counts days solved and its max-based detail column
  means something.
- **The word board's post logic is now shared** -- `writeDailyBoardRow()` +
  `parseDailyRow()` in team.ts. The poster board needed the identical
  owner-tagging / replace-this-member's-row-for-today / 30-day-trim behaviour,
  and the first cut was a copy of `teamPostWordResult`. `teamPostWordResult`
  now goes through the same helper; its behaviour is unchanged.
- Local progress: `posterGameLoadState`/`SaveState` in `wordGame.ts` (key
  `PosterGameState`), same opaque-JSON-string contract as the word game's.
- **Verified**: `tsc` (both configs) + `yarn build` clean, all four new bridge
  names resolve in `dist/cep/jsx/index.js`, styles in the single bundled
  stylesheet, and 9 headless assertions on the pure logic (same date → same
  film, consecutive days differ, 600 days → 600 distinct films, pre-epoch
  dates don't index negatively, streak read off the most recent row, hints as
  the tie-break). **NOT visually verified** -- the browser-automation
  extension was unavailable that session, so the pixelation stages, the search
  flow and the leaderboard layout have only been reasoned about, not seen.

## WORDMARK: the word puzzle + the team board (named "DAILY" when written)

The second arcade egg, and the chill one -- asked for as something
non-skill-based to dip into during a render. Trigger word: `daily`. Five
letters, six guesses, ONE puzzle a day. Built on `arcade/ArcadeFrame.tsx`
(which gained a `fluid` prop: DOM-laid-out games size to their content instead
of the canvas aspect box).

**THE SYNC COSTS NOTHING, AND THAT'S THE DESIGN.** The answer is derived from
the DATE (`puzzleForDay` in DailyWord.tsx), so every machine in the studio
independently lands on the same word each day -- no server, no clock sync, no
coordination. Day math collapses the LOCAL calendar date onto a UTC timestamp
so the puzzle turns over at local midnight and a DST shift can't produce a 23-
or 25-hour day that skips or repeats a word. The list is strided by a prime
coprime with its length (7919 vs 687 words), so consecutive days aren't
alphabetical neighbours and every word is used before any repeat -- ~1.9 years.

**SUPERSEDED -- posting is now AUTOMATIC, and the leaderboard is always on.**
The first version hid results behind a "Share with the team" click, on the
reasoning that a shared drive shouldn't receive anything as a side effect of
playing. Changed on direct instruction: a word-game score is low stakes, and
a leaderboard nobody remembers to post to is a dead leaderboard. The tradeoff
is handled by being OPEN about it rather than by asking -- the panel's hint
line reads "result posts to the team board", so it is never a surprise. **If
this ever needs to become opt-in again, the honest fix is a per-member
toggle, not silence.**

What did NOT change: `teamPostWordResult` still REFUSES to post from an
untagged machine rather than guessing at a name (surfaced as a quiet inline
note, not an error toast), reposting REPLACES that member's row for the day
so replaying can't stack duplicates, and the file is trimmed to 30 days.

**The leaderboard** aggregates the rolling 30-day window per member:
today's result, current streak, best single round, and total guesses
(`standingsFrom` in DailyWord.tsx). Sorted by streak, then best round, then
fewest total guesses -- which rewards showing up rather than one lucky day.
**Streak is carried IN each posted row and read off that member's most recent
row, never recomputed from the board**: a streak is counted on each person's
own machine, which knows which days they actually played, whereas the board
only sees days they were at their desk -- recomputing would quietly
under-count anyone who missed a weekend.

**SHARED FILES NOW LIVE IN A `misc/` SUBFOLDER of the team folder** (asked
for directly, so the odds and ends have somewhere to live without cluttering
the folder people navigate for profiles). Migration matters here and is
handled: the v1 files are already at the team folder ROOT on the studio NAS,
so `readSharedFile` prefers `misc/<name>` and FALLS BACK to the root, while
`writeSharedFile` always writes to `misc/` (creating it on first use, and
falling back to the root if it can't be created rather than losing a share).
Net effect: the first time anyone shares anything, that library is read from
the old location and written to the new one -- it migrates itself, nothing is
orphaned, no manual step. Same legacy-fallback shape `teamApplyProfile`
already uses for the flat `profiles/` layout. **Don't "tidy" the fallback
away until every studio machine has shared at least once.**

Per-machine progress is `wordGame.ts` (`app.settings` key `WordGameState`,
one opaque JSON string -- the frontend owns the format, so it can evolve
without an ExtendScript change, same "opaque strings" reasoning as
PROFILE_KEYS). Streak only advances on a day actually solved, keyed on
`lastSolvedDay` so replaying can't inflate it.

**Everything degrades quietly**: no CEP bridge (browser preview), no Team
Folder, or an unmounted NAS are all NORMAL states -- the game stays fully
playable, just without persistence or a board. Only an explicit Share click
ever surfaces a message.

**`arcade/words.ts` is ~690 curated 5-letter words (~5 KB), and guesses are
deliberately NOT validated against a dictionary** -- any five letters are
accepted. That would be wrong for a competitive word game but is right for
this one: a spellchecker rejecting a real word you typed is far more annoying
than a nonsense guess slipping through, and proper validation would mean
shipping or downloading a real dictionary. If that's ever wanted, the honest
fix is a public-domain list (ENABLE/SCOWL) in `src/js/public/`, read the same
scheme-aware way described under "Node `https` vs browser `fetch`" above --
do NOT pad words.ts out
by hand. **Don't call it Wordle** -- NYT owns the name.

**The on-screen keyboard is not decoration.** AE's key delivery to a CEP panel
is the flakiest part of this whole area (see ArcadeFrame's header), so
clicking must always work even if keystrokes never arrive at all.

**Verification**: `tsc -p tsconfig-build.json` + `yarn build` clean (the
`wordGame.ts` "Cannot find name 'app'" lines under the FRONTEND config are the
usual ExtendScript ambient-globals noise, same as team.ts/motionTools.ts).
Played end to end in browser preview against an answer computed INDEPENDENTLY
in Node from the same formula ("money" for 2026-07-24, day 204, index 339):
board renders 6x5 with 28 keys, two probe guesses scored EXACTLY as predicted
including position-sensitive present-vs-correct ("steam" -> absent/absent/
present/absent/present, "mount" -> correct/correct/absent/present/absent),
winning via the on-screen keyboard gave five greens and "Got it in 3", key
colouring propagated correctly, and the no-bridge Share path failed quietly
("No team folder available from here.") with zero uncaught errors and the game
still playable. NOT verifiable in preview: the actual NAS round trip (posting
and another machine reading the board) and whether AE delivers physical
keystrokes -- the same macOS-CEP unknown every game here carries.

## CHAIN: the movie-linking game (Cine2Nerdle Battle clone) -- SLICE 1

Trigger word `chain`. Link films by a shared **actor, director, writer,
composer or cinematographer**, 25s per turn, each person usable **3 times**.
Built as the first slice of a head-to-head battle game; this slice is
SINGLE-MACHINE (turns alternate between two seats at one keyboard).

**Researched, not guessed** -- the real Cine2Nerdle Battle rules: 25s turns;
links via cast/writer/director/composer/cinematographer; each linking person
capped at 3 uses; 3 pre-chosen bans your opponent can't use; lifelines (skip,
pass back -- 2 passes = draw, buy time, reveal cast list); you lose by running
out of time; optional gamified win conditions ("play 8 non-MCU sci-fi").
Sources: cinenerdle2.app/how-to-play?mode=battle, plus ResetEra/RetroGameTalk
threads describing the mechanics in text (the site itself is a JS app and
returns nothing to a fetcher).

**Why single-machine FIRST**, when the ask was networked head-to-head: this
slice exercises the entire turn machine -- whose turn, the per-turn clock, the
chain, the shared usage tally, losing on time -- with no sync in the way.
Battle mode then becomes "replace the local turn-swap with two files on the
Team Folder", on rules already proven. Building lobby + sync + rules at once is
how all three end up half-working.

**The user's two prototypes (`tmdbChain.ts`, `useGameChannel.ts`, in the
parent folder) were scrapped**, for concrete reasons worth keeping:
- `tmdbChain.ts` used `fetch()`. **That dies in the packaged panel** -- a
  `file://` origin can't do cross-origin fetch. Replaced with Node `https`
  (`arcade/cine/tmdb.ts`), the same escape hatch `wrikeApi.ts` documents,
  with a `fetch` fallback ONLY for browser preview. Note the dispatch is on
  NODE AVAILABILITY, not URL scheme -- the opposite of the filesystem-reading
  rule (see "Node `https` vs browser `fetch`" above),
  deliberately: there the question is which filesystem, here it's purely
  which transport dodges CORS.
- It also linked on cast/director/writer only. **Composer and cinematographer
  are not optional** -- a live spike found Heat -> The Insider links through
  Dante Spinotti (DoP) as well as Al Pacino, so the prototype would have
  rejected real moves.
- `useGameChannel.ts` used Supabase Realtime. **Dropped entirely**: the studio
  works remotely via Jump, so the PANEL ALWAYS RUNS ON A STUDIO MAC and is
  never actually off-network. That kills the only reason to add a WebSocket
  service, a dependency, an anon key in the ZXP, and an RLS question. The Team
  Folder already does this job.

**TMDB key is committed deliberately** (confirmed): free, rotatable,
read-only, internal tool, and a ZXP is an extractable zip regardless. Contrast
`WrikeApiToken`, a real secret in app.settings and excluded from profiles.
TMDB's terms require the attribution line -- it's rendered in the game; keep it.

**Structure, and keep it this way**: `tmdb.ts` fetches (+ per-session credits
cache -- credits never change, and it's what keeps a validation under a
second), `chain.ts` decides (PURE, no React/network -- directly unit-testable,
which matters because a subtle bug in the 3-use rule makes the game quietly
unfair rather than visibly broken), `CineChain.tsx` renders.

**Real bug found by testing, fixed**: the opening film silently swapped a
moment after appearing, because `start()` ran twice on mount -- StrictMode
double-invokes effects in dev AND this panel is separately known to mount
React twice on a CEP cold start. Each run picked a different random film and
burned a TMDB call. Guarded with a `bootedRef` on the MOUNT path only; "New
chain"/"Try again" still call `start()` directly every time.

**Verification**: `tsc` (both configs) + `yarn build` clean. `chain.ts` unit-
tested headless against 8 cases -- valid link, no link, already-played, same
film, 3-use exhaustion falling through to the next usable link, all-links-spent
(distinct message), purity of `spend`, and **a person credited as BOTH Director
and Writer deduping to ONE person and ONE usage**. Played end to end in browser
preview against the live API: TMDB reachable, opening film loads, a real link
("Passenger" -> "Bad Boys for Life" via Jacob Scipio) grew the chain to 2,
swapped to Player 2, reset the clock and logged "via Jacob Scipio P1"; an
invalid film was rejected with the right reason; the clock running out gave
"Player 2 ran out of time", hid the search box and offered New chain with the
chain preserved. NOT verified: Node-`https` transport inside the real AE panel
(preview exercises the fetch fallback) -- low risk, since wrikeApi.ts already
proves that path, but it's the first thing to check in AE.

### CHAIN polish round: focus, anti-spam, posters, hints-right, theming

Five things from first real use, all fixed:

- **THE KEYBOARD TRAP MADE THE SEARCH BOX UNTYPEABLE** ("the text cursor gets
  swallowed quickly and I can't type"). ArcadeFrame re-focuses its hidden
  input every 400ms so AE keeps forwarding keys -- which yanked the caret out
  of CHAIN's own <input> several times a second. **Fix, and it's the general
  rule now: the keygrab only needs SOME editable field focused, so it stands
  down when `document.activeElement` is already an input/textarea/select/
  contenteditable.** The stage's mousedown handler skips too, since mousedown
  fires BEFORE focus moves and would otherwise fight the click that's about to
  focus that field. Any future game with a text field would have hit this.
- **One attempt per search.** The result list used to survive a rejected
  guess, so you could click straight down it until something stuck -- a
  brute-force lottery, not a game. Query and results are now cleared BEFORE
  the verdict is known, and the in-flight search is cancelled.
- **Re-focus after a guess had to move into `finally`.** The input carries
  `disabled={checking}` during the lookup and a disabled field silently
  refuses focus, so the inline `focus()` calls did nothing; it's now a
  `setTimeout(...,0)` after `setChecking(false)` re-enables it. Matters under
  a 25s clock.
- **Posters everywhere** (current film, results, chain) via TMDB's w92/w154
  CDN. Fixed 2:3 boxes with a dashed placeholder so a film with no artwork
  doesn't collapse the row and make the list jump.
- **Layout is a CSS GRID with named areas, not flex** -- because the three
  blocks need DIFFERENT orders per breakpoint. Wide: hints in a right-hand
  column spanning full height, matching where Cine2Nerdle keeps its tools.
  Narrow (<=640px, which is MOST docked AE panels -- measured 490px in
  preview, ~500px is this project's stated design target): board, then hints,
  then chain -- the hints must land under the search box, NOT after the chain,
  or they're a scroll away exactly when needed. Results and chain are each
  capped with their own scroll; without that the result list grew the panel
  until the film you're linking FROM and the box you type INTO were both
  scrolled off the top.
- **Themed off `--ov-accent`**, the token themes.ts actually sets, so the game
  follows the user's chosen theme instead of hardcoded teal (fallbacks kept
  throughout). Player 2's badge stays a fixed orange so the two sides can't
  collide on a warm theme.

Verified in preview: caret held by the search box across six 400ms keygrab
ticks; 6 results each with a poster, cleared to 0 after one guess with the
caret returned and the box immediately typable again; hints above chain when
narrow; side panel to the right and top-aligned at 900px wide with 15 hint
chips. The user's two prototype files were deleted.

### XYiNerdle: rename, tools, and a much bigger starting pool

- **Renamed.** Trigger word `chain` -> **`xyinerdle`**; frame title
  "XYiNerdle"; launch-card copy "Aaron will never see this coming". The file
  is still `arcade/cine/CineChain.tsx` -- renaming the module would churn
  imports for no gain, same reasoning the XYTools rename used (see that
  section: user-facing strings renamed, internals deliberately left).

- **FOUR TOOLS, one use each PER PLAYER** (`TOOLS` / `FRESH_TOOLS` in
  CineChain.tsx). Per-player, not per-game, on purpose: a shared pool would
  let whoever moves first strip every tool before the opponent's first turn.
  - *Cast & crew* -- reveals the linkable people. Once bought it stays
    toggleable (hide/show) for that player; it's the only one that isn't
    strictly one-shot, because paying again to re-read what you already
    unlocked would just be a tax.
  - *+7 seconds* -- adds to the running clock.
  - *Skip turn* -- hands the turn over with the film UNCHANGED, so the
    opponent inherits the problem you couldn't solve.
  - *Ban film* -- burns the current film and redraws a new one for the SAME
    player. Everyone on the rejected film is pushed to their cap via
    `exhaustAll`, so a ban is NOT a free re-roll: it permanently removes that
    whole cast and crew from the game for BOTH players, including links you
    might have wanted later.
  Spent tools stay visible at reduced opacity rather than disappearing -- you
  need to see at a glance what you've already burned.

- **Ban redraws are labelled correctly in the chain.** A link with no `via` is
  either the opening film or a ban redraw; `player` is what distinguishes
  them ("redrawn after ban" vs "opening film"). Caught in testing -- ban
  entries were rendering as "opening film".

- **STARTING POOL: `/movie/popular` was the wrong endpoint and it showed.**
  "Popular" means popular RIGHT NOW, so page 1 came back entirely from the
  current year (verified: all 20 were 2026) and the same handful kept
  recurring. Replaced with `/discover/movie?sort_by=vote_count.desc` +
  `vote_count.gte=1000`, excluding genres 99/10770 (documentary, TV movie --
  both full of things nobody could chain from). Most-rated is a good proxy for
  most widely known, and it spans decades instead of months. Drawn from a
  random page of `POOL_PAGES = 15`, so **~300 films rather than 20**.
  Verified: 12 consecutive draws gave 12 unique titles across the 1990s-2010s
  (Titanic, Amelie, Edward Scissorhands, No Country for Old Men, The Godfather
  Part II). **If starting films ever look repetitive again, check the endpoint
  before the page count.**

Verified in preview: old `chain` keyword dead and `xyinerdle` live with the
new card copy; +7s adds to the clock then disables; cast reveal populates and
relabels to Hide/Show; skip moves P1->P2 with the film unchanged, clock reset
and a FRESH tool set for P2; ban swapped "The Hunger Games: Mockingjay - Part
1" for "The Godfather Part II (1974)" keeping the turn with P2, grew the
chain, reset the clock and spent the tool. `exhaustAll` unit-tested headless
across 6 cases -- including that a link valid before a ban is rejected after
it with the right message, that a part-used person is pushed to exactly MAX
rather than incremented past it, and purity.

### XYiNerdle: free-cast window + the lobby menu

**Cast & crew is free for the first `FREE_CAST_ROUNDS` (5) rounds, then costs
your one use.** Counted across the WHOLE GAME (chain length), not per player
-- a shared grace period while nobody has a feel for the chain yet, closing
for everyone at the same moment. Per-player free rounds would instead reward
whoever happened to move second. The tool renders `--free` (full strength,
accent-coloured "N free" badge) rather than `--spent` during the window, and
the side note counts down.

**`NerdleMenu.tsx` now sits IN FRONT of the game** -- Play / Leaderboard tabs,
a solo card, the team roster with per-member colours, and invites. The game
component (`NerdleGame`) only mounts once a choice is made, which also means
**the opening film isn't fetched until someone commits to playing** -- opening
the menu used to be worth a wasted TMDB call.

Backend is four functions at the bottom of `team.ts`, on the same shared-file
plumbing as everything else (so they land in `misc/`, inheriting the NAS-safe
read/write behaviour): `teamNerdleInvite` (sender taken from the machine-owner
tag, never typed -- same rule as the word board; one live invite per pair, so
re-inviting replaces rather than stacks), `teamNerdleLobby` (me + incoming +
outgoing + results in ONE round trip, because each is a NAS read and the menu
shows them together), and `teamNerdlePostResult`.

**SCOPE (superseded -- battle has since landed, see the section below).** This
slice was the LOBBY only: creating a room and inviting someone wrote to the
Team Folder and showed on their panel, but accepting opened the local two-seat
game under that room code. **There is no push on a file share**: an invite is a
row the other panel notices when it looks (on open, or the 15s poll while the
menu is open). That's the honest ceiling of the Team Folder approach -- fine
for "fancy a game?", not a doorbell, and still true now that real matches
work.

Verified in preview: menu renders with both tabs, a generated room code, and
the correct no-bridge guidance ("tag this machine..."), the game genuinely
does NOT fetch a film until Play is clicked, the leaderboard shows its empty
state, and solo start works. The free-cast counter was driven 5 -> 4 -> 3 by
advancing the chain (via the ban tool, which grows it without needing a valid
link) with the side note tracking each step.

**Testing note for future sessions**: the restart button is labelled "New
XYiNerdle", and the 25s clock is real -- a test that does several TMDB
round-trips mid-turn will lose the game before it can submit. Use the ban tool
to advance the chain, or buy time with +7s, rather than fighting the clock.

### XYiNerdle: BATTLE (real head-to-head over the Team Folder)

The lobby now leads somewhere. `CineChain.tsx` routes a `{mode:"room"}` choice
to **`CineChainBattle.tsx`**; solo still mounts `NerdleGame`.

**ONE FILE PER PLAYER** -- `misc/battle/<ROOM>/playerN.json`, each side writing
ONLY its own file and reading both (`teamBattleRead`/`teamBattleWrite`/
`teamBattleCleanup` in team.ts). Two writers never touch the same file, so
there is no locking, no merge conflict, no lost update. Polled every 1.2s.

**EVERY TURN-CHANGING THING IS AN ACTION** (`battle.ts`) -- `seed`/`move`/
`skip`/`ban`/`time`/`timeout`. The first attempt stored only `moves` and
inferred the turn from who moved last, which made SKIP (passes the turn, no
move) and BAN (redraws, keeps the turn, burns a cast) **invisible to the
opponent** -- the two panels disagreed about whose turn it was and who was
still available. Both sides now replay the same timestamped log through the
same pure reducer (`deriveState`) and land on the same state by construction.
Ordering is by ISO timestamp; actions strictly alternate, so a mis-order would
need clock skew larger than a whole turn.

**The clock is DERIVED from the shared turn-start stamp**, not counted down
locally -- a panel opened mid-turn shows the right time, and neither side can
drift. `extra` (the +7s tool) is shared state for the same reason: added
locally, the two panels would disagree about when the turn ends and one would
call a timeout that hadn't happened.

**Four faults from the first attempt, each worth not repeating**: (1) the seat
was hardcoded to 1, so both players wrote player1.json and player 2 could
never move -- the seat now arrives as a prop, **INVITER = 1, ACCEPTER = 2**,
decided in NerdleMenu where we know which end of the invite we're on; (2)
validation could never pass, because `checkMove` got the previous film as
`{...,people:[]}` (the chain only stores a MovieRef) so every move was
rejected as "no shared cast" -- real credits are fetched and cached before
checking; (3) the turn/tool desync above; (4) BOTH clients posted the result
on timeout, double-counting the leaderboard -- the loser writes the `timeout`
action, only the WINNER posts the result. Exactly one writer.

**READY GATE (the fix that makes two machines actually workable).** Player 1
seeds the film and their 25s clock used to start immediately -- but the
opponent still has to open the panel, find the invite and accept, comfortably
more than 25 seconds. **Player 1 timed out and lost to an empty room, every
time.** Now a `ready` action: nothing is playable and no clock runs until BOTH
players press "I'm ready", and the SECOND ready is what anchors the first turn
(the reducer restarts the clock on any action but `time`, so this falls out of
the existing model rather than being a special case). Pressing Ready twice is a
no-op -- a second action would re-anchor and hand someone a free refill. The
lobby shows both seats and who's still missing.

**Two more real bugs found in the same audit:**
- `teamBattleRead` resolved the room by walking three nested folders checking
  `Folder.exists` at each level -- exactly what this file's own rule forbids
  (see the `File.exists` note above). One false negative on the NAS and BOTH
  panels read empty files and concluded the opponent never arrived. Reads now
  use a constructed path and let `readTextFile` answer by opening it.
- The winner posted results to `teamNerdlePostResult`, **which was never
  defined** -- a silent no-op, so the leaderboard could never fill. Now
  `teamArcadePost`.

**The demo bridge was stale and actively misleading**: `teamBattleRead` returned
hand-built objects in the pre-action-log schema (`moves`/`turnOwner`) and
`teamBattleWrite` threw writes away, so every sync overwrote what you'd just
done and Ready/skip/ban all looked broken in browser preview while being fine in
AE. It's now a real in-memory store keyed by room, holding the same JSON strings
the host would -- the two-seat flow is exercisable without a NAS.

**Verified**: 34 headless assertions across two suites replaying the real
reducer (the full tomorrow scenario, and the ready handshake specifically --
including that the later ready anchors regardless of order, and that a 5-minute
wait can't cost anyone the game), plus a forward audit that all 12 arcade
`evalTS` names resolve in the built `dist/cep/jsx/index.js`. Ready gate
confirmed in preview: seat flips to READY, button becomes "Waiting for…", clock
stays hidden.

**Still unverified against two real machines.** The model is unit-testable by
design (`deriveState` is pure, no React/network) but nothing here has been run
with two panels on the same NAS -- that's the one test that matters and it
needs the office Mac plus a colleague.

**Remaining ideas**: lifelines beyond the current four tools; richer win
conditions than timeout.

### XYiNerdle's in-game leaderboard read a file nobody wrote

Reported as "the leaderboard within the game panel is not syncing". It wasn't a
NAS/read problem: **`teamNerdleLobby` read `misc/xyinerdle-results.json`, and
NOTHING has ever written that file.** The winner of a battle posts through
`teamArcadePost` into the one arcade score store -- so the write landed
somewhere real and the read looked somewhere else, and the board stayed empty
however many matches were played. Exactly the same shape as the earlier dead
`teamNerdlePostResult` call, which is worth noting: **that fix moved the WRITE
without moving the READ.** When a shared-file call site changes, grep for the
other half.

Fix: results are DERIVED from the arcade store (`nerdleResultsFromScores` in
team.ts -- a versus row IS a result: poster = winner, `versus` = loser, `score`
= chain length). One place a head-to-head result lives, so the two halves can't
diverge again. Matches played before this landed are already in that store and
appear retroactively. The dead `SHARED_NERDLE_RESULTS_FILE`/`_TYPE` constants
are gone -- **and note they were still referenced by `isArcadeFile` and
`sharedTypeNoun` after removal, which `tsc -p tsconfig-build.json` did NOT
catch and `yarn build` happily shipped** (the same "compiles fine, dies in AE"
family this file already documents for `BATTLE_DIR`). The frontend tsconfig DID
catch it; run both.

**The board now shows who beat who** (`NerdleMenu.tsx`): per player W/L, best
chain, a current W/L streak badge, and their RIVAL line ("vs aaron 2–1") --
the rival is who they've PLAYED most, not who they've beaten most, so a losing
record against someone still shows. Below the standings, a "Recent matches"
list (`RECENT_MATCHES = 8`, newest first) spells out "antonio beat aaron · 17
films" -- standings say how someone is doing, this says what actually happened.
`standingsFrom`/`sortedResults` are exported, pure and unit-tested headlessly
(13 assertions: ordering, records, best-chain, both streak directions, rival
symmetry, loser-only players, malformed rows) for the same reason battle.ts's
reducer is -- a miscounted tally is quietly unfair rather than visibly broken.
demoBridge now serves the lobby's `results` from its own arcade-score fixture,
mirroring the host, so the browser demo shows a populated board.

**The other games' boards were never affected** -- DAILY and One Sheet read
their own board files, which their own post functions do write.

## A failed shared-file read used to blank a populated leaderboard

Real report: a snake run ended just as a render finished, AE hiccuped, and
EVERY cabinet's standings on the arcade home screen went empty until the panel
was closed and reopened. Two independent holes, both on the "an error is
rendered as data" fault line, and they compounded:

1. **Host: `readSharedFile` returns `null` for BOTH "no file yet" and "I could
   not read it"**, and every board reader flattened that to `[]` -- so an
   unmounted share, a NAS blip, or a read attempted while AE was busy was
   served to the panel as a legitimately empty board. `teamArcadeScores`,
   `teamLoadWordBoard` and `teamLoadPosterBoard` now return a **`read`
   boolean** (`entries !== null`) alongside the rows, so the caller can tell
   the two apart. `readSharedFile`'s own header now states the rule.
2. **Frontend: `ArcadeHub`'s `refresh()` overwrote good rows with `[]` on
   EVERY failure path** -- an `evalTS` that resolved `undefined` (busy bridge),
   a throw, or the empty board above. Leaving a game calls `refresh()`, which
   is why finishing a run at the wrong moment triggered it, and nothing
   retries, so it stayed blank until a remount re-read the file.

Fix, and the rule for any future board: **an empty result NEVER replaces rows
already on screen.** The store is append-only and trimmed, so it cannot
legitimately go from N rows to none -- an empty answer while we hold rows is a
failed read. `ArcadeHub` keeps the last good board, marks it `stale`, and says
so ("Couldn't reach the team folder just now -- showing the last standings I
read") with a Try again button, rather than silently rendering a lie. It needs
a `scoresRef` because `refresh` is deliberately stable (empty deps, so the
mount effect runs once) and can't see `scores` through its own closure.
DailyWord and PosterDaily got the same `read !== false` guard -- they already
kept the old board on a THROW, but an empty-`entries` result would still have
wiped them.

`res === undefined` (no bridge) and `read === false` (host couldn't read) are
different signals and both mean "don't trust this"; an **undefined `read` is
trusted**, so an older host that predates the flag still works.

Verified: both tsconfigs, `yarn build`, the flag present in
`dist/cep/jsx/index.js`, the new classes in the bundled stylesheet. **The
failure itself is not reproducible on demand** (it needs a busy bridge), so
the stale path has been reasoned through rather than triggered -- if it ever
shows the stale note when the NAS is plainly fine, suspect `read` before the
frontend.

Verified: both tsconfigs, `yarn build`, the derivation present in
`dist/cep/jsx/index.js` with no live reference to the old filename, and the new
classes in the single bundled stylesheet. **Not visually verified and not run
against the NAS** -- the real check is opening the board on a machine that has
won a battle and seeing the row appear.

## Theme picker gained two dials: surface (panel/OLED) and resting edge

The hidden theme picker (type `jacqui`) used to be one axis -- a theme = an
accent + a background tint. It now has two modifiers ALONGSIDE that choice,
both persisted per-machine (`OVThemeSurface` / `OVThemeBorders`, both added to
team.ts's `PROFILE_KEYS` so they travel with a member's profile) and both
defaulting to exactly today's look.

- **Surface: Panel | OLED.** OLED drops every SURFACE to true black -- Toolset
  tiles, category cards, tool-page panels, inputs, list rows. **The theme's own
  ground tint SURVIVES** (only Default, which has no tint to keep, goes fully
  black): an earlier cut forced `--ov-bg` to `#000` and the studio's note was
  that picking OLED then silently cancelled the theme you'd picked. OLED is
  about the surfaces sitting on the ground, not about erasing the ground.
- **Border at rest: Neutral | Group | Theme.** Where a button's outline colour
  comes from BEFORE you touch it. **Hover and starred are deliberately NOT
  affected and always stay on the group palette** -- that's the "which section
  is this" cue and it has to survive whatever the resting edge is doing. (The
  first cut had "theme" repaint the whole group accent; that was wrong, and the
  correction is the point of this dial.)

**Mechanism, and why it's CSS vars rather than React state**: `themes.ts`'s
`applyTheme(themeId, surface, edgeMode)` publishes everything at `:root` --
`--surface-0/-1/-2`, `--surface-border`, `--surface-divider`, the Toolset's
older `--tile-*` aliases, and six palette slots `--pal-N-border/-bg/-glow/-edge`.
The picker and the Toolset grid are BOTH mounted on the home screen in
unrelated subtrees, so a pick has to reach the grid live with no props between
them; the cascade does that for free.
- `--pal-N-border/-bg/-glow` are ALWAYS the group's own hue (hover/starred read
  those). Only `--pal-N-edge` follows the edge dial, and it is left UNSET on
  "neutral" so `--btn-edge: var(--pal-N-edge, var(--tile-border, #444))` in
  `Toolset.tsx`'s `groupAccentStyle()` collapses to the plain grey border.
- Hover fills are re-blended per surface: the shipped `#20403e`-style values
  are hand-tuned for a `#2a2a2a` tile and read as lit patches on black, so OLED
  mixes each hue against `#080808` instead. Precomputed in JS -- `color-mix()`
  is unavailable on this project's chrome74 target.
- OLED also sets `--tile-hover-ring: 1px`, feeding a 0-spread (i.e. invisible)
  inset ring in `Toolset.scss`'s hover rule. With no fill difference at rest, a
  black tile needs a crisp accent edge to read as a state change.

**The surface sweep (~400 sites across 31 stylesheets), done by script.** Every
neutral-grey `background`/`border` literal in `src/js/main` was rewritten to
`var(--surface-N, <the original hex>)`, so with the tokens unset nothing
changes. Rules the script followed, worth keeping if it's ever re-run:
- Only `background*`/`border*` properties -- a `color: #444` is text and must
  never become a surface token.
- Only near-neutral hexes (R/G/B within 8 of each other, max channel <= 0x60),
  so tinted status colours (`#7a2e2e`, `#2e6b3e`) and accents are left alone.
- Lines already containing `var(--` are skipped, so nothing gets double-wrapped.
- **`src/js/main/arcade/**` is deliberately EXCLUDED** -- the arcade commits to
  its own visual world (see the cabinet/marquee sections above), and blacking
  its surfaces out would flatten that on purpose-built design.
- **One manual fix the script couldn't know about**: `Tooltip.scss`'s arrow is
  a CSS triangle drawn with `border-*-color`, so its colour is the bubble's
  FILL, not an edge -- it takes `--surface-1`, not `--surface-border`. If
  another triangle-by-border is ever added, it needs the same treatment.

**Edge weights are three tokens, not one -- and that's the load-bearing part
of OLED.** The first cut used a flat `#262626` for every border and the real
panel read as washed out: once a card and its ground are the same black, the
BORDER is the only thing left saying where the container ends, and it has to
work on a theme's tinted ground too. So the sweep was re-tiered by the
ORIGINAL hex (which already encoded how heavy each edge was meant to be):
`<= 0x2f` -> `--surface-divider` (internal rules), `0x30-0x40` ->
`--surface-edge` (containers: panels, cards, section boxes), `>= 0x41` ->
`--surface-border` (elements: tiles, inputs, chips). OLED sets them to
`#212121 / #424242 / #303030` respectively. **If OLED ever looks flat again,
raise `--surface-edge` before touching anything else.**

**Three follow-ups from a real-panel look at OLED**, all cheap to revert
independently:
1. **Category cards read as HOLES on black.** They were on `--surface-1`
   (`#000`) sitting on a theme-tinted ground, i.e. DARKER than what they sit
   on -- the opposite relationship to everything else, and they're the largest
   masses on the home screen. Now `--surface-2 -> -1` (the "sits above" layer),
   and each takes its own category accent as a resting edge via
   **`--surface-cat-edge`, which is an INDIRECTION, not a colour**: OLED sets
   it at `:root` to the literal string `var(--cat-edge)`, which then resolves
   in each CARD's own context against the inline vars `categoryStyleVars()`
   already puts there. One root token, four different edges, no per-card
   plumbing. (`CATEGORY_COLORS` gained a pre-blended `edge` at 0.5 alpha for
   this -- same weight as the Toolset's resting edges.)
2. **Left-aligning `.action-grid` was TRIED AND REVERTED.** The centred
   wrapped rows leave orphans ("Quick FX" alone on its row) which read as
   scattered once every tile has a visible outline, but the studio prefers the
   centring -- `justify-center mx-auto` stays on BOTH the normal and the edit
   grid (they must match, or entering edit mode reflows every row). Don't
   "fix" the orphan rows again without asking.
3. **`--surface-divider` raised `#212121` -> `#2a2a2a`.** It was tuned before
   the tiles gained resting edges and had become the faintest thing on a
   screen full of loud outlines.

**Verification status**: `tsc -p tsconfig-build.json` + `yarn build` clean, all
four bridge names resolve in `dist/cep/jsx/index.js`, and `applyTheme` was
exercised headlessly against a stub `document` to confirm the token output for
each combination (defaults leave everything unset; a theme's tint survives
OLED; the group hues never move with the edge dial). **Not seen in a running
panel** -- the browser-automation extension was unavailable that session, so
the sweep in particular wants a real look at a few tool pages, not just the
home screen.

## Naming Audit (new tool) -- which convention is this file actually on?

`tools/NameAudit.tsx` + `.scss`, backend `nameAuditScan` in
`jsx/aeft/localise.ts`. **Registered under Localise only** (`categories:
["localise"]`) AND added to `LocaliseScreen.tsx`'s `TOOLS_ROW` -- Localise is a
bespoke landing, not a master-detail category screen, so **a registry entry
alone would have left it unreachable from that section**. Any future
Localise-categorised tool needs both halves.

Built because the studio now runs TWO naming conventions permanently -- masters
were never renamed (DGTL era) and deliverables generated since the 2026-07-31
change use the new form -- and nothing could answer "which one is this file
on?" without reading filenames by eye.

- **It never opens a file.** Everything the convention encodes lives in the
  NAME, so this is a directory walk feeding `nameGeneratorParse` -- the same
  pure parser Name Generator, Trott 2.0, PDF to CSV and File Name Check
  already share. Cost is one tree walk; `scanMastersForBestMatch` already
  walks the whole masters tree once PER ROW during a localise, so auditing a
  whole campaign is cheaper than one row of the run it precedes.
- **The DGTL token IS the convention test**, not something inferred from the
  other fields -- it's what decides field order in the parser itself.
- **Two modes ask different questions**: `masters` expects legacy and flags a
  file the master lookup can't anchor (no region/size/duration token, i.e.
  invisible to every CSV row forever); `batch` expects the new form and flags
  anything still on DGTL, plus name collisions.
- **Underscore folders are NOT blanket-skipped here.** It skips only
  `Auto-Save`/`_Archive`/`_Old`/`_DEV` -- matching what the real master lookup
  skips. A master in `_WIP` IS still findable, so flagging it would report a
  problem that doesn't exist. (This is the same overstatement that had to be
  corrected in the naming reference document; don't reintroduce it.)
- **Collisions are scoped PER FOLDER**, and are detected over every scanned
  record rather than by appending to rows that already had an issue. The first
  version did the latter and **a collision between two otherwise-clean files
  was therefore invisible** -- caught by the headless suite, not by review.
  Same stem in two different creative folders is normal and is not flagged.
- **Artwork tag is validated.** `parsed.artworkType` is `""` when none of
  DOOH/DFOH/DINTH/FOH matched, and an unrecognised tag is a real problem, not
  cosmetic: with no artwork anchor the parser cannot separate campaign from
  site and silently lumps them into `campaign`. **The authoritative list stays
  in `nameGeneratorParse`'s own `artworkTypes` array** -- the audit checks the
  parser's RESULT rather than duplicating that list.
- **Territory is validated, not just shape-checked.** The parser's own
  territory test is `/^[A-Z]{2}$/`, so "ZZ"/"QQ" satisfy it --
  `nameAuditKnownTerritory()` checks against the same `TC_COUNTRIES` table
  Cheeky T Check and `getTerritoryCountryCode()` already use, rather than a
  second list. **"OV" is deliberately accepted** in that slot: on a master it
  legitimately IS the suffix. A master that has wandered into a batch is
  caught by the separate, more precise OV check instead.
- **An isolated `OV` token in BATCH mode is flagged** as a probable
  un-localised master among the deliverables, reusing `hasIsolatedOvToken()`
  (the same signal `losOpenForEdit()` uses to decide copy-first) rather than
  re-testing. Confirmed it does not trip on "MOVEOVER".
- **Nothing on this page is a `<button>` except the two mode buttons**, so it
  can't trip the global `button:hover` blue documented above.

**Verified**: both tsconfigs + `yarn build` + the precedence audit clean;
`nameAuditScan` resolves in `dist/cep/jsx/index.js`; `.na-*` classes present in
the single bundled stylesheet. Driven in browser preview from BOTH routes
(search and the Localise tools row): both modes render, 0px horizontal overflow
at a 500px panel width, and a deliberately over-long filename ellipsises with
its badge still visible. **18 headless assertions run the REAL built bundle**
(`dist/cep/jsx/index.js` loaded into a `vm` context with stubbed
`Folder`/`File`/`app` + a `BridgeTalk.appName` stub, since the bundle only
publishes its namespace when it thinks it's inside AE) -- that technique is
reusable for any other pure ExtendScript logic in this repo and is the closest
thing here to actually testing the shipped code.

**Not run against a real folder tree yet** -- the demo bridge serves a fixture,
so the walk itself (`getFiles()` recursion over a real NAS tree, and how long
it takes on a big campaign) still wants a real-AE pass.

## Master lookup is now dual-convention and boundary-safe (`durationMatchesPath`)

`scanMastersForBestMatch` (`tools.ts`) matched a master's duration with a bare
`path.indexOf(duration)`. That had two problems, one live and one latent:

1. **LIVE BUG: it was an unbounded substring test.** `"5sec"` is inside
   `"15sec"`, so a 5-second row could match a 15-second master. Verified before
   the fix; the integration test now pins the correct behaviour.
2. **It only ever matched the `sec` form.** Masters are not renamed today, but
   if they ever move to the new `<n>s` convention the lookup silently stops
   finding them, surfacing as "no master matched" rather than anything pointing
   at this line.

`durationMatchesPath(path, duration)` replaces it: accepts BOTH `10s` and
`10sec`, and requires the digits not to be preceded by another digit -- which
is exactly what kills the 5-vs-15 false match.

- **The trailing side is deliberately loose (any non-digit), NOT a required
  separator.** A real master named `..._10secOV.aep` with no separator must
  keep matching. This is what makes the change safe: it can only ever REMOVE
  matches where the duration was preceded by a digit, i.e. matches that were
  wrong anyway.
- **An empty duration still means "no constraint"** and matches everything,
  preserving exactly what `path.indexOf("")` did.
- **`durationForMasterLookup` was deliberately NOT changed.** Only the matching
  predicate moved. That keeps the blast radius to one function:
  `buildDeliverableName` still reduces to bare digits for the written name (so
  no output filename changes), and `rep.duration` still reads "15sec" in the
  run report.

**This means a masters rename to the new convention needs NO code change** --
the lookup already accepts both, including mid-rename when both forms sit on
disk at once. The remaining work for that day is docs plus the Naming Audit's
masters-mode "on the NEW convention" flag, which would start firing on every
renamed master and should become a neutral tally.

**Verified**: 12 assertions on `durationMatchesPath` and 9 end-to-end on
`scanMastersForBestMatch` (fake masters tree driven through the REAL built
bundle), covering unchanged legacy behaviour, the fixed false match, renamed
masters, and a mixed mid-rename tree. Note the harness needs `exists: true` on
its Folder stub -- `scanMastersForBestMatch` gates on `root.exists`, which is
the documented safe use of `.exists` (a directory, not a file).

## CSV Localiser: lazy territory scan + per-row master preview (ONE tree walk)

Two changes that belong together, both from the same complaint: the scan did
far too much work up front, and you only learned a row had no master *during*
the run.

**1. The scan is lazy now.** `runScan` used to loop EVERY territory and read
and parse EVERY Specs PDF (plus an output-folder listing per batch) before you
had opened anything. It now calls `scanTerritories` and stops -- names only.
`loadTerritory(t)` does the expensive half, once, when a territory is expanded
(guarded by a new `TerritoryScan.loaded`). Collapsing keeps what was read, so
reopening is free. **Same eager-to-lazy move Localised Library's JPG_PNG browse
already made, for the same reason** -- see that section; if a future scan here
starts feeling slow again, this is the pattern.

**2. `scanMastersForBestMatch` walked the whole tree PER ROW.** A 14-row batch
walked the NAS 14 times. Split into `buildMastersIndex(root)` (one walk,
pre-computing canon path / ratio / orientation) and `pickBestMasterFromIndex()`
(the scoring, extracted verbatim). `scanMastersForBestMatch` is now those two
composed -- identical contract, identical answer -- and `csvLocaliserRun` builds
the index ONCE for the whole run instead of per row.
- **ORDER IS LOAD-BEARING.** The scoring keeps a candidate on `diff <= min`
  (not `<`), so among equally-good matches the LAST visited wins. `buildMastersIndex`
  must therefore walk depth-first, recursing at the point a folder is met,
  exactly as the original fused loop did. Don't "tidy" that into a
  collect-folders-then-recurse pass; it would silently change which master wins
  a tie.
- Verified by the pre-existing 9-assertion `scanMastersForBestMatch` suite
  passing unchanged across the refactor -- which is precisely why those tests
  were worth writing.

**3. `csvLocaliserResolveMasters(mastersPath, rowsJson)` -- read-only preview.**
Builds the index once and scores every row through the SAME
`pickBestMasterFromIndex` the run uses, so the preview and the real run cannot
disagree. Opens nothing, writes nothing. Rows arrive as a JSON STRING (nested
objects don't survive evalTS's source-splice -- see the ease copy/paste round 3
note). Each row comes back `{master, path}` with `master: null` for no match.

**UI**: a new indicator column, second (right after the checkbox), with three
deliberately distinct states -- found (green, master filename in the tooltip),
none (red, "this row would be skipped"), unknown (quiet grey: no masters folder
set is a NORMAL state, not a warning). Resolution runs once per territory on
load, again when `aepPath` changes (otherwise open territories sit on "not
checked" forever), and again from the per-batch **Re-check** button. It resolves
against the EFFECTIVE rows, so correcting a mis-parsed size in place re-answers
whether a master exists -- the main reason to correct it.

**The `.specs-*` styles live in `formTool.scss`, NOT `tools/CSVLocaliser.scss`**
-- that same-named file exists but **nothing imports it**, so anything added
there is silently dead. Caught by the new rules not appearing in the bundled
stylesheet. Check the import before adding to a tool's `.scss` here.

**Verification**: both tsconfigs + `yarn build` + the precedence audit clean;
all five bridge names resolve in `dist/cep/jsx/index.js`; `.specs-master--*` in
the single bundled stylesheet; thead/tbody cell counts confirmed still equal (8
and 8) so the new column can't skew the table. 10 new headless assertions on
the resolver against the REAL built bundle -- including that it agrees with
`scanMastersForBestMatch` row for row, that `_Archive` is excluded, and that a
4-row batch drops from 16 `getFiles()` calls to 4.

**NOT exercisable in browser preview, and that predates this change**: the
scan needs Node `fs`, which `lib/cep/node.ts` stubs to `{}` whenever
`window.cep` is absent, plus real Specs PDFs and a real masters tree. The
backend is well covered by the harness; the UI itself needs a real-AE pass.

## Localise landing: rebalanced hierarchy + the setup path

The landing's largest, brightest object was the Localised Library hero -- a
BROWSE tool -- while the page's actual job (localise a campaign) sat below it
as a flat grey panel. The eye went to the secondary thing.

**The Library hero is NOT demoted -- that was explicitly ruled out** ("my team
need to know it's there, it's a big tool"). It keeps first position, full
width, its icon badge and its arrow. What changed is that it stops *competing*:
half the vertical bulk (146px -> 74px), a 38px badge instead of 54px, resting
glow off (hover only), a flat `--surface-1` ground instead of a teal wash, and
**a single 2px teal left edge** carrying the section identity instead of an
all-over gradient. Still unmistakable, no longer the loudest thing.

**The three setup fields are now a PATH, not a stack** (`.specs-setup` /
`.specs-branches` in `formTool.scss`, markup in `CSVLocaliser.tsx`). Markets and
Masters are not independent inputs -- they are two folders under one job, and
Markets is usually derived from the campaign, so they branch off it with a rail
and a status dot each. This is structure encoding something TRUE (the
derivation), not decoration.
- **Filled = solid accent dot + solid input border. Missing = hollow dashed dot
  + dashed input.** An empty REQUIRED folder was previously the lowest-contrast
  thing in the panel, which matters more now that an unset masters folder is
  what leaves the new per-row master indicators grey. The Masters branch also
  carries a one-line "why" when empty.
- Fixed 22px rail padding, so it holds at a ~500px docked panel.
- **The rail and dots anchor to the LABEL'S centre, not the row top** -- the
  row begins above its label (the body has its own gap), so anchoring to the
  row floated both ~5px high, which is visible at a glance. `$rail-y` in
  `formTool.scss` is that centre, measured off the rendered label rather than
  guessed; the dot and elbow are both derived from it, so if the label's size
  or the body's gap changes, re-measure that ONE number.
- **The vertical rail is drawn per row as `top: -gap; bottom: 0`, so
  consecutive rows TILE into one continuous trunk**, with
  `&:last-child::after` swapping to a fixed height so it stops on the last dot.
  `:last-child` is fine on chrome74 -- it's `:has()` that isn't. Two earlier
  versions were wrong: (1) one trunk on the container with `bottom: 50%`, but a
  percentage can't know where the last dot lands (rows aren't equal height --
  Masters grows a hint line), so it overshot or stopped short; (2) a per-row
  stub from just above each dot down to it, which drew short floating segments
  instead of a trunk and was visibly disconnected. Verified by measuring: the
  segments tile with a 0px gap, the first starts on the campaign field's bottom
  edge, and the last ends on the last dot's centre.

**Settings stopped wearing button costumes.** "Skip existing files" and "Run MC
It! inline" are settings but were rendered as button-shaped objects the same
height as the primary action, so three things read as three actions. They now
sit quietly on the left of `.specs-run-row` with the action at the right, and
**"Scan Specs" went from ~760px wide to 168px** -- width is not the only way to
say "primary". Relabelled **"Scan territories"**, which is what it now does
(the scan lists territories; specs are read on expand).
- Below 560px the row wraps, and the action takes the **whole line** rather
  than sitting stranded and left-aligned under the toggles. Plain `@media`,
  never `@container` (chrome74).

### GOTCHA: JSX ATTRIBUTE strings do NOT process backslash escapes

Shipped and caught only from a screenshot: placeholders rendered the literal
text `…` on screen. In a JS string `"…"` is an escape and produces
`…`; in a **JSX attribute** (`placeholder="Select a campaign…"`) it is
taken literally, backslash and all. Template literals in the same file were
fine, which is why it looked inconsistent.

**Write the real character (`…`, `—`) rather than an escape** -- a real
character renders correctly in BOTH contexts, so it is never wrong. Worth
knowing when patching this codebase with a script: emitting `…` to dodge
shell/encoding trouble silently breaks any JSX attribute it lands in.

**Verified** at both widths by DOM measurement (screenshots were unavailable
for part of this): 1374px -- hero 74px, action 168px right-aligned, run row on
one line; 500px -- zero horizontal overflow, hero title not clipped, inputs
inside their container, action filling the line. Branch state machine confirmed
by driving the real React onChange: filling Markets flips it to solid teal and
enables Scan while Masters stays hollow with its hint.

### Tools row: even grid, no dividers, no captions

The wall of 9 pills was a wrapping flex row with a hairline between every item
and a trailing 9px `Play` glyph on the three run-in-place ones.

- **Dividers removed.** A rule between every item says "these are all equally
  unrelated" -- noise standing in for structure.
- **`display: grid` with `repeat(auto-fill, minmax(148px, 1fr))`**, so the wrap
  is even instead of a ragged last row, and stays even as tools are added.
  `minmax(0, ...)` semantics plus `min-width: 0` + ellipsis on the label, so a
  long name truncates rather than widening its track.
- **The run-in-place marker is a 2px accent LEFT EDGE**, not a trailing glyph:
  it scans down the grid at a glance instead of having to be found at the end
  of each label, and echoes the Library hero's own teal edge.

**A labelled version was built and REJECTED** -- grouping the tools under
"RUNS HERE" / "OPENS A PAGE" captions. Correctly: it explains the team's own
tools back to them, and this is a 7-person studio that knows what its buttons
do. **Don't reintroduce explanatory captions here.** The distinction is real
(it's the `run` flag in `TOOLS_ROW`) but a mark carries it; a sentence is a
tutorial.

**The Tooltip-in-a-grid trap applies here** and is handled: each grid cell is a
Tooltip WRAPPER, not the button, and Tooltip's inner span carries
`flex: 0 0 auto !important` for its own positioning fix -- the same thing that
broke XYTools' tab bar and anchor grid. `.ls-grid > .ov-tooltip-wrapper` and
`.ov-tooltip-content` are forced to `display: block; width: 100%`, and the
button fills them. Verified by measuring: all 9 buttons render at exactly the
column width (160px at 1374, 207px at 500).

Verified at both widths: 1374px -> 5 even columns, rows of 5 + 4, zero
dividers, three teal edges; 500px -> 2 even columns, no horizontal overflow, no
truncation, everything inside the grid.

## Masters moved to the new convention too (2026-08-06)

The 2026-07-31 handover note was read as "deliverables change, masters stay on
DGTL". That was wrong: **all masters from now on use the new form as well.**
Real example, straight off the studio share:

```
FID_INTL_PortalToParadise_DOOH_1920x858px_15s_OV.mp4
FID_INTL_PortalToParadise_DOOH_844x2382px_15s_OV.mp4
```

i.e. no site token in practice, `_OV` still the master suffix, `px` on the size
and the short `s` on the duration. Existing masters were never renamed, so a
campaign folder now legitimately holds **both** forms and every master parser
has to read both, forever.

**What was actually broken — one parser.**

- `parseMasterFilename` (`jsx/aeft/review.ts`, OV Library's master scan) was
  `/^(.*)_(\d+)x(\d+)_(\d+)sec(.*)$/i`. A new-form master returned `null`, and
  `scanMastersForCreative` **skips a null with no error and no count** — the
  file simply wasn't in the library. Now
  `/^(.*)_(\d+)x(\d+)(?:px)?_(\d+)(?:sec|s)(.*)$/i`. The token REORDER
  (campaign/artwork swap, optional site) needed nothing: it all lands in group
  1, which OV Library only uses as an opaque grouping key. `duration` is still
  normalised to `"10sec"` so the sort key and every stored/displayed value are
  unchanged.
- Knock-on that would have been mystifying: `scanRendersForCreative`'s
  `Support/Motion_Components/_mp4` branch filters mp4s by master stem, so a
  dropped master also silently lost its preview video.

**What was already fine — do not "fix" these again.**

- `durationMatchesPath` (`tools.ts`) was made both-convention-aware when it was
  written (`(^|[^0-9])<digits>s(ec)?([^0-9]|$)`), so the CSV/localise master
  lookup and `pickBestMasterFromIndex` already find new-form masters.
  `durationForMasterLookup`'s `"sec"` suffix is NOT a convention assumption —
  it exists so a bare `"10"` can't match the `10` inside `1080x1920`. Its
  comment said otherwise and has been corrected.
- `nameGeneratorParse` reads both by design.
- The loose `/(\d+)x(\d+)/` in `checkAspectRatioRename` and the Trott image
  pairing match `1920x858px` unchanged.

**One behaviour change beyond the parser:** Naming Audit's `masters` mode used
to flag a new-convention file as "check this is really a master". That was only
true while masters were frozen on DGTL; it would now fire on every correctly
named master. Removed — masters mode flags neither convention, and the check
that still matters there is the anchor check (no region/size/duration token
means the master lookup can never find the file at all). `batch` mode still
flags legacy, unchanged.

**Verified**: `tsc -p tsconfig-build.json` clean; `yarn build` + the precedence
audit clean; OVLibrary.tsx clean under the frontend config too (that config
reports ~2000 pre-existing errors from resolving DOM `File`/`Folder` over the
ExtendScript ones — baseline noise, not from this change). The **real built
bundle** (`dist/cep/jsx/index.js` in a `vm` with stubbed `Folder`/`File`/`app`
+ `BridgeTalk.appName`, the technique from the Naming Audit entry) was driven
over a folder mixing the four `PortalToParadise` names above with a legacy
`..._1920x1080_15sec_OV.aep` and a junk `NotAMaster.aep`: all five real masters
parse with correct w/h/duration/orientation, the junk file is still dropped,
and the render stem pairs. Note the namespace attaches to `$["com.xyi.toolbox"]`
in that harness, not to the sandbox global. **Confirmed in a running panel**
against a real campaign folder (2026-08-06). A new-convention row was added to
OVLibrary.tsx's `MOCK_RECORDS` so browser preview exercises a mixed folder.

## OV Library reopens on the campaign you last used (2026-08-06)

It always opened on the OLDEST campaign on the machine, so the current one had
to be re-picked by hand every single time. Not a sorting bug --
`loadCampaignsRaw` returns campaigns in the order they were ADDED (`push`), and
`refreshCampaigns` took `camps[0]`.

- New per-machine key `OVLibLastCampaign` (`review.ts`), written whenever the
  selection changes, read on mount.
- **The fallback also changed**, and this half matters independently: with
  nothing remembered it now takes `camps[camps.length - 1]` -- the most
  recently added -- not `camps[0]`. A machine that has never picked a campaign
  still opens on something current.
- `removeCampaign` clears the key when it points at the campaign being
  removed. The frontend would fall through to the default anyway; this just
  stops a dangling name sitting in settings looking like a bug.
- **Deliberately NOT in `team.ts`'s `PROFILE_KEYS`.** Which campaign you had
  open is per-machine state, like usage history -- carrying it into someone
  else's profile would yank them onto a campaign they aren't working on.
  (`OVLibCampaigns` itself isn't a profile key either; campaigns travel via
  `teamShareCampaign`.)
- The persist call is fire-and-forget raw `evalTS`, **not** OVLibrary's own
  `safeEvalTS` wrapper -- that wrapper flips the whole panel into its "using
  mock data" banner on any failure, which would be an absurd outcome for a
  cosmetic write. Same reasoning as `quietEvalTS` elsewhere.

**Verified**: both tsconfigs clean on the touched files, `yarn build` + the
precedence audit clean, and 7 headless assertions against the REAL built
bundle (`dist/cep/jsx/index.js` in a `vm` with a stubbed `app.settings`)
covering the fresh-machine default, add-order, the last-added fallback, the
round-trip, and both remove cases. **Not yet seen in a running panel.**

## OV Library orientation chips adapt to the creative (2026-08-06)

Replaces the fixed default (Landscape-only, then briefly Landscape+Portrait)
with `pickDefaultFilters()` — module-scope and pure, so it is testable without
mounting the component:

    under 8 masters  -> every orientation the creative HAS is on
    8 or more        -> only the most numerous orientation

**Two deliberate generalisations of the rule as asked for** ("under 8 show
both, else landscape or portrait whichever has more"):

1. The small case turns on every orientation *present*, not literally
   Landscape+Portrait. A fixed L+P default leaves a square-only or QUAD-only
   creative showing "No masters match the current filters", which reads as a
   failed scan rather than a filter state. Same reason the empty-`recs` case
   falls back to L+P rather than all-off.
2. The large case picks the biggest group across ALL four orientations, not
   just Landscape vs Portrait. A QUAD-heavy creative would otherwise open on a
   couple of stray landscapes and hide the 30 masters actually in it. In
   practice the winner is always Landscape or Portrait, so this is invisible
   in the normal case.

Ties go to `ORIENTATION_ORDER`, so a dead heat opens on Landscape.

**Where it is called matters.** `setFilters` moved OUT of the creative card's
`onSelect` and INTO the scan effect, right after `setRecords`. At click time
the masters have not been scanned yet, so there is nothing to count — the old
call site could only ever apply a fixed guess. Leaving both in place would
also flash one chip set for a frame before the real one landed.

**Verified**: frontend tsconfig clean on the file, `yarn build` + precedence
audit clean, and 13 assertions over the rule (both threshold boundaries at 7
and 8, single-orientation creatives, square/QUAD-only, the dead heat, the
QUAD-heavy case, and empty). That harness mirrors the helper rather than
importing it — it pins the RULE, not the shipped bytes. **Not yet seen in a
running panel.** Expected against the real Fiducia folder: PortalToParadise
(9 masters, 6L/2P/1SQ) opens Landscape-only; Bracelet and Trio (4 each, 2L/2P)
open on both.

## OV Library creatives grid: the full-width orphan card (2026-08-06)

A campaign with 6 creatives rendered five normal cards and one card the width
of the entire panel. Reported against Forgotten Island; TRIO was the orphan.

**Cause was the deliberate "fill the row" rule**, not a wrap bug.
`.creatives-grid` was `display: flex; flex-wrap: wrap` with cards at
`flex: 1 1 0`, which makes every card ON A LINE share that line's width
equally. That is exactly what you want for a full row and exactly what you do
not want for a line holding one leftover card: it gets 100% of the width. The
old comment even documented the last row stretching as intended — it had only
ever been seen with 3-5 creatives, where the last row is also the only row.

**Now CSS grid, `repeat(auto-fill, minmax(170px, 1fr))`.**

- **auto-FILL, never auto-fit.** auto-fit collapses the empty tracks on a short
  final row and the surviving items stretch across them — i.e. it reintroduces
  precisely this bug. auto-fill keeps the empty tracks, so a leftover card
  stays one column wide. If anyone "tidies" this to auto-fit, the banner card
  comes straight back.
- 170px min was chosen to reproduce the card width five-across at the usual
  docked width, so the common case looks unchanged.
- `.creative-card` lost `flex: 1 1 0` / `flex-shrink: 0` (meaningless on a grid
  item) and gained **`min-width: 0`**. A grid item's default `min-width: auto`
  sizes to content, which would let a long creative name force its track wider
  instead of ellipsising — PORTAL_TO_PARADISE is already truncated in the UI.
- `.loading-row` / `.empty-row` get `grid-column: 1 / -1`; they are prose, not
  cards, and would otherwise sit in one 170px column.
- Incidental win: this drops a flex `gap` dependency (Chrome 84, the open
  question in CLAUDE.md §3) for a grid `gap` (Chrome 66, safely under the
  chrome74 target).

**Verified**: `yarn build` + precedence audit clean, and the file adds no
banned CSS (`minmax()` is a grid function, Chrome 57 — NOT the banned `min()`/
`max()` math functions; the two `aspect-ratio` hits in this file are the
pre-existing violations already listed in CLAUDE.md). **The layout itself has
not been re-seen in a running panel** — the fix is structural rather than
tuned, but the 170px figure is a judgement call and wants one look at a real
docked panel.

## OV Library thumbnails were showing frame 0 (2026-08-06)

A `<video>` at rest displays frame 0, and frame 0 of a DOOH render is
routinely the worst frame in the clip -- these ads open on a white flash, a
black hold or an empty plate. The creatives grid was full of blank-looking
cards for footage that looks fine a second later (BRACELET rendering as a
plain white tile was the reported case).

**Now parked at 25% of duration** (`POSTER_FRAME_FRACTION`), via a
`usePosterFrame()` hook.

- **One hook, two call sites.** CreativeCard and VariantBlock had
  byte-identical copies of the old `handleLoadedData`. That is precisely the
  arrangement where one gets fixed and the other silently doesn't, so the
  logic was extracted rather than patched twice.
- **Event sequencing is the whole trick.** `duration` does not exist until
  `loadedmetadata`, so that is where the seek is issued. The frame does not
  exist until `seeked`, so that is where the colour sample happens.
  `loadeddata` is kept ONLY as the fallback for a clip whose duration never
  resolves (stream, or a codec Chromium half-supports) -- guarded by
  `seekPendingRef` so a normal clip never samples frame 0 first and keeps that
  accent. Sampling on `loadeddata` alone was the old behaviour and is why some
  cards also had washed-out white accents.
- **Non-finite duration leaves it on frame 0** rather than assigning NaN to
  `currentTime`.
- **Hover still plays from 0** -- the offset governs what the card RESTS on,
  not where playback starts. `restToPoster()` on mouse-leave also fixes a
  smaller pre-existing wart: leaving a card used to strand it on whatever
  frame the hover happened to stop on, so a grid looked different after being
  scrolled past.
- Bonus: the accent colour is now sampled from a representative frame, so
  cards tint from actual footage rather than an intro flash.

25% was chosen for the 10s/15s durations the studio ships (2.5-3.75s in,
clear of the intro). It is a guess at what "representative" means and is the
one number here worth revisiting against real footage.

**Verified**: frontend tsconfig clean, `yarn build` + precedence audit clean.
The first attempt FAILED the build on a ref type (`RefObject<HTMLVideoElement>`
vs the nullable form this React version infers) -- caught by the gate, fixed.
**Not seen in a running panel**: this is video decode behaviour, so it cannot
be verified headlessly and browser preview has no real renders to load.

## Campaign hero banner: pinnable, static, and shared (2026-08-06)

The hero banner borrowed whichever creative thumbnail happened to be in play,
so it changed as you clicked around and a campaign had no settled identity.
Now pinnable per campaign, on the same hold-to-reveal interaction as the
creative thumbnails.

- **Backend** `OVLibCampaignBanners` in `review.ts` (campaign -> path,
  tab-separated, same shape as `OVLibThumbOverrides`). `removeCampaign` clears
  it alongside the last-campaign key.
- **UI**: ~1s hold on the banner reveals the button (matching CreativeCard's
  deliberate hold, not an instant hover); click to pick, right-click to reset.
  The button needs its own `z-index: 2` — `.ov-hero-overlay` is
  `position: absolute; inset: 0`, and two POSITIONED siblings fall back to
  document order, so the "positioned beats non-positioned" rule in CLAUDE.md
  does not save you here. It also re-declares `:hover`/`:active` against
  index.scss's global blue.
- **A pinned banner renders STATIC** — no `autoPlay`, no `loop`. A pinned
  video is parked via `usePosterFrame`. The automatic banner keeps its
  existing looping behaviour; pinning is what opts out.
- **Fixed in passing**: `.ov-hero-banner` only ever styled `video`, so the
  `<img>` branch (which has existed since overrides could be stills) rendered
  at natural size instead of being cropped to the banner. Invisible until
  pinned banners made stills the common case.

**Unlike per-creative thumbnails, this one TRAVELS.** `teamShareCampaign`
sends it, `teamSyncShared` applies it.

- **Re-sharing an already-shared campaign now updates the banner** instead of
  returning "already in the team library" and doing nothing. Without that a
  banner pinned AFTER the first share could never reach anyone. The masters
  root is deliberately NOT updated on re-share — re-sharing must not silently
  repoint a campaign the team already has.
- **Sync applies the banner to campaigns a machine ALREADY has**, not only to
  newly-added ones, so people who added the campaign by hand still get it. It
  never overwrites a locally pinned banner.
- **Path portability is not enforced.** A banner only resolves for others if
  it lives on the NAS; there is no reliable cross-platform "is this a shared
  volume" test, so a local path shares fine and simply falls back to the
  automatic banner elsewhere. That is the graceful failure, not a broken image.

**Verified**: both tsconfigs + `yarn build` + precedence audit clean. 8
headless assertions on the storage layer against the real built bundle
(round-trip, re-pin replaces rather than duplicates, per-campaign isolation,
clear, removal cascade, tab/newline injection, empty-path rejection) and 6 on
the share path using TWO sandboxes over one real on-disk team folder
(share -> sync -> banner arrives; re-share updates; a locally pinned banner
survives; an existing campaign with no banner adopts the shared one). Plus a
backward-compatibility run against the studio's REAL
`shared-campaigns.json` copied off the share — two entries, neither with a
`banner` field: syncs cleanly, invents nothing. **Not seen in a running
panel.**

Incidental finding, NOT fixed: the share holds two copies of that file,
`<team>/shared-campaigns.json` (1 entry, stale) and
`<team>/misc/shared-campaigns.json` (2 entries, current). Consistent with the
documented `arcade/ -> misc/ -> root` fallback chain, but worth knowing the
root copy is behind.

## Specs table header misalignment + duration multiples (2026-08-06)

### The header bug (CSV Localiser specs table)

Headers read ARTWORK / CAMPAIGN / SITE / SIZE / DUR one column LEFT of the data
they name. Not a CSS problem: the `<thead>` declared
`check, Artwork…Dur, master, revert` while `<tbody>` emits
`check, master, Artwork…Dur, revert`. **The cell COUNT matched**, which is
exactly why it looked like a styling issue and survived this long. master-col
moved to second in the header. If a column is ever added, add it in BOTH lists
in the same position.

### Duration multiples (new)

A 30sec deliverable with no 30sec master, where a 15sec (or 10sec) master
exists, used to be a dead red row. It can now be built by laying the creative
end to end. **Opt-in per row — never automatic.**

- `pickMultipleMasterFromIndex` (`tools.ts`) finds the candidate.
  **Smallest factor first**, so 30sec prefers 15sec×2 over 10sec×3 — fewer
  repeats means the longest real cut. Exact integer division only, capped at
  **4×** (`MAX_DURATION_MULTIPLE`); 20sec is not offered for a 30sec slot,
  because there is no sane way to play something one and a half times.
- The preview (`csvLocaliserResolveMasters`) returns the candidate; the run
  receives only the opted-in ROW INDICES and recomputes the factor with the
  same function, so the panel and the run cannot disagree about "×2".
- **Index re-mapping is the sharp edge.** Excluded rows never reach the CSV, so
  a table index of 5 can be CSV index 3. `runBatch` re-indexes against the
  filtered list; getting this wrong would build the WRONG row from a multiple,
  silently and plausibly.
- The build itself (`csvLocNameGen`): the delivery comp is always Frontcard +
  the Precomp holding all the edits, so **only that second layer is touched**
  (confirmed with the studio). Comp duration is set FIRST — a layer past the
  old end is legal but invisible, so a short comp would silently drop every
  repeat after the first — then the creative layer is duplicated and offset by
  its own span. Work area is reset to the new duration or a render comes back
  the original length. The creative layer is tracked by INDEX, never by
  holding the layer object (two accesses of one AE object return different
  wrappers, so `===` never matches).
- UI: its OWN column immediately after Dur (`.specs-row-mult-col`, 34px),
  because that is the field it modifies — it started life inside the master
  status column, which read as unintuitive and conflated a status with a
  control. Text only, no icon: "2×" is faster to read than any glyph at this
  size and costs less width. Amber, deliberately neither the green "found" nor
  the red "missing" of `.specs-master`, because it is an offer awaiting a
  decision; filled once chosen. Re-declares `:hover`/`:active` against
  index.scss's global blue.
- **The control CYCLES rather than toggles**: off -> 2× -> 3× -> off, driven by
  the factors the host said exist for that row. A 30sec row with both a 15sec
  and a 10sec master offers both; one with only a 15sec master offers 2× and
  nothing else. A stored factor that no longer exists restarts at the first
  option rather than sticking. This is why the resolver returns a LIST
  (`multipleMasterOptions`) and not just the best candidate, and why the run
  receives the chosen factor per row (`{"0":2,"3":3}`) rather than a set of
  indices — the user's pick has to travel, but it is still re-validated
  host-side (`multipleMasterForFactor`), falling back to "no master" if that
  factor stopped resolving.

**`csvLocNameGen` and the Trott/campaign-localiser nameGen contain a
BYTE-IDENTICAL 66-line block** (localise.ts ~150-215 vs ~2478-2543) — verified
with `diff`, which is why a text-match edit hit two sites and the change had to
be applied by line range. Only the CSV Localiser copy has the multiples logic.
If duration multiples are ever wanted in Campaign Localiser, that block is the
place, and the two should probably be extracted first.

Reminder that cost time here: **`grep` silently reports nothing on
`localise.ts`** (literal NUL byte -> treated as binary). It reads as "my edit
didn't apply". Use `grep -a`.

**Verified**: both tsconfigs + `yarn build` + precedence audit clean. 11
assertions against the REAL built bundle driving `csvLocaliserResolveMasters`
over a fake masters tree (prefers ×2 over ×3, exact match wins outright, the
4× cap, non-divisors, per-size, per-campaign, unknown campaign). Two initially
"failed" and were MY FIXTURE's fault — a file in the wrong creative folder
matched the neighbouring campaign, because campaign matching is a substring
test over the whole path. Worth knowing when writing masters fixtures.
**The AE-side build (comp stretch + layer duplication) has NOT been run in
real AE** — it cannot be exercised headlessly. That is the part to test on a
copy first.

## Specs batch opens as a modal (2026-08-06)

A batch expanded INLINE, inside the territory > batch nest, so its table was
squeezed into whatever width survived two levels of indentation — columns
collided and long site names truncated mid-word. The batch is the thing you
actually read and edit, so it now opens over the panel.

- **`createPortal` to `document.body`**, so no `overflow`/`transform` ancestor
  in the territory list can clip it — the same reason Tooltip portals its
  bubble.
- **The table JSX did NOT move.** The portal wraps it where it already sat in
  the tree, so it still closes over `b` / `key` / `builtFor` / `dupOf` /
  `incl` exactly as before. Relocating ~250 lines of deeply nested JSX to a
  helper would have been the riskier edit for zero behavioural gain.
- **z-index 1500** — deliberately between the toast stack (1000) and Dialog
  (2000). A confirm raised from inside this modal has to land on top of it.
- Follows the existing `.mcit-overlay` look (fixed + dim + blur) rather than
  inventing a second modal style. **`backdrop-filter` is Chrome 76 and the
  declared target is chrome74**, so the blur is enhancement only: the
  `rgba(8,8,10,0.74)` dim carries the effect on its own if it doesn't apply.
  `.mcit-overlay` already ships the same declaration, so this adds no new risk
  — and if blur turns out not to render in the real host, that is a pre-existing
  question about the target, not this modal.
- **The actions are repeated in a modal footer** (Localise batch / MC It! /
  Re-check). They still exist on the collapsed row, but that row is now behind
  the modal — reviewing rows and then being unable to run them would be an
  absurd place to leave someone. Same handlers, so there is no second code
  path, and `canRun` still gates them.
- Escape closes it, bound once for the tool and only while a batch is open so
  it cannot swallow Escape from the rest of the panel. Backdrop click closes;
  clicks inside stop propagation.

Sharp edge hit while building this: adding the footer put it AFTER
`.specs-modal`'s closing tag, leaving the div count balanced but the footer a
sibling of the modal inside the overlay. `tsc` was happy. Verified by reading
the emitted structure back rather than trusting the JSX to be balanced.

### The portal ate the table's styling (same day, immediately after)

First run in a real panel rendered the table as raw native inputs — white
boxes, no header. **Every `.specs-table` / `.specs-cell-*` / `.specs-row-*`
rule is NESTED under `.specs-tool` in formTool.scss**, and portalling to
`<body>` puts the modal outside the tool root, so not one of them matched.

Fix: the overlay carries **`className="specs-modal-overlay specs-tool"`**.
`.specs-tool` declares no properties of its own — it is purely a scoping
wrapper of nested rules — so adding it to a `position: fixed` overlay restores
the whole cascade and changes no layout.

**This is the general hazard with portals in this codebase, not a one-off.**
Anything moved to `<body>` leaves behind every ancestor-scoped rule AND the
category tint. The same portal also now copies `--cat-grad/-border/-glow/-icon`
off the tool root via `getComputedStyle` (`portalCatVars()`), which is the rule
CLAUDE.md already states for Dialog and DragOverlay. Consumers all have
`var(--cat-x, fallback)` so a miss degrades to the theme accent rather than to
nothing, which is exactly why this would otherwise go unnoticed.

**Verified**: frontend tsconfig + `yarn build` + precedence audit clean; the
modal classes present in the SINGLE bundled stylesheet (`cssCodeSplit: false`,
so a missing class is the failure mode that only shows up from an installed
ZXP); and the six `.specs-tool …` selectors the modal depends on confirmed to
exist in that exact scoped form, which is what the added class re-establishes.
One check initially read FAIL — the assertion was wrong (the checkbox rule is
scoped a level deeper, under `.specs-table--selectable`), not the code.

## `bestMatch.fsName` — csvLocaliserRun never wrote a file (2026-08-06)

Surfaced by the first real duration-multiple run: `Row 1 · TRIO 1920x1080 30sec
— TypeError: undefined is not an object`.

**Not the multiples code.** `pickBestMasterFromIndex` returns a
`MasterIndexEntry` (`file` / `path` / `name` / `canonPath` / `ratio` /
`orientation`). There is **no `fsName`** on it, so `bestMatch.fsName` was
`undefined` and `textMaster.split("/")` on the next line threw. Fixed to
`bestMatch.path`, which `buildMastersIndex` sets FROM `item.fsName` — the same
string the code always meant.

**This has been broken for every matched row since `ee86aed`**, when this call
site moved from `scanMastersForBestMatch` (returns a real `File`, hence
`.fsName`) to the shared index. `campaignLocaliserGenerate` (localise.ts:388)
still uses `scanMastersForBestMatch` and its `.fsName` is CORRECT — do not
"align" the two.

It stayed invisible because **a row with no master short-circuits above that
line**: a batch where nothing matched reported a tidy list of "no master" and
never reached the bug. It took a row that DID resolve a master to reach it, and
duration multiples were the first thing to produce one.

### Why neither tsconfig caught it

`tsc -p tsconfig-build.json --listFiles | grep -c src/jsx` is **0**.
`tsconfig.json` sets `"exclude": ["./src/jsx"]` and the build config extends it,
so **the entire ExtendScript backend is outside the build gate's type-check.**
`yarn build` runs that config, so nothing in `src/jsx` is ever checked by it.
The frontend config pulls `src/jsx` in transitively (via
`src/js/lib/utils/aeft.ts`) and DOES type it — but against DOM lib types, where
`File`/`Folder`/`app` are the wrong shapes, producing ~2000 baseline errors that
bury any real one.

Confirmed the compiler rejects this pattern normally: a 3-line probe with the
same shape errors `TS2551: Property 'fsName' does not exist`. So this is purely
a config-coverage gap, not a TypeScript limitation. **CLAUDE.md §6's "run BOTH
tsconfigs" does not do what it implies for `src/jsx`.** Left as-is rather than
changed unilaterally — including `src/jsx` in the build config would surface a
large error backlog that wants its own pass.

**Verified**: the REAL built bundle driven through `csvLocaliserRun` in a `vm`
with a stubbed AE object model (Comp/Layer/Folder/File), one 30sec row against
a masters tree holding only a 15sec cut:

    without opt-in -> status "no-master" (unchanged behaviour)
    with {"0":2}   -> copies the 15sec master to
                      …_1920x1080px_30s_TW_V01.aep
                      delivery comp duration 30 (was 15), work area 30,
                      layers: Frontcard@0, creative@0, creative@15

i.e. the Frontcard untouched at the top and the creative laid twice end to end,
which is the whole feature. Fixture notes for next time: CSV metadata is
`Key: value` lines INSIDE a `[METADATA]`/`[/METADATA]` block — get either half
wrong and rows read as malformed.

### The Frontcard lead-in (same day, immediately after)

First real batch showed the comp coming out at the nominal deliverable length.
Wrong: **the delivery comp is longer than the deliverable** — the Frontcard runs
~5s ahead of the creative, so a "30sec" deliverable is a 35s comp. Every other
localising tool has always inherited this for free by never touching the
duration; the multiples path was the first thing to SET it, and set it to
`span * factor`.

Now `item.duration = item.duration + span * (repeatFactor - 1)` — GROW by the
extra passes rather than recompute from scratch. That inherits whatever lead-in
(or tail) the master actually has, so **nothing here hardcodes 5s** and it keeps
working if the Frontcard length ever changes. Same reason the repeats are
offset from the creative layer's own `startTime` and not from 0.

Verified against the built bundle with a fixture that models the real shape
(Frontcard at 0, creative at 5s, delivery comp = creative + 5):

    30sec row, 15sec master x2 -> comp 35s, creative @ 5, 20
    30sec row, 10sec master x3 -> comp 35s, creative @ 5, 15, 25
    40sec row, 10sec master x4 -> comp 45s, creative @ 5, 15, 25, 35

Two fixture bugs found on the way, both mine, both worth remembering: the stub's
`replaceSource` reset the layer's `outPoint` to the source duration, collapsing
its span from 15 to 10 and making 35 read as 30 (real AE PRESERVES in/out when
the new source is at least as long); and a "40s from 10s x4" case was asserted
against the 30sec row, where it correctly finds nothing because 30/4 is not an
integer.

### Repeat passes stacked in the wrong order (2026-08-06)

Reported from a real 3x build: the timeline read Frontcard, then a pass at 15s,
then 25s, then the FIRST pass at 5s sitting at the bottom.

`AVLayer.duplicate()` inserts the copy directly ABOVE its original, so each
duplicate pushed the original down one more place. Duplicating N-1 times from
the same original leaves the stack in reverse-ish order with pass 1 last —
`15, 25, 35, 5` top to bottom for a 4x.

**Purely cosmetic**: the passes are sequential and never overlap, so every
render was already correct. But a scrambled stack is exactly the thing an
artist opens the file and distrusts.

Fixed with `dup.moveAfter(previous)`, chaining each copy below the pass before
it, so the stack reads in playback order: Frontcard, pass 1, pass 2, …

**The first version of the headless fixture could not have caught this** — its
`duplicate()` appended to the end of the layer array, which happens to produce
the right order by accident. It now models AE properly (`duplicate()` splices
ABOVE the original, `moveAfter()` moves to just below a target), and the
strategies were run side by side to confirm the assertion actually
distinguishes them:

    without moveAfter -> 15,25,35,5   (matches the reported screenshot)
    with moveAfter    -> 5,15,25,35

General lesson, twice over on this feature: **a stub that is convenient rather
than faithful will pass whatever you write.** This fixture has now hidden two
real bugs — `replaceSource` resetting out-points, and `duplicate()` appending —
both because the easy implementation was the wrong one.

## Duration multiples in Build-a-batch (2026-08-06)

The hand-built batch builder had **no master lookup at all** — no status icons,
and `runBuilder` called `csvLocaliserRun` without a `multiplesJson`. So a typed
row asking for 30s simply failed at run time with "no master", where the same
row scanned from a PDF would have offered 15sec x2.

Three pieces, deliberately reusing what the specs table already has rather than
growing a parallel implementation:

1. **The same resolver** (`csvLocaliserResolveMasters`) over the builder's
   complete rows, so both flows answer "which master, and is a multiple
   available?" identically. Nothing new host-side.
2. **The same control** (`.specs-mult`, cycling off -> 2x -> 3x -> off) in a new
   `×` column, rendering an empty `<span>` when a row has no candidate so the
   grid stays aligned instead of reflowing per row.
3. **The same run payload** (`{csvIndex: factor}`).

**The design constraint is debouncing, and it is the real difference between
the two flows.** The specs table resolves once per scan; builder rows change on
every keystroke, and `csvLocaliserResolveMasters` walks the whole masters tree
on the NAS per call. So: one call for ALL complete rows, 500ms after typing
stops, cancelled on unmount/retype. Resolving per row or per keystroke would
hammer the share.

**Results are keyed by ROW ID, not position.** Builder rows are added and
removed freely; a positional key smears one row's master onto another the
moment a row above it is deleted.

**The index re-mapping trap appears here too, in a nastier form.** `runBuilder`
sends `buildComplete` — INCOMPLETE ROWS ARE FILTERED OUT — so a builder row at
position 3 can be CSV row 1. The opt-in is indexed against `buildComplete`, not
`buildRows`. Verified explicitly against a fixture with a half-typed row in the
middle: ids 11/13/14 complete, choices on 11 and 14 -> `{"0":2,"2":3}`. The
naive version (indexing over all rows) produces `{"0":2,"1":2,"3":3}` — a
factor aimed at a CSV row that does not exist, and another aimed at the wrong
deliverable. Same class of bug as the specs table's excluded rows; that is now
twice, so **any future call site that filters rows before building the CSV must
re-index the opt-ins against the filtered list.**

Note there is nothing special about "durations above 15s" — the candidate
finder is pure arithmetic over whatever masters exist (exact integer division,
capped at 4x). A 20s row finds 10sec x2 the same way a 30s row finds 15sec x2.

**Verified**: frontend tsconfig + `yarn build` + precedence audit clean; the
index mapping proven against the filtered-list fixture above. **Not exercised
in a running panel** — the debounce and the live lookup want a real typing pass.

## Masters index cache (2026-08-06)

Measured against the real share before deciding anything: **one walk of a
campaign's AE tree costs ~2s** (Forgotten Island 296 masters / 2757 files / 570
dirs; Paw Patrol Dino 410 / 2146 / 419 — Node `readdir`+`stat`, warm; AE's
`Folder.getFiles()` is heavier per item). Nothing cached it, so every preview,
every run and every debounced keystroke in Build-a-batch paid it again.

**The index itself already existed** — `buildMastersIndex` has always
precomputed path/name/canonPath/ratio/orientation, which is exactly the "store
every master's position and ratio" idea. What was missing was reuse BETWEEN
calls.

`getMastersIndex` (cached) / `refreshMastersIndex` (forced) /
`invalidateMastersIndex` (bridge export) in `tools.ts`, keyed by masters root.

**Freshness policy, which is the whole design:**

- **Lookups read the cache** — `csvLocaliserResolveMasters` (so the specs table
  AND Build-a-batch's per-keystroke lookup), `reviewMatch`,
  `scanMastersForBestMatch`. Worst case is a briefly stale answer on screen.
- **Runs refresh first** — `csvLocaliserRun` and `campaignLocaliserGenerate`
  both walk before writing anything, and repopulate the cache for everyone
  else. Anything that COPIES a master gets a walk it can trust.

**Keyed by root, so switching campaigns is inherently safe** — a different
mastersRoot is a different cache entry, never a stale answer from the previous
campaign. The only staleness that can bite is the same root changing on disk
mid-session, so "Re-check" (the button people already press when files changed
in Finder) now also invalidates.

**Side effect worth naming: this fixes the Campaign Localiser per-row walk for
free.** `campaignLocaliserGenerate` calls `scanMastersForBestMatch` INSIDE its
per-row loop, so a 14-row batch walked the NAS 14 times (~28s of pure I/O).
That function is cached now and the run refreshes once up front, so every row
after the first is a memory hit — the same win `ee86aed` gave CSV Localiser,
without restructuring the loop.

**Deliberately NOT persisted to disk.** ~400 entries is only ~60KB, so size was
never the issue; staleness is. A stored index that misses a newly-added master
produces a false "no master", and one holding a renamed file points a copy at a
path that no longer exists — both silent. SMB directory mtimes don't propagate
on recursive changes, so there is no cheap staleness check to lean on. Lifetime
is therefore the AE session: a plain module variable in the ExtendScript engine,
gone when AE quits, and also reset on panel reload (that re-evaluates the
bundle and rebuilds the namespace).

**Verified**: 8 assertions against the REAL built bundle, counting
`Folder.getFiles()` calls — first lookup walks, the next two walk zero times,
the cache stays stale after a file appears (by design), `invalidateMastersIndex`
with and without a root forces a re-walk, a different root walks its own tree,
a RUN re-walks even with a warm cache, and the run's walk repopulates the cache.

## OV Library: stop re-walking the same folders (2026-08-06)

Opening a campaign re-walked the same trees repeatedly. The creatives loop
calls `scanMastersForCreative` AND `scanRendersForCreative` for every creative,
`scanRendersForCreative` calls `scanMastersForCreative` again internally for its
stem filter, and `findMotionComponentsMp4Folder` costs three shallow listings
EVERY time it is called — once per creative, plus once for `scanAllRenders`.

Measured on the fixture: **11 `getFiles()` calls to open a 2-creative campaign,
down to 1 on the second open** (that one is `scanCreatives`' single shallow
listing of `AE/`, left uncached — it is one call per campaign and cheap). On a
real 6-creative campaign the saving scales with creative count, and each avoided
scan is also an avoided bridge round-trip.

**Deliberately NOT routed through `buildMastersIndex`,** even though that also
walks masters and is now cached. The two exclude different things —
`_old`/`_archive` matched case-sensitively against the FOLDER NAME here, versus
`_Old`/`_Archive`/`_DEV`/`Auto-Save` matched anywhere in the PATH there — and
`buildMastersIndex` drops any file with no WxH token. Sharing it would silently
change which files OV Library returns, which was the one thing this refactor was
asked not to do. So it memoises OV Library's OWN walker instead: same function,
same filters, same order, fewer calls.

- `ovScanCache` keys `findAllFiles` results by folder path; the array is
  returned BY REFERENCE and every caller only reads it.
- `ovMp4FolderCache` caches the resolved `Support/Motion_Components/_mp4` path
  per masters root, **including the miss** — a campaign on the older layout
  would otherwise repeat three failed listings per creative, and that is the
  common case.
- Lifetime is the AE session, same as the masters index cache. **Picking a
  campaign in the dropdown clears it**, so re-selecting the campaign you are
  already on is the refresh gesture for files added on disk mid-session.

**Verified**: 13 assertions against the REAL built bundle. The load-bearing one
is that the cached result is BYTE-IDENTICAL to the fresh walk (whole campaign
open serialised and compared), and identical again after an invalidate. The rest
pin the behaviour that must not have drifted: a nested master at depth 2 still
found, `_old` and `Auto-Save` masters still excluded, `_`-prefixed creatives
still absent, `Renders/<creative>` movs still picked up, the `_mp4` folder still
filtered to that creative's own stems, `scanAllRenders` still spanning every
creative, and a campaign with no `_mp4` folder still returning its renders with
the miss cached (2 -> 0 calls).

## Active Jobs card on the home screen (2026-08-06)

A full-width card under the four category cards: what still needs localising,
one row per territory/batch, click to open Localise. Proposed as a Wrike
integration; built without Wrike, because the panel already knows the answer.

**Why no Wrike.** The specs scan already walks each territory, parses the PDFs
and computes which rows are built. "Territories with unbuilt rows" IS the
active-jobs list. Wrike would add assignee/status/upload-path, but needs an
auth story that does not exist in CEP: TimeHub (the studio's separate React
platform) proxies Wrike through a Cloudflare Worker holding the OAuth token,
using same-origin cookies — none of which survives a CEP panel's file:// origin.
For a team of 7 that plumbing is not worth it. If the Wrike layer is ever
wanted, the cheap shape is something writing `<team>/active-jobs.json` from a
machine that already has access; the card reads a snapshot either way, so its
source can change without the UI changing.

**It never scans.** A specs scan walks territory folders and parses every PDF —
on the home screen that would make the panel's first view the slowest thing in
it. CSV Localiser publishes a snapshot (`OVActiveJobs`) whenever it scans, runs
or re-checks; the card reads it. Hence the header states WHEN it was captured:
a card quietly showing week-old numbers as if live is worse than one that
admits its age.

**Numbers come from `matchBuiltRows`** — the same function that tints the rows
and unticks the built ones in the specs table — so the card cannot disagree
with the tool. The snapshot is written from state already in memory; nothing
extra is read from disk.

- **Renders nothing until a scan exists.** A fresh machine's home screen is
  byte-identical to before. Once scanned it persists, because "0 outstanding"
  is real information.
- Per-machine, NOT in `PROFILE_KEYS` — scan state like usage history.
- One-shot entrance only (CLAUDE.md §3: nothing on the always-visible home
  screen animates perpetually). Progress is a bar rather than a percentage:
  "how much is left" reads faster as a length.
- The row is a `<button>` with its own background, so `:hover`/`:active` are
  re-declared against index.scss's global blue.

**On the VibeCurb skills** (reviewed in the scratchpad, not installed): the
visual ones mandate 9-12 chrome74-banned features each — `color-mix()`,
`:has()`, `aspect-ratio`, `clamp()`, `@property` — so they cannot ship here.
What was worth taking is `visual-redesign`'s Sacred/Slop discipline: JS logic
(state, effects, handlers, data flow) is untouchable, only the visual layer
moves. This card was built that way — purely additive, no existing behaviour
altered — and the same rule is what makes the snapshot reuse `matchBuiltRows`
rather than recomputing "built" a second way.

**Verified**: both tsconfigs + `yarn build` + precedence audit clean; the card's
styles present in the SINGLE bundled stylesheet (`cssCodeSplit: false`, so a
missing class only shows up from an installed ZXP); `saveActiveJobs`/
`loadActiveJobs` resolve in the ExtendScript bundle; and the card's CSS block
confirmed free of banned features. **Not seen in a running panel** — it needs a
real specs scan to have anything to show.

### Active Jobs, second pass: Wrike feed + full-width button (2026-08-06)

Two corrections from first use.

**It was a standing panel; it is now a closed full-width BUTTON** in the same
family as the four category cards, expanding on click. As an always-open card
it read as a permanent slab of text under the primary navigation.

**It was also wider than everything else** — `.toolset-grid` and
`.category-row` are capped at `$content-max-width` and centred inside
`.home-screen`; the new card was not, so it ran edge-to-edge while the cards
directly above stayed narrow. It is now in that same selector list, so it
cannot drift from them again.

**Wrike is the source of truth, not the specs PDFs.** A PM can forget to drop a
specs PDF; a task assigned to someone is real work regardless. So the card's
primary content is now the Wrike feed, and the specs snapshot became a footer
line. They are stated separately ON PURPOSE rather than merged: Wrike knows
what was ASKED FOR, the specs scan knows what is BUILT, and a mismatch between
them is itself the useful signal — a batch in Wrike with no specs PDF is
exactly the failure mode that is invisible today.

**"Assigned to me" is a local filter, not an auth problem.** Every studio
member can already read the whole Wrike account, so the feed returns everything
and the panel narrows it using `teamGetMachineState().owner`. That single fact
is what removes the need for per-user OAuth in CEP. An untagged machine falls
back to showing everyone rather than an empty list, which would read as "no
work" instead of "we don't know who you are".

**Transport** (`lib/jobsFeed.ts`): a plain frontend `fetch` to the studio
Worker's read-only route with an `X-Panel-Key` header — NOT over the
ExtendScript bridge (this is HTTPS, CEP's Chromium does it natively, and
routing it through evalTS would block the bridge for the duration) and NOT a
cookie session (a CEP panel has no session and its origin is `null`, so cookies
never attach cross-origin). Cached for the panel session with an explicit
refresh, same reasoning as the masters index cache.

- The Worker route does not exist yet, so **sample data is used and marked
  "sample" in the UI**. A card silently showing invented jobs would be worse
  than one showing none.
- `normalise()` is deliberately defensive: the `tasks` table belongs to
  TimeHub, not this panel, so its columns can change without anyone thinking
  about the toolbox. A missing field becomes a blank cell, never a throw.
- The feed key lives in `app.settings` (`JobsFeedConfig`) and is **NOT** in
  `PROFILE_KEYS` — verified absent. It is low-stakes (read-only, returns what
  every member can already see) but low-stakes is not "publish it to the team
  folder". It is also not a Wrike token: the Worker holds those.

**Bug caught in review, not by tooling**: the first version of the collapse
put `useState` AFTER the component's early returns, so the hook count changed
once a snapshot loaded and React would have thrown "rendered fewer hooks than
expected". `tsc` is happy with that.

**Verified**: both tsconfigs + `yarn build` + precedence audit clean; the
centring rule confirmed to name all three selectors in the bundled CSS; and 6
assertions on `parseJobTitle` against the real title format, including no
batch token, no territory, a hyphenated job name, and a title with no
separators at all. **Not seen in a running panel.**

### Active Jobs, third pass: bare icon + subtask modal (2026-08-06)

**The icon was the only thing on the home screen with a filled background.** The
category cards colour their icon and stop there, so a solid chip read as a
foreign object. Now a bare icon in the fixed Wrike green (#3fb774) — matching
`.wrike-launch-button`'s existing reasoning for a full-width non-category
button, which turned out to already exist in main.scss for the unhooked Wrike
Tasks page and is the house pattern for this exact shape.

**Clicking a batch now opens a modal of its subtasks parsed into localiser
rows** rather than jumping to Localise. The useful first question is "what is
actually in this job", and the subtask names answer it without leaving home.

- `parseDeliverableNames(namesJson)` — a new bridge export wrapping
  `nameGeneratorParse`, the SAME parser Name Generator, Trott 2.0, PDF to CSV,
  File Name Check and Naming Audit share. Nothing about the convention is
  reimplemented frontend-side. **One call for N names**: each bridge round-trip
  costs far more than the parse. Argument is a JSON STRING in, array out —
  nested arrays-of-objects do not survive the trip IN, but returns are a proper
  serialisation round-trip.
- **Size is read off the filename in the modal, not from the parser.**
  `nameGeneratorParse` returns filmTitle/artwork/campaign/territory/duration/
  version/site and NO size — worth knowing, because an earlier debugging pass
  printed `r.width`/`r.height` and read the resulting `undefined` as a parse
  failure when the fields simply do not exist.
- **The modal shows gaps honestly.** Verified against the real bundle with real
  subtask names: `FID_INTL_Trio_DINTH_ShowtimeCinemasTPED_1920x1080px_30s_TW`
  parses complete, while
  `FID_INTL_DOOH_ARTWORK_PIKASSO_ARTWALL_GALLERIA_FIRENZE_CEILING_9600x1440px_IT`
  yields **campaign "" and no duration** (it is a still, and everything between
  the artwork tag and the size is absorbed into `site`). Those rows are tinted
  amber, not red — the subtask is not wrong, it just does not carry everything
  on its own — and the modal states plainly that the specs PDF is still the
  input a run reads. A screen that showed blanks as if they were fine would
  send someone to localise against a campaign of "".
- Mock subtask names are VERBATIM from real Wrike tasks, deliberately including
  the ones that parse badly. Demoing this on names that all parse cleanly would
  hide the entire point of the screen.

**Verified**: both tsconfigs + `yarn build` + precedence audit clean; the
modal's styles present in the single bundled stylesheet; the icon's background
confirmed GONE and the bare colour present; no banned CSS in the new block; and
the parse behaviour above driven through the real built bundle.
**Not seen in a running panel.**

### Active Jobs, fourth pass: yours only, and a real API route (2026-08-06)

**The "everyone" toggle is gone.** The card exists to be a short, glanceable
list of what YOU have to build; an all-team view is clutter. The feed still
returns the studio's jobs only because filtering server-side by identity would
need per-user auth we deliberately avoided — so the narrowing is a filter, not
a permission. An untagged machine now says "Machine not tagged" and explains
how to fix it, rather than showing an empty list that reads as "no work".

**The Worker route is implemented** (`/api/panel/jobs` in TimeHub's
`worker/index.js`), NOT deployed.

- **Its own route, not a reuse of `/api/jobs-feed`.** Correcting an earlier
  reading of mine: `public.tasks` is the TIMESHEET table (job_number,
  time_spent, day_of_week), not a job list, and that route gates on a browser
  session cookie. The real source is **`wrike_tasks_cache.task_data`** — raw
  Wrike task JSON, kept current by the app and the webhook — so this costs one
  Supabase query and no Wrike API budget.
- **Auth is a shared `X-Panel-Key`.** Acceptable only because the route is
  read-only and returns what every member can already read in Wrike. CORS is
  `*` because a CEP panel's origin is `null` and cannot be allow-listed by
  name; no credentials are sent, and the key is the actual gate.
- **`subTaskIds` gives IDs, not names.** Subtasks are cached as tasks in their
  own right, so names are resolved from the same rows — no second query, no
  Wrike call. Which also means **subtasks must be skipped as top-level jobs**
  (`superTaskIds.length > 0`), or every deliverable would list as a job beside
  its parent.
- Member name → Wrike user id via `profiles`, accepting first name OR full
  name: the panel tags machines with a display name and forcing two naming
  schemes to stay in step would break quietly.
- An unmatched member returns **404 `unknown_member`**, never `[]` — an empty
  list would read as "no work" when the truth is "that name matched nobody".
- Sorted by `updatedDate`: most jobs carry no due date at all, which is the
  same thing TimeHub's own Profile.jsx notes about its rows.

**Verified**: `wrangler deploy --dry-run` clean, and 10 assertions driving the
REAL `handlePanelJobs` out of `worker/index.js` with a stubbed `fetch` — wrong
key 401s, unknown member 404s, only the caller's jobs return, Completed is
excluded, subtasks do not appear as jobs, newest first, subtask names resolve
from cache, `subtasks_done` counts correctly, and full-name tagging works as
well as first-name. Panel side: both tsconfigs + `yarn build` + precedence
audit clean, and the feed cache is keyed by member so re-tagging a machine
cannot serve the previous person's jobs.

**NOT DEPLOYED and not switched on.** The panel still shows sample data until
`JobsFeedConfig` is set. To go live: `npx wrangler secret put PANEL_KEY`,
deploy, then save `{url, key}` into that setting.

## Active Jobs → CSV Localiser handoff (2026-08-06)

"Send N rows to Localise" in the job modal: a Wrike job's subtasks become
prefilled rows in CSV Localiser's batch builder. This is the answer to the
original problem — **when a PM misses a specs PDF, Wrike becomes the spec
source**, and today such a batch is invisible to the toolbox entirely.

**It hands over; it does not run.** CSV Localiser owns every guard that matters
(skip-existing, the built-row matcher, duplicate detection, per-row master
status, the exclusion checkboxes). A "Localise" button in the modal would mean
duplicating those or shipping without them. The modal prepares, the tool
executes.

- The modal's parsed columns are ALREADY `SpecRow` 1:1 (Artwork/Campaign/Size/
  Duration/Country/Site), which is why this is a small step rather than a
  feature.
- Handoff is a module variable (`lib/localiseHandoff.ts`), **take-once**:
  `takePendingBatch()` clears as it reads, or navigating back to Localise later
  would silently re-prefill a job you already dealt with.
- Rows go in as `CUSTOM_CREATIVE` + `custom`, not via the scanned-creatives
  dropdown — that dropdown blanks anything absent from the masters listing.
- **Territory is resolved, not set blindly.** The dropdown lists scanned FOLDER
  names ("Italy"); the Wrike title carries a code ("IT"). Exact match first,
  then a unique prefix; anything ambiguous is left for the user. Setting an
  unmatched value would look like a selection that then fails on run.
- Skipped subtasks are NAMED in the notice with what they were missing.
  Silently forwarding 2 of 5 deliverables is exactly how one goes missing.

### The `_OV` duplicate, caught before shipping

Aaron's real job has two subtasks:

    ODY_INTL_SilverSoldiers_DOOH_1080x1920px_30s_JP
    ODY_INTL_SilverSoldiers_DOOH_1080x1920px_30s_JP_OV

These parse to **identical rows** — same campaign, artwork, size, duration,
territory — because the only difference is the OV suffix. Sending both would
queue the same deliverable twice.

`parseDeliverableNames` now also returns `isOv`, computed with the existing
`hasIsolatedOvToken()` — the same signal `losOpenForEdit()` uses to decide
copy-first and Naming Audit uses to spot a master among deliverables. An OV row
is shown in the table (it is a perfectly good MASTER name) but never sent, and
its reason reads "is the OV master" rather than a false "missing" field.

**Verified**: both tsconfigs + `yarn build` + precedence audit clean; the
conversion driven through the REAL built bundle over Aaron's actual subtasks
plus the ARTWALL stills — 3 of 5 sendable, the OV duplicate excluded, ARTWALL
excluded for campaign+duration, and `MOVEOVER` confirmed NOT to false-positive
on the OV check. **The handoff has not been exercised in a running panel** —
the round trip (modal → navigate → builder prefill → territory resolution) is
the part to try first.

## Expressions Bank: the delimited store was eating expressions (2026-08-11)

**The report.** A colleague saved an expression, moved to another page in
the panel, came back, and it was gone. Reproduced from the storage code
before ever opening AE.

`expressionsBankSave` packed each entry as
`id|name|tag|code|uses|description` and joined entries with `\t`, into
`app.settings` section `XYiToolbox`, key `ExpressionsBank`. Both delimiters
occur in ordinary expression code:

- **A TAB anywhere in the code** — i.e. anything pasted out of a real editor
  — split one record into fragments. Every fragment failed the loader's
  `parts.length >= 5` test and was skipped by a bare `continue`. The entry
  vanished **with no error at either end**: the save reported success, and
  the loss only showed on the next load. This is the reported bug.
- **A `|` in the code** — `||` is ordinary expression syntax — truncated the
  code at the first pipe and shifted `uses`/`description` into garbage. The
  row still appeared, with silently wrong code.

Verified by transcribing both functions into node and round-tripping four
entries: a `||` one came back truncated, a tab-indented one and a `|` in a
name were dropped entirely, and a fragment of the pipe-named row loaded as
a bogus extra entry.

It compounded through team sync: `teamSyncShared` does
`loadLocalExpressions()` → push shared → `expressionsBankSave(...)`. Under
the old format the load already dropped the tabbed entry, so the re-save
**permanently deleted it from the store**.

**AE prefs were never the problem** — worth knowing, since that was the
first suspicion. AE escapes newlines and tabs in its prefs file as hex
(`"0A"`, `"09"`; confirmed by reading `Adobe After Effects 26.2 Prefs.txt`),
so multi-line code survives `app.settings` fine. The delimiters were ours.

**Fix: the store is JSON**, same as `saveCustomTools` right above it.
`expressionsBankLoad` picks format by `raw.charAt(0) === "["` and hands
stored JSON straight back without re-stringifying, so fields a newer panel
adds survive a read by an older one. Legacy pipe/tab values still parse via
`expressionsBankParseLegacy` (do not extend it), and `expressionsBankSave`
validates `instanceof Array` before writing so a malformed payload can't
overwrite a good store.

**RULE, now in CLAUDE.md: never store user-authored text in a delimited
`app.settings` value.** There is no separator that expression code, a script
body, or a filename can't contain. JSON or nothing.

**Recovering what was already lost.** The wreckage is still in the raw
setting — the text was never deleted, just unsplittable. Reassembly is
ambiguous (a fragment boundary can't be told from a pipe inside code), and
handing an artist a silently mis-joined expression to paste into AE is worse
than telling them it's gone. So the legacy parser **counts** unreadable
fragments, `expressionsBankLoad` copies the original raw string to
`ExpressionsBankLegacyRaw` once (never overwritten, deliberately NOT in
`PROFILE_KEYS` — it's one machine's scrap, not personalisation) before the
first JSON save clobbers the key, and the panel shows a red status naming
the count and where to dig.

**`verifyStored` on every save.** After persisting, the panel reads the
store back and confirms the entry is there with matching name and code; a
mismatch reports an error instead of "Expression saved." The format is safe
now, but a save that can't be read back must never again pass for a
successful one.

## Expressions Bank UI: sectioned by provenance (2026-08-11)

The other half of "couldn't retrieve it". The list was flat and sorted by
`uses` descending, so a just-saved entry (uses 0) landed at the bottom of 21
rows, visually identical to the 20 shipped templates. Even when storage
worked, the artist couldn't find their own expression.

- **`origin: "builtin" | "mine" | "team"` is a stored field, not a guess.**
  `BUILT_IN_ENTRIES` (renamed from `MOCK_ENTRIES` — it is shipped content,
  not mock data) carry `builtin`; `team.ts` stamps `team` + `author` on
  everything `teamSyncShared` pulls; the editor stamps `mine`. Rows saved
  before the field existed are inferred once on load: **name matches a
  shipped template ⇒ builtin, else mine** — a template only ever reaches the
  store by being edited, so the name match is sound.
- **Sections: My Expressions / Team Library / Built-in**, collapsible, with
  counts. "My Expressions" renders **even when empty** — an absent section
  reads as lost data; an empty one with "Nothing saved yet" doesn't. Built-in
  auto-collapses only when the artist already has rows of their own.
- **A search force-expands every section** and disables the headers. A match
  hidden behind a folded header is the same bug in a new costume.
- **Group by Source / Tag** (SegmentedToggle, `name="eb-group"` so it can't
  share a Framer `layoutId`). In Tag mode sections are mixed, so each row
  gains an origin dot; in Source mode the section already says it.
- Origin also rides on each row's **left border colour** — mine takes the
  category tint, team `#8fa8ff`, built-in a deliberately dead `#3f3f3f`.
- **Just-saved rows get a 4s ring and `scrollIntoView`**, and saving
  force-expands the section it landed in. Claiming "saved" about a row the
  artist can't see is what started this.
- **Built-in rows no longer offer Remove.** The load merge re-adds any
  shipped template missing from the store, so deleting one only appeared to
  work until the next visit. Better no button than a button that lies.
- The row name is wrapped in **`<Tooltip grow>`** — the sanctioned way to let
  a stretch-sized element truncate (plain `<Tooltip>` pins it to
  `flex: 0 0 auto`). This replaced the old `.eb-entry-header > span:nth-child(2)`
  positional hack, which the new header structure would have broken.

Published as `20260811`. **Not yet seen rendered** — the browser preview
wouldn't open (Chrome extension errored on localhost) and browser preview
never runs ExtendScript anyway, so both the storage fix and the layout still
want a real-AE pass.

## Auto AR silently skipped the Scale expression on AE 26.3 (2026-08-11)

**The report.** One artist ran Auto AR and got a rig that looked right —
all 24 controls, anchor synced, Position expression live — but the effect
Transform's Scale had no expression. Everyone else was fine. Predates the
CEP port: the same fault is in the original `XYi_AutAR.jsx`, so it was never
ours.

**Cause: a display-name lookup that AE renamed in a point release.**

```js
var scaleProp = transformFx.property("Scale") || transformFx.property("ADBE Transform-Scale");
if (scaleProp) { ... }        // ← null on 26.3, skipped without a word
```

The Transform effect's uniform-scale slot reports its name as **`"Scale"` on
AE ≤26.2** and **`"Scale Height"` on 26.3+**. His station was `26.3x87`; the
rest of the studio was on 26.2. Nothing about his machine, project or layers
differed — only the AE build.

The `|| transformFx.property("ADBE Transform-Scale")` fallback was dead code
and always had been: that's the **layer** transform's matchName. The effect's
params are `ADBE Geometry2-*`. Our port had dropped the fallback entirely,
which changed nothing.

**Two wrong diagnoses before the right one, both plausible, both killed by
data.** First: "Uniform Scale must be unticked, since the plugin binary ships
both a `Scale` and a `Scale Height` string." Second: "`autoArAddControl`
reuses an existing control without checking its type, so his `[L] … Scale`
sliders must be Point Controls." **The lesson is the probe, not the
guesses** — three causes produced an identical user description and only a
read of the live property could separate them.

`scripts/diagnostics/auto-ar-probe.jsx` is kept for this. Read-only; on the
selected layer it dumps every effect with its matchName, which effect
`property("Transform")` actually resolves to, every Transform param with
matchName + `canSetExpression` + expression length + `expressionEnabled` +
`expressionError`, both spellings of the scale lookup, and each `[L]/[P] …
Scale` control marked ok / MISSING / WRONGTYPE with a usable-points count.
It settled the question in one run:

```
Uniform Scale            = 1        (ticked -- kills theory 1)
property('Scale')        -> NULL
property('Scale Height') -> FOUND
scale expression         = NONE
--> usable scale points: 12, missing: 0, wrong type: 0   (kills theory 2)
    3. 'Uniform Scale'  [ADBE Geometry2-0011]
    4. 'Scale Height'   [ADBE Geometry2-0003]
    5. 'Scale Width'    [ADBE Geometry2-0004]
```

**Fix.** `autoArTransformParam(transformFx, matchName, displayNames[])`
resolves by matchName first (`-0001` anchor, `-0002` position, `-0003` scale
height, `-0004` scale width, `-0011` uniform), falling back to display names
only in case the effect the rig latched onto isn't `ADBE Geometry2` at all —
it is matched by the *name* "Transform", so it can pick up a renamed effect.

Two behaviour changes shipped with it:

- **A half-applied rig now returns `success: false`** naming the layer and
  parameter. Every silent `continue` in `autoAspectRatio` (no Effects group,
  no Transform effect, unresolved Position, unresolved Scale) records into a
  `skipped` list that is reported. The swallowed skip is what let a broken
  rig look correct for months — the rename was only half the bug.
- **Uniform Scale off now drives Scale Width too.** The expression lands on
  Scale Height; with Uniform Scale ticked (the default the rig assumes) Width
  follows and one expression scales uniformly, which is what every station
  has always had. Unticked, Width is independent and driving height alone
  would stretch the layer — so both get it. That case previously did nothing
  at all, so this can't regress anyone.

**Rule added to CLAUDE.md §2: never fetch an effect parameter by display
name — matchNames are stable across versions AND languages, display names
are neither.**

## Master check: the panel's first out-of-process dependency (2026-08-11)

**What.** A "Run check" button under the masters list in OV Library reads every
master `.aep` in the selected campaign — without opening After Effects — and
opens an HTML sign-off report in the browser.

**How, and why it's shaped this way.**

- **Python, out of process.** `py-aep` parses the `.aep` RIFX binary directly.
  ExtendScript cannot read those bytes, and asking AE to open 100 masters just
  to look at them is the exact thing this toolbox exists to prevent. So the
  work happens in a spawned process (`lib/masterCheck.ts`) and the panel only
  launches it. `child_process` was already exported from `lib/cep/node.ts` and
  CEP already runs with `--enable-nodejs`, so this needed no new panel wiring.
- **Nothing ships in the ZXP.** py-aep + fontTools + uharfbuzz is ~29 MB, and
  all of it lives in a venv under the user's home. Measured: the bundle is
  2.80 MB before and after. Bundling a Python runtime instead would have added
  ~50 MB to the installer.
- **No mount-time probe, on purpose.** `isAvailable()` is called on CLICK, never
  in a `useEffect`. A probe on mount would put a process spawn on every OV
  Library open, for a button most sessions never press.
- **The report opens in a BROWSER, not in the panel.** Direct studio request:
  it's a wide table read for sign-off, and the panel is a narrow dock. Anything
  condensed enough to fit in the panel would be unreadable.
- **The report is written LOCALLY** (`~/Library/Application Support/XYi/
  aep-tools/reports/<campaign>/`), never into the masters tree. Partly because
  that tree is sacred; partly because a NAS folder one artist can write to and
  another can't would fail unevenly.
- **A machine without the venv is a NORMAL state, not an error.** It gets the
  inline note (which stays put and names the fix) and deliberately NOT a toast —
  a toast would read as a failure and then vanish before it could be acted on.
  Same rule the NAS features already follow.

**The checks are the point, and they were unit-tested against synthetic
failures rather than trusted because a real run came back clean:**

| Level | Check |
|---|---|
| Fix | main comp size != the size in the filename |
| Fix | main comp duration != the filename's duration (±0.5s — a 10s comp at 23.976 really runs 10.010) |
| Fix | any footage item flagged missing |
| Fix | no comp named after the file |
| Check | frame rate differs from the rest of that creative |
| Check | a layer most of the creative's masters have and this one doesn't |

A filename that parses under NEITHER convention has its size/duration checks
**skipped, not guessed**, and is listed separately. Both conventions are handled
(size with or without `px`, duration `s` or `sec`) — the same rule every other
master-filename parser in this codebase follows.

**Two things the report deliberately does NOT do.** It does not call a layer
name "missing" when it appears in roughly half the masters — that is an
orientation or duration variant (`ART` vs `ART_Vertical`), reported but not
flagged. And it does not count reference/guide frames named after a master file
as differences; they can never line up, so they are kept out of the verdict but
stay visible in the matrix, because a master carrying *another* master's guide
frame is worth spotting.

An earlier draft of the summary said "every shared layer name appears in all 4
masters" for a creative that had seven 2-of-4 splits. **A QC report that
overstates is worse than no report** — it now separates "no near-misses" from
"everything matches".

**Speed.** Files are read 8 at a time (the NAS is the limit, not the 24 cores)
and a cache keyed on size + mtime means a re-run only reads what changed.
Measured on 25 masters: 30s → 5s cold, 0.2s warm, ~1s after re-saving one
master. Cached output is byte-identical to a `--no-cache` run; that was
verified, not assumed.

**The script lives on the NAS, not in this repo** (`Team_Folder/aep-tools/` is
the intended home; `lib/masterCheck.ts` checks there first). It also cannot be
double-clicked from the share: `/Volumes/newmedia` is mounted `nodev,nosuid`
and macOS refuses to exec from it — the standalone `Layer Report.command`
launcher has to be copied local first, which is why it resolves its payload
from a candidate list rather than `dirname $0`.

---

## 2026-08-24 — Delivery: a 950 KB cap read as 950 MB, and two sheets stacked

**The report.** A Brazil batch came back with Delivery's autofill offering
**950 MB** on the two Ingresso rows. The sheet asks for 950 KB.

**The parser.** `pdfSpecs.ts`'s `normaliseFileSize` ended with a unit test per
suffix:

```
if (/\bg(b|ig)/i.test(raw)) return { mb: n * 1000, note: "" };
if (/\bk(b|ilo)/i.test(raw)) return { mb: n / 1000, note: "" };
if (/\bm(b|eg)/i.test(raw)) return { mb: n, note: "" };
```

`\b` is a boundary between a word character and a non-word one, and a DIGIT is
a word character. So `950 KB` — with the space — converts, and `950KB` matches
nothing at all. It fell through to the last branch, which converts only a bare
number of a thousand or more ("almost certainly KB, but not certainly enough to
convert silently"), and 950 is under that. Out came 950 MB, with **no flag**,
because a bare 950 in an MB column is a perfectly ordinary figure.

Measured before the fix, and every one of these is a spelling a real sheet uses:

```
"950KB"  -> 950      "950 KB" -> 0.95
"700KB"  -> 700      "2GB"    -> 2      (2 MB, 500x under)
"800kbps"-> 800 Mbps (bitrate column, same hole)
```

`8000kbps` survived only by accident: the `n >= 1000` kbps guess two lines
further down landed on the same answer.

**The fix.** `cellNumbers` had lexed the unit correctly all along — glued or
spaced — and both functions were throwing that answer away. They now use it,
and the `\b` tests stay only for the spelled-out forms (`800 kilobytes`), which
carry no unit token for the lexer to find. Nine cases added to
`scripts/probe-spec-cells.cjs`.

Nothing downstream needed changing, and it is worth saying why: the template
list starts at 0.6 Mbps, so a 950 KB cap over 10s (0.76 Mbps required) picks
`H264_0.6MBPS_MOS` and lands around 750 KB — inside the cap, no warning, right
answer. Before the fix the same row asked for 760 Mbps, clamped to the top of the
list, and the panel's own preview said so: `-> H264_60MBPS` beside a 950 KB
cap, which is the screenshot that started this.
Driven headlessly through the real `predictRowTemplate`/`rowWarnings`:

```
950 KB (fixed)    -> H264_0.6MBPS_MOS   no warning
950 MB (the bug)  -> H264_60MBPS_MOS    no warning   <- >= 1000 is the flag's
                                                        threshold; 950 is under
5 MB / 15s        -> H264_2.4MBPS_MOS   no warning   <- matches the panel
700 KB            -> H264_0.6MBPS_MOS   "needs ~0.56Mbps, below the smallest
                                         template (0.6), so the file will come
                                         out over size"
```

Two of those match the screenshot that started this exactly — `H264_60MBPS` on
the Ingresso rows and `H264_2.4MBPS` on the Marina one — which is what makes it
the whole chain that was verified rather than the parser alone. And the 700 KB
row now draws a real warning the studio had never once seen, because the number
reaching it used to be a thousand times too big to trigger anything.

**Not fixed, and deliberately.** `specRowWarnings` flags any size ≥ 1000 as
"looks like KB, not MB", so a legitimate `2GB` (now 2000 MB) draws a spurious
flag. That predates this change — `2 GB` with a space always converted and
always drew it. The function is pure and re-runnable on an edited row, which is
the property that lets a warning disappear the moment somebody corrects the
value; carrying a hidden "the unit was explicit" field through the reshape to
suppress one advisory flag would cost that. GB-scale DOOH deliverables do not
exist, and the value is now right, which is the part that mattered.

### The spec report, divided

Two complaints in one: every PDF in a Specs folder rendered its full table
stacked, so a folder holding `... - Batch 1 - PRE` and `... - Batch 1 - POST`
put nineteen rows of near-identical numbers down the panel with nothing marking
where one document ended. And there was no way to open the sheet itself.

- One tab per PDF, one table on screen. Tabs carry the row count, an `unread`
  marker for a PDF this parser could not read, and the flag count.
- **The tab labels drop the shared words.** Sheets in one folder differ in about
  two segments out of eight, so tabs labelled with the full name are as hard to
  scan as the stacked tables were. `splitSpecNames` splits off the run of `" - "`
  segments every file shares, shows it once above the strip, and leaves the tabs
  carrying only what tells them apart — falling back to full names when nothing
  is shared, and never eating the last segment even when one name is a strict
  prefix of another.
- **Open PDF**, per sheet — offered even for one the parser could not read,
  which is the case where you need it most. `openSpecPdf` spawns `open`
  (`explorer` on Windows) with `openURLInDefaultBrowser` as the fallback, the
  same handoff `masterCheck.ts`'s `openReport` uses and for the same reason.
  **Not gated on the file existing**: the path came out of the directory listing
  that just read the PDF, and Specs folders are on the NAS, where asking is the
  thing you must not do. `SpecReportFile` now carries the full path from that
  listing rather than letting a caller rebuild it from `folder` + `file`.
- Sub-megabyte caps print as KB (`formatSizeMB`). The stored value stays MB —
  that is what the bitrate maths and the row field take — but "0.7 MB" is a
  number you have to convert in your head before you can compare it against the
  sheet in front of you, and half this campaign's caps are under a megabyte.

**Verified:** both tsconfigs clean, `yarn build` clean, both audit gates clean,
34/34 in `probe-spec-cells.cjs`, and `splitSpecNames`/`formatSizeMB` driven
headlessly over the real Brazil filenames. The compiled CSS was read back out
of `dist/cep/assets/style-*.css` to confirm the new rules land at
`.delivery-hub .dh-specreport .dh-spectab…` — (0,3,0), so `index.scss`'s global
`button:hover` cannot paint over them — and that nothing in the block uses a
feature past Chromium 74.

### The two rows that wouldn't autofill

Nine deliverables, seven filled in, two blank — JockeyClub and MarinaTotens,
both `1080x1920 · 15s`. Which looks like the panel giving up, and isn't: the
sheet has both of them at that size, `suggestForComp` matched on size and
duration alone, and its rule for more than one hit is to refuse ("a wrong
target size means a file delivered over its limit, and a blank field costs one
manual entry"). Right rule, incomplete question — the sheet names the site and
so does the comp, and neither was being asked.

It matters more than a blank field: with nothing filled in, both rows fell to
the 26 Mbps default. 26 Mbps over 15s is ~48 MB against a 5 MB cap.

Three changes, all inside tier 1, none of them loosening it into tier 2's fuzzy
matching — a loose match may still only decide which PDF a human opens:

- `specRowsForComp` narrows a multi-row hit by SITE, and takes the answer only
  when it leaves exactly one row. Exact equality on a normalised name; nothing
  scored, nothing partial. Extracted as an export so the rule can be driven
  headlessly, which is the point of it existing separately at all.
- **`squash` folds accents instead of deleting them.** It stripped
  non-alphanumerics, which removes an accented letter outright:
  `MarinaLEDPraça&Pier` became `marinaledpraapier` — no c — and stopped
  matching the comp's own `MarinaLEDPracaPier`. NFD, drop the combining marks,
  then squash. `RelógioDigital01` had the same problem. This is CLAUDE.md's
  decode-and-fold rule showing up a third time, in the one place it had only
  ever been half-applied.
- **An ambiguous sheet no longer ends the search.** It returned immediately, so
  whichever PDF `readdir` reached first decided the row — and a Specs folder
  holds a PRE and a POST sheet per batch describing overlapping sizes. Held
  like `matchedButSilent` already was, and returned only if no later sheet
  answers cleanly.

`scripts/probe-spec-match.cjs` drives the real exported matcher over the real
Batch 1 rows, ampersand and cedilla included. What must stay ambiguous is
tested as hard as what must now resolve: `JockeyClub` does not claim the PRE
sheet's `JockeyClubDATE` (a prefix match would have paired them), and two rows
for the same site at one size still refuse.

**The selected tab uses `--cat-border`/`--cat-icon`, not `--ov-accent`.** The
category tint is what every other active state in `DeliveryHub.scss` keys off;
a tab picked out in the theme accent read as belonging to a different screen.
`--cat-glow` stays out of it — CLAUDE.md's rule, it is tuned for hover.

---

## 2026-08-24 — Creative workflows: the checklist a creative is localised by

Every creative carries house rules that are in no spec sheet and derivable from
no filename. Trio's title treatment, pedigree, tagline and date all come from
Components rather than being rebuilt, and the only person who knows that is
whoever did it last. It lived in somebody's head, or in a Slack message from
four months ago.

**The split the whole tool rests on: steps and notes are SHARED, ticks are NOT.**
Steps and notes are what the team knows about the creative, so they belong to
the creative — one copy on the NAS, the same for everyone. A tick is one
artist's progress through one job. Two people localising BR and FR on the same
afternoon must not uncheck each other's boxes, and neither wants a board that
opens pre-ticked because somebody else finished a different territory. Ticks are
local (`app.settings` / `WorkflowTicks`), with a Reset for the next job.

Deliberately NOT in `PROFILE_KEYS`: a tick is scratch state for one job, not a
personalisation that should follow an artist to another machine — the same
reason usage history is excluded.

**Keyed on campaign + creative, canonicalised.** A creative name repeats across
campaigns; the thumbnail overrides already carry this exact rule for the same
reason, and a component list that changed between campaigns has to have
somewhere to live.

**The creative comes off the OPEN PROJECT'S NAME**, through `creativeTokenOf` —
one new export wrapping the two functions MC It! already uses, so
`FID_INTL_Trio_DOOH_…` is Trio here and in the localiser alike. A second parser
would drift, and the drift would read as "no workflow for this creative" on one
that has a workflow, which is indistinguishable from nobody having written it.
The campaign comes off the PATH: the campaign whose masters root contains the
file, longest root winning so a campaign nested in another's tree resolves to
the inner one.

Every one of those can legitimately be empty — nothing open, a scratch project,
a file saved outside every known campaign — and each is answered with a picker,
never an error. The picker lists the campaign's creatives from `scanCreatives`
off the masters tree, marks the ones that already have a workflow, and falls
back to typing a name when the share can't be read at all. That last path is not
a nicety: a creative whose folder is named differently, a campaign nobody has
saved, an unmounted NAS — none of those should stop somebody writing the
checklist down while they still remember it.

**Rules the shared board follows, all of them ones this codebase already had:**

- A failed read never replaces rows on screen. `read: false` is returned for
  both "no file yet" and "share went away", the board goes stale rather than
  empty, and says so in an inline banner — not a toast, because an unmounted
  share is a normal state and a toast reads as a failure then vanishes before
  it can be acted on.
- **Posting refuses from an untagged machine.** An unsigned note on a shared
  board is worse than no note: the next person can't tell house rule from one
  artist's opinion, and has nobody to ask.
- Saving steps **re-reads the file and replaces one entry**, matched by KEY
  rather than id — two people can each create "Trio" before either has seen the
  other's, and the board must end with one Trio, not two that shadow each other.
  Notes are merged back in by id rather than taken from the editor's copy: an
  editor holding the entry on screen while somebody posts a note would otherwise
  drop it with no trace it existed.
- Notes are their own call for the same reason, and you can only delete your
  own.

**The demo mocks are load-bearing here.** Nothing under `src/jsx` runs in
browser preview, so `demoBridge`'s workflow entries are the only way this UI can
be looked at outside AE — which is how the strike-through bug below was caught.
A `scanCreatives` mock was written and then removed: `SHAPED` is consulted
BEFORE a caller's own fallback (bolt.ts), so it would have handed OV Library
these names instead of its own `MOCK_CREATIVES`. Unhandled is the right answer
there, and the picker's "couldn't look" path is worth seeing in the demo anyway.

**The strike-through was anchored to the row.** `left: 26px; right: 8px` on the
`<li>` spans the full width, so a ticked step got a horizontal rule under it
rather than a line through the words. It now lives inside the text span, which
is `inline-block` and therefore exactly as wide as the words. Caught by driving
the built panel in a browser and looking at it — the same lesson as rendering a
frame for geometry, one layer up.

Ticks animate with `transform-origin` on a scaleX rather than an animated
width, so nothing relayouts per frame; rows use explicit per-item `delay`
rather than nested `staggerChildren`; the progress ring's label is centred with
flexbox, never a transform, because Framer owns the inline transform on
anything it animates.

### Steps that take you there

A checklist that says "use MC It! for this" is still asking you to go and find
MC It!. So a step can carry a LINK, and pressing it lands you on the tool the
step is about — the checklist becomes a route through the panel rather than a
list of instructions about it.

**It navigates; it does not press the button.** That boundary is the whole
design decision here, and it is not caution for its own sake: several one-click
actions carry follow-up UI that only exists where they normally live. MC It!
opens a report you pick per-file overrides in; Cheeky T opens a review modal for
anything the filename couldn't answer. Firing those from a checklist row would
run the ExtendScript and silently drop the half of the feature that asks you
questions. So a link opens the page and NAMES the button — "Cheeky DT ·
Territory Check" — and you press it with the tool's own chrome around you.

`lib/agent/navigation.ts` already refuses to press anything the registry hasn't
graded "read", for a related reason: it matches on button TEXT, so relabelling a
button silently changes what is permitted. This tool deliberately does not
import that module at all — it uses `onSelectTool`, the prop ToolScreen and
LocaliseScreen already pass, so a non-agent feature doesn't acquire a dependency
on the agent's removal (CLAUDE.md §9).

**Both halves of a link are re-validated on every render, never trusted.** A
shared JSON outlives a tool id and a button label:

- tool id no longer in `TOOLS` → a dashed amber "missing" chip. It is a
  `<span>`, so there is nothing to click; it cannot navigate nowhere.
- button label no longer in that tool's `actions` → the chip still navigates
  (the page is still right) but strikes the label and says so in the tooltip.
  Sending somebody to the correct page to hunt for a button that was renamed
  is worse than admitting it moved.

The picker offers only what the registry holds — tools by label, then that
tool's own `actions` — so an unlinkable tool cannot be linked to and a button
that doesn't exist cannot be named. It drops below the step list rather than
inside the row (a row is a flex line of inputs; a 200px list in it fights all of
them for width), which meant it needed to say which step it was editing — its
header echoes the step's text.

Verified by driving the built panel in a browser: pressing a step's chip leaves
the board and lands on OV Swap, the picker lists all 45 registered tools, and no
page errors. The demo board carries a linked step, a link with a named button,
and a deliberately broken one so the dead-chip path is visible without breaking
anything to see it.

---

## 2026-08-24 — The agent comes out, Workflows takes its place

Removed on cost: the API bill was never going to make sense for a studio tool
that had to be right. CLAUDE.md §9 had budgeted this at 25 files / ~7,800 lines
deleted and 447 lines of surgery across 9 files, and that estimate held.

**The marker did its job.** `grep -rn AGENT-HOOK src/` found all 16 sites, and
one of them was exactly the trap §9 warned about: `Bespoke.tsx` imports
`parseSegmentSpec`/`planSegments` at the top but *uses* them in an effect three
hundred lines below the fill receiver. Cutting by import alone leaves a file
that compiles and a feature that silently does nothing. The real test was
`pendingScreen`/`pendingSegments`: once the receiver was gone, every remaining
reference to both was a `setState("")`, so the two effects were dead and went
with it. Following imports would have missed that; following the marker found it.

**Two files survived, and they are not agent code any more.**

- `lib/navigation.ts` → `lib/navigation.ts`. It outlived the agent because the
  problem was never an agent problem: something in main.tsx's shell needs to
  change the screen, and the bubble is exactly that — it floats above every
  screen, so it has no `onSelectTool` prop and no parent to ask. **Its click
  gate stays**, and the reason changed only in who it protects against: a stored
  workflow link naming a button by TEXT is the same hazard as a model naming
  one, because relabelling a button silently changes what the link may press.
- `lib/agent/bubbleControl.ts` → `lib/workflowBubble.ts`. The mechanics of a
  panel that outlives navigation, with its toggle living somewhere else, were
  right. What sat inside it was the problem.

**A new localStorage key, not the agent's.** Reusing `xyi.agent.enabled` would
have handed a Workflows bubble to every machine that once switched the agent on,
and — much worse — permanently hidden it from anyone who tried the agent and
turned it off. They would never have seen the feature and would have had nothing
to click to find out.

### The bubble

The panel is now the checklist's front door, not a button on the Localise
screen. That is not a placement preference: a step's whole job is to send you to
another tool, and on a tool page following a link unmounts the list you were
following. You would arrive at the right screen having lost your place. Mounted
in main.tsx's shell, the list is still there when you land — driven in a browser
and confirmed: pressing "→ OV Swap" from the bubble navigates and leaves the
board open at 3/8.

`WorkflowBoard` renders in both surfaces, switched by `variant` rather than
forked. The panel variant changes only what actually stops fitting at 380px; a
second layout would drift from the first the moment either was touched.

**The panel pins its own `--cat-*`, and this was a real bug caught on screen.**
Everything inside keys off the category tint, which is set as an inline style on
whichever tool is mounted — so the first build came up orange over the home
screen and would have been teal over Localise. The one surface that never
changes would have been the only thing changing colour. It declares teal on
`.wfbub-panel` and the cascade inside lands there instead.

### The rows, made tactile

The old rows were a checkbox and a label: a form to fill in. What this actually
is, is an order of operations that ends with the job done, and half the steps
hand you to another tool. So they became **numbered nodes on a rail that fills
in behind you** — the same metaphor the launcher's Route icon carries — with
each step a card you press rather than a line you click.

Motion personality: **Physical**, three curves, no more. And one constraint the
motion pipeline does not know about: **CSS `linear()` spring easing is Chrome
113 and the build target is chrome74**, so the entire Tier-1 palette is
unavailable. Framer's springs are computed in JS and work anywhere — they are
also the better choice here, because they carry velocity through an interruption,
which matters when somebody ticks four boxes in a second.

- `SPRING.snappy` for arrivals, `.smooth` for settles (the rail fill, the ring),
  `.bouncy` for the tick alone — a small element, pressed rarely enough per
  session that a real pop is a reward rather than a tax.
- One cubic-bezier for hover. Spring overshoot on hover reads as jitter.
- The card is **pressed** with `whileTap`, never lifted with a CSS transform:
  Framer owns that element's transform and a CSS translate would be overwritten
  the moment the tap fired. The hover is a surface change instead.
- The rail fill is `scaleY` on a `transform-origin`, never an animated height.
- **No perpetual animation on the launcher.** The agent's FAB rotated a conic
  gradient forever and justified it at fourteen seconds a turn. A docked panel
  is small, and something moving in the corner of your eye all day is precisely
  what people turn a feature off for. Tactility here is response to touch —
  press compression, hover lift — not motion of its own.

Bundle: 3,272 kB → 3,198 kB (~27 kB gzipped).

### Bold, territories on notes, and a route with a position

**`**bold**` in steps and notes.** Deliberately not a markdown library and
deliberately only bold: these get typed into a small input by somebody in a
hurry and skimmed by somebody halfway through a job, so every extra syntax is
another way to get a literal asterisk on screen. Rendered as React elements,
never `dangerouslySetInnerHTML` — the text comes off a shared file, and
"trusted author" is not a reason to hand a string to an HTML parser.

**Notes carry a territory.** Almost every note is per-market — "for Brazil,
watch the two-line gutters" — and an untagged wall of them is a wall you have to
read to find the two that apply to you.

- **A globe, not a dropdown.** The panel is 380px and already dense; a permanent
  country selector next to the input would cost a third of the row to say
  nothing most of the time. Closed it is one glyph.
- The picker offers **the campaign's own markets folders first** (via
  `scanTerritories`, the same function Localised Library derives its list from,
  so the two can't disagree), with the full ISO list behind the search. Both
  are returned every time, because `markets` is legitimately empty in three
  ordinary cases: share not mounted, campaign saved against its masters root
  rather than its markets root (sibling trees, §5), or a territory whose folder
  doesn't exist yet. A picker that offered nothing in any of those would fail
  exactly when somebody is writing down what they just learned.
- **Flags degrade to the code.** A platform without flag glyphs renders the two
  regional indicators as their plain letters, so "BR" is what you see — the
  fallback is already the right answer and there is none to write.
- **The filter costs nothing until it exists.** One flag per territory that
  actually has notes, and only when there is more than one — below that a filter
  is a control that can only ever hide things.

**Creative names, formatted.** They arrive as `Portal_to_paradise` from the
masters tree or `PORTALTOPARADISE` from the filename parser. Three rules, each
from a real name in one campaign: a short lowercase word is a code (`Portal_brb`
→ Portal BRB), except a joining word (`Portal_to_paradise` → Portal to Paradise,
not "Portal TO Paradise"), and an existing acronym is left alone (`DOOHMaster` →
DOOH Master). Upper-casing is lossy in a way nothing undoes, so `workflowContext`
now returns `creativeLabel` — the token in its *original* spelling — alongside
the matching token. Matching still canonicalises; only the display changed.

**The checkboxes came out.** A checklist is a set of independent boxes; this is
a route, and a route has a position. The numbered node already said
done-or-not, so a square beside it was a second answer to the same question
costing 20px of a 380px panel. Now: done steps get a filled node and a struck
line, the first undone step is lit (accent edge, white text, a ring on its node),
everything ahead is dimmer, and the whole row is the control. The hit area is a
`<button>` and a **sibling** of the link chip rather than its parent — a button
inside a button is invalid and the inner one stops firing. The "you are here"
ring is static: a pulsing marker in a docked panel would be pulsing all day.

### Retired campaigns actually retire

Retiring marked pickers with a label and changed nothing else, so a finished
campaign sat in the list looking exactly as pickable as a live one — the flag
was decorative. `DropdownOption` gains `disabled`: greyed, unclickable, skipped
by the keyboard (Enter had to agree, or the keyboard would be a way round the
one rule the mouse respects). Applied in CSV Localiser, Localised Library and
Workflows' own campaign chips.

**Listed, not filtered out.** An option that simply vanished is
indistinguishable from one somebody deleted, and the next question is always
"where did it go". Greyed, it answers itself.

**Two escapes, because greying a picker is otherwise a one-way door.** A
disabled option that IS the current value stays selectable — the trigger has to
show what is selected, and retiring the campaign you are standing on must leave
you able to un-retire it. And for any *other* retired campaign, CSV Localiser
gains a restore button that renders only while something is retired: zero estate
the rest of the time. A separate button rather than a mode on the archive one,
because the archive button means "do this to what I am looking at" and a second
meaning that only appears in certain states is how a control becomes
unpredictable.

### Notes that do things

Three additions, one mechanism.

**Words in a note can open a folder or a tool.** "Check the masters" makes
*masters* clickable; "make sure to run Artwork Check" opens the tool. The
obvious design — a link syntax like `[masters](/Volumes/…)` — is wrong twice
over: nobody is typing a NAS path by hand into a one-line input, and a literal
`[` in ordinary prose would then be a broken link. So the links are a **side
table** next to the body, matched by `label` at render time. The body stays
exactly what somebody typed. That is CLAUDE.md's "never store user-authored text
in a delimited value" rule, one level up.

The compose flow has no syntax and no typing: press the wand, the note you have
written becomes clickable words, pick one, then say where it goes — a folder
picker or the same tool list the steps use. Two clicks, and the label can't
fail to match the body because it *came from* the body.

Details that are not obvious until they bite:
- Labels are **regex-escaped** before matching. A folder name can hold `(`, `+`,
  `[` — the same trap CLAUDE.md records for `.match()` on a filename.
- **Longest label first**, or "Artwork" eats the front of "Artwork Check" and
  leaves " Check" dangling as plain text.
- **Bold is resolved first**, links matched only inside the plain runs, so the
  two can never interleave into something neither meant.
- A label that no longer appears in the body is **still shown**, as a chip under
  the note. An edited sentence must not silently drop somebody's link.
- Folder opening reuses `revealUsefulFolder`, whose `Folder.exists` gate is the
  one case CLAUDE.md permits: `.exists` is untrustworthy on a NAS *file*, and
  this is a directory.
- `evalTS`, not `evalTSSafe`, for the folder picker: it is a real OS dialog and
  can sit open for as long as somebody browses, so a 15s timeout would report an
  ordinary decision as a failure. Cancelling returns "" — a one-click action
  returns null-ish on cancel, never a fake error.

**Tags.** Free-form chips — CTA, TT, LEGALS — **upper-cased on the way in**.
These are a vocabulary the team builds by typing, and one that distinguishes
"CTA" from "cta" from "Cta" is three tags where everybody meant one: the filter
then shows three chips and each hides two thirds of the notes. The composer
suggests tags already on the board, which is the actual mechanism by which the
vocabulary stays small — one click beats retyping.

The tag row sits *under* the composer rather than in it: that row is already a
globe, an input, a wand and Add, and a fifth control would leave the input about
forty pixels wide. Enter and comma both commit a tag (a comma is what people
type between tags without being told to), and Enter there must not post the note
— that is the input above.

**Filtering composes.** Territory and tag together is the question somebody
actually has ("the Brazil CTA notes"); making them exclusive would mean picking
which half to ask. Both cost nothing until they exist — the territory row
appears only when more than one territory has notes, and tags filter by clicking
the chip already on a note, so neither takes permanent estate.

### It read as a form, not as house rules

Four things, and one of them was a real bug.

**The picker opened on a retired campaign.** `openPicker` fell back to
`campaigns[0]`, which is whichever campaign was added to this machine FIRST —
and on a machine that has been going a while, that is a finished one. So the
picker opened on Paw Patrol Dino every time, greyed and unselectable, and going
back reverted to it. The greying looked broken rather than deliberate. It now
falls back to the first campaign that is not retired. Verified on the exact path
that failed: with nothing detected, the picker opens on Forgotten Island, and
clicking a retired chip still does nothing.

**ALL-CAPS folder names came back shouting.** `PORTAL_TO_PARADISE` and
`CHARMED TOOLKIT` are real folders, and the "leave an existing acronym alone"
rule read every word of them as an acronym. If the whole string is upper-case
there is no acronym to preserve — nothing to contrast it against — so it is
lowered first and re-cased like anything else. That also had to disable the
short-word-is-a-code rule for those names: `Portal_brb` means BRB because
somebody chose lower case for it while choosing upper for Portal, but
`PAW_PATROL_DINO` chose nothing, and applying the rule there gave "PAW Patrol
Dino". `FID_DOOH_MASTER` consequently reads "Fid Dooh Master" — there is no way
to tell those apart, and wrong-but-readable beats wrong-and-shouty.

**Three buttons under a four-step list made it a form.** Reset, Edit steps and a
delete-for-everyone bin took a full row under the steps, which invited you to
change a thing the team agreed once and you are supposed to follow. Editing a
workflow is rare and deliberate; it does not get equal billing with the content.
Now: one quiet ⋯ opening a Droplet (the panel's own popover, so Escape and
outside-click already work), and the row is the byline. "Reset" became "Clear my
ticks" — the old label said nothing about *whose* progress, on a board that is
otherwise shared.

**The progress ring went.** It sat under the creative name saying 2/8 while the
rail beside the steps already said the same thing in the one place you are
looking. The count moved into the byline, which had room.

**The creative picker.** Every row carried a "none yet" tag, so most of the list
was labelled with the absence of a thing — noise that made the documented ones
harder to pick out, not easier. Now the ones with a workflow sort first, carry a
left rail and their step/note counts, and everything else is quieter with no
marker at all. A search appears past eight creatives; under that it is faster to
read than to type.

**And the filtering was invisible.** Tags could only be filtered by clicking a
chip already on a note — which works, but you had to already know it. Both
filters now live in the same row in the notes header, each appearing only when
there is more than one of its kind to choose between. With a single note there
is still nothing to filter, and a control that can only ever hide things is not
worth the estate.

### Confirmations, put where the damage is

A shared file with no version history and no undo: a mis-click loses somebody
else's writing permanently. But a dialog on every X is a dialog people learn to
dismiss without reading, and that reflex is exactly what the dialog that
*matters* then has to survive. So the question is asked once, at the point of no
return, and it names what is about to be lost.

- **Deleting a note asks, and quotes the note.** "Are you sure?" without saying
  which one is a question you cannot answer with four notes on screen.
- **Removing a step in the editor does NOT ask** — it is a draft edit that
  Cancel already discards. It gets an inline **Undo** instead, which puts the
  step back *at its original index*: a step restored to the bottom of a running
  order is a different instruction.
- **Saving asks only when steps would be lost**, and lists them by name. That is
  the moment the change reaches the team folder, and the only one that cannot be
  taken back.
- Deleting the whole workflow already confirmed, naming the step and note counts
  going with it.

Link chips and tag chips in the composer get nothing: they are one click to put
back and have not been shared with anyone yet.

Verified in the browser: cancelling the note dialog leaves all three notes;
removing a step in the editor goes 8 → 7 with an undo bar and back to 8 on Undo;
saving after a removal asks "Save, removing 1 step for the whole team?" and
names it.

### Bold you can see, and a rail that joins up

**Bold was never discarded — it was invisible.** `**bold**` shipped working in
steps and notes, and nobody was ever going to type asterisks into a one-line
input in a hurry. The feature existed and had no door.

**So: select the text.** A plain `<input>` is enough — `selectionStart` /
`selectionEnd` give the range and bolding is a string splice around it. No
contenteditable, no rich-text model, no second source of truth for what the note
says. The trade-off is honest: the asterisks stay visible while you type and the
bold only appears once posted. That is also the upside — you can see and delete
a marker you did not mean.

Three things that decide whether this ships working or broken:

- **`mousedown` is prevented on every button in the bar.** Without it, pressing
  one blurs the input, the selection collapses, and the button acts on nothing.
  That is the classic way this feature ships broken.
- **The bar is anchored to the FIELD, not the selection.** Positioning over a
  range inside an `<input>` means measuring text with a mirror element, which on
  a 380px panel buys a few pixels of precision for a whole class of drift bugs.
- **The step editor row became its own component.** `useSelection` is a hook and
  hooks cannot be called inside a `.map()`; keying the selection by row index
  from the parent would work right up until a row is removed or moved, at which
  point the stored index points at somebody else's text.

The same selection drives **linking**: the selected words become the label, so
the word-chip chooser is skipped entirely and the label cannot fail to match the
body — it was cut from it. The wand stays for people who have not selected
anything; the bar is the fast path, the wand is the one you find without knowing.

Steps get bold only. They already carry a row-level link chip, and a second
inline mechanism in the same sentence is two answers to one question.

**Caught by testing with a string longer than the selection:** `wrapBold` built
`before + "**" + mid + "**"` and dropped `after`, so bolding the first words of
a note silently threw away the rest of the sentence. A selection that happened
to be the whole field would never have shown it.

### The rail had a missing joint

The connector between step 1 and step 2 was absent while every other joint
looked fine. It was one absolutely-positioned **11px stub** at the top of each
row — a hard-coded length that only reached the node above when every row was
exactly the same height. The current step's card is taller than the rest, and a
two-line step taller again, so the first joint fell short and the chain broke
exactly where the eye starts.

Now each row draws two pseudo-elements: top edge → node, and node → bottom edge.
Both stretch to whatever height the row turns out to be, and neither is drawn on
the outside end of the list, so the rail starts and stops at the first and last
nodes rather than trailing off. The two halves of one joint are driven by the
same step's done-ness — the half below step N and the half above step N+1 are
the same line — so they can never disagree about whether you have been through
it. The node takes `position: relative; z-index: 1` to paint over them, which is
CLAUDE.md's rule about positioned elements and non-positioned siblings.

Measured after the fix: every joint 21px, both halves drawn, including through
the two-line row.

### Two small ones the screenshots caught

**The header was wrapping for a reason that no longer existed.** `.wfb-id` had
`flex: 1 1 100%` in the panel variant, forcing the Change/refresh buttons onto
their own line — put there because the identity, the progress ring and two
buttons genuinely did not fit across 380px, and squeezing the creative name was
the worse trade. The ring came out two commits ago and nothing removed the wrap
with it, so the panel was spending a whole row of height to say nothing.
Measured after: one line, 63px.

That is the general shape of it — a workaround outliving the constraint it was
built for is invisible until somebody looks at the screen, because nothing about
it is wrong in isolation.

**Universal notes now sort to the top.** A note with no territory applies to
every version of the creative, so it is the one everybody has to read; a Brazil
note only matters to whoever is on Brazil. They were in post order, which put
"every territory: the black frame is 1 second" underneath two territory-specific
ones.

Sorted by a decorated index rather than a bare comparator: `Array.prototype.sort`
is only guaranteed stable from ES2019, and this has to preserve post order
within each group on whatever the host runs. The sort only lifts the universal
ones — it never reorders notes relative to each other inside a group.

### It only ever detected once, and it could not find the campaign

Two bugs behind one symptom: the panel named "Portal to Paradise" while AE's
title bar said `…Batch_01_PRE/FID_INTL_Trio_DOOH_EmpenaRJ_…aep`, with "no
campaign" underneath.

**Detection ran at mount, and the panel never unmounts.** It is hidden with CSS
so the board read and scroll position survive a close — which also meant the
creative was whatever had been open the first time somebody pressed the
launcher, possibly days and six projects ago. It now polls `workflowContext`
every 4s while the panel is on screen, with a re-entrancy guard so a slow bridge
cannot stack calls, and an `active` prop from the bubble so a collapsed panel
does not poll AE forever. CEP has no project-changed event to listen for; Time
Tracker's own job detection polls for exactly the same reason.

**Picking a creative pins it.** Autotracking without that is worse than none:
you open the picker to read another creative's workflow and four seconds later
the board yanks itself back to whatever is open. While pinned, the header shows
what *is* open as a one-click chip instead of switching behind you. Nothing open,
or a project whose name carries no creative, never blanks a board you were
reading — it just stops being the thing that is detected.

**And "no campaign" was a two-roots problem.** OV Library saves a campaign
against its MASTERS tree (`XY026039_…_Masters`); Localised Library saves the
same campaign against its MARKETS tree (`XY026040_…_Markets`). Those are SIBLING
folders (CLAUDE.md §5), so a working file under `…_Markets/Brazil/AE/…` shares
no path prefix with the masters root at all. `workflowContext` kept whichever
store it read first and dropped the other as a duplicate name — so on any
machine with the campaign in OV Library, every real working file failed to match.

Both roots are kept now and all of them are tested, longest match winning. Plus
a fallback for when neither root matches — a campaign saved on one tree while
the artist works out of the other, or a root recorded under a different mount
prefix: the real tree carries the campaign in a folder name
(`/Forgotten_Island/Digital/INT/…`), so the path is walked and folder names
compared canonically, longest name winning so "Portal" cannot claim a file
belonging to "Portal To Paradise". Same technique `detectCurrentTerritory`
already uses. Names under four characters are not evidence.

Driven headlessly over the real path shape — seven cases including a markets
file with the campaign saved only against the masters root, which is the one
that produced "no campaign", and an unrelated path that must still resolve to
nothing.

**And the panel behaviour was verified against an invariant rather than a
name.** The demo mock flips which project is "open" so polling can be seen
working, which makes any assertion on a specific creative a race. The real
invariant is that the header only claims "open in AE" when the board matches
what is detected — so: unpinned claims it, pinning drops the claim, the nudge
appears, and following restores it. That holds no matter when the mock flips.

### The step format bar was rendering into a clip

Bold and linking worked in a note and did nothing in a step. The bar was
mounting correctly and the selection was being tracked — it was simply never
visible.

`.wfb-editstep` carried `overflow: hidden`, added so the exit animation's height
collapse would not show content spilling. The format bar is positioned ABOVE its
row (`bottom: calc(100% + 4px)`), so that same rule clipped it out of existence.
It rendered, it just could never be seen — which is why it looked like the
feature had not been wired up rather than like a CSS bug.

Safe to drop the clip: the exit animates opacity to 0 alongside the height, so
there is nothing solid left to spill by the time the row is short. Verified by
asserting `isVisible()` rather than a node count — a count would have passed
before the fix, which is exactly how this got missed.

### Reading notes stopped looking like filling in a form

The composer is an input, a globe, a wand, an Add button and a tag row — five
controls that matter while writing one note, sitting permanently under a list
you are usually just reading. It made the section read as a form with some
history above it.

Closed it is now one dashed line, "Add a note". Opened it is the same composer,
unchanged — nothing was removed, it just is not on screen for the nine times out
of ten the panel was opened to read something. An untagged machine gets the
sentence explaining why it cannot post, in place of a button that would refuse.

Closing DISCARDS the draft, so it asks first — but only once there is something
to lose. A half-written note thrown away by a stray click is the same complaint
as a deleted one, and a confirm on an empty box is the kind people learn to
click through.

### The format bar now sits over the selection

It was pinned to the field's left edge — cheaper, and defensible right up until
you select a word on the right of a long step and the button appears in the far
corner pointing at nothing. A control that acts on a specific thing has to be
near that thing; the earlier reasoning traded that away for implementation
convenience and was wrong.

An `<input>` exposes no Range, so the x position is measured: canvas
`measureText` on the substring before the selection start, again before its end,
midpoint between them. Canvas rather than a mirror `<span>` — there is no
element to insert, keep in sync, or accidentally leave in the DOM, and no layout
thrash from measuring on every keystroke. One context is created and reused; one
per keystroke would be a new backing store each time.

Three details that decide whether it lands on the right word:

- The **font shorthand comes off the element**, so it follows the stylesheet
  rather than a hard-coded guess that drifts the moment somebody changes a
  font-size.
- **Border and padding** are added — they put the text's origin inside the box —
  and **`scrollLeft` is subtracted**, so it still points at the right word once
  the value is long enough to scroll inside the field.
- The bar is **clamped to the field** in a `useLayoutEffect`, because its own
  width decides where its left edge goes and that is not known until it has been
  measured. Layout effect rather than effect, so it never paints one frame in
  the wrong place.

Measured against an independent calculation at three positions — a word at the
start, in the middle, and at the end of a step that overflows its field: **0px
off at all three**, and the clamp keeps it inside the box at both extremes.

### The grip was a lie

"Do we really need the up and down buttons if we can already drag them?" — you
couldn't. The grip was a decorative `<span>` with a `GripVertical` icon and no
drag wired to it at all, sitting next to the ↑/↓ buttons that did the actual
work. Worse than either choice alone: an icon that looks draggable and does
nothing tells you the list reorders by dragging and then refuses when you try.
The original comment even said drag-and-drop was more machinery than the job
needed — and then shipped its handle anyway.

Now it drags. `@dnd-kit` with **MouseSensor + TouchSensor, never PointerSensor**
— `Toolset.tsx` already records why: pointer events do not behave like a real
browser tab inside AE's CEP panel, so press-and-hold never registers there.
(`CategoryScreen.tsx` uses Framer's `Reorder`, which is pointer-based; that
screen is the unreachable fallback per §4, so its drag may never have been
exercised in AE. Not a convention to copy.) 8px activation distance, so clicking
into a step's text field stays a click. Listeners on the handle rather than the
row, so a drag can never start from inside the text.

**Two elements, one transform each.** The `<li>` is Framer's — it animates rows
in and out — and the row inside is dnd-kit's, carrying the sort transform.
Putting both on one element means two libraries writing the same inline style
and the last to render winning at random.

**The KeyboardSensor is not decoration:** the ↑/↓ buttons were the only way to
reorder without a mouse, so removing them had to put that back.

**The link button got the reclaimed space and a label.** An unlabelled chain
link next to an unlabelled X was two glyphs you had to hover to tell apart. It
now says "Link", or names the tool the step already opens — a statement rather
than an invitation.

**The link picker closes on reorder.** It is keyed by row index, so a drag would
leave it pointing at whatever step now occupies that slot; you would attach a
link to a step you were not looking at.

*And a note on how this was found:* the first attempt looked wired and did
nothing. The debug showed `aria-roledescription="sortable"` on the handle and
`mousedown` arriving — so listeners were attached and events landed, but no drag
started. The cause was mundane: the patch that added `DndContext` had an
assertion fail later in the same script, so the file was never written. The
props were real; the provider was missing. Worth remembering that "the markup
looks right" is not evidence the wiring landed.

### Sizes, and a useful empty state

**The panel was 10.5–11px throughout** — a size you can design at and cannot
comfortably read, on a thing that is read far more often than it is operated.
Step text, note bodies and the creative name are content and went to 12.5 / 12 /
13.5px; counts, tags, bylines and hints are furniture and took a smaller nudge,
which is what keeps the density a 380px panel needs. The panel variant used to
run half a point smaller than the page to buy width; at these sizes that was
squinting for nothing, so both match now.

**And "nothing detected" now lists what exists.** It was a sentence and a shrug
on a panel that already knows every workflow the team has written — and opening
the bubble with no project open is exactly when somebody wants to read one.
Workflows are grouped by campaign, with their step and note counts, and clicking
one opens it. Retired campaigns are excluded: they are unselectable everywhere
else, and a dead workflow is not a suggestion. The genuine empty case still says
so, and distinguishes "none written yet" from "all of them are retired".

### Editing your own notes, and following the theme

**Notes can be rewritten by whoever wrote them.** The pencil sits beside the X
on your own notes only — but **the author check is on the host**, not just the
button. Hiding a control is a UI convenience, not a permission check: the call
is reachable regardless of what the panel drew, and a shared board where anyone
can silently rewrite anyone's words, with no history to compare against, is
worse than one nobody can edit.

**It reuses the composer rather than adding an editor.** That box already has
the input, the format bar, the globe, the wand and the tag row; a second one for
editing would be two places to fix every future bug in any of them. The pencil
loads the note back into it, the row is marked while it is loaded, and Add
becomes Save.

**`stamp` is not touched on an edit.** It is when the note was written, which is
what the ordering and the "who said this and when" reading both depend on — an
edit that moved it would reshuffle the board. `editedAt` records the change
separately, and the byline says "· edited", because on a shared board the
difference between what somebody wrote and what it says now matters.

The three normalisers (territory code, links, tags) were lifted out of
`workflowAddNote` so add and update share them. Two copies would drift, and the
drift shows as a tag that filters in one direction only.

### The panel ignored the theme

It was painted `rgba(24, 27, 33, 0.98)` with a hardcoded teal accent — so on an
OLED theme it sat visibly grey on a screen where everything around it was black,
which is the entire point of OLED.

The accent was pinned deliberately: everything inside keys off `--cat-*`, the
CATEGORY tint set per mounted tool, so a panel that follows you around would
come up orange over Deliver and teal over Localise. That reasoning was right and
the fix was wrong — `--ov-accent` is *also* constant across screens, so it
satisfies both: stable wherever you are, and whatever was picked in the theme
menu.

Surfaces now use the tokens OLED actually overrides — `--surface-1` for the
panel, `--tile-bg`/`--tile-border` for the cards inside, `--surface-divider` for
rules. The format bar uses `--surface-2` rather than `--surface-1`, because that
is the layer OLED deliberately keeps off black so a floating thing has something
to separate it from the black underneath. Solid rather than translucent, since
0.98 alpha over black is not black.

The primary button took the accent flat with a dark label, the way the completed
step nodes already do: `--cat-grad` is a two-stop gradient the category tint
publishes, and there is no way to derive a second stop from a single
`--ov-accent` in CSS with `color-mix` banned on this target.

Measured: on OLED the panel, header and notes box all compute to
`rgb(0, 0, 0)`, and a pink theme accent reaches the step nodes as
`rgb(244, 114, 182)`.

*The save looked broken and wasn't:* `workflowUpdateNote` existed and was
exported, but `demoBridge` had no mock for it, so in preview the call fell
through to no bridge. Worth remembering that a new host function needs its demo
mock or every browser test of it fails for a reason that has nothing to do with
the code.

### A home button beside Back

Back unwinds one step, which is right for one wrong turn and wrong after a
workflow has walked you through three tools — getting home then means pressing
Back until it stops changing anything.

`HomeButton` is its own component rather than five copies of the markup: it sits
beside the back button on ToolScreen, CategoryScreen, ToolsScreen and both of
LocaliseScreen's headers, and five hand-written copies of a control this small
are five places for the label, the icon size or the hover to drift apart.

Quieter than Back and icon-only. Back is what you reach for most, and two
equally-weighted controls side by side is a decision where there should be a
default. It lifts on hover rather than sliding left, because Back slides left
and a neighbour doing the same thing reads as the same control twice.

**Two layout traps, both from rules already written down:**

- `.drill-header-row` is `justify-content: space-between` and was built for
  exactly two children. A third lands dead centre — next to nothing, belonging
  to neither side, which is where the home icon first appeared. `margin-right:
  auto` pushes the gap to its right so Back and Home group together as the two
  ways of leaving, and the palette trigger stays where it was.
- **That margin did nothing until the `<Tooltip>` came off.** Tooltip wraps its
  child in a span carrying `flex: 0 0 auto !important`, so the SPAN becomes the
  flex item and the button inside stops participating in the row's layout. Same
  family as CLAUDE.md's rule about wrapping a stretch-sized element in Tooltip,
  and the reason the measured gap stayed at 164px through a fix that read as
  correct. A `title` does the job, and matches Back, which has no tooltip
  either.

Measured after: 12px between them, 75px from the row's left edge. Verified from
two tools deep — one click lands on home.

### Striking through a step that wraps

Reported as "on two rows the crossing goes only on the middle": a step long
enough to wrap drew ONE rule through the gap between its lines instead of
through each line.

The cause was structural, not cosmetic. The strike was a `position: absolute`
element at `top: 50%` inside an `inline-block` wrapper, and 50% of a four-line
box is the space between lines two and three. Absolute positioning cannot see
line boxes at all — there is no offset that makes one element cross four lines.

The strike is now a `linear-gradient` BACKGROUND on the text span itself, which
is `display: inline`, with `box-decoration-break: clone`. Clone is the whole
fix: it gives every line fragment its own background box, so `background-size:
100% 1px` is 100% of *that line*, and `background-position: 0 0.62em` is
measured from each fragment's own top. Framer animates `backgroundSize` between
`0% 1px` and `100% 1px`, which keeps the sweep the old element had.

*Verified by finding the step that actually wraps rather than trusting an
index.* The first probe hard-coded index 1 and reported one line fragment —
because the board had opened on a different creative and index 1 there was a
short step. The screenshot it captured showed a correctly-struck single line and
proved nothing about the case being fixed. The second probe selects the first
`.wfb-step-text` whose `getClientRects()` returns more than one distinct top,
and measured four fragments each carrying its own full-width rule. A long,
deliberately-wrapping step lives in `demoBridge`'s TRIO workflow so the case
stays testable.

### The home button read as disabled

`.home-button` was set to `opacity: 0.55` to keep Back the primary exit. Against
`#aac4ff` on the dark header that greys out far enough to look unavailable
rather than secondary — the first thing anyone asked about it was whether it was
switched off. 0.85 keeps the hierarchy without the ambiguity.

### Tutorial clips, played from the tool's own icon

Antonio recorded a short screen recording explaining OV Swap and asked whether a
clip could play in an overlay from somewhere in the tool's screen — suggesting
the icon.

**The design decision that matters is that there is no wiring per clip.** The
match is the filename and nothing else: `_tuts/OVSwap.mp4` explains OV Swap
because "ovswap" is what the file's name and the tool's id and label all reduce
to. No index file to keep in step, no field on the registry entry, no code
change. Recording a tutorial has to stay "drop the mp4 in `_tuts` and name it
after the tool", because anything that needed a developer in the loop would
mean two clips exist forever and the feature quietly dies. The team folder
already had `_aep_tools` and `_zxp` beside it, so `_tuts` follows a convention
people have seen — and it is opened by name, nothing to do with the
`_`-folders-are-excluded scan rule.

**Exact after squashing, never fuzzy.** `findBestComponentFile` exists and would
have matched more clips. It is the wrong tool here for the reason CLAUDE.md
gives for the CSV "already built" matcher: an unmatched clip costs one rename,
and a mismatched one plays the wrong tool's tutorial to somebody who is standing
in a tool specifically because they don't know how to use it. `tutorialKey`
folds accents, lower-cases and drops non-alphanumerics, and compares for
equality against the id *and* the label — either can be the more natural
filename ("OVSwap" beats "ov-swap"; "Find & Replace" beats "find-and-replace").

**The affordance only exists when the clip does.** No badge, no cursor, no
`role`, no click on the thirty-odd tools with no tutorial — they render exactly
the icon they always did. An icon that looks pressable everywhere and answers in
three places teaches everyone to stop pressing it, taking the three real ones
down with it.

**Two things were promoted to shared rather than copied.** OVLibrary had the
only video player and the only `toFileUrl`; the tutorial overlay was the second
caller of both. `toFileUrl`'s Windows-drive-letter and UNC branches are exactly
the detail that gets half-remembered on a second write, and a malformed
`file://` URL neither throws nor logs — it shows nothing, so a wrong second copy
would have read as a missing file. The player became `VideoOverlay` with the
failure copy as a prop (OVLibrary's "the render works in After Effects, try
Import or Reveal" is nonsense for a tutorial clip) and now portals to `<body>`,
because it is opened from inside a tool's content and `position: fixed` is still
clipped by an `overflow` ancestor — the trap Tooltip's bubble already hit.

*A span with `role="button"`, not a `<button>`:* it replaces four existing
header icons whose own classes carry their backgrounds — `.ls-header-icon`'s
gradient tile among them — and index.scss's global `button:hover`/`:active`
would have painted over every one.

*The badge takes `--cat-icon`, not `--ov-accent`.* First build put a theme-blue
dot on OV Swap's teal glyph, which read as two unrelated things touching: the
same accent mismatch as the Delivery batch tabs, one component down.

**Verified in two halves, because neither fails visibly on its own.**
`scripts/probe-tutorials.cjs` drives the BUILT bundle's `tutorialsList` against
a stubbed filesystem — `tsconfig-build.json` type-checks zero files under
`src/jsx`, so otherwise its only gate would be an artist opening the panel. The
stubs enforce the house rules as well as the behaviour: `File.exists` throws and
`getFiles(mask)` throws, so a future edit reaching for either on the share fails
the probe rather than failing silently on the NAS. It also covers the frontend's
`tutorialKey`, since a clip the host finds and the frontend cannot key to a tool
is the same outcome as no clip at all.

*That probe immediately earned itself.* The decoded filename comes back
**decomposed** — `decodeURI` hands back "Seina" plus a combining diaeresis, not
the precomposed letter, exactly as CLAUDE.md says macOS stores it. Comparing
decoded names directly would have meant a clip named on a Mac keying against
nothing, with no error anywhere. The NFD fold in `tutorialKey` is why it works,
and there is now a test that says so.

**Not done:** the two hub tools (Review, Delivery) carry their own header chrome
and have no `tool-content-header-icon`, so they have no front door for a clip
yet. And `tutorialsList` has never run inside After Effects — the probe stubs
the filesystem, it does not stub the NAS.

---

## 2026-08-25 — Campaign Rename borrowed the wrong half of the PDF's name

Reported from a real Colombia folder: the PDFs were
`FID_INTL_MultiArt_DOOH_SalitreWheel_1180x228px_10s_CO`, the AE project was
`FID_INTL_PortalToParadise_DOOH_MULTIART_1180x228px_10s_CO_V01`, and running
Campaign Rename over the pair did something inexplicable rather than nothing.

### What it actually did

Driving the built bundle against those two names:

```
rename  FID_INTL_PortalToParadise_DOOH_MULTIART_1180x228px_10s_CO_V01.aep
    ->  FID_INTL_PortalToParadise_DOOH_MULTIART_1180x228px_10s_CO_V01_copy.aep
```

`campaignRename` inserts the PDF's descriptive tokens between the AE name's
four-token prefix and its resolution-onward suffix, and it read those tokens
from `parseFilenameMeta(...).campaign`. Under the current convention `campaign`
is the CREATIVE — `MultiArt` — and the AE file already carried `MULTIART` in
its site slot, so the name it built was byte-identical to the name on disk. The
`while (targetFile.exists)` loop then found the file itself, decided the target
was taken, and appended `_copy`. Every AEP in the folder renamed itself and no
site name ever landed.

### The legacy names were broken too, and differently

The probe's second fixture is the form this tool was ported against:

```
ODY_INTL_DGTL_DOOH_1920x858_10sec_OV.aep
    ->  ODY_INTL_DGTL_DOOH__1920x858_10sec_OV.aep
```

On a `_DGTL_` name the artwork type is the FIRST descriptive token, so nothing
sits left of it and `campaign` comes back `""`. The empty string was spliced in
as a token, giving a double underscore. So the tool was wrong on both
conventions at once, in opposite directions, which is why nobody had a clean
theory about it.

### Cause

`d0653f6` (13 Aug, "Cheeky DT/T: campaign is left of the artwork type") re-cut
`parseFilenameMeta` so that `campaign` is the creative alone and the new
`siteName` holds everything right of the artwork type. That was the correct fix
for the frontcard overflow it was chasing. `campaignRename` was a silent second
consumer wanting the whole descriptive part, and nothing anywhere connects the
two: `tsconfig-build.json` type-checks zero files under `src/jsx`, both fields
are strings, and the tool reports `success: true` either way. It had been
renaming projects to `_copy` for twelve days before anyone described the
symptom precisely enough to chase.

This is the same shape as the `bestMatch.fsName` break CLAUDE.md §6 records: a
field rename that compiles, ships, and only shows up as behaviour.

### The fix, and why one field lands both conventions

`siteName` instead of `campaign`. It works for the legacy form and the current
one for the same reason: the four-token prefix ends ON the artwork type in
both — `FID_INTL_PortalToParadise_DOOH` and `ODY_INTL_DGTL_DOOH` — so
"everything right of the PDF's artwork type" is exactly "everything after the
AE file's prefix". The creative stays where it is and only the site is
replaced; on a legacy name, where the creative lives right of `DGTL_DOOH`, it
travels with the site because it is part of the same descriptive run.

Four things went with it:

- **Original casing.** The `.toUpperCase()` on the borrowed tokens was a no-op
  on the names it was written for — legacy sites were already caps
  (`HORSE_LOS`) — but the current convention spells them `SalitreWheel`, which
  is how that site is written in every other name in the tree. The
  no-resolution fallback branch compares uppercase against uppercase now that
  the tokens themselves keep their case.
- **The resolution scan.** It was a bare `/\d{2,4}x\d{2,4}/` per token, which
  matches a JPG_PNG ratio token like `16x9` and cuts the name there, dropping
  the real resolution. `parts` is already split on `_`, so the token boundary
  was free — it is now the same three-digits-each-side test as
  `firstSizeToken`, anchored per token.
- **An empty site is a skip, not an empty token.** A PDF with nothing right of
  its artwork type has no site to lend.
- **A name that is already correct is reported, not re-`_copy`d.** The message
  gained an "N already named" clause, so running it twice says so instead of
  quietly doing nothing — or, before, quietly doing something worse.

The prefix is also capped at the resolution index now (`resIndex < 4 ?
resIndex : 4`), which retires the documented "a shorter filename will duplicate
the resolution token" caveat rather than preserving it.

### Verification

`scripts/probe-campaign-rename.cjs` drives the built bundle's `campaignRename`
over a stubbed filesystem, seven cases: both conventions, two sites at one size
(one AE file, one correctly-named copy each — the shape a real campaign folder
has), an already-correct name, a PDF with no site, a `_16x9_` ratio token, and
a site carrying a grid (`Hoyts3x3`). All seven fail on the old code.

The probe exists because this class of bug has no other gate. `yarn build` is
silent on it, both tsconfigs are silent on it, and the tool's own return value
says `success: true` while renaming a folder of masters to `_copy`.

**Not done:** matching is still on the size token alone, which is the studio's
confirmed intent (PDFs carry the screen name, AE files don't yet). It cannot
tell which of two same-size PDFs belongs to which of two same-size AE files —
it copies for each, which is right when one master serves several sites and
wrong when the AE files were already per-site. Nobody has hit the second case.

---

## 2026-08-25 — A front door for a clip on the two hub tools

The tutorial icon shipped into `tool-content-header`, which `ToolScreen`
suppresses for `review-hub` and `delivery-hub` (`HUB_TOOL_IDS`) because those
two carry their own full-page chrome and would otherwise double up on a header.
So `Deliver.mp4` matched its tool perfectly and had nowhere to be played from —
and because the whole feature is silent by design, dropping the clip on the
share would have looked exactly like dropping it in the wrong place.

Both hubs now carry the icon at the head of their own top bar, which is the
same visual band a tool's title glyph occupies one screen over.

**Review** needed a wrapper. `.rh-tab-bar` holds an absolutely-positioned
highlight at `width: 50%`, `left: 0%|50%`, physically sliding between two tabs —
a third child would have put the slider over the wrong half of the wrong
element. The icon sits in a new `.rh-tab-row` flex strip beside the bar, with
`flex: 1` scoped to that row rather than added to the shared `.rh-tab-bar` rule
(CLAUDE.md §3: `flex: 1` means "fill width" in a row and "fill height" in the
column it used to sit in directly).

**Delivery** takes it as the first child of `.dh-action-bar` — with a `Package`
glyph, not the registry's `Truck`, because the Delivery button 6px to its right
already has a truck that animates out on click, and two trucks in one bar read
as one control drawn twice.

`demoBridge`'s tutorial list gained a `Deliver` entry so the one placement that
is NOT the shared tool header is exercisable in browser preview instead of only
on a machine with the share mounted.

**Not done:** neither hub icon has been seen in a real docked panel yet, and
`tutorialsList` still has never run inside After Effects.

---

## 2026-08-25 — The frontcard read FORGOTTEN again

Reported off a Multiple Art build: `Forgotten Island` on the card, second word
missing. The fit that exists to prevent exactly this had shipped weeks earlier,
and its own docstring names this film.

### Measured on the real card, in real AE

```
Film Title  text="Forgotten Island"  allCaps=true  tracking=80
            font=ProximaNova-Bold  size=88
            BOX size=[918.6, 90.3]
```

| | width |
|---|---|
| what `measureUnwrapped` reported | 730.4 |
| the same string uppercased | 936.6 |
| what the layer actually draws | 950.7 |
| narrowest box that does not wrap | 959.2 |
| the box on the card | 918.6 |

The arithmetic in `fitFrontcardText` was never wrong. It was handed 730.4,
compared it to a 918.6px box, concluded there was 188px to spare, and grew
nothing. The title then wrapped into a box one line tall and the second word
was clipped.

### Why the measurement was short

`measureUnwrapped` built a synthetic probe: `addText`, then copy across
`fontSize`, `font` and `tracking`. Three attributes out of however many a text
layer has — and the one that mattered was **All Caps**, which the brand
template has on. The layer stores `Forgotten Island` and the card draws
FORGOTTEN ISLAND, and capitals are 28% wider.

The obvious repair does not work: **`allCaps` and `boxText` are both READ-ONLY
on `TextDocument`.** AE 2026 refuses `dd.allCaps = true` outright
(`Unable to set "allCaps". It is a readOnly attribute.`), so a probe cannot be
made to render like the layer. The first attempt at this fix set the probe's
string to upper case instead, which gets to 936.6 — and would have grown the
box to 955, which is still under 959.2 and still wraps. It would have looked
fixed while failing on the same card.

The remaining 14px is trailing tracking and side bearings. At tracking 80 that
is two characters' worth, and the entire margin between fitting and wrapping
here was 40px.

### The fix

Measure a **duplicate of the layer itself**, widened past anything it could
need. A duplicate carries every attribute by construction — All Caps, tracking,
faux styles, ligatures, whatever gets added to the template next — so there is
nothing left to model. `boxTextSize` IS writable, which is what makes it
possible.

The pad went from 2% to 3% of the measured width: bisected on the real card,
AE's own wrap threshold is ink + 8.5px (0.89%), and 2% of the *under-measured*
width was part of how the first attempt still failed.

The duplicate must come off in a `finally`. It sits directly above the original,
so one left behind shifts every layer index below it — and `frontcardWriteFields`
writes the artwork, version and territory fields BY INDEX immediately after the
fit returns.

### Verification

Driving the rebuilt bundle's `frontcardWriteFields` against a duplicate of the
real card, in a scratch comp:

```
frontcardWriteFields -> {"success":true,
    "message":"Title box widened from 919px to 980px and recentred."}
box after the fit       = 980        (needs >= 959.19)
renders at its own box  = 950.6866
renders unwrapped       = 950.6865   -> one line, whole title visible
items before=177 after=177
```

The artist's own card was read and never written; the probes duplicate, measure
and remove, and the item count is checked either side.

**Not done:** the Multiple Art build path wraps and scales a frontcard but never
stamps its fields, so the title on a fresh build is whatever the template or a
later Cheeky DT pass put there. That is why this surfaced on a Multiple Art
file. Worth deciding whether that path should stamp the card itself.

---

## 2026-08-25 — A solo tile takes the deliverable's shape (and a null that never left)

Reported off a real Brazil MultipleArt build: the deliverable comp and its _V01
wrapper are the size that was asked for, but the imported masters keep their
own, so localised artwork does not fit them.

### What the build actually looked like

```
BUILD  FID_INTL_MultipleArt_DOOH_1920x768px_30s_BR   1920x768  30s
  [1] Trio             source 1920x960   scale 80.00%   15->30s
  [2] PortalToParadise source 1920x858   scale 89.51%    0->15s

MASTER  FID_INTL_PortalToParadise_DOOH_1920x858px_15s_OV   1920x858
   [1] FID_INTL_PortalToParadise_DOOH_1920x768px_30s_BR2.jpg   4000x1600
```

The artwork is **2.5:1**, made for the 1920x768 deliverable. The master comp it
lands in is **2.24:1**. That is a different SHAPE, not a different scale, so
nothing can nudge it into place — it sits letterboxed with the master's own OV
text still visible underneath, which is what the report showed.

The tiles were pillarboxed for the same reason: left at native size on a
shorter canvas, an 858-tall master scales to 89.5% and a 960-tall one to 80%,
so a 1920px canvas was showing 1719px and 1536px of picture.

### Not an oversight

"LAID SIDE BY SIDE AT NATIVE SIZE, THEN CENTRED" is a deliberate decision with
its own note: dividing the canvas into n equal panels and scaling each to fit
"forced every tile to the canvas whether it belonged there or not". That is
right for a tiled row and wrong for a creative that fills the frame alone, and
the difference had never been drawn.

### The rule

A master is reshaped to the canvas **only when it is solo in every segment it
appears in**. A tile sharing a row is showing a panel, not the deliverable, and
no mech export exists at a panel's size — reshaping those would stack three
full-frame masters on top of each other. A master used solo in one segment and
tiled in another is left alone and says so in the report, because it cannot be
both and the build should not pick.

Measured in AE, `scaleCompToFit(1920x858 -> 1920x768)` keeps the layer at 100%
and crops 45px off the top and bottom — full width kept, which is what a wider
target wants. Afterwards `natural == canvasW` and `tallest == canvasH`, so
`fit` is exactly 1 and the pillarboxing goes with it.

### The name

`bespokeSoloCompName` takes the deliverable's name and swaps in the master's
creative, so the comp ends up called what the mech already called the artwork:

```
artwork  FID_INTL_PortalToParadise_DOOH_1920x768px_30s_BR2.jpg
comp     FID_INTL_PortalToParadise_DOOH_1920x768px_30s_BR
```

**The creative is `campaign` OR `siteName`, in that order** — the second time
in one day that mattered. Current names put the creative left of the artwork
type, so `campaign` holds it; legacy `_DGTL_` names have the artwork type FIRST
in the descriptive run, so `campaign` is `""` and it lives in `siteName`. The
first cut of this read only `campaign` and silently renamed nothing on every
legacy name — caught by the probe, not by the compiler.

It is exported rather than inlined so `scripts/probe-bespoke-rename.cjs` drives
the real function instead of a transcription of it. Eight cases: both
conventions, the artwork-filename match, a master whose creative IS the
deliverable's, an unparseable name on either side, and a deliverable carrying a
site the master must not inherit.

### The null that never left

Found while verifying the reshape: the probe leaked five project items, and
three of them were not the probe's fault.

`scaleCompToFit` parents everything to a temporary 3D null and removes it in a
`finally`. **Removing a null LAYER leaves its footage ITEM in the project.** So
every call has been leaving an orphan behind since it was written. In the
reported working file: `Footage/Solids` holds `Null 1` six times, `Null 5`
seven times, and `Null 43` through `Null 52`.

Multi Comp Scale, Scale Composition and the Bespoke frontcard step all come
through this function, and the solo-tile reshape now runs it once per master
per build, so it compounds from here. The item is read before the layer is
removed — the layer object is no use afterwards — and dropped only when
`usedIn.length === 0`.

Verified against the rebuilt bundle in the real project: 233 items before each
call, 233 after, and the probe returned the file to exactly the 228 it started
at. Nothing was saved at any point.

**Not done:** the reported build was made with the old code, so its two masters
are still 1920x858 and 1920x960. Rebuilding is what reshapes them; there is no
repair pass for a build that already exists.

---

## 2026-08-25 — Notes and steps stopped looking like one list

Reported from a Workflows panel with four steps and one note: "they feel like
the same thing here." They did, and measurably so.

| | step card | note |
|---|---|---|
| fill | `rgba(255,255,255,0.022)`, `0.06` current | `rgba(255,255,255,0.03)` |
| radius | 6px | 4px |
| body text | 12.5px | 12px |
| emphasis | 700 `#ffffff` | 700 `#ffffff` |
| left edge | teal @ **35%** (only when current) | teal @ **100%** |

The last row is the one doing the damage. The panel pins `--cat-border` to
`#2dd4bf` and a note used it at full strength, so the strongest "this is a step,
and it is the one you are on" signal in the panel was being spent on something
that was not a step at all.

### What they actually are

Steps are a route you walk: ordered, stateful, finite, half of them handing you
to another tool. Notes are standing knowledge pinned beside the route:
unordered, authored, tagged, never completed. The accent now splits along that
line — `--cat-*` means *where you are*, `--ov-note*` means *knowledge*.

Three directions were drawn as working panels and put in front of the studio:
notes as marginalia (no card at all), notes with their own colour, and notes
sunk into a recessed well. The studio picked the colour, explicitly setting
aside the one-tint principle the panel was built on. Their call, and recorded
here as a decision rather than a drift.

### The fixed amber was wrong

The mock used `#e8a33d`. Checking it against the shipping themes killed it:
**Ember is `#fb923c` and Gold is `#facc15`**, so for those two the steps and the
notes would have come out the same hue and the change would have cost those
users everything it bought everyone else.

So the hue is derived from the active accent, rotated **−134°**. The angle is
not the complement — it is chosen so the default teal (hsl 172) lands on amber
(hsl 38), which is the colour that was signed off; 180° would have given
magenta. Measured across every theme:

```
default  #2dd4bf -> #d4a654 amber      gold     #facc15 -> #9c54d4 purple
blossom  #f472b6 -> #54b5d4 cyan       crimson  #f87171 -> #5472d4 blue
dusk     #a78bfa -> #54d456 green      emerald  #34d399 -> #d48754 orange
ember    #fb923c -> #7054d4 violet     slate    #94a3b8 -> #a4c95e olive
sapphire #60a5fa -> #abd454 lime
```

**Saturation is clamped at both ends.** The floor (0.5) keeps Slate usable — at
0.20 saturation a rotated hue is a grey with an opinion, not a second colour.
The ceiling (0.6) keeps the loud themes bearable: unclamped, Dusk gave the notes
an acid `#32f635` and Ember an electric `#5a2dfb`, which is a primary accent,
and notes are supporting furniture.

The alpha variants are computed in JS alongside the hex, because `color-mix()`
is Chrome 111 and the target is chrome74 — CSS here cannot derive a translucent
fill from a custom property.

### One rule instead of forty edits

The retint is two custom properties redefined on `.wfb-notes`:

```scss
--cat-border: var(--ov-note, #d4a654);
--cat-icon:   var(--ov-note-soft, #e2c48d);
```

Everything inside a note already keys off `--cat-*`, so that single move
retints the left bar, the tag pills, the note links, the territory chips and
every focus ring — and anything added to a note later inherits it for nothing.
It is the same mechanism the bubble already uses to pin its own tint on
`.wfbub-panel`. The alternative was editing each of the dozen note-scoped
`var(--cat-...)` call sites and remembering to edit the next one too.

**Not done:** a picker portaled to `<body>` is outside the subtree and keeps the
category tint, which is the re-apply rule CLAUDE.md already gives for Dialog and
DragOverlay. And the shared card SHAPE survives — the two still read as two
lists, one teal and one amber, which is exactly the trade-off the colour option
was chosen with its eyes open.

---

## 2026-08-25 — Edit in Context follows the selection

Asked for directly: "when we click Edit in Context, it works great but I was
wondering if we could target the selected layer straight away?"

The tool opened on the active comp and listed its precomps as doorways, and you
found the layer you had *just selected* a second time in that list. The
selection is the thing you already pointed at; asking for it twice is exactly
the friction the tool exists to remove.

### The ask needed one round trip

"Target" was ambiguous against the tool's actual model, and the ambiguity was
worth resolving before building rather than after. **At root level the panel
lists precomps ONLY** — they are doorways, and clicking one drills in. So a
selected layer could mean either "open that doorway" or "make this the thing the
arrows nudge", and the second would have meant listing every layer at root,
changing what the tool shows. The studio picked the doorway: a plain layer
selected up there has nothing to open, and AE's own arrow keys already nudge it.

### Two rules stop it fighting the artist

**Act only when the signature changes.** The signature is `compId:layerIndex`
and it is remembered between ticks. The panel's target and AE's selection are
two different things and the artist moves both — a poll that re-applied what it
saw every second would undo a layer picked in the panel a moment later, using a
selection in AE that had not actually moved. Acting on change alone is also what
makes it safe to run continuously, which is what was asked for over a
read-on-open-only version.

**Exactly one selected layer counts.** "The selected layer" has no meaning when
three are selected, and taking the first would be a guess the artist never made,
so the panel leaves its target alone. Measured against a real comp: two selected
returns `count=2, layerIndex=0`.

`editInContextReveal` had to be taught to skip one tick. It selects the layer it
just revealed and opens that comp in the viewer — a genuine selection change by
the signature's reckoning — so without the skip, revealing a nested layer threw
away the trail it had been revealed from.

### The poll

`editInContextSelection` is the cheapest call in `tools.ts`: two reads, no undo
group, nothing written, no viewer touched. It duck-types the comp and the
precomp rather than using `instanceof`, per section 2 — it runs about once a
second, and two accesses of one AE object come back as different wrappers.

The panel calls it through a local non-toasting wrapper. The existing `call`
announces a missing bridge, which is right for a button and wrong once a second
in browser preview, where it would be a panel shouting about having no After
Effects open.

### Verification

Driven against the artist's open project:

```
active comp: FID_INTL_MultipleArt_DOOH_1920x640px_30s_BR_V01  (2 layers)
nothing selected -> count=0 layerIndex=0
select [1] Landscape_Frontcard -> isPrecomp=true sourceCompId=1804
select [2] FID_INTL_MultipleArt… -> isPrecomp=true sourceCompId=1756
two selected -> count=2 layerIndex=0
selection restored: was [1] now [1]
```

The probe cycled the real comp's selection and put it back exactly as found;
item count unchanged either side.

**Not done:** the panel's behaviour itself has only been reasoned about and
type-checked — the loop, the skip and the re-root have not been watched in a
docked panel, and browser preview cannot exercise them because the whole tool is
bridge-only.

---

## 2026-08-25 — Cheeky T was never reading the name at all

Reported as two things: could Cheeky T "make a check on all things", put
"Multiple Art" where the build is a MultipleArt, and stop "retrieving nothing
and leaving the ” for seconds stranded".

The third turned out to be the cause of the other two.

### An underscore count standing in for a question

Both Cheeky T entry points opened with `if (name.split("_").length < 8)` and,
below that threshold, stamped `(HO Approved)` and touched nothing else. That
count is a proxy for "does this name carry what a frontcard needs", and it was
calibrated on the legacy convention, which spends a token on `DGTL` and usually
another on a site:

```
ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV     9 tokens
FID_INTL_MultiArt_DOOH_SalitreWheel_1180x228px_10s_CO   8
FID_INTL_MultipleArt_DOOH_1920x640px_30s_BR        7   <- do-nothing path
FID_INTL_PortalToParadise_DOOH_1920x858px_15s_OV   7   <- do-nothing path
```

The current convention drops `DGTL`, so a deliverable with no site token is
seven. Every one of those fell through the gate. "It retrieves nothing" was not
a failed lookup — it was a name the tool never agreed to read, reporting
success while doing nothing but stamp `(HO Approved)`.

`frontcardNameUsable` — an artwork type and a size — was already in the file,
used by the "from name" reset. It asks the real question, and both gates now
use it. The message stopped saying "Short comp name" too: that sent people
counting underscores at a name that was simply missing a token type.

### The stranded mark, and why it grew

`splitCampaignLine` handed the RAW line back on both of its bail-outs, inch mark
included — and the caller appends a mark of its own. So every run over a line it
could not parse added another one:

```
Multiple Art ”   ->   Multiple Art ” ”   ->   Multiple Art ” ” ”
```

each reported as a successful update. Both bail-outs now strip the mark, so a
line the parser cannot read round-trips unchanged.

The strand itself had two sources, and both are closed:

- **Nothing to say is not a line.** With both halves empty, the writer put the
  inch mark down on its own. It now leaves the line exactly as found and says
  so in the message, naming how many cards it left alone.
- **The half not sent comes off the card.** `frontcardWriteFields` filled the
  half you did not edit with `""`, which is the same strand from the other
  direction — and the review modal sends one field at a time as you type. It
  now reads the missing half back off the card.

### All things, and the creative

`cheekyTCheck` had `doCampaign` and `doDuration` off — the original's fixed
args. They are on now, which is what makes a MultipleArt build read
"Multiple Art": `campaignWords` splits that token exactly as it splits
PortalToParadise. The title stays off, because it is the one field derived from
the PROJECT PATH rather than the name and it carries its own box-fit; that
remains Cheeky DT's.

The creative is read as **`campaign` or `siteName`**, in that order — the third
consumer of that field in one day to need it, after Campaign Rename and
Bespoke's solo rename.

`cheekyTInspect` now reports both as resolvable fields, so a name that cannot
answer them opens the review modal and collects them instead of stranding the
line. The modal gained a Campaign field and a Seconds field; Seconds takes a
bare number, because which inch mark a card uses is read off that card and
appended host-side.

### Verification

Driven against a duplicate of a real frontcard, running Cheeky T twice over
each starting line:

```
"Portal To Paradise 15”"  -> "Multiple Art 30”" -> "Multiple Art 30”"  STABLE
"”"                       -> "Multiple Art 30”" -> "Multiple Art 30”"  STABLE
"Multiple Art ”"          -> "Multiple Art 30”" -> "Multiple Art 30”"  STABLE
"CREATIVE NAME ”"         -> "Multiple Art 30”" -> "Multiple Art 30”"  STABLE
""                        -> "Multiple Art 30”" -> "Multiple Art 30”"  STABLE

unparseable comp name, card already correct
   -> "Portal To Paradise 15”" untouched
```

The same probe on the old code returned "Short comp name — stamped
(HO Approved)" for all five, which is the bug as reported. Items 287 before and
after; the artist's own cards were duplicated, never written.

**Not done:** the modal's two new fields have been type-checked but not driven
by hand — the whole path is bridge-only and browser preview cannot reach it.

---

## 2026-08-25 — Save Component

Asked for as a sibling to Save From Comp: prepare a component in a project, get
just that comp out to its own `.aep` named after it, and have the project left
exactly as it was — replacing "reduce by hand, Save As, rename the file, go back
to AE and Ctrl+Z", where the last step is the one people forget.

Three measurements decided the design, and two of them killed the obvious one.

### Ctrl+Z is not available to a script

The obvious build is reduce → save → undo. It does not work. Tested three ways
in AE 26.2 — reduce then undo, undo three times, and the reduce wrapped in
`beginUndoGroup`/`endUndoGroup` — and the project stayed reduced every time:

```
A  reduce then undo, nothing between      5 -> 3 -> 3   NOT RESTORED
B  reduce then undo x3                    5 -> 3 -> 3   NOT RESTORED
C  reduce inside beginUndoGroup           5 -> 3 -> 3   NOT RESTORED
D  reduce, save, reopen from disk         5 -> 3 -> 5   RESTORED
```

AE's own dialog claims "You can undo if desired". A person can; a script cannot.

### The menu command is modal

`Reduce Project` is menu id 2735, and it always raises *"N items that were not
used by the selected items have been deleted. You can undo if desired. WARNING:
items referenced ONLY by expressions are not preserved."* That stopped the probe
dead mid-run and needed a human to click OK — which is exactly what it would do
to a panel button, halfway through a sequence.

`app.project.reduceProject(items)` is the same operation as an API and returns
silently: measured, 5 items to 3 with the script still running. Same family as
`consolidateFootage` and `removeUnusedFootage`, both also present.

The expressions warning is real and applies to the API too. It is reported in
the result rather than guessed at — the panel cannot know whether a given
component leans on one.

### The order is the safety

Nothing in this writes the artist's file. Not to restore the pointer, not at the
end, not on failure:

```
save(componentFile)    the full project, under the comp's name
reduceProject([comp])  in that file, not in the artist's
save()                 the component file again, now reduced
open(originalFile)     the artist's project comes back off disk
```

After the first line the open project IS the component file, so everything
destructive from that point lands on a file this tool just created. The original
is only ever read.

### Why it refuses on a dirty project

Found the way these things are usually found — a prompt appeared mid-probe:
*"Save changes to 't.aep' before closing?"* `app.open()` asks that whenever there
are unsaved changes, and at that point in the sequence the open project is the
REDUCED one. An artist clicking **Save** would write a reduced project straight
over their original. Requiring a clean project to start means there is nothing
for AE to ask about, and the `catch` saves the component file before reopening
for the same reason.

### Verification

The built bundle's export driven end to end, with `Folder.prototype.selectDlg`
stubbed so the picker could not block:

```
unsaved project   -> "Save this project once first…"
nothing selected  -> "Select the comp you want to save out…"
dirty project     -> "Save your project first…"

run 1 -> ["Trio_TT.aep"]      items 5 -> 5 RESTORED, file back to orig.aep, dirty=false
run 2 -> ["Trio_TT_V02.aep"]  items 5 RESTORED
Trio_TT.aep holds: Solids, used_by_keep, Trio_TT   (OTHER gone — genuinely reduced)
orig.aep still holds 5 items  UNTOUCHED
```

Every probe ran on a throwaway project and refused outright if After Effects was
holding a real one.

**Not done:** the folder picker has never been opened for real — `selectDlg` was
stubbed in every test, so "opens on the project's own folder" is from the API
docs and one existence check, not from watching it. And a component whose layers
are driven by expressions has not been tried; the result says so rather than the
code detecting it.

---

## 2026-08-26 — A Multiple Art segment could only ever be a row

Reported from a Spain build: portrait canvas chosen, three portrait masters
added, "but it always comes in a landscape set up". The panel was saying so
itself, in three places at once — `3 × 85px` under the strip, *"this segment is
2532px across a 256px canvas. It will be scaled down to fit"*, and above all of
it the caption **"This segment fills the frame"**.

Three 844-wide masters laid end to end are 2532px. On a 256px-wide canvas that
scales to 10.1%, giving 85×241 tiles on a frame 2304px tall. It filled almost
none of it.

### Widths and nothing else

`bespokeBuild` summed `c.width`, compared it to `canvasW`, and positioned each
tile at `[centreX[t], canvasH / 2]`. There was no other axis in the code. The
panel's preview did the same thing — `naturalWidth`, summed widths — so the two
halves agreed with each other and both were wrong on a tall canvas.

### The long axis, unless told otherwise

A segment now carries an optional `stack` of `"row"` or `"column"`. Absent means
follow the canvas: taller than wide stacks, anything else rows. Absent rather
than defaulted on purpose — the layout keeps moving with the canvas while the
artist is still deciding the size, and only stops when they pin it with the
Row/Column buttons in the stage foot. A screen saved before this existed has no
`stack` and reads correctly.

Measured on the reported numbers:

```
case                        axis    scale     each tile   coverage
before (always a row)       row     10.1%     85x241      256px of 256px
after (follows the canvas)  column  30.3%     256x723     2168px of 2304px
after, forced Row           row     10.1%     85x241      256px of 256px
after, forced Column        column  30.3%     256x723     2168px of 2304px

landscape, unchanged        row     50%       960x429     1920px of 1920px
```

The "before" row reproduces the `3 × 85px` from the screenshot exactly, which is
what says the transcription is honest. The landscape case is untouched.

### Two things that had to move with it

**The preview and the build must share the rule**, or the panel draws one layout
and AE builds another. `segmentIsColumn` in the panel and the `isColumn` block
in `bespokeBuild` are the same three lines; the hint copy switched from "across"
to "down" and from "either side" to "above and below" with it.

**Tile drag-reordering hit-tested on x only.** `indexAtX` walked the tiles
comparing `left`/`right`, which is meaningless once they are stacked — every
tile spans the same x range, so the first one matches and any drag would have
reordered to index 0. It now tests along whichever axis the thing runs, and the
movement threshold reads the same axis. The running-order strip below is always
horizontal and keeps the x test.

The `||`/`&&` shape of the first cut was rejected by
`scripts/audit-jsx-precedence.cjs` — it does not survive the ES3 emit — and is
an if/else now.

**Not done:** the arithmetic is verified and the panel type-checks, but no
Bespoke build has actually been run in After Effects with a stacked segment. The
placement call is `[canvasW / 2, centreX[t]]` where it used to be
`[centreX[t], canvasH / 2]`, and that swap has not been watched land.

---

## 2026-08-26 — The canvas follows the reference's shape

Asked for as "the bespoke section should adapt its canvas size to what the
reference added is, whether it's a library tracing option or a reference put
in".

The literal version of that is wrong, and the code already said so.
`Bespoke.tsx` carries a written decision at the reference `<img>`: the JPGs come
out of the PDF at whatever the export felt like — **"8000x5867 for a 3840x2816
board is normal"** — so the filename is treated as the deliverable's spec and
the image is *checked against* it rather than trusted. Taking the image's
dimensions would have turned a 3840×2816 board into an 8000px comp.

But the gap was real, and `swapReference`'s own comment names it: *"a candidate
called 'Tower Ref.jpg' has no size to re-read anyway"*. `adoptReference` read a
`WxH` token out of the filename and, when there wasn't one, left the canvas at
whatever the last job put there — so the new reference got traced over at the
wrong shape, with the existing warning pointing at it and nothing fixing it.

### Shape from the reference, scale from the spec

Precedence on adoption:

1. a `WxH` token in the filename — the deliverable's own spec, unchanged;
2. else a library entry's stored canvas — the board someone already traced;
3. else the image's **aspect**, applied to the width already in the field.

```
reference                   entry        image       -> canvas     why
Tower Ref.jpg               —            8000x5867   2000x1467     shape from the reference
GRAND_REX_3840x2816.jpg     —            8000x5867   3840x2816     from the filename
Tower Ref.jpg               3840x2816    8000x5867   3840x2816     from the library entry
metrobus.png                —            1080x1920   2000x3556     shape from the reference
Tower Ref.jpg               —            4000x2000   2000x1000     already the right shape
```

2000×1467 is 1.3633:1; the reference is 1.3636:1 and the real board is 1.3636:1.
Same screen, same shape, at a size somebody can actually deliver.

### Once, on adoption

`shapeFromRef` holds the path that still owes the canvas a shape, and the image's
`onLoad` clears it. That matters in both directions: the adaptation happens the
moment a reference appears, and it happens exactly once — after that the artist
owns the canvas and a differing aspect goes back to being the note it always
was, not a correction applied behind them.

A library entry that carries its own canvas withdraws the request, because a
board someone traced outranks anything an image can offer. Swapping between
sibling references of an already-traced board still never re-sizes — that path
exists to try a better photo of the same screen, and the board is already drawn.

**Not done:** verified as arithmetic and type-checked, not watched in the panel.
The one path that cannot be reasoned about from here is what a real seeded
template carries in `canvasW` — if those come through as 0, they now fall to the
image's shape, which is the intended answer but has not been seen happen.

---

## 2026-08-26 — Two board tools that only worked on a normal frame

Raised as "we have this, with a bunch of rotated stuff too, how would you
approach it" over a `FID_INTL_MultiArt_DINTH_IconLedArchway_6720x320px_15s_TH`
board: sixteen-odd panels repeating across a 21:1 strip, several of them turned.

Rotation turned out not to be the problem. `rotateRegion` already swaps the
region's window w/h about its centre so a quarter turn is physical rather than
spinning artwork inside a landscape hole, and `facing()` feeds the turned
footprint into ratio-matching, cover scale and crop percentage. What the tool had
no notion of was **repetition**, and two of its board tools were written against
a 1920×1080 frame.

### A copy landing under its original

`duplicateRegion` offset by 3% of the SMALLER canvas side. On 6720×320 that is
`min(6720,320) × 0.03` = **10px**, so every copy appeared essentially underneath
the region it came from and had to be dragged 400px into place — sixteen times.

It now steps a full region-width along the board's long axis with a hairline
gutter, so pressing it repeatedly chains the panels across the strip:

```
before   copy 1 at x=10, copy 2 at x=20      10px apart
after    0, 403, 806, 1209, 1612, 2015       a panel-width apart
```

A region with no room left to chain falls back to the old nudge rather than
stacking two at the far edge — a copy you cannot see is worse than one slightly
overlapping. A tall board chains down instead: a 320×6720 pillar duplicates to
`y=403`.

### Fifteen guides on one coordinate

`addGuide` drops every guide at the centre of the board. That is right for one
and hopeless for a rhythm: sixteen panels is fifteen lines all landing on 3360,
dragged apart one at a time.

`divideGuides` lays n−1 even cuts in a press. On the archway, Divide 16 gives 15
guides at exactly 420px intervals, first cut 420, last 6300. Three properties
that make it safe to reach for:

- **it merges rather than replaces**, so a hand-placed line for the one panel
  that breaks the pattern survives being asked for sixteen even ones;
- **it is idempotent** — pressing it twice changes nothing;
- **the board's own edges are already guides** (`neighbourBounds`), so the ends
  are not drawn.

It splits the long axis, because that is the one a repeating strip repeats
along; a square board gets the vertical cuts, which is the commoner ask.

**Not done:** arithmetic and typecheck only, not driven in the panel. And the
third idea from that conversation — "repeat N times across", seating copies
directly in the guide cells — was deliberately left until these two have been
used, since together they may already make it unnecessary.

---

## 2026-08-26 — 270 rotated the picture but not the geometry

Reported precisely: "the rotating 270 degrees will not produce the same effect
as the 90 degrees which is working as intended — the 270cc will not show the
rotation properly in the reference panel, and when built it will not have the
matte layer laid out properly but only staying in the middle of the comp."

Two separate defects, and between them they account for both halves of that.

### −90 is not 270

Every `turned` test in the panel and in `bespokeBuildRegions` reads
`rotation === 90 || rotation === 270`. `bespokeRegionsFromComp` takes the angle
straight off the AE layer as `Math.round(tr.rotation.value) % 360`, and **AE
hands back −90 for a counter-clockwise quarter turn**. In JavaScript
`-90 % 360` is `-90`, not `270`.

So a counter-clockwise region carried −90 and failed the test in both places:
the preview did not treat it as turned, and the build left the footprint
unswapped while still setting `transform.rotation` to −90, which renders at 270.
A rotated picture with unrotated geometry — the cover ratio computed on the
wrong axis and the matte built from the wrong box.

```
stored   -> turn   face          cover
  -90    ->  270   1920x1080     38.9%     (was: turn -90, face 1080x1920, 29.6%)
```

`quarterTurn()` folds positive and snaps to the nearest quarter — so −90, −270,
89.5, 360 and a missing value all resolve to something the tests can read — and
it is applied at every entry point: the comp scan, the screen library, detect,
the rotate button, and the plan handed to the build. The build normalises again
on its own side, because a plan can arrive from a saved screen written before
any of this.

### The clamp ate the box

`patchRegion` caps a region's size to the board on every change, which is right
for a drag or a typed number and wrong for a quarter turn. `rotateRegion` swaps
w and h, and on a board shorter than the region is wide that swap was clamped:

```
board 6720x320                     board 1920x1080
start   rot   0   420x320          start   rot   0   420x320
press 1 rot  90   320x320  ← lost  press 1 rot  90   320x420
press 2 rot 180   320x320          press 2 rot 180   420x320  ← restored
press 3 rot 270   320x320          press 3 rot 270   320x420
```

On a normal frame it round-trips exactly, which is why this only ever showed up
on the boards the tool exists for. On the archway the first turn destroyed the
panel's real width, 180 could not restore it, and the matte — built from
`reg.w`/`reg.h` — came out a square.

Rotation now passes `keepSize` and four presses return the panel exactly as it
started.

That does mean a turned region can extend past a short board, and the clamp was
what enforced "a region outside the board is not a layout, it is a mistake". It
enforced it by destroying data, so the rule moved from a silent crush to a
visible note listing which regions run past the edge. A turned panel on a short
board legitimately passes through that state on its way somewhere.

**Not done:** arithmetic and typecheck, not driven in the panel or built in AE.
The matte's own position was never wrong — it is the region box it is built
from that was — so the fix is upstream of the line that looked guilty.

---

## 2026-08-26 — Panels can crop by their own bounds instead of a matte

Asked alongside the rotation bug: "can we multicomp scale the comp to fit within
whatever boundary we gave it? At the moment we're using a matte layer to
constrain them."

Yes, and it is worth having — a sixteen-panel archway drops from 32 layers to
16, and every panel becomes a real comp at its delivered size, which is exactly
what Save Component takes out later. But it is an OPTION rather than a
replacement, for two reasons that only showed up on reading the build.

### Regions mode shares one comp per master

`bespokeBuildRegions` imports each distinct master once into `compFor[path]` and
adds it as a layer for every region that uses it. `duplicatePanels` — the flag
that gives each panel its own copy — exists only in `bespokeBuild`, the multi
mode. So scaling the shared comp to fit panel 3 would resize what panels 7 and
11 show, which on a repeating archway is most of them. Comp-cropping therefore
duplicates per region; there is no version of it that does not.

### The matte is not overhead, it is a property

The matte replaced a mask precisely to separate the crop from the content:
"move the SOLID and the window moves; move the MASTER and the artwork reframes
inside it". Comp-cropping welds them back together — reframing a panel becomes
re-running a scale rather than dragging the artwork under a fixed window. That
is a real loss on a board still being composed and no loss at all on a finished
one, which is what makes it a per-board choice rather than a better default.

### Sized unrotated

A turned region's `w`/`h` is its footprint AFTER the turn, so the panel comp is
built to the swap of that and rotated into place. Sizing it to the region
directly would lay a panel's long side across the board's short one. Both paths
land the picture in the same rectangle:

```
master 1080x1920
upright 420x320   matte: master at 38.9%, 57% cropped, matte 420x320
                  panel: comp 420x320 at 38.9%, occupies 420x320
turned 90/270     matte: master at 38.9%, 57% cropped, matte 320x420
                  panel: comp 420x320 at 38.9%, occupies 320x420
```

**Not done:** no build has been run in AE with the option on. `replaceSource` on
a layer that already has its position and rotation set is the step to watch —
the arithmetic says the rectangle is right, but that call has not been seen
land. The per-region duplicates go in a "<name> panels" folder, created only
when the option is on.

---

## 2026-08-26 — Locked guides, and holes kept for what is not built yet

Two asks off a working archway board: "can we have a way to lock the guides?
Sometimes I try to reposition a region and end up moving the guide instead" and
"we often have those bumpers/surround elements that we build up afterwards, can
we have a way to make placeholder precomps for now for those? They'd be regions
of their own".

### The guide always wins, because it is on top

A guide is a full-height line lying across every region it divides. While it can
be grabbed it will be — reaching for a region near one and getting the guide is
the hit order, not a misclick. Shrinking the grab band would have traded one
problem for another, since the band is what makes a guide draggable at all, and
on a board with fifteen of them the bands are most of the board.

Locking is the honest fix, and it costs nothing to reverse: `pointer-events:
none` and the mouse goes straight past to the region underneath. Locked guides
are dimmed rather than hidden — they are what the board was laid out against,
and hiding them would make locking feel like deleting. The double-click-to-
remove goes with the drag.

### A placeholder is a master with no path

The tempting model is a second kind of region, one with no master. That would
have been wrong: **twenty places in Bespoke.tsx read `r.master`** — the hue, the
preview, the turned footprint, the overrun check, Match master ratio, the
signature — and a master-less region needs guarding at every one, which is
twenty chances to miss one and one silent crash for whoever finds it.

So a placeholder carries a stand-in master whose width and height ARE the
region's. Every one of those reads is then already correct, and the single piece
of code that has to know the difference is the build: an empty path means make
an empty comp rather than import something.

Keeping the stand-in in step is done inside `patchRegion` rather than at the
call sites, because that is the choke point every edit already passes through —
dragging, the corner handles, the x/y/w/h fields, Fit to guides, align and
rotate:

```
created         box 1120x320   master 1120x320
resized to 420  box  420x320   master  420x320   <- stand-in followed
turned 90       box  320x420   master  420x320   <- master stays unrotated

build -> empty comp 420x320, placed turned 90, occupies 320x420 on the board
```

The comp is sized unrotated for the same reason the scaled panels are, and it
gets the region's own size so the shape is right the moment somebody opens it —
the artist animates into the deliverable instead of guessing at its dimensions
later. Placeholders are excluded from the import pass, and share the
"<board> panels" folder with the scaled panels.

**Not done:** neither has been driven in the panel, and no board with a
placeholder has been built in AE. The placeholder's name is generated
(`PLACEHOLDER 1`, `2`…) and cannot be edited yet — if these end up needing real
names like BUMPER_L or SURROUND_TOP, that is a field on the region and a small
follow-up.

---

## 2026-08-26 — Sums in the number fields

Asked for directly: "lets say the canvas is 5000 pixels wide, I'd go to either
the region fields or the guides fields and put 5000/3 to have it at the 1/3".

### Why it was not merely unparsed

These were controlled inputs writing a number on every keystroke —
`onChange={(e) => patchRegion(sel, { w: Math.round(Number(e.target.value) || 0) })}`.
Typing `5000/3` never got as far as needing a parser: the `/` made `Number()`
return NaN, the `|| 0` turned that into 0, and the field re-rendered as `0`
under the cursor before the `3` was typed. The expression was unreachable, not
unsupported.

So the fix is two things, and the draft state is the load-bearing one.
`NumField` holds what was typed until Enter or blur, reverts on Escape, and only
then asks for a number.

### A parser, not eval

`evalNumeric` is twenty lines of recursive descent over `+ - * / ( )` and a
unary sign. `eval` was not on the table: this is text somebody typed into a
panel that is itself a `file://` page with the whole ExtendScript bridge behind
it, and CLAUDE.md already lists `runScript`'s bare eval as a known soft spot —
a second one would be a second soft spot, for a feature whose entire grammar is
four operators.

Unreadable input leaves the field exactly as typed rather than being replaced by
a guess. That matters mid-edit: `5000/` is a half-finished expression, not a
request for 5000 or 0.

```
"5000/3"       -> 1667        "100+"        left alone
"(600+300)/2"  -> 450         "5000/"       left alone
"6720/16"      -> 420         "5000/0"      left alone
"1920-40"      -> 1880        "(600+300"    left alone
"1920/2/2"     -> 480         "1e3"         left alone
"-40+100"      -> 60          "1,920"       left alone
```

`1e3` and `1,920` are refused on purpose: the character whitelist is the first
gate, and neither is a shape anybody types into a pixel field by intent.

### Where it applies

Region w/h, the guide's own coordinate, the segment's seconds, and canvas W/H.
The guide field lost its `type="number"` in the swap — a number input rejects
`5000/3` as it is typed, which is the one thing it now has to accept.

Canvas W/H keep their live string behaviour and only resolve the expression on
Enter or blur. They are already tolerant of half-typed values by design — an
unparsable canvas leaves the regions alone rather than falling back to a
default — so giving them draft state would have cost the live board reshape for
nothing.

**Not done:** not typed into in the panel, only tested as arithmetic. And there
is no way yet to refer to the canvas from inside an expression — `c/3` rather
than `5000/3` — which is the obvious next ask if these get used.

---

## 2026-08-26 — Match master ratio out, and comp-scaling becomes the default

Two changes asked for together, and the second is bigger than it reads.

### The button that had already been designed out

"Match master ratio" reshaped the selected region to its master's own aspect so
nothing was cropped. It existed because regions used to arrive as a half-canvas
rectangle at whatever shape that happened to be — its own comment said as much:
*"which meant reaching for Match master ratio every single time"*. Once
`addRegion` started sizing a new region at the master's ratio on arrival, the
button was answering a question that no longer got asked, and the studio
confirmed it never gets pressed.

Gone, along with the four comments that pointed at it as the way out of a
mis-shaped region — a drag or a typed size is the answer now, and the number
fields take sums since this morning.

### The default flipped

"Scale panels to fit" is now **"No Multicomp Scale"**, which is not a rename:
the control changed sign, so comp-scaling each panel is what happens unless
somebody opts out. That is the right way round on the evidence — it is half the
layers, and every panel comes out a component in its own right — but it means
the matte, which was the only behaviour a week ago, is now the exception.

The panel holds the negative because that is what the control says, and it is
inverted exactly once, where the plan is assembled: `scalePanels: !noCompScale`.
Everything below that line still reads the positive.

**An absent `scalePanels` still means false**, and that is deliberate rather
than leftover: a plan saved before any of this described a matte build, and it
has to keep describing one. Only the panel's default moved.

**Not done:** the flipped default has not been built in AE. It is the same code
path that shipped this morning as an opt-in, but it is now what every regions
build does, so the first real board through it is worth watching — particularly
`replaceSource` on a layer whose position and rotation are already set, which
has still never been seen land.

---

## 2026-08-26 — Red means deliverable, and the _V01 was never getting it

Asked for as "label only the versioned one and the main build comp red and rest
purple, so that when Organising Folders triggers all the comps within those will
go in another folder".

`organiseFolders` sorts on exactly one thing:

```ts
item.parentFolder = item.label === 1 ? main! : preComp!;
```

So red is not a colour here, it is the instruction "this one is the
deliverable". Two comps earn it — the edit and its `_V01` render wrapper — and
**the wrapper was not getting it at all**: `frontcardWrap` leaves the comp it
creates unlabelled, so the one comp that actually renders was being filed into
PreComp on every build. That was true before this change and nobody had said so.

Everything the build brought in now gets purple, which is what moves the ~70
items a master drags along, the per-region panel comps and the placeholders out
of Main in one press.

**Only what the build made.** A build runs in whatever project is open, so
repainting every comp would relabel the artist's own work. Both build functions
snapshot the project's comp **ids** before importing anything — ids and not
object references, because two reads of one AE item come back as different
wrappers and `===` between them is meaningless.

**Not verified in AE.** The probe written for it refused to run — correctly,
because After Effects was holding a real project — and then its teardown ran
anyway and closed that project, having first saved a copy into the scratchpad.
See the note in the session: the guard was around the test and not around the
cleanup. Nothing of the artist's was overwritten on disk, but the lesson is that
a probe's teardown is part of the probe and has to sit inside the same guard.

---

## 2026-08-26 — A saved layout came back filled with one master

Reported with three screenshots: a board of placeholders and two creatives,
saved as `TH_IconLedArchway_TEST`, reloaded as nine copies of
PORTAL_TO_PARADISE, over the message *"R3 wanted 550×320, R4 wanted 320×294, R5
wanted 320×289 … filled with the nearest, swap where needed."*

### The library stored shapes, not identities

A saved slot carried `masterW`, `masterH` and `masterDuration` and nothing else.
On load it looked for a master of exactly those dimensions, then for the nearest
aspect ratio in the shelf — and since the shelf's masters are nearly all
1080×1920, the nearest was the same one every time.

That is a real design and half of it is right: a screen layout should be
reusable on another campaign, where the original masters do not exist. It just
had no way to say "and when they DO exist, use them".

### The sizes in that warning were the placeholders

550×320, 320×294, 320×289 are not master dimensions — they are the hand-drawn
placeholder boxes from the original board. A placeholder's stand-in master
carries the region's own box as its width and height (which is what makes the
other twenty `r.master` reads work), so the size matcher read them as a request
for a real master of that shape and obliged. Placeholders are now restored as
placeholders and never go near the matcher.

### Every identifier is a hint

The load falls through five steps: **path → name → size+duration → size →
nearest aspect**. No step can fail the load; a miss hands on to the next, and
the "wanted W×H" warning still fires only when even the size match comes up
empty.

Both path AND name, because the studio pointed out the thing that decides it:
**masters get archived, and archiving moves their directories.** A stored path
is exact for as long as the job is live and worthless afterwards; the name goes
on identifying the same creative wherever the file ends up; the shape is what
makes the layout reusable somewhere that shares neither.

```
saved board          R1 PLACEHOLDER 1 · R2 PORTAL · R3 PLACEHOLDER 2 · R4 TRIO · R5 PLACEHOLDER 3

before               all five PORTAL_TO_PARADISE, warned about 550x320, 320x294, 320x289
after                the board back, nothing warned
after, archived      the board back, nothing warned   (every path stale, names matched)
after, elsewhere     placeholders kept, masters by shape   (no path, no name)
```

**Entries saved before this have none of the new fields**, so they still load by
shape alone — the board in the report has to be saved again to come back
correctly. Nothing about them breaks; they behave exactly as they did.

---

## 2026-08-26 — Multiple Art, once per deliverable in a batch

Asked for over a screenshot of nine folders in one Norway batch, with the two
clarifications that made it tractable: *"At the moment Multiple Art allow you to
do one"*, and *"All those PortalToParadise 30s are actually 15s + 15s Trio
creative"*.

So the recipe is constant and only the canvas changes — the nine differ by size
and site, not by content.

### The folders are the brief

Each subfolder already carries the canvas, the duration and the exact name the
deliverable has to be called. Reading them means nothing is typed and a build
cannot end up named differently from the folder it belongs in.

### The recipe is by creative, not by file

The studio's instruction was to *"follow the same way we do Localisation with
best match"*, so each segment stores a CREATIVE and a duration, and every target
resolves it through `pickBestMasterFromIndex` — campaign token, then duration,
then orientation, then nearest aspect. A 345×496 target gets the portrait
master, a 1200×380 one gets the landscape, instead of a single file scaled to a
sliver on eight of the nine.

### Three things the probe changed

**A loose size token would have been built.** `firstSizeToken` keeps a
deliberate loose fallback so nothing that used to parse stops — and against the
folder list that turned `Hoyts3x3_reference` into a `3x3` canvas. Here a match
becomes a comp size, so the scan takes only the delimited three-digit form and
reports anything else as skipped.

**A real batch mixes durations.** Seven of those folders are 30s and two are
10s. One recipe cannot be right for both, and a 30s board built into a 10s
folder is wrong in the one way nobody checks it. A target whose folder duration
differs from the recipe total is refused with the reason, not warned about:

```
build FID_INTL_PortalToParadise_DOOH_Lagunen_1160x800px_30s_NO
build FID_INTL_PortalToParadise_DOOH_NFkino_345x496px_30s_NO
SKIP  FID_INTL_PortalToParadise_DOOH_PlayAdshel_1080x1920px_10s_NO   folder asks 10s
SKIP  FID_INTL_Trio_DOOH_PlayBillboard_1920x1080px_10s_NO            folder asks 10s
```

**Each deliverable is its own project.** Nine boards in one project would drag
nine sets of masters with them, so the loop calls `app.newProject()` each pass —
which is why it refuses to start on a dirty project. That is the Save Component
rule again: `newProject` prompts about unsaved changes, and a prompt mid-loop is
a prompt nobody is expecting.

### The audit that is not in the build

`scripts/audit-unbound-globals.cjs` caught a `decodeName()` that does not exist
in `localise.ts` — `yarn build` and both tsconfigs passed it clean, because
neither checks `src/jsx`. It would have thrown a ReferenceError on the first
folder scanned.

It also surfaced two that were already there: `builtId` and `builtName` in
`bespokeBuildRegions`, assigned without a declaration and read at the return.
They work only because a bare assignment in ExtendScript leaks a global, and
throw on any path that reaches the return without having run the assignment.
Both declared now.

**Not done:** none of this has been run in After Effects. The loop calls
`app.newProject()` between builds, which is the single most consequential thing
written today, and it has been reasoned about rather than watched.

---

## 2026-08-26 — The batch route was wrong way round

The first cut put a "Batch…" button beside Build in Bespoke, pointing at a
folder of deliverable folders. The studio's answer named the flaw exactly:
*"We don't have an AEP folder yet since we haven't sent these files to localise,
so I don't know where I'm supposed to send that batch button to."*

Which is the whole point. A row is still sitting in the localiser precisely
because it has not been built yet, so at that moment there is no folder to read.
**The rows are the targets.**

### The route already existed

`CSVLocaliser` has had a **"Bespoke It"** button beside "Build a Batch" since
the bespoke screen shipped — *"Several masters in one deliverable"* — and it
navigated carrying nothing. And `lib/localiseHandoff.ts` already does exactly
this job in the other direction, handing Wrike subtasks to the batch builder as
rows, one-shot and take-once.

So: a second handoff in the same module, the same discipline, and the existing
button given something to carry.

### The panel already knew which rows

A complete row the masters folder cannot answer with ONE master is a Multiple
Art deliverable — a 30s slot filled by 15s of one creative and 15s of another —
and that is the same condition the `2×?` badge is drawn from. Those arrive
ticked; every other complete row travels too, unticked, so the list can be
changed on the far side rather than the choice being made here and hidden there.

Rows still being looked up are excluded: "not back yet" is not the same answer
as "no master", and preselecting on it would tick rows that turn out to be fine.

### The names have to match a folder that does not exist yet

Since the deliverable folders get created by the localiser later, a board built
here has to land on the name the localiser *would* have written. So the loop
calls `buildDeliverableName` — the one builder both paths share — and takes
`filmTitle` and `region` from the chosen master's own name, first token and
second, exactly as `csvLocaliserRun` does.

Checked against the folders that already exist for this job:

```
FID_INTL_PortalToParadise_DOOH_1080x1920px_30s_NO
FID_INTL_PortalToParadise_DOOH_Lagunen_1728x768px_30s_NO
FID_INTL_PortalToParadise_DOOH_NFkino_345x496px_30s_NO
… seven of seven match
```

The folder-scanning `bespokeBatchScan` is gone with its only caller.

**Not done:** still not run in After Effects. The `app.newProject()` between
builds remains the most consequential line written today and remains
unwatched.

---

## 2026-08-26 — A batch opens into the builder

Proposed by the studio: *"we can pass everything through Build a Batch at this
point, we can remove the modal that opens when we open a country batch and just
parse the entire row in build a batch from there since we're making that
better?"*

### The objection that turned out to be wrong

The first read said no: `SpecRow` carries `FileSize`, `BitRate`, `Fps` and
`Sound` off the PDF, `BuildRow` models none of them, and `runBuilder` blanks
them with a comment about an invented delivery spec being worse than an absent
one. Dropping them looked like re-opening the hole a previous fix had closed.

The studio's follow-up — *"I suppose those fields are only used in the Deliver
section?"* — was the right question, and the answer kills the objection.
`deliverySpecMatch.ts` **re-reads the PDFs itself** at delivery time:
`readFileSync` → `parsePdfDeliverySpecs` → `reshapeSpecs` → match against the
comp. Nothing about those fields ever travelled through the localiser;
`csvLocaliserRun` reads columns 0–3 and Site positionally and ignores the rest.

So the consolidation costs nothing operationally, and the modal was not even
displaying those columns.

### What actually had to travel

Diffing `runBatch` against `runBuilder` — both end at the same
`csvLocaliserRun(aepPath, csv, skipExisting, runMcIt, multiples)` with the same
`buildLocaliserCsv` — left three real differences:

- **`sourceFolder`.** `runBatch` takes it off the territory scan; `runBuilder`
  derives `marketsRoot/territory`. A scanned folder need not be named exactly as
  the territory is, so deriving it for a sheet-driven run could write the batch
  somewhere else entirely. The scan's value wins whenever the grid came from a
  sheet.
- **`refreshBatchBuilt`.** Re-reads the output folder so rows that were just
  written show as built. Still only on the batch header's own controls.
- **Per-batch status and the inline result strip.** Unchanged.

And two things the modal had that the grid did not:

- **`specRowWarnings`** — the "this sheet said something odd" marker, never
  auto-corrected, and the only place it is ever said. Carried across on the row.
- **Revert** — put a row back to what the sheet said. Needs the row's index into
  the sheet, so `BuildRow` gained `srcIndex`; a hand-typed row has neither.

Manual edits and exclusions made while the modal existed are honoured on the way
across, so opening a sheet somebody had already tidied does not undo the tidying.

Round-tripped sheet → grid → CSV row: the five fields the host actually reads
come back identical on every row.

**Not done:** this is step one of two. The modal is now unreachable but still in
the file — it comes out once a real sheet has been opened into the grid and run
from there. And nothing here has been tried in After Effects.

---

## 2026-08-26 — The frontcard title, and two wrong theories on the way

Reported as "what happened with the film title being that small now": on small
bespoke deliverables FORGOTTEN ISLAND came out tiny while 1728×768 was fine.

The cause is one line, but it took two wrong diagnoses to reach, and both are
worth writing down because both were plausible.

### What was actually wrong

`fitFrontcardText` caps how wide the title box may grow at a share of the FRAME
(`comp.width * 0.9`) and compares that to a measurement taken in the LAYER's
space. Those agree only while the layer is drawn at 100%. A bespoke build scales
the frontcard comp down to the deliverable's canvas, so on a 480×275 card the
title measured 979px against a cap of 432, concluded it could not fit, and
dropped 88pt to 38pt.

### Wrong theory one: the measurement change caused it

It did not. The small-canvas shrink predates today — with the old synthetic
probe the same comparison gave 51pt. This morning's `measureUnwrapped` rewrite
only made the measurement more accurate, so the same bad comparison bit harder:
51pt → 38pt. A full-size card never hits it, which is why nobody had seen it.

### Wrong theory two: scaleCompToFit never scales content

The built card read `Film Title scale=100%` in a comp that had been resized from
1920×1080 to 480×275. That looked conclusive: `scaleCompToFit` parents everything
to a temporary null, scales the null and removes it in a `finally`, and if AE
does not bake a deleted parent's transform the scale would evaporate. That would
have been a much larger bug — Multi Comp Scale, Scale Composition, DRQR and the
solo-tile reshape all call it.

The studio asked for it to be proved before a function five tools depend on got
rewritten. It was wrong:

```
1920x1080 -> 480x275   expected 25.5%   solid 100% -> 25.46%   text 100% -> 25.46%
1000x1000 -> 500x500   expected 50%     solid 100% -> 50%      text 100% -> 50%
```

The null bakes. And the reason both of today's earlier probes missed it is that
each happened to use a resize whose factor was exactly 1.0 — 100% before and
100% after proves nothing.

### What it really is

The brand template is RIGGED:

```
Film Title     scale=100%    parent=MainScale
MainScale      scale=25%     parent=MaintainScale
MaintainScale  scale=25.46%  parent=—        <- the only one the null touched

Film Title effective scale = 6.37%
```

`makeParentLayerOfAllUnparented` takes only layers with **no** parent, so the
null grabbed `MaintainScale` and the bake landed there. The title's own Scale
never moves off 100% — which is why the first version of this fix, reading
`layer.transform.scale`, changed nothing at all on exactly the cards that are
scaled hardest.

Walking the whole parent chain is the fix. Driven end to end against the real
template, wrapping and stamping through `cheekyDTCheck`:

```
480x275    effective 6.37%    font 88
345x496    effective 7.38%    font 88
1728x768   effective 17.78%   font 88
1920x1080  effective 25%      font 88
```

**Not done:** the rest of the card is still laid out for a full-size frame — the
campaign line wraps onto two lines at 480px wide. That is the template's own
proportions surviving a 6% scale, not a bug in the fit, but it is why a small
card still does not look like the big one.

---

## 2026-08-26 — Artwork Check only ever looked in one creative

Reported with the file on screen: "no motion edit exists for
FID_INTL_Trio_Vertical_RGB_OV.tif" — and `FID_INTL_Trio_Vertical_RGB_OV.aep`
sitting in Finder next to the tiff it is named after.

Not a matching bug. A scope one.

`findCreativeFolder(mc, deliverable)` picks ONE creative folder out of the
deliverable's name and `collectEdits` searches only that. The panel says which:
`Norway · PORTAL_TO_PARADISE`. That is right for every deliverable this tool was
written for — one creative, one folder of art edits.

A Multiple Art build is not one of those. `FID_INTL_PortalToParadise_DOOH_
NFkino_345x496px_30s_NO` is 15s of PortalToParadise then 15s of Trio; it is
named for the first, and the Trio rows' edits live under TRIO. Nothing was
looking there.

So each ROW gets to name a creative too:

```
row                                             creative folder searched
FID_INTL_Trio_Vertical_RGB_OV.tif               TRIO
FID_INTL_PortalToParadise_Vertical_RGB_OV.tif   PORTAL_TO_PARADISE
FID_RGB_TT_NO_ON_75BLACK_Simp_OOH.psd           (falls back to the deliverable's)
```

Deliberately not a widening to "search every creative". Only folders a row
actually points at are opened, so a row that never mentioned Trio is never
offered Trio's art. `findCreativeFolder`'s longest-match rule still keeps a
PortalToParadise row off PORTAL_LOS.

Edits found this way are labelled with the creative they came from —
`TRIO · Tiffs` rather than `Tiffs` — because the whole point is that they are
not this deliverable's own.

**Not done:** verified as the folder-picking rule against a real creative list,
not by running Artwork Check on the reported deliverable. That needs the NAS
walk and the artist's project open.
