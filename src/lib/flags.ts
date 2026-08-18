/**
 * Build-time capability flags.
 *
 * `MEMBER_ACCOUNTS_ENABLED` is the one switch that decides whether patrons have
 * accounts at all. It is **off**, and everything it gates is still here: the
 * signup form, the account nav, the patron pages, the DVD reserve path, the
 * set-password email. None of it was deleted, because the Kenworthy expects to
 * launch a membership programme and turn it all back on.
 *
 * What it does NOT gate — deliberately — is the data model. `findOrCreateBuyer`
 * still mints an auth user and a profile for every buyer during checkout, and
 * tickets and film passes still hang off that profile. There is simply no
 * patron session to read any of it with. Flip this on and the rows are already
 * there waiting; flip it off and they accumulate invisibly. That asymmetry is
 * the whole point of turning the feature off rather than removing it.
 *
 * Staff, admin, superadmin and host auth are untouched by this flag. `/auth`
 * stays live either way — it is the staff door.
 *
 * Server-side counterpart: the `MEMBER_ACCOUNTS` secret, read by
 * `supabase/functions/_shared/flags.ts`. The two must be set together; the
 * client flag hides the signup UI, the server flag stops the email that tells
 * people to go use it.
 *
 * There is a third switch that lives in neither place: Supabase Auth's "Allow
 * new users to sign up", turned off by hand in both projects. That one is belt
 * and braces — `createUser` on the admin API bypasses it, so guest checkout is
 * unaffected, but a hand-rolled `auth.signUp` from a console is refused.
 */
export const MEMBER_ACCOUNTS_ENABLED =
  import.meta.env.VITE_MEMBER_ACCOUNTS === 'true';

/**
 * Whether the concessions admin writes changes back to the Square catalog.
 *
 * **Off**, and as with member accounts nothing is deleted: `pushToSquare`, the
 * Square arm of delete, and the edge function's `push_item` / `delete_item` are
 * all still there. Admins editing an item so the register picks it up is a real
 * phase-2 feature; it just needs an architecture first.
 *
 * What it does NOT gate is the pull. The website's concessions menu is
 * display-only and Square is the source of truth, so reading from Square is the
 * whole job today — the menu follows the register, not the other way round.
 *
 * Why it is off rather than merely unused: on 2026-08-14 the push destroyed 906
 * live catalog objects, because it rebuilt each Square item from our four
 * columns and Square's upsert replaces rather than merges. That fault is fixed,
 * but a direction with no current purpose should not stay open.
 *
 * Server-side counterpart: the `CONCESSION_SQUARE_PUSH` secret, read by
 * `supabase/functions/_shared/flags.ts`. The client flag hides the affordance;
 * the server flag is what actually refuses, so a stale bundle cannot write.
 */
export const CONCESSION_SQUARE_PUSH_ENABLED =
  import.meta.env.VITE_CONCESSION_SQUARE_PUSH === 'true';

/**
 * Whether the Concessions tab appears in the staff POS.
 *
 * **Off.** Concessions are rung up on the theatre's own Square register, so this
 * tab was never part of the workflow — but it looked exactly like one that was.
 * `ConcessionPOS.handleSell` writes `concession_sales` and `concession_sale_items`
 * and toasts "Concession sale — $12.50 (card)". It never contacts Square on any
 * path, so a card sale reports success without charging a card.
 *
 * Nothing was lost to it: `concession_sales` has zero rows, so nobody ever used
 * it. Hidden deliberately rather than left to be discovered by a staff member on
 * a busy night.
 *
 * As with member accounts, the code stays — the component, its tab, and the
 * tables behind it are untouched. Finishing it means taking payment through
 * Square (a terminal charge for card, a cash tender for cash) and giving
 * `concession_sales` somewhere to record the payment id, which it currently has
 * no column for. Turn this on once that exists.
 */
export const CONCESSION_POS_ENABLED =
  import.meta.env.VITE_CONCESSION_POS === 'true';

/**
 * Whether the Color Lab — the live, session-only theme override — is reachable.
 *
 * **On**, and it is the one flag here that defaults on rather than off. That is
 * deliberate: it is a temporary tool for a decision in flight (which purple,
 * which green), the `.env.*` files are gitignored so a default of `=== 'true'`
 * would silently switch it off in whichever environment forgot the line, and its
 * blast radius is a single tab's `sessionStorage`. Set `VITE_COLOR_LAB=false` to
 * shut it; the code stays for the next round of colour work.
 *
 * There is no server-side counterpart, and there should never be one. The Lab
 * never writes to the DB, never sends a request, and cannot be seen by another
 * visitor — see `src/lib/colorLab.ts`.
 *
 * When it is off the footer shows only the ordinary "Staff login" link to
 * logged-out viewers, and the trigger on the sign-in card is inert.
 */
