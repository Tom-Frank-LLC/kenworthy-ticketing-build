import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Calendar } from '@/components/ui/calendar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { SEO } from '@/components/SEO';
import { Building2, Mail, Sparkles, Tag, CalendarDays } from 'lucide-react';

type BookedDay = { date: Date; label: string; kind: 'showing' | 'rental' };

const RATES = [
  { title: 'Main Auditorium — Half Day (up to 4 hrs)', price: '$400' },
  { title: 'Main Auditorium — Full Day (up to 8 hrs)', price: '$700' },
  { title: 'Main Stage Only', price: '$250 / 4 hrs' },
  { title: 'Backstage Speakeasy', price: '$300 / evening' },
  { title: 'Historic Marquee (one side, one day)', price: '$150' },
];

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

// Annual black-out dates (holidays / staff dark days).
const BLACKOUTS: { date: string; label: string }[] = [
  { date: `${new Date().getFullYear()}-12-24`, label: 'Christmas Eve' },
  { date: `${new Date().getFullYear()}-12-25`, label: 'Christmas Day' },
  { date: `${new Date().getFullYear()}-01-01`, label: 'New Year’s Day' },
  { date: `${new Date().getFullYear()}-07-04`, label: 'Independence Day' },
  { date: `${new Date().getFullYear()}-11-26`, label: 'Thanksgiving' },
];

function isoToLocalDate(iso: string) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function sameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

