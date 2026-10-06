---
brief: sec-client-hygiene
title: Sign-in redirect stays on the site, sign-out clears the device, email preheaders are escaped, stored URLs are http(s) only
status: shipped
track: security
date: 2026-10-06
verified: true
findings: ../AUDIT-security-2026-10-06.md
shipped_in: ["#359", "de88e39"]
shipped_at: 2026-10-06
evidence: "migration 20261006230005 on both (0 violators, all constraints validated); 7 functions on both; Worker prod fe2e750b (rollback a87c782f)"
---

# Client-side security hygiene: M5, L12, M8, L13

Four findings from the 2026-10-06 audit. Each one let an outside value reach
somewhere it could act: a URL in the query string reached `navigate()`, a
public form's name reached email markup, and a host-written URL reached an
`href` or an iframe `src`. The fourth, L12, is a sign-out that left the
session on the device.

## M5: open redirect after staff sign-in

**What it was.** `Auth.tsx` passed `?redirect=` straight to `navigate()`. In
react-router 6.30.1, `//evil.example` and `/\evil.example` resolve to a
cross-origin URL. `pushState` refuses that URL, and the router's catch block
then calls `window.location.assign(url)`. So a staff member who followed
`/auth?redirect=//evil.example` signed in on the real site and was then sent
to the attacker's page.

**What changed.**
- New `safeRedirectPath()` in `src/lib/safeUrl.ts`. It accepts only a value
  that:
  - starts with one `/` that is not followed by `/` or `\`;
  - contains no backslash and no control character anywhere (browsers delete
    tab and newline characters before parsing, so `/\t/evil` *becomes* `//evil`);
  - still has this origin after URL parsing.
- It returns the parsed path and checks it again, because parsing collapses
  `..`: `/..//evil.example` turns into `//evil.example`.
- Anything else becomes `/`. `Auth.tsx` uses this function.
- I searched for every other place a query or state value reaches
  `navigate`/`location` (`redirect`, `next`, `returnTo`, `location.state`,
  `location.href =`, `assign`/`replace`). `Auth.tsx` is the only one. Every
  `/auth?redirect=` link is built from the current `location`.
- react-router itself is not bumped here. The supply-chain wave owns
  `package.json`.

**How it was proven.** `src/lib/safeUrl.test.tsx` runs the installed router
inside a real `BrowserRouter`. The harness adds the same-origin `pushState`
check that a real browser makes, which jsdom does not. It records everything
that is pushed or assigned.
- A control test, pinned to react-router 6.30.1, shows that unguarded `//evil`
  and `/\evil` leave the site. It is pinned so that a router upgrade does not
  turn it red.
- Seven hostile inputs, passed through the guard, stay on `/`.
- A real redirect (`/admin?tab=movies`) still arrives where it was going.

## L12: sign-out on a flaky connection left the session stored

**What it was.** `supabase.auth.signOut()` (auth-js 2.96.0) returns the
`/logout` error before it removes the stored session. The header logged that
error and went to `/auth` anyway. The screen looked signed out, but the token
was still stored for the next person at a shared box-office or scanner device.

**The audit's remedy does not work as written.** In 2.96.0,
`signOut({ scope: 'local' })` also calls `/logout` first, and it bails out on
the same network error in the same way. This was confirmed by trace and is
pinned by a control test.

**What changed.**
- New `src/lib/signOutDevice.ts` handles the failure case in three steps:
  1. Try the normal sign-out.
  2. If that fails, remove the stored session ourselves, using the client's own
     `storage` and `storageKey`.
  3. Call `signOut({ scope: 'local' })`. It now finds no session, so it makes
     no request, clears the `-user` and `-code-verifier` keys, and emits
     `SIGNED_OUT`.
- `signOutDevice` throws only when the session is still stored.
- `AuthProvider.signOut` uses it.
- `Layout` and `MobileNav` now go to `/auth` only after `signOut` resolves. If
  it rejects, they stay put and show a toast (`SIGN_OUT_FAILED`). This is the
  only new copy, and it uses the existing sonner toast.
