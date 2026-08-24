---
brief: richtext-descriptions
title: Description fields get a formatting toolbar, and the render path is sanitised to match
status: built
track: feature
severity: P2
date: 2026-08-18
verified: false
findings: FINDINGS-richtext-description-surface.md
---

# Brief (for Claude Code): Add a rich-text toolbar to description fields (admin)

**Status:** 🟡 More than a widget — it changes descriptions from plain text to stored HTML, so the render + sanitize path changes with it.
**Date:** August 18, 2026
**Requested by:** Tom — give the description fields (movie, event, live performance, etc.) a rich-text toolbar in the admin so staff can format copy (bold, italic, headings, lists, links).

## The structural fact that shapes this (verified)
- Description fields are stored as `TEXT` and **rendered as plain text today** — e.g. `src/pages/Showing.tsx:573` renders `{production.description}` directly inside a `<p>`; it does **not** interpret HTML. `Index.tsx` uses it as `curatorNote`, and it also feeds the **SEO/meta** description (`Showing.tsx:502`, sliced to 160 chars).
- There is **no rich-text editor and no HTML sanitizer** in the project (no tiptap/quill/lexical, no DOMPurify).
- **Therefore:** adding a toolbar means the field now contains **HTML**. If we only add the editor, every place that prints `{description}` will show literal tags (`<p>…</p>`), and any place that renders it as HTML without sanitizing is an **XSS hole** (stored HTML shown to the public). So the render side must change in lockstep. This is the whole risk of the task; treat it as an HTML-content change, not a form-control swap.

## Build

### 1. A reusable `RichTextEditor` component
- Use **TipTap** (headless, React, controlled value; styles cleanly with the existing Tailwind/shadcn setup). Value in/out is **HTML string**, so it drops into the existing `description` state and `TEXT` columns with no schema change.
- **Toolbar (constrained on purpose):** bold, italic, bullet + numbered lists, link, a single heading level (e.g. H3) for sub-headings, and clear-formatting. No images, no arbitrary HTML, no font/color pickers — keep output clean and on-brand. Keyboard shortcuts and a visible focus state; accessible toolbar buttons (labels, `aria-pressed`).
- **Loads legacy plain text cleanly:** existing descriptions are plain text — the editor should open them as normal paragraphs (convert newlines to paragraphs on load) so nothing looks broken, and re-save as HTML.

### 2. Wire it into the description fields
Replace the plain `<textarea>` for `description` in the production/admin forms — **movie, event (`EventForm.tsx`), live performance (`ConcertForm.tsx`)** first, then the other description fields (venue, hiring `HiringTab`, staff bios, film-pass/festival/backstage descriptions) for consistency. Enumerate them by grepping `description` across `src/pages/admin` and `src/components/admin` so none is missed.

### 3. Render side — the part that must not be skipped
- **Sanitize + render as HTML** everywhere a description is displayed to the public. Add a small `<RichText html={…}>` render component that runs **DOMPurify** with a **strict allowlist** (`p, br, strong/b, em/i, ul, ol, li, a[href], h3, blockquote`) and prints via `dangerouslySetInnerHTML` inside a **`prose`-styled** container matching the site (dark theme, readable sizes per `BRIEF-readability-font-size.md`).
- **Audit every render site** and switch it to `<RichText>`: `Showing.tsx` body, `Index.tsx` curator note, `Calendar.tsx`, any listing/preview card, the vertical-split listing preview, and search results. Grep `description` in `src/pages` + `src/components` to find them all.
- **Plain-text consumers must strip tags**, not render them: the **SEO/meta** description (`Showing.tsx:502`, og/twitter tags), any email, and anything pushed to an external system. Add a `htmlToPlainText()` helper (strip tags + collapse whitespace + truncate) and use it for those. A meta description containing `<p>` is a bug.
- **Links:** force `rel="noopener noreferrer"` and (decision) `target="_blank"` on user-entered links via the sanitizer hook.

### 4. Safety / consistency
- **Sanitize on render always** (defense in depth); optionally also sanitize on save. Admins are semi-trusted, but the output is shown to the public, so never render unsanitized.
- Descriptions on **our** side are currently plain text (no existing HTML to migrate). The `<p>`-wrapped descriptions that exist in **Square** are a separate system and out of scope here.
- No DB migration needed (`description TEXT` already holds HTML); confirm no length/JSON assumptions break.

## Decisions for Tom
1. **Toolbar scope:** the constrained set above (recommended) vs add more (e.g. multiple heading levels, blockquote, horizontal rule)?
2. **Field coverage:** productions only now (movie/event/live performance), or all description fields across the admin in one pass (recommended for consistency)?
3. **Links open:** new tab (`target="_blank"`, recommended) vs same tab.
4. **Editor library:** TipTap (recommended) — confirm, or a preference.

## Test plan
- Editing a movie description with bold/italic/list/link/heading saves and **renders formatted** on the public showing page, in the calendar, on the home page, and in any preview — no literal tags anywhere.
- An existing **plain-text** description still renders correctly after the change (no regressions, paragraphs preserved).
- The **meta/SEO** description and any email render **plain text** (tags stripped), never raw HTML.
- **XSS:** a description containing `<script>`/`<img onerror>`/`javascript:` href is neutralized on render (sanitizer allowlist); links carry `rel="noopener noreferrer"`.
- Editor toolbar is keyboard-operable with visible focus and button labels; prose styling matches the site's dark theme and readability defaults.
- `npm run build` + tests pass.


