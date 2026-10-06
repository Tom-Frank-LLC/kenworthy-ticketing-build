---
brief: security-audit-2026-10-06
title: End-to-end security audit, second pass — every finding located, ranked and routed to a follow-up
status: built
track: security
severity: P0
date: 2026-10-06
shipped_in: ["#356"]
verified: true
evidence: docs/AUDIT-security-2026-10-06.md delivered; C1 fixed (#356) and the six follow-up clusters (#358–#363) shipped to both projects on 2026-10-06; see the report's Remediation status table
findings: ../AUDIT-security-2026-10-06.md
---

# Brief (for Claude Code): End-to-end security audit of the platform

**Status:** 🟡 Audit delivered: `docs/AUDIT-security-2026-10-06.md`.
- **Result:** 1 Critical, 2 High, 11 Medium, 19 Low.
- **Critical:** C1 (`source_id: "CASH"`) was fixed in #356 at Tom's direction
  once it was confirmed live, and deployed to staging and production on
  2026-10-06.
- **High and Medium:** these become follow-up briefs once Tom triages, grouped
  as in the report's *Remediation roadmap*.
- **Done means:** this brief moves to `shipped` when the production Square
  check for prior use of C1 has been run.

**Date:** October 6, 2026
**Requested by:** Tom — run an end-to-end security audit of the platform.

## Decisions taken
1. **Scope:**
   - Code, config and RLS review.
   - Staging-only dynamic checks with the anon key.
   - No live-production attack testing. The one production touch was a
     read-only function-source download to confirm production runs `main`.
2. **Depth:** the full end-to-end pass at once, as six parallel domain reviews.
3. **Fixes:** findings only, except C1. It was a live Critical, and Tom chose a
   hotfix PR mid-audit.

## What was asked (summary of the original brief)
- **Ground rules:** review the whole platform and produce a prioritized
  findings report, not fixes. Ground every finding in `file:line` with a
  concrete exploit scenario, and mark each Confirmed or Plausible. Report
  nothing unverified, and include no secrets or real PII.
- **Domains:**
  1. Authorization and RLS, including a service-role auth matrix.
  2. Authentication and sessions.
  3. Edge-function hardening, `verify_jwt` and CORS.
  4. Payments and financial integrity: pricing, reconciliation, refunds,
     idempotency, webhook authenticity.
  5. Secrets and configuration.
  6. Public endpoints: rate limiting, Turnstile, token guessability.
  7. Data exposure, PII and storage.
  8. Client-side XSS.
  9. Dependencies and supply chain.
  10. Infrastructure and headers.
  11. Audit logging and monitoring.
- **Deliverable:**
  - Executive summary.
  - Severity-ranked findings, each with ID, severity, status, location,
    description, exploit, remediation and effort.
  - Quick wins.
  - Remediation roadmap.
  - What was checked and found clean.
