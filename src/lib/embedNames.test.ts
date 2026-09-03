import { describe, it, expect } from 'vitest';

/**
 * No source file may embed a PostgREST relation that does not exist.
 *
 * `concerts` was renamed to `live_performances`, and one caller was missed —
 * `ConcessionPOS` kept asking for `concerts(title)`. The failure is silent in
 * the worst way: an unresolvable embed is not a null column, it is a PGRST200
 * that fails the *whole* select, so the showing picker rendered empty and read
 * as "nothing is scheduled" rather than as a broken query.
 *
 * Confirmed against the live API while fixing it:
 *
 *   PGRST200 — "Could not find a relationship between 'showings' and
 *   'concerts' in the schema cache"
 *
 * A grep is a blunt guard, but this class of bug is a renamed table leaving one
 * straggler behind, and a straggler is exactly what a grep finds. Verified to
 * fail by putting `concerts(title)` back: it named ConcessionPOS.tsx.
 */

// `?raw` via import.meta.glob rather than node:fs — the app tsconfig has no
// node types, and a `node:fs` import fails `tsc -p tsconfig.app.json` even
// though vitest runs it. Same reason as bootWatchdog.test.ts.
const SOURCES = import.meta.glob('/src/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const RETIRED_EMBEDS = ['concerts'];

describe('PostgREST embeds', () => {
  it.each(RETIRED_EMBEDS)('no file embeds the retired relation %s(...)', name => {
    const pattern = new RegExp(`\\b${name}\\s*\\(`);
    const offenders = Object.entries(SOURCES)
      // The generated types legitimately mention every table name that ever
      // existed, and this guard's own source names what it forbids.
      .filter(([path]) => !path.includes('integrations/supabase/types') && !path.includes('embedNames.test'))
      .filter(([, src]) =>
        // Only inside a select string — the word in prose or a variable name is
        // not a query.
        src.split('\n').some(line => /\.select\(|select:/.test(line) && pattern.test(line)),
      )
      .map(([path]) => path);

    expect(offenders).toEqual([]);
  });
});
