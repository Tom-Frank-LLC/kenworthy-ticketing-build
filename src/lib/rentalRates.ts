/**
 * The published base-rate grid, from kenworthy.org/rentals.
 *
 * It replaces a flat list of four room prices ($400 half day, $700 full day…)
 * that had drifted out of agreement with the official page. The real structure
 * is hourly, and it is a time band × day-of-week grid.
 *
 * Almost all of that grid is uniform. Only **After 3 PM** varies by day, and it
 * varies once: Monday–Wednesday is the weekday rate, Thursday–Sunday is the
 * weekend rate. Every other band is one price across all seven days. So the
 * bands carry two rates each rather than the table carrying twenty-eight cells
 * — the regularity is the thing worth encoding, because it is what a reader has
 * to see to understand the pricing at a glance.
 *
 * ---------------------------------------------------------------------------
 * After 9 PM is an hourly override, not a booking-level one
 * ---------------------------------------------------------------------------
 *
 * The late band is $100/hr on every day, and it applies to *the hours* past
 * 9 PM rather than to a booking that happens to start late. A Saturday 7–11 PM
 * therefore bills two hours at the $180 evening rate and two at $100 — it does
 * not become a $100/hr booking because it runs late, and it does not stay at
 * $180 for the whole run. That is why `After 3 PM` ends at 21:00 here: the two
 * bands tile the evening rather than overlapping it, and `quoteHours` below is
 * the same rule in executable form.
 */

export type Rate = { hourly: number; minimumHours: number };

export type RateBand = {
  key: string;
  label: string;
  /** Half-open hour range on a 24-hour clock: [fromHour, toHour). */
  fromHour: number;
  toHour: number;
  /** Monday–Wednesday. */
  monWed: Rate;
  /** Thursday–Sunday. */
  thuSun: Rate;
};

const STANDARD: Rate = { hourly: 100, minimumHours: 3 };
const MIDDAY: Rate = { hourly: 120, minimumHours: 3 };
const EVENING_WEEKEND: Rate = { hourly: 180, minimumHours: 4 };

export const RATE_BANDS: RateBand[] = [
  { key: 'before_12', label: 'Before 12 PM', fromHour: 0, toHour: 12, monWed: STANDARD, thuSun: STANDARD },
  { key: 'noon_to_3', label: '12–3 PM', fromHour: 12, toHour: 15, monWed: MIDDAY, thuSun: MIDDAY },
  { key: 'after_3', label: 'After 3 PM', fromHour: 15, toHour: 21, monWed: MIDDAY, thuSun: EVENING_WEEKEND },
  { key: 'after_9', label: 'After 9 PM', fromHour: 21, toHour: 24, monWed: STANDARD, thuSun: STANDARD },
];

/** Day-of-week indexes as JavaScript numbers them: 0 = Sunday. */
export const RATE_DAYS = [
  { index: 1, short: 'Mon', long: 'Monday' },
  { index: 2, short: 'Tue', long: 'Tuesday' },
  { index: 3, short: 'Wed', long: 'Wednesday' },
  { index: 4, short: 'Thu', long: 'Thursday' },
  { index: 5, short: 'Fri', long: 'Friday' },
  { index: 6, short: 'Sat', long: 'Saturday' },
  { index: 0, short: 'Sun', long: 'Sunday' },
] as const;

/** Thursday through Sunday carry the weekend evening rate. */
export function isWeekendRateDay(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek >= 4;
}

export function rateFor(band: RateBand, dayOfWeek: number): Rate {
  return isWeekendRateDay(dayOfWeek) ? band.thuSun : band.monWed;
}

/** The band covering a given hour, or undefined outside 0–23. */
export function bandForHour(hour: number): RateBand | undefined {
  return RATE_BANDS.find(b => hour >= b.fromHour && hour < b.toHour);
}

export type QuoteLine = { band: RateBand; hours: number; hourly: number; subtotal: number };

export type Quote = {
  lines: QuoteLine[];
  hours: number;
  /** Straight hourly cost, before the minimum is applied. */
  subtotal: number;
  /** The largest minimum among the bands touched. */
  minimumHours: number;
  /** True when the booking is shorter than that minimum. */
  belowMinimum: boolean;
};

/**
 * Price a booking hour by hour.
 *
 * Exists so the After-9 rule above is stated once, in code that can be tested,
 * rather than only in prose on the page that a later edit could contradict.
 * It is an estimate of the base rate: fees, discounts and the minimum-hours
 * charge are settled on the contract.
 */
export function quoteHours(dayOfWeek: number, startHour: number, endHour: number): Quote {
  const lines: QuoteLine[] = [];
  let subtotal = 0;
  let minimumHours = 0;

  for (let hour = startHour; hour < endHour; hour++) {
    const band = bandForHour(hour);
    if (!band) continue;
    const rate = rateFor(band, dayOfWeek);
    subtotal += rate.hourly;
    minimumHours = Math.max(minimumHours, rate.minimumHours);

    const existing = lines.find(l => l.band.key === band.key);
    if (existing) {
      existing.hours += 1;
      existing.subtotal += rate.hourly;
    } else {
      lines.push({ band, hours: 1, hourly: rate.hourly, subtotal: rate.hourly });
    }
  }

  const hours = Math.max(0, endHour - startHour);
  return { lines, hours, subtotal, minimumHours, belowMinimum: hours > 0 && hours < minimumHours };
}

/** `"$120/hr · 3 hr minimum"` — one cell of the grid. */
export function formatRate(rate: Rate): string {
  return `$${rate.hourly}/hr · ${rate.minimumHours} hr minimum`;
}

/** Priced on its own terms, not by the hour — so it sits outside the grid. */
export const MARQUEE_RATE = {
  price: 150,
  label: 'Historic marquee — one side, one day',
  note: 'Market days and holidays carry a small surcharge.',
};
