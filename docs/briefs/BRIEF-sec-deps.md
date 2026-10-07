---
brief: sec-deps
title: No known-vulnerable package ships to the browser — TipTap 3, react-router 7, SheetJS 0.20.3, Dependabot backlog triaged
status: shipped
track: security
date: 2026-10-06
verified: true
findings: ../AUDIT-security-2026-10-06.md
shipped_in: ["#365", "bae77aa"]
shipped_at: 2026-10-07
evidence: "Worker prod 72decd4e (rollback fe2e750b), first deployed then rolled back on 2026-10-07 when the editor check turned out to have run on production; re-shipped the same day after a TipTap 3 edit was confirmed on staging (superadmin, clean HTML). npm audit --omit=dev 47 -> 0; 12 superseded Dependabot PRs closed, #12 (jsdom) left open"
---

# Browser-side vulnerable dependencies: L5, and the library half of M5

Audit 2026-10-06 finding **L5** (evidence DEP-2 in the audit's secrets/deps
domain), plus the react-router half of **M5** (DEP-1). M5's code-level guard,
`safeRedirectPath` in `src/lib/safeUrl.ts`, shipped in #359 and is untouched;
the router upgrade here is defence in depth behind it.

## Result

| | before (main, de88e39) | after |
|---|---|---|
| `npm audit --omit=dev` | **47** — 17 high, 29 moderate, 1 low | **0** |
| `npm audit` (full) | **63** — 27 high, 34 moderate, 2 low | **8** — 5 high, 3 moderate |

The 8 left are all the Tailwind 3 build chain (`tailwindcss` → `chokidar` /
`fast-glob` / `micromatch` / `braces`, `postcss-nested`, and
`@tailwindcss/typography` → `postcss-selector-parser`). They are ReDoS/DoS in
glob matching and CSS-selector parsing that only ever see our own source files
at build time. npm's only fix is Tailwind 4, a rewrite of the CSS config —
its own piece of work, not a security fix.

## What each finding was, and what changed

### prosemirror-view paste XSS (GHSA-c8x8-7fp4-3x9w, high) — and a TipTap one

**What it was.** `prosemirror-view` 1.42.2, under the TipTap editor that
`src/components/ui/rich-text-editor.tsx` puts on 12 admin and host screens.
Pasting attacker-shaped HTML (a copied "press kit" synopsis) could run script
in the staff session.

The audit also turned up **GHSA-cp6q-959q-f8rh** (moderate) in `@tiptap/core`
itself: `mergeAttributes()` turns an own `__proto__` key into inherited DOM
attributes. It covers every 2.x release and is fixed only in 3.30.4, so an
`overrides` pin on prosemirror-view alone would have left TipTap flagged.

**What changed.** TipTap 2.27.2 → **3.31.4** (`@tiptap/react`, `@tiptap/pm`,
`@tiptap/starter-kit`), which brings prosemirror-view **1.42.6**.
`@tiptap/extension-link` is no longer a direct dependency: TipTap 3's
StarterKit ships Link, and it is configured there with the same options as
before. Three TipTap 3 changes would have been visible, and each is turned
back to 2.x behaviour:

- **Underline joined the kit.** `underline: false`. `<u>` is not on the render
  allowlist in `src/lib/richText.ts`, so Ctrl+U would have produced formatting
  that vanishes on the public page — the exact case the editor's header
  comment warns about.
- **TrailingNode joined the kit.** It appends an empty `<p>` after any edit
  that leaves a heading, list or divider last, which would change stored HTML.
  `trailingNode: false`.
- **No re-render per transaction.** The toolbar reads `isActive()` during
  render, so Bold would not light up or announce `aria-pressed`.
  `shouldRerenderOnTransaction: true`.
- `setContent(next, false)` → `setContent(next, { emitUpdate: false })` (the
  v3 signature; same meaning).

**Proof.** `src/components/ui/rich-text-editor.test.tsx` gains four tests:
the toolbar button lights when its mark is on; a heading at the end stores as
`<h3>Notes</h3>` with no appended `<p>`; Ctrl+U does nothing while Ctrl+B
works; and applying a link stores `href` (scheme added), `target="_blank"`
and `rel="noopener noreferrer"`. Each of the first three was mutation-checked:
removing its option turns exactly that test red. The existing editor tests,
`RichText.test.tsx`, `richText.test.ts`, `MovieForm.test.tsx` and
`EventForm.test.tsx` all pass unchanged. Public rendering goes through
DOMPurify (`RichText` / `richText.ts`), not TipTap, so it is unaffected.

