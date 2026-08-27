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

**Save Component** (`saveComponent`, `tools.ts`) never writes the artist's file.
The sequence is save-as to the COMPONENT file, reduce in there, save it again,
then `app.open()` the original back off disk — read the order twice: everything
destructive happens after the pointer has moved to a file the tool just made.
Three rules hold it up, all measured in AE 26.2:
`app.project.reduceProject(items)` — **the API, never the `Reduce Project` menu
command (id 2735), which is MODAL** and stops a script dead on "N items…have
been deleted"; **reduce is not undoable from a script** (tested three ways,
including inside `beginUndoGroup` — 5 items → 3 → 3), which is why it reopens
rather than trusting Ctrl+Z; and it **refuses on a dirty project**, because
`app.open()` prompts "Save changes before closing?" and at that moment the open
project is the REDUCED one, so an artist clicking Save would write it over their
original. Items referenced ONLY by expressions do not survive a reduce — say so,
don't try to detect it.

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
- **`scaleCompToFit` scales content through the PARENT CHAIN, and the brand
  frontcard is rigged.** It parents every *unparented* layer to a temporary null
  and scales that — so on a template where `Film Title` → `MainScale` (25%) →
  `MaintainScale`, the bake lands on `MaintainScale` and the title's own Scale
  never leaves 100%. Measured on a real 1920×1080 → 480×275 card the effective
  scale is **6.37%**. Anything reasoning about how big a layer is drawn must
  multiply the whole chain; reading `layer.transform.scale` answers 100% on
  exactly the cards that are scaled hardest. (And the null DOES bake on delete —
  a plain comp goes 100% → 25.46%. Two of today's probes measured cases where
  the factor happened to be exactly 1.0, which proved nothing.)
- **`TextDocument.allCaps` and `.boxText` are READ-ONLY** (`boxTextSize` and
  `boxTextPos` are not). So a text layer's rendered width cannot be reproduced
  on a synthetic probe: copying font/size/tracking across misses All Caps, which
  the frontcard template has on, and capitals measured 28% wider than the stored
  mixed-case string — 730px reported against 950px drawn, so the fit found 188px
  of room that did not exist and the card read FORGOTTEN. Uppercasing the
  probe's string is NOT the fix either; it still misses trailing tracking and
  side bearings by ~14px, which was enough to keep wrapping. **Measure a
  DUPLICATE of the layer**, widened past anything it could need, and remove it
  in a `finally` — a duplicate sits above the original and shifts every layer
  index below it, and frontcard fields are written by index right after.
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
- **Bespoke's number fields take sums** (`5000/3`, `(600+300)/2`) via
  `evalNumeric` — a hand-rolled recursive-descent parser, **never `eval`**: this
  is typed text in a `file://` page with the ExtendScript bridge behind it, and
  the codebase already carries one bare eval as a known soft spot. Unreadable
  input **leaves the field exactly as typed** — a half-finished `5000/` must not
  become 5000 or 0 under the cursor. The fields need `NumField`'s draft state to
  work at all: as controlled inputs writing a number per keystroke, the `/` made
  `Number()` NaN and the field re-rendered as 0 mid-type. Canvas W/H keep their
  live string behaviour and only resolve on Enter/blur, so the board still
  reshapes as you type.
- **A spec sheet's batch opens into Build a Batch, not a modal.** One editor for
  a sheet's rows and a hand-typed batch alike. Two things must travel with the
  rows or they are lost: **`sourceFolder` off the territory scan** (the builder
  otherwise derives `marketsRoot/territory`, and a scanned folder need not be
  named exactly as the territory is — that decides where the batch is written),
  and each row's **`srcIndex`** into the sheet, which is what keeps
  `specRowWarnings` attached and gives Revert something to revert to. The
  delivery spec columns (`FileSize`/`BitRate`/`Fps`/`Sound`) do **not** need to
  travel: `deliverySpecMatch.ts` re-reads the PDFs itself at delivery time, and
  `csvLocaliserRun` reads columns 0–3 and Site positionally.
