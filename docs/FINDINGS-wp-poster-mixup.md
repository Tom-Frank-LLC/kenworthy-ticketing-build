# Findings: posters copied from WordPress showed the wrong film

14 Nov 2026. Data-only fix applied to production; no code changed.

## What Tom saw

On the History film archive, the 2024 listing "Hitchcock Fest: Rear Window"
showed the poster for *How to Lose a Guy in 10 Days*.

## Cause

The bug is in the August 2026 poster rehydration, not the archive import.

1. Listings imported from the old WordPress site on 10 Aug 2026 pointed at
   WordPress **thumbnails**, e.g.
   `kenworthy.org/wp-content/uploads/poster-104-205x300.jpg`.
2. On 12–13 Aug every one of those (553 listings) was "rehydrated" into our
   storage at `posters/wp-rehydrated/<id>-<name>.jpg`. The audit log keeps
   each listing's old and new URL (`admin_audit_log`, action `*.update`,
   `details.changes.poster_url`). The rehydration stripped the `-WxH` size
   suffix to fetch the full-size file, `poster-104.jpg`.
3. WordPress's uploads folder is flat, and staff reused generic names
   (`poster-104.jpg`, `poster-web-3.jpg`). By May 2026, when WordPress was last
   crawled, the full-size `poster-104.jpg` was a later upload, How to Lose a
   Guy, which had replaced the one Rear Window used. Only the old listing's
   differently sized thumbnail (`-205x300`) still held the right picture.
   So every listing whose name had been reused got the newest upload's
   picture.

It goes further than the rehydration: some original thumbnails were
overwritten as well, whenever two uploads produced the same thumbnail size,
and some listings were imported already pointing at another film's URL. The
URLs alone therefore cannot tell you which poster is right.

## How it was measured

`scripts/poster-audit/classify.py` uses three automated signals:

- **Wayback.** Each listing's original thumbnail, fetched from
  web.archive.org (235 of 553 were archived), compared with the stored image
  by perceptual hash. Matches cluster at 0–29 out of 256 and mismatches at
  100+, with nothing in between.
- **Shape.** The `-WxH` in the thumbnail name gives the original's aspect
  ratio. This never flagged a correct poster, but it caught only 2 of 12
  known-wrong ones.
- **Shared bytes.** The same image stored for listings with different titles.

These undercount, for the reasons above. **The ground truth was a visual
review of all 546 still-rehydrated posters against their titles.** The count
is **112 wrong** (111 movies, 1 event). All 112 are past listings; none had
an upcoming showing.

The Wayback Machine crawled kenworthy.org only once, in May 2026, after the
overwrites. So no full-resolution original can be recovered from it.

## Fix applied (production, 14 Nov 2026)

Tom chose: restore what can be recovered and clear the rest, so a page shows
no poster rather than the wrong film.

| Action | Count |
|---|---|
| Restored from an archived original thumbnail (about 200×300) | 7 |
| Reused the correct poster from another listing of the same film (Perfect Blue, A Real Pain) | 2 |
| Cleared (`poster_url = NULL`) | 103 |

- **Restored thumbnails.** These are at `posters/wp-restored/<id>.jpg`. They
  were uploaded with `supabase storage cp --experimental --linked` and
  byte-checked against the public URL.
- **Update guard.** Each UPDATE matched on the wrong URL as well as the id, so
  a poster staff had changed since would be skipped. 112 of 112 rows applied.
- **Audit and undo.** There are 112 per-row audit entries holding the old
  URLs, so any row can be put back.
- **Staging.** It doesn't have these listings (different ids) and needed no
  change.

The full list, with each listing's wrong URL, new URL and original WordPress
URL, is in `docs/data/poster-fix-2026-11-14.csv`. Staff can work from it to
upload the right posters.

North by Northwest (Films From the Vault) was deliberately not given the
Centennial Series poster. That poster carries a different show date.

## Not fixed: 689 listings point at dead WordPress URLs

The poster URLs of 565 movies and 124 events still point at
`www.kenworthy.org/wp-content/uploads/...`. kenworthy.org is now this app,
and those URLs return **410 Gone**, so those listings show no image.

They were never rehydrated. Restoring them would run into the same overwrite
problem, so each image would need checking by eye.
