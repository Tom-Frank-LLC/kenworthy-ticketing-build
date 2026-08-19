---
brief: showing-movie-search
title: Searchable movie picker when creating a showing
status: shipped
track: feature
date: 2026-08-13
evidence: SearchableSelect in ShowingForm.tsx
verified: true
---

# Brief (for Claude Code): Searchable movie picker when creating a showing

**Status:** 🟢 Ready to implement
**Date:** August 13, 2026
**Requested by:** Tom — creating a showing currently uses a plain dropdown for the movie; with a large catalog it's hard to find a title. Make it a type-to-search field.

## Goal
Replace the plain `<Select>` used to pick the movie (and event / live performance) in the showing form with a **searchable combobox** — type to filter by title, select to set the value. Same behavior for all three categories; no schema or data change.

## Current state (file:line)
`src/pages/admin/ShowingForm.tsx`:
- The picker is a shadcn `<Select value={itemId} onValueChange={setItemId}>` at ~line **221**, rendering `currentItems` as `<SelectItem>`s.
- `currentItems` (~line 105) is `movies` | `events` | `concerts` based on `category` (`'movie' | 'event' | 'concert'`), each loaded as `{ id, title, is_active }` ordered by title (lines 57–59).
- `itemId` is the selected id; on edit it's preset from `data.movie_id` / event / concert (~line 75). Saving writes `movie_id: category==='movie' ? itemId : null`, etc. (~line 127).

## Implementation
Build a searchable combobox from the shadcn primitives already in the repo — `src/components/ui/popover.tsx` + `src/components/ui/command.tsx` (this is the standard `Popover` + `Command` combobox pattern; `command.tsx` is present and currently unused elsewhere):

- A `Popover` whose trigger is a `Button` showing the selected item's title (or `Select a {category}` placeholder).
- Inside, a `Command` with `CommandInput` (search box), `CommandList`, `CommandEmpty` ("No match."), and a `CommandItem` per `currentItems` entry, filtering by typed title.
- On select: `setItemId(item.id)` and close the popover; keep the trigger label in sync.
- Preserve the existing wiring: `itemId` stays the source of truth, so save/edit logic at lines 75 and 127 is unchanged. When editing, the trigger must show the preselected title.
- Reuse for all three categories — it's the same `currentItems` picker, so one component covers movie/event/concert. The `category` and `venue` `<Select>`s can stay as plain dropdowns (short lists); optionally give the venue picker the same treatment if convenient.

Details:
- Show **inactive** titles too, marked with a muted "(inactive)" tag, so a not-yet-active movie can still be scheduled (don't silently hide them).
- If duplicate titles are possible, append the year (movies carry `release_year`) to disambiguate — pull it into the `select` at line 57 if you add it.
- Keyboard support comes free with `Command` (arrow keys, Enter); make sure Enter selects the highlighted item.

## Acceptance
- Typing in the field filters the list by title; selecting sets the showing's item and it saves with the correct `movie_id`/`event_id`/`concert_id`.
- Editing an existing showing opens with the current title preselected/visible.
- Works for movie, event, and live performance.
- `npm run build` passes.

## Out of scope
- No changes to the movies/events schema or to how showings are stored.
