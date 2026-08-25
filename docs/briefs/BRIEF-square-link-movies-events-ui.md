---
brief: square-link-movies-events-ui
title: Movies and events can be linked to a Square catalog item again, not only dismissed
status: built
track: bug
severity: P1
date: 2026-08-25
verified: false
---

# Brief (for Claude Code): Restore the ability to link movies & events to Square from admin

**Status:** 🔴 Confirmed bug, go-live relevant. The admin UI currently offers **no way to link a movie or event to a Square catalog item** — only "Dismiss." The linking UI already exists in the codebase; one guard suppresses it on the surfaces where it's needed.
**Date:** August 25, 2026
**Requested by:** Tom — created a new movie + showing, got no "needs linking" warning, then found the "Square catalog — movies" panel only lets him **Dismiss** the 5 unlinked titles, never link them.

## Root cause (verified in code at `origin/main`)
Two components sit on the Movies tab (and the Live Events tab), and each defers movie/event linking to the other — so neither renders it.

- **`SquareLinkPanel`** (`src/components/admin/SquareLinkPanel.tsx`) — the "Square catalog — movies / — live events" flag box (the one in the screenshot). For the non-passes scopes it maps every row with `options: []` and `canCreate: false` (lines ~224–232), so the row renders **only a Dismiss button**. Passes get real create/link actions; movies and events do not.
- **`SquareCatalogTab`** (`src/components/admin/SquareCatalogTab.tsx`) — the "Showtimes in Square" section below it — *does* contain the real linking UI: the **"Productions with no Square item"** section (lines ~328–371) with per-title **"This one"** link buttons (calls `link_item`) when a same-named Square item exists, and the **"Create it in Square as an Event item … then refresh"** guidance when none does. **But** line ~255 blanks it whenever the component is scoped:
  ```ts
  // Linkage belongs to SquareLinkPanel on the scoped surfaces; see the prop note.
  const needs = scoped ? [] : (plan.needs_dashboard_item ?? []);
  ```
- **Every mount is scoped.** `AdminDashboard.tsx` mounts `SquareCatalogTab` only as `kinds={['movie']}` (L802) and `kinds={['event','live_performance']}` (L910) — both set `scoped = true`. There is **no unscoped mount anywhere**, so the linking section for movies/events is dead code in production: `SquareCatalogTab` hides it (thinks the panel covers it) and `SquareLinkPanel` never had it. Result: movies/events can only be dismissed.

Passes are unaffected — they have a working path in both components.

## Hard constraint to preserve (not a bug — Square's platform limit)
The app **cannot create movie/event catalog items via the Square API.** They must be the `EVENT` product type (the only type that can hold a venue + showtimes, per the venue/date work and the `not_event_item` guard in `square-showing-variations`), and Square's Connect API cannot create `EVENT`-type items. So for a title Square has never seen, the correct flow is: **create it as an Event item in the Square dashboard, then the app links/adopts it.** The fix restores the ability to **link to an existing item** and to **see the correct create-in-dashboard instruction** — it does not (and cannot) add API creation for movies/events.

