#!/usr/bin/env node
// Fill director, cast and (blank) genre on the films the Kenworthy archive
// links to, from Wikidata, matched on title AND release year.
//
//   1. Export the films (read-only), with the CLI linked to the target project:
//        supabase db query --linked -f scripts/sql/archive-credit-candidates.sql > films.json
//   2. Match (no database access; network to query.wikidata.org only):
//        node scripts/backfill-archive-credits.mjs --in films.json --out <dir> [--cache wd-cache.json]
//      writes <dir>/report.csv (every film: matched or why not), <dir>/summary.txt and
//      <dir>/apply-NN.sql (chunks of 500).
//   3. Read the report. Then apply each chunk, still linked to the same project:
//        supabase db query --linked -f <dir>/apply-01.sql   (…and the rest)
//
// Each apply chunk goes through audit_bulk_begin/end, which admits only a session
// that logs in as postgres. `db query` does, and `db push` does not, so this is
// never a migration (see BRIEF-archive-listings).
//
// WHY TITLE + YEAR IS ENOUGH HERE, WHEN IT WASN'T FOR GENRES
//
// backfill-genres.mjs matched our own listings by title alone (they had no
// release year), so it skipped any title Wikidata had twice and reached about one
// row in six. Archive films carry the release year from the newspaper listings
// (99% of them). Title plus year is close to unique: in a 60-film sample, 51
// matched exactly one Wikidata film with a director, 8 matched nothing, and 1 was
// two films of the same title and year (skipped). See
// docs/FINDINGS-archive-credits-backfill.md.
//
// RULES
//   - The film is resolved first: an English label or alias equal to the title,
//     an instance of film, published within YEAR_SLACK years of ours. If several
//     qualify, the single one with the nearest year wins; a tie is skipped.
//   - Only blank fields are filled: the SQL wraps each in COALESCE, so a value a
//     staff member typed (or a later run) is never replaced.
//   - Director: up to 3, as Wikidata lists them (it sometimes lists a producer-star
//     too; see the findings). Cast: the 6 best-known by Wikidata sitelink count,
//     since Wikidata's cast lists are not in billing order. Genre: through the
//     app's vocabulary (lib/film-titles.mjs), only where the film has none.
//   - Titles that are not films (NT Live, opera, fundraisers…) are skipped by the
//     same rules backfill-genres uses.

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanTitle, EXCLUDE_STRANDS, EXCLUDE_WORDS, mapGenres } from './lib/film-titles.mjs';

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const IN = arg('--in');
const OUT = arg('--out');
const CACHE = arg('--cache');
if (!IN || !OUT) {
  console.error('usage: backfill-archive-credits.mjs --in films.json --out <dir> [--cache wd-cache.json]');
  process.exit(1);
}

/**
 * Matches found wrong on review, pinned to the right film: "title|year" -> QID.
 * Pinocchio (2022): the plain label is Zemeckis's Disney+ film; the Kenworthy
 * showed del Toro's, whose English label is "Guillermo del Toro’s Pinocchio".
 */
const OVERRIDES = {
  'Pinocchio|2022': 'Q73895818',
};

const YEAR_SLACK = 2;
const MAX_DIRECTORS = 3;
const MAX_CAST = 6;
const BATCH = 50;
const CHUNK = 500;
const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'KenworthyArchiveCredits/1.0 (https://kenworthy.org)';

// ------------------------------------------------------------------ input