export default function Rentals() {
  const [booked, setBooked] = useState<BookedDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const horizon = new Date(today);
      horizon.setMonth(horizon.getMonth() + 12);

      const [{ data: showings }, { data: rentals }] = await Promise.all([
        supabase
          .from('showings')
          .select('id, start_time, movie:movies(title), event:events(title), live_performance:live_performances(title)')
          .gte('start_time', today.toISOString())
          .lt('start_time', horizon.toISOString())
          .eq('is_active', true),
        supabase
          .from('rental_requests')
          .select('id, proposed_date, event_title, status')
          .gte('proposed_date', today.toISOString().slice(0, 10))
          .lt('proposed_date', horizon.toISOString().slice(0, 10))
          .in('status', ['approved']),
      ]);

      if (cancelled) return;
      const days: BookedDay[] = [];
      (showings ?? []).forEach((s: any) => {
        const title = s.movie?.title || s.event?.title || s.live_performance?.title || 'Programmed event';
        days.push({ date: new Date(s.start_time), label: title, kind: 'showing' });
      });
      (rentals ?? []).forEach((r: any) => {
        if (!r.proposed_date) return;
        days.push({ date: isoToLocalDate(r.proposed_date), label: r.event_title, kind: 'rental' });
      });
      setBooked(days);
      setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const bookedDates = useMemo(() => booked.map(b => b.date), [booked]);
  const blackoutDates = useMemo(() => BLACKOUTS.map(b => isoToLocalDate(b.date)), []);

  const upcoming = useMemo(() => {
    const merged = [
      ...booked,
      ...BLACKOUTS.map(b => ({ date: isoToLocalDate(b.date), label: b.label, kind: 'blackout' as const })),
    ].sort((a, b) => a.date.getTime() - b.date.getTime());
    return merged.slice(0, 12);
  }, [booked]);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Rent the Kenworthy — Historic Theatre & Marquee"
        description="Rent the historic Kenworthy theatre, Main Stage, Backstage Speakeasy, or marquee for private events. Rates, fees, and live availability calendar."
      />

      {/* Hero */}
      <section className="relative border-b border-accent/20 bg-card/40">
        <div className="container py-16 md:py-24 max-w-5xl">
          <p className="font-display uppercase tracking-[0.3em] text-sm text-primary mb-4">Rent the Historic Theatre</p>
          <h1 className="font-display uppercase text-4xl md:text-6xl leading-tight text-foreground">
            Your event, on Main Street since 1926.
          </h1>
          <p className="font-serif italic text-lg md:text-xl text-muted-foreground mt-6 max-w-3xl">
            The Kenworthy is pleased to offer the historic theatre and Backstage for private rentals — family movie nights,
            birthday surprises, business retreats, recitals, weddings, and everything between. Concessions, including beer
            and wine, are available for purchase during your event.
          </p>
          <div className="mt-8 flex flex-wrap gap-3">
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
      <section className="container py-16 max-w-6xl">
        <div className="grid lg:grid-cols-[auto_1fr] gap-10 items-start">
          <div>
            <h2 className="font-display uppercase text-2xl md:text-3xl mb-2 flex items-center gap-2">
              <CalendarDays className="h-6 w-6 text-primary" /> Availability
            </h2>
            <p className="font-serif text-muted-foreground mb-4 max-w-md">
              Days highlighted in magenta are already booked with a public screening, performance, or confirmed private
              rental. Gold days are annual black-out dates. Anything else is fair game — submit a request and we’ll
              confirm within a few business days.
            </p>
            <div className="rounded-lg border border-accent/20 bg-card/40 p-2 inline-block">
              <Calendar
                mode="single"
                numberOfMonths={1}
                modifiers={{ booked: bookedDates, blackout: blackoutDates }}
                modifiersClassNames={{
                  booked: 'bg-primary/80 text-primary-foreground hover:bg-primary',
                  blackout: 'bg-accent/70 text-accent-foreground hover:bg-accent line-through',
                }}
                disabled={(date) =>
                  date < new Date(new Date().setHours(0, 0, 0, 0)) ||
                  blackoutDates.some(b => sameDay(b, date))
                }
              />
            </div>
            <div className="flex gap-4 mt-3 text-xs font-display uppercase tracking-[0.2em] text-muted-foreground">
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-primary/80" /> Booked</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-accent/70" /> Black-out</span>
            </div>
          </div>

          <div>
            <h3 className="font-display uppercase text-lg mb-3">Next on the calendar</h3>
            {loading ? (
              <p className="text-muted-foreground font-serif">Loading availability…</p>
            ) : upcoming.length === 0 ? (
              <p className="text-muted-foreground font-serif">No upcoming holds — wide open.</p>
            ) : (
              <ul className="divide-y divide-accent/15 border border-accent/20 rounded-lg bg-card/40">
                {upcoming.map((d, i) => (
                  <li key={i} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <p className="font-serif text-foreground">{d.label}</p>
                      <p className="text-xs text-muted-foreground font-display uppercase tracking-[0.2em]">
                        {d.date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}
                      </p>
                    </div>
                    <Badge variant={d.kind === 'blackout' ? 'outline' : 'default'} className="capitalize">
                      {d.kind === 'showing' ? 'Programmed' : d.kind === 'rental' ? 'Private rental' : 'Black-out'}
                    </Badge>
                  </li>
                ))}
              </ul>
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
            Base rates cover the room, one Kenworthy staff member, standard house lighting, and use of the marquee for
            day-of signage. Final pricing is confirmed on your contract.
          </p>
          <div className="grid sm:grid-cols-2 gap-4">
            {RATES.map((r) => (
              <Card key={r.title} className="bg-background/60 border-accent/20">
                <CardHeader className="flex-row items-center justify-between space-y-0">
                  <CardTitle className="text-base font-serif">{r.title}</CardTitle>
                  <span className="font-display text-primary text-lg">{r.price}</span>
                </CardHeader>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* Fees */}
      <section className="container py-16 max-w-5xl">
        <h2 className="font-display uppercase text-2xl md:text-3xl mb-6 flex items-center gap-2">
          <Tag className="h-6 w-6 text-primary" /> Fee Menu
        </h2>
        <div className="grid md:grid-cols-2 gap-4">
          {FEES.map((f) => (
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
            {DISCOUNTS.map((d) => (
              <div key={d.title} className="border border-accent/20 rounded-lg p-5 bg-background/60">
                <p className="font-display uppercase tracking-[0.15em] text-sm text-primary">{d.title}</p>
                <p className="font-serif text-foreground mt-2">{d.detail}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Marquee rental */}
      <section className="container py-16 max-w-4xl text-center">
        <h2 className="font-display uppercase text-2xl md:text-3xl mb-4">See your name in lights</h2>
        <p className="font-serif text-lg text-muted-foreground">
          For $150, share a special message on Downtown Moscow’s biggest, most visible sign — wish a happy birthday,
          congratulate a new parent, or even propose. Rental includes one side for one day; market days and holidays
          carry a small surcharge.
        </p>
        <Button asChild size="lg" className="mt-6">
          <a href="mailto:events@kenworthy.org?subject=Marquee%20rental%20inquiry">Book the marquee</a>
        </Button>
      </section>

      {/* Closing CTA */}
      <section className="border-t border-accent/20 bg-card/60">
        <div className="container py-16 max-w-3xl text-center">
          <h2 className="font-display uppercase text-3xl md:text-4xl mb-4">Ready to book?</h2>
          <p className="font-serif text-lg text-muted-foreground mb-6">
            Send a rental request and we’ll be in touch with available times, a draft contract, and answers to anything
            you’re still wondering about.
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