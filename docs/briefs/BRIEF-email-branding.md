---
brief: email-branding
title: Brand the default email template — logo, site colors, correct name
status: shipped
track: ops
date: 2026-08-13
verified: false
---

# Brief (for Claude Code): Brand the default email template — logo, site colors, correct name

**Status:** 🟢 Draft for review
**Date:** August 13, 2026
**Requested by:** Tom — make the default mail template match the brand: add the logo, match the site's colors (kept in sync as the site palette changes), and fix the theatre name (it currently says "**The** Kenworthy", which is wrong).

## Scope
The transactional email templates: `supabase/functions/_shared/notify.ts` (ticket confirmation email + SMS) and `supabase/functions/_shared/auth-email.ts` (password-reset / invite emails). Optionally the marketing template in `mailchimp-campaign` (noted at the end).

---

## Part 1 — Fix the name: "The Kenworthy" → "Kenworthy"
Remove the leading "The". Correct forms: full = **Kenworthy Performing Arts Centre**, short = **Kenworthy**. Every occurrence in the email code:
- `_shared/notify.ts`: `VENUE_NAME` (L17) → `'Kenworthy Performing Arts Centre'`; header "The Kenworthy" (L204) → "Kenworthy"; footer (L336) → "Kenworthy Performing Arts Centre, Moscow, Idaho"; SMS prefix "The Kenworthy:" (L352) → "Kenworthy:".
- `_shared/auth-email.ts`: subject "You've been invited to The Kenworthy" (L52) → "…to the Kenworthy Performing Arts Centre"; header (L150) → "Kenworthy"; footer (L196) → "Kenworthy Performing Arts Centre, Moscow, Idaho".
- Update the plain-text bodies (`buildEmailText`) too.
- **Tests:** `auth_email_test.ts` and `tickets_test.ts` may assert the old name/copy — update expectations.

*Related (out of scope unless you want it):* the **site itself** also says "The Kenworthy" — `index.html` OG/JSON-LD and the `SEO` component. For full consistency those should change too; flagging so it's a conscious choice, but this brief is scoped to the emails.

## Part 2 — Match the site colors via one shared brand module
**Reality to design around:** email clients (Gmail, Outlook) do **not** support CSS custom properties, and there's no runtime link between the site's CSS and the Deno email builders — so "as the site changes, emails match" cannot be automatic via `var(--token)`. The correct structural equivalent is a **single shared brand palette in code** that every email imports, mirroring the site tokens, so a palette change is one edit that updates all emails.

- Create `_shared/brand.ts` exporting the palette as hex, mirroring the tokens in `src/index.css` (resolve HSL → hex):
  - `bg: '#0F0F0F'` (`--background: 0 0% 6%`)
  - `cream: '#F5F1E9'` (`--foreground` / paper cream)
  - `gold: '#D6A94A'` (`--accent: 41 65% 56%`)
  - `primary: '#B16ED8'` (`--primary: 278 58% 64%` — amethyst; the new accent replacing magenta)
  - `mutedSurface: '#232323'` (`--muted`), `mutedText: '#ABA69C'` (`--muted-foreground`)
  - plus a couple of derived shades used in the current template (borders/surfaces) as needed.
- Replace the hardcoded hex in `notify.ts` and `auth-email.ts` with `brand.*`. The emails currently use an **older palette** that predates the current tokens — a warm brown header `#26211d` and a magenta button `#b82a6b`; align them: dark surfaces → `brand.bg`, primary buttons → `brand.primary`, keep `brand.gold` accents and `brand.cream` text.
- Document at the top of `brand.ts`: *"These mirror the design tokens in `src/index.css`. Email can't read CSS variables, so when the site palette changes, update here."* (Optional, note only — not now: a build step could generate `brand.ts` from the CSS tokens for a literal single source; over-engineering for this pass.)
- **Note the palette is still being finalized** (the Color Lab purple/green study). `brand.primary` should track whatever the site's `--primary` resolves to; revisit when the final accent is chosen.

