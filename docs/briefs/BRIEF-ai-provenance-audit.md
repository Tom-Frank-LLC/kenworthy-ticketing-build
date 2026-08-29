---
brief: ai-provenance-audit
title: Inventory what on the site would be flagged as AI-generated, and decide how to disclose it
status: shipped
track: docs
severity: P2
date: 2026-08-18
verified: true
shipped_in: ["#247"]
shipped_at: 2026-08-29
findings: ../FINDINGS-ai-provenance.md
evidence: docs/FINDINGS-ai-provenance.md
---

# Brief (for Claude Code): Audit what on the site could be flagged as AI-generated

**Status:** ✅ Assessment delivered. The inventory and the disclosure recommendation are in `docs/FINDINGS-ai-provenance.md`. The four decisions it puts to Tom are still open, and no content was changed.
**Date:** August 18, 2026
**Requested by:** Tom — now that AI provenance markers (watermarks, Content Credentials) are being embedded widely, assess what on the site might get flagged as AI-generated, including AI-generated text.

**Outcome:** ran 23–26 Aug 2026. Findings are in `docs/FINDINGS-ai-provenance.md`. The two deliverable files named under Scope A and Scope B below were written, then removed in favour of that single shorter note; the ask is left as written.

## Framing (read first)
The goal is **awareness and honest handling**, not concealment. AI provenance signals — Google's **SynthID** (invisible image/text watermark), **C2PA / Content Credentials** (signed metadata) — exist to make origin transparent. So this audit **inventories** what would flag and recommends a **disclosure stance**; it does **not** strip provenance to make AI content pass as human. Removing a watermark or C2PA manifest to deceive a detector is out of scope and not something to do. Cleaning *incidental* metadata (privacy EXIF) or deciding *how to disclose* is in scope.

## What actually flags, and how reliable it is (calibrate the audit)
- **Images — real and checkable.** AI generators increasingly embed **C2PA manifests** (readable/verifiable with `c2patool` / Content Credentials Verify) and/or **SynthID** (invisible, only detectable via Google's own tooling — so its *absence* can't be proven locally). These are the concrete, detectable signals.
- **Text — mostly unreliable.** Statistical "AI detectors" (GPTZero, etc.) are **probabilistic and produce false positives**, especially on plain, well-structured copy — a human-written page can be flagged, and vice versa. Model-side **text watermarks** (e.g. SynthID-Text) are model-specific and generally **do not survive** copy-paste into source code, so they're unlikely to be present in site copy. So for text the real exposure is **detector false-positives**, not a hidden mark — the audit should say so plainly rather than imply a reliable "AI text" verdict exists.

## Scope A — Images (the concrete part)
1. **Inventory every raster asset**: `src/assets/**` and `public/**` (~40 files — hero, history photos, logos, favicons) **plus** stored/user images (Square posters, staff-bio photos, and the festival-program / backstage galleries once those ship).
2. **Classify origin** per image: photographed / scanned-archival / vector-designed / **AI-generated**. Known context to fold in: the **history photos are archival**, the **posters were restored from kenworthy.org and Square's own orphaned images** (not AI — `poster-identify`'s vision model was used only to *match*, and the recovery note says it went unused), and logos/marquee art are vector. So AI-image exposure is expected to be **low** — confirm it.
3. **Read provenance metadata** on each served image with `c2patool` (and note EXIF `Software`/`Creator` tags that name an AI tool). Record: has a C2PA manifest? names an AI generator? any AI-tool EXIF? (SynthID can't be checked locally — note that limitation, don't assert its absence.)
4. **Check the build pipeline**: does the image optimization step (the `optimized/*.webp` conversion) **preserve or strip** metadata? That determines whether any provenance travels to production at all.
5. **Deliverable:** `docs/ai-provenance-images.md` — asset → origin → provenance found → would-it-flag → recommendation.

## Scope B — Text (calibrated, honest)
1. **Identify AI-drafted copy**: page/section text likely produced with AI assistance (much of the site copy, plus any bios/descriptions). Note the site's Lovable/AI-assisted origin.
2. **Run 1–2 detectors on representative pages** *only to show what a third party would see* — and report results **with the false-positive caveat front and center**. Do not treat a detector score as ground truth.
3. **Deliverable:** `docs/ai-provenance-text.md` — which content is AI-assisted, what a detector reports, and the honest conclusion (detectors are unreliable; there is no removable "watermark" in pasted copy).

## Recommendation to produce (not execute yet)
A one-page **disclosure stance** for Tom to choose from, consistent with honesty:
- **Transparency options:** a brief "How this site was made / AI use" note (on `/about` or `/accessibility`/credits); per-asset credit where an image is AI-generated; keeping Content Credentials **intact** as a transparency feature rather than removing them.
- **Where provenance genuinely matters** (e.g. a photo presented as a real historical/photographic record), prefer **replacing** any AI image with an owned/photographed/licensed asset over hiding its origin.
- **Metadata policy:** decide, intentionally, whether the build preserves Content Credentials (transparency) or strips incidental EXIF (privacy) — documented, and never to deceive.

## Decisions for Tom
1. **Disclosure stance:** publish a short AI-use note (recommended) vs none; per-asset labeling vs a single site-wide note.
2. **AI images, if any are found:** replace with owned/licensed assets where the image implies authenticity (recommended) vs label and keep.
3. **Metadata handling:** preserve Content Credentials for transparency (recommended) vs strip incidental EXIF for privacy — and confirm the build's current behavior either way.
4. **Text:** accept that detectors are unreliable and take no code action (recommended), optionally lightly human-edit key public copy for voice — but **not** to "beat a detector."

## Test plan (acceptance = an accurate inventory, not a passed detector)
- Every served image is listed with its origin classification and the provenance metadata actually found (C2PA/EXIF), plus the noted SynthID limitation.
- The build pipeline's metadata behavior (preserve vs strip) is documented from a real before/after of one asset.
- Any AI-generated image is identified with a recommendation; if none are found, that's stated with the evidence.
- The text section reports detector output **with** the false-positive caveat and does not claim a definitive AI/human verdict.
- A disclosure-stance recommendation exists for Tom to choose; **no provenance is stripped to deceive**.
