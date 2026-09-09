# Findings: why links to past showings answered 404, and what was changed

**Date:** 2026-09-09
**Brief:** `docs/briefs/BRIEF-past-event-graceful.md`

## What the team saw

A shared link to a showing that had already played answered 404 on
kenworthy.org, or (before the Worker took over the shell) bounced to the
home page with no explanation.

## What was actually happening

Three layers, and the brief's diagnosis had the middle one right:

1. **The page could already render a past showing.** `Showing.tsx` has a
   "This showing has passed" state, with the run's remaining dates beneath
   it. It works whenever the row loads.
2. **The row did not load for the public.** The anon read policy on
   `showings` was `is_active = true OR admin/staff`. A hidden showing is
   invisible to the anon key — to the browser and to the Worker alike.
3. **Both layers then failed silently.** `worker/index.ts` answers 404 when
   the anon read returns nothing (correct for a bad id, wrong for a hidden
   past one). The SPA did `navigate('/')`, a redirect with no sentence.

## What the data showed (the part the brief did not know)

The brief's recommended fix assumed past showings stay `is_active = true`
and only need to be filtered out of listings by date. They do not stay
active. Measured with a privileged read on staging, 2026-09-09:

| past showings | is_active | created | tickets sold |
|---|---|---|---|
| 1,755 | false | all August 2026 | none |
| 32 | true | August–September 2026 | 8 of them |

Every showing that sold a ticket through this platform is still active.
Every hidden past showing is an archive-import row — real dates and times
(827 of them at 7 pm), no sales. Production has the same shape: the anon key
sees 70 showings in total and the earliest visible past one is 14 Aug 2026,
so roughly 1,700 archive rows are hidden there too. A past showing that *is*
active already answered 200 on kenworthy.org before this change, in the
passed state.

So the broken links are links to hidden rows, and "keep past rows active"
would have meant flipping ~1,755 rows on in production.

## The decision: widen the read rule, not the flag

The brief's Option A2. The anon SELECT policy on `showings` is now:

```
is_active = true OR start_time < now() OR admin OR staff
```

Migration `20260909180838_showings_past_readable_by_anon.sql`. Why this over
flipping the flag (Option A1):

- **`is_active = true` means "current" to admin screens.** `docs/TASKS.md`
  records the Listings tab filtering on it as "small, uncapped", and a dozen
  admin queries do the same, with PostgREST's silent 1,000-row cap behind
  them. Turning 1,755 archive rows on would have changed what all of them
  return. The policy change alters none of those queries.
- **It is one reversible statement.** A data flip needs its own record to be
  undone; a policy is re-created from the previous migration.
- **Productions are untouched.** `movies`, `events` and `live_performances`
  still require `is_active = true`. A hidden *title* stays hidden, and its
  showing page renders the not-found state.

What it exposes: a never-published showing whose date has passed becomes
readable by direct link (by UUID only — every listing filters by flag and
date). A1 would have exposed exactly the same rows.

## The page

`Showing.tsx` no longer calls `navigate('/')`. Two states:

- **Past showing** (readable now): the existing passed state, with a second
  forward link to the calendar beside "See what's playing now", and the
  run's upcoming dates beneath when there are any.
- **Unreadable** (deleted, mistyped, or its title hidden): a new shared
  `ShowingUnavailable` component — "We couldn't find that showing", with the
  same two links, `noindex`.

The Worker still answers **404 for a genuinely missing id**, which is a
deliberate departure from the brief's "200 with not-found copy". A 200
carrying "not found" content is the definition of the soft-404 the brief set
out to avoid; an honest 404 with a helpful page is the industry-standard
shape. Past-but-real showings are the ones that matter, and those are 200.

Sitemap (Part C) needed no change: `worker/data.ts` already lists only
active showings from the last 30 days forward.

## Verification

On staging, after the push:

- `pg_policies` shows the new qual on `showings`.
- As `anon` (via `SET LOCAL ROLE` inside a rolled-back plpgsql probe): a
  freshly inserted future inactive showing → **0 rows**; an existing past
  inactive showing → **1 row**; upcoming active showings → unchanged (9).
  No probe rows remained.
- Anon REST returns a hidden past film and a hidden past event by id.
- The staging Worker serves both at **200** with the real `<title>`.
- `src/pages/Showing.test.tsx`: passed state renders with both links and no
  redirect; missing row renders the not-found state; readable showing with a
  hidden title renders not-found. All three fail against the previous page.

## To make it live

1. Apply the migration to production. `supabase db push` against
   `vlmslygnimfbamrtwvyo` (this session could not: privileged prod SQL is
   classifier-blocked). Verify with an anon REST read of any pre-Aug-14
   showing id.
2. Deploy the frontend (`wrangler deploy` after `build:production`) so the
   SPA renders the not-found state instead of bouncing. The Worker needs no
   code change: once the policy is on production it serves past showings
   at 200 by itself.

Step 1 alone fixes the shared links. Step 2 fixes the silent bounce for
ids that are genuinely gone.
