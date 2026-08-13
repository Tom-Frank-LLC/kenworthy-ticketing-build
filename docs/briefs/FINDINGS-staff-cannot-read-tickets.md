# Findings: a staff-only account could sell tickets but not read them

**Investigated:** 2026-08-12 · **Status:** fixed, verified against Postgres 17.6
**Follows:** `FINDINGS-soldout-and-checkin-tracking.md` (whose diagnosis of this
was wrong — corrected in place)

## Summary

`tickets` has RLS with exactly two SELECT policies, and neither admits staff:

```sql
"Users can view own tickets"                 user_id = auth.uid()
                                               OR has_role(auth.uid(), 'admin')
"Hosts can view tickets for assigned events" (host assignment EXISTS ...)
```

`has_role` honours a hierarchy in which admin and superadmin satisfy `'staff'`,
but not the reverse. So an account holding only `staff` matches nothing and sees
**zero ticket rows** — while simultaneously being allowed to *insert* them via
`"Staff can sell tickets"`. The box office could write rows it could not read
back.

Nobody had noticed because the accounts in use also hold `admin`, which the
first policy admits. The failure appears the moment a genuine staff-only login
is used, which is the entire purpose of having the role.

## Correcting the earlier diagnosis

The previous findings document claimed the cause was that `is_admin()` reads
`profiles.role` while `has_role()` reads `user_roles`. **That was wrong.** It
came from reading the `tickets` table's *original* migration rather than the
current state.

`20260217193757` — the very next migration — did all of this:

```sql
DROP FUNCTION IF EXISTS public.is_admin();
ALTER TABLE public.profiles DROP COLUMN role;
...
CREATE POLICY "Users can view own tickets" ON public.tickets
  FOR SELECT USING (user_id = auth.uid() OR public.has_role(auth.uid(), 'admin'));
```

`is_admin` and `profiles.role` have not existed since. Confirmed by dumping the
live schema (`supabase db dump --linked`) and grepping: no `is_admin`, and 135
policies of which the two above are the tickets SELECT set.

**Lesson worth keeping:** reconstructing current RLS from a 60-file migration
history is unreliable — later migrations silently supersede earlier ones. Dump
the live schema and read that instead. It cost a wrong conclusion that was
published in a repo document and repeated to the user twice.

## What this broke

Every staff-operated surface, each failing quietly rather than erroring:

| Surface | Symptom |
| --- | --- |
| `TicketScanner` | lookup returns no row → **every valid QR reads "Ticket not found — invalid QR code"** |
| `StaffPOS` | `loadDailyStats` reads tickets; revenue and counts sit at 0 |
| `AdminDashboard` | sold and checked-in counts render `0 / capacity` |
| `AttendeeSheet` | attendee lists come back empty |
| `BoxOfficeReceiptsTab`, `AnalyticsTab`, `exportContacts` | same |

## The fix

### 1. Staff can read tickets

```sql
CREATE POLICY "Staff can view tickets"
  ON public.tickets FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'staff'::app_role));
```

Additive — policies are OR'd, so this only widens, and only to
staff/admin/superadmin. Whole rows deliberately: the surfaces above need
`showing_id`, `seat_id`, `status`, `scanned_at`, `total_price` and `user_id`.
That includes `qr_code` and `order_token`, which are bearer credentials for a
ticket, but staff already scan those codes and re-send tickets from the box
office, so it grants no capability the role does not already exercise.

### 2. Check-in as an operation, not a table write

The scanner also had to **write** `scanned_at`, and the only UPDATE policies are
for admins and for hosts of the showing. Staff were blocked there too — and an
UPDATE that RLS filters is not an error: PostgREST answers 204 and supabase-js
reports success. Check-in would have looked like it worked and recorded nothing.

The obvious patch — a staff UPDATE policy — is the wrong one. RLS cannot
restrict *columns*, and Supabase gives every logged-in user the same
`authenticated` database role, so column privileges cannot separate staff from
admin either. A blanket staff UPDATE would hand the box office the ability to
rewrite `price`, `status` and payment ids on a money table, when all it needs is
to stamp one timestamp.

So check-in became `check_in_ticket(p_qr_code text) RETURNS jsonb` —
`SECURITY DEFINER`, verdicts `valid | already_scanned | not_confirmed |
not_found | forbidden`. Two further defects closed as a consequence:

- **Double admission.** The scanner read `scanned_at`, decided the ticket was
  unused, then wrote — so two devices scanning one QR could both admit the
  holder. The function claims the check-in with a conditional
  `UPDATE ... WHERE scanned_at IS NULL`, so exactly one caller can win.
- **A refunded ticket used to scan as valid.** The old client path never checked
  `status` at all, and stamped the row as used regardless.

Refusal also no longer leaks: authorisation is decided *before* existence is
revealed, so an unauthorised caller gets `forbidden` whether or not the QR is
real and cannot probe for valid codes.

`RETURNS jsonb`, not `RETURNS TABLE`: plpgsql turns `RETURNS TABLE` column names
into variables, so outputs named `status` / `scanned_at` would have collided
with the real columns.

The audit trigger is untouched and still logs `tickets.scan` on the NULL → set
transition, attributed to `auth.uid()`, which reads the request's JWT claim and
is unaffected by `SECURITY DEFINER`.

## Verification

25 assertions against Postgres 17.6, using the **real** `has_role` and
`is_host_of_showing` extracted from a live schema dump rather than re-written.

Both fixes carry a control proving the mechanism is load-bearing:

```
staff sees tickets WITH the new policy .......... 3
CONTROL: staff saw nothing WITHOUT it .......... 0

concurrent scans of ONE ticket:
  new  check_in_ticket ....... valid: 1,  already_scanned: 9   (of 10)
  CONTROL old read-then-write  valid: 5,  already_scanned: 0   (of 5)
```

That control is the point of the whole exercise: the old pattern admitted **five
people on one ticket**.

Also covered: re-scan refused; whitespace-padded QR still scans; refunded ticket
refused *and not stamped*; unknown and NULL QR handled; regular user and
anonymous both refused identically on real and fake codes; an assigned host may
check in without being staff; a regular user's and a buyer's visibility
unchanged; and **staff still cannot UPDATE ticket rows directly**.

Client side: `TicketScanner` now calls only the RPC, and its test mock makes
`supabase.from` *throw*, so any future attempt to read the table from the
browser fails loudly instead of silently returning nothing. 41/41 tests pass,
`tsc` clean.

## Not done / follow-ups

- **Other tables may have the same shape.** This audited `tickets` only. Any
  table where staff operate but only an `admin` policy exists will fail the same
  silent way. A sweep of the 135 live policies for staff-operated tables is
  worthwhile.
- **`admin_audit_log` visibility** was not examined; staff may or may not need
  to see their own scan history.
- **Production Square is still in sandbox** (`SQUARE_ENV` absent → sandbox by
  design). Unrelated to this fix, still worth confirming as intentional.