The paste path itself was not exercised: jsdom cannot drive ProseMirror's
clipboard handling. The fix is the library version; `npm audit` no longer
lists it.

### react-router open redirect (GHSA-9jcx-v3wj-wh4m, GHSA-wrjc-x8rr-h8h6) — M5's library half

**What it was.** react-router-dom 6.30.1 / @remix-run/router 1.23.0.
`navigate('//evil.example')` or `navigate('/\\evil.example')` leaves the site.

**The 6.x line cannot fix it.** GHSA-9jcx (`//host`) is fixed in 6.30.2, and
Dependabot PR #25 offered 6.30.4. But the backslash bypass GHSA-wrjc is fixed
**only in 7.18.0** — npm audit gives its range as `>=6.0.0 <7.18.0`. The new
test in `src/lib/safeUrl.test.tsx` confirmed this against the real package:
on 6.30.6 (the newest 6.x) an unguarded `/\evil.example/phish` still resolved
to `http://evil.example/phish`. A further advisory, GHSA-337j-9hxr-rhxg
(`>=6.4.0 <7.18.0`), also appeared once 6.30.6 was installed.

**What changed.** react-router-dom → **7.18.4** (react-router 7.18.4; the
separate @remix-run/router package is gone). The app uses only declarative
APIs (`BrowserRouter`, `Routes`, `Route`, `Link`, `Navigate`, `useNavigate`,
`useParams`, `useLocation`, `useSearchParams`, `MemoryRouter` in tests), all
unchanged in v7. Two v7 defaults were checked:

- **Navigation in `startTransition`.** v7 wraps every navigation in a
  transition, which keeps the old page on screen while a lazy route loads
  instead of showing its Suspense fallback. That is a visible change to every
  page, so `src/App.tsx` passes `<BrowserRouter useTransitions={false}>` to
  keep the 6.x behaviour. Turning it on is a UX choice to make separately.
- **Relative paths in splat routes.** The only splat route is `path="*"` →
  `NotFound`, whose one link is a plain `<a href="/">`. Nothing to change.

v7 now refuses `//host` and `/\host` itself by throwing "External navigation
is not allowed" from `navigate()`. `safeRedirectPath` stays the control the
sign-in page relies on: it sends those values to `/`, so the throw is never
reached from `/auth`.

**Proof.** `src/lib/safeUrl.test.tsx`:
- The `react-router 6.30.1` control test now skips itself, as designed.
- All 7 hostile inputs, guarded by `safeRedirectPath`, stay on the site
  through the installed 7.18.4 router. These ran and passed (22 passed,
  1 skipped).
- New: "the installed router (7.18.4) keeps even an unguarded `//host` or
  `/\host` on this site". It failed on 6.30.6 and passes on 7.18.4, so a
  downgrade turns it red.

Checked in a real browser too. The staging build was served by
`vite preview`, and Chrome clicked through five public routes (calendar,
rentals, donate, film-passes, a showing page). All were client-side
navigations, and Back worked each time. An unknown path rendered the 404
page, and `/auth?redirect=/\evil.example/x` rendered the staff sign-in form.
The only console error was the app's own 404 log.

### xlsx 0.18.5 — prototype pollution (GHSA-4r6h-8v6p-xvw6) and ReDoS (GHSA-5pgg-2g8v-p4x9)

**What it was.** No fix on npm: SheetJS stopped publishing to the registry at
0.18.5. It is used only by `src/lib/parseFinancialXlsx.ts`, which handles the
admin Accounting tab's upload.

**Decision: SheetJS 0.20.3 from SheetJS's own CDN, not exceljs.** The
hand-maintained Technical Debt row in `docs/TASKS.md` says "no security fix —
replace with exceljs". That premise was wrong. The fixes exist (0.19.3 for the
pollution, 0.20.2 for the ReDoS); SheetJS publishes them only at
`cdn.sheetjs.com`. 0.20.3 has the same API, so `parseFinancialXlsx.ts` is
unchanged. exceljs would mean rewriting the parser against a different cell
model, which risks exactly what this upload has to get right: dates and money.
It would also add a larger browser bundle and exceljs's own zip/stream
dependency tree. The lead should update that TASKS.md row; it is in the
hand-maintained block, and this brief does not edit TASKS.md.

