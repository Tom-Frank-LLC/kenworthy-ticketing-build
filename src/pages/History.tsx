import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { fetchAllRows } from '@/lib/fetchAllRows';
import type { FilmDetails } from '@/lib/archiveFilms';
import { FilmArchiveTable } from '@/components/history/FilmArchiveTable';
import { Film, Building2, Sparkles, Hammer, Star, Users } from 'lucide-react';
import { SEO } from '@/components/SEO';
import { HistorySearch, type HistorySearchResult } from '@/components/history/HistorySearch';

import imgToday from '@/assets/optimized/history/kenworthy-today-marquee-night.webp';

/** Films listed inline on a timeline card before deferring to the full table. */
const BADGE_CAP = 24;

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
  film_title_display: string;
  film_year: number | null;
  matched_movie_id: string | null;
};

// Every milestone is a row of kenworthy_history, edited from Admin › Pages ›
// History. They used to be a SEED array here, merged with the table, which left
// the 26 milestones anyone could see uneditable; 20261113214659 moved them
// into the table, photos to public/images/history/. Real archival photos only
// (KPAC, kenworthy.org, historic postcards of downtown Moscow) — never
// AI-generated imagery.

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
  onSeeMore,
}: {
  milestone: Milestone;
  side: 'left' | 'right';
  screenings: ArchiveRow[];
  onSeeMore: (year: number) => void;
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
      id={`milestone-${milestone.id}`}
      className={`relative md:grid md:grid-cols-[1fr_auto_1fr] md:gap-8 items-start scroll-mt-24 transition-all duration-700 ease-out ${
        visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-8'
      }`}
    >
      {/* Left column */}
      <div className={`hidden md:block ${isLeft ? '' : 'md:invisible'}`}>
        {isLeft && (
          <ItemCard milestone={milestone} screenings={screenings} align="right" onSeeMore={onSeeMore} />
        )}
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
        {!isLeft && (
          <ItemCard milestone={milestone} screenings={screenings} align="left" onSeeMore={onSeeMore} />
        )}
      </div>

      {/* Mobile single column */}
      <div className="md:hidden pl-10 relative pb-2">
        <div className="absolute left-3 top-2 rounded-full bg-background border-2 border-accent w-7 h-7 flex items-center justify-center">
          <Icon className="h-3.5 w-3.5 text-accent" />
        </div>
        <div className="font-display text-lg text-accent mb-2">{milestone.year}</div>
        <ItemCard milestone={milestone} screenings={screenings} align="left" onSeeMore={onSeeMore} />
      </div>
    </div>
  );
}

