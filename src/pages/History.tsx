import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Film, Building2, Sparkles, Hammer, Star, Users } from 'lucide-react';
import { SEO } from '@/components/SEO';

import img1928 from '@/assets/history/kenworthy-1928-facade.jpg.asset.json';
import imgAuditorium from '@/assets/history/kenworthy-1926-auditorium.jpg.asset.json';
import img1935 from '@/assets/history/kenworthy-circa-1935.jpg.asset.json';
import imgHistoricInterior from '@/assets/history/kenworthy-historic-interior.jpg.asset.json';
import img1950s from '@/assets/history/moscow-main-street-1950s-night.jpg.asset.json';
import img1952 from '@/assets/history/moscow-main-street-1952.jpg.asset.json';
import img1953 from '@/assets/history/moscow-main-street-1953.jpg.asset.json';
import img1965 from '@/assets/history/moscow-main-street-1965.jpg.asset.json';
import img2025Restoration from '@/assets/history/kenworthy-2025-marquee-restoration.jpg.asset.json';
import imgToday from '@/assets/history/kenworthy-today-marquee-night.jpg.asset.json';

const KENWORTHY_SOURCE = 'https://www.kenworthy.org/history/';

type Milestone = {
  id: string;
  year: number;
  category: string;
  title: string;
  description: string | null;
  image_url: string | null;
  source_url: string | null;
};

type ArchiveRow = {
  id: string;
  year: number;
  venue_name: string;
  film_title_display: string;
  film_year: number | null;
};