export const COLOR_LAB_ENABLED = import.meta.env.VITE_COLOR_LAB !== 'false';

/**
 * Whether any purchase form asks the buyer for a phone number.
 *
 * **On.** It was off for three days, and that was never a product decision —
 * it was a delivery fact. Tickets go out by email (Resend) or SMS (Twilio),
 * the ticket-checkout server rule is "email or phone", and Twilio was not
 * wired up. A buyer who gave us only a number paid and received nothing at
 * all: no email, and an SMS that did not exist. Silent, and invisible from our
 * side, because nothing errored — delivery is fire-and-forget, so the failure
 * only ever landed in `orders.confirmation_error`.
 *
 * Asking is safe again because it no longer implies anything about delivery.
 * That is the whole reason this is now two flags rather than one: the original
 * conflated "show the field" with "a phone number is a contact we can deliver
 * to", and those come back at different times. See `SMS_DELIVERY_LIVE` below
 * for the second half.
 *
 * Deliberately a literal rather than a `VITE_` env var: flipping it is one
 * line in one file, reviewed like any other change, rather than a variable to
 * remember to set in `.env.staging`, `.env.production` and the Worker.
 *
 * What it does NOT gate is the plumbing. Both checkout forms always sent a
 * `phone` key, both edge functions always accepted it, and the server rule
 * stayed lenient at "email or phone" — so nothing downstream changes in either
 * direction.
 *
 * It also does not promise a text everywhere it shows a field. Only ticket
 * checkout delivers by SMS, and only there is there a consent checkbox — the
 * A2P 10DLC opt-in, unchecked by default, carrying all four disclosures the
 * campaign review requires (what we send, how often, that rates apply, STOP
 * and HELP). Film passes confirm by email and the box office does not dispatch
 * a confirmation at all, so those two ask for a number as a way to reach
 * someone, and say so rather than implying a text that is not coming.
 *
 * Note what the checkbox does *not* do: it is not a condition of purchase.
 * Twilio's first review rejected this campaign partly for looking like one, and
 * a checkout that cannot be completed without agreeing to texts is a genuine
 * violation, not a formatting quibble. Nothing on the form may ever be gated on
 * it.
 */
export const COLLECT_PHONE = true;

/**
 * Whether a phone number on its own is a contact we can actually deliver to.
 *
 * **Off**, and this is the flag that carries the delivery fact `COLLECT_PHONE`
 * used to carry alone. Ticket checkout's server rule is "email or phone". When
 * this is on, the form matches it and a buyer may give a number and nothing
 * else. When it is off, email is required — the number is still collected, the
 * disclosure is still shown, but nobody can complete a purchase whose only
 * contact is one we cannot reach.
 *
 * It is off because of A2P 10DLC, not because of our code. `sendViaTwilio` has
 * been complete since 2026-08-12. What is missing is a registered *campaign*:
 * US carriers reject unregistered long-code traffic outright with error 30034,
 * so every send fails no matter how the credentials are set. Brand approval is
 * not campaign approval, and the two were conflated when this work was scoped.
 *
 * Turning it on takes all of the following, and the last one is the slow one:
 *   1. `TWILIO_ACCOUNT_SID` set on the deployed functions.
 *   2. A credential — `TWILIO_API_KEY_SID` + `TWILIO_API_KEY_SECRET`, or
 *      `TWILIO_AUTH_TOKEN`. Names matter literally: `TWILIO_API_KEY` is not
 *      `TWILIO_API_KEY_SID`, and that mismatch reads as no credential at all.
 *   3. A sender — `TWILIO_MESSAGING_SERVICE_SID` (preferred; it answers STOP
 *      and HELP for us, which the consent copy promises) or
 *      `TWILIO_FROM_NUMBER`.
 *   4. An approved A2P 10DLC campaign attached to that Messaging Service, with
 *      the sending number in its pool.
 *
 * Verify with a phone-only test purchase before flipping it, not after. If
 * Twilio is ever suspended or the campaign lapses, this goes back `false` in
 * the same breath — otherwise a buyer pays and is sent nothing, silently,
 * because delivery is fire-and-forget and the only trace is
 * `orders.confirmation_error`.
 */
export const SMS_DELIVERY_LIVE = false;
