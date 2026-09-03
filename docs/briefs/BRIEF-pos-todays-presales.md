---
brief: pos-todays-presales
title: The box office can see today's presales, and the checkout panel stops being painted over
status: built
track: feature
severity: P2
date: 2026-09-02
verified: false
---

# Staff POS — "Today's Presales" tab, and the Tickets-tab scroll fix

Two changes to `/admin/pos`, requested together.

## Part A — Today's Presales

The door and will-call had no list. Staff could sell a ticket and scan a
ticket, but nothing on the POS answered "how many are coming to the 7 o'clock,
and who has already walked in" without leaving for the admin dashboard.

`src/components/pos/TodaysPresales.tsx` is a read-only panel: every showing on
today's schedule, sold and checked-in counts, and a button per showing that
opens the existing `AttendeeSheet` for the full roster. Check-in stays at the
scanner.

### Two things that were nearly wrong

**The showings list could not be reused.** `StaffPOS` loads showings with
`start_time >= now()`, because you cannot sell into a screening that has begun.
This panel needs the opposite: at 7 PM the most useful row is the 2 PM matinee
staff are still tearing tickets for. Reusing that list would have emptied the
panel out over the course of exactly the evening it exists for, and it would
have looked fine while doing it. The panel does its own day-scoped fetch.

**"Today" is a venue day, not a UTC day and not the viewer's day.**
`start_time` is a UTC instant, so on any evening show the UTC date has already
rolled to tomorrow while the venue is still in today. A naive
`new Date(); setHours(0,0,0,0)` is worse still — it builds midnight in the
*viewer's* zone, so a staff laptop set to Mountain starts the day an hour early
and pulls in the previous night's late show. Both bounds go through
`venueLocalToInstant`, and the day arithmetic runs on calendar components
rather than by adding 24h, so the two DST days come out right.

`TodaysPresales.test.tsx` pins this with a fixture time of 02:00 UTC on 2 Sep —
7 PM Pacific on 1 Sep — where the UTC and venue dates disagree. It asserts the
window sent to PostgREST is `2026-09-01T07:00Z .. 2026-09-02T07:00Z`, that an
already-started matinee survives, and that only `confirmed` tickets are counted
(a pending row is an unpaid hold that admits nobody; a refunded one has been
given back — either would overstate the house to the person on the door).

### Also

- `AttendeeSheet` gained a **Checked In** column, rendered in the venue's zone,
  and the CSV export gained the matching field. This was the one thing the
  brief asked for that the drawer did not already do, and it benefits the admin
  Listings drawer that also uses it.
- The tab strip goes to four columns (five with `CONCESSION_POS_ENABLED`) and
  one `max-w` step wider. The trigger reads **Today** and leads the strip — it
  is what the counter reads before it sells anything. The panel's own heading
  carries the full "Today's Presales" and the date. The tab *value* stays
  `presales`; it is not user-visible. Note the POS still *opens* on Tickets
  (`defaultValue="tickets"`) — selling is the primary job, so leading the strip
  did not change the landing tab.
- RLS was checked rather than assumed. `20260812190000_staff_can_read_and_check_in_tickets.sql`
  adds the `"Staff can view tickets"` SELECT policy and
  `20260814214233_rls_permissions_hardening.sql` carries the matching
  `GRANT SELECT ON public.tickets TO authenticated`. Both are needed — a policy
  can outlive its grant. Note that the comment at `StaffPOS.tsx:205`, which
  says the only SELECT policy on tickets is `user_id = auth.uid() OR is_admin()`,
  is stale history from before that migration.

## Part B — the Tickets-tab scroll

The right-hand column holds three cards — Patron Info, Payment, Order Summary —
and **only the first was `sticky top-20`**. A sticky element is painted before
siblings that come after it in the same stacking context, so Patron Info pinned
partway down and the two later cards then slid over the top of it. That is the
reported "scrolls partway, then the rest scrolls over it".

**The fix is to remove `sticky` entirely** (Tom's call, and the right one). The
obvious alternative — make the whole column one sticky block — trades the bug
for a worse one: a real order carries several seat lines, tax, a card
processing fee, a donation prompt and then the Sell button, which is taller
than a laptop viewport. Pinning that column puts the **Sell button off-screen
with no way to reach it**, and the Sell button is the single most important
control on the page. Keeping it sticky would have needed a viewport height cap
plus an internal scroll; the counter flow is short enough that it can simply
scroll.

## Verification

- `npx tsc -p tsconfig.app.json --noEmit` clean.
- `npx vitest run` — 58 files, 748 passed, 2 skipped.
- `npm run build:production` clean; `Presales` present in the emitted
  `StaffPOS` chunk.
- Not yet exercised against a signed-in staff account in a browser — the POS is
  role-gated and needs a deployed branch to reach. The counts, the day window
  and the empty state are covered by the unit tests above; what remains unseen
  is the rendered layout.
