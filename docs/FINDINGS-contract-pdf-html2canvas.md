# FINDINGS: rental contract PDFs struck through and misaligned (html2canvas)

October 7, 2026. Fix: `src/lib/html2canvasBaseline.ts`, used by `src/pages/RentalContract.tsx`
and `src/components/admin/BoxOfficeReceiptsTab.tsx`; `Fill`, `PDF_OPTIONS`, `breakableCopy` in
`RentalContract.tsx`.

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

- `withHtml2CanvasBaseline()` (`src/lib/html2canvasBaseline.ts`) appends `img { display: inline-block; }` to the
  live document for the duration of each export and removes it afterwards.
  Injecting the style into the clone through html2canvas's `onclone` option
  **does not work**: the metrics are measured against the original document.
  The contract body itself has no `<img>`, so its layout is unchanged.
- `Fill` is `font-semibold` and nothing else (Tom's choice, between bold,
  underline and bold + underline). Underline was ruled out because html2canvas
  ignores `text-underline-offset` and draws the line through descenders.

## The same fault in the Box Office Receipt

`BoxOfficeReceiptsTab` makes its PDF with html2pdf under the same Tailwind
preflight. Rendered through the same call with the receipt's inline styles,
every table cell's text sat on the cell's bottom border, with descenders
clipped. It goes through `withHtml2CanvasBaseline()` too, and the text is now
centred in its cells. Every html2canvas export in this app should go through it.

## Page breaks

html2pdf cuts the canvas every page-height (10 in. at these margins) whatever is
there, so lines of text and headings were sliced in half across pages. Its
`pagebreak.avoid` option pushes a listed element that straddles a cut onto the
next page, but only whole elements:

- Avoiding `p` and `li` left pages 2, 3 and 5 nearly half empty, because long
  paragraphs moved whole. The contract grew from 7 pages to 9.
- So `breakableCopy()` hands html2pdf a detached copy of the contract with
  every word wrapped in a `.pdf-word` span, and `avoid` lists `.pdf-word`. The
  word that would straddle the cut is pushed down, and the rest of its line
  wraps after it, so the break falls between lines. The React DOM is untouched.
- Headings (`H2`, and the addendum titles) sit in a `.pdf-keep` box with
  `pb-[4.5em] -mb-[4.5em]`. The padding reserves about three lines below the
  heading inside the kept box, and the negative margin returns that space, so a
  heading cannot be stranded at the foot of a page and the layout is unchanged.
- The witness line with its signature block, and the addendum with its
  signatures, are kept whole when shorter than a page. The alcohol addendum is
  longer than a page, so html2pdf lets it break, and its words still break by line.
- The copy also drops `print:hidden` elements. The patron's own Download PDF /
  Print buttons sit inside `#contract-body` and had always been printed on the
  last page of the patron's download, showing "Exporting…".

Checked on three real staging contracts, including one with the alcohol
addendum (forced by rewriting the lookup response in the headless browser, with
no database write), by cropping every page boundary at 110 dpi. No line is cut,
and each page is full apart from the kept blocks.

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

- **Signed PDFs are not stored anywhere.** `sign-contract` stamps the PDF,
  records `signed_pdf_sha256`, the Ed25519 signature, signer and time on
  `rental_requests`, and returns the PDF to the browser to download. Only the
  downloaded file exists. Drafts are rendered fresh on every open, so they are
  fixed as soon as the code is deployed.
- **A contract that is already signed needs re-signing to get a clean copy, and
  that has a cost.** There is one signature per rental. Re-signing overwrites the
  hash, so the copy already sent to the renter will then show "tampered" at the
  `/verify/<id>` link printed on it. In production on 2026-10-07 only one
  contract was signed: Indivisible Moscow (signed 2026-10-06 by Jordan Goins).
- Signing sends nothing to anyone. The only writes are the `rental_requests`
  update and the audit log.
