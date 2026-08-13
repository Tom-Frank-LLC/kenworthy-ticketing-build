# Findings: film passes as physical, activated-on-handoff objects

**Implemented:** 2026-08-12 · **Status:** applied and verified on **staging**; **not applied to production**
**Brief:** `BRIEF-film-passes.md`

## Summary

The brief is implemented as written, with three corrections to its "current
state" section and one behaviour it did not anticipate. The load-bearing change
is that **a film pass no longer exists until a staff member scans a sticker in
front of the patron.** Everything else follows from that: online purchase
produces an obligation rather than a pass, expiry starts at handoff, and the
door scan is the only place a balance is ever spent.

---

## The brief was stale in three places

`BRIEF-film-passes.md` was written against the tree before
`20260812150000_square_ticket_payments.sql` landed. Checked before building:

| Brief says | Actually true |
|---|---|
| `user_film_passes` has "no `status`" | It has `status` with `CHECK (pending, active, failed, refunded)`, plus `price_paid`, `sold_by_user_id`, `square_payment_id`, `checkout_idempotency_key` |
| `FilmPassPOS.tsx:44-105` assigns walk-in passes to the staff member's own account | Already fixed — `film-pass-checkout` resolves the patron with `findOrCreateBuyer` and records the seller in `sold_by_user_id` |
| Step 3 "replaces the `FilmPassPOS` self-assignment bug" | It replaces a working flow. The bug was gone; what needed replacing was pass-creation-at-sale |

Consequence for the schema: `status` had to be **merged**, not added. Two
lifecycles now share one column and meet at the single value that is ever
spendable:

```
payment    pending ──> active ──> failed | refunded
physical   unassigned ──> active ──> depleted | expired | void
                              ▲
                    the only spendable state
```

The default moved from `active` to `unassigned`. Under the old model the only
way to create a pass was to sell one, so `active` was right; now it is the most
dangerous possible default, because an accidental insert would be funded money.

---

## What was built

| Piece | Where |
|---|---|
| Schema, two RPCs, eligibility trigger | `supabase/migrations/20260813000000_film_passes_physical.sql` |
| Blank sticker minting + reprint | `supabase/functions/film-pass-batch/index.ts` |
| Order / activate / admit / lookup / queue / void | `supabase/functions/film-pass-checkout/index.ts` |
| Order confirmation email (pure, tested) | `supabase/functions/_shared/pass_orders.ts` |
| Public purchase page | `src/pages/FilmPasses.tsx` → `/film-passes` |
| Printable sticker sheet | `src/components/admin/StickerSheet.tsx` |
| Batch printing, void, issued-pass list | `src/components/admin/FilmPassesTab.tsx` |
| Counter: queue, walk-in sale, activate-by-scan | `src/components/pos/FilmPassPOS.tsx` |
| Door: screening selector + `PASS:` branch | `src/pages/admin/TicketScanner.tsx` |

### Two moments are atomic, and they have to be

**`activate_film_pass`** — a blank acquires an owner and a balance *and* the
order that paid for it is discharged. As three PostgREST calls from an edge
function there is a window where the pass is funded but the order still reads as
owed, and the box office hands out a second one.

**`admit_with_film_pass`** — the seat is minted inside the same transaction as
the deduction. This is what makes a sold-out house safe: the capacity trigger
raises `PT409`, the whole transaction rolls back, and the pass keeps its money.
Verified below.

Both return a **verdict object rather than raising**, so the counter and the door
can be told *why* something was refused. An exception would reach the browser as
an opaque 500, and "not valid for this screening" versus "no balance left" send a
patron to two different conversations.

Both are `SECURITY DEFINER` and granted to `service_role` only. Combined with
`REVOKE INSERT, UPDATE, DELETE ON user_film_passes FROM authenticated`, there is
now **no path from any browser to a pass balance** — minting, activating,
spending and voiding all go through a function that has first checked who is
asking.

---

## Behaviour the brief did not anticipate