/** `supabase db query` prints a JSON object with `rows`; a bare array works too. */
function readRows(path) {
  const text = readFileSync(path, 'utf8');
  const start = text.search(/[[{]/);
  const parsed = JSON.parse(text.slice(start));
  return Array.isArray(parsed) ? parsed : parsed.rows;
}

const films = readRows(IN);
console.log(`${films.length} films linked from the archive`);

// ------------------------------------------------------------------ wikidata

const cache = CACHE && existsSync(CACHE) ? JSON.parse(readFileSync(CACHE, 'utf8')) : { labels: {}, films: {} };
const saveCache = () => CACHE && writeFileSync(CACHE, JSON.stringify(cache));
const lit = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@en`;

async function sparql(query) {
  for (let attempt = 1; ; attempt++) {
    try {
      const res = await fetch(SPARQL, {
        method: 'POST',
        headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ query }),
      });
      if (!res.ok) throw new Error(`SPARQL ${res.status}`);
      const json = await res.json();
      await new Promise((r) => setTimeout(r, 700)); // be a good citizen
      return json.results.bindings;
    } catch (e) {
      if (attempt >= 5) throw e;
      await new Promise((r) => setTimeout(r, attempt * 4000));
    }
  }
}

/** label -> [{ qid, year }] for every film carrying that English label or alias. */
async function resolveLabels(labels) {
  const todo = labels.filter((l) => !(l in cache.labels));
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    process.stdout.write(`  titles ${Math.min(i + BATCH, todo.length)}/${todo.length}\r`);
    const rows = await sparql(`
      SELECT ?label ?film (MIN(YEAR(?d)) AS ?y) WHERE {
        VALUES ?label { ${chunk.map(lit).join(' ')} }
        ?film rdfs:label|skos:altLabel ?label ;
              wdt:P31/wdt:P279* wd:Q11424 ;
              wdt:P577 ?d .
      } GROUP BY ?label ?film`);
    for (const l of chunk) cache.labels[l] = [];
    for (const b of rows) {
      // A publication date Wikidata can't give a year for (an unusual
      // precision or calendar) leaves ?y unbound; such a film can't be dated,
      // so it can't be matched on year.
      if (!b.y) continue;
      cache.labels[b.label.value].push({ qid: b.film.value.split('/').pop(), year: Number(b.y.value) });
    }
    saveCache();
  }
  console.log('');
}

/** qid -> { directors, cast, genres } */
async function fetchDetails(qids) {
  const todo = qids.filter((q) => !(q in cache.films));
  for (let i = 0; i < todo.length; i += BATCH) {
    const chunk = todo.slice(i, i + BATCH);
    process.stdout.write(`  films ${Math.min(i + BATCH, todo.length)}/${todo.length}\r`);
    const vals = chunk.map((q) => `wd:${q}`).join(' ');
    const [dirs, cast, genres] = await Promise.all([
      sparql(`SELECT ?film ?l WHERE { VALUES ?film { ${vals} } ?film wdt:P57 ?p . ?p rdfs:label ?l FILTER(LANG(?l)="en") }`),
      sparql(`SELECT ?film ?l ?sl WHERE { VALUES ?film { ${vals} } ?film wdt:P161 ?p . ?p rdfs:label ?l FILTER(LANG(?l)="en") . ?p wikibase:sitelinks ?sl }`),
      sparql(`SELECT ?film ?l WHERE { VALUES ?film { ${vals} } { ?film wdt:P136 ?g } UNION { ?film wdt:P31 ?g } ?g rdfs:label ?l FILTER(LANG(?l)="en") }`),
    ]);
    for (const q of chunk) cache.films[q] = { directors: [], cast: [], genres: [] };
    const q = (b) => b.film.value.split('/').pop();
    for (const b of dirs) { const f = cache.films[q(b)]; if (!f.directors.includes(b.l.value)) f.directors.push(b.l.value); }
    for (const b of cast) { const f = cache.films[q(b)]; if (!f.cast.some((c) => c[0] === b.l.value)) f.cast.push([b.l.value, Number(b.sl.value)]); }
    for (const b of genres) cache.films[q(b)].genres.push(b.l.value);
    saveCache();
  }
  console.log('');
}

// ------------------------------------------------------------------ match

const report = [];
const want = [];
for (const f of films) {
  const needs = !f.director || !f.cast_members || !f.genre;
  const { title, strand } = cleanTitle(f.title);
  let why = null;
  if (!needs) why = 'already filled';
  else if (!f.year) why = 'no release year';
  else if (strand && EXCLUDE_STRANDS.includes(strand)) why = `not a film (${strand})`;
  else if (EXCLUDE_WORDS.test(f.title)) why = 'not a screening';
  else if (title.length < 2) why = 'title too short';
  if (why) report.push({ f, why });
  else want.push({ f, label: title });
}

await resolveLabels([...new Set(want.map((w) => w.label))]);

const matched = [];
for (const { f, label } of want) {
  const pinned = OVERRIDES[`${label}|${f.year}`];
  if (pinned) { matched.push({ f, qid: pinned, wdYear: f.year }); continue; }
  const near = (cache.labels[label] ?? [])
    .filter((c) => Math.abs(c.year - f.year) <= YEAR_SLACK)
    .map((c) => ({ ...c, gap: Math.abs(c.year - f.year) }));
  // The same film can come back twice (label and alias); count distinct films.
  const byQid = new Map();
  for (const c of near) if (!byQid.has(c.qid) || byQid.get(c.qid).gap > c.gap) byQid.set(c.qid, c);
  const cands = [...byQid.values()].sort((a, b) => a.gap - b.gap);
  if (!cands.length) { report.push({ f, why: (cache.labels[label] ?? []).length ? 'title found, no film within 2 years' : 'no film with that title' }); continue; }
  if (cands.length > 1 && cands[0].gap === cands[1].gap) { report.push({ f, why: `ambiguous: ${cands.length} films` }); continue; }
  matched.push({ f, qid: cands[0].qid, wdYear: cands[0].year });
}

await fetchDetails([...new Set(matched.map((m) => m.qid))]);

const writes = [];
for (const m of matched) {
  const d = cache.films[m.qid];
  const director = d.directors.slice(0, MAX_DIRECTORS).join(', ') || null;
  const cast = [...d.cast].sort((a, b) => b[1] - a[1]).slice(0, MAX_CAST).map((c) => c[0]).join(', ') || null;
  const genre = mapGenres(d.genres).join(', ') || null;
  const set = {
    director: !m.f.director ? director : null,
    cast_members: !m.f.cast_members ? cast : null,
    genre: !m.f.genre ? genre : null,
  };
  if (!set.director && !set.cast_members && !set.genre) { report.push({ f: m.f, why: `matched ${m.qid}, nothing to add`, qid: m.qid }); continue; }
  writes.push({ id: m.f.id, ...set });
  report.push({ f: m.f, why: 'match', qid: m.qid, wdYear: m.wdYear, ...set });
}

// ------------------------------------------------------------------ output

mkdirSync(OUT, { recursive: true });
const csvCell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(join(OUT, 'report.csv'), [
  'id,title,year,archival,result,wikidata,wikidata_year,director,cast,genre',
  ...report.map((r) => [r.f.id, r.f.title, r.f.year, r.f.is_archival, r.why, r.qid ?? '', r.wdYear ?? '', r.director ?? '', r.cast_members ?? '', r.genre ?? ''].map(csvCell).join(',')),
].join('\n') + '\n');

const tally = {};
for (const r of report) { const k = r.why.replace(/^matched \S+, /, 'matched, ').replace(/: \d+ films$/, ''); tally[k] = (tally[k] ?? 0) + 1; }
const summary = [
  `films: ${films.length}`,
  `to write: ${writes.length}  (director ${writes.filter((w) => w.director).length}, cast ${writes.filter((w) => w.cast_members).length}, genre ${writes.filter((w) => w.genre).length})`,
  ...Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`),
].join('\n');
writeFileSync(join(OUT, 'summary.txt'), summary + '\n');
console.log(summary);

