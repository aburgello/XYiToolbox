# Read-only agent slice — design

A chat surface inside XYi Toolbox that answers questions about the studio's
state by calling a curated set of **read-only** ExtendScript functions that
already exist. No writes, no builds, no render queue, no file operations.

The point of the slice is to prove the loop end to end — tool definitions,
bridge marshalling, blocking behaviour, and whether artists actually ask it
anything — before any of the expensive, dangerous half gets designed.

---

## 1. WHY THIS IS SMALL

The backend is already shaped like a tool API. CLAUDE.md §2 mandates that every
ExtendScript function `return {success, error} shapes; never throw across the
bridge` — which is exactly the contract a model tool call needs: a named
function, typed arguments, and failure reported as data rather than as an
exception that kills the caller.

`toolRegistry.tsx` already stores each tool's exact visible button labels in
`ToolEntry.actions`, because search and ⌘K needed them. That is a ready-made
mapping from what an artist *says* to what the backend *does*, and it is the
seed vocabulary for the system prompt.

Nothing in this slice adds an ExtendScript function. It exposes existing ones.

---

## 2. SCOPE

**In:** a chat panel; a curated read-only tool set; the agent loop; a system
prompt carrying studio vocabulary; per-call logging.

**Out, deliberately:** anything that writes a file, opens or saves a project,
builds a comp, touches the render queue, posts to the team folder, or mutates
`app.settings`. Also out: `runScript`, and every open-and-save exception listed
in CLAUDE.md §1.

---

## 3. THE TOOL SET

Ten functions. Each is already exported and already reachable over `evalTS`.

| Tool | Backend export | Answers |
|---|---|---|
| `list_campaigns` | `loadCampaigns` | Which campaigns exist, and their markets root |
| `campaign_status` | `locLibCampaignStatus` | Is a campaign's folder reachable right now |
| `list_masters` | `bespokeListMasters` | Every master in a campaign, with size/duration/territory/creative |
| `scan_renders` | `scanAllRenders` | Which renders exist beside the masters |
| `list_screens` | `bespokeTemplateList` | The shared Bespoke screen/layout library |
| `scan_screen_library` | `bespokeLibraryScan` | The templates root, for screens not yet in the shared file |
| `list_territories` | `scanTerritories` | Territories present for a campaign |
| `territory_code` | `getTerritoryCountryCode` | Territory → country code |
| `read_active_comp` | `bespokeRegionsFromComp` | The comp the artist has open, as regions |
| `parse_master_name` | `parseMasterFilename` | Decompose a master filename into its fields |

**Before implementation, audit this table per CLAUDE.md §6:** every
`evalTS("name")` must resolve to a real export, and `localise.ts` contains a
literal NUL byte, so the audit must use `rg --text` or `grep -a` or it will
silently skip that file and report false negatives.

### Why exactly these

They cover the questions artists actually ask between tasks — *what's in this
campaign*, *what's already rendered*, *what screens do we have*, *what is this
file called and why didn't it parse* — and every one of them is a scan or a
lookup that cannot change anything.

### What is explicitly excluded, and why

- **`runScript`** — a bare `eval` over the bridge. An agent holding it can do
  anything, including the thing CLAUDE.md §1 exists to prevent. Never exposed,
  not in this slice and not in any later one.
- **`mcIt`, `losOpenForEdit`, `jpegLoc`, `midcarder`, `campaignLocaliserGenerate`,
  `Trott2`, `importComponentsIntoBatchFolder`** — the confirmed open-and-save
  exceptions. Out of scope by definition.
- **`buildMastersIndex`** — read-only in effect, but it recurses depth-first over
  the whole masters tree and its walk order decides scorer tie-breaks (§5). Too
  slow and too load-bearing to hand to a loop that may call it repeatedly.
  `bespokeListMasters` covers the same ground for a single campaign.
