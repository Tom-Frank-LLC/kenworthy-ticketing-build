---
brief: archive-posters-commons
title: Archive films show public-domain posters from Wikimedia Commons, and a dead poster no longer renders broken
status: built
track: ux
date: 2026-11-16
verified: false
findings: FINDINGS-archive-posters-commons.md
---

# Brief: legitimate posters for archive films

**Requested by:** Tom, 2026-11-16: "source the posters that you can source
through legitimate avenues".

## Data (applied to production, 2026-11-16)

495 films now show a public-domain poster from Wikimedia Commons. The posters are
stored at `posters/commons/<movie id>.jpg`, matched through Wikidata and checked
by eye. How, why this source, what was rejected and what is left:
FINDINGS-archive-posters-commons.md. Every file and its licence:
`docs/data/archive-posters-commons-2026-11-16.csv`.

## Code (this PR; not yet on production)

- `ProductionMedia`: a poster that fails to load renders as no poster, and
  `onPosterError` tells the page. Keyed by URL, so a new URL is tried again.
- Showing page: a broken poster counts as no poster, so an archive page shows
  its title card. Found on Spirited Away (2003 screening), whose poster is a dead
  WordPress URL and showed a broken image on production.
- `scripts/backfill-archive-posters.mjs`, `scripts/sql/archive-poster-candidates.sql`,
  and `scripts/lib/wikidata-films.mjs` (the title-plus-year Wikidata matching
  from #419, with rate-limit spacing and timeout splitting).

## Checked

- `tsc -p tsconfig.app.json`, `check:worker`, full vitest. Two new tests: a
  failed poster falls back and tells the page, and a new URL is tried after a
  failure.
- Production: the run's audit row says `movies_updated: 495`; all 495 files are
  byte-identical at their public URLs; *The General* (1927) shows its poster on
  kenworthy.org.
