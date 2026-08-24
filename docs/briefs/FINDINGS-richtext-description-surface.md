# FINDINGS — what actually consumes a `description` before rich text

Companion to `docs/briefs/BRIEF-richtext-descriptions.md`. Written 23 Aug 2026,
against `origin/main` at `fbf2ba6`.

The brief's framing is right: adding a toolbar turns a `TEXT` column of plain
text into a column of HTML, so the *read* side has to move with the write side
or every render prints literal tags. What the brief under-counts is how many
read sides there are, and that three of them are not renderers at all.

**The rule this establishes: before adding a toolbar to a text field, enumerate
every consumer of that field — not every place it is displayed.** Displays are
easy to find and easy to fix. The expensive ones are the consumers that parse
the text, measure it, or ship it somewhere HTML never reaches.

## The three consumers that are not renderers

These are the reason this task was not a form-control swap. None of them appear
in the brief, and each fails silently — no error, no type change, just wrong
output.

### 1. `src/lib/festival.ts:131` — a `^`-anchored regex over the description

```js
const LEADING_SHOWTIME =
  /^\s*(?:Mon|Tues|…)day,\s+[A-Z][a-z]+\s+\d{1,2}…/;
```

`stripLeadingShowtime()` removes a duplicated showtime from the start of a
festival synopsis (`SilentFilmFestival.tsx:634`). Wrap that same text in `<p>`
and the anchor no longer matches, so every silent-film screening starts showing
its showtime twice — on the page whose whole job is the programme.

Fixed by normalising to plain text *inside* `stripLeadingShowtime`, not at the
call site, so a future caller cannot reintroduce the bug.

### 2. `supabase/functions/mailchimp-campaign/index.ts:117` — an HTML email

```js
${description ? `<tr><td style="…">${esc(description)}</td></tr>` : ""}
```

`esc()` HTML-escapes. That is correct today and becomes wrong the moment the
column holds HTML: the campaign body would read `<p>A restored 35mm print…</p>`
as visible text, in a real Mailchimp blast to the real audience. Note that
staging shares production's Mailchimp key and audience, so this is not testable
without sending real mail.

Edge functions are Deno and never see `src/`, so this needed its own copy of the
strip helper: `supabase/functions/_shared/html_text.ts`.

### 3. `src/lib/backstage.ts:76` — a paragraph splitter

```js
export function backstageParagraphs(body) {
  return (body ?? '').split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
}
```

HTML has no blank lines, so this returns a single-element array containing the
whole HTML blob, which then renders as literal tags inside one `<p>`. The
function is obsoleted by the renderer and has been removed along with its tests.

## The other quiet one: search matches tag names

`src/hooks/useFeed.ts:118` filters the feed on `curatorNote`. Once the note is
HTML, searching `li` matches every description with a bullet list, and `strong`
matches every bolded one. Fixed by stripping before comparing.

## Why every clamped teaser renders plain text, not HTML

`<RichText>` emits block elements. Two things break when block elements land in
the existing teaser slots:

- **`line-clamp` stops working.** It is `-webkit-box` + `-webkit-line-clamp`,
  which clamps inline content in one box. Nested `<p>` defeats it, so a
  ten-line clamp becomes an unbounded column.
- **`EditorialCalendar.tsx:117` and `:198` render inside a `<button>`.** An
  `<a>` inside a `<button>` is invalid HTML; browsers recover unpredictably and
  the link is not reliably clickable.

So the split is by *role*, not by field:

| role | treatment |
|---|---|
| the body — the reader came here to read it | `<RichText>`, sanitised HTML |
| a teaser — clamped, quoted, or inside a control | `htmlToPlainText()` |
| a machine consumer — meta, JSON-LD, search, PDF, email | `htmlToPlainText()` |

## No migration, because legacy rows are normalised at read time

Existing descriptions are plain text with newlines, and they stay that way until
someone edits them. Rather than migrate ~1,800 rows, `toRichHtml()` detects
whether a value contains any allowed tag and, if not, converts blank-line-
separated blocks to `<p>` and single newlines to `<br>`.

That reproduces the exact semantics the old renderers had — `whitespace-pre-line`
on `Hiring.tsx`, `About.tsx`, `Press.tsx`, `SilentFilmFestival.tsx`, and
`backstageParagraphs()`'s blank-line split — so a row nobody has touched renders
byte-identically to before. The same normaliser feeds the editor, so opening an
untouched description shows paragraphs rather than one run-on block.