- **`scanOvSwap`** — read-only, but its output invites the next question ("now
  swap them"), which is a write. Keep it out until writes are designed.

---

## 4. ARCHITECTURE

```
React chat panel  ──►  agent loop (Claude API)  ──►  tool dispatch
       ▲                                                   │
       └────────────── rendered answer ◄── evalTSSafe ──────┘
                                              │
                                     ExtendScript (unchanged)
```

- **Frontend** — one new tool in `tools/` plus its `.scss`, one entry in
  `toolRegistry.tsx`'s `TOOLS`, `ToolEntry.actions` populated with the real
  button labels. Registration is not optional: CLAUDE.md §4 notes
  `CSVLocaliser.tsx` is live but unregistered and therefore unfindable.
- **Agent loop** — `client.beta.messages.toolRunner()` from
  `@anthropic-ai/sdk`. The runner drives request → execute → loop; per-turn
  hooks cover logging and interception without hand-writing the loop.
- **Dispatch** — every tool call goes through `evalTSSafe` (15s timeout, toasts
  on failure). Never raw `evalTS`: an agent turn is user-initiated, so a hung
  call must surface rather than block the panel forever.
- **Backend** — untouched. This slice adds no `src/jsx` code, which keeps it
  clear of the fact that `tsc -p tsconfig-build.json` type-checks zero files
  there (§6).

### Bridge marshalling — the one real trap

CLAUDE.md §2: arguments are `JSON.stringify`'d and spliced into eval'd
ExtendScript *source*, and **nested arrays-of-objects lose their values in
transit**. Flat objects of scalars survive; return values round-trip safely.

Every tool schema in this slice therefore takes **flat scalar arguments only** —
strings and numbers, no nested objects, no arrays of objects. This is a schema
constraint, enforced at definition time, not a runtime check.

### Blocking

ExtendScript is single-threaded and blocks AE. A four-tool turn is four
blocking operations back to back. Mitigations:

- Tools are scans and lookups, the cheapest class of call in the backend.
- `max_iterations` on the runner caps a turn at **6** tool calls.
- The panel shows which tool is running, so a slow NAS scan reads as progress
  rather than as a freeze.

### Team-folder behaviour

Per CLAUDE.md §4, an empty or failed read must never be presented as "there is
none". `bespokeTemplateList` already carries `read` to distinguish *no data*
from *couldn't read*; the tool result must preserve that distinction so the
agent says "the share isn't mounted" rather than "you have no screens."

---

## 5. MODEL — CONSTRAINED BY THE AI POLICY, NOT BY PREFERENCE

**The model choice here is a compliance decision before it is a technical one.**

XYi Design's AI Policy §2.1 forbids inputting confidential company information —
**explicitly including creative assets** — into any AI tool that IT has not
specifically approved, and §2.3 states plainly that an unapproved tool is
prohibited for business use. This agent sends campaign names, master filenames,
creative names, territories, and the screen library. That is in scope.

§3.1 lists the approved tools: **Google Gemini (Enterprise / Workspace edition)**
and **Adobe AI (Firefly & Creative Cloud)**. Nothing else is approved.

### The two viable routes

**A — Gemini Enterprise (no approval needed).** Already vetted, already licensed,
and §3.1 names "coding assistance, data analysis" as sanctioned usage. The
contractual no-training guarantee is quoted in the policy itself. This is the
route that ships without waiting on anyone.

**B — Self-hosted open-weight model (needs a §5.2 request, but should pass).**
No vendor owns the inputs, nothing trains on them, and the data never leaves the
network — stronger than §5.2's "preferably UK/EU" bar. Costs GPU hardware and
ops. The right choice if studio data should never cross a vendor boundary at all.

Hosted third-party APIs outside the approved list — including any
lower-cost overseas provider — should be assumed prohibited until IT says
otherwise. §5.2's data-residency criterion is the one most likely to fail.

### Provider portability is a requirement, not a nicety

Policy changes (§1.4 says so explicitly), so the loop is written against a
**thin model adapter** rather than any one vendor's agent-runner helper. Tool
definitions and dispatch stay provider-agnostic; swapping providers is a config
change. This costs ~50 lines now and saves a rewrite later.

### Parameters that carry across providers

- **Keep reasoning/thinking enabled** where the provider exposes it. On models
  that support disabling it, a disabled-reasoning tool-calling agent can write
  a tool call into its visible text instead of emitting a structured call — the
  turn completes, no error fires, and the call silently never runs. Control cost
  with an effort/verbosity setting instead of switching reasoning off.
- **Cap the loop** at 6 tool calls per turn.
- **Cache the stable prefix.** The system prompt plus the ten tool definitions
  is ~3,000 tokens and identical across calls. Every serious provider bills
  cached input at a fraction of fresh input. Keep the prefix byte-stable — no
  timestamps, no machine tag, no per-artist interpolation ahead of the
  breakpoint — and verify cache reads are non-zero on the second call.

### Per-campaign gate (policy §6.3)

"Certain clients, campaigns or projects may have restrictions in place for AI
usage." The agent must therefore support a **per-campaign block**: a restricted
campaign cannot be queried at all, and the refusal must be enforced in the tool
dispatch layer, not in the system prompt. Prompt-level restrictions are not a
control.

### Disclosure (policy §6.1–6.2)

Use of this agent is AI-assisted work and must be disclosed to managers. Worth
surfacing in the panel itself rather than relying on artists to remember.

---

## 6. SYSTEM PROMPT

Carries the domain the model cannot infer:

- **Naming conventions**, both of them. `…_1920x858_10sec_OV` (legacy, still on
  disk) and `…_1920x858px_15s_OV` (from 2026-08 onward). A master that fails to
  parse is silently dropped, not reported — so when a file is missing from a
  list, "it may have failed to parse" is a real hypothesis the agent should
  offer.
- **Vocabulary**: master, creative, artwork, territory, campaign, screen, QUAD
  (a keyword token, not a ratio), OV.
- **Folder rules**: anything starting with `_` is excluded from scans.
- **Boundaries**: read-only; if asked to change anything, say which tool in the
  panel does it and stop.

---

## 7. COSTS

**Re-baseline these against whichever approved provider is chosen.** The figures
below are an order-of-magnitude model, computed against frontier-tier API rates
($5 / $25 per million input / output tokens, cache reads at ~0.1× input). They
establish the shape of the cost, not the invoice: a cheaper approved model moves
every number down, and a self-hosted model replaces the per-question cost with
fixed hardware and ops.

### Per question

A typical read-only question ("which masters in Meridian have no render?") is
one turn of 3–4 tool calls, so 4–5 API calls as the conversation grows:

| | Frontier tier | Mid tier (~40% of cost) |
|---|---|---|
| Cached prefix reads (~12K tok) | $0.006 | $0.002 |
| Fresh input — question + tool results (~7.5K tok) | $0.038 | $0.015 |
| Output — reasoning + tool calls + answer (~1K tok) | $0.025 | $0.010 |
| **Per question** | **≈ $0.07** | **≈ $0.03** |

Heavier questions — a full masters scan returning a few hundred rows — push
tool results up and land nearer **$0.15** at frontier tier. Trivial lookups sit
under a cent.

### Per studio

At 8 artists asking 20 questions a day, 250 working days:

| | Per day | Per year |
|---|---|---|
| Frontier tier | ~$11 | **~$2,800** |
| Mid tier | ~$5 | **~$1,200** |

The comparison that matters: **the annual bill is roughly one to two artist-weeks.**
If the agent saves each artist twenty minutes a week, it has paid for itself
several times over. If artists don't use it, you find out for a few hundred
pounds rather than a quarter of engineering.

### The levers, in order

1. **Prompt caching** — the single biggest one. Without a stable prefix you pay
   full input price on 3,000 tokens every call; with it, a tenth of that. A
   silent invalidator (a timestamp, the machine tag) quietly triples the bill,
   so verify `cache_read_input_tokens` is non-zero on the second call and treat
   a zero as a bug.
2. **Effort** — `low` for this workload. Raising it increases thinking tokens,
   which are billed as output at the higher rate.
3. **Model** — Sonnet 5 is roughly 40% of Opus 5's cost and is likely sufficient
   for scan-and-report. Worth an A/B once the tool set is stable; note the
   introductory rate ends 2026-08-31.
4. **`max_iterations`** — capping a turn at 6 tool calls bounds the worst case.

### Not counted

Artist time while a scan blocks AE, and the engineering to build it. Both are
larger than the API bill.

---

## 8. VERIFICATION

Per CLAUDE.md §6, and with its warnings applied:

- **Tool-name audit** — every `evalTS("name")` in the dispatch table resolves to
  a real export, checked with `rg --text` (the NUL byte in `localise.ts`).
- **Marshalling** — assert at definition time that no tool schema contains a
  nested object or an array of objects.
- **Real AE pass** — browser preview never runs ExtendScript, so every tool must
  be exercised in AE before the slice is called done. `yarn dev` proves the
  chat UI and nothing about the backend.
- **Cache check** — confirm `cache_read_input_tokens > 0` on the second call of
  a session.
- **Read-only proof** — run the full tool set against a copy of a masters tree
  (`node scripts/make-test-masters.cjs`) and diff the tree before and after.
  Nothing may change.

---

## 9. WHAT THIS SLICE DELIBERATELY DOES NOT ANSWER

Whether writes should ever be exposed, and under what confirmation. That is the
question this slice exists to inform: if artists use the read-only agent and ask
it to *do* things, the demand is real and the guardrail design is worth the
effort. If they don't, there is nothing further to build.
