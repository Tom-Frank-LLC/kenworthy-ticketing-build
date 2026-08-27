import { z } from 'zod';

/**
 * The marquee booking form — a five-field front door onto the rental queue.
 *
 * /rentals used to offer `mailto:events@kenworthy.org?subject=Marquee rental`
 * for this. That is not a booking channel: it lands in an inbox rather than the
 * queue staff actually work, it carries whatever the sender thought to include,
 * and on a phone without a configured mail client it does nothing at all.
 *
 * So it becomes a real form — but deliberately *not* a new pipeline. It posts
 * the same payload shape to the same `rental-request` edge function as the full
 * rental form, which means it inherits the Turnstile check, the column
 * allowlist and the free-text caps without any of them being re-implemented
 * here, and the row lands in the same admin Rental Requests listing.
 *
 * No change to that function was needed: `marquee_text`, `venue_area`, `phone`
 * and both date fields are already on its allowlist. The three columns it
 * requires — `event_title`, `applicant_name`, `email` — are all supplied below,
 * with `event_title` synthesised because a marquee message has no event name
 * and the column is NOT NULL.
 *
 * This is a request, not a booking. Nothing here reserves a date or takes
 * payment; the wording on the page has to keep saying so.
 */
export const marqueeBookingSchema = z
  .object({
    applicant_name: z.string().trim().min(1, 'Please tell us your name').max(120),
    email: z.string().trim().email('That email address does not look right').max(255),
    phone: z.string().trim().max(40).optional().or(z.literal('')),
    marquee_text: z
      .string()
      .trim()
      .min(1, 'Tell us what the marquee should say')
      // The physical sign holds far less than this. The cap is here to keep a
      // single submission from posting an essay into a table staff read by
      // hand; what will actually fit is settled when they follow up, because
      // it depends on the letter set on hand.
      .max(300, 'That message is too long for the sign — please shorten it'),
    proposed_date: z.string().min(1, 'Pick the day you would like it up'),
    end_date: z.string().optional().or(z.literal('')),
  })
  .refine(v => !v.end_date || v.end_date >= v.proposed_date, {
    message: 'The last day cannot be before the first',
    path: ['end_date'],
  });

export type MarqueeBooking = z.infer<typeof marqueeBookingSchema>;

/** Cap for `event_title` in the edge function's allowlist. */
const TITLE_MAX = 200;

/**
 * The title staff see in the queue.
 *
 * A marquee request has no event, so something has to fill the NOT NULL column.
 * Quoting the message itself makes the listing scannable — a row reading
 * `Marquee: "HAPPY 90TH GRANDMA JEAN"` needs no opening — where a constant
 * `Marquee request` would make every such row identical.
 */
export function marqueeTitle(marqueeText: string): string {
  const quoted = `Marquee: “${marqueeText.trim()}”`;
  return quoted.length <= TITLE_MAX ? quoted : `${quoted.slice(0, TITLE_MAX - 1)}…`;
}

/**
 * Build the `rental-request` payload.
 *
 * Kept apart from the component so the mapping can be asserted in a test
 * without rendering anything — in particular that `is_public` is false, which
 * is what keeps a marquee message out of the public availability read
 * (`get_public_availability` only ever projects a title for a public booking).
 */
export function toRentalRequestPayload(
  input: MarqueeBooking,
  turnstileToken: string | null,
): Record<string, unknown> {
  const endDate = input.end_date && input.end_date !== input.proposed_date ? input.end_date : null;

  return {
    event_title: marqueeTitle(input.marquee_text),
    applicant_name: input.applicant_name.trim(),
    email: input.email.trim(),
    phone: input.phone?.trim() || null,
    marquee_text: input.marquee_text.trim(),
    proposed_date: input.proposed_date,
    end_date: endDate,
    // Tags the row for the admin queue, and reuses the column the full rental
    // form already fills with a room name.
    venue_area: 'marquee',
    // A message on a sign is not a public event on the calendar. False here
    // keeps the text out of `get_public_availability`'s title projection.
    is_public: false,
    turnstile_token: turnstileToken,
  };
}
