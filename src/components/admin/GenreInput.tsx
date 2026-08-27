import { useEffect, useMemo, useRef, useState } from 'react';
import { X } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { collectGenres, genreSuggestionsFor, parseGenres, type GenreKind } from '@/lib/genres';

interface GenreInputProps {
  /** The genres currently on this production, in entry order. */
  value: string[];
  onChange: (genres: string[]) => void;
  /** Which starter suggestions to offer when the data has none of its own. */
  kind: GenreKind;
  id?: string;
  disabled?: boolean;
}

/**
 * Every genre already in use across the three production tables.
 *
 * The point of suggesting them is drift: "Sci-Fi", "Science Fiction" and
 * "SciFi" are three genres to a filter and three buckets to the favourite-genre
 * count, and nothing about a bare text box discourages inventing a fourth. So
 * the input offers what has been used before and lets a click reuse the exact
 * spelling.
 *
 * All three tables feed one list — a genre good enough for an event is good
 * enough to suggest on a film, and the input filters as you type anyway, so an
 * irrelevant suggestion costs a row that is never read. Failures are swallowed:
 * this is a convenience on top of a plain text field, and a form that will not
 * open because a suggestion query 500'd is worse than one with no suggestions.
 */
function useUsedGenres(): string[] {
  const [used, setUsed] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      // `.not(genre, is, null)` keeps this to the handful of rows that have a
      // genre rather than every production ever scheduled, which is also what
      // keeps it under PostgREST's silent 1,000-row cap. If it ever exceeds
      // that, a suggestion list built from the first thousand is still a
      // suggestion list.
      const tables = ['movies', 'events', 'live_performances'] as const;
      const results = await Promise.all(
        tables.map((table) =>
          supabase.from(table).select('genre').not('genre', 'is', null).limit(1000),
        ),
      );
      if (cancelled) return;
      const values = results.flatMap((result) =>
        ((result.data as { genre: string | null }[] | null) ?? []).map((row) => row.genre),
      );
      setUsed(collectGenres(values));
    })().catch(() => { /* suggestions are optional */ });
    return () => { cancelled = true; };
  }, []);

  return used;
}

/**
 * The genre field: a chip per genre, plus a box to type the next one.
 *
 * Enter or a comma commits what has been typed, so pasting "Drama, Comedy"
 * lands as two chips rather than one two-word genre. Blur commits too — a half
 * typed genre that vanishes because the admin clicked Save instead of pressing
 * Enter is the kind of loss nobody notices until the page is live.
 *
 * Backspace in an empty box removes the last chip, which is what every other
 * tag field does; each chip also carries a real button, because a keyboard-only
 * or screen-reader user has no way to reach the backspace shortcut's target.
 */
export function GenreInput({ value, onChange, kind, id, disabled }: GenreInputProps) {
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const used = useUsedGenres();

  const selectedKeys = useMemo(
    () => new Set(value.map((genre) => genre.toLowerCase())),
    [value],
  );

  // Genres already in the data come first — reusing an existing spelling is the
  // behaviour worth encouraging — with the starter list behind it, minus
  // anything already on this production.
  const suggestions = useMemo(() => {
    const query = draft.trim().toLowerCase();
    const pool = collectGenres([...used, ...genreSuggestionsFor(kind)]);
    const ranked = [
      ...pool.filter((genre) => used.some((u) => u.toLowerCase() === genre.toLowerCase())),
      ...pool.filter((genre) => !used.some((u) => u.toLowerCase() === genre.toLowerCase())),
    ];
    return ranked
      .filter((genre) => !selectedKeys.has(genre.toLowerCase()))
      .filter((genre) => !query || genre.toLowerCase().includes(query))
      .slice(0, 12);
  }, [draft, kind, selectedKeys, used]);

  const add = (raw: string) => {
    // Through `parseGenres` so a pasted "Drama, Comedy" splits, and so a genre
    // already on the production is not added a second time in another casing.
    const additions = parseGenres(raw).filter((genre) => !selectedKeys.has(genre.toLowerCase()));
    if (additions.length) onChange([...value, ...additions]);
    setDraft('');
  };

  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    inputRef.current?.focus();
  };

  return (
    <div className="space-y-2">
      <div
        className={cn(
          'flex flex-wrap items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2',
          'focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2',
          disabled && 'cursor-not-allowed opacity-50',
        )}
        onClick={() => inputRef.current?.focus()}
      >
        {value.map((genre, index) => (
          <Badge key={`${genre}-${index}`} variant="secondary" className="gap-1 pr-1">
            {genre}
            <button
              type="button"
              disabled={disabled}
              onClick={(e) => { e.stopPropagation(); removeAt(index); }}
              className="rounded-full p-0.5 hover:bg-background/60 focus:outline-none focus:ring-2 focus:ring-ring"
              aria-label={`Remove ${genre}`}
            >
              <X className="h-3 w-3" />
            </button>
          </Badge>
        ))}
        <input
          ref={inputRef}
          id={id}
          type="text"
          disabled={disabled}
          value={draft}
          placeholder={value.length ? 'Add another…' : kind === 'film' ? 'Drama' : 'Classical'}
          aria-describedby={id ? `${id}-hint` : undefined}
          className="min-w-[8rem] flex-1 bg-transparent text-base outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed"
          onChange={(e) => {
            // A typed comma is a commit, not a character — otherwise the stored
            // string would gain a separator the parser then splits on anyway.
            if (e.target.value.includes(',')) add(e.target.value);
            else setDraft(e.target.value);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              // Without this the form submits on the Enter that was meant to
              // commit a genre, saving the production a chip short.
              e.preventDefault();
              add(draft);
            } else if (e.key === 'Backspace' && !draft && value.length) {
              removeAt(value.length - 1);
            }
          }}
          onBlur={() => add(draft)}
        />
      </div>

      <p id={id ? `${id}-hint` : undefined} className="text-sm text-muted-foreground">
        Press Enter or type a comma to add a genre. A production can carry more than one.
      </p>

      {suggestions.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {suggestions.map((genre) => (
            <button
              key={genre}
              type="button"
              disabled={disabled}
              onClick={() => add(genre)}
              className="rounded-full border border-input px-2.5 py-0.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed"
            >
              + {genre}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
