import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { Film, Building2, Sparkles, Hammer, Star, Users } from 'lucide-react';
import { SEO } from '@/components/SEO';

import img1926 from '@/assets/history/1926-opening.jpg';
import img1940s from '@/assets/history/1940s-marquee.jpg';
import img1970s from '@/assets/history/1970s-interior.jpg';
import img2000s from '@/assets/history/2000s-restoration.jpg';
import imgToday from '@/assets/history/today-marquee.jpg';

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

// Curated fallback so the page tells a story even before staff fill the DB.
const SEED: Milestone[] = [
  {
    id: 'seed-1926',
    year: 1926,
    category: 'milestone',
    title: 'The Kenworthy opens on Main Street',
    description:
      'Brothers George and Milton Kenworthy raise the marquee at 508 S. Main, bringing silent pictures and live vaudeville to downtown Moscow.',
    image_url: img1926,
    source_url: null,
  },
  {
    id: 'seed-1929',
    year: 1929,
    category: 'programming',
    title: 'Talkies arrive on the Palouse',
    description:
      'A Western Electric sound system is installed and the Kenworthy screens its first synchronized-sound features alongside organ accompaniment.',
    image_url: null,
    source_url: null,
  },
  {
    id: 'seed-1942',
    year: 1942,
    category: 'community',
    title: 'Wartime newsreels and double features',
    description:
      'The lobby becomes a gathering point for war-bond drives. Saturday matinees pair newsreels with serials for a town hungry for news from abroad.',
    image_url: img1940s,
    source_url: null,
  },
  {
    id: 'seed-1955',
    year: 1955,
    category: 'renovation',
    title: 'CinemaScope conversion',
    description:
      'The proscenium is widened and a new anamorphic lens added so the Kenworthy can show widescreen pictures arriving from Hollywood.',
    image_url: null,
    source_url: null,
  },
  {
    id: 'seed-1978',
    year: 1978,
    category: 'closure',
    title: 'A tired old room',
    description:
      'Decades of nightly shows leave the seats threadbare and the plaster cracked. Attendance dips as multiplexes open elsewhere in the region.',
    image_url: img1970s,
    source_url: null,
  },
  {
    id: 'seed-2000',
    year: 2000,
    category: 'community',
    title: 'The Kenworthy Performing Arts Centre is founded',
    description:
      'A nonprofit forms to save the building, raising the first matching grants and rallying volunteers from across Latah County.',
    image_url: null,
    source_url: null,
  },
  {
    id: 'seed-2004',
    year: 2004,
    category: 'renovation',
    title: 'Restoration of the proscenium and auditorium',
    description:
      'Volunteers, contractors, and historic-preservation grants bring back the ornamental plaster, the curtain, and the original color palette.',
    image_url: img2000s,
    source_url: null,
  },
  {
    id: 'seed-2014',
    year: 2014,
    category: 'renovation',
    title: 'Digital projection installed',
    description:
      'A community campaign funds a 4K DCI projector so first-run independent and foreign films can keep playing in Moscow.',
    image_url: null,
    source_url: null,
  },
  {
    id: 'seed-2020',
    year: 2020,
    category: 'closure',
    title: 'Pandemic intermission',
    description:
      'The marquee goes dark for the longest stretch in its history. Staff pivot to virtual screenings and curbside concessions to keep the lights on.',
    image_url: null,
    source_url: null,
  },
  {
    id: 'seed-2026',
    year: 2026,
    category: 'milestone',
    title: '100 years on Main Street',
    description:
      'A full centennial season — retrospectives, restorations, and a town-wide birthday party for the theater that has outlasted everything around it.',
    image_url: imgToday,
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
            src={imgToday}
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