- When only the device was cleared, the session on the server stays valid until
  it expires, but nobody holds the token. That case is logged to the console;
  staff see nothing.

**How it was proven.** `src/lib/signOutDevice.test.ts` runs the real
supabase-js client with only `fetch` replaced.
- Control: plain `signOut()` and `signOut({scope:'local'})` both leave the
  session stored when the network is offline.
- With `signOutDevice`, both offline and a 503 clear every `sb-` key and emit
  `SIGNED_OUT`. `getSession()` then returns null, and only one request is made.
- If storage refuses to forget the session, `signOutDevice` throws.
- `src/components/signOut.test.tsx` checks the menu: it goes to `/auth` only
  when sign-out resolves. When sign-out rejects, it stays and shows the toast.

## M8: rental-form name injected unescaped into the staff email

**What it was.** `buildRentalRequestNotification` put
`applicant_name (organization_name)` into `preheader` raw, and `emailLayout`
inserted the preheader into `<body>` unescaped. Every other template escaped
it at the call site.

**What changed.**
- `emailLayout` now escapes `preheader` itself. The option's docs say to pass
  plain text.
- Every caller that used to escape at the call site now passes plain text,
  because escaping in both places would show `&amp;` in the inbox. Those
  callers are:
  - `auth-email.ts`
  - `donations.ts` (receipt and tribute)
  - `notify.ts`
  - `pass_orders.ts` (two)
- The rental notification needed no change beyond a comment.

**How it was proven.** `supabase/functions/_shared/email_preheader_test.ts`:
- The audit's exact payload, rendered through the real template, comes out
  inert.
- An `&` in the organisation name is escaped once.
- Every other preheader-bearing template is fed `O'Brien & <Sons>`. Each
  preheader contains `O&#39;Brien &amp; &lt;Sons&gt;` and nothing
  double-escaped.
- Auth emails are checked for every action.
- Against the old code, the two layout and rental tests fail and the rest pass.
- The existing email tests (`email_brand_test`, `donations_test`,
  `staff_notifications_test` and others) still pass.

## L13: stored URLs reached `href` and iframe `src` with no scheme check

**What it was.** Both admins and hosts write `rsvp_url` and `trailer_url`.
Hosts are outside organisers, and the host UPDATE policies cover every column.
These values were rendered as:
- `<a href>` on the showing page and in the production drawer;
- for any trailer the parser did not recognise, the raw value in an iframe
  `src`, on page load.

The enforcing CSP was the only thing stopping them.

**What changed, at render time.**
- **The helper.** `src/lib/safeUrl.ts` now holds `safeHttpUrl`, which accepts
  http(s) only and turns a bare host into https. The function was moved
  unchanged from `press.ts`, which re-exports it, so the Press page and the
  Press tab keep their import.
- **rsvp links.** `Showing.tsx` (the `rsvp_url` href, plus its import) and
  `ProductionDetailDrawer.tsx` both pass `rsvp_url` through `safeHttpUrl`. An
  unsafe value renders the button with no `href`.
- **Trailers.**
  - `resolveTrailer` (`src/lib/trailer.ts`) builds YouTube and Vimeo embeds
    from a parsed id, so the input string never reaches the `src`.
  - The direct-file branch, the only one that passes the input through, now
    requires http(s), because `javascript:x.mp4` also ends in `.mp4`.
  - It now also recognises `youtube-nocookie.com/embed/…`. That was the only
    form the old fallback could ever show, because CSP `frame-src` admits only
    YouTube and Vimeo.
- **No raw-URL fallback.** `ProductionMedia` and `TrailerModal` no longer fall
  back to the raw `trailer_url`. An unrecognised value means "no trailer": the
  poster shows, and there is no "Watch trailer" button.
  - Every trailer the anon key can see on staging (789: 773 YouTube, 16 Vimeo,
    all https) still resolves.
- `Press.tsx` already went through `safeHttpUrl`, so it is unchanged.

