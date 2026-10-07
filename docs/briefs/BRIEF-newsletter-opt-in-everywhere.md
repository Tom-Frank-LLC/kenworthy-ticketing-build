---
brief: newsletter-opt-in-everywhere
title: Donors and film-pass buyers are asked about the newsletter, and nobody is subscribed without saying yes
status: built
track: feature
severity: P2
date: 2026-10-07
verified: false
---

# Brief: one newsletter opt-in, on every form that takes money

**Requested by:** Tom, 2026-10-07, after the security audit follow-up turned up
the server-side Mailchimp calls.

## What was wrong

There were two ways a buyer could reach the Mailchimp list.

1. **From the browser, and it worked.** The guest ticket form asks "Email me
   about upcoming films, performances, and Kenworthy news" (ticked by default).
   When the box is left ticked, `Showing.tsx` calls `mailchimp-subscribe`
   anonymously, which creates the contact as *pending*. Mailchimp then sends a
   confirm-by-email, and nobody joins without clicking it.
2. **From the server, and it never arrived.** `ticket-checkout`,
   `film-pass-checkout` and `square-donation` each also called
   `mailchimp-subscribe` after a sale, sending only an `apikey` header. The
   gateway (`verify_jwt = true`) refuses a request with no `Authorization`
   header, so all of these calls failed silently since the paid checkout
   launched (12 Aug). Confirmed on production 2026-10-07: the exact header
   shape gets `401 UNAUTHORIZED_NO_AUTH_HEADER`.

The server calls also **ignored the checkbox**: they would have subscribed every
buyer and every donor. So the broken path was the wrong one to repair.

Before this change, donors and film-pass buyers never reached the list at all:
neither form asked, and only the dead server call tried.

## What changed

- **Server:** the signup call is deleted from all three functions.
  - `film-pass-checkout`: its `syncMailchimp` did nothing else, so it's gone,
    along with the now-unused `ANON_KEY`.
  - `ticket-checkout` and `square-donation` keep their `mailchimp-ecommerce`
    call. That sends purchase history to Mailchimp's store; it's server-side
    because it reports money, and it's dormant until `mailchimp-bootstrap` is
    run for the project.
- **Donate (`src/pages/Donate.tsx`):** the same checkbox and wording as the
  ticket form, ticked by default. After a successful gift, a ticked box sends
  the same anonymous, confirm-by-email signup, tagged `donor`, source
  `donation`. The old signed-in `syncMailchimpProfile` call is dropped: donors
  are never signed in.
- **Film passes (`src/components/FilmPassPurchase.tsx`):** the same checkbox.
  After the order is placed, a ticked box subscribes the buyer, tagged
  `film-pass`, source `film-pass-checkout`.
- Both tags and both sources were already on `mailchimp-subscribe`'s anonymous
  allowlists, so no server change was needed for them.

The default stays **ticked**, to match the ticket form. Mailchimp's double
opt-in is what makes that acceptable: a ticked box sends a request, and only
the person's own click on the confirmation email adds them.

## How it was proven

- `src/pages/Donate.test.tsx` (new) and `src/components/FilmPassPurchase.test.tsx`
  each check that:
  - the box is present and ticked;
  - a ticked box subscribes with the right email, name split, tag and source;
  - an unticked box sends nothing;
  - a failed sale sends nothing.
- Mutation-checked: dropping the `newsletter &&` condition in `Donate.tsx`
  fails the unticked case.
- `deno test` 600/600; `deno check` clean on the three changed functions.

## Deploy

1. Functions, staging then production:
   `supabase functions deploy ticket-checkout film-pass-checkout square-donation --project-ref <ref>`.
   Docker bundler, as in `BRIEF-sec-wave2-functions`.
2. Worker: `npm run build:<env>` and `npx wrangler deploy` (`--env staging` for
   staging).
3. Checks:
   - `/donate` and a film-pass page show the box, ticked.
   - On staging, a sandbox gift with the box ticked: the browser's call to
     `mailchimp-subscribe` returns "Mailchimp is not configured", which is
     expected because staging has no Mailchimp keys since 2026-10-07. On
     production, the donor gets Mailchimp's confirmation email.

Rollback: redeploy the previous function versions and `wrangler rollback`. No
data or migration is involved.
