---
brief: film-pass-detail-pages
title: Give each film pass its own purchase page
status: built
track: ux
severity: P2
date: 2026-08-25
verified: false
---

# Brief (for Claude Code): Give each film pass its own purchase page

**Status:** 🟢 New per-pass route that reuses the existing purchase logic and checkout function. Mostly a split of the current all-in-one page; care items are back-compat links and invalid-id handling.
**Date:** August 25, 2026
**Requested by:** Tom — clicking a festival pass's "Buy" button lands on a page that shows **all** available passes (a chooser), which is confusing. Give **each pass its own dedicated purchase page**, with its own information, like a ticket purchase page.

## Current state (verified)
- **One page sells every pass.** `src/pages/FilmPasses.tsx` (`/film-passes`) loads **all active** `film_pass_types`, renders them as a **selectable card list** ("Choose a pass"), then quantity, fulfillment (pickup/mail), buyer details, and a sticky **Order Summary + Square payment**.
- `?pass=<id>` only **pre-selects** a card (`requestedPassId`) — every other pass still shows, so the buyer lands on a chooser, not "this pass." That's the confusion.
- The **Silent Film Festival page** links here: `SilentFilmFestival.tsx:487` → `/film-passes?pass=${pass.id}`.
- **Checkout is already per-pass:** `handleBuy` calls the `film-pass-checkout` edge function with a single `pass_type_id`, `quantity`, `fulfillment`, buyer fields, `idempotency_key`. The server prices from `film_pass_types` and is the authority. **No checkout change is needed** — we're just changing which page collects one pass.
- **Pass data available** (`film_pass_types`): `name, price, initial_balance, redemption_price, ticket_face_value, expiration_days, image_path, fine_print`. Richer "what this pass covers" is derivable from **`pass_type_showings`** (the SFF page already uses it to list the screenings a festival pass admits).
- Important product rule already baked into this flow: **a film pass is a physical card** — no QR, the post-purchase copy says "collect it / it's in the mail," not "here is your pass." Preserve that on the new page verbatim.

