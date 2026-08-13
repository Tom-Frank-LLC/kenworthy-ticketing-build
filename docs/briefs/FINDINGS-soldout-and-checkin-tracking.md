# Findings: sold-out handling and check-in tracking

**Investigated:** 2026-08-12 · **Status:** implemented, verified against a throwaway Postgres; **not yet applied to staging or production**
**Brief:** `BRIEF-soldout-and-checkin-tracking.md`

## Summary

The brief was written before `BRIEF-square-ticket-payments.md` landed and is
stale in most of Part A: the server-side capacity check, the friendly seat
conflict message, and the `status='confirmed'` filter it asks for all already
exist. What it missed is a larger defect underneath the one it described.

**The customer-facing availability numbers were not merely advisory — they were
always empty.** `tickets` has RLS with one SELECT policy, and it restricts every
row to its own buyer. So the seat map and the "N tickets available" counter,
both of which read `tickets` directly from the browser, returned zero rows for
every anonymous visitor. `ticketsSold` was permanently 0 and `takenSeatIds`
permanently empty.

That reframes the brief's item 2. A "Sold Out" badge driven off `gaAvailable`
would have been decoration on a number that could never move. The badge needed a
data source before it needed a design.

## What was confirmed, and how

### Part A item 1 — capacity *is* checked server-side, but not atomically

`ticket-checkout/index.ts:198-207` already refuses an order exceeding
`total_seats`, and `:186-194` already returns a friendly 409 for a taken seat.
The brief's "capacity is enforced nowhere" no longer holds.

What remains is that the check is a `SELECT count(*)` followed by an `INSERT`,
which is correct only if nobody inserts in between. Reproduced directly, with
the application-level check transliterated into a trigger with the row lock
removed, two buyers submitting together for one remaining seat:

```
CONTROL (lock-free guard):     confirmed tickets sold into a 1-seat house = 2
SHIPPED (SELECT ... FOR UPDATE): confirmed tickets sold into a 1-seat house = 1
                                 buyer B was refused (PT409)
```

The control run is the point: it shows the race is real and reproducible, so the
lock is load-bearing rather than defensive decoration.

Three further paths inserted tickets with **no** capacity check at all —
`StaffPOS.tsx` (box office), `HostDashboard.tsx` (comps), and film-pass
redemption. A trigger covers all four paths, including any added later.

### The RLS defect (not in the brief — the actual cause of "no sold-out state")

The only SELECT policy on `tickets`:

```sql
USING (user_id = auth.uid() OR public.is_admin())
```

For an anonymous visitor `auth.uid()` is NULL, so `user_id = NULL` evaluates to
NULL — never true — and `is_admin()` is false. Verified as the anon role against
both projects before any code was written:

| request                        | result                       |
| ------------------------------ | ---------------------------- |
| `GET /rest/v1/tickets?select=id`  | empty, zero-row content-range |
| `GET /rest/v1/showings?select=id` | `0-0/34`                      |

The control request is what makes this conclusive: the key works and the
database has data, so the empty ticket result is the policy and not an empty
table.

Consequences, both silent:

- **`Showing.tsx`** — the quantity ceiling never engaged, and the seat map
  offered seats that were already sold. A buyer could pick a sold seat and only
  find out at checkout.
- **`StaffPOS.tsx`** — worse. `is_admin()` reads `profiles.role`, a *different
  table* from the `user_roles` that `has_role()` and every staff policy use. A
  staff-only account therefore sees none of the sales it just rang up.

### Part B — `scanned_at` was simply never fetched

Confirmed as described. The scanner writes it (`TicketScanner.tsx:107-110`) and
a DB audit trigger logs it; the dashboard's query just never selected it. The
brief's suggested cleanup (filter `status='confirmed'`) was already done.

## What changed

**`migrations/20260812170000_showing_capacity_enforcement.sql`** (new)

- `ticket_hold_window()` — the 15-minute pending-hold cutoff, defined once so
  the guard and the display cannot drift apart.
- `showing_availability(uuid)` — `SECURITY DEFINER`, returns capacity, held,
  remaining and occupied seat ids. Aggregates and seat ids only; no buyer,
  contact or price data. This is deliberately *not* a new RLS policy on
  `tickets`: the client needs two numbers, not read access to ticket rows.