**What changed, in the database.**
- Migration `20261006230005_url_column_checks.sql` adds CHECK constraints
  modelled on `featured_slides_link_shape`:

  | Column(s) | Rule |
  |---|---|
  | `rsvp_url` on movies, events and live_performances | `^https://[^\s]+$`, the same rule the admin forms already apply |
  | `trailer_url` on movies, events, live_performances and festival_years | https, ignoring surrounding whitespace (the forms save it untrimmed) |
  | `press_articles.url` | http or https (old outlets' `http://` links are kept) |

- The constraints are added `NOT VALID`. Each one is then validated in a
  `DO` block, and any whose existing rows violate it stays `NOT VALID` with a
  `WARNING` instead of failing the push.

**How it was proven.**
- `src/lib/safeUrl.test.tsx` checks the scheme filter.
- `src/lib/trailer.test.ts` (four new cases) checks the parser.
- `src/components/trailerEmbed.test.tsx` checks the rendered output for hostile
  URLs: no iframe or video, and no trigger.
- The migration was tested in a throwaway postgres:15 container
  (`scratchpad/secclient/`):
  - **Clean replay** of all 149 migrations: the new one is `rc=0` and all 8
    constraints are `convalidated = t`. The one replay error is the
    pre-existing data-anchored `20260812180000`.
  - **Dirty fixture**, with a legacy scheme-less trailer and a `javascript:`
    press link: those two constraints stay `NOT VALID` with a WARNING, and the
    other six validate.
  - **Role-switched writes as a host** (`authenticated` with `is_host_of`):
    `javascript:` trailer, `data:` rsvp and tab-smuggled `\tjavascript:` are all
    refused with a check violation. An ordinary https trailer with a trailing
    space is accepted (`UPDATE 1`), so RLS and the normal path still work.
  - **As `service_role`:** an https rsvp is accepted and an http rsvp refused.
    A press `http://` link is accepted and a `javascript:` link refused. NULL is
    always accepted.
  - After the bad rows were fixed, `VALIDATE` succeeds.
- **Caveat the harness found:** a `NOT VALID` constraint also refuses any
  UPDATE of a row that already violates it, whatever column the update
  touches. A title edit on the legacy row failed. That is why step 1 below
  comes first.

## Not fixed here (other owners)

- **`src/components/home/TrailerFeed.tsx:304`.** The home page marquee renders
  `href={item.rsvpUrl}` raw. It needs the same one-line
  `safeHttpUrl(item.rsvpUrl) ?? undefined`. Its trailer `src` is already
  covered by the `resolveTrailer` change.
- **`src/pages/admin/ShowingForm.tsx:1342`.** The admin preview link renders
  `href={selectedItem.rsvp_url}` raw. This is staff-only and needs the same
  one-line guard.
- **Trailer form validation.** `MovieForm`, `EventForm`, `HostDashboard` and
  `FestivalProgramsTab` have no client-side check on the trailer field. A
  non-https trailer now fails the save with Postgres's constraint message.
  Suggest a `trailerUrlError` alongside `rsvpUrlError`.
- **`qbo-sync` `return_to`.** It is admin-supplied, carried in signed state, and
  concatenated as `${origin}${r}`. Only the admin who starts the OAuth flow can
  set it, so it is not an attacker path. It could still be held to
  `safeRedirectPath`'s rule as defence in depth.
- **react-router bump** (supply-chain wave). After the bump, the version-pinned
  control in `safeUrl.test.tsx` skips itself, and the guarded cases keep
  running.

## Deploy steps

Nothing here has been deployed or pushed to a database.

1. **Count violators, read-only, on each project, before `db push`.** Run this
   on staging first, then production:

   ```sql
   SELECT 'movies.rsvp_url' AS col, id::text, title, rsvp_url AS value FROM public.movies WHERE rsvp_url IS NOT NULL AND rsvp_url !~ '^https://[^\s]+$'
   UNION ALL SELECT 'movies.trailer_url', id::text, title, trailer_url FROM public.movies WHERE trailer_url IS NOT NULL AND btrim(trailer_url, E' \t\r\n') !~ '^https://[^\s]+$'
   UNION ALL SELECT 'events.rsvp_url', id::text, title, rsvp_url FROM public.events WHERE rsvp_url IS NOT NULL AND rsvp_url !~ '^https://[^\s]+$'
   UNION ALL SELECT 'events.trailer_url', id::text, title, trailer_url FROM public.events WHERE trailer_url IS NOT NULL AND btrim(trailer_url, E' \t\r\n') !~ '^https://[^\s]+$'
   UNION ALL SELECT 'live_performances.rsvp_url', id::text, title, rsvp_url FROM public.live_performances WHERE rsvp_url IS NOT NULL AND rsvp_url !~ '^https://[^\s]+$'
   UNION ALL SELECT 'live_performances.trailer_url', id::text, title, trailer_url FROM public.live_performances WHERE trailer_url IS NOT NULL AND btrim(trailer_url, E' \t\r\n') !~ '^https://[^\s]+$'
   UNION ALL SELECT 'festival_years.trailer_url', year::text, NULL, trailer_url FROM public.festival_years WHERE trailer_url IS NOT NULL AND btrim(trailer_url, E' \t\r\n') !~ '^https://[^\s]+$'
   UNION ALL SELECT 'press_articles.url', id::text, title, url FROM public.press_articles WHERE url !~ '^https?://[^\s]+$'
   ORDER BY 1, 2;
   ```

   **Zero rows:** go on. **Any rows:** fix them first, or decide to. Most will
   be a missing `https://`. A row left violating makes *every* later update of
   that row fail, Square-sync writes included, until it is fixed.

2. **Migration:** `supabase db push` on staging, then production. Confirm it
   applied and validated (expect 8 rows, all `t`):

   ```sql
   SELECT conname, convalidated FROM pg_constraint WHERE conname ~ '_(rsvp_url|trailer_url)_https$|press_articles_url_http' ORDER BY 1;
   ```

3. **Edge functions.** These import the changed `_shared` email files:

   ```bash
   supabase functions deploy film-pass-checkout lgl-sync-donation rental-request send-auth-email send-ticket-confirmation square-donation ticket-checkout
   ```

   Run it on staging first, then production. Deploying these functions does not
   call LGL or Resend.

4. **Worker.** The front-end changes need the usual sequence:
   - `npx wrangler deployments list` (record the rollback ID);
   - prod-vs-main check;
   - `npm run build:production`;
   - `npx wrangler deploy`.

   To confirm the bundle carries the guard, grep `dist/assets` for
   `same-origin.invalid`.

5. **Post-deploy checks (safe):**
   - **Redirect.** On staging, open
     `/auth?redirect=%2F%2Fexample.com` and sign in with a staff test account.
     You should land on `/`. Then open `/auth?redirect=%2Fadmin`; you should
     land on `/admin`.
   - **Sign-out.** On staging, sign in, set DevTools to Offline, and sign out.
     You should land on `/auth`, and no `sb-*-auth-token` key should remain in
     localStorage.
   - **Trailers.** Open a showing page with a trailer: the embed shows. Then
     run the step 2 query on each project.

## Rollback

- **Worker:** `npx wrangler rollback <recorded version id>`.
- **Functions:** redeploy the seven functions from the previous `main`.
- **Migration:** drop the constraints. Nothing else changed in the database.

  ```sql
  ALTER TABLE public.movies DROP CONSTRAINT movies_rsvp_url_https, DROP CONSTRAINT movies_trailer_url_https;
  ALTER TABLE public.events DROP CONSTRAINT events_rsvp_url_https, DROP CONSTRAINT events_trailer_url_https;
  ALTER TABLE public.live_performances DROP CONSTRAINT live_performances_rsvp_url_https, DROP CONSTRAINT live_performances_trailer_url_https;
  ALTER TABLE public.festival_years DROP CONSTRAINT festival_years_trailer_url_https;
  ALTER TABLE public.press_articles DROP CONSTRAINT press_articles_url_http;
  ```