## Part 3 — Logo in the header
- Email logos must be a **hosted PNG at a stable absolute URL** — email clients strip `data:` URIs and don't reliably render SVG (Gmail drops SVG). The repo's logos live in `src/assets` (`kenworthy-full-logo.png`, `kenworthy-logo.svg`), which get content-hashed at build (unstable URLs), so:
  - Add a PNG wordmark to **`public/`** (e.g. `public/email-logo.png`, exported from `kenworthy-full-logo.png`) so it's served at a stable `${SITE_URL}/email-logo.png`.
- Put it in the email header (both templates), ~180px wide, `alt="Kenworthy Performing Arts Centre"`, on the dark header background, with the wordmark text kept as a fallback for images-off clients. Build the absolute URL from `SITE_URL` (already available in `deliver.ts`; pass it into the layout, or have `brand.ts`/the layout accept a `siteUrl`).

## Part 4 — Shared layout (recommended: this is "the default mail template")
Extract the repeated header (logo) + footer + shell into one `_shared/email-layout.ts` — `emailLayout({ preheader, title, contentHtml, siteUrl })` — used by both `notify.ts` and `auth-email.ts`, so the logo, colors, name, and footer live in **one** place. Each specific email supplies only its body. This is what makes future brand changes a single edit and keeps the ticket, reset, and invite emails visually identical.

## Constraints
- Keep inline styles + table-based layout (email-client reality); no external stylesheet, no CSS variables.
- All images (logo, QR) are absolute URLs — consistent with how QR images already work.
- Keep and update the plain-text alternatives.

## Acceptance
- No "The Kenworthy" anywhere in emails or SMS; name reads "Kenworthy" / "Kenworthy Performing Arts Centre".
- Ticket, password-reset, and invite emails share one branded shell with the **logo** and the **site palette** (via `brand.ts`).
- Editing `brand.ts` visibly changes all emails together.
- Renders correctly in Gmail, Outlook, and Apple Mail (light + dark); `npm run build` and the email tests pass.

## Decisions for Tom
1. Confirm the official name rendering (full "Kenworthy Performing Arts Centre", short "Kenworthy").
2. Email button/accent color: use the site's current `--primary` (amethyst) for now, updating when the Color Lab palette is finalized — OK?
3. Also fix the **site's** "The Kenworthy" (OG/JSON-LD/SEO) for consistency, or leave that for a separate pass?
4. Optionally rebrand the `mailchimp-campaign` marketing email (it has its own hardcoded HTML/colors) to the same palette — in scope or later?

---

# Delivered — August 14, 2026

