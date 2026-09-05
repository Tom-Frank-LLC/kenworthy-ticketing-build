# Accessibility audit — WCAG 2.2 Level AA

**Audited:** 23 August 2026, **re-baselined and remediated 4 September 2026**
against `e1cea1c` · staging data
**Standard:** WCAG 2.2 Level AA (what ADA Title III and Section 508 are read against)
**Scope:** all 18 public routes, the three money paths in their *interactive* states, and the admin dashboard
**Brief:** `docs/briefs/BRIEF-accessibility-ada.md`

---

## How this was measured

Two scripts, both kept in the repo so the numbers can be reproduced and re-run
after each fix:

| script | what it does |
|---|---|
| `scripts/a11y-audit.mjs` | axe-core over 18 public routes (`--admin` adds the staff routes), 1280×900, logged out. Also records `<h1>` count, heading order and landmark counts per page. |
| `scripts/a11y-flows.mjs` | Clicks *into* each money path and scans there. Also dumps the computed accessible name of every visible control, which is how placeholder-only fields and icon-only buttons were found. |

Neither is a dependency: they need a running dev server and a real Chrome,
which CI has neither of.

```bash
npm install --no-save axe-core puppeteer
npm run dev -- --mode staging
node scripts/a11y-audit.mjs
node scripts/a11y-flows.mjs
```

Manual passes on top of that: keyboard-only traversal of the three money paths,
contrast computed from the shipped tokens rather than sampled from a screenshot
(`--- contrast ---` below), heading/landmark structure, `prefers-reduced-motion`,
target size at 390px, and an inventory of patron-facing PDFs and media.

**The automated pass is not the audit.** Every one of the four most serious
findings below — the film-pass selector, the ticket stepper, the `Field` helper,
the missing skip link — is invisible to axe on a first-paint scan of the route.
Two of them are invisible to axe entirely.

---

## Automated baseline

axe-core, tags `wcag2a wcag2aa wcag21a wcag21aa wcag22aa best-practice`,
18 public routes, logged out:

| rule | impact | nodes | pages |
|---|---|---:|---:|
| `color-contrast` | serious | 25 | 18 |
| `label` | critical | 20 | 1 |
| `nested-interactive` | serious | 7 | 1 |
| `button-name` | critical | 7 | 1 |
| `heading-order` | moderate | 4 | 4 |
| `link-in-text-block` | serious | 3 | 2 |
| `target-size` | serious | 1 | 1 |

Interactive states (`a11y-flows.mjs`) add `button-name` ×2 on `/showing/:id`
and a second `color-contrast` failure the moment a form error renders.

The admin dashboard, signed in, on a cheaper rule subset:

| rule | impact | nodes |
|---|---|---:|
| `button-name` | critical | 2 619 |
| `link-name` | serious | 2 615 |

Both come from one row template each. `/admin` renders **76 193 DOM nodes** —
it lists all 1 792 showings at once — which is why the full rule set does not
finish on it.

### What is already right

Worth recording, because it is what the remediation must not break:

- **One `<h1>` per page on all 18 routes.** `<main>`, `<nav>`, `<header>`,
  `<footer>` present on every one. `<html lang="en">` is set.
- **`SeatMap`** — every seat is a real `<button>` with a descriptive
  `aria-label` ("Row C seat 14, Balcony, $12.00"), 28×28px, and the zoom
  controls are labelled. It is the best-built interactive surface in the app.
- **The Silent Film Festival programme carousel** — `role="group"`,
  `aria-roledescription="carousel"`, arrow-key navigation, labelled
  prev/next, and an `aria-live` page counter.
- **`MobileNav`** — labelled trigger, `nav` landmark, real `SheetTitle`.
- **`DonationPrompt`** already uses `aria-pressed` on its amount buttons. That
  is the pattern the rest of the app should copy; it exists here already.

---

## Findings

Severity is ADA exposure, not axe impact: **P0** blocks a purchase for someone
using a screen reader or keyboard, **P1** is an AA failure on a public page,
**P2** is admin or non-blocking, **P3** is polish.

### P0 — a patron cannot complete a purchase

