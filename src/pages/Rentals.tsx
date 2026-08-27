import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Calendar } from '@/components/ui/calendar';
import { Button } from '@/components/ui/button';
import { SEO } from '@/components/SEO';
import { venueDayKey, formatShowtime } from '@/lib/datetime';
import { Building2, Mail, Sparkles, Tag, CalendarDays } from 'lucide-react';
import { RentalsHero } from '@/components/rentals/RentalsHero';
import { MarqueeBookingForm } from '@/components/rentals/MarqueeBookingForm';
import { RateGrid } from '@/components/rentals/RateGrid';
import { DayView } from '@/components/rentals/DayView';
import { MARQUEE_RATE } from '@/lib/rentalRates';
import {
  buildDayView,
  dayStatus,
  parseClockMinutes,
  DAY_STATUS_LABEL,
  type OccupiedBlock,
} from '@/lib/rentalAvailability';

const FEES = [
  { title: 'Additional staff', detail: '$30 / hour, per person. All rentals include 1 staff member; extra support is determined by Kenworthy management.' },
  { title: 'Additional cleaning', detail: '$100, assessed after the event if the theatre is soiled beyond normal standards.' },
  { title: 'Technician', detail: '$50 / hour for lighting, sound, or projection support.' },
  { title: 'Poster design & printing', detail: '$60 flat fee.' },
  { title: 'Additional hours', detail: '$50 / hour beyond your booked block.' },
  { title: 'Rehearsal rate', detail: '$30 / hour for renters who have already booked a performance.' },
];

const DISCOUNTS = [
  { title: 'Nonprofit', detail: '20% off the base rental. Must be state-registered with proof of standing. Some limitations apply.' },
  { title: 'Consecutive days', detail: '10% off the base rental for three or more consecutive days. Some limitations apply.' },
];

/** A showing with no recorded duration still occupies the room for an evening. */
const DEFAULT_SHOWING_MINUTES = 120;

// Annual black-out dates (holidays / staff dark days). A date that has already
// passed this year rolls forward to next year, so the calendar never paints a
// holiday from the past.
function makeBlackouts(): { date: string; label: string }[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const y = today.getFullYear();
  const raw: { md: string; label: string }[] = [
    { md: '12-24', label: 'Christmas Eve' },
    { md: '12-25', label: 'Christmas Day' },
    { md: '01-01', label: 'New Year’s Day' },
    { md: '07-04', label: 'Independence Day' },
    { md: '11-26', label: 'Thanksgiving' },
  ];
  return raw.map(({ md, label }) => {
    const thisYear = isoToLocalDate(`${y}-${md}`);
    const iso = thisYear < today ? `${y + 1}-${md}` : `${y}-${md}`;
    return { date: iso, label };
  });
}
const BLACKOUTS = makeBlackouts();

function isoToLocalDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** `yyyy-MM-dd` for a Date's *local* calendar fields. */
function localDayKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

type AvailabilityRow = {
  day: string;
  start_time: string | null;
  end_time: string | null;
  is_public: boolean;
  title: string | null;
};

