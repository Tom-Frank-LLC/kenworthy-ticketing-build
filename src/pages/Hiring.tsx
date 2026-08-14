import { useEffect, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { SEO } from '@/components/SEO';
import { Briefcase, Mail, Phone, Popcorn, Ticket } from 'lucide-react';
import { VOLUNTEER_COORDINATOR, VOLUNTEER_DUTIES } from '@/lib/volunteering';
import { useHiringEnabled } from '@/hooks/useHiringEnabled';

// Ported from kenworthy.org/hiring ("job/volunteer Openings"). The volunteer
// copy below is evergreen and stays in the source; the paid openings are rows
// in job_postings, edited from the Hiring tab of the admin dashboard.

interface JobPosting {
  id: string;
  title: string;
  description: string | null;
}

export default function Hiring() {
  const { name, title, email, phone, phoneHref } = VOLUNTEER_COORDINATOR;
  const { enabled, loading: flagLoading } = useHiringEnabled();
  const [postings, setPostings] = useState<JobPosting[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    void (supabase as any)
      .from('job_postings')
      .select('id, title, description')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: false })
      .then(({ data }: { data: JobPosting[] | null }) => {
        if (alive) setPostings(data ?? []);
      });
    return () => {
      alive = false;
    };
  }, [enabled]);

  // Hold the render until the flag is known. Painting the page and then
  // yanking it is worse than a blank beat, and redirecting on the optimistic
  // default would bounce visitors off a page that is in fact open.
  if (flagLoading) {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }

  // Toggle off: the page is not public. /volunteer rather than a 404 because
  // the coordinator's contact details have to stay reachable either way, and
  // that page carries the same block — plus every inbound link to /hiring
  // still lands somewhere that answers "how do I get involved?".
  if (!enabled) {
    return <Navigate to="/volunteer" replace />;
  }

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Job Opportunities — Kenworthy"
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

      {/* Paid openings, admin-managed */}
      {postings.length > 0 && (
        <section className="container py-16 max-w-4xl">
          <h2 className="font-display uppercase text-2xl md:text-3xl mb-2 flex items-center gap-2">
            <Briefcase className="h-6 w-6 text-primary" /> Current Openings
          </h2>
          <div className="mt-8 space-y-6">
            {postings.map((job) => (
              <article
                key={job.id}
                className="rounded-lg border border-accent/20 bg-card/40 p-6 md:p-8"
              >
                <h3 className="font-display uppercase text-xl md:text-2xl text-foreground">
                  {job.title}
                </h3>
                {job.description && (
                  <p className="font-serif text-muted-foreground mt-3 leading-relaxed whitespace-pre-line">
                    {job.description}
                  </p>
                )}
                <Button asChild className="mt-6">
                  <a href={`mailto:${email}?subject=${encodeURIComponent(`Application: ${job.title}`)}`}>
                    <Mail className="h-4 w-4 mr-2" /> Apply by email
                  </a>
                </Button>
              </article>
            ))}
          </div>
        </section>
      )}

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
          {postings.length === 0
            ? 'No paid openings are posted right now — check back, and consider volunteering in the meantime.'
            : 'You’ve reached the end. Stay tuned for more job openings in the future!'}
        </p>
      </section>
    </div>
  );
}