| # | criterion | page | finding | fix |
|---|---|---|---|---|
| 1 | 4.1.2 Name, Role, Value | `/showing/:id` | The **ticket quantity − / + buttons have no accessible name**. Icon-only `Button size="icon"` with no `aria-label`; a screen reader announces "button, button". This is the only way to add a ticket on a GA showing, so the primary money path is unusable. Both the GA and the tiered branch. | `aria-label` on both, plus an `aria-live` announcement of the new count. `src/pages/Showing.tsx:748,752,771,775` |
| 2 | 4.1.2 · 1.3.1 | `/film-passes` | The **pass cards and the delivery-method cards are `role="button"` with no selected state**. Nothing exposes which pass is chosen — no `aria-pressed`, no `aria-checked`. They are a single-select group rendered as unrelated buttons. | Make each group a real `radiogroup` (`role="radio"` + `aria-checked`, or native radios), in a `fieldset` with a `legend`. `src/pages/FilmPasses.tsx:288,381` |
| 3 | 2.4.7 Focus Visible | `/film-passes` | Those same cards have **no focus indicator**. `ui/card.tsx` has no `focus-visible` style and the page adds none, so a keyboard user tabbing through the passes sees nothing move. | Focus ring on the selectable card, systemically. |
| 4 | 3.3.1 Error Identification · 3.3.3 · 4.1.3 | ticket checkout, film pass, donate | **Validation errors are unassociated `<p>` elements.** No `aria-describedby`, no `aria-invalid`, no live region. Submit an invalid checkout with a screen reader and nothing at all is announced — the button simply does not proceed. | A shared field wrapper that wires `aria-describedby`/`aria-invalid`, plus an `role="alert"` error summary. |
| 5 | 1.4.3 Contrast (Minimum) | everywhere errors render | `--destructive` (`#dc2828`) is **4.00:1 on the page background and 3.74:1 on a card** — below AA. Every error message in the app is the text a patron most needs to read, in the one colour that fails. `--destructive-foreground` on `--destructive` is 4.44:1, also below AA. | Token fix, below. |

### P1 — AA failure on a public page

