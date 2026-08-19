---
brief: disable-member-login
title: Turn off patron login (staff/admin-only auth), keep the data model
status: shipped
track: security
date: 2026-08-13
verified: false
---

# Brief: Turn off patron login (staff/admin-only auth), keep the data model

**Status:** ✅ Shipped to staging and production, August 14, 2026. Nothing outstanding. See **Results** at the end of this file for what changed, what the code contradicted, and how each claim was verified.
**Date:** August 13, 2026
**Requested by:** Tom — patrons no longer log in; the login area is staff/admin/superadmin only. Turn the membership capability *off*, don't delete it — Kenworthy will likely reactivate it when they launch a membership program.

## Goal & guiding principle

Disable everything patron-facing about accounts — self-signup, the login UI as a patron entry point, the "set your password" email — **while leaving the data model and code paths intact** so tickets and film passes still attach to profiles and the whole thing can be switched back on later. This is a *reversible turn-off*, gated behind a flag, not a removal. Nothing about staff/admin/superadmin/host auth changes.

Access to purchased tickets after this change is **token-based, not login-based**: the confirmation email's `/t/:token` link (the `PublicTicket` page) is how a patron sees their tickets — and that path already exists and already handles guests today.

## Decisions for you (before implementation)

1. **Staff login entry point.** The current prominent "Sign In" button in the header is now staff-only. Demote it to a quiet footer "Staff login" link, or keep `/auth` reachable but unadvertised? (Recommend: footer link; drop it from the sitemap.)
2. **Film-pass access without login — this is a blocker (see Audit #1).** A patron with a film pass currently has *no* login-free way to view/use it (`/my-passes` is auth-only). We need a token-based pass view or emailed pass QR before passes can be sold. Fold into the hybrid-film-pass work, or scope here?
3. **Dormant patron routes** (`/my-tickets`, `/my-passes`, `/profile`): leave them registered but unlinked (simplest, most reversible), or redirect patrons to home? (Recommend: leave registered + unlinked.)
4. **Reversibility mechanism:** gate behind a `MEMBER_ACCOUNTS_ENABLED` flag (recommended — one switch to reactivate), vs. just removing the UI now and re-adding later from git history. (Recommend: flag.)

## What stays exactly as-is — do NOT touch

- **`_shared/buyers.ts` `findOrCreateBuyer`** — still creates the auth user + profile via the service role during checkout. It sends **no** email on its own (`createUser` with `email_confirm: true`). Tickets and film passes keep attaching to profiles. This is the whole reason the data survives.
- **`ticket-checkout`**, pricing, capacity/holds, and all **RLS** on `tickets` / `film_passes`. Patron rows still exist; there's simply no patron session to read them (which is the intended "invisible to users" outcome).
- **`/t/:token` (`PublicTicket`)** — the login-free ticket view. Already the guest path post-purchase.
- **Confirmation email delivery (QR)** — keep. Only the set-password block is removed (below).
- **Staff/admin/superadmin/host login**, `user_roles`, `is_admin()`, role gating.

## Changes

### 1. Stop the "set your password" account email (server)
`_shared/deliver.ts` (email path, ~lines 233–258): the block that mints a recovery link —
`admin.auth.admin.generateLink({ type: 'recovery', … redirectTo …/reset-password })` → `passwordUrl`.
- Gate it behind the flag so `passwordUrl` stays `null`. `buildEmailHtml`/`buildEmailText` already render the set-password section **only when a link is present** (confirmed by `_shared/tickets_test.ts` — "includes the set-password block only when there is a link"), so nulling it cleanly drops the section. The QR ticket email still sends.
- Also soften the `accountJustCreated` copy in the email builders (`_shared/tickets.ts`): no "an account was created for you." Reword to "your tickets are attached — view them anytime with the link above."
- **No change to `buyers.ts`** — the account is still created silently.

### 2. Remove public signup (frontend + Supabase project)
- **`src/pages/Auth.tsx`**: remove the **Sign Up** tab (`TabsTrigger value="signup"` + its `TabsContent`) and the signup state/handlers; collapse to a single staff sign-in card. Reword the page `SEO` title/description away from "Sign In or Create Account / buy tickets, manage film passes" → "Staff sign in." Keep the **Forgot password** dialog (staff need it).
- **`src/lib/auth.tsx`**: the `signUp` function becomes uncalled. Keep it in place (behind the flag) for trivial reactivation rather than deleting it.
- **Supabase Auth setting, both projects (staging `rpqzrpboyhshdrfdwayk`, prod `vlmslygnimfbamrtwvyo`)**: turn **off** "Allow new users to sign up." This is safe — `buyers.ts` uses the **admin** `createUser` API, which bypasses this toggle — so buyer creation during checkout keeps working while any direct self-serve `auth.signUp` is refused. Belt-and-suspenders alongside the UI removal.

### 3. Hide the patron account UI (nav)
- **`src/components/Layout.tsx`** desktop "Me" dropdown (~lines 158–182): today *any* logged-in user sees My Tickets / Film Passes / DVD Rentals / Profile. Since logged-in now means staff, replace those with role-appropriate staff destinations (Dashboard / POS / Scanner / Host) or drop them; keep Sign Out.
- **`src/components/MobileNav.tsx`** (~lines 155–158): remove the "My Account" section (My Tickets / Film Passes / Profile).
- **Logged-out header** (~lines 185–190): the "Sign In" CTA is now staff-only — demote per Decision #1. Keep "Get Tickets."
- **`src/components/GuestCheckoutForm.tsx`** (~line 127): reword "If you already have an account, the tickets will be added to it" → "We'll email your tickets and QR codes" (no user-facing "account").

### 4. Post-purchase redirect (frontend)
`src/pages/Showing.tsx` (~lines 399–400): currently signed-in → `/my-tickets`, guest → `/t/:token`. With patrons never signed in, **always** route to the public ticket page (`ticketPagePath(order_token)`) regardless of `user`, so the post-purchase screen is consistent and login-free (and staff testing a purchase don't get dumped on an empty `/my-tickets`).

### 5. Dormant patron routes & discoverability
- `/my-tickets`, `/my-passes`, `/profile`: unlinked per Decision #3 (leave registered + unlinked, or redirect home). Keep `/reset-password` (staff), `/t/:token`, `/verify/:id`, `/contract/:token`.
- Drop `/auth` from `public/sitemap.xml` (don't advertise staff login). `robots.txt` already disallows the patron routes.

## Audit — other areas this touches (the "what else")

1. **🔴 Film-pass access without login — blocker.** `/my-passes` is auth-only; a patron holding a film pass has no login-free way to view or present it. Before selling passes, add a token-based pass view (mirror `/t/:token`) or deliver the pass QR by email. This overlaps the **hybrid-film-pass brief** — resolve there or here, but it must be resolved.
2. **Ticket access = the email link.** `/t/:token` is now the *only* way a patron reaches their tickets, so the confirmation email's "view your tickets" link must be prominent. It already carries `ticketUrl`; just make sure it reads as the primary CTA.
3. **Marketing opt-in / Mailchimp.** Two couplings break with signup: (a) the signup form's newsletter checkbox disappears; (b) `syncMailchimpProfile` in `Showing.tsx` fires **only for signed-in buyers** (`if (user)`), so with no patron logins it never runs from checkout. Move buyer tagging to the **server checkout** (using the buyer contact) or lean on the standalone `NewsletterSignup` footer form, so patrons still get tagged/opted-in. Audit + small rework.
4. **"Account created" language** everywhere: email builders (`tickets.ts`) and `GuestCheckoutForm` copy — reword (covered in §1, §3).
5. **Existing test/patron accounts.** Any accounts created during testing simply can't log in once the UI is gone; data stays intact. Pre-launch this is negligible; if any real patron already set a password, decide whether to notify (likely n/a).
6. **Supabase Auth email templates** (confirm-signup, magic link) become unused — no action needed, noted for completeness.
7. **`/dvds` (DVD Rentals)** sat in the account menu. Confirm whether it's a patron feature that needs login (then it's dormant too) or a public page — audit and place accordingly.
8. **RLS is already correct** — no policy changes. Just confirm no *other* UI silently assumes a patron `auth.uid()` read beyond the now-dormant pages.

## Reversibility (reactivating membership later)

Gate all of the above behind a single flag — client build-time `VITE_MEMBER_ACCOUNTS` and server `MEMBER_ACCOUNTS` (Supabase secret), default **off** — controlling: the signup tab, the account nav, the set-password email block, the post-purchase redirect target, and (manually) the Supabase self-signup toggle. Flipping it on restores the member experience with no code archaeology. Keep every code path intact.

## Test plan
- Signup tab/route gone; `/auth` is staff sign-in only; a direct `auth.signUp` from the console is refused by the project setting.
- Buy a ticket as a guest (no login): profile + tickets created server-side, QR email arrives **without** the set-password block, post-purchase lands on `/t/:token`, ticket scans at the door.
- Staff login still works; Dashboard / POS / Scanner reachable by role.
- No patron account links anywhere in nav; logged-out header shows "Get Tickets" and (demoted) staff login.
- Flip the flag on in a branch → signup, account nav, and the set-password email all return, to prove reversibility.

---

# Results — implemented August 13, 2026

**Status:** ✅ Live on staging and production behind `MEMBER_ACCOUNTS`, default off. Self-signup disabled on both projects. Guest checkout confirmed working afterwards.

Decisions taken: #1 footer staff link, #3 dormant routes left registered + unlinked, #4 flag. #2 dissolved on inspection — see below.

## What the code said that the brief did not

Four things came out of reading the code that changed the work. Each is written
up here because the reasoning is not recoverable from the diff.

### 1. The film-pass "blocker" was not one — no token pass view needed

The brief called `/my-passes` being auth-only a 🔴 blocker on selling passes.
It is not, because **a film pass is a physical card**, not a digital credential:

- `src/pages/FilmPasses.tsx` sells passes to guests already — name + email, no
  session anywhere in `handleBuy`, straight to `film-pass-checkout`.
- The post-payment screen deliberately says *where the pass will be*, not "here
  is your pass" — there is intentionally nothing to screenshot.
- `src/pages/MyPasses.tsx`'s own header comment: the pass "is a physical card
  now, bought at /film-passes or the box office, and spent by handing it to
  staff at the door. There is no button here because there is nothing a patron
  can do to a pass from a browser."

So a pass is bought without a login and redeemed without a login. The only thing
lost with `/my-passes` dormant is checking your remaining balance from a browser
— which that page already tells you to ask at the counter for. **No token-based
pass view was built, and none is needed.** Audit #1 can be closed rather than
folded into the hybrid-film-pass brief.

### 2. `/dvds` was a live dead end, not a dormant page (audit #7, answered)

`Dvds.tsx` `reserve()` requires `user` and pushes to `/auth?redirect=/dvds`, and
the catalogue is linked from the public header and the mobile drawer. Turning
off patron login would have left a "Sign in" button on a public page pointing at
a staff-only door that never opens for the person clicking it.

Resolved as **browse-only**: catalogue, search and filters stay public; the
reserve control becomes "Ask at the box office" (or "All copies out", since
availability still matters to someone deciding whether to walk down). `reserve`,
`cancel` and the active-rentals section are intact behind the flag.

### 3. `PublicTicket` had the most expensive dead end on the site

Not in the brief at all. `src/pages/PublicTicket.tsx` ended with a **"See all
your tickets"** button to `/my-tickets` — on the one page every patron reliably
reaches, because it is where the confirmation email lands. Gated behind the flag;
the "Bookmark this page — it opens your tickets without signing in" line above it
is the whole mechanism now.

### 4. §1's copy reword and audit #2 were already satisfied — deliberately not changed

- **The `accountJustCreated` reword was not made, on purpose.** Every "account"
  string in the email builders lives inside the `passwordBlock` / `passwordUrl`
  branch (`notify.ts:160–178`, `324–332`) — verified by grep. Nulling
  `passwordUrl` removes all of it. Rewording would only change what patrons see
  *when membership is switched back on*, where "we created an account for you"
  is correct and wanted. The builders also live in `notify.ts`, not `tickets.ts`
  as the brief says.
- **Audit #2 (prominent ticket CTA) needed no change.** `notify.ts:258` is
  already a full-width dark button, "View tickets on your phone", with the
  subtext "Keep this link — it opens your tickets without signing in."

## Marketing opt-in (audit #3) — resolved with consent, not inference

`syncMailchimpProfile` is structurally unable to serve a guest: it reads the
signed-in user's profile for `marketing_opt_in`, LTV and favourite genre, and
resolves interest-group IDs from `app_config.mailchimp_interests`, which is not
anonymously readable (only `hiring_enabled` is). With no patron logins its
`if (user)` guard is never true, so ticket buyers stopped reaching Mailchimp.

Replaced with an explicit **opt-in checkbox on `GuestCheckoutForm`** (ticked by
default, mirroring the old signup form), carried through `onPurchase` as
`newsletter`. When ticked, `Showing.tsx` fires a plain `subscribeToMailchimp`
with the typed address, tagged `ticket-buyer` plus the production type. Buying a
ticket never by itself means "yes".

Consent is recorded **in Mailchimp, not `profiles.marketing_opt_in`** — a guest
has no session to write a profile row with. This is not a new gap: the footer
`NewsletterSignup` form has always behaved exactly this way for anonymous
visitors. Recording it on the profile would need `ticket-checkout` to accept the
flag, and that function was explicitly out of scope.

## Verification

- `tsc -p tsconfig.app.json --noEmit` clean; `npm run build:staging` clean.
- `vitest`: 16 files / 121 tests pass, including a new case that a **cleared**
  opt-in survives to the purchase handler — an unticked box that silently
  reverted would turn a ticket sale into a list subscription. The existing
  `getByLabelText(/Email/i)` helper had to be tightened: the new opt-in is also
  labelled "Email me about…", so the loose regex matched two controls.
- `deno test _shared/`: 99 pass, including **"buildEmailHtml includes the
  set-password block only when there is a link"** — the assertion the whole
  server-side approach rests on, run rather than assumed. Needs
  `--node-modules-dir=auto`: `tickets_test.ts:106` imports `npm:pngjs@7.0.0`,
  which is not in `node_modules`. Pre-existing, unrelated to this work.
- New `_shared/flags_test.ts` pins **default-off**. An unset secret must not
  start mailing recovery links to every buyer, and that failure is invisible
  from the deploy side. `'1'` and `'yes'` read as off; only an explicit `true`.
- **Reversibility proven by build, not by claim.** Flag off: `Create Account` is
  absent from `dist/` entirely (tree-shaken). `VITE_MEMBER_ACCOUNTS=true`:
  `Create Account` returns to the Auth chunk and `My Tickets` to the index chunk
  (the nav). `dist/` was rebuilt flag-off afterwards so no flag-on bundle is
  left sitting there.

## Shipped — August 14, 2026

Both environments are live from `af105c3`; `origin/main` and `origin/staging`
are level at that commit and the working tree is clean.

| | Staging `rpqzrpboyhshdrfdwayk` | Production `vlmslygnimfbamrtwvyo` |
|---|---|---|
| Worker version | `db6bf62c` | `3c3dd77b` (rollback: `60621825`) |
| Entry chunk | `index-30RtCOnx.js` | `index-ekROYe7I.js` |
| Functions | ticket-checkout, send-ticket-confirmation, film-pass-checkout | same |
| Self-signup | `422 signup_disabled` | `422 signup_disabled` |

**The `createUser` bypass is confirmed in practice, not just on paper.** Tom ran
a guest checkout after self-signup was disabled on both projects and it worked.
That was the one claim in this brief that had only been established by reading
code, and the one with the worst failure mode — if the admin API had respected
the project toggle, ticket sales would have stopped, with the symptom appearing
at the customer's checkout rather than anywhere a deploy would show it. It does
not. Guest checkout keeps creating buyer profiles with self-signup off.

The two "must be done by hand" items below are **done**; the detail is kept
because it is the reference for reversing any of it.

## Reference — the Supabase side (corrected against the live API and this repo)

Project refs, confirmed in `docs/RUNBOOK-deploy-staging-prod.md` and both env
files: **staging `rpqzrpboyhshdrfdwayk`**, **prod `vlmslygnimfbamrtwvyo`**.
Note `supabase/config.toml` pins `project_id` to *prod*, and the CLI link moves —
pass `--project-ref` explicitly on every command rather than trusting the link.

### 1. Turn off self-signup on both projects — ✅ done via Authentication → Sign In / Providers

Dashboard: Authentication → Sign In / Providers → **Allow new users to sign up** → off.

It is also scriptable — a single-field PATCH, verified against the live
Management API OpenAPI spec (`PATCH /v1/projects/{ref}/config/auth` exists; the
field is **`disable_signup`**, not `enable_signup`):

```bash
for ref in rpqzrpboyhshdrfdwayk vlmslygnimfbamrtwvyo; do
  curl -s -X PATCH "https://api.supabase.com/v1/projects/$ref/config/auth" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
    -H "Content-Type: application/json" \
    -d '{"disable_signup": true}'
done
```

Safe either way: `buyers.ts` uses the **admin** `createUser` API, which bypasses
this setting, so guest checkout keeps creating buyer profiles.

> **Do not use `supabase config push` for this.** The CLI (2.113.0) does have it,
> and the config.toml key is `auth.enable_signup` — but this repo's config.toml
> has **no `[auth]` block at all**. Pushing it would send CLI *defaults* for
> every auth setting to the linked project, which can silently overwrite
> dashboard-configured SMTP, redirect allow-lists, JWT expiry and providers.
> One declarative-looking command, a much larger blast radius than the toggle.

### 2. Do not set `MEMBER_ACCOUNTS` as a secret

Absent reads as off, which is the intended state, and `flags_test.ts` pins it.

### 3. Redeploy — the function list, verified by grep — ✅ done on both projects

`_shared/deliver.ts` gained an import (`flags.ts`), so every function bundling it
drifts until redeployed. Actual importers:

| Function | Imports from `deliver.ts` | Redeploy |
|---|---|---|
| `ticket-checkout` | `deliverConfirmation` | **Required** — the changed path |
| `send-ticket-confirmation` | `deliverConfirmation` | **Required** — the changed path |
| `film-pass-checkout` | `sendTransactionalEmail` | For consistency; behaviour unchanged |

```bash
for ref in rpqzrpboyhshdrfdwayk vlmslygnimfbamrtwvyo; do
  for fn in ticket-checkout send-ticket-confirmation film-pass-checkout; do
    npx supabase functions deploy "$fn" --project-ref "$ref"
  done
done
```

Curl each after deploying — a BOOT_ERROR is invisible on a fire-and-forget
delivery path. Then rebuild and deploy the frontend per the runbook
(`build:staging` / `build:production`, verify the ref is baked into `dist/assets`
*before* `wrangler deploy`).

> **Correction.** An earlier version of this list said `guest-checkout` and
> omitted `film-pass-checkout`. `guest-checkout` does **not** import
> `deliver.ts`, and nothing in `src/` calls it — the frontend posts guest contact
> details to `ticket-checkout`. The error came from trusting a stale comment in
> `deliver.ts`'s own header ("guest-checkout calls it directly"), repeated in
> `send-ticket-confirmation/index.ts:3`. Both comments are wrong; `guest-checkout`
> looks like dead code and is worth a separate look.

## Not touched, as specified

`buyers.ts` (still `createUser` + profile, service-role, silently — confirmed at
`buyers.ts:96–122`), `ticket-checkout`, pricing, capacity/holds, all RLS,
`/t/:token`, QR delivery, and every staff/admin/superadmin/host path.