## The change — a dedicated per-pass page
### 1. New route + page
- Add `/film-pass/:id` (singular, mirroring `/showing/:id`) → a new `FilmPassDetail.tsx` that shows **one** pass and its purchase flow. **Decision 1:** `/film-pass/:id` (recommended) vs `/film-passes/:id`; **Decision 2:** id in the URL (recommended, simplest, matches showings) vs a slug.
- The page fetches just that pass by id (`is_active`), and renders a **ticket-style detail layout**: large artwork (`image_path` via `passImageUrl`), name, price, **what it's good for** (films count + `ticket_face_value` "tickets that cost $X at the door"), **validity** (`expiration_days`), and the **fine print** (`RichText fine_print`) — the same facts the current page shows, but presented as *the* product, not one option among many.
- **Enrichment (Decision 3, recommended for the festival case):** when the pass has `pass_type_showings`, list **which screenings/films it admits** (reuse the SFF page's derivation) so a festival-pass page tells the buyer exactly what they're getting — the pass equivalent of a showtimes list on a ticket page.
- Reuse the **exact purchase controls** from `FilmPasses.tsx` — quantity (≤10), pickup/mail + address, buyer name/email/(phone via `COLLECT_PHONE`), the sticky Order Summary with the same per-pass tax math (`PASS_TAX_RATE`), the `SquareCardForm`, and `film-pass-checkout` with the same idempotency handling and the same post-purchase "physical card / collect it / no QR" confirmation. **Extract the shared purchase panel into a component** used by both the detail page and (if kept) the list — don't fork two copies of the money path.

### 2. Point entries at the per-pass page
- **SFF page:** change `/film-passes?pass=${pass.id}` → `/film-pass/${pass.id}` (`SilentFilmFestival.tsx:487`).
- Anywhere else that links to a specific pass should use the new route.

### 3. What `/film-passes` becomes (Decision 4)
- **(a, recommended)** Turn `/film-passes` into a **gallery/index**: each active pass is a card linking to its own `/film-pass/:id` page (no inline chooser, no payment form on the index). This removes the "all passes at once" confusion at the source while keeping a browse surface for people who arrive without a specific pass in mind.
- **(b)** Keep `/film-passes` as the current chooser for direct visitors, and only add the per-pass pages for deep links. (Less clean — leaves the confusing chooser in place.)
- Recommend **(a)**.

### 4. Back-compat + edge cases
- **Old links keep working:** `/film-passes?pass=<id>` should **redirect** to `/film-pass/<id>` (printed flyers, past emails, the current SFF link before it's updated). Don't break existing links.
- **Invalid / retired / inactive id:** show a graceful "this pass isn't on sale" state with a link to the pass gallery (mirror the current "nothing for sale" copy), not a hard crash or a blank chooser.
- **SEO per pass:** `SEO` title/description (and OG image = the pass artwork) specific to the pass, like ticket pages — so a shared festival-pass link previews as that pass.

## Cross-cutting
- Keep the physical-card framing and the exact confirmation wording (no QR, "collect at the box office / in the mail").
- Accessibility: the detail page is a proper document (h1 = pass name), the purchase controls keep their labels/focus, artwork has alt.
- Mobile: detail + sticky summary stack cleanly at 375/768/1280 (reuse the existing responsive summary).
- No change to `film-pass-checkout`, tax math, idempotency, or the silent-account/guest pattern.

## Decisions for Tom
1. Route: `/film-pass/:id` (recommended) vs `/film-passes/:id`.
2. URL key: id (recommended) vs slug.
3. Show the screenings a pass admits (via `pass_type_showings`) on its page (recommended, esp. for the festival) vs price/validity only.
4. `/film-passes` becomes a gallery of links (recommended) vs keep the chooser.
5. Add a longer pass **description** field to `film_pass_types` for richer per-pass copy (optional — `fine_print` + derived screenings may be enough).

## Test plan
- Clicking the festival pass on the SFF page lands on a page showing **only that pass**, with its artwork, price, what it covers, validity, and fine print — no other passes visible.
- Buying from the per-pass page charges the correct amount (same tax/total as before), records the order via `film-pass-checkout`, and shows the same physical-card confirmation (no QR); idempotent re-submit doesn't double-charge.
- `/film-passes` (per Decision 4) is a gallery whose cards each open the right `/film-pass/:id`.
- An old `/film-passes?pass=<id>` link redirects to `/film-pass/<id>`; an unknown/inactive id shows the graceful not-on-sale state.
- Per-pass SEO/OG reflects the specific pass; the page is accessible and responsive.
- Quantity ≤10, pickup/mail + address validation, buyer fields, and `COLLECT_PHONE` behavior all match the current page (shared component, no divergence).
- `npm run build` + tests pass.

---

## Outcome (built 2026-08-27, not yet deployed)

All five decisions were taken as recommended, except #5 which was not needed.

| # | Decision | Taken |
|---|---|---|
| 1 | Route | `/film-pass/:id`, singular, mirroring `/showing/:id` |
| 2 | URL key | id |
| 3 | Show the screenings a pass admits | yes, scoped — see below |
| 4 | What `/film-passes` becomes | a gallery of links; no payment form on that route |
| 5 | Add a `description` column | **not done** — `fine_print` plus the derived screenings covered it, and an unused column is a migration nobody can justify later |

### What shipped

- `src/lib/filmPass.ts` — the `PassType` shape, the column list, and the money
  and offer derivations the three surfaces share. Unit-tested in
  `filmPass.test.ts`, including that tax rounds *per pass* so two cost exactly
  twice one.
- `src/components/FilmPassPurchase.tsx` — the money path, exactly once.
  Quantity, fulfillment, address, buyer fields, the sticky summary, the Square
  form, `film-pass-checkout`, and the idempotency-key handling, all lifted
  unchanged. The pass is a prop; the page supplies its own presentation through
  `children`.
- `src/pages/FilmPassDetail.tsx` — one pass as the product, plus the
  post-purchase confirmation. The physical-card framing is preserved verbatim:
  no QR, "collect it / it's in the mail", nothing to screenshot.
- `src/pages/FilmPasses.tsx` — now a gallery. `?pass=<id>` redirects to
  `/film-pass/<id>` before any fetch, so old flyers and emails keep working.
- `src/pages/SilentFilmFestival.tsx` — links to `/film-pass/${pass.id}`, and
  the button reads **Get Festival Pass** (title case, matching *Get Tickets*)
  rather than the more verbose "Buy the festival pass".

### The one thing the brief did not anticipate

"List which screenings a pass admits" is safe for a festival pass and a trap
for the standard one. Measured against production: the Silent Film Festival
pass is tagged to **3** screenings; the 10-film pass is tagged to **1,108**,
past ones included. Rendering that list would be a wall of text, and it would
also cross PostgREST's silent 1000-row cap and quietly truncate.

So the query filters from the `showings` side with an `!inner` join on
`pass_type_showings`, asks only for `start_time >= now`, orders by date, and
takes `SCREENING_LIMIT + 1` rows — the extra row is how the page knows to say
"and more" instead of implying it has listed everything. Filtering the embedded
resource instead would null the embed on non-matching rows rather than dropping
them, and the limit would then count rows that were never going to render.

### Verified

`tsc -p tsconfig.app.json --noEmit`, `vitest run` (48 files, 569 passing),
`build:staging`. Driven in the browser against staging: the festival page's
button lands on that pass alone; tax and total match the previous page
($50 → $53.00, $60 → $63.60); the screenings list renders for the pass that has
upcoming ones; `?pass=<id>` redirects; an unknown UUID *and* a non-UUID string
both reach the "isn't on sale" state rather than a crash or a blank chooser;
no console errors.

Not verified: the mobile breakpoints. The driven Chrome tab's viewport is
pinned at 1280 and cannot be resized, so the 375/768 layouts rest on the same
responsive classes the previous page already used.