| # | criterion | page | finding | fix |
|---|---|---|---|---|
| 6 | 1.3.1 · 3.3.2 Labels or Instructions | `/rental-request` | **20 inputs with no programmatic label.** Root cause is one helper: `Field` renders `<Label>` with no `htmlFor` and gives its child no `id` (`src/pages/RentalRequest.tsx:352`). | Generate an id in `Field`, pass it to the child, point the `Label` at it. One edit clears all 20. |
| 7 | 4.1.2 | `/rental-request` | **7 switches with no accessible name.** Same shape: `ToggleRow` puts the text in a `<Label>` that references nothing (`:362`). | `htmlFor` + `id` on the `Switch`. Clears all 7. |
| 8 | 2.1.1 Keyboard · 2.5.8 Target Size | `/calendar` | The month grid nests focusable event `<button>`s inside a `role="button" tabIndex={0}` day cell (`nested-interactive` ×7). The nested buttons are **19.7px tall**, under the 24px minimum, and stacked with 4px between them. The grid is also 35–42 tab stops before the day list. | Take `role="button"`/`tabIndex` off the cell, keep the click for mouse users, and put the keyboard affordance on a labelled day button; give the event buttons `min-h-6`. |
| 9 | 2.4.1 Bypass Blocks | every page | **No skip-to-content link.** The header is 8–14 tab stops (logo, Calendar, Rentals, two dropdowns, Donate, Tickets, Film Pass) and it repeats on every route. | Skip link in `Layout`, `<main id="main-content">`. |
| 10 | 1.4.3 | every page | `text-muted-foreground/70` on the footer "Staff login" link is **4.45:1**. Computed exactly: `/50` → 2.88, `/60` → 3.62, `/70` → 4.50, `/75` → 5.02. **The project's own rule in `CLAUDE.md` says `/60` and below fails — `/70` fails too.** 9 uses across the app. | Solid `text-muted-foreground` (8.13:1), and correct the rule in `CLAUDE.md`. |
| 11 | 1.4.3 | `/rentals` | The date picker paints selected and today's cells `bg-primary/80`, which composites to `#915bb0` — **3.98:1** against the near-black day number. Solid `bg-primary` is 5.56:1. | Drop the opacity. `src/components/ui/calendar.tsx` |
| 12 | 1.4.1 Use of Colour · 1.4.3 | `/privacy`, `/terms` | Inline links are `text-primary` inside `text-muted-foreground` prose: **1.46:1 against the surrounding text**, and underlined only on hover. Colour alone distinguishes them, and barely. | Persistent underline on in-prose links. |
| 13 | 2.3.3 · 2.2.2 (and 1.4.x comfort) | site-wide | **`prefers-reduced-motion` is honoured in exactly two places** — `TrailerFeed` (which does check it properly) and the `.snap-feed` scroll snap. The accordion, every Radix `animate-in`/`animate-out` (43 uses), `animate-fade-in`, the neon glows and every `transition-*` ignore it. | One global `@media (prefers-reduced-motion: reduce)` block in `index.css`. |
| 14 | 1.3.1 Info and Relationships | `/calendar`, `/history`, `/auth`, `/showing/:id`, `/silent-film-festival` | **`heading-order`: `<h1>` → `<h3>`.** Root cause is `ui/card.tsx`, where `CardTitle` always renders `<h3>`; any card directly under the page `<h1>` skips a level. | An `as` prop on `CardTitle`, then set the right level at each call site. |
| 15 | 2.5.8 Target Size | mobile (390px) | The **dialog and sheet close buttons are 18×18px**, under the 24px minimum. `ui/dialog.tsx:45`, `ui/sheet.tsx:69`. Hit by every patron who opens the mobile menu. | Padding to bring the target to ≥24px. |
| 16 | 4.1.2 | `/donate` | The **amount tiers and the dedication buttons carry no `aria-pressed`**, so the chosen amount is not announced. The **custom amount input is placeholder-only** — no `<label>`. The "Amount" `<Label>` above it references no control. | `aria-pressed`, a real label, and a `fieldset`/`legend` for the tier group. `src/pages/Donate.tsx:186,211,250` |
| 17 | 3.3.2 | every page (footer) | `NewsletterSignup`'s email input is **placeholder-only**. | `sr-only` label. |
| 18 | 1.1.1 Non-text Content | `/silent-film-festival` | The festival programmes. **Corrected — see the file inventory below; the first version of this finding was wrong.** The displayed slides are page images with no text, but each year also offers a downloadable PDF, and one of those PDFs does carry a real text layer. The gap is per-year, not blanket. | Per-year, see below and *Open for Tom*. |
| 19 | 1.2.2 Captions | `/showing/:id`, home | Trailers. **788 in production, and every single one is a YouTube or Vimeo embed — there is not one self-hosted video file on the site.** The `<video controls>` branch in `ProductionMedia` is unreachable with current data. We cannot caption someone else's file. | Partly fixed: the embed now asks the player to switch on whatever caption track it already has. See below. |
| 20 | 4.1.2 | `/calendar` | The list/month switch declares `role="tablist"` + `role="tab"` with **no `tabpanel`, no `aria-controls`, and no arrow-key roving focus** — an incomplete tabs pattern promises behaviour that is not there. Same in `home/UpcomingList.tsx`. | Toggle buttons with `aria-pressed` in a labelled group, which is what they actually are. |

### P2 — admin (staff only, but the same law applies to employees)

| # | criterion | finding | fix |
|---|---|---|---|
| 21 | 2.4.4 · 4.1.2 | **2 615 icon-only edit links with no accessible name** — `<Link><Edit/></Link>`, one per movie and per showing row. `src/pages/admin/AdminDashboard.tsx:836,872` | `aria-label` naming the row's subject. |
| 22 | 4.1.2 | **2 619 `role="combobox"` triggers with no accessible name** — one Select per row. | `aria-label` on the trigger. |
| 23 | — | `/admin` renders **76 193 DOM nodes**. Assistive technology has to build a tree over all of it; screen readers get very slow, and it is why axe cannot finish. A performance problem that presents as an accessibility one. | Paginate or virtualise. Out of scope here; recorded so it is not rediscovered. |
| 24 | 4.1.2 | `SeatMap` seats have no `aria-pressed`, so a selected seat is not announced. Tier-tinted seats use `text-white` over an admin-chosen colour with no contrast floor. | `aria-pressed`; a contrast check on the tier colour picker. |

