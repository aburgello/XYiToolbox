# Project skills

Design skills vendored from [VibeCurb](https://github.com/Yu-369/VibeCurb) (MIT License,
Copyright (c) 2026 Yu-369), copied from the TimeHub project. These are prompt/instruction
files only — no runtime code, no dependencies, and nothing imported by the panel.

| Skill | Use it for |
| :--- | :--- |
| `visual-redesign` | Restyling existing components without touching JS logic. Treats state, effects, API calls, handlers, refs and `data-*`/`aria-*` attributes as untouchable; changes only classNames, CSS, colours, spacing, type and motion. |
| `awwwards-motion` | Adding animation. Includes a frequency-gated motion budget for functional app UI — high-traffic actions get zero animation, rare ones get the full budget. |
| `awwwards-sections` | Marketing-style page sections. Least relevant here — this is a docked tool panel, not a landing page. Kept for completeness. |

Each runs a four-phase gated pipeline — audit, extract, build, then a PASS/FAIL visual diff —
and will not proceed past a phase until its checklist passes.

## READ THIS BEFORE RUNNING ONE HERE

These skills were written for ordinary React apps on evergreen browsers. **This panel is not
that.** It renders in CEP's embedded Chromium at a declared target of `chrome74`
(`vite.config.ts`), and the skills recommend CSS this target does not have.

Counted in the skill files as vendored:

| Recommended by the skills | Occurrences | Status here |
| :--- | ---: | :--- |
| `clamp()` | 8 | **Banned** (Chrome 79) — use fixed values or `@media` |
| `@property` | 1 | **Banned** — part of why this project is on Tailwind v3, not v4 |
| `@layer` (cascade layers) | 1 | **Banned** — same reason |
| `max()` | 1 | **Banned** (Chrome 79) |

`§3` of [`CLAUDE.md`](../../CLAUDE.md) is the authority and bans more than the list above —
`color-mix()`, `:has()`, `aspect-ratio`, `@container`, `overflow-wrap: anywhere`. None of
those appear in the skills as written, but an "Awwwards-tier" pass will reach for them
unprompted. **Treat that table as a hard gate in the skill's build phase.**

Local traps the skills cannot know about, all from real bugs (see `docs/HISTORY.md`):

- `src/js/index.scss` has a global `button:hover` / `button:active` (`$active: #20639b`)
  that paints over any custom button. Any `<button>` with its own background **must**
  re-declare both states or it flashes blue.
- `<Tooltip>`'s inner span carries `flex: 0 0 auto !important` — never wrap a stretch-sized
  element (`flex: 1`, a grid cell) in one.
- `--cat-glow` is tuned for hover at 0.35 alpha. Never use it as a resting fill.
- A `var(--x, fallback)` fallback does **not** apply when the var is defined.
- A `<button>` that is a flex container does not stretch its children in Chromium — set
  `align-items: stretch`.
- Never use a CSS `transform` to centre an element Framer Motion animates — its inline
  style wins. Use flexbox.
- Compute colour blends in JS. There is no `color-mix()`.

## Verifying the result

`yarn dev` renders in a *modern* browser, so **banned CSS will look fine there and break in
AE**. A styling bug that only reproduces from an installed ZXP is a build-pipeline bug, not
a component bug. Verify low-alpha colours and layout via computed style, not screenshots.

## Scope

Start on a single component or section rather than the whole panel, and check the diff
before committing. The skill's own rule is that JS logic is sacred, but a narrow scope makes
that much easier to confirm.
