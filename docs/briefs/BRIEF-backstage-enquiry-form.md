---
brief: backstage-enquiry-form
title: "Enquire about booking Backstage" opens a Backstage-scoped form, not the theatre rental sheet
status: built
track: ux
severity: P2
date: 2026-08-25
---

# Brief (for Claude Code): "Enquire about booking Backstage" should open a Backstage-specific form

**Status:** 🟢 Small, high-clarity fix. No dedicated Backstage form exists today — the button opens the full theatre rental form. Recommended fix reuses that form in a scoped "Backstage mode" rather than duplicating it.
**Date:** August 25, 2026
**Requested by:** Tom — the **"Enquire about booking Backstage"** button opens the general theatre rental form, which is wrong; it should be specific to Backstage. He thinks a Backstage form already exists — it doesn't, so build the Backstage-specific experience.

## Current state (verified)
- **The button goes to the generic form.** `Backstage.tsx:259` → `<Link to="/rental-request">Enquire about booking Backstage</Link>`. A code comment right above it (L256) notes the request form "has carried `backstage_speakeasy` since before this" — i.e. the intent was always that Backstage routes here, but nothing scopes the form to Backstage.
- **`RentalRequest.tsx` is the full theatre rental form (368 lines).** It asks for `venue_area` via a radio (`main_auditorium_projection`, `main_auditorium_no_projection`, `main_stage`, `backstage_speakeasy`), plus arrival/event/departure times, an **equipment quantity list**, **projection/DVD/streaming media provisioning**, ticketed/public toggles, marquee text, etc. Most of that is **irrelevant to a Backstage speakeasy enquiry** and makes the form read as "not for Backstage."
- **No Backstage-specific form or route exists.** `backstage_speakeasy` is only an option inside the generic form.
- The form **already imports `useSearchParams`** (`RentalRequest.tsx:36`) but `venue_area` defaults to `''` and isn't prefilled from a param — so scoping by URL is a small wiring change, not new plumbing.
- **Submission pipeline (reuse it):** the public rental form submits through the **Turnstile-verified `rental-request` edge function** (writes as `service_role`; `anon` can't insert directly) into `rental_requests`, landing in the admin Rental Requests queue. Any Backstage variant must go through this same pipeline.

## The change — a Backstage-scoped enquiry (Decision 1)
### Option A (recommended): reuse the form in "Backstage mode"
Render the existing `RentalRequest` form scoped to Backstage rather than building a second form (which would duplicate validation, Turnstile, and the secure submission path):
1. **Entry point (Decision 2):** a dedicated route `/backstage-enquiry` (clean, shareable) that renders the shared form component in **Backstage mode** — or `/rental-request?area=backstage_speakeasy`. Recommend the dedicated route rendering the same component with a `mode="backstage"` prop.
2. **In Backstage mode:**
   - **Pre-select and lock `venue_area = 'backstage_speakeasy'`** — hide the venue radio (or show it as a read-only "Backstage Speakeasy" label), so the enquiry can't be mis-scoped.
   - **Hide the irrelevant sections:** main-auditorium/projection options, seating, the projection/DVD/streaming media provisioning block, and the large equipment list (keep only what applies to Backstage — Decision 3).
   - **Keep the Backstage-relevant fields:** contact details, proposed date (+ end date if multi-day), arrival/event/departure times, expected guests, concessions / beer & wine (which do apply to Backstage), event description, and optionally marquee text.
   - **Backstage-specific copy:** title/intro that says this is a Backstage speakeasy enquiry, matching the Backstage page's voice — so it clearly reads as "for Backstage."
3. **Submit through the same `rental-request` edge function** with `venue_area='backstage_speakeasy'`, so it lands in the same admin queue, tagged Backstage. Same Turnstile, validation, and "this is a request, not a confirmation" success copy.
4. **Point the button at it:** `Backstage.tsx:259` → the Backstage entry (`/backstage-enquiry` or the param URL).

### Option B (if Tom wants a fully separate form)
Build a standalone leaner Backstage enquiry page with only Backstage fields and its own copy, still submitting through the `rental-request` edge function with `venue_area='backstage_speakeasy'`. More code and a second form to maintain; only worth it if the Backstage enquiry should diverge substantially from the rental fields. Recommend A unless Tom wants B.

## Cross-cutting
- **Don't fork the submission path** — reuse the Turnstile-verified `rental-request` function so Backstage enquiries get the same anti-spam, validation, and admin-queue handling. The allowlist must accept a Backstage-scoped payload (many rental fields absent) — confirm.
- The admin Rental Requests queue should show these clearly as Backstage (the `venue_area` badge already exists there).
- Accessibility/mobile: the scoped form keeps labels, error text, focus path, and is responsive; the locked venue is announced correctly.
- Keep it honest: submitting sends an **enquiry**, not a booking — mirror the existing success wording.

## Decisions for Tom
1. Reuse the rental form in a scoped **Backstage mode** (recommended) vs a fully separate Backstage form.
2. Entry: dedicated `/backstage-enquiry` route (recommended) vs `/rental-request?area=backstage_speakeasy`.
3. Which fields to keep for Backstage (contact, date/times, guests, concessions/beer-wine, description, optional marquee — recommended) vs also keep any of the equipment/media fields.
4. Lock the venue as Backstage hidden vs shown read-only.

## Test plan
- The Backstage page's **"Enquire about booking Backstage"** opens a form that is **clearly for Backstage** (title/copy), with the venue fixed to Backstage Speakeasy and the auditorium/projection/seating/equipment/media clutter removed.
- Submitting creates a `rental_requests` row with `venue_area='backstage_speakeasy'` via the Turnstile-verified `rental-request` function, appearing in the admin queue tagged Backstage; success copy says it's an enquiry, not a confirmation.
- The venue can't be changed away from Backstage in this flow; validation, Turnstile, and error handling match the main rental form.
- The general `/rental-request` form is unaffected for full-theatre enquiries.
- Accessible and responsive at 375/768/1280; `npm run build` + tests pass.

## What was built

Option A, with Tom's answers to the four decisions.

1. **Backstage mode, not a second form.** `RentalRequest` takes a
   `mode?: 'theatre' | 'backstage'` prop. One component, one payload shape, one
   Turnstile wiring, one edge function.
2. **`/backstage-enquiry`**, a route of its own — `src/pages/BackstageEnquiry.tsx`
   is four lines that pick the mode. A URL staff can paste into a text message,
   and a page that can be `noindex` without touching the theatre form.
3. **Fields.** Kept: contact block, dates, arrival/start/end/departure times,
   marquee, concessions & beer/wine, guests, age range, accessibility, event
   description, activity order — **and Ticketing** (Tom's call: Backstage hosts
   real ticketed events, and three toggles are cheap to answer). Hidden:
   Equipment Requests, Film / Media.
4. **Venue shown read-only** (Tom's call) as a filled chip rather than a
   bordered box, because an empty-looking field with text in it reads as an
   input that has gone wrong.

Copy is Backstage-specific throughout: heading, intro, the footer note
("This is an enquiry, not a booking."), the submit button ("Send Enquiry"), and
the thank-you card, which returns to `/backstage` rather than the home page.

### Two things the brief did not anticipate

- **`/backstage-enquiry` is `noindex`.** `/backstage` is deliberately unlisted —
  one link to it in the whole site, `noindex` on the SEO tag, absent from
  `sitemap.xml` and `llms.txt`. A crawlable enquiry form is a second front door
  into the same room, so this one is unlisted the same way. `/rental-request`
  stays indexed.
- **No label on this form was associated with its input.** Every `<Label>` in
  `Field`, `ToggleRow` and the equipment rows rendered without `htmlFor` and
  without nesting the control, so clicking "Email" did not focus the email box
  and a screen reader read the whole sheet as unlabelled text boxes. Nothing
  catches that on its own — valid markup, correct layout, working submit. Found
  because `getByLabelText` could not find a single field. Fixed in `Field`,
  `ToggleRow` and the equipment rows, which fixes **both** forms.

The projection questions are also deleted from the Backstage payload rather than
sent as `false`. Left in, they reach the admin queue as a considered "no" to
something nobody was asked.

### Not changed

- `supabase/functions/rental-request` — the allowlist is optional on every field
  except `event_title`, `applicant_name` and `email`, so a Backstage-scoped
  payload already passes. Confirmed by reading it, not by assuming.
- The admin queue already prints `venue_area` as "backstage speakeasy"
  (`RentalRequestsTab.tsx:307`).
- `/rental-request` — same four venue radios, same equipment list, same
  "Send Request". Guarded by a test.

### Verification

- `src/pages/RentalRequest.test.tsx` — four tests: the enquiry submits
  `venue_area='backstage_speakeasy'` with no radio to get it wrong with; the
  media keys are absent from the payload; Concessions, Ticketing, times and
  guests survive; and the theatre form still offers every venue and the full
  sheet.
- `npx tsc -p tsconfig.app.json --noEmit` clean; `npx vitest run` 52 files,
  656 passed; `npm run build:staging` clean.
- Walked both routes in the browser against a staging dev server: the Backstage
  button lands on `/backstage-enquiry`, the venue reads Backstage Speakeasy and
  cannot be changed, Equipment and Film/Media are gone, Turnstile renders, and
  `/rental-request` is unchanged.

**Not verified:** a live submission (that writes a real row to the staging
queue), and the 375/768 breakpoints — the driven Chrome tab's viewport is pinned
at 1280. The layout is the existing form's responsive grid with two sections
removed, so nothing new was introduced at those widths.
