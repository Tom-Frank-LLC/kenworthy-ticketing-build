# Brief (for Claude Code): Gate the DVD page + nav entries to logged-in users only

**Status:** 🟢 Ready — small, self-contained; resolves `BRIEF-disable-member-login.md` audit item #7
**Date:** August 14, 2026
**Requested by:** Tom — the DVD rentals page and its nav-bar entries should be visible only to logged-in users; the public should not see DVDs.

## Key implication — read first
Since `BRIEF-disable-member-login.md` removed patron login, **"logged-in" now means staff / admin / superadmin / host only.** So gating `/dvds` behind login effectively makes DVD rentals a **staff-facing** feature — the public will no longer see it at all. That is the intended outcome here (it also closes the open audit item #7 in the disable-member-login brief: "confirm whether `/dvds` is a patron feature that needs login… place accordingly"). If instead the goal is for *patrons* to browse/reserve DVDs, that requires a token/guest path, not a login gate — see Decision 1.

## Current state (verified, file:line)
- **Route is public:** `App.tsx:112` → `<Route path="/dvds" element={<Dvds />} />` with **no guard**. Anyone can open it.
- **The page loads the catalog for everyone;** only the *reserve action* is gated: `src/pages/Dvds.tsx` `reserve()` (~L50) does `if (!user) { toast.error('Sign in…'); navigate('/auth?redirect=/dvds') }`, and each card shows a **"Sign in"** button when `!user` (~L225). So today an anonymous visitor sees the full DVD list but can't reserve.
- **Three nav entries point at `/dvds`:**
  1. `src/components/Layout.tsx:99–100` — a **public** desktop top-nav link "DVDs" (`hidden lg:inline`), in the left-nav block **outside** any `{user && …}` gate → visible to everyone. **Must gate.**
  2. `src/components/Layout.tsx:172` — "DVD Rentals" inside the **"Me" dropdown**, which is already inside the `{user ? (…)}` block → **already gated** (no change needed, though the Me-dropdown is being reworked by the disable-member-login brief — leave to that).
  3. `src/components/MobileNav.tsx:42` — "DVD Rentals" in the static `primaryLinks` array (L39), rendered unconditionally at `primaryLinks.map(…)` (L148), **outside** the `{user && (…)}` staff block (L153) → visible to everyone. **Must gate.**

## Changes

### 1. Guard the route (page access)
The app has **no** `ProtectedRoute`/`RequireAuth` component today — pages self-guard via `useAuth()` + `navigate` (e.g. `AdminDashboard.tsx:116`, `Superadmin.tsx:27`). Two acceptable approaches; **recommend a small reusable `RequireAuth` wrapper** (prevents the flash-of-catalog and is reusable), with the self-guard as the lighter alternative:

- **Recommended — `RequireAuth` wrapper (in `App.tsx`):** a tiny component that consumes `useAuth()` and:
  - while `loading` → render nothing / a spinner (do **not** decide yet);
  - once resolved and `!user` → `<Navigate to={'/auth?redirect=/dvds'} replace />`;
  - else render children.
  Wrap the route: `<Route path="/dvds" element={<RequireAuth><Dvds /></RequireAuth>} />`. Reusable for any future logged-in-only page.
- **Alternative — self-guard inside `Dvds.tsx`** (matches current convention): an effect that redirects when `!loading && !user`, and renders a spinner/null while `loading || !user` so the catalog never flashes for anon.

**Correctness detail (important):** the guard must key off `loading` from `useAuth()` and only redirect **after auth resolves**. If it redirects while `loading` is still true, a logged-in staff member gets bounced to `/auth` on every refresh. Use the existing `loading` flag (already exposed by `useAuth`, used this way in `AdminDashboard`/`Superadmin`). Preserve the `?redirect=/dvds` param so post-login returns them to the page (the reserve flow already uses that target).

Once the page is login-only, the per-card **"Sign in"** button and the `!user` branch in `reserve()` (`Dvds.tsx` ~L225, ~L50) become dead (a logged-out user can't reach the page). Simplify: the card action is just **Reserve / Reserved / Unavailable**; drop the `!user` "Sign in" branch. (Low priority cleanup — safe to leave, but tidier to remove.)

### 2. Gate the nav entries
- **`Layout.tsx:99–100`** — wrap the public "DVDs" top-nav link so it only renders for logged-in users: `{user && <Link to="/dvds" …>DVDs</Link>}`. (`user` is already in scope in this component.)
- **`MobileNav.tsx`** — move **"DVD Rentals"** out of the always-rendered `primaryLinks` (L42) and render it only when `user` is present — either add it to the existing `{user && (…)}` block (L153, alongside `staffLinks`) or push it into `staffLinks` (L112–119). `useAuth()`/`user` are already available (L85).
- **`Layout.tsx:172`** ("Me" dropdown entry) — **no change** (already inside `{user ? …}`).

## Not a security boundary — note
This is a **UX/navigation** change only. Hiding the page and links does **not** secure the underlying data — that's RLS's job. `dvds` (public-safe catalog) and `dvd_rentals` (patron/staff transactional) are already covered by `BRIEF-rls-security-audit.md` (dvds = public content; dvd_rentals = staff+). Don't treat this brief as securing DVD data; it changes who *sees the page*, not who *can query the tables*. (If DVDs should also be removed from anon at the API/RLS level, handle that in the RLS audit, not here.)

## Also check
- **`public/sitemap.xml` / `robots.txt`:** if `/dvds` is listed in the sitemap, remove it (don't advertise a logged-in-only page); confirm robots handling is consistent with the other gated routes.
- **Direct-link behavior:** hitting `/dvds` while logged out should cleanly land on `/auth?redirect=/dvds`, not a blank or error page.

## Decisions for Tom
1. **Is login-gating actually what you want, given login = staff-only now?** (a) **Yes — DVDs become staff-only** (this brief as written; staff reserve at the box office). (b) You actually want **patrons** to browse/reserve → then we need a guest/token path instead of a login gate (bigger; overlaps the disable-member-login token work) — say so and I'll rescope. *(Proceeding with (a) as asked.)*
2. **Guard mechanism:** reusable `RequireAuth` wrapper (recommended) vs. self-guard inside `Dvds.tsx` (matches current per-page convention).
3. **Dead "Sign in" UI cleanup** in `Dvds.tsx`: remove now (tidier) or leave (harmless).

## Test plan
- **Logged out:** the "DVDs" desktop link and the mobile "DVD Rentals" entry are **not shown**; navigating directly to `/dvds` redirects to `/auth?redirect=/dvds`; after signing in as staff you land back on `/dvds`.
- **Logged in (staff/admin):** the DVD link/entry appear; `/dvds` renders the catalog; Reserve works; refreshing `/dvds` does **not** bounce to `/auth` (the `loading`-gate is correct).
- No flash of the catalog for anon before the redirect.
- `/dvds` not present in `sitemap.xml`.
- `npm run build` passes.

---

# Results — implemented August 14, 2026

**Status:** ✅ Implemented on `feat/gate-dvds-login`. Decisions taken: **1(a)**
staff-only as asked, **2** reusable `RequireAuth` wrapper, **3** dead sign-in UI
removed.

## The brief was written against an older `Dvds.tsx` — what is actually there

The brief describes a "Sign in" button on each card and a `reserve()` that
toasts and redirects anonymous visitors. That code is gone. Audit item #7 was
already answered once, by `BRIEF-disable-member-login.md`, which resolved
`/dvds` as **browse-only public**: catalogue, search and filters public, the
card action reading "Ask at the box office" or "All copies out", with `reserve`,
`cancel` and the active-rentals section preserved behind
`MEMBER_ACCOUNTS_ENABLED`.

So this brief does not close audit #7 — it **reverses** the answer given to it.
That is a deliberate call by Tom (the public should not see DVDs at all), not a
gap being filled, and it is worth writing down because the two briefs otherwise
read as agreeing with each other when they do not.

The practical consequence: with `MEMBER_ACCOUNTS_ENABLED` off, `/dvds` is now a
**read-only page for staff**. The reserve path needs a *patron* `user_id` and
stays behind the flag, so nobody who can now reach the page can act on it.
Its remaining job is a searchable shelf list for whoever is at the counter;
checking titles in and out still happens in Admin → DVD Library. **If that is
not what you wanted, this is the sentence to push back on.**

## What changed

| File | Change |
|---|---|
| `src/components/RequireAuth.tsx` | **New.** Session-only route guard (not role-based). |
| `src/components/RequireAuth.test.tsx` | **New.** 3 cases, incl. the refresh-bounce regression. |
| `src/App.tsx` | `/dvds` wrapped in `RequireAuth`. |
| `src/components/Layout.tsx` | Desktop "DVDs" link gated on `user`. |
| `src/components/MobileNav.tsx` | "DVD Rentals" out of `primaryLinks`, into the staff block. |
| `src/pages/Dvds.tsx` | Dead sign-in branches removed; header comment corrected. |
| `public/robots.txt` | `Disallow: /dvds`, matching the other gated routes. |

**Why a wrapper and not the per-page self-guard.** The existing convention
(`AdminDashboard`, `Superadmin`) redirects from an effect, which mounts the page
first. That is fine for an admin shell that fetches nothing until it knows the
role; `Dvds` loads its catalogue on mount, so a self-guard shows the shelf and
*then* bounces. Guarding at the route decides before the component mounts —
and, because the route element is lazy, before its chunk is even requested.

**`MobileNav` keys the entry on `user`, not on a role.** The page needs a
session, not a particular one; a signed-in user with no role would otherwise see
no DVD entry anywhere below `lg`. It is pushed last so the role destinations
stay at the top of the Staff section.

**The `loading` gate is the whole correctness story.** `useAuth` starts
`loading: true` with `user: null` while `getSession()` restores from storage.
Deciding before that resolves bounces signed-in staff to `/auth` on **every
refresh** — a failure that only appears on reload, which a click-through never
does. `RequireAuth` renders App.tsx's loading state until auth answers, and
`RequireAuth.test.tsx` pins it.

## Verification

- `tsc -p tsconfig.app.json --noEmit` clean. `npm run build:staging` clean, with
  the staging project ref confirmed baked into `dist/assets` (a worktree build
  loses it silently otherwise).
- `vitest`: **20 files / 155 tests pass**, including the 3 new `RequireAuth`
  cases.
- `eslint` on every touched file: **10 problems before, 10 after** — all
  pre-existing `no-explicit-any` in `Dvds.tsx`. Nothing new introduced.
- **Logged out, in a real browser** (`vite preview --mode staging`):
  - `/dvds` → `/auth?redirect=%2Fdvds`, rendering "Staff sign in". Not a blank
    page, not an error.
  - Zero `a[href*="dvd"]` anywhere in the DOM, header or footer.
  - Mobile drawer at 390px lists What's On / Theatre Rentals / Donate / Info /
    Support only — no DVD Rentals.
  - **No flash of the catalogue, structurally, not just visually:**
    `performance.getEntriesByType('resource')` shows the `Dvds-*.js` chunk was
    **never fetched**. The page cannot flash content it never downloaded.
- `sitemap.xml` — nothing to do. `/dvds` was never listed (4 URLs: `/`,
  `/sponsors`, `/history`, `/rental-request`).

**Not verified by me: the logged-in path.** Signing in needs staff credentials I
do not have. The guard's signed-in branch and the no-bounce-on-refresh behaviour
are covered by unit test, and the nav gating is a plain `{user && …}`, but
nobody has yet watched a real staff session load `/dvds` and refresh it. Worth
one minute on staging before this goes to production.
