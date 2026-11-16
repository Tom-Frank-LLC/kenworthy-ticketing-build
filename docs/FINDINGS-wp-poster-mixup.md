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

## The 689 listings with dead WordPress URLs

On 14 Nov, 565 movies and 124 events still had poster URLs pointing at
`www.kenworthy.org/wp-content/uploads/...`. kenworthy.org is now this app, and
its Worker answers **410 Gone** to every `/wp-content` path
(`worker/redirects.ts`), so those listings showed no image.

### Why they were never copied

The August copy was done by the `refetch-posters` edge function (added in
6b3afb7, removed in 1789c1a). It had two gaps:

- **204 URLs were skipped by design.** It only handled URLs ending in a
  `-WxH` size suffix, and stripped the suffix to fetch the full-size file. A
  URL without the suffix was passed over.
- **485 were attempted and failed.** It reported failures only in its HTTP
  response and never saved them, so the reasons are lost. These skew old:
  their median last show is March 2024, against December 2025 for the copied
  set.

### Where else we looked (15 Nov)

| Source | Result |
|---|---|
| Our `posters` bucket | Only the 553 copied files, plus staff uploads |
| Old WordPress host (First Step Internet, 64.126.133.214) | Decommissioned; every path 302s to fsr.com |
| This Mac (Spotlight), Google Drive | No WordPress backup or uploads folder |
| `square_poster_matches_20260815`, catalog snapshot in storage | Empty table; the snapshot holds ITEM objects, no IMAGE objects |
| TMDB | Ruled out in August (18bfa0b): its licence does not cover commercial use. 31 of the dead filenames are TMDB image IDs and TMDB still serves all 31, but copying them raises the same licence question |
| Wayback Machine (CDX, prefix `kenworthy.org/wp-content/uploads/`) | 82 listings have the exact thumbnail or another size of the same file archived |

### Wayback recovery (production, 15 Nov 2026)

For each of the 82, we downloaded the exact archived thumbnail and the
largest archived size of the same file (`web.archive.org/web/{ts}id_/{url}`).
Wherever both existed they agreed by perceptual hash (dHash distance at most
11 of 256), so no file was overwritten between sizes. Every image was then
checked by eye against its listing title.

- **79 restored.** The largest copy was resized to at most 2000px, flattened
  to JPEG, uploaded to `posters/wp-restored/<id>.jpg`, and byte-verified
  against its public URL. A guarded UPDATE changed a row only where
  `poster_url` still equalled the dead URL: 56 movies and 23 events, with 79
  audit rows.
- **3 left as they were.** The archived image shows another event: Evil Does
  Not Exist (The Apprentice poster), Palouse Land Trust Benefit Concert (a
  Halloween party flyer) and Tom's Elton Tribute (a *Hope* screening flyer).
  All three had generic file names (`poster-web-1.jpg`, `poster-web-5.jpg`,
  `poster-web-1448x2048.jpg`), so this is the same overwrite cause as above.

The full list is in
[`docs/data/poster-wayback-recovery-2026-11-15.csv`](data/poster-wayback-recovery-2026-11-15.csv).

### Still open: 610 listings

610 listings still point at dead URLs: the 607 the Wayback Machine never
captured, plus the 3 above. What could still hold them:

1. **A backup of the old WordPress account from First Step Internet (FSR).**
   This is the only source likely to cover the event flyers. The dead URLs
   name exact files in `wp-content/uploads`, but generic names were
   overwritten there too, so each image still needs checking by eye.
2. **Orphaned images in the Square catalog.** The August repair found about
   1,040. Their names are abbreviated (`square butch.jpg`), so matching is
   fuzzy, and it needs live Square read access.