**Status:** ✅ **Shipped to staging and production — August 14, 2026.** Merged as
`abdf6ef` (PR #50). Frontend and 7 edge functions live on both projects; see
*Redeploy — done* below for exactly what was deployed and what was not.

## Decisions as answered

1. Full **Kenworthy Performing Arts Centre**, short **Kenworthy**. No leading "The".
2. Amethyst (`--primary`, `#B16ED8`) for buttons, to be revisited with the Color Lab palette.
3. Site metadata fixed too (scope note below).
4. `mailchimp-campaign` rebranded onto `brand.ts`.

**Scope widened during the work.** The brief covered `notify.ts` and `auth-email.ts`.
But `donations.ts` (receipt + tribute) and `pass_orders.ts` (film-pass order +
posted notice) are also patron-facing transactional emails carrying the same
hand-copied header, the same `#26211d`/`#b82a6b`, and the same "The Kenworthy".
Branding two of six would have left the acceptance criterion false and the other
four visibly older. All six now share one shell.

## What was built

| File | Role |
|---|---|
| `_shared/brand.ts` | **New.** Palette, venue name, site origin, logo URL. The one place a colour or the name is defined. |
| `_shared/email-layout.ts` | **New.** The default mail template — shell, header, footer, and the pieces (`panel`, `primaryButton`, `eyebrow`, …) each message is assembled from. |
| `_shared/notify.ts` | Ticket email + SMS, onto the shell. |
| `_shared/auth-email.ts` | Reset / invite / confirm / magic-link / reauth, onto the shell. |
| `_shared/donations.ts` | Receipt + tribute notice, onto the shell. |
| `_shared/pass_orders.ts` | Film-pass order + posted notice, onto the shell. |
| `_shared/deliver.ts` | From-line default; `SITE_URL` now imported from `brand.ts` rather than defined twice. |
| `_shared/calendar.ts` | `.ics` venue name from `brand.ts` (a patron sees this in their calendar). |
| `mailchimp-campaign/index.ts` | Marketing email onto `brand.ts`. Keeps its dark poster layout — it is not a receipt. |
| `public/email-logo.png` | **New.** Cream wordmark, 360px, transparent. |
| `scripts/make-email-logo.mjs` | **New.** Regenerates the above. |
| `_shared/email_brand_test.ts` | **New.** The acceptance criteria, as tests. |

### Why the palette is a copy, not a reference
Email clients do not support CSS custom properties and there is no runtime link
between `src/index.css` and these Deno modules, so `var(--primary)` in an email
is simply a colour that does not render. `brand.ts` mirrors the tokens as
resolved hex and every template imports it — a palette change is one edit. The
header comment says so, and says to re-resolve rather than eyeball a near-enough
hex. A build step generating `brand.ts` from the CSS remains the way to make it
literal; deliberately not done.

### Why the emails are paper, not black
The site is dark, so "match the site" could mean a black email. These use the
site's `--paper` token (`#F1ECE4`) for the body with the black `--background`
header. Paper is a real site token — the editorial surface — and a receipt is a
document: QR codes need a light quiet zone, and client dark-mode heuristics
mangle a dark email far more readily than a light one. Flipping to full dark is
now a change in `email-layout.ts` alone.

### The logo

> **Superseded — August 14, 2026 (PR #51).** The emails shipped with the plain
> wordmark described below, which was the wrong lockup for the centenary year.
> Both lockups now exist and `emailLockup()` in `brand.ts` picks by date:
> `email-logo-centenary.png` (the "Celebrating 100 Years" artwork, 200px)
> through the end of 2026, `email-logo.png` (180px) from 2027. The date is read
> when an email is built, not when the function is deployed, so the switchover
> needs no redeploy — and it lands at midnight Pacific, since plain UTC would
> retire it at 4pm on New Year's Eve. They sit at separate URLs so an email sent
> during the centenary keeps rendering the centenary lockup in the recipient's
> archive rather than silently changing. The centenary source is an SVG, which
> Gmail will not render, so `make-email-logo.mjs` now rasterises it.

Source art (`src/assets/kenworthy-full-logo.png`) is **black on transparent** —
the site inverts it with a CSS filter, which email cannot do, so it would have
been invisible on the dark header. `make-email-logo.mjs` bakes the cream in and
resamples to 360px. It lives in `public/` because `src/assets` is content-hashed
at build and an email sent last month must still resolve its images today.

## Verified

- `deno test --no-check --allow-env supabase/functions/_shared/` — **106 passed**.
- `npx vitest run` — **131 passed**, 17 files.
- `npx tsc -p tsconfig.app.json --noEmit` — clean.
- `npm run build:staging` — clean; `dist/email-logo.png` present.
- All six templates rendered in Chrome and looked at, not just diffed.
- **Mutation-tested**, because a test that has never failed proves nothing:
  reintroducing "The" to `VENUE_NAME` fails the name test; changing `primary` in
  `brand.ts` propagates to every template.

### Known, pre-existing, not touched
- `tickets_test.ts:114` fails `deno check` (`PNG.sync` typing). Present before
  this work — confirmed by stashing these changes and re-running. Hence
  `--no-check` above.
- `buildPassOrderSubject` produces "Your 2 film passes **is** on its way".
- **17 stray duplicate files** — `auth-email 2.ts`, `notify 2.ts`,
  `donations 2/3/4.ts`, `deliver 2/3.ts`, `pass_orders 2/3.ts`,
  `mailchimp-campaign/index 2.ts` and others. All untracked and imported by
  nothing, so they neither ship nor bundle (Deno resolves from the entrypoint's
  import graph). Left alone rather than deleted — they are not this brief's, and
  another session is active in this checkout. Worth a sweep: they are full
  copies of the old branding, and two of them (`flags_test 2.ts`,
  `pass_orders_test 2.ts`) are picked up by `deno test` on the directory.

## Redeploy — done

`_shared` is bundled into each function at deploy time, so a function keeps
sending the old branding until it is pushed. All of these were deployed on
August 14, 2026, frontend first so the logo existed before any email could
reference it.

| Function | Pulls in | Staging | Production |
|---|---|---|---|
| `ticket-checkout` | `deliver.ts`, `donations.ts` | ✅ v21 | ✅ v20 |
| `send-ticket-confirmation` | `deliver.ts` | ✅ v21 | ✅ v21 |
| `film-pass-checkout` | `deliver.ts`, `pass_orders.ts` | ✅ v17 | ✅ v16 |
| `send-auth-email` | `auth-email.ts` | ✅ v12 | ✅ v12 |
| `square-donation` | `donations.ts` | ✅ v15 | ✅ v18 |
| `lgl-sync-donation` | `donations.ts` | ✅ v3 | ✅ v3 |
| `ticket-access` | `calendar.ts` | ✅ v15 | ✅ v18 |
| `mailchimp-campaign` | `brand.ts` | — not deployed | — not deployed |

**`mailchimp-campaign` was deployed to neither project, and still isn't.** Nor
are the other four Mailchimp functions (`ecommerce`, `subscribe`, `webhook`,
`bootstrap`), which is worth knowing for a different reason: `ticket-checkout`
fire-and-forgets a call to `mailchimp-ecommerce` on every purchase
(`ticket-checkout/index.ts:553`), and that call currently 404s in silence. Its
rebrand is committed and will apply whenever the function is first deployed.

Frontend workers: staging `ceebbe43` (`index-D2cUxOEt.js`), production
`984ad289` (`index-DgY-RyhI.js`). **Production rollback point:**
`05f9c782-ef66-4be1-ae6d-5e780b1295e5`.

### Verified after deploying, not assumed

Every function was curled: a deploy reporting success proves nothing when a
BOOT_ERROR is invisible on a fire-and-forget path. All 14 (7 per project) came
back alive — `send-auth-email` with *Invalid webhook signature* and
`ticket-access` with *Missing ticket token*, both of which are their own handler
code and therefore prove the new `_shared` bundle boots. `/email-logo.png`
returns HTTP 200 on both origins.

### The two secrets — both resolved, no action needed

Secrets are stored hashed, so these were confirmed by matching the SHA-256
digest against candidate values rather than by guessing:

- `TICKET_FROM_EMAIL` is **not set on either project**, so the code default
  applies and the From line now reads `Kenworthy <tickets@kenworthy.org>`.
  If anyone sets it later, it must not reintroduce the leading "The".
- `SITE_URL` is correct on both — staging → the staging worker, production →
  the production worker. This is what makes the logo URL resolve.

### No migrations

This change adds none. At deploy time the only unapplied migrations on either
project were two uncommitted rental-invoice files belonging to another session's
unfinished feature, so `db push` was deliberately never run — it would have
applied only that. The scanner migration (`20260814085500`) was already applied
on both.

## Site name — what changed and what did not

Changed: `index.html` (title, description, author, OG, JSON-LD),
`manifest.webmanifest`, `src/lib/calendar.ts`, and the `SEO` title/description
props plus JSON-LD names across Index, Calendar, Showing, About, Sponsors,
Donate, Auth, FilmPasses, Dvds, Hiring, Volunteer.

**Not changed — needs an editorial decision, not a find-and-replace.** Roughly 30
occurrences remain in body prose (`Rentals`, `About`, `Donate`), the rental
contract's legal text (`RentalContract.tsx`), the historical narrative in
`History.tsx` (where "The Kenworthy Theatre opens in 1926" is period-accurate),
display strings (`Auth.tsx` card title, `Layout.tsx` footer ©, `StickerSheet`),
`aria-label`s and the `KenworthyLogo` `alt` default, `public/llms.txt`, and
`public/colorlab.html`. Many read correctly as "the Kenworthy" mid-sentence.
`ComingSoon.tsx`, `Press.tsx` and `PressTab.tsx` were skipped deliberately —
another session had them open.