- `enforce_showing_capacity()` + `zz_enforce_showing_capacity_on_insert` — a
  `BEFORE INSERT` trigger that locks the showing row and refuses a GA ticket
  that would oversell. Raises `PT409`.
- Index on `tickets (showing_id, status)`, because the trigger counts inside a
  critical section.

Two deliberate scope limits, both documented in the migration:

- **GA only.** Assigned seating is already bounded by the seat map and by
  `UNIQUE(showing_id, seat_id)`. Enforcing a count there would *break* those
  showings: `total_seats` defaults to 200 while the Main Theater has 265 seats,
  so seats 201-265 would become unsellable on any showing whose capacity was
  never edited.
- **`zz_` prefix.** Triggers fire in alphabetical order and this one reads
  `NEW.status`, which `enforce_ticket_pricing_on_insert` is what finally sets.
  The prefix is the mechanism, not a naming preference.

**`src/lib/availability.ts`** (new) — shared `fetchShowingAvailability()` used by
both the customer page and the POS.

**`src/pages/Showing.tsx`** — availability now comes from the RPC; real Sold Out
UI (title badge, ticket picker, order summary; the seat map stays visible when
full because seeing every seat greyed out explains the state better than hiding
it); on any availability rejection the page re-reads availability and trims the
selection, instead of leaving the buyer to retry an identical order.

**`src/pages/admin/StaffPOS.tsx`** — same RPC, fixing box-office availability for
staff-only accounts.

**`ticket-checkout/index.ts`** — maps `PT409` and `23505` on the pending insert
to a 409 with a real message. Previously a seat lost in the race between the
advisory check and the insert reached the buyer as an opaque 500. Nothing is
charged at that point; the card is not touched until after the insert.

**`src/pages/admin/AdminDashboard.tsx`** — fetches `scanned_at`, computes
check-in counts per showing/event/concert, renders `sold / capacity · N in`. The
figure is hidden at zero so future showings don't all read "· 0 in", and the
badge switches variant when a showing is full.

**`src/integrations/supabase/types.ts`** — hand-added the `showing_availability`
signature. Regenerate from the database once the migration is applied.

## Verification

All 19 behavioural assertions pass against Postgres 17.6, plus the race above.
Harness: a stub schema mirroring the real `showings`/`tickets` column
definitions, then the migration file applied unmodified.

Covered: the brief's `total_seats = 2` test (third sale refused with the right
message); a 3-ticket order into 2 remaining seats rolling back entirely rather
than partially filling; fresh pending rows holding a seat and expired ones
releasing it; refunded/failed rows not consuming capacity; assigned seats
selling past `total_seats`; the same seat refusing to sell twice; every
`showing_availability` field; and an already-oversold showing clamping to 0
rather than reporting negative availability.

`PT409 -> HTTP 409` was verified through a real PostgREST rather than assumed,
since the claim that StaffPOS and HostDashboard need no error-handling code
depends on it:

```
POST /tickets  (2nd GA ticket into a 1-seat house, as anon)
HTTP STATUS: 409
{"code":"PT409","message":"Sold out: all 1 seats for this showing are already
 sold or on hold.","hint":"Increase this showing's capacity if..."}
```

`npx tsc --noEmit` is clean for these changes, and `vitest` passes 37/37. The two
remaining tsc errors are pre-existing, in the untracked
`src/hooks/useAdminListings.ts` from the mobile-optimization work.

## Not done / follow-ups

- **Not deployed.** No migration was pushed and no function was redeployed. The
  trigger changes sell behaviour, so it wants a deliberate staging pass first —
  in particular against a real assigned-seating showing, which the stub schema
  can only approximate.
- **`is_admin()` reads `profiles.role` while `has_role()` reads `user_roles`.**
  This is a latent bug well beyond this brief: it governs who can read tickets
  at all. The dashboard evidently works today, so the admin accounts in use have
  `profiles.role = 'admin'` set. Worth an audit; deliberately not touched here.
- **Comps cannot exceed capacity.** A sold-out showing now refuses even a staff
  comp, with a hint to raise the showing's capacity. That is the honest
  behaviour, but if the box office needs press/comp seats above the house count,
  it wants an explicit override rather than a silent exemption.
- **`total_seats` still lives on `showings`** while venues carry their own
  capacity fields. The 200-vs-265 mismatch that forced the GA-only scope is a
  symptom of that split.
