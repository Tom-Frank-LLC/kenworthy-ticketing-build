# Brief: Mail fulfilment queue — a posted pass is not a mailed pass

**Status:** 🟡 Spec for review — no code written yet
**Date:** August 13, 2026
**Requested by:** Tom — "add a mail queue after activation for those passes, that doesn't leave the queue until the staff/admin user manually clicks it to confirm mailing."

> **In one line.** Activation currently discharges a mail order the moment a sticker is scanned, so the envelope disappears from every screen while it is still sitting on the desk. Add a **second queue** that a mail order enters *at activation* and leaves *only* when a human clicks **Mark posted** — tracked by a new `posted_at`/`posted_by` pair, not a new status.

---

## The problem, precisely

Two facts combine badly:

1. `activate_film_pass` sets `status = 'fulfilled'` on the order as soon as a blank sticker is scanned against it — for pickup and mail alike, with no distinction (`supabase/migrations/20260813000000_film_passes_physical.sql:451-455`).
2. The box office queue selects `status = 'paid'` (`supabase/functions/film-pass-checkout/index.ts:132`).

So the instant a staff member activates a mail order's sticker, the row leaves the queue — and with it every trace that an envelope is owed. `fulfilled_at` timestamps the *scan*, not the *post*. Nothing in the schema or the UI can currently answer **"did we actually mail it?"**

That is the same failure the queue was built to prevent, one step later in the flow. From the queue's own code comment (`film-pass-checkout/index.ts:119-122`):

> Every row here is a person waiting. Without somewhere to see them, a paid online order is an obligation with no reminder attached, and the way that fails is quietly — weeks later, as "I paid for this and never got it".

For a pickup order, activation genuinely *is* the handoff — the patron is standing there. For a mail order it is the midpoint, and today the two are modelled identically.

---

## Current state (file:line — what we build on)

| Thing | Where |
|---|---|
| `film_pass_orders` table + status CHECK | `supabase/migrations/20260813000000_film_passes_physical.sql:218`, constraint at `:245` |
| Activation discharges the order | same file, `activate_film_pass` at `:344`, the order UPDATE at `:451` |
| Outstanding queue (`status='paid'`) | `supabase/functions/film-pass-checkout/index.ts:123-150` |
| Activate action | `supabase/functions/film-pass-checkout/index.ts:241` |
| Counter UI (queue + activate) | `src/components/pos/FilmPassPOS.tsx` |
| Admin UI (queue, read-only) | `src/components/admin/FilmPassesTab.tsx` |
| Shared address/label helpers | `src/lib/passOrders.ts` (+ tests) |
| **Accounting reads this table** | `src/components/admin/accounting/QboExportTab.tsx:108` |

---

## Data model

### Add two columns — do **not** add a status

```sql
ALTER TABLE public.film_pass_orders
  ADD COLUMN IF NOT EXISTS posted_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
```

**The mail queue is then:** `fulfillment = 'mail' AND status = 'fulfilled' AND posted_at IS NULL`.

**Why not a new status like `awaiting_post`?** Because `QboExportTab.tsx:108` reads

```js
.from('film_pass_orders').select(...).in('status', ['paid', 'fulfilled'])
```

A new status value would drop every awaiting-post order out of the QuickBooks revenue export — silently, with no error, showing up only as an unexplained shortfall in a month's numbers. Posting state is also genuinely orthogonal to payment state: an order can be paid-and-unposted or fulfilled-and-unposted, and forcing both onto one `status` ladder conflates money with logistics. A nullable timestamp is the smaller, safer change, and it carries *when* and *who* for free.

Guard the invariant rather than leaving it implied:

```sql
ALTER TABLE public.film_pass_orders
  ADD CONSTRAINT film_pass_orders_posted_is_mail
  CHECK (posted_at IS NULL OR fulfillment = 'mail');
```

Partial index for the queue read:

```sql
CREATE INDEX IF NOT EXISTS film_pass_orders_awaiting_post_idx
  ON public.film_pass_orders (fulfilled_at)
  WHERE fulfillment = 'mail' AND posted_at IS NULL;
```

Column comments, in the house style — the existing ones on this table carry the *why*, and the next person needs to know these two are not derivable from `fulfilled_at`.

### Backfill — decide this deliberately

Any mail order already `fulfilled` before this migration has `posted_at IS NULL`, so **on deploy every historical mail order appears in the new queue as unposted**. Those passes were almost certainly mailed; staff had no way to record it.

**Recommendation:** backfill in the same migration, so the queue is empty on arrival and only new activations populate it.

```sql
UPDATE public.film_pass_orders
SET posted_at = fulfilled_at, posted_by = fulfilled_by
WHERE fulfillment = 'mail' AND status = 'fulfilled' AND posted_at IS NULL;
```

This asserts something we cannot verify. It is still the right call: the alternative is a launch-day queue full of rows nobody can act on, which trains staff to ignore it — and a queue people ignore is worse than no queue. **Count the affected rows before running it** (production may have very few; the film-pass feature is new), and if the count is small enough to check by hand, do that instead.

> ⚠️ Per `docs/PLATFORM.md` §2.2, run this with an explicit `--project-ref`, staging first. Do not trust the CLI's current link.

---

## What to build

### 1. `mark_posted` action (edge function)

New action in `film-pass-checkout`, alongside `queue` and `activate`:

```
POST { action: 'mark_posted', order_id }   → { ok, posted_at }
POST { action: 'unmark_posted', order_id } → { ok }
```

- Gate with the existing `requireStaff()` (`index.ts:106`) — admin and superadmin already satisfy `staff` via the role hierarchy in `20260812063211_has_role_hierarchy.sql`, so no auth change is needed.
- **The write must go through the edge function's service-role client.** `film_pass_orders` grants `UPDATE` to `service_role` only; the sole RLS policy is `SELECT` for staff (migration `:275-286`). A browser-side `supabase.from('film_pass_orders').update(...)` is filtered to zero rows and **PostgREST answers 204, which supabase-js reports as success** — the button would light up green and change nothing. This exact failure is documented in `20260812063211_has_role_hierarchy.sql:11-14` and cost real data before.
- Validate the transition: reject unless the row is `fulfillment='mail'` and `status='fulfilled'`. Return a named result (`not_a_mail_order`, `not_yet_activated`, `already_posted`) rather than a bare 400 — the counter needs to say *why*.
- Make it idempotent: marking an already-posted order returns `already_posted` and does not overwrite the original `posted_at`/`posted_by`. Two staff clicking at once must not rewrite history.

### 2. Extend the `queue` action

Return both lists in one round trip; both screens want both:

```js
{ orders: [...],        // unchanged: status='paid', awaiting activation
  awaiting_post: [...] } // new: mail, fulfilled, posted_at IS NULL
```

Additive, so the existing `data.orders` readers keep working. Include `fulfilled_at` and the activating staff member on the new rows — "activated three weeks ago, still not posted" is the signal worth seeing. Sort oldest-first: the longest-waiting envelope is the most urgent.

### 3. UI — both screens, both able to click

A **"To be posted"** card, below "Waiting to be handed over", in **both**:

- `src/components/pos/FilmPassPOS.tsx` — the counter
- `src/components/admin/FilmPassesTab.tsx` — the admin dashboard

Unlike activation, **the Mark posted button belongs in both places.** Activation is counter-only because it needs a blank sticker under a scanner; confirming a post needs nothing but a person who knows the envelope went out, and that person may well be an admin at a desk. Tom asked for "staff/admin user" explicitly.

Each row shows: buyer, quantity × pass type, the full `Post to:` address (reuse `formatMailingAddress` from `src/lib/passOrders.ts` — it is what gets copied onto the envelope), how long since activation, and a **Mark posted** button.

