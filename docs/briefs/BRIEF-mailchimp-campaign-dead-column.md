---
brief: mailchimp-campaign-dead-column
title: The Mailchimp campaign has never been able to send, because it queries a column that does not exist
status: queued
track: bug
severity: P2
date: 2026-08-25
verified: true
---

# The Mailchimp campaign has never been able to send

`mailchimp-campaign` and the admin tab that drives it both query
`showings.show_datetime`. That column does not exist and never has. The column
is `showings.start_time`.

Found during the outbound copy review (message #15 of 15), while checking a
suspected timezone bug in the campaign's date line. The timezone bug is real
and is described below, but it is unreachable: the function fails before it.

## What actually happens

The function selects:

```
id, show_datetime, movie:movies(...), event:events(...), performance:live_performances(...)
```

PostgREST rejects the whole select. Run against production on 2026-08-25:

```json
{"code":"42703","message":"column showings.show_datetime does not exist"}
```

`sErr` is therefore set on every call, and the function returns
`{"error": "Showing not found"}` with a 404 before it reaches Mailchimp. There
is no path through it that sends anything.

## The admin UI fails first, and more visibly

`src/components/admin/MailchimpTab.tsx` builds the showing picker with three
references to the same absent column:

```
.select('id, show_datetime, movie:movies(title, poster_url), ...')
.gte('show_datetime', new Date().toISOString())
.order('show_datetime', { ascending: true })
```

That query errors too, so **the picker never lists a showing** and the send
button cannot be reached. A fourth reference formats the date at line 194.

So the feature is dead twice over: nothing to select, and a 404 if you could.

## Why nobody noticed

`mailchimp-campaign` is deployed and `ACTIVE` on production, and a function
that returns a tidy 404 looks healthy in `supabase functions list`. The failure
is only visible to someone who knows a valid `showing_id` should have worked —
and the UI never produces one to try.

The reference arrived in `272d38d` ("Changes", 2026-07-01), a Lovable-era
commit. No migration has ever created `show_datetime`; `grep -rl show_datetime
supabase/migrations/` returns nothing.

## The fix

Four occurrences, one rename:

| file | line | change |
|---|---|---|
| `supabase/functions/mailchimp-campaign/index.ts` | 69 | `show_datetime` → `start_time` in the select |
| `supabase/functions/mailchimp-campaign/index.ts` | 84–85 | the `when` expression |
| `src/components/admin/MailchimpTab.tsx` | 41–43 | select, `.gte`, `.order` |
| `src/components/admin/MailchimpTab.tsx` | 194 | the displayed date |

## Do not fix the rename without fixing the timezone

The campaign formats its date with no timezone:

```js
new Date(showing.show_datetime).toLocaleString("en-US", { dateStyle: "full", timeStyle: "short" })
```

Edge functions run in UTC, so a 7:00 PM Moscow screening would be advertised to
the whole list as **2:00 AM the following day**. Every other surface goes
through `formatShowtime()` in `_shared/tickets.ts`, which pins
`VENUE_TIME_ZONE`. Use it here too.

Renaming the column without this turns a feature that sends nothing into one
that sends the wrong date to every subscriber — strictly worse than dark.

## There is no safe place to test this

Staging shares production's Mailchimp API key and audience (see `CLAUDE.md`).
A test campaign is a real campaign, to real subscribers. The first successful
run of this code is a live send.

Whoever picks this up should plan for that: create the campaign via the API but
do not send it, and confirm the rendered content in the Mailchimp dashboard
before anything leaves. `mc()` already separates campaign creation from the
send step, so this is a matter of stopping between them.

## Open copy questions, deliberately not decided here

Raised during the review and left for whoever ships this:

- **Reply-to is `info@kenworthy.org`.** Every other email, the site footer, the
  rentals page and the legal documents use `events@kenworthy.org`. This is the
  only surface using `info@`.
- **The subject always says "This week at the Kenworthy: {title}"**, including
  for a showing three weeks out.

## Why it is queued rather than fixed

Raised with Tom on 2026-08-25 during the copy review. Decision: log it and
leave the send path dark. The copy review was scoped to what the platform
sends, and this is the one message that sends nothing at all — repairing it is
a separate piece of work with a live blast at the end of it.
