# Brief (for Claude Code): System-wide rule — no ticket/purchase for a past showing (hide the button, enforce on the server)

**Status:** 🔴 Architectural gap — a past showing can currently be purchased (server does not check). Launch‑relevant correctness.
**Date:** August 15, 2026
**Requested by:** Tom — logically you can't buy a ticket to something that already happened, so the purchase option should **disappear** (not just dim) for anything in the past — movies, events, and live performances alike — as a rule baked into the underlying system.

## The gap (verified — this is a real hole, not just UI)
- **`ticket-checkout` never checks whether the showing is in the past** — there is no `start_time > now` validation anywhere in it. It would sell a ticket for a screening that already occurred.
- **No `isPast` / `isPurchasable` helper exists** in the codebase (grep‑confirmed).
- **The Showing page renders its buy flow regardless of date** (`src/pages/Showing.tsx`) — no past gate around the purchase button.

So "hide the button" alone is a symptom fix. The **cause** is that purchasability isn't modeled. The rule must be defined once and enforced **on the server (authoritative)** and reflected in the UI.

## Address the cause — one canonical rule, enforced server-side, mirrored in the UI

### 1. A single source-of-truth rule
Create one small helper, used everywhere:
- Client: `src/lib/purchasable.ts` → `isPast(startTime)` and `isPurchasable(showing)` — a showing is purchasable only if `start_time` is in the future **and** it's active (and whatever capacity logic already applies).
- Server: mirror the same check in `supabase/functions/_shared/` so edge functions use the identical rule (don't reimplement inline).

Decide the exact cutoff (Decision 1): sales stop **at `start_time`** (recommended — simplest, clearest), vs. allow until the show actually ends (`start_time + duration`), vs. a small grace window (e.g., up to 15 min after start for walk‑ups). Default: **at `start_time`**.

### 2. Server enforcement — the real fix
- **`ticket-checkout`**: before charging/creating tickets, load the showing and **reject if it's past** → `400 "This showing has already taken place."` This is the authoritative boundary: a stale browser tab, a cached page, or a direct API call must be refused even if the button somehow shows.
- **`film-pass-checkout`** and **pass redemption**: same rule — a pass cannot be purchased against, or redeemed for, a **past** showing.
- These checks are server‑side and cannot be bypassed from the client (mirrors the security‑audit principle: the client guard is not the boundary).

### 3. UI — hide (not dim) the purchase affordance for past showings, everywhere
The "Get Tickets" / Buy / RSVP / film‑pass buttons should **disappear** for a past showing, replaced by a quiet "This showing has passed" state (or nothing). Apply the shared `isPurchasable`/`isPast` rule at every purchase surface:
- **`src/pages/Showing.tsx`** — the main buy flow / seat selection / ticket CTA.
- **`ProductionDetailDrawer.tsx`** — the per‑showing "Get Tickets" buttons and any RSVP button.
- **`UpcomingList.tsx` / `MonthCalendar.tsx` / `EditorialCalendar.tsx`** — any "Get Tickets"/"View details→buy" CTA on a past entry (also see `BRIEF-calendar-past-events.md`, which makes past calendar entries non‑interactive).
- **Tickets / film‑pass buttons** wherever a showing is listed (e.g., the tickets/film‑pass buttons brief surfaces).
- **Showing search / listings** that lead to purchase.

For **RSVP / info‑only** events (Decision 2): an RSVP button for a past event should also disappear (can't RSVP to something that happened); an **info‑only** page with no purchase may still be worth showing as an archival page — decide whether info‑only past events stay visible (just without any action) or are hidden.

### 4. Consistency
This is a **rule of the system**, so it should be impossible to add a new purchase surface that forgets it: centralize the check in the shared helper and have every CTA/handler call it, rather than scattering `new Date()` comparisons. Note it in the code (a short comment pointing to the helper) so future work inherits it.

## Scope
- Applies uniformly to **movies, ticketed events, and live performances**.
- Does **not** change past-event *visibility* (they can still be shown, e.g., dimmed on the calendar) — only the *purchase action* is removed.
- Staff POS: a past showing should likewise not be sellable through the POS (same server rule catches it); confirm the POS surfaces the "passed" state rather than erroring.

## Decisions for Tom
1. **Cutoff:** stop sales at `start_time` (recommended), at show end (`start_time + duration`), or a short grace window after start?
2. **Info‑only past events:** keep visible as archival pages (no action), or hide entirely once past?
3. **Message:** what the past state reads (e.g., "This showing has passed" / "Tickets are no longer available").

## Test plan
- A showing with `start_time` in the past shows **no** purchase/RSVP/film‑pass button on the Showing page, the drawer, and any list/calendar CTA — replaced by the "passed" state.
- **Direct API probe:** calling `ticket-checkout` (and `film-pass-checkout`) for a past showing is **rejected** with a clear error — proving the server, not just the UI, enforces it. (Guard against a stale tab / bypass.)
- A **future** showing is unaffected — buys normally.
- A showing that transitions past (crosses `start_time`) stops being purchasable at the chosen cutoff.
- Pass **redemption** against a past showing is refused.
- `npm run build` and checkout tests pass.
