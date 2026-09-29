---
brief: pos-sandbox-banner-and-show-picker
title: The POS sandbox banner shows only on the sandbox, and the show picker lists non-ticketed events disabled with a reason
status: shipped
track: bug
date: 2026-09-29
shipped_in: ["#351", "#352"]
shipped_at: 2026-09-29
verified: true
---

# Brief (for Claude Code): Honest POS sandbox banner + stop the show-picker silently hiding events

**Status:** 🟡 Two small production-clarity fixes. (1) The POS "Sandbox mode" banner is **hardcoded** and false — prod is confirmed on **production** (Tom checked the Timecards tab), so real card charges are fine; the banner just always lies. (2) The "add a show" picker silently drops non-ticketed events, so a staffer's RSVP event (Community Theatre *Nosferatu*) vanished with no explanation. Neither is a data or payments problem — they're display/UX bugs.
**Date:** September 29, 2026
**Requested by:** Tom — the Staff POS on prod shows "Sandbox mode" (it isn't), and a created event didn't appear when adding shows (it's an RSVP event). Fix both.

## Fix 1 — Make the "Sandbox mode" banner reflect the real environment
### Current state (verified, build `d0e5b19`)
`src/components/pos/PaymentMethodSelector.tsx` renders **"Sandbox mode — payments are simulated, no real charges"** unconditionally whenever `paymentMethod === 'card'` (L52–58). The component's props are only `paymentMethod` and `onSelect` (L7–9) — it never receives the Square environment, so the warning is a hardcoded dev leftover that shows in production too. Tom confirmed via **Team → Timecards** (which reads the real environment) that prod is on **production**, so the banner is simply false.

### The change
- **Source the real environment.** `publishableConfig()` (`supabase/functions/_shared/square.ts`) already returns `{ applicationId, locationId, environment }`, and `square-donation` `action: 'get_config'` exposes it. Have `StaffPOS` fetch it once at mount (or reuse whatever config the card/terminal path already reads) and pass the environment down — e.g. `isSandbox={environment === 'sandbox'}` — to `PaymentMethodSelector`.
- **Only show the banner when genuinely sandbox.** Render the warning solely when `environment === 'sandbox'`; in production it does not appear. Use the **same environment signal** the Timecards tab uses, so every POS/labor surface agrees on one source of truth (don't introduce a second way of deciding).
- **Unknown-state guard (Decision 1):** if the config can't be read, **don't** show the sandbox banner (recommended) — a false "simulated payments" alarm is exactly the current bug, and production is the norm. Optionally log the failure, but never claim sandbox when the environment is unknown.

This is display-only — no change to how payments are taken.

## Fix 2 — The "add a show" picker should not silently hide events
### Current state (verified)
`src/pages/admin/ShowingForm.tsx` builds the event/performance picker by filtering to **ticketed only**: `const ticketedEvents = (eventsRes.data || []).filter(e => e.ticket_type === 'ticketed')` and the same for concerts (L228–237), then `setEvents(ticketedEvents)`. RSVP and info-only events are dropped entirely — correctly, in that an RSVP/info-only event has nothing to sell through an internal showing, but **silently**, so a staffer who created an RSVP event (*Nosferatu*) can't find it in the picker and gets no reason why. (Immediate resolution for that specific event: switch it to **Ticketed** in the event editor — a data change Tom can make now, no code needed. This fix stops the confusion recurring.)

### The change
- **Don't omit — disable with a reason (Decision 2).** Instead of filtering non-ticketed events out, list them in the picker **disabled**, with an inline note such as *"RSVP / info-only — switch this event to Ticketed to add shows."* Keep the underlying rule intact (only a ticketed event can carry an internal showing; we are **not** making RSVP/info-only events sell internally) — the change is purely that the event is now visible with an explanation and a clear next step, rather than missing. Apply the same treatment to both events and live-performances (concerts).
- **Null-safety (defensive).** Treat a missing/`null` `ticket_type` as `'ticketed'` when deciding selectability, matching the legacy-backfill intent noted in the code (a pre-column row "was ticketed by default"). Prod's `events.ticket_type` is `NOT NULL DEFAULT 'ticketed'`, so this shouldn't bite today, but the strict `=== 'ticketed'` check would silently exclude any row that ever came back without it — this closes that crack.
- Keep the existing scope/deep-link handling (L240–246) working: if someone lands on the form scoped to a non-ticketed event, show the same disabled/explanatory state rather than a blank selector.

## Decisions for Tom
1. **Banner unknown-state:** show no sandbox banner when the environment can't be read (recommended) vs. some neutral placeholder.
2. **Picker:** show non-ticketed events **disabled with a reason** (recommended) vs. keep hiding them but add a general hint near the selector.

## Test plan
- **Banner:** on production the POS card option shows **no** "Sandbox mode" warning; pointed at sandbox (or `SQUARE_ENV` unset), the warning **does** appear; the POS agrees with the Timecards tab's environment note; a failed config read shows no false sandbox banner. No change to cash/card charge behavior.
- **Picker:** a **Ticketed** event/performance is selectable as before; an **RSVP or info-only** event now appears **disabled** with the "switch to Ticketed to add shows" note (not missing); switching *Nosferatu* to Ticketed makes it immediately selectable; an event with a null `ticket_type` is treated as ticketed; deep-linking to a showing scoped to a non-ticketed event shows the explanatory state, not a blank picker.
- `npm run build` + tests pass (add a test asserting the banner only renders for `environment === 'sandbox'`, and one asserting the picker lists a non-ticketed event as disabled rather than omitting it).

## Implementation notes (as built)

Both recommended decisions taken: unknown environment → no banner; non-ticketed events listed disabled with a reason.

- **Banner.** Three POS surfaces render `PaymentMethodSelector` (StaffPOS, ConcessionPOS, FilmPassPOS), not only StaffPOS. So rather than threading an `isSandbox` prop from each, the selector calls `useSquareEnvironment()` (`src/hooks/useSquareEnvironment.ts`): one `get_config` per page load via the existing `fetchSquareConfig('square-donation')`, cached at module scope. That is the same server decision the Timecards tab reads — `square-labor`, `square-terminal` and `get_config` all resolve `environment` through `squareEnvironment()` in `_shared/square.ts`. A failed read returns `null`, logs a warning, is not cached, and shows no banner.
- **Picker.** Selectability is `canCarryShowing()` in `ShowingForm.tsx`: any film, or an event/performance for which `ticketsSoldHere()` holds. That existing helper already reads a missing `ticket_type` as ticketed, so the null-safety came free. `SearchableSelect` gained an optional `disabledReason` per option. Disabled rows cancel `CommandItem`'s `opacity-50` and use the solid `muted-foreground` token instead, because a faded reason would fail AA.
- **Deep link to a non-ticketed event** drops the scope as before, but the toast now names the title, its mode and the fix; the picker then shows the event disabled.
- **Edit path unchanged on purpose.** `selectedItem` resolves only to a choosable title. Without that, an existing show whose event was later switched to RSVP would enter the film-only "not sold here" branch and retire its tiers on the next save. A test pins this.

## Revised the same day: RSVP and info-only productions take shows

Fix 2 as first shipped (#351) kept the old rule, *only a ticketed event can carry a showing*, and made it visible by greying such events out. Tom corrected the premise: an RSVP or info-only event still needs dated shows on the calendar, just as a film ticketed elsewhere does (#329). The rule dated from an unlabeled 17 Jun commit ("Changes"). Nothing else depended on it:

- the database has no guard on the showing row;
- `price_ticket_order` already refuses any sale against a showing whose film, event or performance is not ticketed here;
- the public showing page, event drawer and home feed already render such a show with its RSVP link, or with no ticket link for info-only.

So the follow-up:

- **Showing form:** every event and performance is choosable. RSVP and info-only ones use the "not sold here" mode films already had: no price, tiers, passes or Square item, tiers cleared on save, and the notice worded per kind ("RSVP", "Change that on the event itself"). The #351 greying and the edit-path guard are gone. An existing show whose event is switched to RSVP has its tiers retired on its next save, as a film's already were.
- **Live Events cards:** the "Add show" button no longer hides for RSVP and info-only events (`AdminDashboard.tsx`, the same old rule).
- **Box office POS:** a show that cannot be sold at the counter is **listed, greyed out and not selectable**, with a short label on the row ("RSVP", "External", "Info only") and the full reason as a tooltip (Tom's call). The label is there because a tooltip never appears on a touchscreen; the reason is also read to screen readers. The reason comes from `counterRefusal()` in `src/lib/purchasable.ts`, which is the same test as `ticketsSoldHere`. The list also now names event and performance shows; it used to read "Unknown" because it fetched only the film title.
- `SearchableSelect` supports `disabledReason` again, now as a tooltip. Disabled rows cancel cmdk's `opacity-50` (AA) and `pointer-events-none` (without which the tooltip never opens), and carry their own `TooltipProvider`.