// Timeline drawn from kenworthy.org/history. Images are real archival photos
// (provided by KPAC, kenworthy.org, or historic postcards of downtown Moscow).
// Do not replace with AI-generated imagery.
const SEED: Milestone[] = [
  {
    id: 'seed-1908',
    year: 1908,
    category: 'milestone',
    title: 'The Crystal Theater opens',
    description:
      "Part of the building at 508 S. Main first operates as The Crystal Theater — Moscow's opera house.",
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1925',
    year: 1925,
    category: 'milestone',
    title: 'Milburn Kenworthy buys the theater',
    description:
      'Milburn Kenworthy purchases the theater and gives it the name it still carries a century later.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1926',
    year: 1926,
    category: 'milestone',
    title: 'Opening night on Main Street',
    description:
      'The Kenworthy opens to the public on January 4, 1926. The premiere film is "We Moderns" — a silent picture that is now lost.',
    image_url: imgAuditorium.url,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1927',
    year: 1927,
    category: 'programming',
    title: 'Vaudeville, silents, and a pipe organ',
    description:
      'A full but shallow stage with proscenium and fly space hosts vaudeville and dramatic productions; a screen rolls in front for silent films. Milburn Kenworthy buys a Robert Morton theater pipe organ to accompany them.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1928',
    year: 1928,
    category: 'renovation',
    title: 'The brick building is enlarged',
    description:
      'The original brick structure is extended twenty feet to the south.',
    image_url: img1928.url,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1935',
    year: 1935,
    category: 'milestone',
    title: 'A decade in: the family movie house',
    description:
      'By the mid-1930s the Kenworthy is woven into downtown — the vertical blade sign and chained marquee a fixture of Main Street.',
    image_url: img1935.url,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1936',
    year: 1936,
    category: 'community',
    title: 'The pipe organ goes to the University of Idaho',
    description:
      "Milburn Kenworthy gifts the Robert Morton organ to the University of Idaho. After restoration it's installed in the U of I Auditorium, where it still resides.",
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1949',
    year: 1949,
    category: 'renovation',
    title: 'New terracotta façade and bigger marquee',
    description:
      "A streamlined terracotta tile façade and enlarged marquee go up. By now the Kenworthy is Moscow's premier movie theater.",
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1952',
    year: 1952,
    category: 'programming',
    title: 'Quo Vadis and the postwar Main Street',
    description:
      'A summer afternoon on S. Main: the Kenworthy blade sign rises over a row of parked sedans, "Quo Vadis" on the marquee next door to the Nuart.',
    image_url: img1952.url,
    source_url: null,
  },
  {
    id: 'seed-1953',
    year: 1953,
    category: 'programming',
    title: 'Kirk Douglas in The Bad and the Beautiful',
    description:
      'A real-photo postcard of Main Street, Moscow — the Nuart marquee playing "The Band Wagon" and Kirk Douglas, with the Kenworthy a block south.',
    image_url: img1953.url,
    source_url: null,
  },
  {
    id: 'seed-1950s',
    year: 1958,
    category: 'community',
    title: 'A wet night under the neon',
    description:
      "Saturday night downtown: rain on the asphalt, Fonk's and the Paper House lit up, holiday lights strung across Main.",
    image_url: img1950s.url,
    source_url: null,
  },
  {
    id: 'seed-1965',
    year: 1965,
    category: 'community',
    title: 'Davids\u2019, Drugs, and the long blue hour',
    description:
      'Postcard dusk on Main Street in the mid-1960s — the Kenworthy still anchoring the block as downtown rebuilds around it.',
    image_url: img1965.url,
    source_url: null,
  },
  {
    id: 'seed-1971',
    year: 1971,
    category: 'milestone',
    title: 'Milburn Kenworthy passes',
    description:
      'Milburn Kenworthy dies on December 2, 1971. After several years of management transitions, Judd Kenworthy inherits the family theaters.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1979',
    year: 1979,
    category: 'renovation',
    title: 'Café Libre takes over backstage',
    description:
      'The back stage is converted into a coffee house — Café Libre — connected to BookPeople of Moscow next door. Movies keep running in the main auditorium.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1984',
    year: 1984,
    category: 'closure',
    title: 'Leased to Carmike Cinemas',
    description:
      'The Kenworthy Theatre is leased to the Carmike chain. Judd Kenworthy retires from the movie business.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1987',
    year: 1987,
    category: 'renovation',
    title: 'Backstage becomes offices',
    description:
      'The back stage is converted again, this time into an office and apartment housing Kenworthy Enterprises.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-1999',
    year: 1999,
    category: 'milestone',
    title: 'Gifted to the community',
    description:
      'On December 31, 1999, the Judd Kenworthy family gifts the theater to Moscow Community Theatre, Inc.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-2000',
    year: 2000,
    category: 'reopening',
    title: 'Live theater returns after 75 years',
    description:
      'The nonprofit Kenworthy Performing Arts Centre, Inc. forms and begins restoration. On November 2, Moscow Community Theater stages Little Shop of Horrors — complete with the original Broadway Audrey II puppet — and live theater is back at the Kenworthy after a 75-year absence.',
    image_url: imgHistoricInterior.url,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-2001',
    year: 2001,
    category: 'milestone',
    title: 'On the National Register of Historic Places',
    description:
      'The Kenworthy Theatre is listed on the National Register of Historic Places.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-2000s',
    year: 2008,
    category: 'renovation',
    title: 'ADA restrooms, marquee, expanded stage',
    description:
      'Major renovations through the 2000s: ADA-accessible restrooms are installed, the marquee is refurbished, and the stage is expanded for live productions.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-2012',
    year: 2012,
    category: 'renovation',
    title: 'Bathrooms, paint, sidewalk — original tile kept',
    description:
      'New paint, sidewalk work, and refreshed bathrooms — the original 1949 tile is preserved.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-2013',
    year: 2013,
    category: 'renovation',
    title: 'Digital projection conversion',
    description:
      'A community fundraising push pays for a digital projector, completing the conversion so first-run independent and foreign films can keep playing in Moscow.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-2014',
    year: 2014,
    category: 'programming',
    title: 'Inaugural MET Live in HD season',
    description:
      'The Kenworthy launches its first season of MET Live in HD broadcasts.',
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-2019',
    year: 2019,
    category: 'renovation',
    title: 'Art Deco seats and carpet, true to the original',
    description:
      "Major interior renovations install new Art Deco seats and carpeting consistent with the building's original design.",
    image_url: null,
    source_url: KENWORTHY_SOURCE,
  },
  {
    id: 'seed-2025',
    year: 2025,
    category: 'renovation',
    title: 'Marquee comes down for restoration',
    description:
      'Crews strip the 1949 marquee back to its frame — original timbers, rusted steel, and all — to rebuild it for the next hundred years.',
    image_url: img2025Restoration.url,
    source_url: null,
  },
  {
    id: 'seed-2026',
    year: 2026,
    category: 'milestone',
    title: '100 years on Main Street',
    description:
      'A full centennial season — retrospectives, restorations, and a town-wide birthday party for the theater that has outlasted almost everything around it.',
    image_url: imgToday.url,
    source_url: null,
  },
];

function categoryIcon(category: string) {
  switch (category) {
    case 'renovation':
      return Hammer;
    case 'closure':
    case 'reopening':
      return Building2;
    case 'community':
      return Users;
    case 'programming':
      return Film;
    case 'milestone':
      return Star;
    default:
      return Sparkles;
  }
}

