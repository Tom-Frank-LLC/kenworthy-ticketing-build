---
brief: pos-patron-facing-display
title: A patron-facing display at the box office mirrors the sale and lets the patron choose their own donation
status: shipped
track: feature
severity: P2
date: 2026-10-15
shipped_in: ["#384"]
shipped_at: 2026-10-15
verified: true
evidence: "Production Worker deploy 15 Oct 2026; rollback 3d6f82ce"
---

# Brief: Patron-facing box-office display with a self-serve donation (Option A)

**Requested by:** Tom, 15 Oct 2026. The box office runs a Square Terminal under
the glass; the patron cannot see their transaction or add a donation
themselves. Put a patron-facing donation on a second device outside the glass
(prototyped with an iPad for staff and an iPhone for the patron).

## Why this is the only missing piece

- **The Terminal can't host the button.** It runs Square's own checkout UI; we
  hand it an amount. A Square *tip* is not a tax-deductible gift
  (`BRIEF-donations.md`, Part E). So the prompt lives in our UI — it already
  does, in `StaffPOS`.
- **The gap is whose screen shows it.** Today staff tap the gift on the
  counter-facing screen after asking out loud. This gives the patron their own
  screen. Payment capture does not change.

## The change (as asked)

1. A patron-facing route (`/pos/display`): read-only view of the sale plus the
   `DonationPrompt`. No staff chrome, no seat map, no contact fields, no sign-in,
   no privileged call.
2. Pair the two screens with a short-lived per-station code.
3. Sync over a Supabase Realtime broadcast channel keyed by the code.
4. The patron's amount becomes the till's `donationCents`; everything downstream
   (`chargeTotal`, the Terminal, `recordDonation` → `square-donation
   record_in_person`, LGL) is unchanged. The staff-side prompt stays as the
   fallback.
5. A thank-you state on the display; the card is only ever taken on the Terminal.

## Decisions taken

All five took the brief's recommendation:

1. **Sync:** Realtime broadcast, no schema.
2. **Pairing:** a 6-character code on the till — **plus a QR of the same link**,
   because `qrcode.react` was already installed and scanning is faster than
   typing on a phone. The code is the same either way.
3. **What the display shows:** show title and time, ticket count, tickets-with-tax,
   donation, total. No seat numbers, no tier breakdown. Presets + custom.
4. **Rollout:** additive. A till with no display paired opens no channel at all
   (tested), so the live box office is unchanged until a station pairs.
5. **Device:** either; it is display-only.

## As built

- `src/lib/patronDisplay.ts` — the protocol, both hooks (`useTillDisplay`,
  `useDisplayChannel`) and the Realtime transport. The header comment carries
  the security reasoning.
- `src/pages/PatronDisplay.tsx` — the display. Rendered without site chrome
  (`BARE_PATHS` in `Layout.tsx`). Keeps the screen awake (Wake Lock, best effort).
- `src/components/pos/PatronDisplayPairing.tsx` — the till's pair / show code /
  new code / turn off control, beside the card-reader picker.
- `DonationPrompt` gained `variant="display"`: patron wording, bigger targets,
  and no link to `/donate` (the display is a kiosk).
- `/pos` is `noindex` (worker `PRIVATE_PREFIXES`) and disallowed in `robots.txt`.

### Revised after Tom's first staging test (15 Oct 2026)

- **Name:** it is the **patron-facing display** — in the till's UI, the code
  (`patronDisplay.ts`, `PatronDisplay.tsx`, `PatronDisplayPairing.tsx`) and this
  brief. Not "customer display", not "the patron's screen".
- **A final total screen.** Choosing a gift (or "No thanks") used to say thank
  you and leave the prompt up, which read as unfinished. The display now moves
  to a final total — breakdown, a large total, a thank-you for any gift, and
  "One moment — the box office is getting your payment ready" — which becomes
  "Please pay on the card reader" when the till sends the sale to the reader,
  and gives way to the thank-you screen when the sale completes. "Change my
  donation" returns to the prompt until the sale goes to the reader. If the
  till charges before the patron chooses, the display goes straight to the
  final total.
- **A typed amount now has its own Add button** on the display. Because every
  choice moves the screen on, sending a typed amount per keystroke would send
  $2 on the way to $25 and leave the prompt after the first digit.

### Revised again (15 Oct 2026): logo, marquee, the show

- **Logo:** `KenworthyLogo` (the date-chosen lockup the site header uses)
  replaces the "The Kenworthy" text.
