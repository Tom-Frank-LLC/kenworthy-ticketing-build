import { CalendarDays, Lock } from 'lucide-react';
import type { DayView as DayViewModel, HourStatus } from '@/lib/rentalAvailability';
import { HOUR_STATUS_LABEL } from '@/lib/rentalAvailability';

/**
 * The hour-by-hour pane beside the calendar.
 *
 * It replaces a "Next on the calendar" list that answered a question nobody
 * asked — the next twelve things happening, mostly holidays — while the
 * question a would-be renter actually has is "can I have the theatre on the
 * 14th, and from when?".
 *
 * Three row states, not two. `unknown` exists because some bookings genuinely
 * do not tell us their hours (see src/lib/rentalAvailability.ts): a multi-day hold, or
 * a time the renter left blank. Painting those hours free would let someone
 * request a slot that is taken; painting them booked would turn away a rental
 * that was available. Saying "Check with us" is the only one of the three that
 * is true.
 */

const ROW_STYLES: Record<HourStatus, { dot: string; text: string }> = {
  available: { dot: 'bg-primary/70', text: 'text-foreground' },
  unavailable: { dot: 'bg-muted-foreground/50', text: 'text-muted-foreground' },
  unknown: { dot: 'bg-accent/70', text: 'text-muted-foreground' },
};

export function DayView({ day, dateLabel }: { day: DayViewModel | null; dateLabel: string | null }) {
  if (!day) {
    return (
      <div className="border border-accent/20 rounded-lg bg-card/40 p-8 text-center">
        <CalendarDays className="h-8 w-8 text-primary/60 mx-auto mb-3" />
        <p className="font-serif text-muted-foreground">
          Pick a day on the calendar to see which hours are open.
        </p>
      </div>
    );
  }

  return (
    <div className="border border-accent/20 rounded-lg bg-card/40 overflow-hidden">
      <div className="px-4 py-3 border-b border-accent/20">
        <h3 className="font-display uppercase text-lg leading-tight">{dateLabel}</h3>
        {day.blackoutLabel ? (
          <p className="font-serif text-sm text-muted-foreground mt-1">
            Closed — {day.blackoutLabel}.
          </p>
        ) : day.untimed.length > 0 ? (
          <p className="font-serif text-sm text-muted-foreground mt-1 flex items-start gap-1.5">
            <Lock className="h-3.5 w-3.5 mt-0.5 shrink-0 text-accent" />
            <span>
              A booking holds part of this day but its hours aren't published. Send a request and
              we'll tell you exactly what's free.
            </span>
          </p>
        ) : day.status === 'available' ? (
          <p className="font-serif text-sm text-muted-foreground mt-1">Wide open — every hour is free.</p>
        ) : (
          <p className="font-serif text-sm text-muted-foreground mt-1">
            Some hours are taken; the rest are yours to book.
          </p>
        )}
      </div>

      {/* A real table: each row is an hour and a status, which is exactly what
          a row/column reader expects here. */}
      <table className="w-full text-sm">
        <caption className="sr-only">
          Hour-by-hour availability for {dateLabel}
        </caption>
        <thead className="sr-only">
          <tr>
            <th scope="col">Hour</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-accent/15">
          {day.rows.map(row => {
            const style = ROW_STYLES[row.status];
            return (
              <tr key={row.hour}>
                <th
                  scope="row"
                  className="text-left px-4 py-2 font-display uppercase tracking-[0.15em] text-xs text-muted-foreground whitespace-nowrap w-28 font-normal"
                >
                  {row.label}
                </th>
                <td className={`px-4 py-2 font-serif ${style.text}`}>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className={`inline-block w-2 h-2 rounded-full shrink-0 ${style.dot}`} />
                    <span>{HOUR_STATUS_LABEL[row.status]}</span>
                    {row.detail && (
                      <span className="text-muted-foreground truncate">— {row.detail}</span>
                    )}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
