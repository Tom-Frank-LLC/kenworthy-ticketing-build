# AI provenance — text

**Date:** 23 August 2026
**Brief:** `docs/briefs/BRIEF-ai-provenance-audit.md`
**Companion:** `docs/ai-provenance-images.md` · `docs/ai-provenance-disclosure-stance.md`

---

## The short version

**Essentially all of the site's copy is AI-assisted.** That is not a finding, it
is the project's history: the site was built on Lovable, and 244 of its 553
commits are authored by `gpt-engineer-app[bot]`. Most of the rest are Claude
Code sessions committed under a human name.

**No detectable watermark exists in any of it.** Model-side text watermarks such
as SynthID-Text are model-specific and do not survive being retyped into a JSX
literal. There is nothing embedded to find, and nothing that could be removed
even if removal were the goal.

**And the detectors do not detect it.** Two independent AI detectors were run on
genuinely AI-drafted site copy. Both returned **0% AI / human-written**. On a
control paragraph written in generic assistant register, one of the same
detectors returned **100% AI, high probability**.

So the exposure is not "our copy will be flagged as AI". It is the inverse of
what the brief anticipated, and more useful: **these tools detect register, not
authorship.** The site's copy is concrete and specific, so it reads human — and
would keep reading human even if it were entirely machine-written, which much
of it is.

---

## Where the copy came from

| source | evidence |
|---|---|
| Commits by `gpt-engineer-app[bot]` (Lovable) | 244 commits, 17 Jun – 9 Jul 2026 |
| Commits by `Tom Frank` / `mrtomfrank` | 308 commits — but a large share of these are Claude Code sessions committed under the human's name, so this number **overstates** hand-written copy |
| Commits by `Claude` | 1 |

Blame on the current public-facing pages:

| page | lines from the Lovable bot | lines from human-named commits |
|---|---|---|
| `src/pages/History.tsx` | 476 | 68 |
| `src/pages/Sponsors.tsx` | 158 | 2 |
| `src/pages/Index.tsx` | 129 | 118 |
| `src/pages/About.tsx` | 0 | 278 |
| `src/pages/Volunteer.tsx` | 0 | 129 |

Two distinct kinds of copy are on the site, and they behave differently:

**1. Institutional copy, transcribed rather than drafted.** The `/about` mission
statement, the "The Theatre" history paragraph and the four goals read as the
organisation's own existing boilerplate, carried over verbatim. The tell is a
transcription error: `/about` says the pipe organ was a **"Robert Morgan"**,
where `/history` correctly says **Robert Morton**. A model does not typically
introduce that error; a person retyping a printed page does. `/about` also says
the 1928 extension was "twenty-four feet" where `/history` says "twenty".

**2. Editorial copy, AI-drafted.** The `/history` timeline — 21 milestone
descriptions — is the clearest example. It is written in a deliberate voice
("dark intermissions, scaffolding, and standing ovations"; "rain on the asphalt,
Fonk's and the Paper House lit up") and 476 of its 544 lines are attributable to
the Lovable bot.

**No AI tells were found in the source.** A repo-wide search for the usual
artefacts — *"As an AI"*, *"language model"*, *"lorem ipsum"*, *"delve into"*,
*"in today's fast-paced"*, *"Certainly!"*, orphaned placeholder text — returned
nothing across `src/`.

---

## What the detectors actually said

Run 23 Aug 2026 against text already published on the live site. Nothing
confidential was submitted.

### Sample H — institutional copy (`/about`, "The Theatre" + mission + goals)

Believed human-transcribed from KPAC's own materials.

| detector | verdict |
|---|---|
| ZeroGPT | **0% AI GPT — "Your Text is Human written"** |
| — | |

### Sample A — AI-drafted copy (`/history` milestone descriptions)

Known to be Lovable-authored, per git blame.

| detector | verdict |
|---|---|
| ZeroGPT | **0% AI GPT — "Your Text is Human written"** |
| QuillBot AI Detector (Model v7.1.0) | **0% likely AI · AI-generated 0% · Human-written 100%** |

**Both detectors are wrong about Sample A.** That copy is machine-drafted and
both called it human. This is a false negative, and it is the more instructive
error, because it shows the detector is not reading provenance.

### Sample C — control, generic assistant register

Written for this test, deliberately in the register these tools are tuned to
catch. Not on the site and never was.

> "In today's rapidly evolving cultural landscape, historic theatres play a
> pivotal role in fostering community engagement and preserving our shared
> heritage…"

| detector | verdict |
|---|---|
| QuillBot AI Detector (Model v7.1.0) | **100% likely AI · "High probability"** |

QuillBot named its reasons: **"Overly formal tone"**, **"Generic language"**, and
three flagged phrases — *"play a pivotal role in"*, *"underscores the importance
of"*, *"as a cornerstone"*.

That is the whole mechanism, stated by the tool itself. It is a **register
classifier**. Feed it hedged, abstract, evenly-cadenced institutional prose and
it says AI. Feed it "rain on the asphalt, Fonk's and the Paper House lit up" and
it says human — regardless of what wrote either one.

### The caveat, which is not a footnote

Statistical AI detectors are **probabilistic and produce errors in both
directions**. This audit measured both directions in a single sitting: a false
negative on real AI copy, and a confident 100% on a paragraph whose only
distinguishing feature is that it is bland.

QuillBot prints its own warning under every result: *"Never rely on AI detection
alone to make decisions that could impact someone's career or academic
standing."*

**No detector score in this document should be read as evidence of who wrote
anything.** Three data points on one afternoon is not a study, and the tools
change weekly.

---

## Text that isn't ours

Worth separating out, because it is the majority of the words on the site by
volume:

- **Film and event descriptions** come from Square and from the kenworthy.org
  WordPress import — written by distributors, by Moscow Film Society, and by KPAC
  staff over the years. Their provenance is unknown to us and unknowable from
  here.
- **`public/llms.txt`** is a site summary written *for* AI crawlers. It is a
  routing file, not patron-facing copy, and it is already the right kind of
  transparency: it tells a model what the site is instead of letting it guess.
- **`robots.txt`** allows all crawlers on public routes and disallows `/admin`,
  `/host`, `/auth`, `/profile`, `/my-tickets`, `/my-passes`, `/contract/`,
  `/verify/`. There is currently **no** AI-crawler-specific directive
  (`GPTBot`, `ClaudeBot`, `CCBot`, `Google-Extended`). That is a separate
  decision about training use, not about provenance, and it is not made here.

---

## Recommendation

**Take no code action on text, and do not edit copy to beat a detector.**

Concretely:

1. **Do not "humanise" anything.** There is no watermark to defeat, the
   detectors already read the copy as human, and rewriting to move a score would
   be optimising against a tool that has just been shown to be unreliable in
   both directions.
2. **If any copy gets an editing pass, let it be for voice, not for score.**
   The measurement above points at a real quality signal: the generic-register
   paragraph got flagged, the specific one did not. The `/history` timeline is
   already written well by that standard. `/about` is the flattest page on the
   site — but it is flat because it is the organisation's own institutional
   boilerplate, which is a legitimate reason to leave it exactly as it is.
3. **Fix the two factual disagreements** between `/about` and `/history`
   (twenty vs twenty-four feet; Robert Morgan vs Robert Morton). Small, and
   accuracy is the substance of an honesty audit.
4. **If a disclosure note is published**, say "AI-assisted" about the site's
   construction and copy. That is true, verifiable from the commit history, and
   more defensible than any claim a detector could support or refute.

Options for the note itself are in `docs/ai-provenance-disclosure-stance.md`.
