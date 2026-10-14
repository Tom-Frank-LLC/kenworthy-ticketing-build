---
brief: nonrefundable-microcopy-scan
title: Every pay button and the ticket receipt state the refund policy, and Terms §6 says the same thing
status: shipped
track: ux
date: 2026-09-16
shipped_in: ["#309"]
shipped_at: 2026-09-16
verified: true
evidence: "prod worker version 06288528-2805-4a79-a5b7-12f7722f6550 (rollback 88c4aedc-70ff-4a75-b6e8-0601865344c9); staging 48935959-e4e8-4041-b3d5-a6b61be68c0b (rollback 0a91d8d7-2883-4fe5-9b97-a9865bb8731c); ticket-checkout, send-ticket-confirmation, film-pass-checkout deployed to both projects and probed"
findings: ../FINDINGS-nonrefundable-contradiction-scan.md
---

# Brief: "Tickets are non-refundable. All sales are final." microcopy + a contradiction scan

**Status:** shipped to staging and production 2026-09-16 (PR #309). See `docs/FINDINGS-nonrefundable-contradiction-scan.md`
for the scan, the four decisions and how each was taken.
**Date:** September 16, 2026
**Requested by:** Tom — add **"Tickets are non-refundable. All sales are final."** beneath the Pay button everywhere it appears and on the film-ticket receipt; and scan all platform language so nothing contradicts it.

## Part A — Add the microcopy beneath each Pay button
The line to add sits naturally right under the existing "Payments are processed securely by Square…" microcopy, which marks every pay surface. Locations (verified, build `931e141`):
- **`src/pages/Showing.tsx`** — the ticket checkout pay/reserve area (two spots: ~L372 and ~L1469, the signed-in and guest/inline paths). **Primary target.**
- **`src/components/GuestCheckoutForm.tsx:353`** — guest ticket checkout. **Target.**
- **`src/components/FilmPassPurchase.tsx:388`** — film pass purchase (not a "ticket" — see Decision 1).
- **Staff POS** (`StaffPOS.tsx`) box-office charge (in-person — see Decision 1).
- Donations (`Donate`/`DonationPrompt`) — a gift, not a ticket; the ticket wording is wrong here (Decision 1).

Rules:
- Under **ticket** pay buttons use the exact line: **"Tickets are non-refundable. All sales are final."** Small, muted, beneath the pay button (same treatment as the Square line); make it a **shared constant/component** so the wording lives in one place and can't drift.
- Include a link to the full policy (Terms §6 / a ticket-policies page) next to it — standard practice and it lets the microcopy stay short while the detailed terms carry any exceptions.
- **Decision 1 (scope/wording):** ticket surfaces get the exact line (recommended). Film **passes** → a pass-appropriate variant ("Film passes are non-refundable.") rather than "Tickets…". **Donations** → exclude (a gift; the donation receipt already frames it as non-refundable/tax-deductible). **POS** → optional (staff know the policy; harmless to include). Confirm.

## Part B — Film-ticket receipt
Add the same non-refundable line to the **ticket email receipt** template in `supabase/functions/_shared/deliver.ts` (the ticket confirmation with the QR), near the footer/reply-to. Decision 2: also add a short form to the **SMS** ticket message (it's terse — recommend email only, or a compact "All sales final." if included). Keep it out of the donation and pass emails unless Decision 1 says otherwise.

## Part C — Contradiction scan (the important part) + reconciliation
Scan every user-facing surface for language that conflicts with "non-refundable / all sales final," and reconcile to one consistent policy. Findings so far:

1. **⚠️ Terms of Service §6 (`src/pages/Terms.tsx`) directly contradicts the requested line.** It currently says: *refunds in full if the Kenworthy cancels; exchanges up to 24 hours prior; rescheduled events honored.* An unqualified **"All sales are final"** conflicts with all three. This is the #1 item and it needs a decision:
   - **Decision 3 (the real call):**
     - **(a, recommended)** Keep the standard, defensible carve-outs and make the microcopy consistent — i.e. the point-of-sale line stays short, but the *authoritative* policy (Terms §6) keeps "no refunds **except** if we cancel or where required by law," and the microcopy links to it. Practically the on-screen line could read **"All sales are final. Tickets are non-refundable except if the Kenworthy cancels a performance."** so it doesn't literally contradict §6.
     - **(b)** Use the absolute line verbatim everywhere and **rewrite §6** to drop the cancellation-refund and exchange promises. **Flag:** removing the "we refund if *we* cancel" promise is unusual and, in many places, refunds for a seller-cancelled event are **required by law** — this is a decision for Tom/counsel, not one to make silently. (I'm not a lawyer; noting the risk.)
   - Either way, the on-screen microcopy and Terms §6 must **say the same thing**. Do not ship an absolute line over a Terms page that promises refunds — that's the exact contradiction this task exists to prevent.
2. **The external policy page.** A code comment notes §6 "matches `kenworthy.org/ticket-info-policies` verbatim in substance." Whatever Decision 3 lands on, that WordPress page must be updated to match (out of this repo — **action item for Tom**, not code).
3. **Film passes.** Check pass copy / `fine_print` for any refund/exchange language; align to the pass policy (non-refundable variant).
4. **Rentals / RentalContract.** Rentals have their **own** cancellation/deposit terms and are **not** tickets — keep them separate; just verify no rental copy implies ticket refunds. Don't let the ticket line bleed onto rental surfaces.
5. **Staff refund tool is fine.** Staff can still process refunds (`square-refund`) for cancellations/legal exceptions — that's the *exception path*, consistent with a "non-refundable by default" customer policy; it's internal, not customer-facing copy. No change, just noted so it isn't mistaken for a contradiction.
6. Sweep for stray "refund"/"exchange"/"money back" in FAQ/help/marketing copy, emails, and SMS templates; route the deliverable as a short **findings list** (file · line · current text · conflict? · fix) so nothing is missed.

## Decisions for Tom
1. Wording scope: exact line on ticket surfaces; pass variant on passes; exclude donations; POS optional (recommended).
2. Receipt: email receipt only (recommended) vs also SMS.
3. **Terms reconciliation:** keep the cancellation / "required by law" carve-out and make the microcopy consistent (recommended, likely legally necessary) vs absolute wording everywhere with §6 rewritten (flag for counsel).
4. Also add a link from the microcopy to the full policy page (recommended).

## Test plan
- The non-refundable line appears beneath the pay button on every ticket surface (signed-in + guest), with the wording from a single shared source; passes/donations/POS handled per Decision 1.
- The film-ticket **email receipt** shows the line; donation/pass emails unaffected (unless chosen).
- **No contradiction remains:** Terms §6, the microcopy, pass copy, and (flagged) the external policy page all state the same refund stance per Decision 3; the scan findings list is delivered and every conflict is resolved or ticketed.
- Rentals terms remain separate and intact; the staff refund path still works for exceptions.
- `npm run build` + tests pass.

## Outcome (2026-09-16)

All four decisions taken to the recommended option; the findings file has the
table. Corrections to the brief as written, found during the scan:

- The `~L372` spot in `Showing.tsx` is the free-showing **donation** form, not a
  ticket checkout. It got no line.
- The receipt template lives in `_shared/notify.ts`, not `deliver.ts`.
- The donation receipt does **not** frame gifts as non-refundable; Terms §8 does.
- `kenworthy.org/ticket-info-policies` now 301s to `/terms` in this app, so the
  "update the WordPress page" action item is moot. Terms §6 is the policy page.

## Shipped (2026-09-16)

Deployed from `main` at `47bcd09` after confirming neither worker was ahead
of main (production's entry chunk was byte-identical in size and route table
to the pre-merge build; staging was behind by one route).

| target | version | rollback |
|---|---|---|
| `kenworthy-ticketing-build` (prod) | `06288528-2805-4a79-a5b7-12f7722f6550` | `88c4aedc-70ff-4a75-b6e8-0601865344c9` |
| `kenworthy-ticketing-staging` | `48935959-e4e8-4041-b3d5-a6b61be68c0b` | `0a91d8d7-2883-4fe5-9b97-a9865bb8731c` |

Edge functions carrying the receipt template (`ticket-checkout`,
`send-ticket-confirmation`, `film-pass-checkout`) deployed to both projects;
each answers an anon-key POST with its own validation error, not a boot error.
Verified at the origin, not the upload log: the new entry chunk is what `/`
serves on both hosts, and the `SalesFinalNote-*` chunk returns as
`text/javascript` with the wording in it.
