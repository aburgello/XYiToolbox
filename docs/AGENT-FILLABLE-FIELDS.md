# Filling fields — design sketch

The agent can open a tool and it can press a small graded set of one-click
actions. It cannot put a value into a field. This is the sketch for the rung
between those two, and the argument for where it stops.

**Status: sketch.** `ToolEntry.fillableFields` exists and is typed, and Script
Playground carries an explicit empty entry. No tool declares a fillable field
yet and there is no filler tool — so nothing is fillable today, which is the
correct state until the plumbing below is built.

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

## 5. WHAT IS LEFT TO BUILD

- A `fill_fields` agent tool: `{ toolId, values: Record<fieldId, string> }`,
  gated against `fillableFields` before anything reaches the UI.
- A per-tool receiver. `localiseHandoff.ts` is the shape to copy: a module
  variable, taken once, cleared as it is read — so navigating back later cannot
  silently re-fill a form with a job already dealt with.
- Field ids per tool, stable and independent of labels. Labels are display
  strings and get retitled; `actionSafety` is keyed by label because buttons are
  identified by their visible text, but a field has no such requirement and
  should not inherit that fragility.
- A conflict answer for the "field already has a value" case: probably fill the
  empty ones, list the ones held back, and let the artist ask for the rest.
