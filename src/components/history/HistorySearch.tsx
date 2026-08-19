import { useEffect, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Search, Bookmark } from 'lucide-react';

export type SearchMilestone = {
  id: string;
  year: number;
  title: string;
  description: string | null;
};

/** What the page should do when a result is chosen. */
export type HistorySearchResult = {
  kind: 'milestone';
  id: string;
  year: number;
  label: string;
};

const MAX_PER_GROUP = 5;

export function HistorySearch({
  milestones,
  onSelect,
}: {
  milestones: SearchMilestone[];
  onSelect: (result: HistorySearchResult) => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const boxRef = useRef<HTMLDivElement>(null);

  const results = useMemo<HistorySearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    // Milestones: match the title or the story text, so "marquee" or "fire" find the
    // moment — and a bare year finds the milestones on it.
    const out: HistorySearchResult[] = milestones
      .filter(
        (m) =>
          m.title.toLowerCase().includes(q) ||
          (m.description ?? '').toLowerCase().includes(q) ||
          String(m.year).includes(q),
      )
      .slice(0, MAX_PER_GROUP)
      .map((m) => ({
        kind: 'milestone' as const,
        id: m.id,
        year: m.year,
        label: `${m.year} — ${m.title}`,
      }));

    return out.slice(0, 12);
  }, [query, milestones]);

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
          placeholder="Search a year or a moment&hellip;"
          className="pl-9 h-12 text-base"
          aria-label="Search the Kenworthy's history by year or milestone"
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
            return (
              <button
                key={`${r.kind}-${r.id}-${i}`}
                type="button"
                role="option"
                aria-selected={i === active}
                onMouseEnter={() => setActive(i)}
                onClick={() => choose(r)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === active ? 'bg-secondary/70' : 'hover:bg-secondary/40'
                }`}
              >
                <Bookmark className="h-4 w-4 shrink-0 text-accent" />
                <span className="truncate">{r.label}</span>
                <span className="ml-auto text-xs uppercase tracking-wide text-muted-foreground shrink-0">
                  Milestone
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