- **A Multiple Art row is decided by the MASTERS, not by its name or length.**
  `no single master at this duration` **AND** `shorter masters of this creative
  exist` — the same condition the `2×?` badge is drawn from, so the badge and the
  Send-to-Multi-Art button can never disagree. Both obvious alternatives fail on
  real data: the creative's name does not decide it (one Norway batch of these is
  called `PortalToParadise`, one Brazil batch `MultipleArt`), and neither does
  duration (a 30s row WITH a 30s master is an ordinary localise, and a 30s row
  that is 2× the same 15s creative is a duration multiple). The `multiples` half
  is what separates a composition from a row nothing matches at any length —
  that one is broken, not bespoke, and sending it on only moves the problem.
- **Batch Multiple Art comes from the LOCALISER'S ROWS, never a folder.** At the
  point those rows exist the AE folders do not — that is why they are still
  sitting there. CSV Localiser's **"Bespoke It"** sends every complete row via
  `setPendingBespoke` (a second one-shot handoff beside `setPendingBatch`, same
  take-once discipline), flagging `needsMulti` on the ones it could not answer
  with a single master — the same condition the `2×?` badge is drawn from — and
  those arrive ticked. `bespokeBatchBuild` repeats one recipe over the ticked
  targets, resolving each segment's **creative** (not a file) per target through
  `pickBestMasterFromIndex`, the same scorer CSV Localiser and OV Library use.
  It names each build with **`buildDeliverableName`**, taking `filmTitle` and
  `region` off the chosen master's own name exactly as `csvLocaliserRun` does,
  so a board built here cannot be named differently from the deliverable
  localised there. Two more rules: a target whose duration differs from the
  recipe total is **refused, not warned about** (a 30s board in a 10s
  deliverable is wrong in the one way nobody checks); and each build is its own
  project, so it **refuses to start on a dirty project** — `app.newProject()`
  mid-loop would raise a save prompt nobody expects.
- **`yarn build` does NOT run `scripts/audit-unbound-globals.cjs`.** Neither
  tsconfig checks `src/jsx`, so an undefined identifier ships silently. Run it
  after touching ExtendScript — it just caught a `decodeName` that does not
  exist in `localise.ts`, and `builtId`/`builtName` in `bespokeBuildRegions`
  which were only ever working by leaking implicit globals.
- **A saved screen stores what a slot IS, and every identifier is a HINT.**
  It used to store `masterW/masterH/masterDuration` only, so reloading a board
  matched each slot to the nearest aspect in the shelf and filled the whole
  thing with one master. The load now falls: **path → name → size+duration →
  size → nearest aspect**, and *no step can fail the load* — a miss hands on to
  the next. Both path and name, because **masters get archived and archiving
  moves directories**: a path is exact while the job is live and worthless
  after, a name identifies the creative wherever the file ends up, and shape is
  what still makes a layout reusable on a campaign sharing neither.
  **A placeholder slot is restored as a placeholder** and never matched — its
  stand-in master carries the region's own box as its size, so the size matcher
  read `550x320 wanted` and handed back a real master.
- **`organiseFolders` files a comp by its LABEL and nothing else** —
  `item.label === 1 ? Main : PreComp`. So red is not a colour, it is the word
  "deliverable". A Bespoke build paints exactly two red — the edit and its
  `_V01` wrapper — and everything it brought in purple. `frontcardWrap` leaves
  the new comp unlabelled, so the `_V01` (the comp that actually renders) has to
  be labelled explicitly or it lands in PreComp. Only relabel comps the build
  itself created: snapshot the project's comp **ids** first (never `===` on AE
  objects), or you repaint the artist's own work.
- **A Bespoke placeholder is a master with NO PATH**, not a second kind of
  region. Twenty places read `r.master` — hue, preview, turned footprint,
  overrun, Match master ratio — and a master-less region would need guarding at
  every one. `placeholderMaster()` hands back a stand-in whose width/height ARE
  the region's, `patchRegion` keeps it in step (the one choke point every edit
  passes through), and the only code that knows the difference is the build: an
  empty path means make an empty comp at the region's size instead of importing.
  Exclude them from the import list.
