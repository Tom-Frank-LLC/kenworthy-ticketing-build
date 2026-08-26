---
brief: rentals-page-overhaul
title: Rebuild /rentals — marquee-led hero, a real marquee booking form, hourly day-view availability, and the official rate grid
status: in-progress
track: feature
severity: P2
date: 2026-08-25
verified: false
---

> **Decisions taken (2026-08-26).** The six open decisions were settled as
> follows. 1 — marquee-forward hero, rental copy directly beneath it.
> 2 — reuse the `rental-request` edge function; **no change to it was needed**,
> its allowlist already carries `marquee_text`, `venue_area`, `phone` and both
> date fields. 3 — 8 AM to 11 PM. 4 — privacy-safe `SECURITY DEFINER` RPC
> (`get_public_availability`), with parsing in TypeScript and an honest
> "check with us" for any time that will not parse. 5 — **Tom: After-9
> supplements After-3 per hour**, so a Saturday 7–11 PM bills 7–9 at $180 and
> 9–11 at $100; encoded in `quoteHours`. 6 — sold on the hourly grid; the four
> flat room cards are gone and the marquee's $150 stays as its own line.
>
> **Two premises in the body below were wrong and are corrected here.** The
> brief's "Current state" was written against the shared checkout, which was
> behind `origin/main`. On main, `rental_requests` has **no anon INSERT** (it
> was revoked by `20260819193812`), submissions already go through the
> Turnstile-verified `rental-request` edge function, and rental times are **not**
> loose free text in practice — every one is written by an `<input type="time">`,
> so they are `HH:MM`. The column is still `text` and is still parsed
> defensively, but no time-normalisation migration was needed.
>
> **Outstanding:** the hero photograph. The `#KENWORTHYCUPID` image is not in
> the repo; `src/components/rentals/RentalsHero.tsx` imports
> `src/assets/optimized/marquee-cupid-{768,1280,1920}.{jpg,webp}`, which do not
> exist yet, so the build fails until they are generated from the source photo.

# Brief (for Claude Code): Rentals page overhaul — hero image, marquee form, day-view availability, official rates

