import { describe, it, expect } from 'vitest';
import {
  RATE_BANDS,
  RATE_DAYS,
  rateFor,
  bandForHour,
  quoteHours,
  formatRate,
  isWeekendRateDay,
} from './rentalRates';

/**
 * The published grid, transcribed from kenworthy.org/rentals, as
 * `[hourly, minimumHours]` per band per day.
 *
 * Written out longhand on purpose. `rentalRates.ts` encodes the *regularity*
 * of the grid — two rates per band rather than twenty-eight cells — which is
 * right for reading and wrong for checking, because a test that re-derives the
 * table the same way the source does cannot catch the source being wrong. This
 * is the table as a human reads it off the page.
 */
const OFFICIAL: Record<string, Record<string, [number, number]>> = {
  before_12: { Mon: [100, 3], Tue: [100, 3], Wed: [100, 3], Thu: [100, 3], Fri: [100, 3], Sat: [100, 3], Sun: [100, 3] },
  noon_to_3: { Mon: [120, 3], Tue: [120, 3], Wed: [120, 3], Thu: [120, 3], Fri: [120, 3], Sat: [120, 3], Sun: [120, 3] },
  after_3:   { Mon: [120, 3], Tue: [120, 3], Wed: [120, 3], Thu: [180, 4], Fri: [180, 4], Sat: [180, 4], Sun: [180, 4] },
  after_9:   { Mon: [100, 3], Tue: [100, 3], Wed: [100, 3], Thu: [100, 3], Fri: [100, 3], Sat: [100, 3], Sun: [100, 3] },
};

describe('the published rate grid', () => {
  it('has the four bands, in the order they are published', () => {
    expect(RATE_BANDS.map(b => b.key)).toEqual(['before_12', 'noon_to_3', 'after_3', 'after_9']);
    expect(RATE_BANDS.map(b => b.label)).toEqual(['Before 12 PM', '12–3 PM', 'After 3 PM', 'After 9 PM']);
  });

  it('matches the official table cell for cell', () => {
    for (const band of RATE_BANDS) {
      for (const day of RATE_DAYS) {
        const [hourly, minimumHours] = OFFICIAL[band.key][day.short];
        const actual = rateFor(band, day.index);
        expect(actual.hourly, `${band.label} / ${day.short} rate`).toBe(hourly);
        expect(actual.minimumHours, `${band.label} / ${day.short} minimum`).toBe(minimumHours);
      }
    }
  });

  it('varies by day in exactly one band', () => {
    // If a second band ever starts differing Mon–Wed vs Thu–Sun, the mobile
    // view's "uniform" collapse is silently wrong and this catches it.
    const varying = RATE_BANDS.filter(
      b => b.monWed.hourly !== b.thuSun.hourly || b.monWed.minimumHours !== b.thuSun.minimumHours,
    );
    expect(varying.map(b => b.key)).toEqual(['after_3']);
  });

  it('treats Thursday through Sunday as the weekend rate', () => {
    expect([1, 2, 3].every(d => !isWeekendRateDay(d))).toBe(true);
    expect([4, 5, 6, 0].every(d => isWeekendRateDay(d))).toBe(true);
  });

  it('tiles the whole clock with no gap and no overlap', () => {
    // The bands are used to price individual hours, so a hole would silently
    // drop an hour from a quote and an overlap would double-count it.
    let cursor = 0;
    for (const band of RATE_BANDS) {
      expect(band.fromHour, `${band.label} starts where the previous band ended`).toBe(cursor);
      cursor = band.toHour;
    }
    expect(cursor).toBe(24);

    for (let hour = 0; hour < 24; hour++) {
      expect(bandForHour(hour), `hour ${hour}`).toBeDefined();
    }
    expect(bandForHour(24)).toBeUndefined();
    expect(bandForHour(-1)).toBeUndefined();
  });

  it('hands the 9 PM boundary to the late band', () => {
    expect(bandForHour(20)?.key).toBe('after_3');
    expect(bandForHour(21)?.key).toBe('after_9');
  });
});

describe('quoteHours — the After 9 PM rule', () => {
  const SATURDAY = 6;
  const MONDAY = 1;

  it('splits a Saturday evening at 9 PM rather than pricing it all one way', () => {
    // Tom's rule: the late rate applies to the hours past 9, not to the
    // booking. 7–11 PM is two hours at $180 and two at $100.
    const quote = quoteHours(SATURDAY, 19, 23);

    expect(quote.hours).toBe(4);
    expect(quote.subtotal).toBe(180 * 2 + 100 * 2);
    expect(quote.lines.map(l => [l.band.key, l.hours, l.hourly])).toEqual([
      ['after_3', 2, 180],
      ['after_9', 2, 100],
    ]);
  });

  it('does not let a late start make the whole booking cheap', () => {
    // The failure this guards: reading After-9 as a booking-level band would
    // price 7–11 PM at 4 × $100.
    expect(quoteHours(SATURDAY, 19, 23).subtotal).not.toBe(400);
  });

  it('prices a booking wholly after 9 at the late rate', () => {
    const quote = quoteHours(SATURDAY, 21, 24);
    expect(quote.subtotal).toBe(300);
    expect(quote.lines).toHaveLength(1);
    expect(quote.lines[0].band.key).toBe('after_9');
  });

  it('charges Mon–Wed evenings the weekday rate', () => {
    expect(quoteHours(MONDAY, 19, 21).subtotal).toBe(120 * 2);
    expect(quoteHours(SATURDAY, 19, 21).subtotal).toBe(180 * 2);
  });

  it('crosses the noon and 3 PM boundaries correctly', () => {
    const quote = quoteHours(MONDAY, 10, 16);
    expect(quote.subtotal).toBe(100 * 2 + 120 * 3 + 120 * 1);
    expect(quote.lines.map(l => [l.band.key, l.hours])).toEqual([
      ['before_12', 2],
      ['noon_to_3', 3],
      ['after_3', 1],
    ]);
  });

  it('carries the largest minimum of the bands it touches', () => {
    // A Saturday 4–6 PM touches the 4-hour minimum even though it is 2 hours.
    const quote = quoteHours(SATURDAY, 16, 18);
    expect(quote.minimumHours).toBe(4);
    expect(quote.belowMinimum).toBe(true);

    const long = quoteHours(SATURDAY, 16, 20);
    expect(long.belowMinimum).toBe(false);
  });

  it('is empty rather than negative for a zero-length booking', () => {
    const quote = quoteHours(SATURDAY, 19, 19);
    expect(quote.hours).toBe(0);
    expect(quote.subtotal).toBe(0);
    expect(quote.belowMinimum).toBe(false);
  });
});

describe('formatRate', () => {
  it('reads the way the grid is published', () => {
    expect(formatRate({ hourly: 180, minimumHours: 4 })).toBe('$180/hr · 4 hr minimum');
  });
});