- **Guides can be locked, and locked means `pointer-events: none`.** A guide is
  a full-height line lying over every region it divides, so while it can be
  grabbed it will be — that is hit order, not a slip. Dimmed rather than hidden:
  they are what the board was laid out against.
- **`scalePanels` is the DEFAULT, and needs a duplicate per region.** Regions mode
  imports each master ONCE into `compFor[path]` and adds it as a layer for every
  region using it (`duplicatePanels` is multi-mode only), so scaling that shared
  comp for one panel would resize every other panel drawn from it. With the
  option on, each region gets its own duplicate scaled by `scaleCompToFit` and
  the comp's bounds do the cropping — half the layers, every panel a component.
  The panel's control is the negative one — **"No Multicomp Scale"** — so
  `scalePanels: !noCompScale` is inverted once, at the boundary. Ticking it goes
  back to the matte, which is the one arrangement where the crop stays separable
  from the content (move the solid, the window moves; move the master, the
  artwork reframes). An ABSENT `scalePanels` still means false: a plan written
  before this existed described a matte build. **Size the panel comp
  UNROTATED**: a turned region's `w`/`h` is its footprint AFTER the turn, so the
  comp is built to the swap of that and rotated into place.
- **A rotation is one of 0/90/180/270 — normalise it, never trust the source.**
  Every `turned` test in Bespoke and in `bespokeBuildRegions` is
  `=== 90 || === 270`, and AE hands back **−90** for a counter-clockwise quarter
  turn (`-90 % 360` is `-90` in JS, not 270). An unnormalised region therefore
  rendered rotated while every number — footprint, cover, crop, matte box — was
  computed as though it were not. `quarterTurn()` folds positive and snaps;
  apply it at every entry point (comp scan, screen library, detect, the rotate
  button, the plan sent to the build).
- **Rotating a region must not be lossy.** `patchRegion` caps size to the board,
  which is right for a drag and wrong for a quarter turn: on a 6720×320 archway
  a 420×320 panel turned once became 320×320 and never came back. Rotation
  passes `keepSize`, and a region past the board is a **note** now rather than
  something silently crushed to fit.
- **Board tools must scale to the SHAPES this tool exists for, not to 1920×1080.**
  Two were written for a normal frame and fell apart on a 6720×320 archway:
  `duplicateRegion` offset by 3% of the *smaller* side, which is 10px there, so
  every copy landed under its original — it now steps a region-width along the
  board's long axis, falling back to a nudge only when there is no room left to
  chain. And every guide lands at the board's centre, so a sixteen-panel rhythm
  meant fifteen lines stacked on one coordinate; `divideGuides` lays n−1 even
  cuts in one press, merging with hand-placed guides rather than replacing them
  and doing nothing on a second press.
- **A reference gives the canvas its SHAPE, never its pixels.** Bespoke's
  reference JPGs come out of the PDF at whatever the export felt like —
  8000×5867 for a 3840×2816 board is normal — so adopting their dimensions would
  build the deliverable at the size of a screenshot. Precedence on adoption:
  a `WxH` token in the filename, else a library entry's stored canvas, else the
  image's aspect applied to the width already in the field (`shapeFromRef`,
  cleared in the img `onLoad`). It adapts **once, on adoption**; after that the
  artist owns the canvas and a mismatch is a note, not a correction. Swapping
  between sibling references of an already-traced board never re-sizes.
