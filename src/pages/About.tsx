import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { SEO } from '@/components/SEO';
import { ArrowRight, Building2, Target, Users } from 'lucide-react';
import { publishedStaff, STAFF_BIO_COLUMNS, type StaffBio } from '@/lib/staffBios';

import imgToday from '@/assets/optimized/history/kenworthy-today-marquee-night.webp';
import img1908 from '@/assets/optimized/history/Crystal-Theatre-1908.webp';
import img1926 from '@/assets/optimized/history/Kenworthy-1926.webp';

// Copy ported from kenworthy.org/about — mission, goals, board roster, and the
// opening entries of the history timeline. The full timeline lives on /history.
const GOALS = [
  'To restore and preserve the Kenworthy Theatre as an historic building, maintaining it as a living theatre while retaining its historic beauty and financial value.',
  'To encourage film and other performing arts that would not otherwise be available in the area.',
  'To provide opportunities for quality family entertainment.',
  'To prohibit discrimination, in the entertainment and in the audience, on the basis of race, religion, color, national origin, gender, sexual orientation, disability, or age.',
];

const BOARD: Array<{ name: string; title: string }> = [
  { name: 'Stevie Steely-Johnson', title: 'President' },
  { name: "Mike O'Brien", title: 'Vice President' },
  { name: 'Kyle Howerton', title: 'Secretary' },
  { name: 'JT Steffens', title: 'Board Member' },
  { name: 'Eric Billings', title: 'Board Member' },
  { name: 'Aubree Flanery', title: 'Board Member' },
  { name: 'Jenny Ford', title: 'Board Member' },
  { name: 'Kimberly Kenworthy Manaut', title: 'Board Member' },
  { name: 'Donna Woolston', title: 'Board Member' },
  { name: 'Karen Weathermon', title: 'Board Member' },
  { name: 'Sydney Freeman, Jr.', title: 'Board Member' },
  { name: 'Cheryl Simmons', title: 'Board Member' },
];

const EARLY_HISTORY: Array<{ year: string; body: string; image?: string }> = [
  {
    year: '1908',
    body: "Operated as The Crystal Theatre, Moscow's opera house.",
    image: img1908,
  },
  {
    year: '1926',
    body: 'Milburn Kenworthy purchases the theatre and names it the Kenworthy Theatre. The public theatre opened on January 4th.',
    image: img1926,
  },
  {
    year: '1927',
    body: 'The theatre is used for vaudeville and other dramatic productions. It features a full but shallow stage with proscenium and fly space. By placing a screen in front of the stage and projection booth at the back of the balcony, the theatre could also show silent films. To enhance this experience, Milburn Kenworthy purchases a Robert Morton theatre pipe organ to accompany the silent films. In 1936 the University of Idaho took ownership of the organ. After being restored, the organ was moved to the University of Idaho Auditorium, where it resides to this day.',
  },
];

/**
 * Initials for a staff member with no headshot on file.
 *
 * A card with an empty square in a grid of faces reads as a broken image, so
 * the placeholder is deliberate and looks intentional. Bios are publishable
 * without a photo on purpose — waiting on a headshot is not a reason to keep
 * someone off the page.
 */
function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map(part => part[0]?.toUpperCase() ?? '')
    .join('');
}

