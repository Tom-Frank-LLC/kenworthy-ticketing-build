import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Film, Calendar, Bookmark } from 'lucide-react';

export type SearchMilestone = {
  id: string;
  year: number;
  title: string;
  description: string | null;
};

export type SearchFilm = {
  title: string;
  filmYear: number | null;
  years: number[];
};

/** What the page should do when a result is chosen. */
export type HistorySearchResult =
  | { kind: 'milestone'; id: string; year: number; label: string }
  | { kind: 'film'; title: string; label: string }
  | { kind: 'year'; year: number; label: string };

const MAX_PER_GROUP = 5;

export function HistorySearch({
  milestones,
  films,
  onSelect,
}: {
  milestones: SearchMilestone[];
  films: SearchFilm[];
  onSelect: (result: HistorySearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo<HistorySearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const out: HistorySearchResult[] = [];

    // A bare year jumps straight to that point in the century.
    const yearMatch = /^\d{4}$/.test(q) ? parseInt(q, 10) : null;
    if (yearMatch) {
      const onYear = milestones.filter((m) => m.year === yearMatch);
      for (const m of onYear) {
        out.push({ kind: 'milestone', id: m.id, year: m.year, label: `${m.year} — ${m.title}` });
      }
      out.push({ kind: 'year', year: yearMatch, label: `All films from ${yearMatch}` });
    }

    // Milestones: match the title or the story text, so "marquee" or "fire" find the moment.
    const milestoneHits = milestones
      .filter(
        (m) =>
          !(yearMatch && m.year === yearMatch) &&
          (m.title.toLowerCase().includes(q) ||
            (m.description ?? '').toLowerCase().includes(q) ||
            String(m.year).includes(q)),
      )
      .slice(0, MAX_PER_GROUP);
    for (const m of milestoneHits) {
      out.push({ kind: 'milestone', id: m.id, year: m.year, label: `${m.year} — ${m.title}` });
    }

    if (!yearMatch) {
      const filmHits = films
        .filter((f) => f.title.toLowerCase().includes(q))
        .slice(0, MAX_PER_GROUP);
      for (const f of filmHits) {
        const yrs = f.years.length > 1 ? `${f.years[0]}–${f.years[f.years.length - 1]}` : `${f.years[0]}`;
        out.push({
          kind: 'film',
          title: f.title,
          label: `${f.title}${f.filmYear ? ` (${f.filmYear})` : ''} · played ${yrs}`,
        });
      }
    }

    return out.slice(0, 12);
  }, [query, milestones, films]);

  useEffect(() => setActive(0), [query]);

  // Clicking anywhere else dismisses the result list.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (r: HistorySearchResult) => {
    onSelect(r);
    setOpen(false);
    setQuery('');
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!results.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((a) => (a + 1) % results.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((a) => (a - 1 + results.length) % results.length);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      choose(results[active]);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  };

  const icon = (kind: HistorySearchResult['kind']) =>
    kind === 'film' ? Film : kind === 'year' ? Calendar : Bookmark;

  return (
    <div ref={boxRef} className="relative max-w-xl mx-auto mt-8 text-left">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search a year, a film, or a moment&hellip;"
          className="pl-9 h-12 text-base"
          aria-label="Search the Kenworthy's history by year, film, or milestone"
          aria-expanded={open && results.length > 0}
          role="combobox"
          aria-controls="history-search-results"
        />
      </div>

      {open && query.trim().length >= 2 && (
        <div
          id="history-search-results"
          role="listbox"
          className="absolute z-30 mt-2 w-full rounded-lg border border-border/60 bg-background/95 backdrop-blur shadow-xl overflow-hidden"
        >
          {results.length === 0 && (
            <p className="px-4 py-3 text-sm text-muted-foreground">
              Nothing matches &ldquo;{query.trim()}&rdquo;.
            </p>
          )}
          {results.map((r, i) => {
            const Icon = icon(r.kind);
            return (
              <button
                key={`${r.kind}-${'id' in r ? r.id : r.label}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === active ? 'bg-secondary/70' : 'hover:bg-secondary/40'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0 text-accent" />
                <span className="truncate">{r.label}</span>
                <span className="ml-auto text-[11px] uppercase tracking-wide text-muted-foreground shrink-0">
                  {r.kind === 'milestone' ? 'Milestone' : r.kind === 'film' ? 'Film' : 'Year'}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