- **A Bespoke segment runs along the canvas's LONG axis unless told otherwise.**
  `bespokeBuild` summed tile WIDTHS only, so a segment was a horizontal row
  whatever it was built on: three 844-wide portrait masters on a 256×2304 canvas
  came out as three 85px slivers at 10% scale, under a strip captioned "this
  segment fills the frame". A segment now carries an optional `stack`
  (`"row"`/`"column"`); **absent means follow the canvas**, so changing the size
  keeps moving the layout with it until somebody pins it. Same rule in the
  panel's preview (`segmentIsColumn`) and the build, or the two disagree about
  what will be made. Tile drag-reordering hit-tests on the segment's own axis —
  stacked tiles all share one x range, so a left/right test matches index 0 every
  time.
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
(never a native checkbox — but a design with no checkbox at all is a different
thing: WorkflowBoard's steps are a numbered route where the node carries
done-or-not, and adding a square beside it would be a second answer to the same
question), `Tooltip`, `Droplet`, `Dropdown`, `SegmentedToggle`
(needs a unique `name` or two instances share one Framer `layoutId`),
`ArcadeFrame`, `ToolErrorBoundary`, `VideoOverlay` (the ONE video player — portals to `<body>`, closes on Esc/backdrop/X; OVLibrary's private copy was promoted, don't re-roll a second), `lib/fileUrl.ts`'s `toFileUrl` (the Windows-drive and UNC branches are why — a malformed `file://` URL shows nothing and throws nothing).

**Edit in Context follows AE's selection.** `editInContextSelection` is polled
(~900ms, non-toasting) and the panel opens the selected layer's precomp. Two
rules keep it from fighting the artist: act **only when the signature
(`compId:layerIndex`) changes**, never re-apply what a tick merely saw — the
panel's target and AE's selection are separate things and both get moved; and
**exactly one** selected layer counts, since "the selected layer" means nothing
when three are. `editInContextReveal` sets the selection itself, so it must skip
one tick or it throws away the trail it was just revealing from.

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
  anyone's local list — it stops `teamSyncShared` pulling into either campaign
  list, and since 2026-08-24 it greys the campaign out and makes it
  **unselectable** in every picker (`DropdownOption.disabled`, and Workflows'
  own campaign chips). Never "finish the job" by deleting local rows from a
  shared file.
- **A disabled option that IS the current value stays selectable**, in the
  Dropdown and in Workflows alike. Retiring the campaign you are standing on
  must not lock you out of un-retiring it, and the trigger has to be able to
  show what is selected. The way back for any *other* retired campaign is CSV
  Localiser's restore button, which renders only while something is retired —
  without it, greying the pickers would be a one-way door.
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

**Tutorials** are clips in `<TeamFolder>/_tuts/`, matched to a tool by
FILENAME ALONE (`OVSwap.mp4` → OV Swap) and played from that tool's header icon
via `TutorialIcon`. There is no index file and no registry field on purpose:
recording one must stay "drop the mp4 in `_tuts` and name it after the tool", or
nobody records one.

- The match is **exact after squashing** (`lib/tutorials.ts`'s `tutorialKey`:
  fold accents, lower-case, drop non-alphanumerics) against the tool's id *or*
  its label. Never make it fuzzy — an unmatched clip costs one rename, a
  mismatched one teaches somebody the wrong tool.
- **The affordance only exists when the clip does.** No badge, no cursor, no
  role, no click on a tool with no tutorial. An icon that looks pressable on
  forty tools and answers on three trains everyone to stop pressing it.
- The badge takes `--cat-icon`, not `--ov-accent` — it is stuck to a
  category-tinted glyph.
- **The two hubs carry it in their own top bar**, since `ToolScreen` suppresses
  `tool-content-header` for them (`HUB_TOOL_IDS`). Review's goes in the
  `.rh-tab-row` wrapper BESIDE `.rh-tab-bar`, never inside it — that bar's
  highlight is `width: 50%` sliding between exactly two children. Delivery's
  leads `.dh-action-bar` with a `Package`, not the registry's `Truck`, which
  the Delivery button beside it already has.
- **A MODE can be a subject in its own right** (`lib/tutorialSubject.ts`), and
  Bespoke is the only tool that needs it — three builds sharing a door and
  nothing else. The header icon stays mounted after a mode is picked, so it is
  contextual: the tool's clip at the chooser, the mode's clip inside one
  (`MultipleArt.mp4`/`MultiArt.mp4`, `Bespoke.mp4`/`BespokeBoard.mp4`,
  `Insitu.mp4`). Never answer this with a compound FILENAME syntax — a rule to
  remember is a clip nobody records. The subject store is **scoped by
  `toolId`** so a mode left uncleared cannot relabel another tool's header;
  keep it that way, and keep clearing it on unmount.
