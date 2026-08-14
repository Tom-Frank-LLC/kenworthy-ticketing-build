import { z } from 'zod';

/**
 * What the public rental form will accept.
 *
 * It lives here rather than inside the page so the rules can be tested without
 * booting a Supabase client, and so the date rule sits next to the other
 * date handling in src/lib.
 *
 * A booking that runs several days is a start and an end. Both orderings of a
 * slip — an end with no start, an end before the start — reach the licence
 * agreement as nonsense if they get through, so they are refused here with a
 * sentence the submitter can act on. The database carries the same rule as a
 * CHECK constraint (supabase/migrations/20260814030000_rental_multiday_dates.sql),
 * which is what covers an admin editing a row directly.
 */
export const rentalRequestSchema = z
  .object({
    event_title: z.string().trim().min(1, 'Required').max(200),
    applicant_name: z.string().trim().min(1, 'Required').max(120),
    email: z.string().trim().email('Invalid email').max(255),
    proposed_date: z.string(),
    end_date: z.string(),
  })
  .refine(v => !v.end_date || !!v.proposed_date, {
    message: 'Add the first day of your event before the last day',
  })
  .refine(v => !v.end_date || !v.proposed_date || v.end_date >= v.proposed_date, {
    message: 'The last day of your event cannot be before the first',
  });
