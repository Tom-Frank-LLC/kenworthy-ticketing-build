---
brief: accessibility-ada
title: Audit and remediate the site against WCAG 2.2 AA, public money-paths first
status: shipped
track: ux
severity: P1
date: 2026-08-18
shipped_in: ["#289", "#290"]
shipped_at: 2026-09-04
verified: true
findings: ../accessibility-audit.md
---

# Brief (for Claude Code): Assess & optimize ADA / accessibility across the site

**Status:** ✅ Shipped to production 4 September 2026 — PRs #289 and #290,
deployed as `3e5b4528-5bf2-464d-8b09-fabd4050d803` (staging
`724ba6a6-6d2e-438a-b097-b5ef7d440e6b`). Verified against the live origin,
not the upload log. Rollback target was
`54782715-abb8-447f-b4bd-d2b21a666be4`. See `docs/accessibility-audit.md` for the findings, the numbers, and
the three remaining open questions.
**Date:** August 18, 2026
**Requested by:** Tom — assess and optimize ADA compliance throughout the site.
**Standard:** WCAG **2.2 Level AA** (what ADA Title III and Section 508 are read against).

Patron-facing ticketing has real ADA Title III exposure — theatres and ticketing
sites are frequent web-accessibility defendants — so the public purchase paths
were treated as the priority.

## What the audit found

Full report: `docs/accessibility-audit.md`. Reproduce with:

```bash
npm install --no-save axe-core puppeteer
npm run dev -- --mode staging
node scripts/a11y-audit.mjs          # 18 public routes
node scripts/a11y-flows.mjs          # the three money paths, clicked into
```

Baseline, 18 public routes, logged out: **63 violating nodes** — 25 contrast, 20
missing labels, 7 nested interactives, 7 unnamed buttons, 4 heading-order, 3
link-in-text-block, 1 target-size. The admin dashboard added **5,234** unnamed
controls from two row templates.

The four worst findings were invisible to a first-paint axe scan of the route,
and two were invisible to axe entirely:

1. The **ticket quantity − / + buttons had no accessible name.** Icon-only, no
   `aria-label`. On a general-admission showing that is the only way to add a
   ticket, so the primary money path could not be completed with a screen
   reader.
2. The **film-pass and delivery-method cards were `role="button"` with no
   selected state and no focus ring** — a single-select group where nothing
   said which one was selected, and nothing moved visibly when you tabbed.
3. **Validation errors were unassociated `<p>` elements** on every hand-rolled
   form. Submit an invalid checkout with a screen reader and nothing was
   announced at all.
4. **No skip link**, behind an 8–14 stop header that repeats on every route.

Plus one token-level failure worth its own line: `--destructive` was **3.74:1**
on a card. Every error message in the app was the text a patron most needs to
read, in the one colour of the palette that failed AA.

## What was done

Systemic first, so one edit cleared many pages.

**Tokens and global CSS** — `--destructive` moved to a light fill with off-black
text, matching what `--success` already documents (6.11:1 both ways, and every
`bg-destructive/5..15` tint with `text-destructive` on it clears 4.67:1). A
global `prefers-reduced-motion` block; before this, two things in the whole app
honoured the preference. Faded `muted-foreground` removed from all text.

**Shared primitives** — `components/ui/field.tsx`: a `Field` that wires
`aria-describedby` / `aria-invalid`, and a `FormErrorSummary` live region that
takes focus on a refused submit. `CardTitle` grew an `as` prop (it always
rendered `<h3>`, which is where every `heading-order` violation came from).
Dialog and sheet close buttons went from 18×18 to 36×36.

**Ticket checkout** — named steppers with a live count, a real `<form>` so Enter
submits, errors associated and announced, checkboxes labelled by `htmlFor`
rather than by a wrapper.

**Film passes** — both card groups became `fieldset` + native radios, keeping
the card visuals through `peer-focus-visible` and React state.

**Donate** — fieldsets and legends for the amount and dedication groups,
`aria-pressed` on both (copying `DonationPrompt`, which already did it right), a
real label on the custom-amount field.

**Calendar** — the month grid's `role="button"` day cell no longer nests
focusable event buttons; the keyboard affordance is a named day button, and the
event buttons meet the 24px target minimum. The list/month switch stopped
claiming to be a tablist.