- One bridge call per session (cached); `refreshTutorials()` on picking a new
  team folder. `_tuts` is a team-folder path opened by name, unrelated to the
  `_`-folder scan rule below.

**Localised Library mirrors `Support_Motion`'s creative folders, when it has
them.** Territories started carrying a folder per creative
(`Support_Motion/Bracelet/MCs_Taglines/…`), and the scan flattened everything
into buckets keyed on file type — so two creatives' artwork landed in one `AI`
folder with only the filename to tell them apart, and not every filename
carries its creative. `LocLibComponent.creative` is set from the folder
**directly under the container**, whatever depth the file sits at below that,
and is the one field in that record that mirrors the disk (`folder` is the
artist's own filing and the scan never touches it). Absent means loose in
`Support_Motion`, which is every older campaign — **the panel grows the extra
level only where the disk has one**, never imposes it. Decode the folder name
(`.name` is URI-encoded) or an accented creative keys twice. Re-running
Auto-Populate is the migration path: an already-present row is **backfilled**
rather than skipped, and the count is reported separately, or a run that sorted
a whole territory reads as a no-op.

**Below a territory, the library EXPANDS — it does not navigate.** Creatives
and their file-type buckets open in place, several at once, because the real
question is usually "which of these two has it" and a page swap makes that a
there-and-back that loses the list you were comparing against. Three things
follow and are easy to undo by accident: **Select all ADDS or REMOVES its own
group's paths** rather than replacing the selection (it replaced it while only
one folder could be on screen, which would now silently drop everything ticked
under another creative); the **batch bar sits outside every branch**, since a
selection spans them; and **Add Component takes its target as an argument**,
because with several branches open there is no "the folder you are in" left to
infer. `suggestLocLibCreative` marks the creative the open project looks like —
a mark on the row, never a filter, and matched on WHOLE TOKENS (joined across
runs, so `Portal_To_Paradise` answers to `PortalToParadise`). It is deliberately
not `suggestJpgPngMatch`, whose substring branch fires on `Trio` inside
`Triology`; names under three characters are refused as evidence.

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
- **Removing a null/solid LAYER leaves its footage ITEM in the project.**
  `scaleCompToFit` parents to a temporary 3D null, and removing that layer left
  an orphan behind on every call — a real working file held `Null 1` six times,
  `Null 5` seven times and `Null 43`–`52`. Read the item off the layer BEFORE
  removing it (the layer is no use afterwards) and drop it only when
  `usedIn.length === 0`.
- **A Bespoke master is reshaped to the canvas only when it is SOLO in every
  segment it appears in** (`bespokeBuild`). A tile sharing a row is showing a
  panel, not the deliverable, and no mech export exists at a panel's size —
  reshaping those stacks full-frame masters on each other. Solo tiles are
  renamed via `bespokeSoloCompName` to the deliverable's name with their own
  creative swapped in, which is what the mech already called the artwork; the
  creative is `campaign` **or** `siteName`, per the rule below.
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

**`parseFilenameMeta`'s `campaign` is the CREATIVE, `siteName` is the SITE.**
Campaign is what sits LEFT of the artwork type, site is everything right of it.
Anything wanting the whole descriptive part wants `siteName` — the four-token
prefix ends ON the artwork type in both conventions
(`FID_INTL_PortalToParadise_DOOH`, `ODY_INTL_DGTL_DOOH`), so "right of the
artwork type" is exactly "after the prefix". `campaignRename` read `campaign`
for twelve days after the field was re-cut for the frontcard: on a current-form
name it rebuilt the AE file's own name, hit the exists-loop and renamed every
project in the folder to `_copy`; on a legacy `_DGTL_` name, where the artwork
type is the FIRST descriptive token, `campaign` is `""` and it spliced an empty
token in. Neither tsconfig covers `src/jsx` and the tool returned
`success: true` throughout — `node scripts/probe-campaign-rename.cjs` is the
only gate, so run it after touching either function.