### P3

| # | criterion | finding |
|---|---|---|
| 25 | 1.3.1 | The header's own links (Calendar, Rentals, Info, Support) sit in a bare `<div>`; only the right-hand button cluster is inside the `<nav aria-label="Primary">`. The footer link block is in no landmark. |
| 26 | 1.4.3 | `text-muted-foreground/50` on the footer separator bullets — 2.88:1. `aria-hidden`, so decorative, but a visible glyph either way. |
| 27 | 3.2.2 | The film-pass and month-calendar `role="button"` handlers act on `Space` `keydown` without `preventDefault()`, so Space also scrolls the page. |

---

## Contrast — computed, not sampled

From the shipped tokens in `src/index.css`, sRGB relative luminance per WCAG:

| pair | ratio | AA text | AA large/UI |
|---|---:|:--:|:--:|
| `foreground` on `background` | 17.00 | pass | pass |
| `muted-foreground` on `background` | 8.13 | pass | pass |
| `muted-foreground` on `card` | 7.61 | pass | pass |
| `primary` on `background` | 5.56 | pass | pass |
| `primary-foreground` on `primary` | 5.56 | pass | pass |
| `accent` on `background` | 8.91 | pass | pass |
| `accent-foreground` on `accent` | 8.91 | pass | pass |
| `success` / `success-foreground` | 6.46 | pass | pass |
| **`destructive` on `background`** | **4.00** | **FAIL** | pass |
| **`destructive` on `card`** | **3.74** | **FAIL** | pass |
| **`destructive-foreground` on `destructive`** | **4.44** | **FAIL** | pass |

So the amethyst is fine — 5.56:1, comfortably over the 4.5 floor, and the brief's
"~4.6:1" figure was pessimistic. **The one failing token is `--destructive`**, and
it fails in both directions at once: too dark to read as text on the dark theme,
too dark for cream to sit on as a fill.

The project has solved this exact problem before. The note above `--success` in
`index.css` records it: cream on emerald was 2.75:1, and the fix was to lighten
the fill and put off-black on top. `--destructive` is the same shape and takes the
same answer:

```
--destructive: 0 70% 66%;          /* #e56c6c */
--destructive-foreground: 0 0% 6%;
```

| after | ratio |
|---|---:|
| destructive text on `background` | 6.11 |
| destructive text on `card` | 5.71 |
| destructive text on `secondary` | 4.95 |
| `destructive-foreground` on `destructive` | 6.11 |

One token, all four pass. It is a visible change: destructive buttons go from
deep red to a lighter coral with dark text, matching how `primary`, `accent` and
`success` already work in this theme. 18 `bg-destructive` sites are affected.

Faded utilities, composited against `#0f0f0f`:

| class | ratio | |
|---|---:|:--|
| `text-muted-foreground/50` | 2.88 | fail |
| `text-muted-foreground/60` | 3.62 | fail |
| `text-muted-foreground/70` | 4.50 | fail |
| `text-muted-foreground/75` | 5.02 | pass |

`CLAUDE.md` currently says "`/60` and below fails". **`/70` fails too** — it lands
on 4.50 by rounding and axe measures it at 4.45. The rule should be: no faded
`muted-foreground` for text at all.

---

## Patron-facing documents and media

| item | where | state |
|---|---|---|
| Concessions menu | `home/ConcessionsPreview.tsx` | **Already HTML text**, read live from `concession_items`. No PDF, nothing to fix. |
| Silent Film Festival programmes | `/silent-film-festival` | Mixed. See the per-file inventory below. |
| Concession menu PDFs | `admin/ConcessionMenusTab.tsx` | Admin-only upload surface; not linked to patrons. |
| Rental contracts | `/contract/:token` | Generated from HTML by `html2pdf`, so the source is real text. The generated PDF is untagged, but the renter reads and signs the HTML. |
| Trailers | home, `/showing/:id` | 788 embeds, **all third-party**. No self-hosted video at all. |

The brief anticipated patron-facing menu PDFs. There are none — the menu was
already rebuilt as live HTML.

### The festival programmes, file by file

