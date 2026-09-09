---
brief: past-event-graceful
title: Links to past showings land on a real page instead of a 404 or a silent bounce
status: built
track: bug
severity: P1
date: 2026-09-05
shipped_in: ["#299"]
verified: false
findings: FINDINGS-past-event-visibility.md
---

# Brief (for Claude Code): Past-event links shouldn't 404 — show a graceful "passed" page

**Status:** 🟡 Fixes a live bug (past-event links bounce/404). The real lever is a read-visibility decision on past-but-real showings, not a new page — the "passed" state already exists. Pairs with `BRIEF-listings-showtimes-on-showing-page.md`.
**Date:** September 5, 2026
**Requested by:** Tom — the team is getting 404s on links to past events. Bring the site to the industry-standard behavior: keep the URL alive at 200, show the event in a "this showing has passed" state with forward links, instead of erroring or bouncing.

## Diagnosis (verified) — it's a visibility bug, not a missing page
- **The "passed" state already exists.** `Showing.tsx` renders "This showing has passed." (L119) when a past showing loads, gated by `isPast(showing, production)` (L664). So the pattern is half-built and works *when the row loads*.
- **Past items are hidden from the public by RLS.** The anon SELECT policy on `showings` is `USING (is_active = true OR admin/staff)` (migration `20260402052528…`); `events` and `live_performances` have the same `is_active = true OR admin/staff` rule. Once a past showing or its production is set `is_active = false`, the public **cannot read the row at all**.
- **The empty read then bounces home.** `Showing.tsx:436` does `if (!s) { navigate('/'); return; }` — a **silent redirect to the home page** when the showing (or production) can't be read. That silent bounce is what the team is experiencing as a "404"/broken link. (It also reads to Google as a soft-404.)
- **Net:** the page *can* show "passed" — but deactivated/past items never load for the public, so it never gets the chance; the fallback dumps the visitor on the home page with no explanation.
- **Constraint to respect:** `is_active = false` is **also** how unpublished/draft items are hidden. Any visibility change must distinguish **"past but real"** (should stay viewable) from **"never published / draft"** (must stay hidden). Don't expose drafts.

## The change
### Part A — Keep past-but-real events publicly reachable (the cause)
Decide how a past item stays readable by the public so the "passed" page can render. **Decision 1:**
- **Option A1 (recommended):** **stop relying on `is_active=false` to hide past items.** Past showings/productions stay `is_active=true`; the calendar/feed already filter them out of listings **by date** (`isPast`/`useFeed`), so they don't clutter anything — they remain reachable only by direct link, which is exactly what shared/emailed/indexed links need. Simplest, and it keeps drafts (genuinely inactive, never-dated) still hidden.
- **Option A2:** broaden the anon read policy to allow a **past** row even when inactive — e.g. `USING (is_active = true OR start_time < now() ... OR admin/staff)` for showings, and an analogous "has a past showing" rule for productions. More surgical but trickier: it must not expose a draft that was never published, and productions don't have their own date (they inherit it from showings), so the production rule has to key off "has a past, real showing." Only take this if the theatre specifically wants to deactivate past items in admin yet keep them public.
- Recommend **A1** — it's the least code, avoids the draft-exposure trap, and matches how listings already hide past items (by date, not by flag).

### Part B — Replace the silent home-bounce with a real page (the symptom the team sees)
In `Showing.tsx`, change the `!s` fallback (L436) so a showing that can't be loaded no longer silently `navigate('/')`:
- **If the row exists but is past** (the normal case once Part A lets it load): render the existing **"This showing has passed"** state — but enrich it with **forward links**: the title's **upcoming showtimes** if any (reuse the sibling-showings query from `BRIEF-listings-showtimes-on-showing-page.md`), plus links to the **calendar** and home. Keep the poster/title/date-it-ran for context. Serve at HTTP 200 (it's a real page, not an error).
- **If the row is genuinely gone** (bad/deleted id — should be rare): show a graceful **"We couldn't find that showing"** state on the page (200, with the same forward links: calendar, what's on now, home) — **not** a redirect to home and **not** a soft "not found" dead end. **Decision 2:** a shared not-found/expired component for this case vs inline copy.
- Do **not** hard-404 these URLs (they were shared/indexed); do **not** silently redirect (confusing + soft-404).

### Part C — SEO alignment (small, ties to the SEO work)
- Past-event pages returning **200 with real content + forward links** are correct for SEO (they preserve shared-link and search value and are *not* soft-404s). This is consistent with `BRIEF-seo-phased.md`.
- Whatever Part A settles, make sure the **sitemap** logic (Phase 2 of the SEO brief) lists **current/upcoming** showings only — past ones stay reachable by direct link but needn't be advertised in the sitemap.

## Decisions for Tom
1. Visibility of past items: **keep them `is_active=true` and rely on date filtering** (recommended) vs broaden the RLS to allow past-inactive rows.
2. Genuinely-gone id: a **shared expired/not-found component** with forward links (recommended) vs inline copy on the showing page.
3. Forward links on the passed page: upcoming showtimes of the same title + calendar + home (recommended) vs just calendar/home.

## Test plan
- A link to a **past** showing (movie or event) loads a **200** page showing "This showing has passed," the title/poster/date it ran, and links to any upcoming showtimes of that title, the calendar, and home — **no bounce to the home page, no 404**.
- A link to a past **event/performance** behaves the same (all three production types).
- A genuinely bad/deleted showing id shows the graceful not-found state (200, forward links), not a silent home redirect.
- **Drafts stay hidden:** a never-published (inactive, no past showing) item is still not publicly readable — verify against the anon role.
- Listings/calendar still exclude past items by date (no clutter); the sitemap advertises only current/upcoming showings.
- `npm run build` + tests pass; add a test for the past-showing render path and the not-found fallback, and (if A2 chosen) an RLS test that a past real showing is readable by anon while a draft is not.

## Outcome (2026-09-09)

Decision 1 went to **Option A2**, not A1. The data made the difference:
1,755 of 1,787 past showings on staging are already inactive (the August
archive import), and production has the same shape. Keeping past rows active
would have meant flipping them all on, and `is_active = true` is what admin
screens use to mean "current". The anon read policy on `showings` now admits
`start_time < now()`; productions keep their `is_active` rule so a hidden
title stays hidden. Decision 2: shared `ShowingUnavailable` component.
Decision 3: upcoming showtimes + calendar + home. A genuinely missing id
keeps the Worker's 404 status, with the graceful page — a 200 there would be
the soft-404 this brief set out to remove. Full reasoning, measurements and
the production steps: `docs/briefs/FINDINGS-past-event-visibility.md`.
