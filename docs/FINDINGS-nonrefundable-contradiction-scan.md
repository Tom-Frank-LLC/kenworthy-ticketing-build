# Findings: the "all sales are final" line, and everything that had to agree with it

**Date:** 2026-09-16
**Brief:** `docs/briefs/BRIEF-nonrefundable-microcopy-scan.md`
**Scanned from:** `origin/main` at `2ebbed6`

The ask was a line beneath every Pay button and on the ticket receipt, and a
scan of every patron-facing surface for anything that contradicts it. This is
the scan. The short version: the platform had almost no refund language at
all, so there was one real contradiction, and it was the Terms page itself.

## The decisions, and how they were taken

The brief left four decisions open. They were resolved to its own recommended
option in each case, because the request was to execute the brief and the
recommendations were sound. Any of them can be reversed by editing one file
(`src/components/SalesFinalNote.tsx`) and its two hand-copied mirrors.

| # | Decision | Taken | Where |
|---|---|---|---|
| 1 | Wording scope | Exact line on ticket surfaces; a pass variant on the pass surface; donations excluded; POS included | `SalesFinalNote.tsx` |
| 2 | Receipt channel | Email receipt only. The SMS is billed per 160-character segment, is already two segments, and the receipt is what a buyer keeps | `notify.ts` |
| 3 | Terms reconciliation | **(a)**: keep the cancellation and required-by-law carve-outs. Terms §6 now *leads* with the exact requested sentences and then states the exception; the microcopy states the same exception in the same breath | `Terms.tsx` §6 |
| 4 | Link to the full policy | Yes: `/terms#refunds` for tickets, `/terms#passes` for passes. `LegalDoc` gained section ids and a scroll-to-hash effect, because React Router does not scroll to a hash on its own | `LegalDoc.tsx` |

Option (b) for decision 3, dropping the cancellation refund from §6, was not
taken and should not be taken without counsel. A refund for an event the
seller cancels is what patrons expect and, in many jurisdictions, what the
law requires. The line as shipped is not weaker for carrying the exception:
"Tickets are non-refundable. All sales are final." is printed verbatim, and
the exception is the one every venue makes.

## What the line says, everywhere it appears

Ticket surfaces:

> Tickets are non-refundable. All sales are final. If the Kenworthy cancels a
> performance, you will be refunded in full. [Full ticket policy].

Pass surface:

> Film passes are non-refundable. All sales are final. [Full pass policy].

Three copies exist and must stay identical: `src/components/SalesFinalNote.tsx`
(the source), `supabase/functions/_shared/notify.ts` (the receipt; an edge
function cannot import from `src/`), and the first two sentences of Terms §6.
`SalesFinalNote.test.tsx` and `tickets_test.ts` pin the first two so a drift
is a failing test rather than a second policy.

## Findings

Every hit for `refund`, `exchange`, `money back`, `all sales`, `non-refundable`
across `src/`, `worker/`, `public/`, `index.html`, `supabase/functions/`, plus
the live pass copy in the production database. Staff-only code is grouped at
the end.

