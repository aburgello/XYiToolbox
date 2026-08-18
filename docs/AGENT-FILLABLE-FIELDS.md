# Filling fields — design sketch

The agent can open a tool and it can press a small graded set of one-click
actions. It cannot put a value into a field. This is the sketch for the rung
between those two, and the argument for where it stops.

**Status: built, one tool wired.** `fill_fields` is live and gated;
`lib/agent/fieldHandoff.ts` is the take-once pipe; Name Generator is the first
and so far only receiver. Script Playground carries an explicit empty entry and
never gets one.

Verified against the real registry rather than by inspection: two valid fields
are accepted, an unlisted field is dropped while the valid ones through, a
non-string value is refused, Script Playground is refused on its explicit empty
list, and a tool with no list at all is refused.

---

## 1. FILLING A FIELD IS NOT A WRITE

The safety ladder today is `read` / `undoable` / `additive` / `destructive`,
and it is a ladder of *things that have already happened*. Filling a field is
not on it, because it has not happened:

- it is **visible** before it does anything,
- it can be **typed over**,
- it is **inert** until the artist presses the button.

That is a stronger guarantee than `undoable`. Undoable means it happened and
you reversed it. This means it has not happened yet, and the human is still the
one who makes it happen.

`prefill_batch` already works this way and already says so: *"This FILLS A FORM
— it generates nothing, writes no files and touches no project."* The precedent
is set; this sketch generalises it rather than inventing anything.

---

## 2. THE RISK IS NOT THE FILLING, IT IS WHAT THE FIELD FEEDS

Two kinds of field, and the difference is the whole design:

**Constrained** — a size, a duration, a territory, a batch row. The field's own
type bounds the damage; the worst case is a wrong value sitting in front of you.
These are what `fillableFields` is for, and they are where an assistant stops
being a nav bar: proposing twelve rows off a Wrike job is worth more than
opening the page the rows go in.

**Instruction-shaped** — a script body, an output path, a filename that decides
where files land. The field bounds nothing. Filling one is not proposing a
value, it is *authoring the action*, and the button afterwards is a formality
rather than a decision. These are never listed.

The test, when adding a field: *if this were filled with the worst plausible
value and the artist pressed the button without reading it, what happens?* A
wrong size is a wrong comp. A wrong script is anything at all.

---

## 3. SCRIPT PLAYGROUND IS EXCLUDED PERMANENTLY

Its textarea is the argument to `runScript` — the bare eval that CLAUDE.md §1
and `AGENT-READONLY-SLICE.md` both single out as never exposed, in this slice or
any later one.

Filling it would grant that capability through the front end. The tool list
would still honestly report that `runScript` is not exposed, while the only
remaining gate was an artist skimming forty lines of code they did not write.
An audit of the tool set would come back clean and be wrong.

Hence the explicit `fillableFields: []` on that entry rather than leaving it
absent: every other tool is unfillable by omission, which is correct but silent.
This one has to be unfillable on purpose, and be seen to be, because it is the
one place where breaking the rule would look most helpful.

---

## 4. THE RULES THE FILLER ENFORCES REGARDLESS

These do not live in the registry, because a per-tool list must not be able to
opt out of them:

1. **Fail closed.** An unlisted field, or an unlisted tool, is not fillable. A
   new field must not become agent-fillable by having been forgotten — the same
   rule `actionSafety` uses, for the same reason.
2. **Fill and stop.** Never fill and submit, even where the button is graded
   `read`. The proposal only stays a proposal if a human ends it.
3. **Never silently overwrite.** If a field already holds a value the artist
   typed, say so and ask. Overwriting someone's work is exactly where a
   proposal turns into a destructive act, and it is invisible — the field looks
   just as filled either way.
4. **Say what was filled.** "Filled 12 rows, press Localise when you're happy",
   and name what was skipped and why, the way `prefill_batch` already reports
   the deliverables it could not turn into rows.

---

## 5. HOW IT IS BUILT

- **`fill_fields`** (`lib/agent/tools.ts`) — `{ toolId, values }`. Resolves the
  tool in the registry, drops any key not on its `fillableFields`, drops any
  non-string value (`String(undefined)` puts the word "undefined" in a
  filename), stages what survives, then navigates. If navigation fails it
  *un-stages*, so nothing is left waiting for a tool that never opened.
- **`lib/agent/fieldHandoff.ts`** — the pipe. A module variable, taken once,
  cleared as it is read, and keyed by tool id so a fill meant for one tool
  cannot be swallowed by whatever mounted first. It decides nothing; the gate
  is upstream, so there is only one place policy lives.
- **The receiver** (`NameGenerator.tsx`) — reads its pending fill on mount,
  fills only the fields that are **empty**, and names the ones it held back in
  the status line. It also says "Nothing has been generated yet", because the
  form looking full is exactly when someone assumes it ran.
- **Field ids, not labels.** `actionSafety` is keyed by label because a button
  is identified by its visible text and there is no other handle. A field has a
  real one, and keying by label would break the moment "Film Title" is
  retitled — or worse, silently stop matching and quietly fill nothing.
- **The model is told the ids** via the capability list; without that it would
  infer them from on-screen labels, and they deliberately differ ("Slug
  Description" is `site`).

### Adding the next tool

1. Add `fillableFields: [...]` to its registry entry, ids only, and apply the
   worst-plausible-value test to each one.
2. Copy the mount effect from `NameGenerator.tsx`. Fill empty fields only, and
   report what was held back.
3. Nothing else. The tool, the gate and the prompt are already general.