**Undo, not a confirm dialog.** A modal on every envelope is friction on a task done in batches; an undo on a misclick is cheap. After marking, leave the row in place for the rest of the session showing "Posted just now · Undo" (calling `unmark_posted`), and drop it on next load. A misclick that silently hides an unposted envelope is the one failure this whole feature exists to prevent — it must be recoverable without a database round trip through an engineer.

Follow the error handling already in `FilmPassesTab`: a failed fetch must render as an error with a retry, **never** as an empty list. An empty "To be posted" card means "nothing to mail", and it must not be able to mean "the request failed".

### 4. Optional — tell the buyer (phase 2, only if wanted)

`sendTransactionalEmail` and the builders in `supabase/functions/_shared/pass_orders.ts` are already there, so a "your pass is in the mail" note on `mark_posted` is a small addition. Deliberately **not** in phase 1: it changes what patrons receive, and the queue is useful without it. Decide separately.

---

## Open decisions (for Tom)

1. **Backfill:** set `posted_at = fulfilled_at` on existing fulfilled mail orders (recommended), or start them all in the queue and clear them by hand?
2. **Undo window:** session-only (recommended), or should an admin be able to un-post an order from any day — say, if a returned envelope comes back?
3. **Staleness nudge:** should a row activated more than N days ago render as a warning? If yes, what is N — 3 days? 7?
4. **Buyer email on posting:** yes, no, or later?
5. **Bulk action:** worth a "mark all posted" for a mailing run of several, or is one click each fine at this volume?

---

## Risks

- **Backfill asserts an unverified fact.** Covered above. Count first.
- **A second queue is a second thing to ignore.** Two cards on one screen dilutes each. Mitigation: hide the "To be posted" card entirely when empty on the counter screen (where speed matters), and keep it always visible with an explicit "nothing to post" in admin (where absence is the answer someone came for).
- **Nothing forces the click.** A staff member can mail the envelope and never mark it. The queue makes the omission *visible*, which is all it can do — it cannot make the record true. Worth stating plainly in the runbook rather than pretending otherwise.
- **`updated_at` moves on marking.** The `film_pass_orders_updated_at` trigger (migration `:270`) fires on this UPDATE. Nothing reads `updated_at` today, but anything that later treats it as "when the money last changed" would be wrong.

---

## Test plan

**Pure/unit (vitest, `src/lib/`)** — queue partitioning and the "how long since activation" label; extend `src/lib/passOrders.test.ts`.

**Edge function (deno, `supabase/functions/_shared/`)** — the transition guard as a pure function: mail+fulfilled → ok; pickup → rejected; paid-not-activated → rejected; already-posted → idempotent no-op.
> Per `docs/PLATFORM.md`, `npm run build` and vitest cover `src/` **only**. Run `deno check` and `deno test --allow-env` on `supabase/functions/` separately, and `curl` the deployed function afterwards — a local pass cannot detect a dead deploy.

**Integration, against staging, with a real order:**
1. Buy a mail pass online → appears in "Waiting to be handed over".
2. Activate a sticker against it → **leaves** that queue, **appears** in "To be posted".
3. Confirm it is still there after a full page reload (this is the whole point).
4. Mark posted from the **admin** screen → leaves the queue; verify `posted_at`/`posted_by` are actually set by reading the row back, not by trusting the toast.
5. Undo → returns to the queue.
6. Repeat step 4 from the **counter** screen.
7. Buy a **pickup** pass, activate → appears in neither queue. Confirm `mark_posted` on it is rejected.
8. Confirm the QuickBooks export for the period still includes all of these orders (the regression the column-vs-status choice avoids).

---

## Sequencing

1. Migration (columns, constraint, index, comments) → staging, with the row count checked before the backfill.
2. `mark_posted` / `unmark_posted` + extended `queue` → deploy → `curl` it.
3. Admin UI, then counter UI.
4. Integration pass on staging with a real purchase.
5. Production: migration first, then function, then frontend — in that order, so the frontend never ships against a database that lacks the columns.