| File · line | Current text | Conflict? | Fix |
|---|---|---|---|
| `src/pages/Terms.tsx` §6 (was L97–102) | "Refunds. If the Kenworthy cancels a performance, refunds will be made in full. Except where required by law, no other refunds will be made." | **Yes**, with an unqualified "all sales are final" | §6 now opens with "Tickets are non-refundable. All sales are final." then the cancellation exception, unchanged in substance. The microcopy carries the same exception. **Resolved.** |
| `src/pages/Terms.tsx` §6 Exchanges | "Tickets may be exchanged up to 24 hours prior to the performance, subject to availability." | No. An exchange is not a refund; "all sales final" venues routinely offer exchanges | Unchanged. The microcopy links to §6, which is where this lives. If exchanges are to end, that is a separate decision and a one-paragraph edit. |
| `src/pages/Terms.tsx` §6 Rescheduled | "your ticket will be honored for the new date" | No | Unchanged. |
| `src/pages/Terms.tsx` §7 Film passes | "Passes have no cash value and are non-refundable except as required by law." | No | Added "all sales are final" so §7 and the pass microcopy use the same words. Section id `passes` added. |
| `src/pages/Terms.tsx` §8 Donations | "Donations are voluntary and, once made, are non-refundable except in the case of a processing error." | No | Unchanged. Donation surfaces carry no ticket line. |
| `src/pages/Terms.tsx` §3 | "cancel affected orders with a refund" (pricing error) | No. Seller-initiated, same family as the cancellation exception | Unchanged. |
| `src/pages/Terms.tsx` §9 Rentals | "Rental fees, deposits, and cancellation terms are set out in that agreement." | No. Rentals are their own contract | Unchanged. No rental page or contract copy mentions ticket refunds. The ticket line is not rendered on any rental surface. |
| `src/pages/Terms.tsx` header comment (L9–13) | "§6 matches kenworthy.org/ticket-info-policies verbatim in substance … Do not loosen … without changing it there too" | Stale, not a contradiction. That URL now 301s to `/terms` (`worker/redirects.ts:23`), so there is no second copy | Comment rewritten. The brief's "update the WordPress page" action item is moot: **this page is the policy page.** |
| `src/pages/Showing.tsx` ~L372 | "Payments are processed securely by Square" under a **Donate $X** button | No. The brief listed this as a ticket pay spot; it is the free-showing donation form | No line added. Donations are excluded. |
| `src/pages/Showing.tsx` L1469 (signed-in checkout) | Square line only | Silent | Ticket line added, hidden for free reservations. |
| `src/components/GuestCheckoutForm.tsx` L353 | Square line only | Silent | Ticket line added inside the existing `!isFree` block. |
| `src/components/FilmPassPurchase.tsx` L388 | Square line only | Silent | Pass line added. |
| `src/pages/staff/StaffPOS.tsx` L1166 (charge button) | none | Silent | Ticket line added beneath the charge button. Optional per the brief; included so the screen across the counter says what the website says. |
| `film_pass_types.fine_print` (production, both active passes) | "Admission for 10 Regular Priced Movies. Does not include Special Events or Rentals." / "Valid at 2026 Kenworthy Silent Film Festival. Not valid on standard movies." | No refund or exchange language | Nothing to change. |
| `supabase/functions/_shared/notify.ts` (ticket receipt, HTML + text) | none | Silent | Line added as the footer note, with a link to `/terms#refunds` on the receipt's own origin. |
| `supabase/functions/_shared/notify.ts` `buildSmsBody` | none | Silent | Unchanged (decision 2). |
| `supabase/functions/_shared/donations.ts` (donation receipt) | "No goods or services were provided in exchange for this contribution" | No. The brief said this receipt "already frames it as non-refundable"; it does not, it carries only the 501(c)(3) language. Terms §8 is what states the donation stance | Unchanged. Noted so the brief's premise is corrected. |
| `supabase/functions/_shared/pass_orders.ts` (pass emails) | none | Silent | Unchanged (decision 1). |
| `src/pages/Volunteer.tsx:83`, `src/pages/Hiring.tsx:141` | "free movie passes in exchange for their work" | No. The word, not a ticket-exchange claim | Unchanged. |
| `public/*.html`, `index.html`, `worker/` | none | — | Nothing to change. |
| FAQ / help pages | none exist in the app | — | Nothing to scan. |

Staff-only surfaces, all internal and all the *exception path* the customer
policy allows for, not contradictions: `TransactionsTab.tsx` (refund status and
history), `StaffPOS.tsx` L747–781 and L1305–1339 (the refund dialog),
`TransactionHistory.tsx` (the Refund button), `FilmPassesTab.tsx:534` ("refund
from the till separately"), `BoxOfficeToday.tsx`, `BoxOfficeReceiptsTab.tsx`,
`AnalyticsTab.tsx`, `MyPasses.tsx` and `FilmPassPOS.tsx` (status labels), and the
`square-refund` function. None changed.

## Not done, on purpose

- **`src/pages/PublicTicket.tsx`**, the mobile ticket page the SMS links to,
  carries no policy text and none was added. The brief scoped the receipt,
  and the ticket page is the ticket, not the receipt. Easy to add if wanted.
- **The SMS** carries no policy text (decision 2).
- **Exchanges** still exist in §6. Ending them is a policy change, not a
  consistency fix.

## What is left for Tom

Nothing outside the repo. The external WordPress page the brief flagged no
longer exists as a separate page; its URL redirects to this app's `/terms`.
