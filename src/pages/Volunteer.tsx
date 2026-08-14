import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEO } from '@/components/SEO';
import { HeartHandshake, Mail, Phone } from 'lucide-react';
import { VOLUNTEER_COORDINATOR, VOLUNTEER_DUTIES } from '@/lib/volunteering';
import { useHiringEnabled } from '@/hooks/useHiringEnabled';

import imgToday from '@/assets/optimized/history/kenworthy-today-marquee-night.webp';

// Ported from kenworthy.org/volunteer, with the roles, shift, and eligibility
// details the Kenworthy publishes alongside them on kenworthy.org/hiring.

export default function Volunteer() {
  const { name, title, email, phone, phoneHref } = VOLUNTEER_COORDINATOR;
  const { enabled: hiringEnabled, loading: hiringLoading } = useHiringEnabled();

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Volunteer — Kenworthy"
        description="Volunteer at the historic Kenworthy Performing Arts Centre in Moscow, Idaho — ushering, concessions, box office, clean-up days, and committees. 16 and older."
        path="/volunteer"
      />

      {/* Hero */}
      <section className="relative overflow-hidden border-b border-accent/20">
        <div className="absolute inset-0">
          <img
            src={imgToday}
            alt=""
            width={1280}
            height={800}
            className="w-full h-full object-cover opacity-25"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/50 via-background/75 to-background" />
        </div>
        <div className="relative container py-16 md:py-24 max-w-4xl">
          <p className="font-display uppercase tracking-[0.3em] text-sm text-primary mb-4">
            Support the Kenworthy
          </p>
          <h1 className="font-display uppercase text-4xl md:text-6xl leading-tight text-foreground">
            Volunteer
          </h1>
          <p className="font-serif italic text-lg md:text-xl text-muted-foreground mt-6 max-w-3xl">
            Your time as a volunteer is truly treasured. We rely on our volunteers to provide a
            friendly face as an usher, take care of our historic building during clean up days, and
            participate on committees that help steer the direction of the organization.
          </p>
        </div>
      </section>

      {/* What volunteers do */}
      <section className="container py-16 max-w-4xl">
        <h2 className="font-display uppercase text-2xl md:text-3xl mb-2 flex items-center gap-2">
          <HeartHandshake className="h-6 w-6 text-primary" /> What our volunteers do
        </h2>
        <p className="font-serif text-lg text-foreground mt-4">
          Be a part of Moscow history: volunteer at the historic Kenworthy Performing Arts Centre!
        </p>
        <p className="font-serif text-muted-foreground mt-3 leading-relaxed">
          If you love movies, music, live entertainment, and the arts, consider donating your time
          as a Kenworthy volunteer.
        </p>
        <ul className="mt-6 space-y-3">
          {VOLUNTEER_DUTIES.map((duty) => (
            <li key={duty} className="flex gap-3 font-serif text-foreground leading-relaxed">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{duty}</span>
            </li>
          ))}
        </ul>
      </section>

      {/* Shifts and eligibility */}
      <section className="border-y border-accent/20 bg-card/40">
        <div className="container py-16 max-w-4xl">
          <h2 className="font-display uppercase text-2xl md:text-3xl mb-6">
            Shifts, training, and perks
          </h2>
          <p className="font-serif text-muted-foreground leading-relaxed">
            Weekday, weekend, and evening shifts are available, and your time commitment can range
            from helping each week to coming in once a month. All volunteers will receive training
            to feel comfortable in their roles as well as free movie passes in exchange for their
            work. Must be at least 16 years of age.
          </p>
        </div>
      </section>

      {/* Sign up */}
      <section className="container py-16 max-w-4xl">
        <h2 className="font-display uppercase text-2xl md:text-3xl mb-4">How to sign up</h2>
        <p className="font-serif text-muted-foreground leading-relaxed">
          Get in touch with our Volunteer Coordinator, {name}, and let us know what interests you
          and roughly when you&rsquo;re free. We&rsquo;ll take it from there.
        </p>
        <p className="font-display uppercase tracking-[0.15em] text-xs text-accent mt-6">
          {name} — {title}
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Button asChild size="lg">
            <a href={`mailto:${email}`}>
              <Mail className="h-4 w-4 mr-2" /> {email}
            </a>
          </Button>
          <Button asChild size="lg" variant="outline">
            <a href={`tel:${phoneHref}`}>
              <Phone className="h-4 w-4 mr-2" /> {phone}
            </a>
          </Button>
          {/* /hiring redirects here when the toggle is off, so without this
              guard the button would send the reader back to the page they are
              already on.

              Gated on `!hiringLoading` as well, unlike the two nav menus: those
              sit inside a closed dropdown and have always resolved by the time
              anyone opens them, but this button is on screen at first paint.
              The hook's optimistic default would show it and then take it away,
              and a control that appears a beat late is far less jarring than
              one that vanishes under the cursor. */}
          {!hiringLoading && hiringEnabled && (
            <Button asChild size="lg" variant="outline">
              <Link to="/hiring">See all openings</Link>
            </Button>
          )}
        </div>
      </section>
    </div>
  );
}
