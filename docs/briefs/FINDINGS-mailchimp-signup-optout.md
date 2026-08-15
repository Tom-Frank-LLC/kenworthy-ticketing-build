# Findings: footer newsletter error + checkout opt-out

**Date:** August 14, 2026
**Branch:** `feat/mailchimp-optout` (commit `a62f769`)
**Brief:** `BRIEF-mailchimp-signup-optout.md`

## Part A — why the footer form errored

Not a Mailchimp problem, not a JWT problem. **The function is not deployed.**

Probe against staging with the site's own publishable key:

```
POST https://rpqzrpboyhshdrfdwayk.supabase.co/functions/v1/mailchimp-subscribe
HTTP 404
{"code":"NOT_FOUND","message":"Requested function was not found"}
```

`supabase functions list` on **both** projects returns no `mailchimp-*`
function at all. The repo carries five of them — `mailchimp-subscribe`,
`mailchimp-ecommerce`, `mailchimp-webhook`, `mailchimp-campaign`,
`mailchimp-bootstrap` — and none has ever been deployed to either project.

`subscribeToMailchimp` returns `false` on any error and the UI prints one
generic toast, so the 404 never reached the surface. That is the whole of
the "we couldn't add you just now".

### Second wall behind the first

Deploying alone would not have fixed it. `supabase secrets list`:

| Secret | Staging | Prod |
|---|---|---|
| `MAILCHIMP_API_KEY` | set | set |
| `MAILCHIMP_SERVER_PREFIX` | **unset** | **unset** |
| `MAILCHIMP_AUDIENCE_ID` | **unset** | **unset** |

The function returns `500 "Mailchimp is not configured"` unless all three
are present, so the fix is deploy **and** secrets, in that order.

### Ruled out, so nobody re-checks it

`verify_jwt = false` is **not** needed for `mailchimp-subscribe`. Both
projects still use legacy JWT publishable keys (`eyJ…`), which the gateway
accepts as a bearer token — the probe above reached the function router and
returned 404, not 401. No `config.toml` change was made. (Cause 4 in the
brief.)

## Part B — the brief was stale, and the real bug was the opposite one

`origin/main` already had the opt-out checkbox in `GuestCheckoutForm.tsx`
(`useState(true)`, ticked by default) and the dead `if (user)` gate in
`Showing.tsx` already had a guest branch. A parallel session had built it.

What no one had noticed: **`ticket-checkout` already calls
`mailchimp-subscribe` server-side for every buyer with an email address,
and never reads the checkbox.** It is only invisible because the function
404s. Deploying it — the Part A fix — would have started subscribing people
who had just unticked the box. `film-pass-checkout` had the same
unconditional call, from a form with no checkbox at all.

So Part A and Part B are one change: the deploy is what arms the consent
bug, and it had to be fixed in the same commit.

### What changed

- `marketing_opt_in` travels in the checkout body → `readContact` →
  `BuyerContact.marketingOptIn` → gates the subscribe in both checkout
  functions. **An absent field means no, not yes** — a caller that never
  put the question to the buyer has not obtained consent.
- The subscribe call now carries `Authorization: Bearer <service role key>`
  and `status: 'subscribed'`. `mailchimp-subscribe` recognises the service
  role key as a trusted server caller and skips the anonymous
  `pending` downgrade.
- The client-side guest subscribe in `Showing.tsx` is removed — it would
  now double up, and a browser is always an anonymous caller, so it could
  only ever have produced a `pending` contact.
- `film-pass-checkout` is gated too, and `FilmPasses.tsx` now carries the
  same ticked-by-default checkbox and the same wording as the ticket form,
  so pass buyers are subscribed on the same terms (Tom, Aug 14).

### Staff POS subscribes nobody — decided, not overlooked

`StaffPOS` / `FilmPassPOS` also call `film-pass-checkout`, and they send no
`marketing_opt_in`. Under the absent-means-no rule that resolves to false,
so an in-person counter sale subscribes nobody.

**Tom's call, Aug 14: leave it that way for now.** Not a gap to close later
by default — a counter sale is a different consent situation from someone
ticking a box themselves, and staff should not be signing up walk-ups on
their behalf.

If it is ever revisited, the work is a prompt in the POS UI so the buyer is
actually asked, plus sending `marketing_opt_in` on the existing call. **No
change to `film-pass-checkout` is needed** — the consent already rides
through `readContact`, so the function is ready for it. Do not "fix" this by
defaulting the flag to true server-side; that is the same unasked subscribe
this whole change removed.

### Why the server may subscribe outright (Tom's call, Aug 14)

Anonymous callers are forced to double opt-in so a stranger cannot sign up
a third party from the public footer form. A paying buyer is not that case:
the server has cleared a payment against the address. Making them re-confirm
by email is where "subscribed unless you opt out" quietly turns back into
opt-in, because most people never click. The footer form **stays** double
opt-in for exactly the reason the guard exists.

## Landmine: Mailchimp has no sandbox

`MAILCHIMP_API_KEY` has the **same SHA-256 digest on staging and prod**
(`eb870011…a5ee`), the same situation as `LGL_API_KEY`. Staging and prod
share one Mailchimp account and one audience.

**Any test subscribe from staging writes a real contact to the real
audience.** Use throwaway addresses, and clean them out of the audience
afterwards. There is no separate list to practise on.

## Still blocked

`MAILCHIMP_SERVER_PREFIX` and `MAILCHIMP_AUDIENCE_ID` are not in the repo,
not in `.env.staging` / `.env.production`, and Supabase secrets cannot be
read back — only their digests. Both values must come from Tom:

- **Server prefix** — the part after the dash in the API key, e.g. `us21`.
- **Audience ID** — Mailchimp → Audience → Settings → *Audience name and
  defaults* → Audience ID.

**`MAILCHIMP_SERVER_PREFIX` is now set to `us10` on both projects**
(Tom, Aug 14). Only the audience ID is outstanding; nothing can be
deployed or end-to-end tested until it is set on both.

## ⚠️ Deploy order — read before deploying any mailchimp function

**Do not deploy `mailchimp-subscribe` on its own.** Staging and prod are
both running a `ticket-checkout` built before this branch, which calls
`mailchimp-subscribe` for every buyer with an email and never reads the
consent checkbox. That call is harmless only because the function 404s.
Deploying `mailchimp-subscribe` by itself un-404s it and starts subscribing
people who unticked the box — into the **live shared audience**, since
staging and prod share one.

Correct order, per environment:

1. `ticket-checkout` and `film-pass-checkout` (the consent gate)
2. `mailchimp-subscribe` (the trusted-server path)
3. `mailchimp-ecommerce` — `ticket-checkout` also calls this one into the
   void today; not required for consent, but it is the other half of the
   sync and is equally undeployed.

Set `MAILCHIMP_AUDIENCE_ID` before step 2, or the function answers
`500 "Mailchimp is not configured"` and the subscribe is silently lost.

This branch is unmerged and undeployed on purpose. Nothing about the
current live behaviour changes until someone deploys, and the live bug is
dormant only as long as `mailchimp-subscribe` stays absent.
