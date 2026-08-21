---
brief: media-bucket-privacy-model
title: Settle the privacy model for media buckets, and fix the one place it already broke
status: queued
track: security
severity: P2
date: 2026-08-20
verified: false
---

# Brief (for Claude Code): the media bucket privacy model

**Status:** 🔴 Open. Contains one **live defect proven on staging** that can be
fixed on its own, ahead of the rest.
**Date:** August 20, 2026
**Requested by:** Tom — "do we have a private media bucket where items live
unless they are actively being used, in which case they move to public? What
are best practices for this?"

## The short answer

**No, and you should not build one.** Moving objects between buckets is the
wrong mechanism, for reasons set out below.

But the question was better than it looks, because we *do* already have the
thing it describes — a private bucket whose contents are supposed to become
publicly readable when a row is marked active — and **it does not work.** It
has almost certainly never worked. That is the first finding, and it is the
reason this brief exists rather than a one-line "no".

## What we actually have

Six buckets. Five are created by migrations; the sixth is created at runtime by
an edge function and appears in no migration at all.

| bucket | public? | MIME allowlist | size cap | created |
|---|---|---|---|---|
| `posters` | **yes** | images | 10 MB | `20260402052026`, constrained `20260819192104` |
| `concession-menus` | **no** | `application/pdf` | 25 MB | `20260429143125` |
| `festival-programs` | **yes** | pdf + images | 50 MB | `20260819151204` |
| `pass-images` | **yes** | images | 10 MB | `20260820094512` |
| `backstage-photos` | **yes** | images | 10 MB | `20260820203112` |
| `catalog-snapshots` | **no** | — none — | — none — | `square-event-probe/index.ts:567`, at runtime |

Four of the five migration buckets are public and use `getPublicUrl`.
Publication is a row flag (`is_published` / `is_active`), never a bucket move.

## Finding 1 — the concession menu PDF is invisible to the public

`concession-menus` is private. `ConcessionsPreview.tsx` — a component on the
**public home page** — reads the active menu row and calls
`createSignedUrl(file_path, 3600)` to render a "View full printed menu (PDF)"
link.

`createSignedUrl` requires `SELECT` on the storage object. The only SELECT
policy on that bucket is:

```sql
CREATE POLICY "Staff and admins can view concession menus"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'concession-menus'
  AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'staff'::app_role))
);
```

For a patron, `auth.uid()` is null, both `has_role` calls are false, and there
is no anon policy. The signing request fails, `signed?.signedUrl` is undefined,
`activeMenuUrl` stays null, and the link is never rendered.

### Proven, not reasoned

A first attempt to test this was **inconclusive and would have been misleading
if trusted**: signing a *made-up* path returns `404 NoSuchKey` on a private and
a public bucket alike, because storage returns the same "not found" whether the
object is missing or merely hidden by RLS. So the test was redone against real
conditions — a menu PDF uploaded and activated through the admin UI on staging:

| step | as | result |
|---|---|---|
| read the active menu row | anon | ✅ returns `label` **and `file_path`** |
| sign that exact, existing object | anon | ❌ `404 NoSuchKey` |
| download it directly | anon | ❌ `400` |

So the row is public, the path leaks in the row, and the bytes are unreachable.
The link silently does not render.

Two reasons this has gone unnoticed:

- **It fails silently.** `const { data: signed } = await ...` discards the
  error, so there is no console noise and no toast.
- **It works for whoever checks.** Staff and admins pass the policy, so anyone
  signed in — which is everyone who has ever looked at this page while working
  on it — sees the link exactly as intended.

There is currently **no active menu in staging or production**, so nothing is
broken for a patron *today*. The moment someone publishes a menu, it will be.

This is fixable on its own and should not wait for the rest of this brief.

## Finding 2 — "unlisted" is not "private", at two different levels

On the four public buckets, `is_published` controls **listing, not access**. An
unpublished photo's bytes are still reachable by anyone with the direct URL;
that is why upload paths carry a timestamp prefix. This is the intended design
and it is now written into the `festival-programs` and `backstage-photos`
migrations — but it is exactly the kind of design that gets rediscovered as a
bug at a bad moment. It needs to be stated once, somewhere a person will find
it, rather than in two migration headers.

## Finding 3 — `catalog-snapshots` was created outside the migrations

`square-event-probe` calls `createBucket(bucket, { public: false })` inside a
`try {} catch {}` on every run. It is private and the signed URL is minted
server-side with the service role, so it is **functionally correct** — this is
the pattern the rest of the brief recommends.

But it exists in no migration, so it has no `allowed_mime_types`, no
`file_size_limit`, and no declared policies, and a reader auditing storage from
the repo will not find it. `20260820164402` set out to make the public-bucket
rule live in the pattern; a bucket created in application code sidesteps that
entirely.

## Best practices — why not to move objects

Moving an object from a private bucket to a public one when it goes live is a
natural-sounding design that fails on contact:

1. **The move is not atomic.** Copy-then-delete across buckets has a window
   where the object exists twice, and a failure between the two steps leaves
   either an orphan or nothing. Publishing is a state change; it should be one
   `UPDATE`, not a distributed transaction.
