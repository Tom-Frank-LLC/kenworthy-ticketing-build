---
brief: colorlab-live-session
title: Color Lab as a live, session-only theme override on the real site
status: shipped
track: ux
date: 2026-08-15
evidence: src/components/colorlab/ColorLabProvider.tsx
verified: true
---

# Brief (for Claude Code): Color Lab as a live, session-only theme override on the real site

**Status:** 🟢 Ready — cheap because the theme is already CSS‑variable driven; temporary tool behind a flag
**Date:** August 15, 2026
**Requested by:** Tom — instead of a standalone Color Lab page, let the team audition the brand's **purple (primary)** and **green (secondary/accent)** live against the whole real site, until the color story is settled. The change must affect **only the current viewer's own session** (logged in or not) — never other visitors, never the real theme, never anything server‑side.

## How expensive? Cheap — and here's why (verified)
The entire site is themed through **HSL CSS custom properties** in `src/index.css` consumed as `hsl(var(--token))` via `tailwind.config`. Recoloring the whole site is just overriding a few CSS variables on `document.documentElement` — **no rebuild, no component changes, no DB**. Negligible runtime cost. Ideal architecture for this.

## Token map — read carefully; there's a naming trap
Keep the CSS token names exactly as they are; refer to each color by the token it **already** has (Tom: "call it whatever it is already called in token form, to not create confusion"). The brand hierarchy (primary=purple, secondary=green, tertiary=gold) maps onto **existing** tokens like this:

**Fixed — the Lab must NOT change these:**
- **Off‑black** = `--background 0 0% 6%` (≈ `#0F0F0F`) + related `--card`/`--popover`.
- **Off‑white / cream** = `--foreground 38 30% 94%` + `--paper`.
- **Gold (brand tertiary)** = `--accent 41 65% 56%` (≈ `#D6A94A`) — **fixed**, keep the `--accent` name.

**Adjustable — the two the Lab controls:**
- **Purple (brand primary)** = **`--primary 278 58% 64%`** (≈ `#B262DA`) + `--ring`. Already used site‑wide as the general highlighter — which Tom wants to keep. No wiring work needed.
- **Green (brand secondary)** = **`--success 142 60% 42%`** (≈ `#73A94C`) — this is the token green **already** lives in, and it's used only narrowly today (scan overlay, film‑pass success, a check icon). Use `--success` as green's source of truth.

**⚠️ Do NOT touch the CSS `--secondary` token.** Despite the brand calling green "secondary," the CSS token literally named `--secondary` is a **dark gray (`0 0% 14%`)** used broadly for secondary button/surface backgrounds. Painting it green would splash green across the whole site — the exact opposite of the "very specific, key action items only" intent. Green stays in `--success`; `--secondary` (gray) is left alone. *(This is the naming trap — the brand word and the CSS token collide.)*

## Where green lives — sparse, key CTAs only (this is what makes it evaluable)
Purple is a **general** highlighter (great, leave it). Green is the opposite: a **rare, deliberate** accent for key action items so they stand apart. Wire green onto a small, specific set of CTAs so it actually appears and can be judged in context — starting with Tom's example:
- **"Get Tickets" button → green**, so it reads as a distinct action from the (purple/neutral) **Donate** button in the top nav.
- Keep the set tiny (Get Tickets, and at most one or two other primary calls to action). Green's whole job is to be scarce. Decision 1 confirms the exact list.

Mechanically: point those CTA elements at the green token (`bg-[hsl(var(--success))]` / the `success` Tailwind color, with `--success-foreground` for text). Because they reference the token, the Lab's green control recolors them live. This is a small, real styling change (Get Tickets becomes green by default) — intended, and trivially reverted if the team rejects it.

## Mechanism — session‑scoped, per‑viewer, zero blast radius
1. **Storage = `sessionStorage`** (client‑only, per‑tab, cleared when the tab closes) — the exact "just this person's session, logged in or not" semantic: never sent to the server, never touches the DB, **cannot affect another visitor or the real theme**. (The no‑storage rule is only for Claude.ai artifacts, not the site.)
2. **Apply on load:** a small provider at the app root reads the saved purple/green from `sessionStorage` and, if present, sets overrides via `document.documentElement.style.setProperty('--primary','<H S% L%>')`, `--ring`, and `--success` (+ `--chart-*` if desired), in the tokens' `H S% L%` format. With nothing saved, the site renders its normal defaults.
3. **Live edits:** the panel writes to `sessionStorage` and applies immediately (no reload). **"Reset to default"** clears the keys and removes the inline overrides.
4. **Never writes `index.css`.** The real tokens stay the source of truth; the Lab only layers ephemeral inline overrides for the current session.