## Why not `prose`

`@tailwindcss/typography` is already in `package.json` (`^0.5.16`) but was never
registered in `tailwind.config.ts`, so `prose` classes emit nothing today. It
stays unregistered.

`prose` sets its own `font-size`, `color`, `max-width` and vertical rhythm. The
eight render sites deliberately differ — `Showing.tsx` is `text-sm`,
`Press.tsx` is `text-lg md:text-xl`, the admin previews are `text-xs`. Dropping
`prose` into all of them would override each one and silently restyle four
finished pages.

`.rich-text` in `src/index.css` instead inherits font-size and colour from
whatever wraps it and adds only structure: list markers, heading weight,
blockquote rule, link underline. Sizes are in `em`, so they scale with the
inherited size and with the 112.5% root — no `px`, per the design constraints.

## Trust boundary worth naming

`src/pages/admin/HostDashboard.tsx:297` edits the **same** `description` column
as the staff forms, and `/host` is gated on `isHost` — external event
organisers, not staff. Sanitising on render is therefore load-bearing here, not
just defence in depth. The allowlist is enforced at render for every consumer,
so a host cannot inject script regardless of what reaches the column.

## Full consumer map

Write sites given the editor (11):

| file | field |
|---|---|
| `src/pages/admin/MovieForm.tsx:123` | `movies.description` |
| `src/pages/admin/EventForm.tsx:100` | `events.description` |
| `src/pages/admin/ConcertForm.tsx:115` | `live_performances.description` |
| `src/pages/admin/VenueForm.tsx:183` | `venues.description` |
| `src/pages/admin/HostDashboard.tsx:297` | production `description` (host role) |
| `src/components/admin/HiringTab.tsx:220` | job `description` |
| `src/components/admin/StaffBios.tsx:248` | `bio` |
| `src/components/admin/PressTab.tsx:243` | `intro_text` |
| `src/components/admin/BackstageTab.tsx:435` | `body_text` |
| `src/components/admin/FestivalProgramsTab.tsx:174` | year `blurb` |
| `src/components/admin/FilmPassesTab.tsx:920` | `fine_print` |

Body renders switched to `<RichText>` (8): `Showing.tsx:639`,
`ProductionDetailDrawer.tsx:133`, `Hiring.tsx:99`, `About.tsx:231`,
`Press.tsx:169`, `FilmPasses.tsx:575`, `SilentFilmFestival.tsx:575`,
`Backstage.tsx:250`.

Teasers switched to `htmlToPlainText()` (7): `ShowingPreview.tsx:101`,
`TrailerFeed.tsx:201`, `EditorialCalendar.tsx:117` and `:198`,
`SilentFilmFestival.tsx:659`, `HiringTab.tsx:277`, `StaffBios.tsx:330`.

Machine consumers switched to `htmlToPlainText()` (5): `Showing.tsx:568` (meta
description), `Showing.tsx:581` (JSON-LD `description`), `useFeed.ts:118`
(search), `festival.ts` (`stripLeadingShowtime`), `mailchimp-campaign`
(edge function, via its own Deno helper).

## Deliberately left as plain textareas

- **Internal notes** — `DvdLibraryTab.tsx:167`, `RentalRequestsTab.tsx:388`,
  `TimeClockWidget.tsx:221`. Staff-only, never rendered to the public.
- **Patron input** — `Donate.tsx:285`, `RentalRequest.tsx`. Untrusted; giving
  the public an HTML field buys nothing and widens the input surface.
- **Sponsorship** — `SponsorshipForm.tsx` (`intro_text`, `hook_text`,
  `section_body`, benefit `description`). These feed `src/lib/sponsorshipPdf.ts`,
  which measures them with jsPDF `splitTextToSize()`. Formatting would have to be
  taught to the PDF generator, or be flattened on the way out; Tom scoped this
  one out rather than accept either. **If sponsorship ever gets the editor, the
  PDF generator is the work, not the toolbar.**
- **`FilmPasses.tsx:395` (`opt.blurb`) and `History.tsx:429`** — these read like
  admin copy but are hardcoded literals in the source, not DB columns.
