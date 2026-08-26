import { describe, it, expect } from 'vitest';
import { marqueeBookingSchema, marqueeTitle, toRentalRequestPayload } from './marqueeBooking';

const valid = {
  applicant_name: 'Jean Rivers',
  email: 'jean@example.com',
  phone: '208-555-0100',
  marquee_text: 'HAPPY 90TH GRANDMA JEAN',
  proposed_date: '2026-09-10',
  end_date: '',
};

describe('marqueeBookingSchema', () => {
  it('accepts the five fields the form asks for', () => {
    expect(marqueeBookingSchema.safeParse(valid).success).toBe(true);
  });

  it('accepts a booking with no phone number', () => {
    expect(marqueeBookingSchema.safeParse({ ...valid, phone: '' }).success).toBe(true);
  });

  it('requires a name, an address, a message and a date', () => {
    for (const field of ['applicant_name', 'marquee_text', 'proposed_date'] as const) {
      const result = marqueeBookingSchema.safeParse({ ...valid, [field]: '' });
      expect(result.success, `${field} should be required`).toBe(false);
    }
    expect(marqueeBookingSchema.safeParse({ ...valid, email: 'not-an-address' }).success).toBe(false);
  });

  it('refuses a run that ends before it starts', () => {
    const result = marqueeBookingSchema.safeParse({ ...valid, end_date: '2026-09-09' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.errors[0].path).toEqual(['end_date']);
    }
  });

  it('allows an end date equal to the start', () => {
    expect(marqueeBookingSchema.safeParse({ ...valid, end_date: '2026-09-10' }).success).toBe(true);
  });

  it('refuses a message longer than the edge function will accept', () => {
    // The cap has to stay at or under the function's own marquee_text limit,
    // or the form sends something the server answers with a 400.
    expect(marqueeBookingSchema.safeParse({ ...valid, marquee_text: 'A'.repeat(301) }).success).toBe(false);
    expect(marqueeBookingSchema.safeParse({ ...valid, marquee_text: 'A'.repeat(300) }).success).toBe(true);
  });
});

describe('marqueeTitle', () => {
  it('quotes the message so the admin queue is scannable', () => {
    expect(marqueeTitle('HAPPY 90TH GRANDMA JEAN')).toBe('Marquee: “HAPPY 90TH GRANDMA JEAN”');
  });

  it('stays inside the event_title cap the function enforces', () => {
    const title = marqueeTitle('A'.repeat(300));
    expect(title.length).toBeLessThanOrEqual(200);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('toRentalRequestPayload', () => {
  it('supplies the three columns the table requires', () => {
    // event_title, applicant_name and email are NOT NULL, and the edge
    // function 400s without them. A marquee message has no event name, so the
    // title is synthesised.
    const payload = toRentalRequestPayload(marqueeBookingSchema.parse(valid), 'token-123');
    expect(payload.event_title).toBeTruthy();
    expect(payload.applicant_name).toBe('Jean Rivers');
    expect(payload.email).toBe('jean@example.com');
  });

  it('tags the row so it is recognisable in the rental queue', () => {
    const payload = toRentalRequestPayload(marqueeBookingSchema.parse(valid), null);
    expect(payload.venue_area).toBe('marquee');
    expect(payload.marquee_text).toBe('HAPPY 90TH GRANDMA JEAN');
  });

  it('never marks a marquee message as a public event', () => {
    // is_public is what get_public_availability keys the title projection on.
    // True here would publish the message on the availability calendar.
    const payload = toRentalRequestPayload(marqueeBookingSchema.parse(valid), null);
    expect(payload.is_public).toBe(false);
  });

  it('carries the bot-check token through', () => {
    expect(toRentalRequestPayload(marqueeBookingSchema.parse(valid), 'abc').turnstile_token).toBe('abc');
    expect(toRentalRequestPayload(marqueeBookingSchema.parse(valid), null).turnstile_token).toBeNull();
  });

  it('stores a single day as no end date at all', () => {
    // The same convention the full rental form uses: "has an end date" means
    // "runs longer than one day" everywhere downstream, including the
    // availability function's single-day-only hour publishing.
    expect(toRentalRequestPayload(marqueeBookingSchema.parse(valid), null).end_date).toBeNull();
    expect(
      toRentalRequestPayload(marqueeBookingSchema.parse({ ...valid, end_date: '2026-09-10' }), null).end_date,
    ).toBeNull();
    expect(
      toRentalRequestPayload(marqueeBookingSchema.parse({ ...valid, end_date: '2026-09-12' }), null).end_date,
    ).toBe('2026-09-12');
  });

  it('sends null rather than an empty string for an omitted phone', () => {
    const payload = toRentalRequestPayload(marqueeBookingSchema.parse({ ...valid, phone: '' }), null);
    expect(payload.phone).toBeNull();
  });

  it('does not send a status a submitter should not choose', () => {
    // The function sets status and contract_status itself. Sending them from
    // the browser would be ignored by the allowlist, but not sending them is
    // the honest shape.
    const payload = toRentalRequestPayload(marqueeBookingSchema.parse(valid), null);
    expect(payload).not.toHaveProperty('status');
    expect(payload).not.toHaveProperty('admin_notes');
  });
});
