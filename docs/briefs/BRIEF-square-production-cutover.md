# Brief (for Claude Code): Square production cutover — audit + fix the sandbox-locked functions

**Status:** 🔴 Time-sensitive — production Square cutover planned for tomorrow
**Date:** August 13, 2026
**Requested by:** Tom — the Concessions "Pull from Square" button errored (`non-2xx`); fix it, and since we switch Square to **production tomorrow**, audit **every** Square interaction platform-wide for cutover readiness.

## How Square env resolution works here (the model to enforce)
The shared helper `supabase/functions/_shared/square.ts` is the correct pattern: `squareEnvironment()` returns `production` **only** when `SQUARE_ENV=production`, else **defaults to sandbox**. Credentials resolve by prefix — `SQUARE_PRODUCTION_*` / `SQUARE_SANDBOX_*` — each **falling back to an unprefixed** `SQUARE_*`. The **frontend follows the server**: `src/lib/square.ts` loads the sandbox vs production Square.js bundle based on the environment reported by an edge function's `get_config` — deliberately *not* a separate `VITE_SQUARE_ENV` flag ("two switches for one decision can disagree… the failure mode is a live card entered into a sandbox form"). So a clean cutover is mostly: **fix the two offenders + set production secrets + `SQUARE_ENV=production`.**

## Audit — every Square touchpoint and its status

| Touchpoint | Env resolution | Cutover status |
|---|---|---|
| `_shared/square.ts` | `SQUARE_ENV` + prefixed creds, unprefixed fallback | ✅ correct — the source of truth |
| `square-donation` | shared config | ✅ ready |
| `square-refund` | shared config (`loadSquareConfig`) | ✅ ready |
| `square-terminal` | shared config | ✅ ready |
| `ticket-checkout` | shared config (+ `get_config`) | ✅ ready |
| `film-pass-checkout` | shared config (`loadSquareConfig`, `get_config`) | ✅ ready |
| **`square-catalog-sync`** | **hardcoded `squareupsandbox` URL; refuses non-sandbox; reads only `SQUARE_SANDBOX_ACCESS_TOKEN`** | 🔴 **breaks in prod** |
| **`square-labor`** | **hardcoded `squareupsandbox` URL; reads only `SQUARE_SANDBOX_ACCESS_TOKEN` / `_LOCATION_ID`** | 🔴 **breaks in prod** |
| Frontend `src/lib/square.ts` | loads SDK bundle per server `get_config` | ✅ auto-follows; no change |

## 1. Fix `square-catalog-sync` (this is the button that errored)
- **Why it errored:** it's hardcoded to sandbox and reads **only** `SQUARE_SANDBOX_ACCESS_TOKEN` (L56) — if that exact secret isn't set on the project, it 500s with "SQUARE_SANDBOX_ACCESS_TOKEN not configured"; the client shows the generic "non-2xx". (Confirm the real message in the Supabase function logs, but the fix stands regardless.)
- **Fix:** replace the hardcoded `SQUARE_SANDBOX_BASE`, the "Refusing non-sandbox Square URL" guard (L13/30/31), and the `SQUARE_SANDBOX_ACCESS_TOKEN` read (L56) with the shared `_shared/square.ts` (`loadSquareConfig` + `squareFetch`), exactly like `square-terminal`/`square-refund`. It then uses whatever `SQUARE_ENV` selects (sandbox now, production tomorrow) against the right base + token + location.
- **Surface the real error:** the client (`ConcessionItemsTab` "Pull from Square") should display the function's actual error text, not just "non-2xx" — return a clear `error` and show it in the toast, so config problems are legible next time.

## 2. Fix `square-labor`
- Same treatment: drop the hardcoded `squareupsandbox` base (L9) and the `SQUARE_SANDBOX_ACCESS_TOKEN` / `SQUARE_SANDBOX_LOCATION_ID` reads (L36–37); use `loadSquareConfig` + `squareFetch`. The labor roster must pull the **production** team once live.

## 3. Production secrets checklist (prod project `vlmslygnimfbamrtwvyo`)
Set before cutover:
- `SQUARE_ENV=production` — **required**; without it everything defaults to sandbox.
- `SQUARE_PRODUCTION_ACCESS_TOKEN`
- `SQUARE_PRODUCTION_APPLICATION_ID`
- `SQUARE_PRODUCTION_LOCATION_ID` (needed by terminal, labor, catalog)
- **⚠️ Unprefixed-fallback trap:** the shared config falls back to unprefixed `SQUARE_ACCESS_TOKEN` / `SQUARE_APPLICATION_ID` / `SQUARE_LOCATION_ID`. If those hold **sandbox** values on the prod project, a *missing* `SQUARE_PRODUCTION_*` secret silently uses sandbox creds **against the production base** → auth failures or, worse, a wrong-environment charge path. So: set all three `SQUARE_PRODUCTION_*` explicitly, and make sure no unprefixed *sandbox* values linger on prod. Verify with `npx supabase secrets list --project-ref vlmslygnimfbamrtwvyo`.
- Keep **staging** (`rpqzrpboyhshdrfdwayk`) on sandbox (`SQUARE_ENV` unset or `sandbox`) so testing never touches real cards.
- Confirm there are **no Square webhooks** relying on a sandbox signature key (none found in the functions list — verify before relying on it).

## 4. Operational (not code)
- **Physical Square Terminal:** re-pair the device to the **production** location + a new device code; the sandbox pairing won't work in production.
- **Square catalog & team** in production must actually contain the concession items / team members you expect (the sandbox ones don't carry over) — otherwise a successful pull returns an empty set.

## Go-live sequence (tomorrow)
1. Land fixes #1 + #2; deploy **all** Square functions to prod (redeploy so they pick up env): `supabase functions deploy <fn> --project-ref vlmslygnimfbamrtwvyo` for donation, refund, terminal, ticket-checkout, film-pass-checkout, square-catalog-sync, square-labor.
2. Set the production secrets + `SQUARE_ENV=production` (step 3 above).
3. Rebuild/redeploy the frontend (no code change needed, but confirm it's current).
4. Smoke test (below) with a **real card**, then refund it.

## Test plan (on production, post-cutover)
- Payment form: on a showing, the card form loads **`web.squarecdn.com`** (not `sandbox.web.squarecdn.com`) — check the Network tab; `get_config` returns the production `applicationId`/`locationId`.
- **Real charge:** buy 1 ticket with a real card → charged; then **refund** it via the POS (`square-refund`) → confirm refunded in the Square dashboard.
- **Donation:** a small real donation → charged + receipt.
- **Terminal:** a card sale on the paired production terminal → completes.
- **Concessions "Pull from Square":** returns the **production** catalog (no error); pushing an item creates it in the production catalog.
- **Labor roster:** shows production team members.
- Grep confirms nothing still targets `squareupsandbox` in the deployed functions.

## Acceptance
- No function contains a hardcoded `squareupsandbox` URL or a `SQUARE_SANDBOX_*`-only read; all Square calls go through `_shared/square.ts`.
- With `SQUARE_ENV=production` + prod secrets, every flow (online ticket, donation, terminal, refund, film-pass, catalog sync, labor) hits **production** Square; with it unset, everything stays sandbox.
- The Concessions sync surfaces real error text, not "non-2xx".
- `npm run build` passes.
