# Brief (for Claude Code): Publish the Color Lab team tool at /colorlab.html

**Status:** 🟢 Ready — the page is built and verified; delivered as `colorlab.html`.
**Date:** August 13, 2026
**Requested by:** Tom — host the Color Lab (palette study tool) on the site so the team can pick the new purple/green together.

## Goal
Serve the self-contained `colorlab.html` at `https://<site>/colorlab.html` so anyone with the link can use it.

## What the file is
A single, fully self-contained HTML page (inline CSS + JS; the only external reference is a Google Fonts `@import`, which loads fine in a browser). It lets the team audition purple and green accents live against the real background, gold, and cream, with WCAG contrast ratios and PASS / LARGE-ONLY / LOW tiers.

**Enhancement already included** (per Tom's request): alongside the preset swatches, each of purple and green now has a **custom picker** — a native color input plus a hex text field. A custom pick computes its own contrast ratio against the `#0F0F0F` background and its tier using the same formula as the presets (verified: the presets' precomputed numbers reproduce exactly), updates the live preview, clears the preset highlight, and refreshes the recommendation line. No build step or dependency was added.

## Steps
1. Place `colorlab.html` at **`public/colorlab.html`** (NOT `src/pages/` — those are React components; `public/` is copied verbatim into `dist/` and served as a static file, like `robots.txt`/`favicon.svg`).
2. Commit, push, then **rebuild and deploy** (`npm run build:staging` → `wrangler deploy --env staging`, and/or `build:production` → `wrangler deploy`). Pushing alone doesn't publish it — it has to go through the build into `dist/`.
3. Open `https://<site>/colorlab.html`.

## Notes
- **Use the `.html` URL.** The Worker is `single-page-application`, so an extensionless `/colorlab` would fall through to the React app and 404; `/colorlab.html` is a real file and is served directly.
- **Service worker:** the workbox config precaches `**/*.html`, so `colorlab.html` is precached and served correctly, and `registerType: 'autoUpdate'` means a later edit ships on the next deploy. No config change needed.
- **Visibility:** it's publicly reachable by anyone with the URL but isn't linked anywhere (effectively unlisted) — fine for a color tool with no sensitive data. If it ever needs to be private, it would have to move behind the staff login (a React route + guard), which is more work.

## Verify
- `/colorlab.html` loads; clicking preset swatches updates the live "Live pairing" preview and the recommendation line.
- The custom purple/green pickers (color input + hex field) update the preview and show a live contrast ratio + tier; a very dark custom color reads LOW, a bright one reads PASS.

---

## Verification results (Aug 13, 2026)

Verified against a real `build:staging` → `vite preview` serve of `dist/`, in a browser.

**Confirmed as written:**
- `public/colorlab.html` is copied verbatim into `dist/` and appears in the
  workbox precache manifest in `dist/sw.js`. No config change was needed.
- The precache route wins over `navigateFallback: '/index.html'` — workbox
  registers precache routes before the NavigationRoute and matches in
  registration order, so `/colorlab.html` serves the real file, not the SPA.
- Custom pickers update the preview, clear the preset highlight, refresh the
  recommendation line, and compute their own ratio/tier. A dark pick
  (`#1A0B25`) reads LOW 1:1; a bright one (`#D9A8F5`) reads PASS 9.9:1.
  Invalid hex input is ignored without breaking state.

**One correction to the brief's claims.** "The presets' precomputed numbers
reproduce exactly" was true for 13 of 14 swatches, not all 14, and the tiers
were worse: `c` and `tier` were hand-typed next to each hex, and two had
drifted from the formula.

| Swatch | Ratio | Badge shown | Badge per the page's own legend |
|---|---|---|---|
| Forest `#24604A` | 2.6:1 | LARGE ONLY | **LOW** (`<3:1`) |
| Bottle `#195738` | 2.247:1 | LARGE ONLY | **LOW** (`<3:1`) |

Bottle also hard-coded `c: 2.25` (two decimals) where every other swatch used
one, so the preset printed `2.25` while the custom path printed `2.2` for the
same color. Both are correct roundings of 2.247 — the table was just
inconsistent.

This mattered: the legend at the top of the page defines LOW as `<3:1`, so two
swatches were contradicting it in the one judgment the tool exists to make.

**Fix applied — cause, not symptom.** Rather than retyping the two wrong
values, `c` and `tier` were removed from the preset tables entirely and are now
derived from the hex through a shared `withMetrics()` that `makeCustom()` also
uses. The tables now carry only editorial fields (name, hsl, note). Presets and
custom picks are the same code path by construction, so this class of drift
cannot recur.

Re-verified after the fix: all 14 badges agree with the legend's thresholds,
and preset↔custom parity is 14/14.

**Caveat for existing visitors.** Anyone whose browser already has an older
service worker gets the SPA 404 on their *first* hit to `/colorlab.html` — the
old SW serves that navigation before the new one takes over. A single reload
fixes it, permanently. Worth saying in the message that shares the link.