**Never gate a name-reading tool on an underscore COUNT.** Cheeky T skipped
parsing whenever `name.split("_").length < 8`, a proxy for "does this name carry
what a frontcard needs" that was calibrated on the legacy convention — which
spends a token on `DGTL` and usually another on a site
(`ODY_INTL_DGTL_DOOH_HORSE_LOS_1920x858_10sec_OV` is nine). The current
convention drops `DGTL`, so a deliverable with no site token is **seven**
(`FID_INTL_MultipleArt_DOOH_1920x640px_30s_BR`) and every one of those fell down
the do-nothing path — the reported "it retrieves nothing" was a name the tool
never agreed to read. Ask the real question instead: `frontcardNameUsable` (an
artwork type AND a size).

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

**Delivery's spec autofill counts DISAGREEING rows, not rows.** A sheet listing
the same deliverable twice is normal — Norway's PRE sheet carries PlayAdshel
1080x1920 10s and PlayBillboard 1920x1080 10s twice each, all four saying
8 Mbps / 50 MB / no sound — and the ambiguity guard counted two and left the
field blank while every size listed once filled in. Nothing was in doubt.
`deliverySpecMatch` collapses hits on the four values that get USED
(`FileSize|BitRate|Fps|Sound`), so duplicates that agree are one answer and rows
that genuinely conflict still refuse, which is the case the guard exists for.

**`<Territory>/Masters/Support/<Creative>/<Category>/` IS A PARALLEL CORPUS,
and Support Swap matches on the FILENAME, never the folder.** Every market
holds the same relative path and the same filename with **one token** swapped
for its own (`Date/FID_INTL_Portal_2L_DATE_{IT,DE,FR,NO}_RGB.ai`). So the rule
is *exactly one token differs*, found by **diffing, not by index** — the market
token sits at a different position in every family (`…_IT_RGB.ai`,
`FID_RGB_TT_IT_ON_75BLACK…`, `…_Pedigree_IT_RGB_SIMP.psd`). Diffing buys a
discriminator free: Germany holds both `Portal_1L_DATE_DE` and
`Portal_2L_DATE_DE`, and against a `_2L_` original the 1L file differs by TWO
tokens and is correctly not a candidate.

- **Never derive the market code from the territory name.** Paw Patrol's Chile
  components are `_CH_`, not the ISO `_CL_`. Only the target territory's own
  `Masters/Support` is scanned, so whatever is in there IS that market's — the
  same discipline as never trusting `.exists` on the share.
- **A file with no market token is SHARED** (`FID_UNI_Logo_RGB.ai` is identical
  everywhere). It differs by zero tokens and never becomes a candidate; that
  falls out of the rule rather than needing a list.
- **`_OV_` is never a target**, and the OV case has TWO shapes — ask the
  ORIGINAL, not the candidates. A market part-way through localisation holds
  the OV file under the same name the project already uses, so nothing differs
  by one token and the OV-candidate list is empty too. `ssHasOvToken(name)`
  catches both, and keeps "shared across markets" meaning only what it says.
