import { RATE_BANDS, RATE_DAYS, rateFor, formatRate, isWeekendRateDay } from '@/lib/rentalRates';

/**
 * The base-rate grid: time band down, day of week across.
 *
 * Rendered twice, because a 4×7 table of prices does not survive a 375px
 * screen — the columns crush to unreadable slivers long before they run out of
 * room. Desktop gets the real table; mobile gets one card per band, and since
 * only the After 3 PM band varies by day, the other three collapse to a single
 * line rather than repeating the same price seven times.
 *
 * Both views are generated from the same `RATE_BANDS`, so they cannot disagree.
 */
export function RateGrid() {
  return (
    <>
      {/* Desktop — the grid as published. Scrolls rather than crushing if the
          container is narrower than the table's own minimum. */}
      <div className="hidden md:block overflow-x-auto">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">
            Base hourly rental rates by time of day and day of the week
          </caption>
          <thead>
            <tr className="border-b border-accent/30">
              <th scope="col" className="text-left py-3 pr-4 font-display uppercase tracking-[0.15em] text-xs text-accent">
                Time
              </th>
              {RATE_DAYS.map(day => (
                <th
                  key={day.index}
                  scope="col"
                  className="text-left py-3 px-2 font-display uppercase tracking-[0.15em] text-xs text-accent"
                >
                  <abbr title={day.long} className="no-underline">{day.short}</abbr>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RATE_BANDS.map(band => (
              <tr key={band.key} className="border-b border-accent/15 last:border-0">
                <th
                  scope="row"
                  className="text-left py-3 pr-4 font-serif text-foreground whitespace-nowrap font-normal"
                >
                  {band.label}
                </th>
                {RATE_DAYS.map(day => {
                  const rate = rateFor(band, day.index);
                  // The one cell in the grid that differs from its row is worth
                  // making visible rather than leaving the reader to compare
                  // twenty-eight numbers.
                  const isVariant = band.key === 'after_3' && isWeekendRateDay(day.index);
                  return (
                    <td key={day.index} className="py-3 px-2 align-top">
                      <span className={`font-display block ${isVariant ? 'text-primary' : 'text-foreground'}`}>
                        ${rate.hourly}/hr
                      </span>
                      <span className="text-xs text-muted-foreground font-serif">
                        min {rate.minimumHours} hr
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile — one card per band. */}
      <div className="md:hidden space-y-3">
        {RATE_BANDS.map(band => {
          const weekday = band.monWed;
          const weekend = band.thuSun;
          const uniform = weekday.hourly === weekend.hourly && weekday.minimumHours === weekend.minimumHours;
          return (
            <div key={band.key} className="border border-accent/20 rounded-lg p-4 bg-background/60">
              <p className="font-display uppercase tracking-[0.15em] text-sm text-accent">{band.label}</p>
              {uniform ? (
                <p className="font-serif text-foreground mt-2">
                  <span className="font-display text-lg text-foreground">${weekday.hourly}/hr</span>
                  <span className="text-muted-foreground"> · {weekday.minimumHours} hr minimum · every day</span>
                </p>
              ) : (
                <dl className="mt-2 space-y-1">
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="font-serif text-muted-foreground">Mon–Wed</dt>
                    <dd className="font-serif text-foreground">
                      <span className="font-display">${weekday.hourly}/hr</span>
                      <span className="text-muted-foreground text-xs"> · min {weekday.minimumHours} hr</span>
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="font-serif text-muted-foreground">Thu–Sun</dt>
                    <dd className="font-serif text-primary">
                      <span className="font-display">${weekend.hourly}/hr</span>
                      <span className="text-muted-foreground text-xs"> · min {weekend.minimumHours} hr</span>
                    </dd>
                  </div>
                </dl>
              )}
            </div>
          );
        })}
      </div>
    </>
  );
}

export { formatRate };
