# FINDINGS — AI provenance

**Brief:** `docs/briefs/BRIEF-ai-provenance-audit.md` · **Measured:** 23–26 Aug 2026

What an audit of every image and every public page established. The long
working documents were removed; this is what is worth keeping.

Tools: `c2patool` 0.27.15, `exiftool` 13.55. Corpus: 42 bundled rasters, 589
stored objects, an 80-file sample of the posters still served from
kenworthy.org, and two assets pulled from the live site.

---

## 1. No AI-generated image is on the site

Zero of the 42 raster files in `src/assets/` and `public/` carries a C2PA
manifest or an AI-tool EXIF tag. Every history photograph was inspected by eye,
not just by metadata, and all are genuine: a Kodachrome slide, two commercially
published postcards, a phone snapshot of a torn archival print, the painted
advertising curtain with real Moscow businesses on it.

**Caveat that must accompany any public claim:** SynthID is only detectable with
Google's own tooling. Its absence cannot be proven locally. "No Content
Credentials indicating AI" is provable; "no AI" is not.

## 2. But 24 live posters carry Content Credentials that name AI

Of 554 stored posters, 24 carry a signed C2PA manifest whose `digitalSourceType`
is `compositeWithTrainedAlgorithmicMedia` — the IPTC code for "contains
generative-AI material". All 24 are attached to a real movie or event row.

- **4 signed by Adobe Inc.**, `c2pa.edited` / **Adobe Firefly**, validating
  cleanly: Nosferatu, NT Live *Mrs. Warren's Profession*, the Filmnation
  one-sheet, *From Ground Zero*. Distributor key art, retouched with generative
  fill by the rights holder. The credentials are accurate.
- **20 signed by Canva**, `c2pa.created` / "Canva AI". **These overstate AI
  involvement.** Checked against the pictures: one is the unaltered 2002 Warner
  Bros. *Scooby-Doo* one-sheet; another is 1990 *Twin Peaks* VHS art with a date
  typeset over it. Canva stamps the credential on exports from its editor.

`c2patool` reports the Canva ones "Invalid". That means
`signingCredential.expired` / `untrusted`, not tampering — `assertion.dataHash.match`
succeeds, so the pixels are unchanged. Read the per-code `validation_status`,
never the one-word verdict.

**Recommendation: leave every one of them intact.** Stripping a credential to
change what a verifier reports is the thing this audit exists not to do.

## 3. The optimize recipe destroys provenance

No automated image step exists in the build; Vite copies bundled images
byte-for-byte. The hand-run recipe in `docs/MOBILE-OPTIMIZATION.md` is
`sips -Z 1440` then `cwebp -q 72`. Measured:

| | EXIF/IPTC | XMP | ICC | C2PA |
|---|---|---|---|---|
| after `sips` | kept | mostly dropped | dropped | **destroyed** |
| after `cwebp` | **gone** | **gone** | **gone** | **gone** |

WebP is what the browser picks for the hero and every history image, so
production serves those with no metadata at all — **Conner Jackson's photo
credit is stripped from the file patrons actually load.** The JPEG fallback
keeps it.

**Actionable:** add `-metadata icc,exif,xmp` to `cwebp` when regenerating.
Never run a credentialled image through `sips`. Stored posters bypass this
pipeline entirely, which is why their credentials reach patrons intact.

## 4. Site copy is mostly KPAC's own writing

Git blame attributes 476 lines of `History.tsx` to the Lovable bot, but Lovable
**transcribed** that copy from the hand-written "A Brief History" on
kenworthy.org rather than composing it — 19 of 26 milestone descriptions map
one-to-one onto that source, tense-shifted and lightly condensed. `/about` is a
closer port still. Only 8 items have no source counterpart, all photo captions.

Blame attributes the commit, not the composition.

Two AI detectors were run. Both returned 0% AI on site copy; a control paragraph
in generic assistant register returned 100%, flagged for "overly formal tone"
and "generic language". **These tools read register, not authorship**, and no
score here is evidence of who wrote anything. There is no removable watermark in
pasted copy.

**Recommendation: no code action on text.** Do not edit copy to move a detector
score.

---

## Still open

- **A disclosure stance has not been chosen.** The options were: a short
  site-wide "how this site was made" note (recommended) versus none, and
  per-asset labelling versus none. Per-asset labelling fails on its own terms —
  20 of the 24 would be labelled wrongly.
- **The 1928 milestone shows a 1948 marquee.** `kenworthy-1928-facade.jpg`
  reads "KIRK DOUGLAS & LARAINE DAY / MY DEAR SECRETARY", released 1948, and
  illustrates *"1928 — the brick building is enlarged"*. A move to 1949 was
  prepared and set aside: the photo shows the brick front the 1949 remodel
  *replaced*, so it needs a caption saying so. Editorial call.
- **kenworthy.org contradicts itself**, and this site faithfully reproduces both
  sides: its About page says the 1928 extension was "twenty-four feet" and calls
  the organ a "Robert **Morgan**"; its History page says "twenty feet" and
  "Robert **Morton**". Someone who knows the building should settle it.
- **The public staff headshot ships full provenance** — camera, lens,
  timestamps, 183 Lightroom develop settings. No GPS. Harmless, and good
  evidence the photo was taken with a camera, but worth deciding on purpose
  before there are twenty of them.
- **No AI-crawler directives in `robots.txt`** (`GPTBot`, `ClaudeBot`, `CCBot`,
  `Google-Extended`). A training-use question, deliberately out of scope here.
- **Rights on third-party archival images** were not examined. One came from an
  eBay listing; two are commercially published postcards.

## Corrected along the way

Recorded so the errors are not re-derived as facts:

- The `/history` copy is **not** AI-drafted (see §4). An earlier draft claimed it
  was, from blame alone.
- A claim that 19 sponsor logos were broken in production was **wrong** — the
  grid had already been removed, and the audit ran in a checkout 81 commits
  behind `origin/main`. A claim about the deployed site cannot be established
  from a working tree.
- The duplicate 1926/1935 photograph was fixed in **#211**, which placed it at
  1927 by reading the organ on the marquee — better than this audit proposed.