- The creative folder is a **tie-break only** (via `matchCreativeInName`, shared
  with the Localised Library's highlight so the two cannot disagree), never a
  filter: a deliverable can legitimately carry another creative's component.
  Two creatives holding one filename with no winner is **handed to the user**,
  never guessed.
- `Support_Motion`'s own folders are NOT usable as a key — one creative is
  spelled `Jungle_Tunnel`, `JUNGLE_TUNNEL`, `JungleTunnel` and `Jungle Tunnel`
  across four markets, the creative level is absent in nine more, and three keep
  the files loose. `Masters/Support` is the consistent tree; the filename rule
  above means neither has to be understood.

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

**A Multiple Art deliverable draws artwork from MORE THAN ONE creative**, so
Artwork Check lets each ROW name a creative as well as the deliverable.
`FID_INTL_PortalToParadise_..._30s_NO` is 15s of PortalToParadise then 15s of
Trio, and the Trio rows' `.aep` edits sit in **Trio's** own `Tiffs` — outside the
one creative folder `findCreativeFolder(mc, deliverable)` opens, which reported
"no motion edit exists" with the identically-named `.aep` sitting right there.
Only folders a row actually points at are opened — never a widen-to-everything,
which would offer another creative's art to a row that never mentioned it — and
cross-creative edits are labelled `TRIO · Tiffs` so they cannot be mistaken for
this deliverable's own.

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

`node scripts/probe-tutorials.cjs` (after `yarn build`) drives the built
bundle's `tutorialsList` against a stubbed filesystem whose `File.exists` and
`getFiles(mask)` THROW — so an edit that reaches for either on the share fails
the probe instead of failing silently on the NAS.

`node scripts/probe-loclib-creatives.cjs` (after `yarn build`) drives
`autoPopulateLocLib` over a stubbed Markets tree carrying BOTH shapes — one
territory with a folder per creative inside `Support_Motion`, one with
everything loose — and `suggestLocLibCreative` over the name traps. Run it
after touching either: it is the only gate on a function whose failure mode is
writing a wrong library into `app.settings`.

`node scripts/probe-support-swap.cjs` (after `yarn build`) drives
`ssOneTokenDiff` over the filename families actually on the share, then
`supportSwap` end to end against a stubbed Italy. Run it after touching either
— this matcher decides which artwork goes into a finished deliverable.

`node scripts/probe-campaign-rename.cjs` (after `yarn build`) drives
`campaignRename` over a stubbed folder pair on BOTH naming conventions. Run it
after touching `parseFilenameMeta` — that function has consumers who each want
a different field, and the last change to it broke this one silently.

---

## 8. HOUSEKEEPING

**Deliberately kept but unwired — don't "clean up" without asking:**
`tools/WrikeTasks.tsx` + `hooks/useWrikeTasks.ts` + `lib/utils/wrikeApi.ts`
(unhooked on request), `tools/DeliveryChecklist.tsx` (superseded by
DeliveryHub), `tools/Placeholder.tsx` (`makePlaceholder` now has zero call
sites), `screens/CategoryScreen.tsx` (unreachable fallback).

**Recent, and easy to mistake for orphaned:** `WorkflowBubble.tsx` +
`tools/WorkflowBoard.tsx` + the workflow exports in `jsx/aeft/team.ts` (the
bubble is mounted in `main.tsx`, not reached through the registry — see §9),
`tools/Puppeteer.tsx` +
`jsx/aeft/puppeteer.ts` (registered in `TOOLS`, Tools category),
`tools/InsituBoard.tsx` + `jsx/aeft/insitu.ts` (reached ONLY through Bespoke's
mode chooser, so it has no registry entry of its own), and
`main/lib/detectShapes.ts` (used by both boards' Detect).

**Genuinely orphaned, no live front door:** `tools/TrueCompDuplicator.tsx`
(backend still maintained and reachable from the Toolset grid),
`tools/GsapDemo.tsx`, `gsap/index.ts` (so `gsap.defaults()` never runs and
ScrollTrigger is never registered), `jsx/aeft/aeft-utils.ts` (not in the
barrel), `exportCustomToolsToFile` / `importCustomToolsFromFile` (no UI),
`createLocLibFolder` / `setLocLibComponentFolder` (Localised Library's New
Folder and Move-to-folder were removed on 2026-08-27 — the tree mirrors the
studio's own creative folders, so there is nothing to invent or refile;
`removeLocLibFolder` stays wired as the way out for anyone holding a custom
folder from before),
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

## 9. THE WORKFLOWS BUBBLE

**The Ask agent is gone** (2026-08-24), removed on API cost. `lib/agent/`,
`AgentBubble`, `AgentChat`, `AskAbout`, `AskIcon`, `agentWrites.ts` and the
`probe-agent-*`/`bench-providers` scripts are all deleted; `grep -rn AGENT-HOOK
src/` returns nothing. Don't re-add an LLM dependency without asking. Two files
survived it and are NOT agent code any more:

- **`lib/navigation.ts`** — opens a tool by registry id from anywhere. It
  outlived the agent because the problem is not an agent problem: something in
  main.tsx's shell needs to change the screen. Its **click gate stays**: a
  caller may only auto-press a button the registry grades `actionSafety: "read"`,
  because `autoAction` matches on button TEXT and relabelling a button would
  otherwise silently change what a stored link is permitted to press.
- **`lib/workflowBubble.ts`** — enabled/open state for the floating panel.

**The bubble is the Workflows feature's front door**, mounted in main.tsx's
shell so it survives navigation — which it must, because a step's whole job is
to send you to another tool, and a tool page would unmount the list you were
following. `WorkflowBoard` renders in both, switched by `variant`: `"panel"` in
the bubble, `"page"` for the registry entry ⌘K finds. It is deliberately NOT in
`LocaliseScreen`'s `TOOLS_ROW` any more.

- **Enabled defaults ON**, unlike the agent, under its own key
  (`xyi.workflows.bubble`). Never reuse `xyi.agent.enabled`: a machine that
  switched the agent off would get a permanently hidden checklist it has never
  seen. The home toggle is the `Route` icon in HomeScreen's picker row.
- **The panel pins its own `--cat-*`.** Everything inside keys off the category
  tint, set per mounted tool — so a panel that follows you around would come up
  orange over Deliver and teal over Localise. It declares teal on
  `.wfbub-panel` and the cascade inside lands there.
- Hidden with CSS, never unmounted: a close must not throw away the board read.
- `clampSize()` in the TSX and the `max-width`/`max-height` in the SCSS must
  agree. If CSS caps lower, the box stops while the drag carries on and the
  corner comes away from the cursor.

**Notes carry their own hue, and it is DERIVED, never a literal.** Steps and
notes were reading as one list — same fill, same radius, half a pixel between
their type sizes, and the note's left bar was `--cat-border` at full strength
against the current step's 35%, so a note was more accented than the step you
stood on. `--cat-*` now means *where you are*; `--ov-note*` means *standing
knowledge*. `themes.ts` rotates the active accent by **−134°** (chosen so the
default teal lands on the amber the design was signed off on) with saturation
clamped to 0.5–0.6, and emits `--ov-note`, `--ov-note-soft`, `--ov-note-edge`,
`--ov-note-fill`, `--ov-note-wash`. A FIXED amber is wrong: it collides head-on
with Ember (`#fb923c`) and Gold (`#facc15`), where steps and notes would come
out the same colour. Alphas are computed in JS because `color-mix()` is
Chrome 111. The retint is applied by redefining `--cat-border`/`--cat-icon` **on
`.wfb-notes`**, not per selector — everything inside a note already keys off
them, so bars, tag pills, note links, territory chips and focus rings all follow,
and anything added later inherits it. Portaled pickers are outside that subtree
and keep the category tint.

**A note carries more than text.** `territory` (ISO-2, upper-cased host-side),
`tags` (free-form, upper-cased so the vocabulary converges instead of splitting
into CTA/cta/Cta), and `links` — words in the body that open a folder or a tool.

**`links` is a SIDE TABLE, never markup in the text.** A link syntax
(`[masters](/Volumes/…)`) fails twice: nobody types a NAS path into a one-line
input, and a literal `[` in prose becomes a broken link. The body stays exactly
what somebody typed and the links sit beside it, matched by `label` at render
time — the same rule as "never store user-authored text in a delimited value",
one level up. A label that no longer appears in the body is still shown as a
chip: an edited sentence must not silently drop somebody's link. Labels are
regex-escaped before matching and sorted longest-first, or "Artwork" eats the
front of "Artwork Check".

**Motion: PHYSICAL personality, three curves, no more.** Framer springs
(`SPRING.snappy` arrivals, `.smooth` settles, `.bouncy` the tick alone) plus one
cubic-bezier for hover. **CSS `linear()` spring easing is Chrome 113 and the
target is chrome74** — JS-computed springs are the only real ones available
here. Steps are numbered nodes on a rail that fills in behind you; a card is
pressed (`whileTap`), never lifted with a CSS transform, because Framer owns
that element's transform. No perpetual animation on the launcher — the agent's
rotating ring is exactly what people turn a feature off for.