export default function Rentals() {
  const [blocks, setBlocks] = useState<OccupiedBlock[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Date | undefined>(() => {
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return d;
  });

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const horizon = new Date(today);
      horizon.setMonth(horizon.getMonth() + 12);

      const [showingsResult, rentalsResult] = await Promise.all([
        supabase
          .from('showings')
          .select('id, start_time, duration_minutes, movie:movies(title), event:events(title), live_performance:live_performances(title)')
          .gte('start_time', today.toISOString())
          .lt('start_time', horizon.toISOString())
          .eq('is_active', true),
        // Rentals cannot be read from the table: `anon` holds no SELECT on
        // rental_requests and must not be given one. This function returns the
        // occupied hours with everything identifying already stripped — the
        // redaction lives in the database, not here. See
        // supabase/migrations/20260826151843_public_rental_availability.sql.
        supabase.rpc('get_public_availability', {
          p_from: localDayKey(today),
          p_to: localDayKey(horizon),
        }),
      ]);

      if (cancelled) return;

      const next: OccupiedBlock[] = [];

      for (const showing of showingsResult.data ?? []) {
        const s = showing as any;
        const title =
          s.movie?.title || s.event?.title || s.live_performance?.title || 'Programmed event';
        // Showings carry a real instant, so their hours are known exactly —
        // read in the venue's zone, never the viewer's.
        const startMinutes = parseClockMinutes(formatShowtime(s.start_time, 'HH:mm'));
        const runtime = s.duration_minutes ?? DEFAULT_SHOWING_MINUTES;
        next.push({
          dayKey: venueDayKey(s.start_time),
          startMinutes,
          endMinutes: startMinutes === null ? null : startMinutes + runtime,
          isPublic: true,
          title,
          kind: 'showing',
        });
      }

      if (rentalsResult.error) {
        // A rentals read that fails must not blank the calendar: the showings
        // half is still true, and a page that silently shows an empty calendar
        // reads as "wide open" — the most expensive thing it could say wrongly.
        console.error('[rentals] availability read failed', rentalsResult.error);
      }

      for (const row of (rentalsResult.data ?? []) as AvailabilityRow[]) {
        const startMinutes = parseClockMinutes(row.start_time);
        const endMinutes = parseClockMinutes(row.end_time);
        next.push({
          dayKey: row.day,
          startMinutes,
          // An end we cannot read leaves the block open-ended; buildDayView
          // gives it a one-hour floor rather than painting the rest of the day.
          endMinutes: startMinutes === null ? null : endMinutes,
          isPublic: row.is_public,
          title: row.is_public ? row.title : null,
          kind: 'rental',
        });
      }

      setBlocks(next);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const blackoutByDay = useMemo(() => {
    const map = new Map<string, string>();
    for (const b of BLACKOUTS) map.set(b.date, b.label);
    return map;
  }, []);

  const limitedDates = useMemo(() => {
    const keys = new Set(blocks.map(b => b.dayKey));
    return [...keys].filter(k => !blackoutByDay.has(k)).map(isoToLocalDate);
  }, [blocks, blackoutByDay]);

  const blackoutDates = useMemo(() => BLACKOUTS.map(b => isoToLocalDate(b.date)), []);

  const selectedKey = selected ? localDayKey(selected) : null;

  const selectedDay = useMemo(() => {
    if (!selectedKey) return null;
    return buildDayView({
      dayKey: selectedKey,
      blocks,
      blackoutLabel: blackoutByDay.get(selectedKey) ?? null,
    });
  }, [selectedKey, blocks, blackoutByDay]);

  const selectedLabel = selected
    ? selected.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
    : null;

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Rent Kenworthy — Historic Theatre & Marquee"
        description="Rent the historic Kenworthy theatre, Main Stage, Backstage Speakeasy, or marquee for private events. Hourly rates, fees, and a live availability calendar."
      />

      <RentalsHero />

      {/* The room, under the sign. The marquee leads because it is the easiest
          thing to say yes to; this is what most of the page is actually about. */}
      <section className="border-b border-accent/20 bg-card/40">
        <div className="container py-12 md:py-16 max-w-4xl">
          <h2 className="font-display uppercase text-2xl md:text-3xl leading-tight text-foreground">
            Your event, on Main Street.
          </h2>
          <p className="font-serif italic text-lg text-muted-foreground mt-4 max-w-3xl">
            Kenworthy is pleased to offer its historic theatre space and Backstage area for private rentals — family
            movie nights, birthdays, recitals, private parties, and everything in between. Concessions, including beer
            and wine, are available for purchase during your event.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/rental-request">Request a date</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="mailto:events@kenworthy.org">
                <Mail className="h-4 w-4 mr-2" /> events@kenworthy.org
              </a>
            </Button>
          </div>
        </div>
      </section>

      {/* Availability */}
      <section id="availability" className="container py-16 max-w-6xl scroll-mt-20">
        <h2 className="font-display uppercase text-2xl md:text-3xl mb-2 flex items-center gap-2">
          <CalendarDays className="h-6 w-6 text-primary" /> Availability
        </h2>
        <p className="font-serif text-muted-foreground mb-8 max-w-2xl">
          Pick a day to see which hours are open. A day with something already on it usually still has
          room around it — a 7 PM screening leaves the whole morning free. We confirm every request
          within a few business days.
        </p>

        <div className="grid lg:grid-cols-[auto_1fr] gap-10 items-start">
          <div>
            <div className="rounded-lg border border-accent/20 bg-card/40 p-2 inline-block">
              <Calendar
                mode="single"
                selected={selected}
                onSelect={setSelected}
                numberOfMonths={1}
                modifiers={{ limited: limitedDates, blackout: blackoutDates }}
                modifiersClassNames={{
                  limited: 'bg-primary/25 text-foreground font-semibold hover:bg-primary/40',
                  blackout: 'bg-muted text-muted-foreground line-through',
                }}
                disabled={date => date < new Date(new Date().setHours(0, 0, 0, 0))}
              />
            </div>

            <ul className="flex flex-wrap gap-x-4 gap-y-2 mt-3 text-xs font-display uppercase tracking-[0.2em] text-muted-foreground">
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block w-3 h-3 rounded-sm border border-accent/40" />
                {DAY_STATUS_LABEL.available}
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block w-3 h-3 rounded-sm bg-primary/25" />
                {DAY_STATUS_LABEL.limited}
              </li>
              <li className="flex items-center gap-1.5">
                <span aria-hidden className="inline-block w-3 h-3 rounded-sm bg-muted" />
                {DAY_STATUS_LABEL.unavailable}
              </li>
            </ul>

            {/* The calendar cells are buttons showing a number; their colour is
                the only thing carrying the status. This says the same thing in
                words, for anyone who cannot use the colour. */}
            {selectedKey && (
              <p className="sr-only" aria-live="polite">
                {selectedLabel}:{' '}
                {DAY_STATUS_LABEL[dayStatus(selectedKey, blocks, blackoutByDay.get(selectedKey) ?? null)]}
              </p>
            )}
          </div>

          <div>
            {loading ? (
              <p className="text-muted-foreground font-serif">Loading availability…</p>
            ) : (
              <DayView day={selectedDay} dateLabel={selectedLabel} />
            )}
          </div>
        </div>
      </section>

      {/* Rates */}
      <section className="border-y border-accent/20 bg-card/40">
        <div className="container py-16 max-w-5xl">
          <h2 className="font-display uppercase text-2xl md:text-3xl mb-2 flex items-center gap-2">
            <Building2 className="h-6 w-6 text-primary" /> Rental Rates
          </h2>
          <p className="font-serif text-muted-foreground mb-8 max-w-2xl">
            Base rates are hourly and cover the space, one Kenworthy staff member, standard house lighting, and use of
            the marquee for day-of signage. Final pricing will be confirmed on your contract.
          </p>

          <RateGrid />

          <p className="font-serif text-sm text-muted-foreground mt-6 max-w-2xl">
            Hours after 9 PM are billed at the late rate for those hours — an evening running 7 PM to 11 PM on a
            Saturday is charged at the evening rate until 9 and the late rate after it, not one or the other for the
            whole booking.
          </p>

          {/* The marquee is priced per day rather than per hour, so it sits
              beside the grid rather than inside it. */}
          <div className="mt-8 border border-accent/20 rounded-lg p-5 bg-background/60 flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="font-display uppercase tracking-[0.15em] text-sm text-accent">{MARQUEE_RATE.label}</p>
              <p className="font-serif text-muted-foreground mt-1 text-sm">{MARQUEE_RATE.note}</p>
            </div>
            <div className="flex items-center gap-4">
              <span className="font-display text-primary text-2xl">${MARQUEE_RATE.price}</span>
              <MarqueeBookingForm trigger={<Button variant="outline">Book the marquee</Button>} />
            </div>
          </div>
        </div>
      </section>

      {/* Fees */}
      <section className="container py-16 max-w-5xl">
        <h2 className="font-display uppercase text-2xl md:text-3xl mb-6 flex items-center gap-2">
          <Tag className="h-6 w-6 text-primary" /> Fee Menu
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {FEES.map(f => (
            <div key={f.title} className="border border-accent/20 rounded-lg p-5 bg-card/40">
              <p className="font-display uppercase tracking-[0.15em] text-sm text-accent">{f.title}</p>
              <p className="font-serif text-foreground mt-2">{f.detail}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Discounts */}
      <section className="border-y border-accent/20 bg-card/40">
        <div className="container py-16 max-w-5xl">
          <h2 className="font-display uppercase text-2xl md:text-3xl mb-6 flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> Discounts
          </h2>
          <div className="grid md:grid-cols-2 gap-4">
            {DISCOUNTS.map(d => (
              <div key={d.title} className="border border-accent/20 rounded-lg p-5 bg-background/60">
                <p className="font-display uppercase tracking-[0.15em] text-sm text-primary">{d.title}</p>
                <p className="font-serif text-foreground mt-2">{d.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-accent/20 bg-card/60">
        <div className="container py-16 max-w-3xl text-center">
          <h2 className="font-display uppercase text-3xl md:text-4xl mb-4">Ready to book?</h2>
          <p className="font-serif text-lg text-muted-foreground mb-6">
            Submit a rental request, and we’ll be in touch with available times, a drafted contract, and answers to any
            questions you have.
          </p>
          <div className="flex flex-wrap gap-3 justify-center">
            <Button asChild size="lg">
              <Link to="/rental-request">Start a rental request</Link>
            </Button>
            <Button asChild variant="outline" size="lg">
              <a href="mailto:events@kenworthy.org">Email the box office</a>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
