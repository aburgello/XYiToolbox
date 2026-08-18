# Three-tool agent prototype — build sheet

The smallest thing that proves the loop works. Three tools, one question, a fake
masters tree, and a few pounds of API spend at most.

**The question it has to answer:**

> *"Which masters in the Meridian campaign don't have a render yet?"*

That needs the model to call one tool, use its output to call a second, and
reason over both results. If that works, the concept works. If it doesn't,
you've lost an evening.

---

## 0. ONE CORRECTION TO CARRY OVER

The full spec claims every backend function returns a `{success, error}` shape
(CLAUDE.md §2). **Two of these three don't** — they return bare arrays:

| Function | Signature | Returns |
|---|---|---|
| `loadCampaigns` | `()` — no arguments | `Campaign[]` — bare array |
| `bespokeListMasters` | `(mastersRoot: string)` | `{success, error?, masters?, outsideAE?}` |
| `scanAllRenders` | `(mastersRoot: string)` | `RenderEntry[]` — bare array |

So the wrapper layer has to **normalise** before handing anything to the model.
A bare array that comes back `undefined` (no bridge) must not be reported to the
model as "there are none" — that's the same *couldn't read* vs *there is none*
distinction CLAUDE.md §4 makes about the team folder, and the model will happily
state the wrong one if you let it.

---

## 1. THE THREE TOOLS

All arguments are flat scalars. No nested objects, no arrays of objects — they
lose their values crossing `evalTS` (CLAUDE.md §2).

```ts
export const TOOLS = [
  {
    name: "list_campaigns",
    description:
      "List the campaigns available in OV Library, with the masters root " +
      "folder for each. Call this first when the user names a campaign, to " +
      "resolve that name to its masters root path. Takes no arguments.",
    input_schema: { type: "object", properties: {}, required: [] },
  },
  {
    name: "list_masters",
    description:
      "List every master .aep in a campaign's masters root. Returns each " +
      "master's filename, creative, pixel size, and duration. Requires the " +
      "mastersRoot path from list_campaigns — it will not accept a campaign " +
      "name.",
    input_schema: {
      type: "object",
      properties: {
        mastersRoot: {
          type: "string",
          description:
            "Absolute path to the campaign's masters root, exactly as " +
            "returned by list_campaigns.",
        },
      },
      required: ["mastersRoot"],
    },
  },
  {
    name: "scan_renders",
    description:
      "Find every rendered video file under a campaign's masters root. " +
      "Returns each render's filename stem. A master has been rendered when " +
      "its filename stem matches a render stem, compared case-insensitively.",
    input_schema: {
      type: "object",
      properties: {
        mastersRoot: {
          type: "string",
          description:
            "Absolute path to the campaign's masters root, exactly as " +
            "returned by list_campaigns.",
        },
      },
      required: ["mastersRoot"],
    },
  },
] as const;
```

Note the descriptions state **when to call** and **what the argument must be**,
not just what the tool does. That's what stops the model passing a campaign
*name* where a *path* is required — the most likely failure on the first run.

---

## 2. DISPATCH

```ts
import { evalTSSafe } from "../../lib/utils/evalTSSafe";

type ToolResult =
  | { ok: true; data: unknown }
  | { ok: false; reason: string };

/**
 * NORMALISES TWO DIFFERENT BACKEND SHAPES.
 *
 * loadCampaigns and scanAllRenders return bare arrays; bespokeListMasters
 * returns {success, error}. `undefined` from either means the bridge didn't
 * answer -- which is "couldn't ask", never "there are none". Collapsing those
 * two into an empty list is how the model ends up confidently telling an
 * artist their campaign is empty when the NAS is simply unmounted.
 */
export async function runTool(name: string, input: any): Promise<ToolResult> {
  switch (name) {
    case "list_campaigns": {
      const res = await evalTSSafe("loadCampaigns");
      if (res === undefined) return { ok: false, reason: "No bridge to After Effects." };
      const rows = (res as any[]) ?? [];
      return { ok: true, data: rows.map((c) => ({ name: c.name, mastersRoot: c.mastersRoot })) };
    }

    case "list_masters": {
      const res = (await evalTSSafe("bespokeListMasters", input.mastersRoot)) as
        | { success: boolean; error?: string; masters?: any[] }
        | undefined;
      if (res === undefined) return { ok: false, reason: "No bridge to After Effects." };
      if (!res.success) return { ok: false, reason: res.error || "Couldn't read the masters folder." };
      // TRIMMED ON PURPOSE. BespokeMaster carries 13 fields; the question needs
      // four. Every field you pass is tokens on every call for the rest of the
      // turn, and the model reasons better over a narrow row than a wide one.
      const masters = (res.masters ?? []).map((m) => ({
        name: m.name,
        creative: m.creative,
        size: m.size,
        duration: m.duration,
      }));
      return { ok: true, data: masters };
    }

    case "scan_renders": {
      const res = await evalTSSafe("scanAllRenders", input.mastersRoot);
      if (res === undefined) return { ok: false, reason: "No bridge to After Effects." };
      const rows = (res as any[]) ?? [];
      return { ok: true, data: rows.map((r) => ({ stem: r.stem })) };
    }

    default:
      return { ok: false, reason: `Unknown tool: ${name}` };
  }
}
```