export default function About() {
  // The board roster above is copy; staff bios are a table, because they carry
  // photos and paragraphs that staff edit themselves from the admin Staff tab.
  // The section renders nothing at all until someone is flagged for it — the
  // page has to look finished on the day it has no bios, which is today.
  const [staff, setStaff] = useState<StaffBio[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // RLS already hides unpublished and former staff from anon, but the
      // filters are stated here too: a signed-in staff member reading /about
      // gets every row back from the same policy, and would otherwise see
      // drafts on the public page and think they were live.
      const { data, error } = await (supabase as any)
        .from('staff_bios')
        .select(STAFF_BIO_COLUMNS)
        .eq('display_on_about', true)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      // A failed fetch leaves the section hidden rather than showing an error
      // box on a page that is otherwise static copy.
      if (cancelled || error) return;
      setStaff(publishedStaff(data || []));
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="About — Kenworthy"
        description="The mission, goals, board of directors, and history of the Kenworthy Performing Arts Centre — Moscow's historic downtown theatre and cinematic art house."
        path="/about"
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
            About the Kenworthy
          </p>
          <h1 className="font-display uppercase text-4xl md:text-6xl leading-tight text-foreground">
            Moscow&rsquo;s historic downtown theatre.
          </h1>
          <p className="font-serif italic text-lg md:text-xl text-muted-foreground mt-6 max-w-3xl">
            The mission of the Kenworthy Performing Arts Centre is to be Moscow&rsquo;s premier
            historic, downtown, community performing arts venue and cinematic art house dedicated
            to hosting and providing high quality arts experiences to residents of and visitors to
            the Palouse Region.
          </p>
        </div>
      </section>

      {/* The building */}
      <section className="container py-16 max-w-4xl">
        <h2 className="font-display uppercase text-2xl md:text-3xl mb-6 flex items-center gap-2">
          <Building2 className="h-6 w-6 text-primary" /> The Theatre
        </h2>
        <p className="font-serif text-lg text-muted-foreground leading-relaxed">
          The Kenworthy theatre occupies a dominant position in the turn-of-the-century cityscape of
          downtown Moscow. Although the opening of the Kenworthy as a public theatre by Milburn
          Kenworthy took place on January 4, 1926, some of the building was in use as the Crystal
          Theatre as early as 1908. A Robert Morgan theatre pipe organ was purchased in 1927 to
          accompany silent films and is now housed at the University of Idaho Auditorium. The
          original brick structure was enlarged by twenty-four feet to the south in 1928. At that
          time, the stage was used for vaudeville and other dramatic productions, and for silent
          films. Talking pictures started in 1929. The theatre was remodeled in 1949 with a new
          terracotta tile façade and enlarged marquee. It was run as Moscow&rsquo;s premier movie
          theatre by the Kenworthy family until the late 1980s when it was leased until its gift to
          the Kenworthy Performing Arts Centre, Inc. in 2000. The theatre was placed on the National
          Register of Historic Places in 2002.
        </p>
      </section>

      {/* Goals */}
      <section className="border-y border-accent/20 bg-card/40">
        <div className="container py-16 max-w-4xl">
          <h2 className="font-display uppercase text-2xl md:text-3xl mb-6 flex items-center gap-2">
            <Target className="h-6 w-6 text-primary" /> Goals
          </h2>
          <ul className="space-y-4">
            {GOALS.map((goal) => (
              <li key={goal} className="flex gap-3 font-serif text-foreground leading-relaxed">
                <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                <span>{goal}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Board */}
      <section className="container py-16 max-w-5xl">
        <h2 className="font-display uppercase text-2xl md:text-3xl mb-6 flex items-center gap-2">
          <Users className="h-6 w-6 text-primary" /> Kenworthy Board of Directors
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {BOARD.map((member) => (
            <li
              key={member.name}
              className="rounded-lg border border-accent/20 bg-card/40 px-5 py-4"
            >
              <p className="font-serif text-foreground">{member.name}</p>
              <p className="font-display uppercase tracking-[0.15em] text-xs text-accent mt-1">
                {member.title}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* Staff — hidden entirely until someone is flagged for the page */}
      {staff.length > 0 && (
        <section className="container pb-16 max-w-5xl">
          <h2 className="font-display uppercase text-2xl md:text-3xl mb-6 flex items-center gap-2">
            <Users className="h-6 w-6 text-primary" /> Kenworthy Staff
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {staff.map((member) => (
              <li
                key={member.id}
                className="rounded-lg border border-accent/20 bg-card/40 px-5 py-5"
              >
                {member.headshot_url ? (
                  <img
                    src={member.headshot_url}
                    alt={member.name}
                    loading="lazy"
                    width={96}
                    height={96}
                    className="h-24 w-24 rounded-full object-cover bg-secondary/40"
                  />
                ) : (
                  <div
                    aria-hidden
                    className="h-24 w-24 rounded-full bg-secondary/40 flex items-center justify-center font-display text-2xl text-accent"
                  >
                    {initials(member.name)}
                  </div>
                )}
                <p className="font-serif text-foreground mt-4">{member.name}</p>
                {member.title && (
                  <p className="font-display uppercase tracking-[0.15em] text-xs text-accent mt-1">
                    {member.title}
                  </p>
                )}
                {member.bio && (
                  <p className="font-serif text-sm text-muted-foreground leading-relaxed mt-3 whitespace-pre-line">
                    {member.bio}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* History */}
      <section className="border-t border-accent/20 bg-card/40">
        <div className="container py-16 max-w-4xl">
          <h2 className="font-display uppercase text-2xl md:text-3xl mb-8">Our History</h2>
          <div className="space-y-8">
            {EARLY_HISTORY.map((entry) => (
              <div
                key={entry.year}
                className="grid gap-5 sm:grid-cols-[8rem_1fr] items-start border-b border-accent/15 pb-8 last:border-0 last:pb-0"
              >
                <div className="font-display text-3xl text-accent tracking-wide">{entry.year}</div>
                <div>
                  {entry.image && (
                    <div className="aspect-[16/9] w-full overflow-hidden rounded-lg bg-secondary/40 mb-4">
                      <img
                        src={entry.image}
                        alt={`The Kenworthy in ${entry.year}`}
                        loading="lazy"
                        width={1280}
                        height={720}
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}
                  <p className="font-serif text-muted-foreground leading-relaxed">{entry.body}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="mt-10">
            <Button asChild size="lg">
              <Link to="/history">
                Read the full timeline <ArrowRight className="h-4 w-4 ml-2" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </div>
  );
}