function ItemCard({
  milestone,
  screenings,
  align,
  onSeeMore,
}: {
  milestone: Milestone;
  screenings: ArchiveRow[];
  align: 'left' | 'right';
  onSeeMore: (year: number) => void;
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
        <h2 className="font-display text-2xl mt-2 leading-tight">{milestone.title}</h2>
        {milestone.description && (
          <p className="font-serif text-muted-foreground mt-3 leading-relaxed">
            {milestone.description}
          </p>
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
            <div className={`flex flex-wrap gap-1.5 ${align === 'right' ? 'md:justify-end' : ''}`}>
              {screenings.slice(0, BADGE_CAP).map((r) => (
                <Badge key={r.id} variant="secondary" className="text-xs font-normal">
                  {r.film_title_display}
                  {r.film_year ? ` (${r.film_year})` : ''}
                </Badge>
              ))}
              {screenings.length > BADGE_CAP && (
                <button
                  type="button"
                  onClick={() => onSeeMore(milestone.year)}
                  className="text-xs text-muted-foreground hover:text-accent underline-offset-2 hover:underline self-center"
                >
                  +{(screenings.length - BADGE_CAP).toLocaleString()} more
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default function HistoryPage() {
  const [milestones, setMilestones] = useState<Milestone[]>([]);
  const [archive, setArchive] = useState<ArchiveRow[]>([]);
  const [filmDetails, setFilmDetails] = useState<Map<string, FilmDetails>>(() => new Map());
  const [archiveLoaded, setArchiveLoaded] = useState(false);
  const [scrollProgress, setScrollProgress] = useState(0);
  const [yearFilter, setYearFilter] = useState<number | null>(null);
  const [tableQuery, setTableQuery] = useState('');
  const timelineRef = useRef<HTMLDivElement>(null);

  // Bumped whenever something asks to jump to the table. Scrolling runs in an effect keyed
  // on this counter so React has committed the new filter/query before we scroll — and a
  // counter (rather than watching the filters) still fires when the values are unchanged.
  const [archiveJump, setArchiveJump] = useState(0);
  const jumpToArchive = () => setArchiveJump((n) => n + 1);

  useEffect(() => {
    if (!archiveJump) return;
    document.getElementById('film-archive')?.scrollIntoView({ behavior: 'smooth' });
  }, [archiveJump]);

  /** "+N more" on a timeline card: narrow the table to that year, then jump to it. */
  const showYearInTable = (year: number) => {
    setYearFilter(year);
    setTableQuery('');
    jumpToArchive();
  };

  const handleSearch = (r: HistorySearchResult) => {
    if (r.kind === 'milestone') {
      document.getElementById(`milestone-${r.id}`)?.scrollIntoView({ behavior: 'smooth' });
      return;
    }
    if (r.kind === 'year') {
      showYearInTable(r.year);
      return;
    }
    // A film title goes to the table, searched — not to a single year, since a film
    // may have played in several.
    setYearFilter(null);
    setTableQuery(r.title);
    jumpToArchive();
  };

  useEffect(() => {
    (async () => {
      // Newest first: the timeline opens on the present and runs back to 1908.
      const m = await supabase
        .from('kenworthy_history')
        .select('id, year, category, title, description, image_url, source_url')
        .order('year', { ascending: false })
        .order('display_order', { ascending: false });
      setMilestones((m.data as Milestone[]) ?? []);
    })();
    (async () => {
      // ~10,000 rows; PostgREST caps a response at 1,000 without saying so.
      const { data } = await fetchAllRows<ArchiveRow>((from, to) =>
        supabase
          .from('historical_screenings')
          .select('id, year, film_title_display, film_year, matched_movie_id')
          .eq('venue_name', 'Kenworthy')
          .order('year')
          .order('id')
          .range(from, to),
      );
      setArchive(data);
      setArchiveLoaded(true);
    })();
    (async () => {
      // Genre / rating / director / cast for the table's search. Only films
      // someone has filled in come back, so this starts small.
      const { data } = await fetchAllRows<FilmDetails & { movie_id: string }>((from, to) =>
        supabase.rpc('archive_film_details').range(from, to),
      );
      setFilmDetails(new Map(data.map((d) => [d.movie_id, d])));
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

  // One row per screening date, so a film that ran for a week can appear more than once.
  // Collapse each year to distinct films — otherwise a long run eats the badge cap and
  // the "+N more" count disagrees with the film table, which counts distinct titles.
  const screeningsByYear = useMemo(() => {
    const map = new Map<number, ArchiveRow[]>();
    const seen = new Set<string>();
    for (const r of archive) {
      const key = `${r.year}|${r.film_title_display.toLowerCase()}|${r.film_year ?? ''}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!map.has(r.year)) map.set(r.year, []);
      map.get(r.year)!.push(r);
    }
    return map;
  }, [archive]);

  // Distinct films for the page-wide search: one entry per title, with the years it played.
  const filmIndex = useMemo(() => {
    const map = new Map<string, { title: string; filmYear: number | null; years: number[] }>();
    for (const r of archive) {
      const title = r.film_title_display?.trim();
      if (!title) continue;
      const key = `${title.toLowerCase()}|${r.film_year ?? ''}`;
      let e = map.get(key);
      if (!e) {
        e = { title, filmYear: r.film_year, years: [] };
        map.set(key, e);
      }
      if (!e.years.includes(r.year)) e.years.push(r.year);
    }
    const out = [...map.values()];
    for (const e of out) e.years.sort((a, b) => a - b);
    return out;
  }, [archive]);

  return (
    <div className="min-h-screen">
      <SEO
        title="A Century on Main Street | Kenworthy History"
        description="One hundred years of films, renovations, and community at Kenworthy Performing Arts Centre in Moscow, Idaho — told as an animated vertical timeline."
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
          <HistorySearch milestones={milestones} films={filmIndex} onSelect={handleSearch} />
        </div>
      </header>

      <div className="container max-w-6xl px-4 py-16 md:py-24">
        {/* The spine is bounded by this wrapper, so it runs the length of the
            milestones and stops at the terminus dot. */}
        <div ref={timelineRef} className="relative">
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
                onSeeMore={showYearInTable}
              />
            ))}
          </div>

          {/* Terminus — caps the spine where the timeline ends. */}
          <div className="hidden md:block absolute left-1/2 -translate-x-1/2 -bottom-2 w-4 h-4 rounded-full bg-accent shadow-[0_0_24px_hsl(var(--accent)/0.6)]" />
          <div className="md:hidden absolute left-[26px] -translate-x-1/2 -bottom-1.5 w-3 h-3 rounded-full bg-accent" />
        </div>

        <div className="mt-24 pt-12 border-t border-border/40">
          <FilmArchiveTable
            rows={archive}
            details={filmDetails}
            loaded={archiveLoaded}
            yearFilter={yearFilter}
            onClearYearFilter={() => setYearFilter(null)}
            query={tableQuery}
            onQueryChange={setTableQuery}
          />
        </div>
      </div>
    </div>
  );
}