**The eleventh scan reports `not_active`, not `insufficient`.** A $60 pass at $6
admits exactly ten times; on the tenth the balance hits zero and the row flips to
`depleted`, because every read path filters on `status = 'active'` and a pass
that can no longer buy an admission must stop being offered as one. So the
eleventh scan is refused at the status check, before the balance check it never
reaches. The door renders that as **"This pass is used up"** rather than the
literal "not active", which would send staff hunting for a fault that is not
there. Covered by a test.

---

## Verification

### The lifecycle, against a replayed schema

All 66 repo migrations were replayed into a throwaway Postgres 15 (bootstrap
stubbing only what the hosted platform provides: the `auth` schema, the three API
roles, the JWT accessors, `pgcrypto` in `extensions`). One migration fails there
and is expected to — `20260812180000_showings_pacific_not_mountain.sql` asserts
against real showing data and aborts on an empty database.

21 checks, all passing:

```
PASS  1. event showing is ineligible even though the column defaults true
PASS  2. forcing an event eligible is refused by the trigger
PASS  3. blanks mint as unassigned with no owner and no balance
PASS  4. duplicate qr_code refused by the unique index
PASS  5. activation loads the balance and attaches the buyer (60 → 10 admissions)
PASS  6. the order that paid for it is discharged (fulfilled + pass linked)
PASS  7. expiry is measured from activation, not from the order
PASS  8. re-activating an active sticker is refused
PASS  9. an unknown code activates nothing
PASS 10. a walk-in bearer pass activates with no account (user_id NULL)
PASS 11. an eligible movie admits, deducts $6, mints a scanned ticket
PASS 12. a second scan at the same showing is refused, balance unchanged
PASS 13. an event refuses the pass and takes nothing
PASS 14. a $12 screening refuses the pass and takes nothing
PASS 15. no showing selected admits nobody
PASS 16. an unactivated blank does not admit
PASS 17. a $60 pass is exactly 10 admissions, then stops (balance 0, depleted)
PASS 18. an expired pass is refused and marked expired
PASS 19. a sold-out showing refuses with PT409
PASS 20. after the sold-out rollback the pass still holds $60 and is active
PASS 21. no ticket survived the sold-out rollback
```

Checks 19–21 are the ones worth keeping: they are the reason the ticket insert
sits *before* the deduction inside one transaction.

### Automated tests

- `supabase/functions/_shared/pass_orders_test.ts` — 14 Deno tests. Address
  validation, and the assertions that matter for the email: no `<img>`, the
  phrase "nothing to print", "cannot be used to book online", and that "about N
  films" is derived from the configured numbers rather than written as ten.
- `src/pages/admin/TicketScanner.test.tsx` — 14 vitest tests, 6 new for passes,
  including that a pass admission never touches `tickets.update`, that an
  ordinary ticket ignores the screening selector, and that no screening selected
  means no server call at all.
- Full suite: **43 passing**. `tsc --noEmit` clean. `build:staging` clean.

### On staging (`rpqzrpboyhshdrfdwayk`)

Migration applied, three functions deployed, Worker deployed. Every function
answered with its *own* JSON rather than a gateway error, which is what
distinguishes a live function from a dead one:

```
ticket-checkout   payment_method=film_pass   → 400  "redeemed in person at the door, not online"
ticket-checkout   bare pass_id               → 400  same
film-pass-checkout  action=purchase          → 410  "there is no digital pass to issue"
film-pass-checkout  action=staff_sale        → 410  same
film-pass-checkout  admit/activate/queue     → 401  "Staff sign-in required"
film-pass-checkout  void                     → 401  "Sign-in required"
film-pass-batch     create                   → 401  "Staff sign-in required"
```

RLS, as the anon role:

```
film_pass_types    200, returns the active types   (the /film-passes page needs this)
user_film_passes   content-range */0 — no rows     (a blank or bearer pass is not public)
film_pass_orders   401 — no anon grant at all
```

Eligibility backfill, over the 34 showings the anon role can see:

```
18 eligible · 16 not
 0 non-movie showings eligible
 0 eligible showings priced above $8
```