**Rental request** — `Field` and `ToggleRow` each generate an id and point their
label at it. Two helpers, 27 violations.

**Admin** — 2,615 row-action links and every filter select named after what
they act on.

**`/accessibility`** — was a ComingSoon stub promising a guide that was "being
drafted", which is the worst page to show a disabled patron. It is a real
statement now, built only from facts already in the repo (§4 of the Terms, and
the History page's record of the 2000s ADA restroom work).

## Result

| | Aug 23 | Sep 4 before | Sep 4 after |
|---|---:|---:|---:|
| Public routes, axe violations | 63 nodes / 7 rules | 33 nodes / 4 rules | **0** |
| Money paths (clicked into) | 5 rules, 2 critical | 4 rules, 1 critical | **0** |
| Admin dashboard, naming rules | 5,234 nodes | — | **0** |

The August work was never pushed and `main` moved 115 commits underneath it, so
the fixes were re-derived against current code rather than replayed. Three
findings had been fixed independently in the meantime and were left alone; the
public surface had grown by three routes. See the audit for the detail.

Test suite green (776 tests); `tsc -p tsconfig.app.json --noEmit` clean.

## What the production check caught

Auditing the deployed site rather than trusting the build found two AA failures
that **only exist with production data** — invisible on staging and locally,
and fixed in #290:

- A past festival screening's card was `opacity-60`. Container opacity
  multiplies every descendant, taking the showtime to 2.6:1 and the synopsis to
  3.47:1. There is no safe value — 90% only reaches 4.54:1 — so the opacity
  moved to the decorative poster and the words stay at full contrast.
- The curator's pick and the showing preview both wrapped scrollable copy in
  `role="region"` named after the production, so a featured pick shipped two
  identically-named landmarks. They are `role="group"` now.

Staging had neither a past festival screening nor that home-page line-up. This
is the argument for the runbook's "verify against the live URL" rule, and it
should stay in the loop for any future a11y work.

## Still open — decisions for Tom

Written up in full at the end of `docs/accessibility-audit.md`:

1. **Silent Film Festival programmes.** Not the blanket problem the first pass
   recorded — checked file by file against production storage. **2025**'s
   booklet PDF has a real text layer (untagged, but speakable); **2024**'s was
   flattened to images by Canva on export; **2023** has no PDF at all. The
   cheap repair is a Canva re-export for 2024 and finding the original for
   2023. An HTML line-up per year would beat all of it.
2. **Trailer captions — mostly answered.** All 788 trailers are YouTube or
   Vimeo embeds; there is no self-hosted video on the site. `resolveTrailer`
   now sets `cc_load_policy=1` / `texttrack=en` on the real player (not the
   muted marquee), so whatever track the distributor supplied is shown by
   default. What is left is editorial: prefer a captioned trailer URL.
3. **Admin DOM size** — `/admin` renders 76,193 nodes. That is a pagination
   job, not an accessibility patch.

Settled: **the public conformance claim.** `/accessibility` states WCAG 2.2 AA
as a target with its known gaps listed, rather than claiming conformance.

Also settled: **how far the admin has to go.** Public pages are audited and
must stay at zero; the admin is fixed where fixing it is cheap — it cost two
row templates and eight labels here — and is not a release gate. The legal
distinction (Title III vs Title I vs Section 504, which has no employee-count
floor and follows federal funding) is written up in the audit.

## Test plan (acceptance)

- [x] 0 critical/serious axe violations on the public money-paths and top public pages
- [x] Keyboard-only: ticket, film-pass and donation flows operable with visible focus, no traps
- [x] Every form error is associated with its field and announced on submit
- [x] All text/UI meets AA in the shipped theme, by calculation
- [x] `prefers-reduced-motion` disables non-essential animation
- [x] `/accessibility` matches reality, and says what is not there yet
- [x] `npm run build:production` + `npx vitest run` pass
- [x] Deployed to staging **and** production, and re-audited against both live
      origins — `kenworthy.org` is at zero on all 20 public routes and all seven
      money-path states
- [ ] Screen-reader pass with VoiceOver on a real device — the semantics are
      correct and machine-verified, but nobody has listened to it yet
