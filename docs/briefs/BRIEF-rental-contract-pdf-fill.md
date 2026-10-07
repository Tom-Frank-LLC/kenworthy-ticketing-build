---
brief: rental-contract-pdf-fill
title: Rental contract PDFs render filled-in values cleanly, with no strikethrough and no displaced values
status: shipped
track: bug
date: 2026-10-07
shipped_in: ["#372"]
shipped_at: 2026-10-07
verified: true
findings: ../FINDINGS-contract-pdf-html2canvas.md
---

# Brief: fix garbled merge-field rendering in rental contract PDFs

**Requested by:** Tom. In generated rental contracts (example: the signed
*Indivisible / Moscow* contract), the date, name, email, $450.00,
"Indivisible Moscow" and "maximum of 268 attendees" all appeared with a line
through them, and some were pushed out of place.

## Brief as written

The PDF is a client-side html2canvas raster (`html2pdf.js`, `scale: 2`, jsPDF
letter). Every merge value is wrapped in `<Fill>`, which was styled
`bg-neutral-100 border-b border-neutral-500 px-1`. html2canvas mis-draws an
inline span with a background, bottom border and padding, especially one that
wraps. The proposed fix: restyle `Fill` as plain inline text (bold
recommended), with no server change. Already-signed contracts are stored PDFs
and are not fixed retroactively. Verify against the generated PDF, not the
screen.

## Correction found during the work

The strikethrough was not caused by `Fill`'s styling. Tailwind's
`img { display: block }` breaks html2canvas's baseline measurement, so **all**
text is drawn too low, and the border only made that visible. Fixed as well,
scoped to the export. See `docs/FINDINGS-contract-pdf-html2canvas.md`.

## Decision

Tom chose **bold, no underline** (2026-10-07).

## Added in the same PR (Tom, 2026-10-07)

- Page breaks fall between lines; headings are never left at the foot of a page.
- The patron's Download / Print buttons are no longer printed on their PDF.
- The Box Office Receipt PDF had the same low-text fault and now uses the same fix.
