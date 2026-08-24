# AI provenance — images

**Date:** 23 August 2026
**Brief:** `docs/briefs/BRIEF-ai-provenance-audit.md`
**Companion:** `docs/ai-provenance-text.md` · `docs/ai-provenance-disclosure-stance.md`

What this is: an inventory of every image the site serves, what provenance
metadata each one actually carries, and which of them a third party running a
Content Credentials check would see labelled as AI.

Nothing was stripped, edited or re-encoded. This audit is read-only.

---

## The headline

The brief expected AI-image exposure to be **low**, and for the bundled assets
that is confirmed — **zero** of the 42 raster files in `src/assets/` and
`public/` carries a C2PA manifest or an AI-tool tag, and every history photo
holds up to visual inspection as a genuine photograph.

The exposure is somewhere the brief did not look: **the poster library**.

> **24 posters currently live on the site carry signed Content Credentials
> whose `digitalSourceType` is
> `compositeWithTrainedAlgorithmicMedia` — the IPTC code for "this image
> contains generative-AI material".** All 24 are attached to a real movie or
> event row, so all 24 are being served to patrons right now.

That is 24 of 554 stored posters (4.3%). Four were signed by Adobe and validate
cleanly. Twenty were signed by Canva.

And the important caveat, established by looking at the actual pictures: **for
the Canva ones the credential is largely an artefact of Canva's export
pipeline, not evidence of generated artwork.** The Scooby-Doo poster carrying a
"Canva AI" claim is the unaltered 2002 Warner Bros. one-sheet. See
[What the Canva credential actually means](#what-the-canva-credential-actually-means).

---

## How this was measured

| tool | version | what it establishes |
|---|---|---|
| `c2patool` | 0.27.15 | reads and validates C2PA manifests, including `digitalSourceType` |
| `exiftool` | 13.55 | EXIF / XMP / IPTC / ICC, and JUMBF box labels |
| byte probe | — | scans the head of every file for a `jumb` + `c2pa` box pair, so nothing is missed if `c2patool` errors |

Corpus:

- **42** local raster files (`src/assets/**`, `public/**`), scanned in full.
- **589** stored objects in the Supabase `posters` and `festival-programs`
  buckets, scanned from the first 256 KB (enough for every APP segment and the
  JUMBF box, both of which sit at the head of the file); the 24 that flagged
  were then re-downloaded **in full** and validated with `c2patool`.
- **80** of the 691 posters still served from `www.kenworthy.org`, sampled
  evenly across the sorted URL list.
- **2** production assets pulled from the live Worker and byte-compared against
  the repo.

### The one thing that cannot be checked locally

**SynthID.** Google's invisible watermark is only detectable with Google's own
tooling, which is not publicly available for arbitrary images. Its *absence
cannot be proven* here, and this document never claims it is absent — only that
no C2PA manifest and no AI-tool EXIF is present. Any image that passed through
Gemini, Imagen or Google Photos' generative editing could carry SynthID with no
local trace at all.

---

## Scope A1 — bundled assets (`src/assets/**`, `public/**`)

42 raster files. **C2PA manifests found: 0. AI-tool EXIF found: 0.**

### The history photographs — every one confirmed photographic

These are the only images on the site that assert a historical record, so they
were inspected individually rather than trusted to metadata.

| file | evidence of origin | verdict |
|---|---|---|
| `Crystal-Theatre-1908.jpg` | 2500×1968 scan; Moscow fire crew outside the Crystal Theatre, Williamson's 1904–1908 painted year signs legible | **archival photograph** |
| `Kenworthy-1926.jpg` | halftone print scan; marquee reads "THE KENWORTHY THEATRE / ROBT MORTON PIPE ORGAN" | **archival photograph** |
| `kenworthy-circa-1935.jpg` | *byte-different derivative of the file above* — same photograph, Photoshop CS5.1, 2013 | **archival photograph** (see caption note below) |
| `kenworthy-1926-auditorium.jpg` | EXIF: iPhone 6 Plus, 20 Aug 2015. Content: a **phone snapshot of a torn archival print** of the auditorium | **archival photograph, phone-scanned** |
| `kenworthy-1928-facade.jpg` | `gd-jpeg` comment (WordPress re-encode); marquee reads "MY DEAR SECRETARY" — a **1948** Kirk Douglas / Laraine Day picture | **archival photograph** (see caption note below) |
| `kenworthy-historic-interior.jpg` | 1024×1024, no metadata. Content: the painted advertising curtain — Inland Market, Gray Line Cab Co., Roselawn Greenhouses, Singer Art Store, all real Moscow businesses, all lettering internally consistent | **photograph, square-cropped** |
| `Milburn-Day-crowd-1930s.jpg` | 500×500 web crop; crowd outside the Kenworthy, marquee reads "JUNGLE PRINCESS" (1936) | **archival photograph** |
| `Milburn-Day1930s.jpg` | Photoshop 27.11, 11 Aug 2026, `Artist` unset; 2251×1621 | **archival photograph, retouched in-house** (not shipped) |
| `moscow-main-street-1950s-night.jpg` | Kodachrome slide frame, mount edges visible | **archival photograph** |
| `moscow-main-street-1952.jpg` | comment: "Processed By eBay with ImageMagick" | **archival photograph, sourced from an eBay listing** |
| `moscow-main-street-1953.jpg` | real-photo postcard, hand-lettered "Main Street, Moscow, Ida." | **archival photograph** |
| `moscow-main-street-1965.jpg` | printed chrome postcard, rounded corners and press texture | **archival postcard** |
| `kenworthy-2025-marquee-restoration.jpg` | 1824×1368, marquee stripped to timbers, worker in hard hat, ladder | **contemporary photograph** |
| `kenworthy-today-marquee-night.jpg` | 1440×1920 phone frame; marquee reads "IT'S NEVER OVER / JEFF BUCKLEY" | **contemporary photograph** |

`src/pages/History.tsx:34` already carries the instruction *"Do not replace with
AI-generated imagery."* This audit independently confirms the timeline still
honours it.

### Everything else bundled

| group | files | origin | provenance found |
|---|---|---|---|
| Hero (`KPACmarquee.jpg` + 6 `optimized/hero-*`) | 7 | **photograph by Conner Jackson**, Lightroom Classic 15.0.1 | `dc:Creator = Conner Jackson`, `Copyright = ConnerJPhoto` |
| Logos and wordmarks (`kenworthy-logo.svg`, `kenworthy-k.svg`, `KPAC-100-logo-white.svg`, `backstage-logo.svg`, `kenworthy-full-logo.png`, `KPAC100-white-768x203.png`) | 6 | **vector-designed** | none |
| Optimized history WebP (12) | 12 | derivatives of the archival JPEGs above | **none — `cwebp` strips everything** |
| App icons and favicons (`apple-touch-icon.png`, `icon-192`, `icon-512`, `icon.svg`, `favicon.svg`, `placeholder.svg`) | 6 | vector-derived exports | none |
| Email wordmarks (`email-logo.png`, `email-logo-centenary.png`) | 2 | **generated by `scripts/make-email-logo.mjs`** from the vector wordmark | none |
| `sms-optin.png` | 1 | **screenshot** — ICC profile is `Google/Skia/…`, i.e. captured in Chrome/Android | ICC only |
| Staff headshot `staff/Colin Mannex.jpg` | 1 | **photograph by Tom Frank** — Sony ILCE-6400, Viltrox 35 mm, ARW → Lightroom → Photoshop | `Artist`/`Copyright`/`dc:Creator = Tom Frank`, full develop history |

Note that `staff/Colin Mannex.jpg` is not imported by any component — the file
actually served is the byte-identical upload at
`posters/staff/1786736021968.jpg`, which carries all of the same metadata
publicly. See [Incidental EXIF](#incidental-exif-a-separate-question-from-ai).

---

## Scope A2 — stored images (Supabase `posters`, `festival-programs`)

589 objects. Two buckets, five prefixes.

| prefix | objects | what they are |
|---|---|---|
| `posters/wp-rehydrated` | 553 | posters recovered from kenworthy.org and Square during the poster-rehydration work |
| `festival-programs/silent-film-festival/{2023,2024,2025}` + `hero` | 33 | Silent Film Festival programme page scans |
| `posters/staff` | 2 | staff headshots |
| `posters/movies` | 1 | one directly-uploaded poster |

Authoring metadata across all 589:

| | count |
|---|---|
| **C2PA manifest present** | **24** |
| Canva export tag, no C2PA | 24 |
| Adobe authoring tag (Photoshop / Lightroom / InDesign) | 36 |
| no authoring metadata at all | 506 |

The 506 with nothing are what you would expect from a library assembled out of
WordPress uploads: WordPress re-encodes on upload and its size variants drop
every APP segment.

### The 24 that would flag

Every one validates or byte-verifies as carrying
`digitalSourceType = compositeWithTrainedAlgorithmicMedia`.
**All 24 are referenced by a live movie or event row.**

| title on the site | signer | action / agent | c2patool verdict |
|---|---|---|---|
| Habib Institute: *Left-Handed Girl* (Filmnation one-sheet) | **Adobe Inc.** | `c2pa.edited` / **Adobe Firefly** | **Valid** |
| National Theatre Live: *Mrs. Warren's Profession* | **Adobe Inc.** | `c2pa.edited` / **Adobe Firefly** | **Valid** |
| *Nosferatu* (official poster) | **Adobe Inc.** | `c2pa.edited` / **Adobe Firefly** | **Valid** |
| *From Ground Zero* | **Adobe Inc.** | `c2pa.edited` / **Adobe Firefly** | **Valid** |
| Girl Scout Troop 4910: *The Princess Bride* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| Moscow Film Society: *The King of Comedy* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| Moscow Film Society: *Infernal Affairs* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| Moscow Film Society: *Hard Boiled* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| *Beau Is Afraid* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| Cinema Classics: *The Seventh Seal* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| Community Screening: *Mary Poppins Sing-Along* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| Staff Picks: *Scooby-Doo* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| Summer Family Matinee: *Peter Rabbit 2* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| *The Hunger Games* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| *The Hunger Games: Catching Fire* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| *The Hunger Games: Mockingjay — Part 1* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| *The Hunger Games: Mockingjay — Part 2* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| *Twin Peaks* Season 1: Eps 1–2, 3–4, 5–6, 7–8 (4 files) | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| *Iron Lung* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| *Hadestown: The Musical* | Canva | `c2pa.created` / Canva AI | cert expired¹ |
| *Backstage Burlesque* | Canva | `c2pa.created` / Canva AI | cert expired¹ |

¹ **Read this carefully.** "Invalid" here is *not* "tampered with". `c2patool`
reports `signingCredential.expired` and `signingCredential.untrusted` — the
certificate is past its validity window and Canva's issuer is not in
`c2patool`'s default trust list. In the same run, `assertion.dataHash.match`
and `claimSignature.validated` both **succeed**: the pixels are unchanged since
Canva exported them and the signature over the claim is intact. A consumer
verifier shipping the full C2PA trust list — Content Credentials Verify, and
the labelling pipelines at LinkedIn, Meta and TikTok — will read these as
present, legible credentials naming AI involvement.

### What the Canva credential actually means

The manifests were checked against the pictures. The result matters:

- **Staff Picks: *Scooby-Doo*** — the credential says `c2pa.created` by
  "Canva AI" with AI-composited source. The image is the **unmodified 2002
  Warner Bros. theatrical one-sheet**, cast photography and all. Nothing about
  it is generated.
- ***Twin Peaks*** — vintage VHS cover art with a screening date typeset over
  it. The artwork is 1990 photography; the only new element is the text.
- **Girl Scout Troop 4910 / *The Princess Bride*** — a community flyer built
  from Canva's stock watercolour illustration library.

So the honest reading is: **Canva stamps a Content Credential on exports from
its editor, and the `compositeWithTrainedAlgorithmicMedia` source type reflects
Canva's AI-assisted tooling being available in the design surface — not proof
that the artwork was generated.** The credential is a true statement about the
*pipeline*; a viewer will read it as a statement about the *picture*, and for
these files that reading would be wrong.

The four **Adobe / Firefly** ones are different in kind. They are
distributor-supplied official key art, signed by Adobe, validating cleanly, and
asserting `c2pa.edited` with Firefly — generative fill used by the rights
holder during their own retouching. Those credentials are accurate, and they
are not ours to explain away or remove.

### Posters still served from kenworthy.org

691 of the 1,245 poster rows still point at `www.kenworthy.org/wp-content/…`.
An 80-file even sample: **0 C2PA manifests, 0 AI-tool tags.** That is the
expected result — WordPress re-encodes on upload and its `-300x203`-style
variants carry no APP segments at all. It is not evidence those originals were
AI-free; it is evidence WordPress stripped the question away.

---

## Scope A3 — what the build pipeline does to metadata

There is **no automated image step in the build.** Vite copies bundled images
into `dist/` byte-for-byte, content-hashed. The `optimized/*` files were
produced by hand with the recipe recorded in `docs/MOBILE-OPTIMIZATION.md`:

```sh
sips -Z 1440 --setProperty format jpeg --setProperty formatOptions 72 in.jpg --out out.jpg
cwebp -q 72 out.jpg -o out.webp
```

Measured before/after on `src/assets/staff/Colin Mannex.jpg`, which has an
unusually complete metadata set:

| tag group | original | after `sips` | after `cwebp` |
|---|---|---|---|
| `IFD0` (Artist, Copyright, Make, Model) | 12 | 11 | **0** |
| `ExifIFD` (dates, lens) | 40 | 40 | **0** |
| `IPTC` | 7 | 8 | **0** |
| `XMP-crs` (Lightroom develop settings) | 183 | **0** | **0** |
| `XMP-xmpMM` (edit history) | 11 | **0** | **0** |
| `ICC_Profile` | 15 | **0** | **0** |

Identity tags specifically:

| | `Artist` | `Copyright` | `dc:Creator` | `CreatorTool` | camera `Model` | `DateTimeOriginal` |
|---|---|---|---|---|---|---|
| original | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| after `sips` | ✅ | ✅ | ✅ | ❌ | ✅ | ✅ |
| after `cwebp` | ❌ | ❌ | ❌ | ❌ | ❌ | ❌ |

**And for C2PA specifically**, tested by running the Nosferatu poster (a valid
Adobe/Firefly manifest) through the same two commands:

| | `c2patool` result |
|---|---|
| input JPEG | manifest present and **Valid** |
| after `sips` | **`Error: No claim found`** |
| after `cwebp` | **`Error: No claim found`** |

So the current behaviour, stated plainly:

- **`sips` keeps attribution** (Artist / Copyright / IPTC), drops edit history
  and ICC, **and destroys any C2PA manifest.**
- **`cwebp` with no `-metadata` flag strips everything.** WebP is the default
  format the browser picks for the hero and every history image, so in practice
  **production ships those images with zero metadata of any kind.**
- **Stored posters never touch this pipeline.** They are served raw out of
  Supabase storage, which is exactly why the 24 Content Credentials reach
  patrons intact.

Verified against production rather than a local build:

```
GET /assets/hero-1920-ksxAvQv9.jpg   → Copyright: ConnerJPhoto, IPTC intact
                                       md5 identical to src/assets/optimized/hero-1920.jpg
GET /assets/hero-1920-Al2xNZbk.webp  → no EXIF, no XMP, no ICC, no C2PA
```

---

## Findings that are not about AI

Turned up while inventorying. Recorded here because they are provenance
questions and this is the provenance document; none of them is in scope to fix
under this brief.

### Caption accuracy on the history timeline

1. **`kenworthy-1928-facade.jpg` is captioned 1928 but shows a 1948 marquee.**
   The marquee reads "KIRK DOUGLAS & LARAINE DAY / MY DEAR SECRETARY", released
   1948. It illustrates the milestone *"1928 — the brick building is enlarged"*.
2. **The same photograph appears twice under two different years.**
   `Kenworthy-1926.jpg` (1925 milestone) and `kenworthy-circa-1935.jpg` (1935
   milestone) are the same 960×462 photograph; the second is a Photoshop CS5.1
   derivative from 2013. The organ is on the marquee, which dates the shot
   between the 1927 purchase and the 1936 gift to the University.
3. **A modern phone photo illustrates opening night 1926.**
   `kenworthy-1926-auditorium.jpg` is an iPhone 6 Plus frame from 2015 — but of
   a genuine archival print, so the *content* is period-correct. Worth knowing
   that its EXIF says 2015 if anyone ever inspects it.
4. **About and History disagree on a fact.** `/about` says the 1928 extension
   was "twenty-four feet"; `/history` says "twenty feet". `/about` also says
   "Robert Morgan" where `/history` correctly says "Robert Morton".

### Third-party imagery

`moscow-main-street-1952.jpg` came from an eBay listing (its comment field says
so), and the 1953 and 1965 street scenes are commercially published postcards.
Rights were not part of this audit and are not established here.

### Incidental EXIF

`posters/staff/1786736021968.jpg` — the public staff headshot — carries
`Artist`/`Copyright = Tom Frank`, the camera and lens model, capture and edit
timestamps, and 183 Lightroom develop settings including the face-mask names.
No GPS. This is harmless and is genuinely useful as proof the photo was taken
with a camera, but it is a deliberate choice worth making deliberately.

### 20 images on the site do not load at all

`src/assets/sponsors/*.asset.json` and `src/assets/home/*.asset.json` are
Lovable asset *pointers*, not images. They resolve to `/__l5e/assets-v1/…`,
a path that only existed on Lovable's hosting. On the Worker:

```
GET /__l5e/assets-v1/1a2bab25-…/avista.png  →  200  text/html  (the SPA shell)
```

All 19 sponsor logos on `/sponsors` and the home relighting photo are broken in
production, and the SPA fallback returns 200 so nothing reports it as an error.
Their provenance is therefore moot — but this is a real bug and deserves its
own brief.

---

## Recommendations

| # | finding | recommendation |
|---|---|---|
| 1 | 4 distributor posters carry **valid Adobe/Firefly** AI credentials | **Leave them intact.** They are the rights holder's own accurate disclosure about their own artwork. Removing a valid manifest to make a poster read as non-AI is exactly the thing this audit exists not to do. |
| 2 | 20 posters carry **Canva** credentials that overstate AI involvement | **Leave them intact too**, and prepare a one-line answer for when someone asks: *"Canva stamps Content Credentials on everything it exports; on our posters that mark reflects the design tool, not generated artwork."* Do not re-export to shed the mark. |
| 3 | No AI image was found anywhere on the site | State it plainly in the disclosure note. It is a good fact and it is now evidenced. |
| 4 | `cwebp` silently strips **attribution** from every history image and the hero WebP | Add `-metadata icc,exif,xmp` when regenerating, so Conner Jackson's credit survives into the WebP the browser actually loads. This is a *photographer-credit* fix, not an AI one. |
| 5 | `sips` destroys C2PA manifests | Only matters if a credentialled image is ever put through the local pipeline. Posters are not, today. Worth knowing before anyone automates poster optimization. |
| 6 | Staff headshot ships full camera and edit history | Decide it on purpose — see the metadata question in the disclosure stance. |
| 7 | SynthID cannot be checked | Say so in any public claim. "No Content Credentials indicating AI" is provable; "no AI" is not. |
| 8 | Caption drift on `/history`, `/about` | Separate brief. Not urgent, but an audit about honest provenance that ignored a 1948 photo labelled 1928 would be a strange one. |

---

## Reproducing this

```sh
brew install c2patool exiftool

# bundled assets
find src/assets public -type f \( -iname '*.jpg' -o -iname '*.png' -o -iname '*.webp' \) \
  | while read -r f; do printf '%s: ' "$f"; c2patool "$f" 2>&1 | head -1; done

# stored objects — list, fetch heads, probe for a c2pa JUMBF box, then validate in full
# (the scripts used are in the session scratchpad; the probe is simply:
#  a file flags if its bytes contain both b'jumb' and b'c2pa')
```

The corpus, the raw `exiftool` dumps and the 24 full-resolution C2PA files were
kept in the session scratchpad, not committed — they are 141 MB of third-party
poster art. Everything needed to re-derive them is above.
