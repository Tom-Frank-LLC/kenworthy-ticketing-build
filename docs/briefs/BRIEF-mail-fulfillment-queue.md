# Brief: Mail fulfilment queue — a posted pass is not a mailed pass

**Status:** ✅ Shipped to production August 13 2026 — `999d5bb`, migration
`20260813210000`. Tom confirmed Mark posted works end to end. One item deferred,
see *Still open*.
**Date:** August 13, 2026
**Requested by:** Tom — "add a mail queue after activation for those passes, that doesn't leave the queue until the staff/admin user manually clicks it to confirm mailing."

> **In one line.** Activation currently discharges a mail order the moment a sticker is scanned, so the envelope disappears from every screen while it is still sitting on the desk. Add a **second queue** that a mail order enters *at activation* and leaves *only* when a human clicks **Mark posted** — tracked by a new `posted_at`/`posted_by` pair, not a new status — and email the buyer when they click.

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

## Decisions (from Tom — settled, build to these)

| Question | Answer |
|---|---|
| Backfill historical orders? | **No.** Only test data from today exists. |
| Undo window on Mark posted? | **No.** Recovery is manual. |
| Email the buyer on posting? | **Yes**, in phase 1. |
| Bulk "mark all posted"? | **No.** One click each. |
| Staleness nudge after N days? | Not settled — see *Still open*. |

**On recovery:** a mis-marked order is recovered the way a wrong pass already is — void the QR, activate and send a new one. That path exists today, so the queue does not need to reimplement it. Consequence: **Mark posted is irreversible**, which is what drives the confirm step below.

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
| Order-confirmation email builders (pure, tested) | `supabase/functions/_shared/pass_orders.ts` |
| **Accounting reads this table** | `src/components/admin/accounting/QboExportTab.tsx:108` |

---

## Data model

### Add columns — do **not** add a status

```sql
ALTER TABLE public.film_pass_orders
  ADD COLUMN IF NOT EXISTS posted_at  timestamptz,
  ADD COLUMN IF NOT EXISTS posted_by  uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS posted_notice_sent_at timestamptz,
  ADD COLUMN IF NOT EXISTS posted_notice_error   text;
```

**The mail queue is then:** `fulfillment = 'mail' AND status = 'fulfilled' AND posted_at IS NULL`.

**Why not a new status like `awaiting_post`?** Because `QboExportTab.tsx:108` reads

```js
.from('film_pass_orders').select(...).in('status', ['paid', 'fulfilled'])
```

A new status value would drop every awaiting-post order out of the QuickBooks revenue export — silently, with no error, showing up only as an unexplained shortfall in a month's numbers. Posting state is also genuinely orthogonal to payment state: an order can be paid-and-unposted or fulfilled-and-unposted, and forcing both onto one `status` ladder conflates money with logistics. A nullable timestamp is the smaller, safer change, and it carries *when* and *who* for free.

The last two columns mirror `confirmation_sent_at` / `confirmation_error`, which already exist on this table for the order-confirmation email. Same reasoning as the comment at `film-pass-checkout/index.ts:585`: the failure mode of a fire-and-forget send is silence, and silence here means a patron who was never told their pass shipped.

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

Column comments in the house style — the existing ones on this table carry the *why*, and the next person needs to know `posted_at` is not derivable from `fulfilled_at`.

### No backfill

Per Tom: production holds only today's test data, so there is no history to assert about. Any already-fulfilled mail test order will surface in the new queue as unposted — which is **useful**, not a defect: clearing those rows by hand is the feature's first smoke test, and it exercises the button against real rows before a real patron depends on it.

> ⚠️ Confirm the "test data only" assumption against production before deploying, with a privileged connection — per `docs/memory`, the anon key hides most rows, so an empty-looking result is not evidence. One `SELECT count(*) … WHERE fulfillment='mail' AND status='fulfilled'` is enough. If that count is surprisingly large, stop and revisit rather than shipping a queue full of strangers' orders.

> ⚠️ Per `docs/PLATFORM.md` §2.2, run the migration with an explicit `--project-ref`, staging first. Do not trust the CLI's current link.

---

## What to build

### 1. `mark_posted` action (edge function)

One new action in `film-pass-checkout`, alongside `queue` and `activate`. **No `unmark_posted`** — recovery is void-and-reissue.

```
POST { action: 'mark_posted', order_id } → { ok, posted_at, notice: 'sent' | 'failed' | 'no_email' }
```

