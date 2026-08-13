import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEO } from '@/components/SEO';
import { Mail, Phone, Popcorn, Ticket } from 'lucide-react';
import { VOLUNTEER_COORDINATOR, VOLUNTEER_DUTIES } from '@/lib/volunteering';

// Ported from kenworthy.org/hiring ("job/volunteer Openings"). The Kenworthy has
// no paid openings posted right now — the page lists volunteer positions only.

export default function Hiring() {
  const { name, title, email, phone, phoneHref } = VOLUNTEER_COORDINATOR;

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Job Opportunities — The Kenworthy"
        description="Staff and volunteer openings at the Kenworthy Performing Arts Centre in Moscow, Idaho. Concessions, box office, clean-up, and special events — 16 and older."
        path="/hiring"
      />

      {/* Hero */}
      <section className="border-b border-accent/20 bg-card/40">
        <div className="container py-16 md:py-24 max-w-4xl">
          <p className="font-display uppercase tracking-[0.3em] text-sm text-primary mb-4">
            Job / Volunteer
          </p>
          <h1 className="font-display uppercase text-4xl md:text-6xl leading-tight text-foreground">
            Job Opportunities
          </h1>
          <p className="font-serif italic text-lg md:text-xl text-muted-foreground mt-6 max-w-3xl">
            Kenworthy staff members and volunteers help fulfill the mission by preparing the theatre
            for various film screenings, rentals, performances, special events and meetings. They
            are integral members to the success of the Kenworthy.
          </p>
        </div>
      </section>

      {/* Volunteer positions */}
      <section className="container py-16 max-w-4xl">
        <h2 className="font-display uppercase text-2xl md:text-3xl mb-2 flex items-center gap-2">
          <Popcorn className="h-6 w-6 text-primary" /> Volunteer Positions Available
        </h2>
        <p className="font-serif text-lg text-foreground mt-4">
          Be a part of Moscow history: volunteer at the historic Kenworthy Performing Arts Centre!
        </p>
        <p className="font-serif text-muted-foreground mt-3 leading-relaxed">
          If you love movies, music, live entertainment, and the arts, consider donating your time
          as a Kenworthy volunteer.
        </p>

        <h3 className="font-display uppercase tracking-[0.15em] text-sm text-accent mt-8 mb-3">
          Our volunteers
        </h3>
        <ul className="space-y-3">
          {VOLUNTEER_DUTIES.map((duty) => (
            <li key={duty} className="flex gap-3 font-serif text-foreground leading-relaxed">
              <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
              <span>{duty}</span>
            </li>
          ))}
        </ul>

        <p className="font-serif text-muted-foreground mt-6 leading-relaxed">
          Weekday, weekend, and evening shifts are available, and your time commitment can range
          from helping each week to coming in once a month. All volunteers will receive training to
          feel comfortable in their roles as well as free movie passes in exchange for their work.
          Must be at least 16 years of age.
        </p>
      </section>

      {/* Contact */}
      <section className="border-y border-accent/20 bg-card/40">
        <div className="container py-16 max-w-4xl">
          <h2 className="font-display uppercase text-2xl md:text-3xl mb-4">
            Contact our Volunteer Coordinator
          </h2>
          <p className="font-serif text-lg text-foreground">
            {name} — {title}
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
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
            <Button asChild size="lg" variant="outline">
              <Link to="/volunteer">
                <Ticket className="h-4 w-4 mr-2" /> More about volunteering
              </Link>
            </Button>
          </div>
        </div>
      </section>

      <section className="container py-12 max-w-4xl">
        <p className="font-serif italic text-muted-foreground">
          You&rsquo;ve reached the end. Stay tuned for more job openings in the future!
        </p>
      </section>
    </div>
  );
}
