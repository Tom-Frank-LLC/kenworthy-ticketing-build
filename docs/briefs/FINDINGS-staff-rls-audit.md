# Audit: what else fails for a staff-only account

**Audited:** 2026-08-12 · **Status:** the one defect found is fixed in `20260813010000_staff_and_hosts_can_see_attendee_names.sql`
**Scope:** all 43 RLS-enabled tables in `public`, cross-referenced against staff-reachable UI
**Method:** live schema dump → restored into a throwaway Postgres → classified from `pg_policies` (not regex) → intersected with client code → confirmed empirically

## Answer

**One real defect: `profiles`.** Everything else that locks staff out is either
correct by design or not exercised by any staff-reachable code path.

`profiles` SELECT is own-row-or-admin:

```sql
"Users can view own profile"     (id = auth.uid()) OR has_role(auth.uid(),'admin')
"Superadmins view all profiles"  has_role(auth.uid(),'superadmin')
```

Confirmed empirically against the real policies, with the patron row proven to
exist:

```
profiles visible to a staff-only account: 1  (of 2 — its own row only)
as postgres, the patron row does exist:   1
the PATRON row visible to staff:          0   <-- attendee names come from here
```

This is the same shape as the `tickets` bug just fixed: staff operate the
surface, but only `admin` is named in the policy.

### What it breaks (all staff-reachable, all silent)

| Surface | Reachable via | Symptom |
| --- | --- | --- |
| `AttendeeSheet.tsx:78` | AdminDashboard (`isStaff`) → ticket-count badge | embeds `profiles(display_name, email, phone)`; every attendee renders **"Unknown"** with no email or phone |
| `lib/exportContacts.ts:32` | AdminDashboard listings (ungated) | queries `profiles` directly; CSV exports lose **all** names and emails |
| `DvdLibraryTab.tsx:51,192` | AdminDashboard tab (ungated) | embeds `profiles(display_name, email)`; every renter shows as **"member"** — *not fixed, see below* |
| `HostDashboard.tsx:526` | host dashboard (`isHost`) | read `profiles` directly; every attendee showed as **"Guest"**. Found while implementing the fix — hosts had the same defect |

None error. PostgREST applies RLS to *embedded* resources too, so the join
simply returns `null` and each call site falls through to its placeholder.

The attendee list is the worst of the three — it is the door list, and a
staff-only account sees a roster of "Unknown".

## The staff-access matrix

`staff` = a policy names the staff role · `own` = own rows only · `host` =
assigned hosts only · `NO` = admin/superadmin only · `-` = no policy
(service_role only)

```
table                             SELECT   INSERT   UPDATE   DELETE
account_mappings                  ALL      NO       NO       NO
admin_audit_log                   staff    staff    -        -
app_config                        NO       NO       NO       -
chart_of_accounts                 ALL      NO       NO       NO
concession_combo_items            ALL      NO       NO       NO
concession_items                  staff    NO       NO       NO
concession_menus                  staff    NO       NO       NO
concession_sale_items             staff    staff    -        NO
concession_sales                  staff    staff    NO       NO
donations                         own      own      -        -
dvd_rentals                       staff    staff    staff    staff
dvd_settings                      ALL      NO       NO       NO
dvds                              staff    staff    staff    staff
events                            staff    NO       host     NO
film_pass_redemptions             -        -        -        -
film_pass_types                   staff    NO       NO       NO
financial_entries                 NO       NO       NO       NO
historical_screenings             ALL      NO       NO       NO
host_event_assignments            own      NO       -        NO
kenworthy_history                 ALL      NO       NO       NO
labor_settings                    NO       NO       NO       NO
live_performances                 staff    NO       host     NO
movies                            staff    NO       host     NO
payroll_exports                   NO       NO       NO       NO
production_price_tiers            ALL      staff    staff    staff
production_seat_tiers             ALL      staff    staff    staff
profiles                          own      own      own      -     <-- THE DEFECT
qbo_connection                    NO       -        -        -
qbo_sync_jobs                     NO       -        -        -
rental_invoice_lines              staff    staff    staff    staff
seats                             ALL      -        -        -
shift_requests                    staff    own      staff    NO
showing_price_tiers               staff    NO       NO       NO
showing_seat_tiers                ALL      staff    staff    staff
showings                          staff    host     host     host
signing_keys                      -        -        -        -
sponsorship_opportunities         staff    staff    staff    NO
staff_square_links                own      NO       NO       NO
tickets                           staff    staff    host     NO
user_film_passes                  staff    -        staff    NO
user_roles                        own      NO       -        NO
venue_seats                       ALL      NO       NO       NO
venues                            ALL      NO       -        NO
```