---

## What was built (23 Aug 2026)

Decisions taken by Tom before the build:

1. **Coverage** — productions plus the safe prose fields; **not** Sponsorship.
2. **Toolbar** — the constrained set **plus blockquote and horizontal rule**.
3. **Links** — new tab, with `rel="noopener noreferrer"` forced by the sanitiser.
4. **Mailchimp** — the campaign email strips to plain text rather than
   rendering formatting.

### Three consumers this brief did not account for

The brief's core claim was right — this is an HTML-content change, not a form
control swap — but it counted the *display* sites and missed the consumers that
**parse** the field. Each would have failed silently:

- **`src/lib/festival.ts`** — `stripLeadingShowtime` is a `^`-anchored regex.
  Wrapped in `<p>`, it stops matching and every silent-film screening shows its
  showtime twice.
- **`supabase/functions/mailchimp-campaign`** — interpolates `esc(description)`
  into a marketing email, so HTML would go out as **visible tags** in a real
  blast to the real audience.
- **`src/lib/backstage.ts`** — `backstageParagraphs()` splits on blank lines,
  which HTML does not have. Removed; `<RichText>` replaces it.

`src/hooks/useFeed.ts` also matched searches against the raw field, so a search
for `li` would have hit every description containing a bullet list.

### Two deviations from the brief, both deliberate

- **Clamped teasers render plain text, not HTML.** `line-clamp` is
  `-webkit-box`, which nested `<p>` defeats, and the two home-page calendar
  slots render inside a `<button>`, where an `<a>` is invalid. Body copy gets
  `<RichText>`; teasers get `htmlToPlainText()`.
- **No `prose`.** `@tailwindcss/typography` is in `package.json` but was never
  registered, and it sets its own size, colour and measure — which would have
  restyled four finished pages that each pick their own type scale on purpose.
  A `.rich-text` block in `src/index.css` inherits instead and adds structure
  only.

No migration: `toRichHtml()` normalises pre-editor plain text at read time,
reproducing exactly what `whitespace-pre-line` and `backstageParagraphs()` did.

Full consumer map and reasoning: `docs/briefs/FINDINGS-richtext-description-surface.md`.

### Verified by hand in Chrome, not only in jsdom

jsdom's contenteditable is a simulation, so the editor was also driven in a real
browser against the real module graph. Every toolbar control produced exactly
the allowlisted tag and nothing else, and the sanitised render matched:

| action | stored HTML |
|---|---|
| select a word, click **Bold** | `<p>A <strong>legacy</strong> description.</p>` |
| **Bulleted / Numbered list** | `<ul><li><p>…</p></li></ul>` / `<ol>…</ol>` |
| **Sub-heading** | `<h3>…</h3>` — never h2 or h4 |
| **Quote** | `<blockquote><p>…</p></blockquote>` |
| **Divider** | `<hr>` |
| **Clear formatting** | `<strong>` removed, text kept |
| link typed as `kenworthy.org/film-passes` | `href="https://kenworthy.org/film-passes" target="_blank" rel="noopener noreferrer"` |

`aria-pressed` flipped to `true` on Bold with the cursor inside bold text, so the
toggle state is announced rather than shown by colour alone.

Injecting `<script>`, `<img onerror>`, `javascript:` and `data:` hrefs through
the real DOMPurify neutralised all four, and nothing executed.

**One defect this caught that the tests could not:** TipTap wraps list and quote
content in its own `<p>`, so `<li>` arrives as `<li><p>…</p></li>` and the
paragraph margin put 0.75em inside every bullet — a list that spaced out like
body copy. Fixed in `src/index.css` by resetting the first/last paragraph margin
inside `li` and `blockquote`; bullets went from 11.8px apart to the intended
3.9px. CSS is not covered by vitest, which is exactly why the manual pass earned
its keep.

### Noticed while verifying, not fixed here — `<SEO>` is inert

**`react-helmet-async@3.0.0` renders `<Helmet>` but nothing it declares ever
reaches `<head>`.** Every page on the site therefore serves `index.html`'s
static title, meta description and og: tags. Per-page SEO does not work at all.

Measured, not inferred:

| condition | result |
|---|---|
| fresh load of `/showing/:id`, dev server | static title + meta |
| fresh load, **production bundle** (`vite preview`) | static title + meta |
| in-app SPA navigation between routes | static title + meta |
| same route with these changes **stashed** (`origin/main`) | static title + meta |

So it is not a dev artifact, not a build artifact, not route-specific, and not
caused by this work. `HelmetProvider` *is* mounted correctly in `src/main.tsx`,
and `src/components/SEO.tsx` looks right — the suspicion is the pinned 3.0.0,
which is well ahead of the 2.x line this code was written against. No console
warning is emitted, which is part of why it went unnoticed.

Worth its own brief. It is larger than it looks: OG tags are what a shared link
prints in Messages, Facebook and Slack, so every shared showing currently
previews as the generic site blurb.

The part that belongs to *this* brief is done and verified: the value handed to
`<SEO>` is now plain text (`toMetaDescription`), and the JSON-LD `description`
is stripped — so when Helmet is fixed, neither will carry markup.
