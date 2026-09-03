---
brief: header-lockup-collapse-and-white-k
title: The lockup stops collapsing at 1024, and the phone "K" is the palette's own near-white
status: shipped
track: ux
date: 2026-09-01
shipped_in: ["#260"]
shipped_at: 2026-09-03
verified: true
evidence: >-
  PR #260 squash-merged as d36c647. Production worker version
  577b2f6f-8926-403f-83a5-6a7625106a53 (rollback ac7eab93-4086-46f5-a795-30320be5db2f);
  staging 09076e59-ac3b-4ff8-af3d-e860d4a5b876 (rollback b7c2e353-a8ea-4adf-b8fc-163c73388050).
  kenworthy.org and the workers.dev origin both serve assets/index-DhnJJHaj.js
  (text/javascript, 296259 bytes) and assets/index-xIckO_-V.css (text/css).
  Driven against kenworthy.org: below `sm` the mark is a masked span filled
  rgb(244,241,235) with filter none, 61x54, centre offset 0px; at 640/1024/1280
  the lockup returns as an img at 206x54 / 216x69 / 262x69 — 1024 was 64x69
  before. objectPosition computes 51.84% 80% and the hero drift is
  -0.2/0.0/0.0px at 360/390/414 against +6.7/+7.0/+7.5px before. Prior prod was
  601e5b9, established by reproducing its bundle hash (index-B5ysscQF.js) from
  a clean build of that commit, so nothing unmerged was overwritten.
---

# Brief: the 1024 lockup collapse, the hero's "K", and a mark that matches the palette

Three changes, from one observation each. All measured rather than eyeballed —
twice here eye was wrong and measurement caught it.

## 1 — The lockup collapsed at 1024

Crossing `lg` took the lockup from 225px wide to **64px**: a quarter of its
262px artwork, illegible, at the most common laptop width. It recovered only
by ~1400.

Nothing was wrong with the logo. At `lg` the whole desktop link set switches on
*and* Donate joins the CTAs, taking the nav from 247px to 381px; the row then
wanted ~1180px inside a 1022px container. Flexbox takes that ~158px from
whatever can give, and the text links cannot — their min-content width is the
longest word, which is why Theatre Rentals wraps rather than compresses. The
left cluster carries `min-w-0`, so the image was the only item that could
absorb it, and it absorbed nearly all of it.

`shrink-0` on the brand link was the first proposed fix and was **wrong**: if
the logo cannot yield, nothing else can either, and the row overflows into
horizontal scroll — worse than a small logo. The row needed *width*, not a
different victim. Donate now waits for `xl` (~134px) and full `gap-8` for `2xl`
(~72px). Donate alone got 1024 to 64% and left a new dip at 1280; the gap
change closes both.

| viewport | before | after |
|---|---|---|
| 1024 | 64px (24%) | 216px (82%) |
| 1100 | 134px (51%) | 262px (100%) |
| 1280 | 242px (92%) | 262px (100%) |

This was the **third** time the row had been one button too full. The links had
already moved `md` → `lg` for the same reason, which fixed the symptom one
breakpoint over without buying enough width.

## 2 — The hero's marquee "K" sat ~7px right of the header's

Below `md` the band is taller than wide, so `object-cover` scales the photo to
the height and leaves ~382px of horizontal overflow; the X percentage decides
which end is cut. `center` → **51.84%**.

Derived, not nudged — and the first derivation was wrong in a way worth
keeping. The sign is the only saturated green in a frame of red neon, so
scanning for green finds it; but scanning the *whole* frame also catches green
stage light spilling up the building, which put the centre at x=392.5.
Restricted to the rows the sign occupies (y=248-308, green extent a consistent
x=370..412) the centre is x=391 of the 768px source. Solving
`x·s − overflow·p = w/2` gives 51.79-51.84% on every phone from 360x800 to
430x932 — the geometry is nearly self-similar, so one number serves them all.

The error surfaced only because a centre hairline drawn over a screenshot did
not quite land. Eye had been trusted first, and eye is exactly what fails here:
the sign glows and the white marquee to its right is brighter, so the apparent
centre pulls right.

## 3 — The phone "K" looked dusty, for an arithmetic reason

The artwork is #414042. Inverted to read on a dark bar it is #BEBFBD, dimmed to
**#B4B5B4** — a neutral grey at **52% the relative luminance** of the warm
near-white (#F4F1EB) beside it. The colour was a *by-product of the artwork*
rather than a choice, so it could not match anything in the palette, and no
amount of tuning the filter was going to make it.

The mark is now `--foreground` painted through a CSS mask: the SVG selects the
shape, the token is the ink. It follows a re-theme instead of drifting out of
one — the same reason `.glow-primary` reads `var(--primary)` rather than the
magenta it once hardcoded.

### What was built and then deleted

Six treatments were built and compared on staging: white, gold, backlit
(silhouette), marquee (dark housing, lit letter), sunburst and sunburst-gold
(rays lit too). The last three needed the artwork split into rays, housing and
letter, because in kenworthy-k.svg the letter is not a shape — the arch is one
path of two subpaths under `fill-rule="evenodd"`, so the K is the *hole* in it,
and a CSS mask can select a file but not a subpath.

`white` was chosen. The other five were **deleted rather than left switched
off**: each derived SVG carried a "regenerate me if the original is redrawn"
warning, and unused artwork with a standing maintenance obligation is what goes
stale and then misleads whoever finds it. `--mark-glow`, `--mark-backlight` and
the `glow` prop went with them. Net result: three files changed, no new assets,
`index.css` untouched. PR #260's history has all six if the question reopens.

### Two CSS traps, both caught by rendering

- **`filter` applies before `mask`.** A drop-shadow on a masked element is
  computed on the un-masked box and then clipped back to the glyph by the mask
  it was meant to escape. It does not vanish — it renders as a faintly soft
  edge, which is the kind of wrong that survives review.
- **A mask clips descendants too.** In the marquee and sunburst treatments the
  lit letter had to be a *sibling* of the masked housing; nested, it was
  trimmed to the very hole it existed to fill.

## Known, not chased

- Theatre Rentals still wraps to two lines at 1024 and 1100. That is the
  graceful behaviour — forcing one line costs ~80px and undoes the gain — and
  the 84px bar has room for it.
- **The sign-in card's "K" is still the dusty grey**, since `pages/Auth.tsx`
  uses the `filter` treatment. The same diagnosis applies; deliberately out of
  scope, and worth its own pass. See [[BRIEF-mobile-header-k-mark]].