`package.json`: `"xlsx": "https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz"`.
The lockfile carries its `sha512`. That hash was checked independently: a
fresh `curl` of the tarball gives the same digest. All 925 `resolved` entries
have an `integrity` entry. npm and Dependabot cannot see new SheetJS releases
at this URL, so updates are manual from now on.

**Proof.** New `src/lib/parseFinancialXlsx.test.ts` builds a workbook the way
Excel stores one (serial-number dates, currency strings, a blank row, a
MONTH TOTAL row, a non-month sheet) and pins what the parser returns. The
same test was run against **both** 0.18.5 (on main) and 0.20.3, under
`TZ=America/Los_Angeles`, `UTC`, `Asia/Tokyo` and `Pacific/Kiritimati`. The
results were identical on both versions in every zone.

**Pre-existing defect found, not changed here.** East of UTC, the parser
reads a date one day early. `toIsoDate` reads SheetJS's local-midnight `Date`
with `getUTC*`. Both versions behave the same way, and the theatre (Pacific
time) and UTC are both correct. The date assertion therefore runs only where
the offset is ≥ 0. Fixing it would use the local getters for `Date` cells,
or `cellDates: false` plus `SSF.parse_date_code`. It is a behaviour change for
whoever owns the accounting import.

### lodash, ws, dompurify (runtime, via the Dependabot backlog)

lodash 4.17.21 → 4.18.1 (via recharts), ws 8.19.0 → 8.22.0 (via supabase
realtime-js), and dompurify 3.4.14 → 3.4.16. The audit judged none of these
reachable. They are patch/minor bumps inside existing ranges, made with
`npm audit fix` (no `--force`). That also lifted the dev-only transitive
packages listed under the Dependabot triage below.

### Build tooling filed under `dependencies`

`tailwindcss`, `postcss` and `autoprefixer` were already devDependencies. The
audit's count was inflated by **`tailwindcss-animate`**, a runtime dependency
whose peer dependency drags `tailwindcss` and its whole glob chain into the
production tree, and by **`caniuse-lite`** and **`baseline-browser-mapping`**
(browserslist data). All three are used only by `tailwind.config.ts` or the
build, so they moved to devDependencies (the last two picked up their current
data releases on the move). The Cloudflare Workers Build runs `npm ci`, which
installs devDependencies; it has to, since `vite` itself is one.

## Bundle impact (`npm run build:production`, main vs branch)

Same 187 chunks plus two new shared ones: `es` (fast-equals, now shared by
TipTap 3 and recharts) and `preload-helper`. No chunk disappeared. Both builds
carry the production Supabase ref, and neither carries the staging ref.

| chunk | Δ raw | Δ gzip | who loads it |
|---|---|---|---|
| entry `index` | +38.0 KB | +12.6 KB | everyone — react-router 7 |
| `dist` (react-router 6 / @remix-run/router, gone) | −19.0 KB | −7.0 KB | everyone |
| **initial load, all 32 files in index.html** | **+21.5 KB** | **+6.6 KB (+2.6%)** | patrons |
| `rich-text-editor` | +59.6 KB | +19.2 KB | admin/host forms only — TipTap 3 |
| `AccountingTab` | +31.8 KB | +9.6 KB | admin only — SheetJS 0.20.3 |

prosemirror is still only in the `rich-text-editor` chunk, and SheetJS is
still only in `AccountingTab`. The public bundle carries neither. The
patron-facing cost is the 6.6 KB gzip of router v7, the price of the
backslash-bypass fix that 6.x cannot get.

## Dependabot PRs — triage (none merged or closed by this branch)

