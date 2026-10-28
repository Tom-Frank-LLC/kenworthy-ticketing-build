---
brief: seat-release-unique-index
title: A released or failed card sale stops holding its assigned seat
status: queued
track: bug
severity: P2
date: 2026-10-28
verified: false
---

# Brief: a released card sale keeps its seat forever

**Found:** 28 Oct 2026, testing the Stand at the patron-facing display on
staging (`BRIEF-stand-at-patron-display.md`).

`tickets_showing_id_seat_id_key` is `UNIQUE (showing_id, seat_id)` with no
condition (read from production, 28 Oct 2026). `release_pending_card_sale`
marks a cancelled counter card sale `failed` and leaves `seat_id` in place, so
the seat can never be sold again: re-ringing it fails with
`duplicate key value violates unique constraint "tickets_showing_id_seat_id_key"`.
The same holds for a Terminal sale cancelled at the reader, and for any other
path that leaves a non-confirmed row with a seat.

**Not hurting anyone yet:** production has no ticket with a seat at all (every
sale there is general admission), so this bites only when an assigned-seating
showing is sold.

**Fix to decide:** make the index partial (only rows that hold a seat:
`WHERE status IN ('pending', 'confirmed')`, or whatever the status set really
is — check every writer), or clear `seat_id` on release. Check how the online
checkout releases seats first; it may already do one of these.
