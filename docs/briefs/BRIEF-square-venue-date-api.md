# Brief (for Claude Code): Restore venue + event date/time to film/event/MET items via the Square API — safely

**Status:** ✅ Shipped — PR #85 (`3b26771`); venue on 484 listings and dates on 259 (`c095abd`).
**Date:** August 17, 2026
**Requested by:** Tom — every film/event/MET Live listing should carry the **venue** (`508 S Main St, Moscow, ID 83843`) and an **event date/time** (first showing = start, last showing = end). A few were restored manually; do the rest by API. **Explicit condition: this must not repeat the Aug 14 catalog damage.**
**Data source:** `square-venue-dates.csv` (delivered) — one row per listing with `Square Token`, `Venue`, `Start`, `End`, `Date source`. Venue is filled for all 484 listings; date/time for 285 (skip `NEEDS DESCRIPTION` rows).

## Non-negotiable guardrails (from `docs/INCIDENT-2026-08-14-square-catalog.md`)
The Aug 14 wipe happened because `push_item` **reconstructed** a catalog object from a few columns and `UpsertCatalogObject` **replaced** the live object, clearing description/images/variations/categories on 906 items. Square has **no** isolated field-update endpoint — every write goes through that same full-object replace. Therefore:

1. **Strict read-modify-write, always.** For each item: `RetrieveCatalogObject` (with `include_related_objects` as needed) → mutate **only** the venue/date field(s) on the returned object → `UpsertCatalogObject` sending the **complete, unmodified-except-target** object back with its current `version`. Never build an object from our columns.
2. **Never touch** `item_data.name`, `description`, `variations`, `image_ids`, `categories`, `reporting_category`, `tax_ids`, or anything else. Assert they are byte-identical between the retrieved object and the object you send, except the single field you intend to change.
3. **"It returned 200" is not acceptance.** Verify in the Square **dashboard** that the item's description/variations/images are intact and the venue/date now show.
4. **One item first, then a small batch, then the rest.** Halt on any unexpected diff.
5. Use the app's existing Square plumbing (`_shared/square.ts` `squareFetch`, `loadSquareConfig`) so env/secrets/host are consistent. Read-only calls in Phase 0.

## Phase 0 — DISCOVER where venue + date/time live (READ-ONLY; review before Phase 1)
Standard Square catalog items have **no native venue or event-date field**, and the app has never written one (no `custom_attribute` code anywhere). So we must learn how the *manual* restores stored them before writing.

1. Pick 3–5 items Tom restored manually (ask Tom to name one, or scan: retrieve film/event items and find any whose venue/date are already populated).
2. `RetrieveCatalogObject` each and **dump the full JSON**. Locate where the venue string (`508 S Main St…`) and the event date/time actually sit:
   - a **catalog custom attribute value** (`custom_attribute_values` map on the object — look up its `CUSTOM_ATTRIBUTE_DEFINITION`, note the `key`, type STRING/NUMBER/…), or
   - the **item description** / a native field, or
   - **not on the catalog object at all** (e.g. Square's separate event/Online system) — in which case the Catalog API can't set it and we stop and reconsider.
3. If it's a custom attribute, confirm the **definition(s)** exist (`ListCatalogObjects` type `CUSTOM_ATTRIBUTE_DEFINITION`) — capture the exact `key`(s) for venue, event start, and event end. If a needed definition is missing, note it (creating one is a safe, additive `UpsertCatalogObject` of a new definition object — it does not touch items).
4. **Write a short findings note** (`docs/venue-date-square-mechanism.md`): the exact storage location + key(s), the data type, one example object before/after (proposed), and confirmation that description/variations/images sit elsewhere on the object and won't be affected. **Stop and get Tom's OK.**

## Phase 1 — Apply, gated on Phase 0 (writes, strict read-modify-write)
1. Scope to **film / event / MET Live** items only (match `square-venue-dates.csv` by `Square Token`). Never concessions/merch/passes.
2. For each row with a `Square Token` and a value to set:
   - `RetrieveCatalogObject(token's item)`.
   - Set **only** the confirmed venue field, and the event **start/end** field(s), to the row's `Venue` / `Start` / `End`. (Format start/end to whatever the manually-restored items use — match them exactly.)
   - Re-`UpsertCatalogObject` the full object with its current `version`.
   - **Diff assert:** the sent object equals the retrieved object except the venue/date field(s). Abort the item if any other field differs.
3. **Order:** one item → verify in dashboard (venue/date present; description/variations/images intact) → a batch of ~10 → verify → then the remainder. Use `BatchUpsertCatalogObjects` only if each object is a full read-modify-write result (not reconstructed).
4. Rows marked `NEEDS DESCRIPTION` (199, mostly legacy Square-only items) have **no date** — set **venue only** on them; leave date/time blank.
5. Idempotent: re-running sets the same values; safe to resume.

## Verify (acceptance)
- Spot-check 5 items in the Square dashboard: venue + start/end present; **description, variations, images, category unchanged**.
- A read-back (`RetrieveCatalogObject`) of 10 items shows the target fields set and every other field identical to a pre-run snapshot.
- Take a **full catalog export before Phase 1** as a backup (dashboard → Export Library) — the pre-write snapshot.
- Counts: venue set on all in-scope items with a token; date/time set on the 285 dated rows; `npm run build` unaffected (no app code changes required — this is a one-off script/edge task, not a runtime path).

## Notes
- If Phase 0 finds the fields live **outside** the catalog object (Square's event/Online layer), the Catalog API can't set them — report that and we switch to manual entry or the correct Square surface. Don't force it through the catalog object.
- Event date/time may need to be a STRING attribute (Square catalog custom attributes are STRING/NUMBER/BOOLEAN/SELECTION — no datetime type); match the format the manual restores used.
