# Findings — where the QuickBooks integration actually is

**Status:** 🟡 In progress by intent. Measured 2026-08-19 against `main`, both
Supabase projects, and the deployed function list. Nothing here was inferred
from a commit message.

The short version: **the OAuth half is real and finished, the accounting half
does not exist, and one code path reports a success that never happened.** It is
currently harmless because the function is deployed nowhere and no credentials
exist — but that is the only thing making it harmless.

## What exists

| piece | state |
|---|---|
| `supabase/functions/qbo-sync/index.ts` | 396 lines, 6 actions |
| OAuth: `oauth_start`, `oauth_callback`, `refresh`, `disconnect` | **complete and real** — they call Intuit's token endpoint |
| `status` | reads `qbo_connection`, returns connection state |
| `payroll_export` | writes a `payroll_exports` row — **and nothing else** |
| Tables | `qbo_connection`, `payroll_exports`, `chart_of_accounts`, `account_mappings` and friends, from the June 2026 migrations |
| UI | `Chart of Accounts`, `Mappings`, `QBO Export` tabs (`AdminDashboard.tsx:942–955`) plus `PayrollExport` under Labor |

## What does not exist

**No call is ever made to the QuickBooks Accounting API.** The whole function
contains exactly two outbound `fetch`es, both to
`oauth.platform.intuit.com` for token exchange and refresh. There is no request
to `/v3/company/...` anywhere — nothing is read from QuickBooks and nothing is
written to it.

So the integration can authenticate to QuickBooks and can do nothing with the
connection once it has one.

## The part that needs fixing before anything is deployed

`payroll_export` checks for an active `qbo_connection` row, and if it finds one:

```
status:       'success'
qbo_batch_id: `sandbox-${Date.now()}`
message:      `Pushed ${lines.length} timecards to QuickBooks (${env}).`
```

No push happens. The batch id is a synthesised string, not an identifier
QuickBooks issued. Anyone reading the payroll export screen — a bookkeeper, most
likely — is told timecards reached QuickBooks when they did not.

Today this cannot fire: the row it looks for can only be created by an OAuth
callback, and the function is not deployed. The moment someone connects
QuickBooks, it fires on the first export.

## Current risk: none live, and specifically why

- `qbo-sync` returns **404 on both projects** — verified by HTTP, not by the
  function list alone.
- **No `QBO_CLIENT_ID` or `QBO_CLIENT_SECRET` on either project.** The secret
  digests were compared across both; there are no QBO secrets at all.
- `QBO_ENVIRONMENT` defaults to `sandbox` in code, so a missing value cannot
  silently mean production.
- Without credentials the OAuth flow cannot start, so no `qbo_connection` row
  can exist, so the false-success path is unreachable.

The user-visible symptom today is small: `loadStatus()` swallows the 404
(`if (!error && data)`), so the QBO Export tab renders as "not connected" rather
than showing an error. Pressing **Connect** does surface a toast. Nothing is
silently wrong in the accounting data, because nothing is being written.

## Where it could get to, with the risk mitigated at each step

The mitigation that matters is that **QuickBooks has a real sandbox** — a
separate company file with its own credentials. That puts it in the Square
category, not the Mailchimp/LGL category where staging shares production's key
and a test writes a real record. Every step below can be exercised for free
against a sandbox company.

**Step 0 — stop the function claiming a push it did not make.** Independent of
everything else, and worth doing even if the integration stalls here. Report
`staged`, drop the synthetic `qbo_batch_id`, and say plainly that no push is
implemented yet. This is a small change to one branch.

**Step 1 — deploy to staging only, with sandbox credentials.** Set
`QBO_CLIENT_ID` / `QBO_CLIENT_SECRET` from an Intuit sandbox app on
`rpqzrpboyhshdrfdwayk` and deploy `qbo-sync` there and nowhere else. Leave
production 404ing; a function that is not deployed cannot be called by accident.

**Step 2 — prove the token works, read-only.** Add one action that fetches
something harmless from `/v3/company/<realm>/companyinfo/<realm>` and shows it
in the UI. This is the first evidence that the OAuth half actually produces a
usable token, which nothing has yet demonstrated end to end. Read-only, so the
worst case is an error message.

**Step 3 — implement the real push, sandbox only.** Write `TimeActivity`
records for one short pay period against the sandbox company, then check them in
the QuickBooks UI. A 2xx is not proof — the Square work on this project
established that the hard way, and the same rule applies here.

**Step 4 — production, deliberately.** Only after a sandbox push has been seen
in QuickBooks. Needs its own production Intuit app, `QBO_ENVIRONMENT=production`
set explicitly, and a decision about who is allowed to press the button.
Accounting writes want the same "prove it landed" discipline as the Square
catalog work, because a wrong push here is visible to an accountant and awkward
to unwind.

## Guardrails to keep while it is in progress

- **Do not deploy `qbo-sync` to production** until step 4. Its absence is the
  strongest guarantee available and costs nothing.
- Keep `QBO_ENVIRONMENT` defaulting to `sandbox`.
- Never let a code path report success for a call that was not made. That is the
  defect this document exists to record.
- The three accounting tabs and the Labor payroll export are reachable in the
  admin UI today and call a 404. If that is confusing to staff before step 1
  lands, gate the tabs rather than deploying the function to quieten them.