The first version of this audit recorded these as "scanned page images" with no
text equivalent. That was drawn from what the page *displays* — the slideshow —
without opening the PDF sitting behind the download link next to it. It was
wrong for 2025. Measured with `pdftotext` and `pdfinfo` against production
storage:

| year | slides | booklet PDF | text layer | tagged | verdict |
|---|---|---|---|---|---|
| 2025 | 8 page JPGs | 8pp, macOS Quartz | **yes** — 7.6 KB extracts cleanly, embedded CID fonts | no | Readable by a screen reader. Reading order and structure are not guaranteed. |
| 2024 | 12 page JPGs | 12pp, exported from Canva | **no** — 12 bytes, and `pdffonts` reports no embedded fonts at all: every page is a flattened raster | no | Not readable. Needs OCR or a re-export. |
| 2023 | 8 page JPGs | **none** | n/a | n/a | Not readable. No PDF exists to fix. |

Two distinct problems, not one:

- **2024 and 2023 have no machine-readable text anywhere.** 2024's Canva export
  flattened the whole booklet to images; 2023 was never given a PDF.
- **2025 has text but no tags.** An untagged PDF is readable — a screen reader
  will speak it — but nothing marks headings, reading order or image
  alternatives, so a multi-column programme page can be read out in the wrong
  order. Better than nothing, short of good.

The cheap repair for 2024 is a re-export from the original Canva document with
text preserved, which costs nothing if the source file still exists. Failing
that, OCR. The repair for 2023 is finding the original.

### Trailer captions

Every trailer is a YouTube (772) or Vimeo (16) embed. That settles what is
possible: we do not produce these files and cannot add a caption track to
them. What we *can* do is ask the player to turn on whatever track the
distributor already supplied — including YouTube's auto-generated one.

`resolveTrailer` now sets `cc_load_policy=1` on YouTube and `texttrack=en` on
Vimeo, but only when `controls` is on. That flag is what separates the real
player on a showing page from the muted ambient marquee on the home page, and a
silent background clip has no audio to caption.

This is a genuine improvement and not a claim of conformance: a trailer whose
distributor supplied nothing still has nothing. What keeps that from being a
1.2.2 failure of *ours* is that a trailer is never the sole source of anything —
title, date, time, price and synopsis are always in text on the same page.

---

## Re-baselined and remediated, 4 September 2026

The August audit was measured against `fbf2ba6` and never shipped. By 4
September `main` was **115 commits ahead**, and 24 of the files the audit
touched had changed under it, so the fixes were **re-derived against today's
code rather than replayed**. That was the right call twice over:

**Three findings had already been fixed by other sessions**, and re-applying
the August diff would have reverted or duplicated their work:

- `/rental-request`'s 20 unlabelled inputs and 7 unnamed switches — `Field` and
  `ToggleRow` were repaired independently with `cloneElement` +
  `aria-labelledby`. A different approach from the one this audit proposed, and
  a working one. Left alone.
- The `/calendar` day cell gained a real accessible name, `aria-expanded` and
  `aria-controls` — it is a proper disclosure now. Only the nesting was left to
  fix.
- `/film-passes` was rebuilt as a list of links to per-pass detail pages, which
  dissolved the "selectable cards with no selected state" finding at its root.
  The identical problem reappeared in the new `FilmPassPurchase` delivery
  picker and was fixed there.

**And the surface had grown.** `/concessions`, `/backstage-enquiry` and
`/film-pass/:id` did not exist in August; the first two are in the route list
now. `components/rentals/MarqueeBookingForm.tsx`, a new public form, was
spot-checked and is **well built** — `htmlFor`, `aria-invalid`,
`aria-describedby`, `role="alert"`, a real `<form noValidate>`.

### Numbers

| | Aug 23 (`fbf2ba6`) | Sep 4 before (`e1cea1c`) | Sep 4 after |
|---|---:|---:|---:|
| 18–20 public routes | 63 nodes / 7 rules | 33 nodes / 4 rules | **0** |
| Money paths, clicked into | 5 rules, 2 critical | 4 rules, 1 critical | **0** |

What remained on 4 September before this change: `color-contrast` ×20 (the
footer staff-login link on every page), `heading-order` ×5,
`nested-interactive` ×5 (the month grid), `link-in-text-block` ×3, and
`button-name` ×2 — the ticket steppers, still unnamed, still the P0.