## Part A — Restore movie/event linking (the fix)
**Recommended (Option A, minimal):** In `SquareCatalogTab`, stop blanking `needs` when scoped; instead render the scoped kind's unlinked productions.
- Replace the line-255 guard with a kind-filtered list, e.g. `const needs = (plan.needs_dashboard_item ?? []).filter(n => !scoped || kinds!.includes(n.kind))` (note: these rows carry `.kind`, not `.production_kind`, so `inScope` can't be reused as-is — filter on `n.kind`, matching how `SquareLinkPanel` filters via `SCOPE_KINDS`).
- Update the now-wrong delegation comment (line ~254) — linkage no longer "belongs to SquareLinkPanel" for these scopes.
- This immediately lights up the existing "This one" link buttons and the "Create it in Square as an Event" guidance on the Movies and Live Events tabs. It reuses the unscoped path's already-working, already-tested UI and the `link_item` action.

**Alternative (Option B):** Build the link/create affordances into `SquareLinkPanel` itself for movies/events (populate `options` from `possible_matches`, wire a link handler). More code, duplicates what `SquareCatalogTab` already does — not recommended.

**Overlap to resolve (Decision 1):** With Option A, the same unlinked title appears in two places — the `SquareLinkPanel` flag box (Dismiss) *and* the `SquareCatalogTab` "no Square item" section (link/act). Options: (a) **keep both** — flag box for quick dismiss/acknowledge, section for the actual linking (reasonable, but make the linking section **respect `square_link_dismissals`** so a dismissed title disappears from both, consistently); or (b) **collapse to one** — drop the movie/event `SquareLinkPanel` mounts and let `SquareCatalogTab` be the single Square surface for these kinds. Recommend (a) with dismissal-awareness, or (b) if you'd rather have one place; either is fine, but they must agree on dismissals.

## Part B — Make the save-time warning reliable
When Tom saved the new showing he got **no** "This title has no Square item yet — link it under Square catalog" toast. `ShowingForm.tsx` (~L426) fires `ensure_showing` on save and warns only when the response has `counts.needs_item` (~L433). That count is only produced when the showing yields a **desired variation**, which requires a **valid price** — an active price tier or a non-null `ticket_price` (`desiredVariations` in `_shared/square-catalog.ts` skips a row whose price is null/NaN/negative; note `$0` is *not* skipped). So a showing saved **without a price** produces no desired variation → no `needs_item` → **silent**, and it also won't appear in the unlinked panel (which reads the horizon-windowed `plan`).

Fix so a newly-saved showing never links-fail silently:
- If `ensure_showing` returns **no desired variations because the showing has no sellable price**, surface a distinct toast (e.g. "Saved, but this showing has no price set, so it won't sell or report in Square"). Confirm first whether an unpriced showing is even meant to be sellable — if not, this is also a data-entry warning worth having, but keep the change scoped to messaging (don't block the save).
- Verify the existing `needs_item` toast actually fires for a **priced** new title whose parent item doesn't exist — by the code it should; confirm it does on the deployed build.

## Part C — Deployment check (do first)
Tom's live behavior may lag `main`. Before/while fixing, confirm the **deployed** `square-showing-variations` edge function and the **deployed** frontend on the environment he's testing (staging vs prod) match `main` — the `ensure_showing` action and the `ShowingForm` warning block must both be live, or the symptoms are partly a stale deploy rather than only this bug.

## Immediate workaround (for Tom, no code)
To link the 5 titles today: create each as an **Event** item in the **Square dashboard** (same title, correct reporting category), then **re-save that title's showing** in admin. Re-saving re-runs `ensure_showing`, which finds the now-existing item by title and links/appends the variations automatically (status `adopt_existing`/`would_append`).

## Decisions for Tom
1. **Overlap:** keep both surfaces with dismissal-aware linking (recommended) vs collapse to one Square surface per kind.
2. **Unpriced-showing toast:** add the distinct "no price set" warning (recommended) vs leave save-time messaging as-is.
3. **Fix approach:** Option A un-suppress in `SquareCatalogTab` (recommended) vs Option B build it into `SquareLinkPanel`.

## Test plan
- On the **Movies** tab, an unlinked title with a same-named Square item shows a **"This one"** link button that links it (mapping written; it drops off the unlinked list on refresh).
- An unlinked title with **no** Square counterpart shows the **"Create it in Square as an Event under <category>, then refresh"** guidance (no dead-end Dismiss-only row).
- Same behavior on the **Live Events** tab for `event` and `live_performance`.
- Dismiss still works and — per Decision 1 — a dismissed title disappears from **both** the flag box and the linking section.
- Creating a movie + a **priced** showing whose title has no Square item produces the **"link it under Square catalog"** toast on save; creating one **without** a price produces the distinct no-price toast (Decision 2), not silence.
- Passes surface unchanged and still create/link correctly.
- `link_item` writes only the mapping (no catalog write); no regression to the read-modify-write guardrails; `npm run build` + tests pass.

---

## Outcome (2026-08-25)

Parts A and B are built; Part C was run first and **cleared**. Three of the
brief's own premises turned out to be wrong, and each is recorded here because
each would otherwise send the next session down the same path.

### Part C — the deploy was not stale (checked before fixing)

- `square-showing-variations` on production is version 8, deployed
  2026-08-21 15:27:24, **17 seconds after** commit `18ee25a`, the last commit to
  touch it. The function is current with `main`.
- The deployed production bundle carries every relevant string:
  `link it under Square catalog` and `ensure_showing` in the ShowingForm chunk;
  `Productions with no Square item`, `square_link_dismissals` and
  `needs_dashboard_item` in the AdminDashboard chunk.

So the symptoms were entirely this bug, in live code. Nothing about them was
deploy lag.

### Part B — the stated root cause cannot happen

The brief attributed the missing toast to a showing saved **without a price**
producing no desired variation. It does not:

- `showings.ticket_price` is **NOT NULL** (`ticket_price: number` in the
  generated row type), so the fallback price is never absent.
- Even if it were, `desiredVariations` computes `Number(s.ticket_price)`, and
  `Number(null)` is `0` — finite and non-negative, so the `no valid price` guard
  does not fire. A priceless showing yields a **$0 variation**, not a skip.

The `no valid price` skip is therefore close to unreachable, and a toast built
on it would have been dead code. The real gap is different and larger: the save
tested `counts.needs_item` and nothing else, which is **one of eight statuses**
the planner returns. Three others mean "this showing has no usable catalog
item" and were silent:

| status | meaning | was it visible anywhere? |
|---|---|---|
| `needs_item` | no Square item by this name | toast + unlinked list |
| `ambiguous_item` | two Square items share the title | unlinked list only — **no toast** |
| `not_event_item` | linked item is REGULAR, cannot hold showtimes | **nowhere** |
| `stored_item_gone` | linked item is no longer in the catalog | **nowhere** |

A 200 carrying an empty `counts` — the function's own "no active showings"
early return — also read as a clean save. All of these now produce a distinct,
actionable message via `squareSaveOutcome` in `src/lib/squareLink.ts`.

Because the premise was wrong, the "no price set" wording the brief proposed
was not adopted: it would have told an operator a $0 showing will not sell in
Square, which is untrue. The generic skip-reason branch still surfaces a
`no valid price` skip verbatim if one ever occurs.

### Part A — fixed as Option A, with two corrections

- `needs_dashboard_item` is assembled in the edge function **before** the
  `kinds` scope is applied — the scope narrows only `adoptable`, `appendable`
  and `price_drift`. So the client-side `.kind` filter is not belt-and-braces
  like `inScope` above it; it is the only thing keeping concerts off the Movies
  tab. Extracted to `needsForScope` and tested.
- **`ambiguous_item` rows fell through to the wrong instruction.** Their
  `possible_matches` is empty *by construction* — `suggestTitleMatches` skips
  exact-name matches — so un-suppressing the section would have shown "Nothing
  similar in the catalog. Create it in Square as an Event item" for a title
  Square already has **two** of, inviting a third. Those rows now say so
  explicitly instead.

### Decision 1 — a dismissal-keying bug had to be fixed first

Kept both surfaces, sharing the dismissal list (option (a)). That exposed a
pre-existing bug in `SquareLinkPanel`: it filed every dismissal under the
**surface's** table name, while the Live Events surface covers two kinds. So
dismissing an *event* there wrote `entity_type: 'live_performances'` with an
`events` id. Self-consistent while that panel was the only reader, and wrong
the moment anything else looked a dismissal up by the production's real kind.
Dismissals are now keyed per row by the production's own kind.

**Consequence to expect:** any event dismissed on the Live Events tab *before*
this change is stored under the wrong table and will reappear once. Dismissing
it again files it correctly. Nothing else is affected, and no data is lost.

### Still open (deliberately not done here)

`ambiguous_item` rows are now honest but not yet **actionable** — offering the
duplicate items as link buttons needs `possible_matches` to carry exact-title
matches for those rows, which is an edge-function change. Kept out to hold this
fix to the frontend, so it ships through the normal PR + `wrangler deploy` path
with no function deploy coupled to it. The client already degrades correctly if
that is added later.

### Verification

`tsc -p tsconfig.app.json --noEmit` clean · `vitest run` 38 files / 418 passing
(24 new in `src/lib/squareLink.test.ts`) · `build:production` clean, new strings
confirmed in the emitted chunks, bundle carries the production Supabase ref ·
eslint 21 problems against a 23-problem baseline on the same files (two fewer
`any`, no new warnings).

**Not yet deployed.** Merging does not deploy; this needs `npx wrangler deploy`.
