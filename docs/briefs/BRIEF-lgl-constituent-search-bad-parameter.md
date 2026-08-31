---
brief: lgl-constituent-search-bad-parameter
title: LGL constituent lookup fails — it sends a query parameter LGL does not accept
status: built
track: bug
severity: P1
date: 2026-08-28
verified: true
---

# Brief: the LGL constituent search sends a parameter LGL rejects

> **Fixed and verified against the live LGL API, 30 Aug 2026 — not yet deployed.**
> The key is `name`, which matches email addresses as well as names. Raised from
> P2 to P1: it silently corrupts a CRM that has no undo, and the cleanup cost
> grows with every repeat gift. See *What the API actually accepts* below.

**Status:** 🔴 Open. Seen in production logs 28 Aug 2026, alongside the Square
order failure — unrelated to it.

## What was seen

```
[lgl] search failed 400 {"api_version":"1.0","error":"Parameter Error",
"description":"Unknown query parameter: email_address"}
```

LGL is rejecting the request outright. `email_address` is not a query parameter
it accepts on that endpoint, so **the search never runs** — it does not return
"no match", it errors.

## Where it is, and what it actually does

`supabase/functions/_shared/lgl.ts:104`:

```ts
const q = encodeURIComponent(`email_address=${d.donor_email}`);
const sRes = await fetch(`${LGL_BASE}/constituents/search?q=${q}&limit=1`, { headers });
if (sRes.ok) {
  ...                                   // reuse the constituent
} else if (sRes.status !== 404) {
  console.warn('[lgl] search failed', sRes.status, txt);   // <- and that is all
}
```

The 400 is **warned about and then ignored**. `constituentId` stays `null`, and
the next block does not distinguish "the search found nobody" from "the search
never ran" — it goes straight on to `POST /constituents`.

**So the consequence is not in doubt: a new constituent is created for a donor
who may already exist.** No need to establish which failure mode this is; the
code answers it.

One mitigation, which bounds the damage: the search is skipped entirely when
`d.lgl_constituent_id` is already cached on the donation. Duplicates therefore
only arise for donors **without** a cached id — a first sync, or any donor whose
id was never stored. Sizing that set is what decides how much cleanup is owed.

The effect is fragmented giving history: several records for one person, and
lifetime totals that under-report across all of them. For a donor CRM that is
the failure that matters most, and it is invisible from our side — nothing in
this app reads back what LGL holds.

## Why it is worse than an ordinary bug

**LGL has no sandbox.** Staging shares production's API key and audience, so a
test donation writes a **real donor record with no reversal path**
(`docs/CLAUDE.md`, and `lgl-has-no-sandbox-shared-key`). That rules out the
usual "reproduce it on staging" loop and shapes the whole approach:

- Reads are safe. Writes are not.
- The parameter name can be settled with **read-only GETs** against LGL's real
  API — a wrong parameter name returns the same 400 whether or not the value
  matches anything.
- Do **not** verify the fix end-to-end by making a test donation.

## Steps

1. **The call is `_shared/lgl.ts:104`** — reached from `lgl-sync-donation`,
   which is deployed to production.
2. **Establish the correct query syntax** against LGL's live API with a read-only
   request. Their constituent search is generally a filter/expression style
   query rather than a bare field name, so expect the fix to be a different
   *shape* of query, not just a renamed key.
3. **Separate "search failed" from "no match" in the control flow.** This is
   the structural fix and matters more than the parameter name: today the
   `else if` warns and falls through into create. A search that *errored* should
   abort the sync and surface, not silently assert the donor is new. Given no
   sandbox and no undo, refusing to create is the safer default.
4. **Assess existing damage.** Count LGL constituents sharing an email address,
   and cross-check against donations whose `lgl_constituent_id` was null at sync
   time. That set bounds the cleanup and dates the regression.
5. **Log loudly.** This failed in production without anyone noticing. Whatever
   replaces it should make a failed donor lookup visible rather than a warning
   in a log nobody reads.

## Acceptance

- A donation from an email already in LGL matches the existing constituent
  instead of erroring.
- A genuinely new donor still creates one constituent, not two.
- An LGL outage or a future parameter change is distinguishable from "no match"
  in both the code path and the logs.
- Verified without writing a test donation to the live LGL account.

## Related

- `lgl-sync-donation` is deployed to production; see `docs/TASKS.md` for its
  brief history.
- Found in the same log as
  `BRIEF-square-order-falls-back-to-bare-payment.md`, but the two are
  independent — one is Square order creation, this is the LGL donor lookup.

## What the API actually accepts — measured 30 Aug 2026

A read-only probe against the live LGL account (GETs only, searching an address
that cannot exist, so no donor record was read to establish this).

**Only two search keys are accepted at all.** Every other candidate returns
`400 Unknown query parameter` — including `email`, `eml`, `email_address`,
`email_addresses`, `first_name`, `last_name`, `phone` and `id`.

| Key | Accepted? | Matches an email? |
|---|---|---|
| `keyword` | ✅ | ❌ **no** |
| `name` | ✅ | ✅ **yes** |

**`name` is the answer, and it is counter-intuitive** — the key is named for
names but matches email addresses too.

### Two traps this probe caught

**1. A 200 that ignores the filter.** `GET /constituents?email_address=<x>`
returns **200** — and `total_items: 2751`, identical to the unfiltered list. The
filter is silently discarded and the whole constituent list comes back. Code
built on that would have matched *the first donor in the list* for every
donation, filing gifts on the wrong person's record. Far worse than the
duplicates being fixed.

**2. `keyword` narrows but does not match.** It passes every cheap test: a
nonexistent address returns 0 of 2751, so it is clearly filtering. But searching
a **real** constituent's address also returns 0. It never matches an email, so
every lookup would read as "no such donor" — looking fixed while behaving
exactly like the bug. **Narrowing is not matching**, and only a positive test
against a known-present address tells them apart.

## The fix

`findConstituentByEmail()` in `_shared/lgl.ts`, exported so it can be exercised
directly rather than through a donation:

1. **Search with `name=<email>`**.
2. **Verify the hit.** `name=` is a general "who" search, so a fuzzy match is
   possible; the candidate's own record is checked for the address before its id
   is reused. The search collection omits `email_addresses`, so this costs one
   extra GET. Filing a gift on the wrong donor is worse than a duplicate.
3. **Distinguish a failed search from an absent donor.** This is the structural
   half. A non-2xx (other than 404) now aborts the sync and records
   `constituent_search_failed` on the donation, instead of falling through to
   create. With no sandbox and no undo, refusing to act is the only safe reading
   of "I could not tell".

## Verification

The probe imported and called **the shipped `findConstituentByEmail`**, not a
copy — a test of duplicated logic proves nothing about what runs:

| Case | Result |
|---|---|
| Address that cannot exist | `ok: true, id: null` — searched fine, nobody has it ✅ |
| A real donor's address | `ok: true`, returned **the same constituent id** ✅ |

## Still to do

- **Deploy `lgl-sync-donation`** (the only consumer of `_shared/lgl.ts`).
- **Size the existing duplicates.** Count LGL constituents sharing an email
  address; that bounds the cleanup and dates the regression. Merging duplicates
  is an LGL-side operation.
- **Nothing here surfaces a failed sync.** `lgl_sync_error` is written to the
  donation row, but no screen reads it — the same invisibility that let the
  Square fallback run for nine days.