const sq = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
for (let i = 0, n = 1; i < writes.length; i += CHUNK, n++) {
  const part = writes.slice(i, i + CHUNK);
  const values = part.map((w) => `('${w.id}'::uuid, ${sq(w.director)}, ${sq(w.cast_members)}, ${sq(w.genre)})`).join(',\n    ');
  writeFileSync(join(OUT, `apply-${String(n).padStart(2, '0')}.sql`), `-- backfill-archive-credits: ${part.length} films. Fills blanks only.
DO $$
DECLARE v_run uuid; v_n integer;
BEGIN
  v_run := public.audit_bulk_begin(ARRAY['movies'], 'archive.backfill_credits', '{}'::jsonb, 15, NULL);
  UPDATE public.movies m
     SET director     = COALESCE(m.director, v.director),
         cast_members = COALESCE(m.cast_members, v.cast_members),
         genre        = COALESCE(m.genre, v.genre)
    FROM (VALUES
    ${values}
    ) AS v(id, director, cast_members, genre)
   WHERE m.id = v.id
     AND ((m.director IS NULL AND v.director IS NOT NULL)
       OR (m.cast_members IS NULL AND v.cast_members IS NOT NULL)
       OR (m.genre IS NULL AND v.genre IS NOT NULL));
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.audit_bulk_end(v_run, 'archive.backfill_credits', jsonb_build_object('movies_updated', v_n, 'source', 'wikidata'), NULL);
END
$$;
`);
}
console.log(`wrote ${Math.ceil(writes.length / CHUNK)} apply file(s) to ${OUT}`);