### Two traps worth recording

- **The Vite dev server serves stale modules to a fresh headless Chrome.** A
  CSS change appeared immediately while JSX changes did not, so an audit run
  reported a dozen fixes as still-broken. It cost two full cycles. **Restart
  the dev server before any before/after run**, and if a fix reports as
  unapplied, check the served module before touching the source.
- **`page-has-heading-one` on `/showing/:id` was a scan artefact**, not a
  finding: the page renders a bare "Loading..." until the showing row arrives.
  `a11y-flows.mjs` now waits for an `<h1>` before scanning.

## Remediation order

Systemic first, so one edit clears many pages:

1. **Tokens and global CSS** — `--destructive`; a global reduced-motion block;
   remove faded `muted-foreground` from text.
2. **Shared primitives** — a field wrapper that wires labels and errors;
   focus-visible on selectable cards; `CardTitle` heading level; dialog and
   sheet close-button target size.
3. **Ticket checkout** — stepper names, error association, live total.
4. **Film passes** — radiogroup semantics, focus ring.
5. **Donate** — labels, `aria-pressed`, fieldsets.
6. **Calendar and layout** — skip link, month-grid nesting and target size,
   toggle semantics.
7. **Rental request** — `Field` and `ToggleRow`.
8. **Admin** — row action names.

Re-run both scripts after each group.

---

## Open for Tom

Three things this audit cannot decide, because they need content or a call that
is not ours. The fourth — the conformance claim — is settled: state a target
with its gaps, which is what `/accessibility` does.

1. **Festival programmes (finding 18).** Per year, in cost order:
   - **2024** — re-export the booklet from the original Canva document with
     text preserved. Free if the source still exists; Canva flattened it on
     export, so nothing was lost upstream. Failing that, OCR the 12 pages.
   - **2023** — no PDF exists at all. Someone has to find the original file, or
     the year is images only.
   - **2025** — has text but is untagged. Tagging is a manual pass in Acrobat
     and is the least valuable of the three; the text is already speakable.
   - Above all of that, an **HTML line-up per year** would beat every PDF
     option: readable by everything, searchable, indexable, and it makes the
     archive useful rather than merely compliant. It costs someone typing up
     the line-up once per festival.

2. **Trailer captions (finding 19).** Largely answered — see above. `resolveTrailer`
   now asks both players to show whatever caption track exists. What remains is
   editorial: when two trailer URLs exist for the same film, prefer the one
   with real captions.

3. **Admin DOM size (finding 23).** `/admin` renders 76,193 nodes because it
   lists all 1,792 showings at once. A real fix is pagination or virtualisation
   — a separate piece of work, not an accessibility patch. Nothing in this
   change makes it worse.

### Does the admin area have to be accessible?

Asked directly, so recorded here. This is not legal advice and the answer
should be confirmed with counsel, but the shape of it is:

- **ADA Title III** — public accommodations. This is the ticketing-site
  exposure, and it covers the patron-facing pages, not the staff tools. It is
  where essentially all web-accessibility litigation happens.
- **ADA Title I** — employment. An employer must make reasonable accommodation
  for a disabled employee, and an internal tool nobody with a screen reader can
  operate is how that obligation gets triggered. Title I applies at **15 or
  more employees**; a single-screen non-profit theatre may sit under that line,
  but staff-account count is not headcount and volunteers complicate it.
- **Section 504 of the Rehabilitation Act** — this is the one people forget.
  It attaches to recipients of **federal financial assistance**, covers both
  programs and employment, and has no 15-employee floor. An NEA grant, or an
  Idaho Commission on the Arts pass-through of federal money, can bring it into
  play. Worth checking what the Kenworthy's funding actually carries.
- **Section 508** proper applies to federal agencies, not to the theatre.

The practical answer, though, is that the question is mostly already moot: the
admin remediation was **two row templates and eight select labels**. It cost
under an hour and removed 5,234 unnamed controls. The expensive item is the
DOM size, and that is a performance problem that happens to hurt screen
readers — worth doing on its own merits, whatever the legal answer.

The line to hold going forward: **public pages are audited and must stay at
zero; admin is fixed where fixing it is cheap, and is not a release gate.**
