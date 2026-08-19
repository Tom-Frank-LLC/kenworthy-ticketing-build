---
brief: privacy-page-footer
title: Add the Privacy Policy + Terms of Use pages + footer links
status: shipped
track: ux
date: 2026-08-15
shipped_in: ["#82", "2c70348"]
verified: true
---

# Brief (for Claude Code): Add the Privacy Policy + Terms of Use pages + footer links

**Status:** ✅ Shipped — `2c70348` (PR #82); `/privacy` and `/terms` are live routes.
**Date:** August 15, 2026
**Requested by:** Tom — publish the privacy policy at `/privacy` and the terms of use at `/terms`, and link both from the site footer. Content is the approved `privacy-policy.md` and `terms-of-use.md` (in the project).

## Current state (verified, file:line)
- **No `/privacy` or `/terms` route/page exists** (`App.tsx` has neither). Other content pages are lazy-loaded (`App.tsx:50–57`); real ones (e.g. About) are full components, stubs come from `ComingSoon`.
- **The footer has no legal-links area** (`src/components/Layout.tsx:199–222`): four columns (logo/tagline, contact, `NewsletterSignup`, "Performing Arts Centre / © {year} The Kenworthy"). There's no Privacy/Terms link anywhere today.

## Changes
1. **Create two pages** — `src/pages/Privacy.tsx` and `src/pages/Terms.tsx` — as real components (not `ComingSoon` stubs) rendering the approved text from `privacy-policy.md` and `terms-of-use.md`. Use the site's content-page layout/typography (mirror the built `About.tsx`: a `container` section with the display/serif type styles) and each includes the `SEO` component (`title="Privacy Policy"` / `title="Terms of Use"`, short descriptions). Render the **"Last updated: August 15, 2026"** date near the top of each. Readable prose with existing heading styles — no new design system.
   - The two documents **cross-link** each other (Privacy → Terms and Terms → `/privacy`); make sure those in-page links resolve to the real routes.
2. **Add the routes** in `App.tsx`: `<Route path="/privacy" element={<Privacy />} />` and `<Route path="/terms" element={<Terms />} />` (lazy imports alongside the other pages).
3. **Add the footer links** in `Layout.tsx` — a small legal row/line with **"Privacy Policy"** and **"Terms of Use"** links, near the copyright (`Layout.tsx:214–218`). Style like the muted footer text (e.g. `Privacy Policy · Terms of Use` under `© {year} The Kenworthy`).
4. **Sitemap / robots:** add `/privacy` and `/terms` to `public/sitemap.xml` (public, indexable); confirm `robots.txt` doesn't disallow them.
5. **Content maintenance:** copy lives inline in each component (no CMS needed). When a document is revised, bump its "Last updated" date.

## Notes
- **Legal review:** both documents are accurate drafts but haven't been through counsel, and the Terms contain several **[confirm]** policy choices (refunds, resale, house rules, tax status, governing-law/venue). Decision for Tom: publish now and update after review, or hold the links until reviewed. (Recommended: publish — accurate is better than nothing, and both are trivially updatable — but resolve the Terms `[confirm]` items first, since a refund policy is a commitment.)
- No data model, auth, or API changes — static content pages + links only.

## Test plan
- `/privacy` and `/terms` each render the full document with correct typography and the "Last updated" date; deep-linking and hard refresh both work (SPA fallback).
- The footer shows working "Privacy Policy" and "Terms of Use" links on desktop and mobile; the cross-links between the two documents work.
- Both paths appear in `sitemap.xml`; neither is blocked by `robots.txt`.
- `npm run build` passes.
