# AI disclosure stance — options for sign-off

**Date:** 23 August 2026
**Brief:** `docs/briefs/BRIEF-ai-provenance-audit.md`
**Evidence:** `docs/ai-provenance-images.md` · `docs/ai-provenance-text.md`

Nothing here has been implemented. Four decisions, each with a recommendation
and the reason for it. Say yes, no, or something else, and the work follows.

---

## What the audit established, in five lines

1. **No AI-generated image was found on the site.** 42 bundled assets, 0 C2PA
   manifests, 0 AI-tool tags; every history photograph confirmed photographic by
   eye.
2. **24 live posters carry signed Content Credentials naming AI.** 4 are
   distributor key art edited with Adobe Firefly (valid, accurate). 20 are Canva
   exports whose "Canva AI" mark reflects Canva's export pipeline, not generated
   artwork — one of them is the unaltered 2002 *Scooby-Doo* one-sheet.
3. **The build strips metadata.** `cwebp` removes everything, including the
   photographer's credit on the hero. `sips` destroys C2PA manifests. Posters
   bypass both and reach patrons with their credentials intact.
4. **Essentially all site copy is AI-assisted**, and no detector can tell —
   two returned 0% AI on copy the git history proves was machine-drafted.
5. **SynthID cannot be checked locally.** "No Content Credentials indicating AI"
   is provable. "No AI" is not, and should never be claimed.

---

## Decision 1 — Publish an AI-use note?

**Recommendation: yes, one short site-wide note. No per-asset labels.**

Per-asset labelling fails on its own terms here. The only images that would
carry a label are 24 posters, 20 of which would be labelled *wrongly* — a
"contains AI" badge under the 2002 Scooby-Doo poster is a false statement
dressed as transparency. Labelling the 4 Firefly ones alone would silently
assert the other 550 were checked and cleared, which is more than the evidence
supports.

A single honest note covers all of it, costs one page, and does not have to be
re-litigated per upload.

Draft, for `/about` or a `/credits` route — edit freely, this is a starting
point:

> **How this site was made**
>
> This website was built with AI assistance, and much of its writing was drafted
> that way and then edited by staff. The photographs are not AI. The historic
> images are archival photographs, postcards and scans from the Kenworthy's own
> collection and from kenworthy.org; the marquee photograph is by Conner Jackson;
> staff portraits are photographed.
>
> Film and event posters come to us from distributors, community partners and our
> own designers. Some carry Content Credentials — embedded provenance data — and a
> few of those note that generative AI tools were used somewhere in their making,
> usually in a design app. We leave that information in the files rather than
> removing it. If you want to check any image yourself, you can, at
> [contentcredentials.org/verify](https://contentcredentials.org/verify).

The last sentence is the part that does real work: it hands the reader the tool
instead of asking them to take our word.

**Alternative if you'd rather not:** publish nothing. Defensible — no AI image
was found, so there is no undisclosed AI imagery to disclose. The cost is that
the 24 credentials are discoverable by anyone with a verifier, and being second
to mention them is worse than being first.

---

## Decision 2 — What to do about the flagged posters?

**Recommendation: keep them, keep the credentials, replace nothing.**

The brief's rule was: *where an image implies authenticity, prefer replacing an
AI image over hiding its origin.* A movie poster implies nothing about
authenticity — it is promotional art, and everyone knows it. Nothing on this
site presents an AI-touched image as a photographic or historical record. The
history timeline, which is the one place that claim is made, is clean.

So:

- **The 4 Adobe/Firefly posters** are the rights holder's own key art with the
  rights holder's own accurate disclosure attached. Stripping that to make them
  read as non-AI would be the exact deception this audit exists to avoid.
- **The 20 Canva posters** keep their credentials too. Re-exporting them to shed
  a mark that overstates AI involvement would still be shedding a mark to change
  what a detector says. If someone asks, the answer is the one-liner in the note
  above.

**Worth doing instead, if you want to reduce the count honestly:** several of
these are our own or Moscow Film Society's designs. If a future poster is built
in a tool that does not blanket-stamp, the count goes down on its own merits.
No back-catalogue work required.

---

## Decision 3 — Metadata policy

**Recommendation: preserve provenance, and fix the credit the build is currently
eating.**

| what | today | recommendation |
|---|---|---|
| C2PA on stored posters | preserved (they bypass the pipeline) | **keep preserving** — it is the transparency feature working |
| Photographer credit on WebP | **stripped by `cwebp`** | **fix** — add `-metadata icc,exif,xmp` to the recipe in `docs/MOBILE-OPTIMIZATION.md` so Conner Jackson's credit survives into the file browsers actually load |
| C2PA through `sips` | destroyed | document it; matters only if poster optimization is ever automated |
| Camera / edit history on the public staff headshot | published in full | **your call** — see below |

On the headshot: `posters/staff/1786736021968.jpg` publishes the camera body,
the lens, capture and edit timestamps, and 183 Lightroom develop settings
including face-mask names. No GPS. It is harmless, and it is genuinely good
evidence the photo was taken with a camera. Two coherent positions:

- **Keep it** (recommended) — consistent with "we preserve provenance", and a
  full EXIF chain from a Sony body through Lightroom is the strongest possible
  answer to "is this person AI-generated?"
- **Trim to attribution** — keep `Artist`, `Copyright`, `dc:Creator`; drop the
  develop settings and timestamps. Reasonable if headshots start covering
  people who did not consent to that detail being public. Worth deciding
  *before* there are twenty of them rather than after.

Either way: **decide it, write it down, and never do it to change what a
detector reports.** That is the line.

---

## Decision 4 — Text

**Recommendation: no code action.**

There is no watermark in the copy to find or remove. Both detectors already read
the site's copy as human-written, including the parts that demonstrably are not.
Editing to move a score would mean optimising against a tool that was measured
failing in both directions on the same afternoon.

Two small things worth doing for their own sake, unrelated to AI:

- `/about` says the 1928 extension was "twenty-four feet"; `/history` says
  "twenty". One of them is wrong.
- `/about` says "Robert **Morgan** theatre pipe organ". It is a Robert
  **Morton**, as `/history` has it.

---

## Not decided here

Turned up during the audit, listed so they are not silently absorbed:

- **20 images on `/sponsors` and the home page do not load in production.**
  They are Lovable `.asset.json` pointers to `/__l5e/assets-v1/…`, a path that
  only existed on Lovable's hosting; the SPA fallback returns `200 text/html`,
  so nothing reports an error. Needs its own brief.
- **Caption drift on `/history`** — a 1948 marquee illustrating 1928, the same
  photograph used for both 1925 and 1935, a 2015 phone frame (of a genuine
  archival print) illustrating opening night 1926. Details in
  `docs/ai-provenance-images.md`.
- **No AI-crawler directives in `robots.txt`** (`GPTBot`, `ClaudeBot`, `CCBot`,
  `Google-Extended`). That is a question about training use, not provenance, and
  it was out of scope.
- **Rights on third-party archival images** — one came from an eBay listing,
  two are commercially published postcards. Not examined.