> The anon role does not see every showing, so these counts are a subset, not the
> whole table. The non-movie half of the rule does not depend on the count: it is
> enforced by `enforce_film_pass_eligibility()` on every insert and update, so a
> showing with no `movie_id` cannot be eligible however the flag is set. The
> price half is a one-time backfill plus a staff decision on the flag from here.

---

## Decisions taken

1. **Money balance, not a punch count.** As recommended. `initial_balance` and
   `redemption_price` are both configuration; a pass is worth
   `initial_balance / redemption_price` admissions and neither number appears in
   the scanner.
2. **Eligibility is an explicit flag.** `showings.film_pass_eligible`. Deriving
   it from `ticket_price = 8` would hide the rule and change its meaning the next
   time a price moves. The structural half — no movie, no eligibility — is a
   trigger, so it cannot drift.
3. **Bearer passes are allowed** (Tom's call). A walk-in who gives no contact
   details gets `user_id = NULL`; the paper is the credential, exactly as cash
   is. Contact details are optional at the counter and buy only the ability to
   void and reissue a lost pass.
4. **Dedicated `/film-passes` page**, public, no sign-in — the guest-ticket
   pattern.
5. **Posting is manual.** The platform records the address and the fulfilment
   state; there is no carrier integration.
6. **Void is admin-only and returns no money.** The balance stays visible on the
   row so what was killed is answerable; refunding is a decision at the till,
   and crediting a card this function never charged would be a lie.
7. **Legacy passes** (Tom's call): treated as test data. The rows are left alone.
   They carry no `qr_code`, so the door cannot find them, and the online
   redemption they were built for is gone — they are inert rather than deleted.

## Two things fixed that were not in the brief

**Pass income was about to be double-counted.** A door admission mints a ticket
at the screening's face value so the seat is counted for capacity and check-in.
`QboExportTab` sums `tickets.price` as income, so the same $60 would have been
booked once as a pass and again as ten $8 films. Film-pass tickets are now
skipped there.

**Pass income was also being booked at the wrong moment, and undercounted.** The
old aggregation read `user_film_passes` filtered to `status = 'active'` — which
now silently drops any pass sold and spent to nothing inside the same period.
Rewritten to book each sale once, when the money actually moved: online orders at
`film_pass_orders.created_at` for what was charged, counter sales at the pass's
activation for `price_paid`, with passes that discharged an order excluded from
the second pass so nothing is counted twice.

## Notes for whoever ships this to production

- **`tickets.user_id` is now nullable.** Only a bearer admission produces one. The
  SELECT policy is `user_id = auth.uid() OR is_admin()`, and NULL never equals
  anything, so those rows are admin-readable only — correct, since no patron
  account exists for them to belong to.
- **`user_film_passes` is no longer writable by `authenticated`.** Anything that
  used to write it from a browser will now fail silently under RLS. Nothing in
  the repo still does.
- **Staging carries `20260812190000_staff_can_read_and_check_in_tickets.sql`,
  which is not on `main`** — it lives on the unmerged `fix/staff-attendee-names`
  branch (`1ac6df3`). `supabase db push` refuses to run while a remote migration
  has no local file. It was temporarily materialised from that branch to push,
  then removed again. **Do not** `migration repair --status reverted` it: it is
  genuinely applied, and marking it reverted would hide a live RLS fix. Merge
  that branch before pushing to production, or materialise it the same way.
- **The `PASS:` prefix is load-bearing**, not decoration. It is what lets the
  scanner branch without querying both tables, and what lets the activation
  screen reject a ticket QR for the right reason.

## Not done

- **No production deploy.** Migration, functions and Worker are on staging only.
- **No end-to-end card test.** Square on staging is in sandbox; the order path
  was verified as far as its rejections and its boot, not through a real
  tokenised payment. Worth one sandbox purchase of each fulfilment kind before
  production.
- **No physical scan test.** The `PASS:` branch is covered by unit tests and the
  RPCs by database tests, but nobody has yet printed a sheet and pointed a phone
  camera at it. That is the one check that cannot be faked, and it should happen
  before launch.