2. **`file_path` stops identifying the object.** Every row, cached URL, email
   and CDN entry pointing at the old location breaks. Objects should be
   immutable once written; their *visibility* is what varies.
3. **It doubles the failure modes without adding a guarantee.** The bytes were
   already reachable by URL while in the "private" bucket if that bucket was
   ever readable; if it was not, nothing was gained that a policy could not do.
4. **It cannot be undone cheaply.** Unpublishing means moving back, which means
   another non-atomic copy, and the archive of past states disappears.

The rule underneath all four: **one object, one immutable location; visibility
is a property of the row, enforced by policy.**

### The three patterns, and when each is right

| pattern | bucket | URL | use when |
|---|---|---|---|
| **A. Public bucket, row flag** | public | `getPublicUrl` | The content is for the public and there is nothing to protect — only to *stage*. Posters, festival programmes, Backstage photos, pass images. Cheapest and cacheable. Unlisted, not private. |
| **B. Private bucket, signed URL minted for the viewer** | private | `createSignedUrl` **plus an anon SELECT policy scoped to the live row** | The content is genuinely restricted, or must expire. Requires a policy that can express "the object belongs to a published row" — see below. |
| **C. Private bucket, server-mediated** | private | edge function mints with service role | The rule is too complex for a policy, or the client must never hold a durable URL. `catalog-snapshots` does this correctly. |

**Pattern B has a sharp edge**, and it is precisely what bit the concession
menu: storage RLS sees `storage.objects`, not your table. "This object belongs
to the active menu" has to be written as a join back to the owning table:

```sql
CREATE POLICY "Anyone can read the active menu's file"
ON storage.objects FOR SELECT
USING (
  bucket_id = 'concession-menus'
  AND EXISTS (
    SELECT 1 FROM public.concession_menus m
    WHERE m.file_path = storage.objects.name AND m.is_active
  )
);
```

If a bucket is private and something public has to read from it, that join is
the work. Skipping it is what produces a feature that silently only works for
staff.

### Choosing, in one question

> Does an unauthorised person holding the URL actually harm anyone?

**No** → Pattern A. Do not pay for signing. Most theatre media is here: it is
promotional, it is printed, it is handed out at the door.
**Yes** → Pattern B or C, and the content genuinely does not belong in a public
bucket.

There is no third category, and "it feels tidier private" is not one. A private
bucket that everyone can read through a signed URL they can request freely is a
public bucket with extra steps and one more thing to break.

## Proposed work

**~~Do first, independently~~ — DONE, `#148`.**

1. ~~**Make the concession menu reachable.**~~ **Shipped in `#148`** (built, not
   yet in production). Tom chose (b): `concession-menus` is now a public bucket
   read with `getPublicUrl`, matching the four other media buckets — a printed
   menu handed to every customer at the counter has nothing to protect.
   `getPublicUrl` is synchronous and cannot fail, so there is no longer an error
   to discard rather than a discarded error to remember to log.
   Migration `20260820234512`. Verified on staging with a real menu uploaded and
   activated, **as an anonymous visitor**: the request that returned `404`
   before now returns `200 application/pdf` with no key at all.
   `#148` also fixed `activate()`, which had no `.select()` — a blocked publish
   reported success, which is the same silent failure one layer up.

**Still open — the model itself:**

2. **Write `docs/STORAGE-CONVENTIONS.md`** — the six buckets, the three
   patterns, the choosing question, the "unlisted ≠ private" statement, and the
   public-bucket rule (`allowed_mime_types` + `file_size_limit` at creation)
   that currently lives only in a migration header and the deploy runbook.
3. **Bring `catalog-snapshots` into a migration** with a MIME allowlist and a
   size cap, and drop the runtime `createBucket`.
4. **Add a storage lint** — a test that fails when a bucket in
   `storage.buckets` has `public = true` and no `allowed_mime_types`, or exists
   with no corresponding migration. This is the third time the same class of
   gap has been found by hand (`20260819192104`, `20260820164402`, and now).
5. **Audit every private-bucket read for the anon path.** `concession-menus`
   was the only one, but the check is cheap and the failure is invisible.

## Decisions for Tom

1. ~~**The menu PDF: public bucket, or private with a scoped policy?**~~
   **Decided: public.** Shipped in `#148`.
2. **Is any theatre media genuinely private?** Rental contracts and signed
   agreements are the plausible candidates and do not currently live in
   storage. If they ever do, that is Pattern C, not A.
3. **Is the storage lint worth the test?** It is maybe thirty lines and it
   closes a gap that has now recurred three times.

## Test plan

- ~~With the **anon key only**, the active menu PDF is fetchable and the home
  page renders the link.~~ **Done in `#148`** — `200 application/pdf` with no
  key at all, and the link is a plain public URL carrying no token.
- Every public bucket reports non-null `allowed_mime_types` and
  `file_size_limit`; the lint fails if one does not.
- An SVG upload is refused with `415` on every public bucket.
- `catalog-snapshots` exists with the same constraints after a migration, and
  `square-event-probe` still writes and signs a snapshot.