## The Lab panel (reuse the existing Color Lab UI)
Port the Color Lab already built (`colorlab.html`, in the project workspace — can be dropped into the repo):
- **Purple** presets + custom picker and **green** presets + custom picker (defaults purple `#B262DA`, green `#73A94C`).
- **Live contrast readout** vs the fixed background `#0F0F0F`, flagging the **4.5:1** floor (the current magenta scores only ~4.6:1 — the older‑patron readability concern). Reuse the artifact's contrast math verbatim.
- Show chosen purple/green beside the **fixed** gold + cream so the full story is judged together.
- Convert chosen hex → the `H S% L%` string the CSS vars expect.

## Activation — the secret path Tom specified
No public affordance. The Lab is reached by a deliberate, hidden route so the team can get to it but the public never stumbles on it. **The footer link is the entry point, and it changes based on whether the viewer is logged in:**

**Logged‑OUT viewer (the public + reviewers who haven't signed in):**
1. **Footer → "Staff login"** link → the `/auth` login screen. *(The footer link is currently "Sign In"; renaming it to a quiet "Staff login" is part of `BRIEF-disable-member-login.md` — light dependency; the `/auth` route already exists either way.)*
2. On the login card, **click the vector/logo icon in the card header** — currently the `<Film>` icon at `src/pages/Auth.tsx:103–104` (swap to the Kenworthy vector logo if preferred). That click **opens/enables the Color Lab** and records it in `sessionStorage` so the panel stays available (as a small floating control) while the person browses the whole site for the rest of the session.
3. No login required to trigger it — clicking the icon opens the Lab whether or not they sign in (so non‑staff reviewers can use it too).

**Logged‑IN viewer (staff/admin):** the footer "Staff login" link is gone for them (they're already signed in — per `BRIEF-disable-member-login.md`, that footer entry only shows to logged‑out users). Since that's the **only** path to the Lab, a logged‑in staffer would otherwise have **no way in**. So: **for logged‑in viewers, replace the "Staff login" footer link with a "Color Lab" link** in the same footer spot. Clicking it opens/enables the Color Lab directly (same `sessionStorage` toggle + floating panel) — no trip through `/auth` needed. Net effect: the footer always carries the entry point; it's the login‑card icon when logged out, and a direct "Color Lab" link when logged in.

**Footer logic summary** (in `src/components/Layout.tsx`, where the footer auth link lives): `user ? <Link "Color Lab" → opens the Lab> : <Link "Staff login" → /auth (icon opens the Lab)>`.

- Wrap the whole feature in a flag `VITE_COLOR_LAB` (default **on** for now) so it's one line to switch off later (mirrors the `MEMBER_ACCOUNTS` / `CONCESSION_SQUARE_PUSH` pattern). When the flag is **off**, the footer just shows the normal "Staff login" (logged out) / nothing‑or‑account (logged in) — no "Color Lab" link.

## When the colors are chosen (the exit)
This is a **decision tool, not the shipped theming mechanism.** Once the purple and green are settled, someone **bakes the chosen HSL values into `src/index.css`** deliberately, and the Lab is flipped off via the flag (code kept for the next round). The session override never silently becomes the real theme.

## Settled decision (locked by Tom — not open)
- **Green = `--success`; the gray `--secondary` token stays gray.** Green's source of truth is the existing `--success` token; the CSS `--secondary` (dark gray) is left exactly as it is and is never touched by the Lab. This is decided — no need to revisit.

## Decisions for Tom (remaining)
1. **Green's home:** confirm the exact key CTAs that turn green (Get Tickets for sure — any others?). Keep it scarce.
2. **Trigger icon:** keep the current `<Film>` icon as the secret trigger, or swap the login card to the Kenworthy vector logo and use that.
3. **Does purple also drive the pinker `--sidebar-primary`/`--chart-1` (333°)?** Follow the chosen purple, or leave as a distinct accent?

## Test plan
- **Logged out:** footer "Staff login" → `/auth` → clicking the header icon opens the Color Lab; it persists across navigation for the session.
- **Logged in (staff/admin):** the footer shows a **"Color Lab"** link (not "Staff login"); clicking it opens the Lab directly, no `/auth` detour — a logged‑in staffer is never locked out.
- Picking a **purple** recolors the whole site instantly (highlights, links, focus rings) — no reload.
- Picking a **green** recolors the **Get Tickets** CTA (and any other wired key actions) live; nothing else turns green — proving green is scarce and `--secondary` (gray) is untouched.
- Off‑black, off‑white, gold **never change**.
- The change is **invisible in a second browser/incognito session** on the same live site (per‑viewer isolation); nothing hits the DB.
- **Reset** restores the shipped theme; closing the tab clears it.
- A normal public visitor who never clicks the secret icon sees **no** Color Lab.
- Flipping `VITE_COLOR_LAB` off removes it cleanly; `npm run build` passes.

---

## Implementation notes (built 2026-08-16, branch `feat/colorlab-live`)

### Decisions taken (Tom, at build time)
1. **Green CTAs:** the header **Tickets** button plus the three home
   **Get Tickets** buttons — four in all, listed in `src/lib/greenCta.ts`.
   Film Passes and Donate stay purple.
2. **333° magenta:** the Lab's purple also drives `--sidebar-primary`,
   `--sidebar-ring` and `--chart-1`, and `.glow-primary` was tokenised. The old
   magenta is kept in the Lab as **"Old Magenta"**, a reference swatch.
3. **Green default:** `--success` stays the shipped emerald. Nothing is baked in;
   the Lab is the decision tool and the bake is a separate, deliberate edit.
4. **Trigger icon:** the sign-in card's `<Film>` icon was replaced by the
   Kenworthy lockup, and that is the secret trigger.

### Two corrections to the brief above
- **The green hex in the brief is wrong.** It calls `--success: 142 60% 42%`
  "≈ `#73A94C`". It is **`#2BAB5A`**, a saturated emerald. `#73A94C` is the
  *olive candidate* ("Antique Green") from `public/colorlab.html` — a thing being
  auditioned, not the current value. So Reset returns to emerald, which is
  correct and not a bug.
- **`.glow-primary` had never followed `--primary`.** It hardcoded
  `hsl(333 78% 52% / 0.45)` — the pre-amethyst magenta — so the sign-in card,
  the seat map and the film-pass cards had been glowing the old brand colour
  since the amethyst switch. A literal also cannot be re-themed, which the Lab
  needed. Now `hsl(var(--primary) / 0.45)`.

### One bug found by building it
Making green a **solid fill** exposed a latent contrast fault. `--success-foreground`
shipped as cream, which is **2.75:1** on the emerald — below even the 3:1
large-text floor. It had never been visible because every prior use of `--success`
was a 15% tint or a text colour; nothing had ever laid the foreground on top of
it. Changed to off-black, **6.46:1**, and pinned by test. Nothing else consumed
the token.

Relatedly, the panel now reports **two** ratios per swatch, not one: the colour
as *text* on the background (what the standalone Lab measured) and text on a
*filled button* of that colour. They disagree — Heritage Grape reads fine as a
link at 4.5:1 but manages only 4.2:1 as a button — and both matter now that
purple and green are both filled CTAs. Poor candidates are still offered, with
the number shown; the Lab exists to reject things with evidence.

### Deviation from the ported code
`textOn()` in `public/colorlab.html` picks ink by a luminance threshold
(`lum > 0.4`). That was fine for a mock, but it gets the shipped amethyst wrong —
it chooses cream (3.1:1) over the off-black `index.css` actually ships (5.6:1),
so merely *opening* the Lab would have made every primary button harder to read.
`pickForeground` compares the two candidate inks by real contrast instead. All
other maths is ported verbatim.

The custom picker is the browser's native `<input type="color">` rather than a
port of the standalone Lab's hand-built HSV square: same capability, keyboard
accessible for free, far less code to ship to the public site.

### Verified in a browser (dev server, staging mode)
- Logged out: `/auth` → clicking the lockup opens the Lab, no sign-in needed;
  it survives navigation.
- Picking a purple recolours the site live; picking a green recolours only the
  four CTAs. `--background`, `--foreground`, `--accent` (gold) and the grey
  `--secondary` were read back unchanged.
- A second tab on the same site shows **no** panel and the shipped tokens —
  per-viewer isolation holds.
- Reset **removes** the inline properties rather than writing defaults back, so
  `index.css` stays the only source of truth.
- `VITE_COLOR_LAB=false`: no panel, inert trigger, and a stale "on" session left
  by an earlier bundle is cleared rather than honoured.
- The logged-in footer swap is covered by `entryPoints.test.tsx` instead of a
  browser — it needs a real session, and the two branches are mutually exclusive.

### The exit
The panel prints the rounded `H S% L%` triplets for `--primary`, `--ring` and
`--success` with a copy button. Paste them into `src/index.css`, set
`VITE_COLOR_LAB=false`, and keep the code for the next round. **If the chosen
green changes, re-check `--success-foreground` against it** — that pairing is
exactly what was wrong before.