- Gate with the existing `requireStaff()` (`index.ts:106`) — admin and superadmin already satisfy `staff` via the role hierarchy in `20260812063211_has_role_hierarchy.sql`, so no auth change is needed.
- **The write must go through the edge function's service-role client.** `film_pass_orders` grants `UPDATE` to `service_role` only; the sole RLS policy is `SELECT` for staff (migration `:275-286`). A browser-side `supabase.from('film_pass_orders').update(...)` is filtered to zero rows and **PostgREST answers 204, which supabase-js reports as success** — the button would light up green and change nothing. This exact failure is documented in `20260812063211_has_role_hierarchy.sql:11-14` and cost real data before.
- Validate the transition; reject with a named result rather than a bare 400, so the UI can say *why*: `not_a_mail_order`, `not_yet_activated`, `already_posted`.
- **Idempotent, and that now matters more than before.** Marking an already-posted order returns `already_posted`, does not overwrite `posted_at`/`posted_by`, **and does not re-send the email.** Two staff clicking at once must not mail the patron twice. Guard it in SQL, not in JS: make the UPDATE itself conditional —
  ```sql
  UPDATE film_pass_orders SET posted_at = now(), posted_by = $2
  WHERE id = $1 AND fulfillment = 'mail' AND status = 'fulfilled' AND posted_at IS NULL
  RETURNING id;
  ```
  Zero rows returned means somebody else already posted it; send nothing. A read-then-write in the function would race.

### 2. The "it's in the mail" email

Fires only on a transition that actually happened (the `RETURNING` above), after the row is written.

- Build the subject/HTML/text in `supabase/functions/_shared/pass_orders.ts` as pure functions next to `buildPassOrderSubject` / `buildPassOrderEmailHtml` / `buildPassOrderEmailText`, and unit-test them the same way. That module is already pure and Deno-tested; keep it that way.
- Send with `sendTransactionalEmail`, **fire-and-forget**: a Resend outage must not fail the mark-posted, exactly as at `film-pass-checkout/index.ts:580-600`. Write the outcome back to `posted_notice_sent_at` / `posted_notice_error`.
- Skip cleanly when `buyer_email` is null — return `notice: 'no_email'` and still mark it posted. A missing email is not a reason to keep an envelope in the queue.
- Content: what shipped (quantity × pass type), where it went (the address they gave), and that the pass is activated and ready to use at the door. Match the existing house rules for these emails — the tests in `pass_orders_test.ts` assert no `<img>`, so follow whatever constraints that file already encodes.

### 3. UI — both screens, both able to click

A **"To be posted"** card, below "Waiting to be handed over", in **both**:

- `src/components/pos/FilmPassPOS.tsx` — the counter
- `src/components/admin/FilmPassesTab.tsx` — the admin dashboard

Unlike activation, **the Mark posted button belongs in both places.** Activation is counter-only because it needs a blank sticker under a scanner; confirming a post needs nothing but a person who knows the envelope went out, and that person may well be an admin at a desk. Tom asked for "staff/admin user" explicitly.

Each row shows: buyer, quantity × pass type, the full `Post to:` address (reuse `formatMailingAddress` from `src/lib/passOrders.ts` — it is what gets copied onto the envelope), how long since activation, and a **Mark posted** button.

**A confirm step, because there is no undo.** Two of Tom's decisions combine here: the action is irreversible *and* it emails the patron. So a stray tap tells a real person their pass shipped when it did not, and the only repair is voiding the pass and reissuing. That earns one cheap guard — an **inline two-step button** (Mark posted → "Posted? Yes / Cancel" in place), not a modal. Inline keeps a batch of envelopes fast; a modal per row does not. This is the minimum that makes an irreversible outward-facing action deliberate.

Follow the error handling already in `FilmPassesTab`: a failed fetch must render as an error with a retry, **never** as an empty list. An empty "To be posted" card means "nothing to mail", and it must not be able to mean "the request failed".

### 4. Extend the `queue` action

Return both lists in one round trip; both screens want both:

```js
{ orders: [...],         // unchanged: status='paid', awaiting activation
  awaiting_post: [...] } // new: mail, fulfilled, posted_at IS NULL
```

Additive, so the existing `data.orders` readers keep working. Include `fulfilled_at` and the activating staff member on the new rows — "activated three weeks ago, still not posted" is the signal worth seeing. Sort oldest-first: the longest-waiting envelope is the most urgent.

---

## Still open

**Staleness nudge.** Not answered, and I am not inventing the threshold — a "warn after N days" with an N nobody chose is a magic number. Phase 1 shows the relative age plainly ("activated 3 days ago") with no colour change. If a number later proves itself from watching the queue, add the warning then.

---

## Risks

