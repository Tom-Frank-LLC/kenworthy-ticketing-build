# FINDINGS: rental contract PDFs struck through and misaligned (html2canvas)

October 7, 2026. Fix: `src/pages/RentalContract.tsx` (`Fill`, `withHtml2CanvasBaseline`).

## Symptom

Generated rental contracts (Draft PDF / Download PDF / sign) showed every filled-in
value with a line through it, and the longer values (agreement date, licensee,
contact, term) pushed to the right end of a grey box with the neighbouring words
missing. The on-screen page was correct. The PDF is a client-side html2canvas
raster (`html2pdf.js` → jsPDF), so only the raster was wrong.

## There were two defects, not one

The brief blamed `Fill`'s styling for both. Rendering each variant through the
real `html2pdf` path showed that was half right.

1. **All text is drawn several pixels too low, everywhere in the PDF.** html2canvas
   1.4.1 finds a font's baseline in `FontMetrics.parseMetrics` by putting a 1×1
   `<img style="vertical-align: baseline">` beside a text span *in the live
   document* and reading `img.offsetTop`. Tailwind's preflight sets
   `img { display: block }`, which drops that image onto its own line, so the
   measured baseline is a line too low and every glyph is painted below where
   the browser laid it out. `Fill`'s `border-b` stayed where it belonged, so the
   text slid down over it and it read as **strikethrough**. Underlines have the
   same problem: `text-decoration: underline` cut through descenders in the PDF.
2. **A background on a wrapped inline span covers the words around it.**
   html2canvas paints `bg-neutral-100` on a span that wraps across lines as one
   rectangle over the span's whole bounding box. That box sits on top of the
   text sharing those lines ("between", "(Licensee)", "Term is assessed"), and
   the span's first fragment shows up alone at the right edge of the box.

Fixing only (2), as the brief proposed, removes the boxes. But (1) still shifts
every line of the PDF, and any future border or underline would show it again.

## Fix

- `withHtml2CanvasBaseline()` appends `img { display: inline-block; }` to the
  live document for the duration of each export and removes it afterwards.
  Injecting the style into the clone through html2canvas's `onclone` option
  **does not work**: the metrics are measured against the original document.
  The contract body itself has no `<img>`, so its layout is unchanged.
- `Fill` is `font-semibold` and nothing else (Tom's choice, between bold,
  underline and bold + underline). Underline was ruled out because html2canvas
  ignores `text-underline-offset` and draws the line through descenders.

## How this was verified

- A scratch harness loads the built app CSS and the same `html2pdf.bundle.min.js`
  with the export options from `RentalContract.tsx`, swaps the `Fill` styling per
  variant, and rasterizes each generated PDF with `pdftoppm` to look at it.
- The real page: `npm run dev -- --mode staging`, headless Chrome
  (`puppeteer-core`, installed outside the repo), opened `/contract/<invite_token>`
  for a staging rental and clicked **Download PDF**. Before the fix it showed the
  bug exactly as in production. After the fix, all 7 pages are clean, including
  the cost table and the signature rules, and the injected style is gone from
  the page afterwards.
- `pdf-lib@1.17.1` (the version `sign-contract` imports) loads the new PDF and
  appends a verification page (7 → 8 pages). `sign-contract` itself is unchanged.
  It treats the PDF as opaque bytes.

## Not covered

- Contracts already signed are stored PDFs and still look broken. To get a clean
  copy (for example the Indivisible / Moscow contract), regenerate it and have it
  re-signed.
- html2pdf cuts pages at fixed heights with no `pagebreak` setting, so a heading
  can be sliced across two pages ("2. TERM" on the staging sample). That
  predates this fix and is untouched.