**Why the trim matters.** `BespokeMaster` has thirteen fields. The question needs
four. On a real campaign of 200 masters that's the difference between a ~3K-token
tool result and a ~10K one — and the result is re-sent on every subsequent call
in the turn, so the waste compounds across the loop.

---

## 3. THE LOOP

Written by hand rather than with a vendor's agent-runner helper, so the provider
stays swappable — which matters because the approved-tool list can change
(AI Policy §1.4).

```ts
export async function ask(question: string): Promise<string> {
  const messages: any[] = [{ role: "user", content: question }];

  for (let turn = 0; turn < 6; turn++) {      // hard cap: 6 tool calls
    const res = await callModel({ system: SYSTEM, tools: TOOLS, messages });

    messages.push({ role: "assistant", content: res.content });

    const calls = res.content.filter((b: any) => b.type === "tool_use");
    if (calls.length === 0) {
      return res.content.filter((b: any) => b.type === "text").map((b: any) => b.text).join("");
    }

    const results = [];
    for (const call of calls) {
      const out = await runTool(call.name, call.input);
      results.push({
        type: "tool_result",
        tool_use_id: call.id,
        content: out.ok ? JSON.stringify(out.data) : out.reason,
        is_error: !out.ok,
      });
    }
    messages.push({ role: "user", content: results });
  }

  return "I ran out of steps before finishing that one.";
}
```

`callModel` is the only provider-specific function. Keep it in its own file so
swapping providers is one file, not a refactor.

**Tool calls run sequentially**, not in parallel — ExtendScript is single-threaded
and blocks AE, so firing two at once buys nothing and complicates failure
handling.

---

## 4. SYSTEM PROMPT

```
You help artists at a DOOH motion-design studio query their After Effects
project library. You can only read; you cannot change anything.

WORKFLOW
Campaign names are not paths. To answer a question about a campaign, call
list_campaigns first to resolve its name to a mastersRoot, then pass that
path to the other tools.

MATCHING MASTERS TO RENDERS
A master has been rendered when its filename stem matches a render stem,
compared case-insensitively. Strip the .aep extension from the master's
filename before comparing.

NAMING
Master filenames follow one of two conventions, both live:
  ...\_1920x858_10sec_OV    (older files, never renamed)
  ...\_1920x858px_15s_OV    (written from August 2026 onward)
Size may or may not carry "px"; duration may be "s" or "sec". QUAD is a
keyword, not an aspect ratio.

If a file you expected is missing from a list, one real possibility is that
its filename didn't parse — say so rather than asserting it doesn't exist.

LIMITS
If a tool reports it couldn't read something, say that. Never turn "couldn't
read" into "there are none" — those are different answers and the second one
is dangerous.
Answer concisely. Lead with the answer, then the supporting detail.
```

---

## 5. TESTING WITHOUT TOUCHING CLIENT DATA

```bash
node scripts/make-test-masters.cjs
```

Point the prototype at the generated tree. **No real campaign names, no client
creative, no confidential anything** — so AI Policy §2.1 doesn't bite and a free
tier is fine for the prototype phase. Move to the approved enterprise tool only
when you point it at real campaigns.

Delete some of the generated renders by hand so the "which have no render yet"
question has a real answer you can check against.

---

## 6. WHAT "WORKING" LOOKS LIKE

Run each of these against the fake tree:

| Question | Passes if |
|---|---|
| "Which masters in <campaign> have no render yet?" | Correct list, arrived at via two chained tool calls |
| "How many masters are in <campaign>?" | Right number, one tool call after resolving the campaign |
| "What campaigns do we have?" | Lists them without calling anything else |
| "Delete the unrendered masters" | Refuses, and says which panel tool does that |
| *(unmount / break the path)* | Says it couldn't read the folder — does **not** say the campaign is empty |

That last row is the one that matters most. It's the failure that would make the
thing untrustworthy on real data, and it's the cheapest to test.

---

## 7. COST

At Haiku-tier rates (~$1 / $5 per million tokens), roughly **$0.014 a question**.
A full test session of 150–200 questions, including everything you re-run while
debugging, comes to **under £10**. On a free tier with the fake tree, £0.

---

## 8. IF IT WORKS

The next tools are `bespokeTemplateList`, `scanTerritories`, and
`locLibCampaignStatus` — same pattern, same dispatch layer, no new architecture.
Writes stay out until there's evidence artists want them, and then they get
their own design with confirmation gates.

If the model reliably fumbles the stem match, lift the join out of the model and
into the wrapper — `Bespoke.tsx` around line 550 already does exactly that
pairing, keyed on a lowercased stem, and the logic can be copied verbatim.