- **Marquee:** the sale and final-total screens sit inside `MarqueeFrame`, the
  ring of bulbs the concessions menu wears, with the inset brought in
  (`--mq-inset` 1.25rem on a phone, 2rem above — raised from 0.75 / 1.25 when
  Tom found the text crowded the bulbs; the phone poster went down a size to
  keep the title on one line and the amounts on screen) because here the frame is the
  whole screen.
- **The show:** poster, title, date and time, rating / genre / runtime
  (`ProductionMetaBadges`, runtime hidden when the admin hid it), and — on a
  tablet — up to five lines of the description. The till fetches these with the
  showing list (`DISPLAY_COLUMNS` in `StaffPOS`) and sends them in the snapshot.
- **Two guards, because the display renders whatever arrives on its channel:**
  the description travels as plain text and is rendered as text (never
  `RichText`/HTML), and the poster must be https from `www.kenworthy.org` or
  our Supabase storage (`safePosterUrl`, checked at both ends) — the only two
  hosts any production poster uses (checked 15 Oct 2026 against production).
- **Phone fit, measured at 375 × 812:** with the description and full-size type,
  the donation buttons sat at 977px. Without the description on a phone, a
  smaller logo, tighter spacing and the amounts two-by-two, all four amounts
  are on screen (bottom at 803px with the wider inset); the custom-amount row is just below the
  fold. Safari's own toolbars take more, so on an iPhone in the browser the
  patron may need to scroll for "Other amount". Adding the page to the Home
  Screen removes the toolbars.

### Layout, measured (15 Oct 2026)

Tom asked for the space between the text and the bulbs doubled: `--mq-inset`
is 4rem from `sm` up (was 2rem). The frame's own width is unchanged
(`max-w-2xl`) — a two-column, wider frame for landscape tablets was tried and
reverted at Tom's request; he wanted only the inner padding doubled. On a
375px phone 4rem squeezed the text column to ~150px and put the gift buttons
off screen, so (Tom's call) the phone keeps 1.25rem.

- **The description was never clamped above a phone.** `sm:block` on the
  paragraph overrode the `display: -webkit-box` that `line-clamp` needs; the
  breakpoint now toggles a wrapper. It is 4 lines.
- **iPad in landscape (1180×820) does not fit the prompt** without scrolling —
  the gift buttons sit below 820px. True before the doubling too. Portrait
  fits. Open question for Tom if the iPad will be used on its side.

### Things established while building it

- **Anon Realtime broadcast works on both projects** with no configuration
  (probed 15 Oct 2026, staging and production): the publishable key can join
  any public topic by name. So **the code is the only thing scoping a channel**.
  It is 6 characters from a 31-character alphabet (~8.9 × 10⁸), random, and
  expires after 16 hours (`CODE_TTL_MS`). A stranger who guessed one could read
  a title and a total, or propose a gift — which the till refuses outside
  $1–$1,000, refuses for any sale but the current one, refuses once the sale
  has gone to the reader, and toasts to staff when it accepts. The reader shows
  the full amount before the patron taps.
- **The till is the only source of truth.** The display never shows its own tap;
  a choice lights up when the till's next snapshot says it took it.
- **A proposal carries the sale's id.** `saleId` rotates on every `resetForm`, so
  a late tap cannot land on the next patron's sale.
- **Race closed at the Charge click.** The amount sent to the reader is read from
  the render the click happened in; a proposal arriving before React re-renders
  would have moved the screen's donation off it. `donationHeldRef` is set
  synchronously in both sale handlers. Charge and record were already
  consistent with each other (same closure); this keeps the screen honest too.
- `CSP connect-src` already allowed `wss://*.supabase.co`.

### Verified

- `src/lib/patronDisplay.test.tsx` (15 tests) wires the real till hook to the
  real display page through an in-memory bus. Each refusal (wrong sale, paying
  phase) was mutation-checked: removing it fails both its unit test and its
  integration test. (The first version of those tests passed with the guards
  removed — `toHaveTextContent('0')` is a substring match and `1000` contains
  `0`. Now exact.)
- End to end over **real staging Realtime**: the display page in Chrome, with a
  scripted till on the same channel. Mirror, $5 round trip, paying lock,
  thank-you, return to Welcome, reload rejoins from storage, unknown code says
  so after 6 s.

### Verified by Tom on staging

- The real two-device run: `StaffPOS` on one device driving the display on
  another, through the revisions above.

### Known limits

- Two `/staff/pos` tabs in one browser share the station's code and would both
  answer the display. One till tab per station.
- Donation-only (no tickets) is still unsupported at the counter, as before.
- Concessions and film-pass sales leave the display on Welcome.