| PR | bump | runtime? | recommendation |
|---|---|---|---|
| #5 | flatted 3.3.1 → 3.4.2 | dev (eslint cache) | **close** — this branch has 3.4.4 |
| #7 | lodash 4.17.21 → 4.18.1 | runtime (recharts) | **close** — folded in |
| #12 | jsdom 20.0.3 → 29.1.1, @tootallnate/once | dev (test env) | **needs work** — @tootallnate/once is folded in (2.0.1); jsdom is nine majors of test-environment change and wants its own PR with a full vitest run. Nothing ships from it. |
| #13 | minimatch 3.1.2 → 3.1.5 | dev | **close** — folded in |
| #15 | form-data 4.0.5 → 4.0.6 | dev | **close** — folded in |
| #17 | vite 5 → 8, plugin-react-swc, lovable-tagger, vitest 3 → 4 | dev | **close** — superseded; main is already on vite 8.1.5 and vitest 4.1.x, and lovable-tagger is no longer a dependency |
| #19 | ws 8.19.0 → 8.21.1 | runtime (realtime-js) | **close** — this branch has 8.22.0 |
| #20 | yaml 2.6.0 → 2.9.0 | dev | **close** — this branch has 2.9.1 |
| #25 | @remix-run/router 1.23.3, react-router-dom 6.30.4 | runtime | **close** — insufficient: 6.x never gets the GHSA-wrjc fix (see above) |
| #27 | postcss 8.5.19 → 8.5.26 (+ range ^8.5.26) | dev | **close** — lock has 8.5.29 |
| #28 | js-yaml 4.1.0 → 4.3.1 | dev | **close** — this branch has 4.3.2 |
| #29 | react-router(-dom) 6.30.1 → 7.18.2 | runtime | **close** — superseded by 7.18.4 here, with the `useTransitions` decision and tests |
| #30 | brace-expansion 1.1.12 → 1.1.18 | dev | **close** — this branch has 1.1.21 |

Once this merges, Dependabot should close most of these itself as
"superseded" on its next run. Close any it leaves.

## Checks run (branch vs main)

| check | branch | main |
|---|---|---|
| `npx tsc -p tsconfig.app.json --noEmit` | 9 errors | 9 — same, all `Array.at` in `NotificationsTab.test.tsx` |
| `npm run check:worker` | `wrangler types --check` fails; `tsc -p tsconfig.worker.json` passes | same failure |
| `npx vitest run` | 85 files, 1064 passed, 3 skipped, 10 unhandled errors | 84 files, 1057 passed, 2 skipped, 10 unhandled errors |
| `npx eslint .` | 968 errors, 27 warnings | identical |
| `deno check --node-modules-dir=none supabase/functions/*/index.ts` | 3 errors | 3 — the known crypto `Uint8Array` ones |
| `deno test --node-modules-dir=none --allow-env supabase/functions` | 539 passed, 0 failed, 3 ignored | (no function changes) |
| `npm run build:production` | ok, prod ref present | ok |
| clean clone → `npm ci && npm run build:staging` | ok, staging ref present | — |

`check:worker` fails the same way on main. `wrangler` is not in
`package.json`, so `npx wrangler` fetches the latest release (4.148.0), whose
types hash differs from the committed `worker-configuration.d.ts`. Fix: pin
`wrangler` as a devDependency, or regenerate the file. Out of this brief's
scope.

The 10 unhandled vitest errors are the same set on main (Calendar-OLD chunk
recovery, `window.scrollTo`, and `.filter` mocks). The new router test prints
an expected "External navigation is not allowed" trace from jsdom; that trace
is the test passing.

## Deploy steps

No migrations, no edge functions. This is a Worker + assets deploy only.

1. `npx wrangler deployments list --name kenworthy-ticketing-build` and record
   the current Version ID (the list is oldest-first, so take the last entry).
2. Check production is not ahead of main (`scripts/compare-prod-chunks.mjs`).
3. From the merged main, in a clean worktree: `npm ci`, then
   `npm run build:production`. Confirm `grep -l vlmslygnimfbamrtwvyo dist/assets/*.js`
   is non-empty and `grep -c "External navigation is not allowed" dist/assets/index-*.js`
   is 1, which confirms router 7 is in the entry.
4. Staging first: `npm run build:staging && npx wrangler deploy --env staging`.
   Then, on staging, as staff:
   - Open a Movie edit form, type, bold a word, add a link, and save. The
     description renders the same on the public showing page.
   - Paste a paragraph copied from any web page into the description. It
     lands as plain paragraphs, links and bold only.
   - Accounting tab: upload last year's Income & Expenses workbook. The row
     count and dates match what the same file produced before.
   - Visit `/auth?redirect=/%5Cevil.example/x` and sign in. You land on `/`
     on the staging host.
5. Production: `npm run build:production && npx wrangler deploy`. Then check
   with a cache-bypassing `curl` that the new `index-*.js` is served, and
   click through `/`, `/calendar`, a showing page, and Back.

Safe post-deploy checks are read-only. The sign-in redirect check sends you to
our own `/` by design.

## Rollback

`npx wrangler rollback <previous Version ID from step 1>`. Nothing in this
change touches the database or stored data. The editor stores the same HTML
as before (pinned by tests), so a rollback leaves nothing behind.
