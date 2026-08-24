---
id: UX-team-contact-card-headshot-proportion
title: "Team contact cards: make the headshot (upper) region the slightly taller of the two halves, so the photo reads as larger than the text block rather than the text dominating"
track: UX
severity: low
status: queued
related:
  - UX-team-page-card-layout
  - brand-guidelines
supersedes: []
# Small proportion tweak. Locate the exact 'team contact card' first (admin TeamMemberCard vs
# member-facing event-team contact card), then bias the upper/lower split toward the photo.
# Frontend-only, no schema. Baseline: tsc --noEmit -p tsconfig.app.json = 30 (0 new).
# NOTE: verify field names against docs/briefs/.frontmatter-schema.md before `bun run catalogue`.
---

# Team contact card — headshot as the slightly larger half

## Summary

On the team contact cards, the **headshot (upper) region should be the slightly taller of the
card's two halves** — right now the text block (lower) takes up more room than the photo, which
makes the card feel text-heavy. Bias the split toward the photo so the headshot reads as the
dominant element, without crowding out the metadata.

## Phase 1 — locate the exact card (there are two candidates)

1. **Confirm which "team contact card" Tom means:**
   - **Admin** `/team` grid card — `src/components/team/TeamMemberCard.tsx` (photo top region
     `aspect-[16/9]` when `headshot_url` present, else `h-28` placeholder; body = name / title /
     role badge / email / added date; Eye/Mail/Trash cluster).
   - **Member-facing** event-team contacts — `src/pages/event-frontend/EventFrontendContact.tsx`
     (`ContactCard`, fed by `event_team_directory`).
   Determine which surface Tom is looking at; if both use the same visual card, apply the change
   to both for consistency (confirm they don't diverge).
2. **Measure the current split.** The admin card's `aspect-[16/9]` photo is fairly short/wide, so
   the body can exceed it — that's the "text takes more space" effect. Confirm the actual
   rendered heights to size the change.
3. Real typecheck `tsc --noEmit -p tsconfig.app.json` (baseline 30, 0 new).

## Design

- **Make the photo region taller than the text block** — target roughly a **55/45–60/40** split
  favoring the photo (STOP-1). For the admin card, that means a taller photo aspect (e.g.
  `aspect-[16/9]` → `aspect-[4/3]` or a fixed min-height) so it clears the metadata body; keep
  the `h-28`-style placeholder proportional so a photoless card doesn't collapse.
- Keep the metadata legible — don't shrink text; just let the photo take the larger share. The
  card's overall footprint can grow slightly; the point is the *ratio*, photo > text.
- Apply consistently across grid columns and both light/dark; keep the existing click-photo →
  preview / hover affordances intact.

## STOP gates

- **STOP-1 (ratio).** ~55/45 (subtle) vs ~60/40 (clearly photo-forward) upper:lower. Recommend
  ~57/43 — noticeably photo-dominant but the metadata still sits comfortably. Confirm on staging.
- **STOP-2 (scope).** Admin `TeamMemberCard` only, or also the member-facing event-team
  `ContactCard` if it's a separate component (recommend: whichever Tom is looking at, plus the
  other if they share the pattern — keep them consistent).

## Acceptance criteria

- On the team contact card(s), the headshot region is visibly the **taller half**; the text block
  no longer dominates.
- Metadata stays legible (no text shrink); the photoless placeholder stays proportional.
- Consistent across grid, light/dark, and both card surfaces if they share the pattern; existing
  preview/hover/action affordances unchanged.
- `tsc --noEmit -p tsconfig.app.json` 0 new (baseline 30); `bun run build` clean; frontend-only.

## Verification plan

- Staging: the team card shows the headshot as the larger half; check with a real photo and with
  the placeholder; grid alignment holds; light/dark + mobile clean.
- Tom's staging pass — "does the photo now read as the bigger half?"

## Open decisions for Tom

1. **STOP-1:** exact upper:lower ratio (~57/43 recommended).
2. **STOP-2:** which card surface(s) — admin, member-facing, or both.