**Status:** 🟡 Large, multi-part. Two parts carry real structural risk: the day-view availability (rentals aren't readable by the public today and their times are free-text) and the marquee form (must go through the existing secure submission pipeline, not a raw insert).
**Date:** August 25, 2026
**Requested by:** Tom — six changes to `/rentals` (`src/pages/Rentals.tsx`).
**Source of truth for rates:** https://www.kenworthy.org/rentals/ (base-rate grid transcribed below from `rental-rates-3.png`).

## Current state (verified)
- `src/pages/Rentals.tsx` is the whole page. Sections top-to-bottom: text **Hero** (no image), **Availability** (calendar + "Next on the calendar" list), **Rental Rates** (flat cards from a hardcoded `RATES` array), **Fee Menu**, **Discounts**, **"See your name in lights"** marquee section (a `mailto:` button) at the **bottom**, closing CTA.
- **Availability data:** a `useEffect` queries `showings` (public, has `start_time`) and `rental_requests` (`status='approved'`, selects only `proposed_date, event_title, status`). Booked dates render magenta; annual `BLACKOUTS` (hardcoded holidays) render gold + disabled.
- **RLS reality (critical):** `anon` has **no SELECT** on `rental_requests` (only "Admins view all"; public writes go through a Turnstile-verified `rental-request` edge function as `service_role`). So **the rentals query returns nothing for a public visitor today** — the calendar currently reflects only programmed showings, not private rentals. Any day-view that shows rental occupancy needs a **purpose-built, privacy-safe read** (view or `SECURITY DEFINER` RPC), not a direct table query.
- **Rental times are free text:** `rental_requests` has `event_start_time`, `event_end_time`, `arrival_time`, `departure_time` — all `text` (e.g. "7:00 PM"), plus `proposed_date`/`end_date` (dates). There are **no structured start/end timestamps** for a rental, so hourly occupancy can't be computed reliably from the current columns (see Part D).
- **Useful columns that already exist:** `is_public` (boolean — the public/private flag Tom wants), `marquee_text`, `applicant_name`, `email`, `phone`, `venue_area`, `linked_event_id`.

## Part A — Add the marquee hero image, cropped to match the home hero
1. Tom provided the night marquee photo ("I LOVE YOU / I KNOW · #KENWORTHYCUPID"). Add it under `src/assets/` and generate responsive variants exactly like the home hero (`src/assets/optimized/hero-768|1280|1920.{jpg,webp}`) — same widths, same webp+jpg pattern. *(Claude/Tom can hand over the optimized set; see note at end.)*
2. Give the Rentals hero the **same image treatment as `HomeMarquee.tsx`**: full-width `<picture>` with `object-cover`, a matching scrim/gradient for text legibility, and a crop/`object-position` tuned so the marquee sign and message stay framed — **matching the home hero's aspect and framing** (Tom: "cropped to match the hero image on the home page"). Reuse the home hero's structure rather than inventing a new one.
3. Keep it accessible: real `alt`, eager/high-priority load (it's above the fold).

## Part B — Move "See your name in lights" to the top, into the hero
Relocate the marquee section (currently the bottom `See your name in lights` block) to the **top of the page, combined with the hero image** from Part A. The hero becomes the marquee pitch over the marquee photo — headline, the $150 line, and the new **Book the marquee** button (Part C). The generic "Your event, on Main Street since 1926" rental hero copy can move below or merge — **Decision 1:** marquee-forward hero (recommended, matches the ask) vs keep a separate rental hero under it.

## Part C — "Book the marquee" → a form (not a mailto)
Replace the `mailto:events@kenworthy.org` button with a real form collecting exactly:
- **Name** (`applicant_name`)
- **Contact info** (`email`, and optional `phone`)
- **What to display on the marquee** (`marquee_text`)
- **When to display it** (a date → `proposed_date`; optionally an end date)

Implementation must reuse the **existing secure pipeline**, not a direct insert: `anon` can't write `rental_requests`, and submissions go through the **`rental-request` edge function** (Turnstile-verified, column-allowlisted, writes as `service_role`). So:
- Submit the marquee form through that same edge function (or a thin sibling), tagging it as a marquee booking — e.g. `venue_area='marquee'` (or a dedicated flag) plus `marquee_text` — so it lands in the same **admin Rental Requests** queue staff already work.
- **Decision 2:** reuse the `rental-request` function with a "marquee-only" minimal payload (recommended — one pipeline, one admin queue) vs a new lightweight endpoint/table. If reused, confirm the function's allowlist permits a marquee-only submission (many rental fields absent).
- Keep it honest about side effects: this **sends a request**, it doesn't confirm a booking — success message says the team will follow up (mirror `/rental-request`). Turnstile + validation + a friendly error path; don't collect payment here.

## Part D — Availability: replace "Next on the calendar" with a clicked-day hourly day-view
Remove the **"Next on the calendar"** list entirely. In its place (the right column), show a **day view of whichever calendar day is clicked**, as **hourly rows**, each marked available / unavailable.

**Status vocabulary change (whole section):**
- "Booked" → **"Limited availability"** (a day with something on it still has open hours).
- "Black-out" → **"Unavailable"**.
- A day with nothing → **"Available"** (empty = available).
- **A day with events booked is "Limited availability," never "Unavailable"** — only true black-out/holiday dates are "Unavailable." Update the calendar legend, the modifier classes, and the day cells accordingly.

**The day view (right pane), on clicking a day:**
- Render hourly rows across the venue's operating hours (**Decision 3:** the hour range to show — e.g. 8 AM–11 PM, or align to the rate bands Before-12 / 12–3 / After-3 / After-9).
- Mark each hour **Available** or **Unavailable** based on bookings that overlap that hour.
- For an occupied block: if the booking **`is_public`** → show the **event details** (title, and for a programmed showing its normal public info); otherwise show **"Private event"** with the hours occupied but no identifying detail.
- A fully-open day reads all-available; a black-out/holiday reads all-unavailable with the reason.

**The structural problem to solve first (do not skip):** hourly occupancy needs a **reliable time range per booking**, and today rentals only have free-**text** times and the public can't read them at all. So this part depends on a data layer, chosen via **Decision 4**:
  - **(a, recommended) A privacy-safe availability view/RPC** that returns, for public consumption, one row per occupied block: `date`, `start`/`end` as real times, `is_public`, and — only when public — the display title. Populate it from (i) `showings` (already have `start_time` + duration → real hour span) and (ii) approved `rental_requests`, deriving a start/end from their times. Because the rental times are free text, either **normalize them into structured start/end at approval time** (a small migration + admin-side capture, so the availability data is trustworthy) or parse conservatively and fall back to **whole-day "Limited availability"** when a time can't be parsed (don't fabricate hour precision). Expose it to `anon` read-only, carrying **no private fields** — that's what makes showing rentals on a public page safe.
  - **(b) Day-granularity only:** keep the hourly grid for showings (which have real times) but mark rental days as whole-day "Limited availability — private event" without per-hour precision. Less work, honest about what's known, but doesn't fully meet "hours available vs unavailable" for rentals.
  - Recommend **(a)** with the parse-or-fallback rule so we never show a confident hour range we can't stand behind (mechanically-precise-but-wrong is worse than an honest "that day has a private hold").

## Part E — Replace the rate cards with the official rate grid (+ new After 9 PM row)
The current `RATES` array (flat `$400` half-day / `$700` full-day / `$250` / `$300`) does **not** match the official page — replace it with the day-of-week × time-band grid from `rental-rates-3.png`:

| Time band | Mon | Tue | Wed | Thu | Fri | Sat | Sun |
|---|---|---|---|---|---|---|---|
| **Before 12 PM** | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 |
| **12–3 PM** | $120/hr · min 3 | $120/hr · min 3 | $120/hr · min 3 | $120/hr · min 3 | $120/hr · min 3 | $120/hr · min 3 | $120/hr · min 3 |
| **After 3 PM** | $120/hr · min 3 | $120/hr · min 3 | $120/hr · min 3 | $180/hr · min 4 | $180/hr · min 4 | $180/hr · min 4 | $180/hr · min 4 |
| **After 9 PM** *(new)* | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 | $100/hr · min 3 |

- The pattern is uniform except **After 3 PM**, which is $120/min 3 on **Mon–Wed** and $180/min 4 on **Thu–Sun**. Model the data so that regularity is obvious (a band × day structure), not 28 copy-pasted cards.
- Add the **After 9 PM** row Tom specified: **$100/hr, minimum 3 hours**, all days (**Decision 5:** confirm all-days and whether After-9 overrides After-3 for late bookings, or is an additional late-night band).
- **Keep** the marquee ($150), the Fee Menu, and the Discounts as-is — those already match the official page. Render the grid responsively (a real table on desktop, a per-day stacked view on mobile so the columns don't crush at 375px).
- **Decision 6:** keep the four room/marquee flat cards anywhere (e.g. marquee $150), or is the venue now sold purely on the hourly grid? (Recommend: hourly grid is the rate structure; marquee $150 stays as its own line since it's priced differently.)

## Cross-cutting
- **Privacy is the theme of this page now:** never expose a private renter's `event_title`, name, or contact on the public page — the availability read must strip everything but occupied-hours + (public-only) title. This is also a fix to today's latent behavior (the old "Next on the calendar" would have shown approved rentals' `event_title` publicly if anon could read them).
- Accessibility: calendar day cells announce their status ("Available"/"Limited availability"/"Unavailable"); the day-view hourly rows are a proper list/table with status per row; the marquee form has labels, error text, and a visible focus path.
- Mobile: hero legible, rate grid stacks, day-view usable at 375/768/1280.
- Keep `SITE_URL`/routing conventions; the marquee form success/redirect mirrors `/rental-request`.

## Decisions for Tom
1. Hero: marquee-forward (recommended) vs separate rental hero beneath it.
2. Marquee form: reuse the `rental-request` edge function + `rental_requests` queue (recommended) vs new endpoint.
3. Day-view hour range: 8 AM–11 PM vs align to the rate bands.
4. Availability data: privacy-safe view/RPC with normalized times + parse-or-fallback (recommended) vs day-granularity for rentals.
5. After-9 PM row: all days at $100/hr min 3 (confirm), and whether it replaces or supplements After-3 for late starts.
6. Keep any flat room/marquee cards vs sell purely on the hourly grid (marquee $150 stays regardless).

## Test plan
- Rentals hero shows the marquee photo, cropped/framed to match the home hero at 375/768/1280; text stays legible over it.
- "See your name in lights" is at the **top** in the hero; **Book the marquee** opens a form (name, contact, marquee message, date) that submits through the secure pipeline and lands in the admin Rental Requests queue with `marquee_text` populated; no `mailto:` remains; success message sets expectations (request, not confirmation).
- Availability legend and cells read **Available / Limited availability / Unavailable**; booked days show as **Limited availability** (not Unavailable); only holidays/black-outs are Unavailable.
- Clicking a day fills the right pane with an **hourly day-view**; hours overlapping a booking read Unavailable, others Available; a **public** booking shows its details, a **private** one shows **"Private event"** with no identifying info; a wide-open day is all-available; a holiday is all-unavailable.
- No private renter data is exposed to an anonymous visitor (verify against the actual anon read path).
- The rate grid matches the table above including the new **After 9 PM $100/hr min 3** row; Mon–Wed vs Thu–Sun After-3 difference is correct; fees/discounts/marquee unchanged; grid is readable on mobile.
- `npm run build` + tests pass; add tests for the availability read (public vs private redaction; showing-with-duration hour span; unparseable rental time → whole-day fallback).

---
*Asset note:* the marquee hero image Tom supplied needs optimizing into the `hero-768/1280/1920.{jpg,webp}` responsive set (same as the home hero) before it ships — Claude can prepare that optimized set and hand it over, or Claude Code can run the existing image-optimization step on the source.
