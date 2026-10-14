---
brief: counter-sms-optin
title: Capture SMS consent at the box office
status: queued
track: feature
date: 2026-08-20
---

# Brief (for Claude Code + Tom): Capture SMS consent at the box office

**Status:** 🟡 Queued — the code is small and the compliance question is not.
Read *"What this must not get wrong"* before writing anything.
**Date:** August 20, 2026
**Requested by:** Tom — online buyers can have their tickets texted; a walk-up
cannot. Give the counter a way to ask.

## The gap, exactly

Online checkout collects a phone and an opt-in checkbox, and a buyer who ticks
it gets their tickets by text. The box office collects a phone and can do
nothing with it.

`deliverPos` in `src/pages/admin/StaffPOS.tsx` sends
`sms_consent: false` — deliberately, and correctly. The counter has no opt-in,
so there is no consent to assert, and asserting one would be the defect Twilio
rejected this campaign over the first time. It emails only, and warns when there
is no email to send to.

That leaves a real hole at the window. `handleSell` accepts a sale with a phone
and no email (a walk-in with no email address should not be turned away), and
`deliverPos` then tells the staff member nothing could be sent. The patron pays,
has valid tickets, and leaves with no digital record — the paper handoff is all
they get. A counter opt-in is what closes that.

## What already exists — do not rebuild it

- **The send path.** `deliverConfirmation` in `_shared/deliver.ts` resolves
  consent as **caller → order → no**, so passing `smsConsent: true` from the
  counter is the entire wiring. SMS delivery is live and verified (2026-08-20).
- **The column.** `tickets.sms_consent` — `true` agreed, `false` asked and
  declined, `NULL` never asked. The counter currently produces `false`; after
  this it produces the patron's actual answer.
- **STOP and HELP.** Answered by the Messaging Service's Advanced Opt-Out,
  which is enabled. Nothing in this repo handles an inbound text and this brief
  does not add one.
- **The disclosure wording.** `src/components/GuestCheckoutForm.tsx` carries the
  four disclosures A2P review requires, in language that has been through
  review. Reuse it; do not write a second version that can drift.
- **The public terms.** `public/sms.html`, linked from the footer and listed in
  `sitemap.xml`.

## What this must not get wrong

**Our registered campaign says opt-in happens on a web form, and our public
page says the checkout checkbox is the only way in.** `public/sms.html`, live
today, states:

> That checkbox is the only way to start receiving texts from us. There is no
> keyword to text in and no number to message to subscribe. We do not add a
> number from a paper form, a phone call, a ticket stub, or a list from anyone
> else.

A counter opt-in makes that false the day it ships. Two things follow, and
neither is optional:

1. **`public/sms.html` changes in the same pull request as the feature.** Not
   afterwards. A page that describes an opt-in route we no longer honour is
   worse than no page, and this one is the evidence the campaign was approved
   on.
2. **The A2P campaign's opt-in type probably has to be updated** to include the
   in-person/verbal route. That is Tom's action in the Twilio console, not
   code — and it carries real risk, because this campaign has already been
   rejected twice and an amended submission may be re-reviewed. **Confirm what
   an amendment triggers before shipping the feature**, because the worst
   outcome is a working counter opt-in and a campaign back in review, which
   stops *all* texting including online checkout.

That sequencing question is the whole reason this is a brief and not a ticket.

## What to build

1. **An on-screen disclosure at the counter.** The same four things the web
   form discloses — what we send, how often, that rates apply, STOP and HELP —
   visible on the POS screen, phrased to be read aloud or turned toward the
   patron. Source it from one shared constant with `GuestCheckoutForm` so the
   two cannot drift.
2. **A checkbox the staff member ticks**, unchecked by default, disabled until a
   phone number is entered, labelled as a record that the patron was asked and
   said yes — not as a preference the staff member holds.
3. **Send the real answer.** `deliverPos` passes `smsConsent: true` when ticked.
   Everything downstream already works.
4. **Let a consented phone stand alone.** Once the counter can text, a
   phone-only sale is deliverable, so `deliverPos` should stop refusing when
   there is no email but there is a consented number — mirroring what ticket
   checkout does. Keep the warning for the genuinely uncontactable sale.
5. **Update `public/sms.html`** per above, and retake `sms-optin.png` if the
   checkout form's contact step moved (it has not, but check — that screenshot
   went stale within a day once already).

## Decisions for Tom

1. **Amend the campaign, or not?** The safe order is: confirm with Twilio
   whether adding an in-person opt-in type re-opens review; if it does, weigh a
   counter opt-in against pausing online SMS. If the answer is unclear, ship
   nothing and ask support first. *(Recommend: ask before building. The code is
   an afternoon; a suspended campaign is not.)*
2. **Consent evidence.** A verbal opt-in has no artefact the way a web form
   does. Worth recording which staff member captured it and that it came from
   the counter — a `sms_consent_source` (`checkout` | `counter`) and the
   capturing user id, mirroring `confirmation_dismissed_by`. Cheap now,
   impossible to reconstruct later, and exactly what an audit would ask for.
   *(Recommend: yes, in the same migration.)*
3. **Exact counter wording**, once decisions 1 and 2 are settled.

## Guardrails

- **Never default the box ticked, and never let a sale require it.** Both are
  A2P violations in their own right, and the second is what the reviewer flagged
  on our first submission even though it was not true of our form.
- **Do not let it become a habit.** A checkbox a staff member ticks for every
  patron to be helpful is worse than no checkbox: it manufactures consent that
  nobody gave, against numbers that will receive real messages. The label should
  make the ask explicit, and the training point is that unticked is a normal,
  correct outcome.
- **No inbound webhook.** STOP and HELP stay with Advanced Opt-Out. If a patron
  says "stop" at the counter, that is not a system action.
- **One source for the disclosure text**, shared with the web form.

## Test plan

- A counter sale with a phone and the box ticked delivers an SMS; the order row
  records `sms_consent = true`.
- The same sale with the box unticked sends email only and records `false` —
  and no text arrives at that number.
- A phone-only sale with consent completes and delivers; a phone-only sale
  without consent still warns and sends nothing.
- The disclosure on screen matches `GuestCheckoutForm` word for word, because
  both read the same constant.
- `public/sms.html` describes both opt-in routes and no longer claims the
  checkout checkbox is the only one.
- A resend of a counter order through `send-ticket-confirmation` honours the
  stored consent — it carries no consent field of its own and falls back to the
  order (`deliver_test.ts` covers this shape already).
- `npm run build:production`, `vitest`, and `deno test` on `_shared` pass.