## Everything else that says NO, and why it is fine

- **Accounting and payroll** — `financial_entries`, `labor_settings`,
  `payroll_exports`, `qbo_connection`, `qbo_sync_jobs`, `account_mappings`
  (writes), `chart_of_accounts` (writes). Every reader sits behind `isAdmin` or
  `isSuperadmin` in `AdminDashboard` (the `analytics`, `accounting`, `coa`,
  `mappings`, `qbo-export` and `labor` tabs are all inside `{isAdmin && …}`).
- **`app_config`** — read only by `MailchimpTab` and `LglTab`, both inside
  `{isAdmin && …}`, plus `lib/mailchimp.ts`. Not on a staff path.
- **Content editing** — `movies`, `events`, `live_performances`, `showings`,
  `venues`, `venue_seats`, `showing_price_tiers` writes. The forms
  (`MovieForm`, `EventForm`, `ConcertForm`, `ShowingForm`, `VenueForm`) all
  guard on `isAdmin`. Staff are not meant to edit the schedule.
- **`tickets` UPDATE = host** — deliberate, as of
  `20260812190000`. Check-in goes through `check_in_ticket`; staff were
  intentionally *not* given blanket UPDATE on a money table.
- **`staff_square_links` SELECT = own** — correct: a staff member should see
  only their own Square terminal link.
- **`host_event_assignments`, `user_roles`, `donations` = own** — correct.
- **`FilmPassPOS` patron lookup** — looks safe *and is*: it resolves patrons
  through the `film-pass-checkout` edge function under the service role, so the
  `profiles` gap does not touch it. Someone already fixed that path; it is the
  model for the recommendation below.

### Latent, not currently broken

- **`concession_sales` UPDATE / DELETE = NO.** No client-side void or refund
  exists today, so nothing fails. The moment a "void sale" button is added to
  the POS it will silently no-op for staff — and RLS-filtered updates return
  204, which supabase-js reports as success.

## Recommendation

Do **not** simply add a staff SELECT policy on `profiles`. That table carries
more than names: `email`, `phone`, `marketing_opt_in`, and a block of Mailchimp
fields including `mailchimp_ltv_tickets` and `mailchimp_ltv_donations` —
lifetime donation value for every patron. Staff need to identify the person
holding a ticket, not to read the donor file.

Follow the pattern that already works twice in this codebase (`check_in_ticket`,
and `film-pass-checkout`'s lookup): expose the *operation*, not the table.

- `showing_attendees(p_showing_ids uuid[])` — `SECURITY DEFINER`, authorised to
  staff and assigned hosts, returning per-ticket `display_name`, `email`,
  `phone`, seat and status. Serves `AttendeeSheet` and `exportContactsCsv`.
- The DVD renter name is the same question at one row per rental.

This keeps the door list working for staff while leaving donation history and
marketing state invisible to them.

## What was implemented

`showing_attendees(p_showing_ids uuid[])` — `SECURITY DEFINER`, `LANGUAGE sql`,
returning exactly `(ticket_id, display_name, email, phone)`. Staff get any
showing they ask for; a host gets only showings they are assigned to, filtered
per row so a host passing someone else's showing id receives no rows rather than
an error; everyone else receives nothing.

Ticket-keyed rather than user-keyed on purpose: a comp ticket has no `user_id`
and must still line up with its row, and a user-keyed lookup would have let a
host pass arbitrary user ids and read contacts for patrons who never attended
their event.

Rewired: `AttendeeSheet`, `lib/exportContacts.ts` and `HostDashboard`. The
export was also a stub — it shipped `Name,User ID` on the stated belief that
"profiles don't have emails" (they do), so a contact export whose purpose is
reaching the audience was emitting opaque uuids. It now exports name, email and
phone, one row per person rather than per ticket.

12 SQL assertions cover the scoping (including a host getting nothing for a
showing they do not host, and the return type containing no Mailchimp/LTV
column); 6 new unit tests cover the export's dedup and comp-recipient fallback.

**`DvdLibraryTab` was deliberately left alone.** It needs renter identity per
rental, not per ticket, so it does not fit this function's shape, and a rental
list showing "member" is a cosmetic loss rather than a broken door list. It
remains the last known instance of this defect.

## Caveat

5 of 136 policies failed to load into the analysis database (all on
`rental_requests` / `rental_invoice_lines`, from a missing dependency). Both are
admin/renter surfaces — `RentalRequestsTab` is inside `{isAdmin && …}` — and
their policy text was read directly from the dump instead. No staff path
depends on them.
