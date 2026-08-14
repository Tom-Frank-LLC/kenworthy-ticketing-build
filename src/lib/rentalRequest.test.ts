import { describe, expect, it } from 'vitest';
import { rentalRequestSchema } from './rentalRequest';

/**
 * The public form is the only way most rentals enter the system, and whatever
 * it accepts flows straight onto the licence agreement and the Square invoice.
 * A backwards date range there prints as "August 16 through August 14" on a
 * document someone signs.
 *
 * The database carries the same rule as a CHECK constraint
 * (supabase/migrations/20260814030000_rental_multiday_dates.sql). These tests
 * are the half that gives the submitter a sentence they can act on instead of
 * a constraint violation.
 */
const base = {
  event_title: 'Palouse Film Festival',
  applicant_name: 'Jordan Goins',
  email: 'jordan@example.com',
  proposed_date: '',
  end_date: '',
};

function check(over: Partial<typeof base>) {
  return rentalRequestSchema.safeParse({ ...base, ...over });
}

describe('rental request dates', () => {
  it('accepts a single day, with no end date at all', () => {
    expect(check({ proposed_date: '2026-08-14' }).success).toBe(true);
  });

  it('accepts no dates — staff often set them during follow-up', () => {
    expect(check({}).success).toBe(true);
  });

  it('accepts a multi-day range', () => {
    expect(check({ proposed_date: '2026-08-14', end_date: '2026-08-16' }).success).toBe(true);
  });

  it('accepts an end equal to the start', () => {
    // Submitted as a one-day booking; the page stores it as no end date.
    expect(check({ proposed_date: '2026-08-14', end_date: '2026-08-14' }).success).toBe(true);
  });

  it('refuses an end before the start', () => {
    const result = check({ proposed_date: '2026-08-16', end_date: '2026-08-14' });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0]?.message).toBe(
      'The last day of your event cannot be before the first',
    );
  });

  it('refuses a last day with no first day', () => {
    const result = check({ end_date: '2026-08-16' });
    expect(result.success).toBe(false);
    expect(result.error?.errors[0]?.message).toBe(
      'Add the first day of your event before the last day',
    );
  });

  it('still requires the fields it always required', () => {
    expect(check({ email: 'not-an-email' }).success).toBe(false);
    expect(check({ event_title: '  ' }).success).toBe(false);
  });
});