function TimelineItem({
  milestone,
  side,
  screenings,
}: {
  milestone: Milestone;
  side: 'left' | 'right';
  screenings: ArchiveRow[];
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) {
            setVisible(true);
            io.disconnect();
          }
        });
      },
      { rootMargin: '0px 0px -10% 0px', threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const Icon = categoryIcon(milestone.category);
  const isLeft = side === 'left';

  return (
    <div
      ref={ref}
      className={`relative md:grid md:grid-cols-[1fr_auto_1fr] md:gap-8 items-start transition-all duration-700 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
    >
      {/* Left column */}
      <div className={`hidden md:block ${isLeft ? '' : 'md:invisible'}`}>
        {isLeft && <ItemCard milestone={milestone} screenings={screenings} align="right" />}
      </div>

      {/* Center spine + year marker */}
      <div className="hidden md:flex flex-col items-center pt-6 relative">
        <div className="flex flex-col items-center">
          <div className="rounded-full bg-background border-2 border-accent shadow-[0_0_24px_hsl(var(--accent)/0.4)] w-14 h-14 flex items-center justify-center">
            <Icon className="h-5 w-5 text-accent" />
          </div>
          <div className="font-display text-2xl text-accent mt-2 tracking-wide">
            {milestone.year}
          </div>
        </div>
      </div>

      {/* Right column */}
      <div className={`hidden md:block ${isLeft ? 'md:invisible' : ''}`}>
        {!isLeft && <ItemCard milestone={milestone} screenings={screenings} align="left" />}
      </div>

      {/* Mobile single column */}
      <div className="md:hidden pl-10 relative pb-2">
        <div className="absolute left-3 top-2 rounded-full bg-background border-2 border-accent w-7 h-7 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-accent" />
        </div>
        <div className="font-display text-lg text-accent mb-2">{milestone.year}</div>
        <ItemCard milestone={milestone} screenings={screenings} align="left" />
      </div>
    </div>
  );
}

function ItemCard({
  milestone,
  screenings,
  align,
}: {
  milestone: Milestone;
  screenings: ArchiveRow[];
  align: 'left' | 'right';
}) {
  return (
    <div
      className={`glass border border-border/60 rounded-lg overflow-hidden hover:border-accent/50 transition-colors ${
        align === 'right' ? 'md:text-right' : ''
      }`}
    >
      {milestone.image_url && (
        <div className="aspect-[16/9] w-full overflow-hidden bg-secondary/40">
          <img
            src={milestone.image_url}
            alt={milestone.title}
            loading="lazy"
            width={1280}
            height={720}
            className="w-full h-full object-cover transition-transform duration-[1200ms] hover:scale-105"
          />
        </div>
      )}
      <div className="p-5">
        <div
          className={`flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-accent font-display ${
            align === 'right' ? 'md:justify-end' : ''
          }`}
        >
          <span>{milestone.category}</span>
        </div>
        <h3 className="font-display text-2xl mt-2 leading-tight">{milestone.title}</h3>
        {milestone.description && (
          <p className="font-serif text-muted-foreground mt-3 leading-relaxed">
            {milestone.description}
          </p>
        )}
        {milestone.source_url && (
          <a
            href={milestone.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-xs text-primary hover:underline mt-3 inline-block"
          >
            Source →
          </a>
        )}

        {screenings.length > 0 && (
          <div className="mt-4 pt-4 border-t border-border/40">
            <div
              className={`flex items-center gap-2 text-xs uppercase tracking-wide text-muted-foreground font-display mb-2 ${
                align === 'right' ? 'md:justify-end' : ''
              }`}
            >
              <Film className="h-3.5 w-3.5" />
              On screen that year
            </div>
            <div
              className={`flex flex-wrap gap-1.5 ${
                align === 'right' ? 'md:justify-end' : ''
              }`}
            >
              {screenings.slice(0, 24).map((r) => (
                <Badge
                  key={r.id}
                  variant="secondary"
                  className="text-[11px] font-normal"
                >
                  {r.film_title_display}
                  {r.film_year ? ` (${r.film_year})` : ''}
                </Badge>
              ))}
              {screenings.length > 24 && (
                <span className="text-xs text-muted-foreground self-center">
                  +{screenings.length - 24} more
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const [dbMilestones, setDbMilestones] = useState<Milestone[]>([]);
  const [archive, setArchive] = useState<ArchiveRow[]>([]);
  const [scrollProgress, setScrollProgress] = useState(0);
  const timelineRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const [m, a] = await Promise.all([
        supabase
          .from('kenworthy_history')
          .select('id, year, category, title, description, image_url, source_url')
          .order('year'),
        supabase
          .from('historical_screenings')
          .select('id, year, venue_name, film_title_display, film_year')
          .eq('venue_name', 'Kenworthy')
          .order('year')
          .limit(20000),
      ]);
      setDbMilestones((m.data as Milestone[]) ?? []);
      setArchive((a.data as ArchiveRow[]) ?? []);
    })();
  }, []);

  useEffect(() => {
    const onScroll = () => {
      const el = timelineRef.current;
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const total = rect.height - window.innerHeight;
      const scrolled = Math.min(Math.max(-rect.top, 0), Math.max(total, 1));
      setScrollProgress(total > 0 ? scrolled / total : 0);
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const milestones = useMemo(() => {
    // Merge DB milestones with seed; DB wins by (year+title) match.
    const key = (m: Milestone) => `${m.year}:${m.title.toLowerCase()}`;
    const seen = new Set(dbMilestones.map(key));
    return [...dbMilestones, ...SEED.filter((s) => !seen.has(key(s)))].sort(
      (a, b) => a.year - b.year,
    );
  }, [dbMilestones]);

  const screeningsByYear = useMemo(() => {
    const map = new Map<number, ArchiveRow[]>();
    for (const r of archive) {
      if (!map.has(r.year)) map.set(r.year, []);
      map.get(r.year)!.push(r);
    }
    return map;
  }, [archive]);

  return (
    <div className="min-h-screen">
      <SEO
        title="A Century on Main Street | Kenworthy History"
        description="One hundred years of films, renovations, and community at the Kenworthy Performing Arts Centre in Moscow, Idaho — told as an animated vertical timeline."
        path="/history"
      />

      {/* Hero */}
      <header className="relative overflow-hidden border-b border-border/40">
        <div className="absolute inset-0">
          <img
            src={imgToday.url}
            alt=""
            width={1280}
            height={800}
            className="w-full h-full object-cover opacity-30"
          />
          <div className="absolute inset-0 bg-gradient-to-b from-background/40 via-background/70 to-background" />
        </div>
        <div className="relative container max-w-4xl py-20 md:py-28 px-4 text-center">
          <p className="text-xs uppercase tracking-[0.4em] text-accent font-display animate-fade-in">
            Est. 1926 · 508 S Main St, Moscow, Idaho
          </p>
          <h1 className="font-display text-5xl md:text-7xl mt-4 animate-fade-in">
            A Century on Main Street
          </h1>
          <p className="font-serif text-lg md:text-xl text-muted-foreground mt-6 max-w-2xl mx-auto animate-fade-in">
            One hundred years of opening nights, dark intermissions, scaffolding,
            and standing ovations — scroll the marquee.
          </p>
        </div>
      </header>

      <div ref={timelineRef} className="relative container max-w-6xl px-4 py-16 md:py-24">
        {/* Spine */}
        <div className="hidden md:block absolute left-1/2 -translate-x-1/2 top-0 bottom-0 w-px bg-border/60" />
        <div
          className="hidden md:block absolute left-1/2 -translate-x-1/2 top-0 w-px bg-gradient-to-b from-accent via-primary to-accent transition-[height] duration-150"
          style={{ height: `${scrollProgress * 100}%` }}
        />
        {/* Mobile spine */}
        <div className="md:hidden absolute left-[26px] top-0 bottom-0 w-px bg-border/60" />
        <div
          className="md:hidden absolute left-[26px] top-0 w-px bg-gradient-to-b from-accent via-primary to-accent"
          style={{ height: `${scrollProgress * 100}%` }}
        />

        <div className="relative space-y-16 md:space-y-24">
          {milestones.map((m, i) => (
            <TimelineItem
              key={m.id}
              milestone={m}
              side={i % 2 === 0 ? 'left' : 'right'}
              screenings={screeningsByYear.get(m.year) ?? []}
            />
          ))}
        </div>

        <div className="relative text-center mt-24 pt-12">
          <div className="hidden md:block absolute left-1/2 -translate-x-1/2 -top-2 w-4 h-4 rounded-full bg-accent shadow-[0_0_24px_hsl(var(--accent)/0.6)]" />
          <p className="font-display text-2xl uppercase tracking-[0.3em] text-muted-foreground">
            And the next reel begins.
          </p>
        </div>
      </div>
    </div>
  );
}