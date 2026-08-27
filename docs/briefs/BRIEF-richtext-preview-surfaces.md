---
brief: richtext-preview-surfaces
title: A formatted description reads formatted in the listing previews, not just on the ticket page
status: shipped
track: bug
date: 2026-08-25
shipped_in: ["#212"]
shipped_at: 2026-08-27
findings: FINDINGS-richtext-description-surface.md
verified: true
---

# Brief (for Claude Code): Rich-text descriptions don't format in the home/calendar previews

**Status:** 🟢 Shipped to staging and production, 27 Aug 2026.
**Date:** August 25, 2026
**Requested by:** Tom — descriptions show correct formatting on the ticket page, but the
List view / preview windows on the home page and calendar page show the text unformatted.

## Diagnosis

Descriptions are stored as rich-text HTML (`BRIEF-richtext-descriptions.md`). The ticket
page renders that HTML; the preview surfaces flattened it to plain text with
`htmlToPlainText()`. Paragraphs, bold, emphasis and lists survived in one place and were
stripped in the other three:

| surface | before | after |
|---|---|---|
| `Showing.tsx` (ticket page) | `<RichText>` | unchanged |
| `ProductionDetailDrawer.tsx` (below `lg`) | `<RichText>` | unchanged — mobile was never affected |
| `ShowingPreview.tsx` (home + calendar preview pane) | `htmlToPlainText` | `<RichText>` |
| `BoothNote.tsx` (curator's pick) | `htmlToPlainText` | `<RichText>` |
| `EditorialCalendar.tsx` (calendar list row) | `htmlToPlainText` | `<RichText>` + `rich-text-teaser` |

The bug was desktop-only, which is why it reads as "the preview windows": below `lg` the
panes do not render at all and the drawer, which was already correct, takes over.

## What the original brief got wrong, and why it matters

The brief was written against a `FINDINGS` note recording that `line-clamp` cannot clamp
rich text at all. That claim was never measured, and it is wrong. Measured in Chrome 141
against the real markup (two `<p>` and a `<ul>`, 16px/1.5, 300px wide):

| box | height |
|---|---|
| plain string, clamped to 2 | 48px |
| the same markup, unclamped | 144px |
| **rich markup, clamped to 2, no child margins** | **48px** |
| rich markup, clamped to 2, `margin-block: 12px` per `<p>` | 84px |

`line-clamp` clamps block children exactly as it clamps a string. The **margins** defeat
it — the box counts margin boxes, and `.rich-text` sets `margin-block: 0.75em`.

That single unverified sentence is what flattened all three surfaces, including the two
that do not clamp at all. The correction is written into
`FINDINGS-richtext-description-surface.md` and into `RichText`'s own doc comment, which
had been telling every reader the opposite.

Two of the brief's three decisions dissolved on contact:

- **Decision 2 (scroll vs fade) was already done.** Both panes had moved to
  `max-height` + `overflow-y-auto` two days earlier, under the home-layout brief. Only
  the flattening was left.
- **Decision 1 (restructure the calendar row) survived**, but for the *other* of the two
  reasons: not the clamp, which works, but `<a>`-inside-`<button>`, which is genuinely
  invalid HTML.

## The repair

1. **`.rich-text-teaser`** (`src/index.css`) — zeroes the child block margins so
   `line-clamp` counts line boxes. Formatting survives; the vertical rhythm, which a
   two-line teaser has no room for anyway, does not.
2. **`ShowingPreview` / `BoothNote`** — `<RichText>` in place of the flattened string.
   Both already scroll, so nothing else changed. The `{note && …}` guards became
   `!isRichTextEmpty(…)`, because TipTap stores a cleared editor as `<p></p>`, which is
   truthy and would draw an empty scroll region.
3. **`EditorialCalendar`** — the row is now a container with the control laid over it
   (`<button class="absolute inset-0">`) instead of a `<button>` wrapping its own
   contents. The copy is ordinary sibling markup, so it can render formatted and a link
   in a note is no longer nested in a control. The button's accessible name is the title
   alone; as a wrapper it was the whole row read out as one run-on string.

**Not changed, deliberately:** `TrailerFeed.tsx` wraps the value in literal quotation
marks, so a block element would strand the opening quote on its own line — a genuine
plain-text slot. The admin previews (`HiringTab`, `StaffBios`) are staff-facing and out
of scope. No machine consumer moved: SEO meta, JSON-LD, feed search,
`stripLeadingShowtime`, the Mailchimp campaign body and `backstageParagraphs` all still
receive plain text. No schema or data change — the column already held HTML.

## Verified

- `src/components/home/curatorNoteFormatting.test.tsx` — 8 tests, each asserting on
  *elements* rather than text, since flattening kept every word and no text assertion
  could see the bug. All 8 fail against `origin/main` and pass on the change.
- Live, against staging data (`The Odyssey`, the one production carrying real editor
  markup): calendar row clamped to 45px of a 225px note with `<strong>` rendering and
  child margins at 0; preview pane 270px of 365px with `<strong>`, `<em>` and `<br>`.
- Row geometry holds at 375 / 768 / 1024 / full width — note 2 lines, row 136px, overlay
  exactly covering the row, no horizontal overflow. The new markup carries no
  breakpoint-scoped classes. Measured by reflowing the container: the automation tab's
  viewport is pinned, so media queries could not be exercised.
- No `validateDOMNesting` warning in console; `container.querySelector('button a')` null.
- `tsc -p tsconfig.app.json --noEmit` clean; 591 tests pass.

## Known cosmetic nuance

Both preview slots set `italic` on the container, so an `<em>` inside them has nothing
left to say visually. Pre-existing typography in those slots, and strictly better than
before — emphasis used to be deleted outright. Worth a look if Tom wants it.

## Deploy

Staging deployed from `origin/main` at `7d48808`, version
`9fa19681-4a4c-41ab-9562-523114bba748`.

Production needed no deploy of its own: a parallel session shipped #213 from
current `main` minutes earlier, and #212 rode along in that build. Confirmed
rather than assumed — a clean production build of `7d48808` reproduced the live
bundle exactly (`index-C5FPKtu1.js`, `index-Dx06Mmo-.css`), and the running
`/calendar` shows 23 clamped teasers at 45px of 180px with `<strong>`
rendering, child margins at 0, and no anchor inside a button.

**A note for whoever deploys next.** Staging and production drifted apart in
opposite directions for about twenty minutes: production was deployed from
`main` (so it had #212) while staging had been deployed from a tree predating
it (so it did not). Neither a version ID nor "it was deployed after my merge"
would have told you which. What did was building a candidate tree and comparing
the content hashes: `main` with #212 reverted reproduced staging exactly, and
clean `main` reproduced production exactly. That test takes one build and
answers the question outright.