- **Nothing forces the click.** A staff member can mail the envelope and never mark it, or mark it and never mail it. The queue makes the omission *visible*, which is all it can do — it cannot make the record true. Worth stating in the runbook rather than pretending otherwise.
- **The email makes a misclick outward-facing.** Mitigated by the inline confirm and the SQL-level idempotency guard, not eliminated. Voiding and reissuing remains the repair.
- **A second queue is a second thing to ignore.** Two cards on one screen dilutes each. Mitigation: hide "To be posted" entirely when empty on the counter screen (where speed matters), keep it always visible with an explicit "nothing to post" in admin (where absence is the answer someone came for).
- **`updated_at` moves on marking.** The `film_pass_orders_updated_at` trigger (migration `:270`) fires on this UPDATE. Nothing reads `updated_at` today, but anything that later treats it as "when the money last changed" would be wrong.

---

## Test plan

**Pure/unit (vitest, `src/lib/`)** — queue partitioning and the "how long since activation" label; extend `src/lib/passOrders.test.ts`.

**Edge function (deno, `supabase/functions/_shared/`)** — the new email builders, asserted like the existing ones in `pass_orders_test.ts`; and the transition guard as a pure function: mail+fulfilled → ok; pickup → rejected; paid-not-activated → rejected; already-posted → no-op **and no second email**.
> Per `docs/PLATFORM.md`, `npm run build` and vitest cover `src/` **only**. Run `deno check` and `deno test --allow-env` on `supabase/functions/` separately, and `curl` the deployed function afterwards — a local pass cannot detect a dead deploy.

**Integration, against staging, with a real order:**
1. Buy a mail pass online → appears in "Waiting to be handed over".
2. Activate a sticker against it → **leaves** that queue, **appears** in "To be posted".
3. Confirm it is still there after a full page reload (this is the whole point).
4. Mark posted from the **admin** screen → leaves the queue; verify `posted_at`/`posted_by` are actually set by reading the row back, not by trusting the toast.
5. Confirm the email arrived, and that `posted_notice_sent_at` is set.
6. Click Mark posted again on the same order (via a second tab left open) → rejected as `already_posted`, **no second email**.
7. Repeat 1–4 from the **counter** screen.
8. Buy a **pickup** pass, activate → appears in neither queue; `mark_posted` on it is rejected.
9. An order with no `buyer_email` marks posted cleanly and reports `no_email`.
10. Confirm the QuickBooks export for the period still includes all of these orders (the regression the column-vs-status choice avoids).

---

## Sequencing

1. Migration (columns, constraint, index, comments) → staging. Check the mail/fulfilled row count on production first to confirm the no-backfill assumption.
2. Email builders + tests in `_shared/pass_orders.ts` (pure, no deploy needed to verify).
3. `mark_posted` + extended `queue` → deploy → `curl` it.
4. Admin UI, then counter UI.
5. Integration pass on staging with a real purchase.
6. Production: migration first, then function, then frontend — in that order, so the frontend never ships against a database that lacks the columns.

---

## What shipped, and where it lives

| Piece | File |
|---|---|
| Columns, constraint, partial index, no backfill | `supabase/migrations/20260813210000_mail_fulfillment_queue.sql` |
| `mark_posted` action + `queue` returning `awaiting_post` | `supabase/functions/film-pass-checkout/index.ts` |
| "It's in the mail" email (pure, Deno-tested) | `supabase/functions/_shared/pass_orders.ts` |
| The card, shared by counter and admin | `src/components/admin/MailQueueCard.tsx` |
| Age/label helpers (`describeAge`, vitest) | `src/lib/passOrders.ts` |

Built as specced, with one thing the spec did not anticipate:

**The plain-text email disagreed with the HTML.** The existing Deno suite asserts
the "cannot be used to book online" rule appears in *both* renderings of a pass
email. The new notice stated it only in the HTML, and the test caught it. Fixed
in the text builder rather than by relaxing the assertion — the rule is exactly
the thing a patron discovers at the door if the email omits it.

**Verification note for whoever ships the next change here:** the shared
`MailQueueCard` is imported by two lazily-loaded routes, so the bundler emits it
as its own chunk (`MailQueueCard-*.js`) rather than folding it into
`AdminDashboard-*.js` or `StaffPOS-*.js`. Grepping the route chunk for its
strings finds nothing and looks like a failed deploy. Grep the shared chunk.

## Still open

**Staleness nudge.** Unchanged from the spec above: the queue shows a plain
relative age ("activated 3 days ago") with no threshold and no colour, because
nobody has chosen the number of days at which an unposted envelope becomes
alarming. If watching the real queue produces that number, add the warning then.
