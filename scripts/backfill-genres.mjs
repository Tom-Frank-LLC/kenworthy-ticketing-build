#!/usr/bin/env node
// Backfill movies.genre from Wikidata, conservatively.
//
//   node scripts/backfill-genres.mjs --env staging              dry run → report only
//   node scripts/backfill-genres.mjs --env staging --apply      write
//
// Needs SUPABASE_SERVICE_KEY in the environment (never commit it):
//   SUPABASE_SERVICE_KEY=$(npx supabase projects api-keys --project-ref <ref> ...)
//
// WHY THIS IS SO CAUTIOUS
//
// `movies.release_year` is empty on 1,086 of 1,089 rows, so a title is all we
// have to match on, and film titles are heavily reused — "Paprika" alone is six
// different films on Wikidata, spanning comedy, drama and cyberpunk. Writing the
// union of those genres onto our row would put confident, wrong words on a badge
// a patron reads. A blank genre is honest; a wrong one is not.
//
// So a row is only written when ALL of these hold:
//   1. the title cleans to something that is plausibly a film (see EXCLUDE),
//   2. exactly ONE film on Wikidata carries that exact label — any ambiguity and
//      we skip rather than guess,
//   3. at least one of its genres maps onto the vocabulary the app already
//      suggests in the genre field.
//
// Measured on production: this matches roughly one row in six. That is the
// honest ceiling of a keyless source with no release year, not a bug. A TMDB key
// would raise it substantially — its search ranks by popularity, which resolves
// exactly the ambiguity that stops us here.
//
// Rows that already carry a genre are never touched: staff entry outranks this.

import { writeFileSync } from 'node:fs';

const REFS = { staging: 'rpqzrpboyhshdrfdwayk', production: 'vlmslygnimfbamrtwvyo' };

const args = process.argv.slice(2);
const env = args[args.indexOf('--env') + 1];
const APPLY = args.includes('--apply');
if (!REFS[env]) {
  console.error('usage: backfill-genres.mjs --env staging|production [--apply]');
  process.exit(1);
}
const KEY = process.env.SUPABASE_SERVICE_KEY;
if (!KEY) { console.error('SUPABASE_SERVICE_KEY is not set'); process.exit(1); }
const API = `https://${REFS[env]}.supabase.co/rest/v1`;
const H = { apikey: KEY, Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' };

// ---------------------------------------------------------------- title clean

/** Programme strands the Kenworthy prepends. Series names, not film titles. */
const STRANDS = [
  'Moscow Film Society', 'Summer Family Matinee', 'Cinema Classics',
  'Palouse Cult Film Revival', 'Staff Picks', 'Oscars Recap', 'Best of 2024',
  'Palouse French Film Festival', 'Science on Screen', 'Silent Film Festival',
  'Absolute Anime', 'Films From the Vault', 'AsiaPOP!', 'AsiaPop!', 'Page to Screen',
  'Family Flicks', 'New Restorations', 'Centennial Series', 'Frames of Reference',
  'Sound on Screen', 'Movie Book Club', 'Metal Monday', 'Magenta & Co',
  'Kenworthy Classics', 'Free Family Film',
];

/**
 * Strands that are NOT films, and titles that are not screenings at all.
 *
 * These matter more than they look. "NT Live: Best of Enemies" is a filmed stage
 * play; Wikidata happily matches "Best of Enemies" to a 1933 comedy and a 2015
 * documentary, neither of which is what played here. Opera and theatre
 * broadcasts, local company productions and fundraisers all have to be off the
 * table before matching begins, or the confident-looking matches are the wrong
 * ones.
 */
const EXCLUDE_STRANDS = [
  'APOD Productions', 'APOD Youth Productions', 'Moscow Community Theatre',
  'NT Live', 'National Theatre Live', 'MET Live in HD', 'Met Live in HD',
];
const EXCLUDE_WORDS = /(?:\b(?:APOD|showcase|gala|fundrais\w*|recital|graduation|wedding|open mic|karaoke|world tour|live in concert|dance party|bolshoi|comedy night|trivia|bingo|meeting|workshop|auction|volunteer|staff training)\b)/i;

const SUFFIX = /\s*(?:[-—–~|]\s*)?\b(?:with\s+(?:live\s+score|filmmaker\s+q&a|q&a|director\s+q&a|introduction|invincible\s+czars).*|in\s+35mm|on\s+35mm|\(?35mm\)?|\(?70mm\)?|sing-?along|encore(?:\s+screening)?|free\s+screening|matinee|double\s+feature|\d+(?:st|nd|rd|th)\s+anniversary(?:\s+screening)?|restored|remastered|\(?director'?s\s+cut\)?)\s*$/i;

export function cleanTitle(title) {
  let t = String(title).trim();
  let strand = null;
  for (const s of [...STRANDS, ...EXCLUDE_STRANDS].sort((a, b) => b.length - a.length)) {
    const m = t.match(new RegExp(`^${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*[:~\\-–—]\\s*(.+)$`, 'i'));
    if (m) { strand = s; t = m[1].trim(); break; }
  }
  let year = null;
  const ym = t.match(/\((\d{4})\)\s*$/);
  if (ym) { year = Number(ym[1]); t = t.slice(0, ym.index).trim(); }
  let prev = null;
  while (prev !== t) { prev = t; t = t.replace(SUFFIX, '').trim().replace(/[-–—:~]+$/, '').trim(); }
  return { title: t, year, strand };
}

export function isCandidate(row) {
  if (row.genre) return { ok: false, why: 'already has a genre' };
  const { title, strand } = cleanTitle(row.title);
  if (strand && EXCLUDE_STRANDS.includes(strand)) return { ok: false, why: `non-film strand (${strand})` };
  if (EXCLUDE_WORDS.test(row.title)) return { ok: false, why: 'not a screening' };
  if (title.length < 3) return { ok: false, why: 'title too short to match' };
  return { ok: true, clean: title };
}

// ------------------------------------------------------------- genre mapping

/**
 * Wikidata's genre vocabulary onto the one the app already suggests.
 *
 * Wikidata says "fantasy anime and manga", "anti-war film", "police film". Those
 * are correct and unusable — the whole point of the chip field's suggestions is
 * that the same idea is spelled one way. Anything not on this map is dropped
 * rather than invented, so an unmapped genre costs coverage, never consistency.
 */
const GENRE_MAP = new Map(Object.entries({
  // From P31 rather than P136 — see the query above.
  'animated film': ['Animation'], 'anime film': ['Animation'],
  'animated short film': ['Animation'], 'traditionally animated film': ['Animation'],
  // Wikidata's anime-specific genre tree, which mirrors the ordinary one.
  'drama anime and manga': ['Drama'], 'comedy anime and manga': ['Comedy'],
  'action anime and manga': ['Action'], 'romance anime and manga': ['Romance'],
  'science fiction anime and manga': ['Sci-Fi'], 'mecha anime and manga': ['Sci-Fi'],
  'adventure anime and manga': ['Adventure'], 'supernatural anime': ['Fantasy'],
  'isekai': ['Fantasy'],
  // Narrower drama flavours that were being dropped entirely — this is what
  // filed One Flew Over the Cuckoo's Nest as a plain comedy.
  'medical drama': ['Drama'], 'prison film': ['Drama'], 'coming-of-age film': ['Drama'],
  'social problem film': ['Drama'], 'courtroom drama': ['Drama'], 'sports film': ['Drama'],
  'arthouse science fiction film': ['Sci-Fi'], 'road movie': ['Adventure'],
  'buddy film': ['Comedy'], 'christmas film': ['Family'], 'holiday film': ['Family'],
  'concert film': ['Musical', 'Documentary'], 'dance film': ['Musical'],
  'epic film': ['Adventure'], 'superhero film': ['Action'], 'martial arts': ['Action'],
  'action film': ['Action'], 'martial arts film': ['Action'], 'ninja film': ['Action'],
  'adventure film': ['Adventure'], 'swashbuckler film': ['Adventure'],
  'animated film': ['Animation'], 'animated feature film': ['Animation'], 'anime film': ['Animation'],
  'computer-animated film': ['Animation'], 'stop motion animated film': ['Animation'],
  'comedy film': ['Comedy'], 'black comedy film': ['Comedy'], 'slapstick film': ['Comedy'],
  'parody film': ['Comedy'], 'satire film': ['Comedy'],
  // Compound genres keep both halves: a comedy-drama is not simply a comedy.
  'comedy-drama': ['Comedy', 'Drama'], 'comedy drama': ['Comedy', 'Drama'],
  'romantic comedy': ['Comedy', 'Romance'], 'romantic comedy film': ['Comedy', 'Romance'],
  'crime film': ['Crime'], 'gangster film': ['Crime'], 'heist film': ['Crime'], 'police film': ['Crime'],
  'documentary film': ['Documentary'], 'documentary': ['Documentary'], 'nature documentary': ['Documentary'],
  'docudrama': ['Documentary', 'Drama'],
  'drama film': ['Drama'], 'legal drama': ['Drama'], 'melodrama': ['Drama'],
  'psychological drama': ['Drama'], 'teen drama': ['Drama'],
  'historical drama': ['Drama', 'History'],
  'family film': ['Family'], "children's film": ['Family'],
  'fantasy film': ['Fantasy'], 'fantasy anime and manga': ['Fantasy'], 'dark fantasy': ['Fantasy'],
  'film noir': ['Film Noir'], 'neo-noir': ['Film Noir'],
  'historical film': ['History'], 'biographical film': ['History'],
  'horror film': ['Horror'], 'horror anime and manga': ['Horror'], 'slasher film': ['Horror'],
  'zombie film': ['Horror'], 'vampire film': ['Horror'], 'monster film': ['Horror'],
  'musical film': ['Musical'], 'jukebox musical': ['Musical'], 'rockumentary': ['Musical', 'Documentary'],
  'mystery film': ['Mystery'], 'whodunit': ['Mystery'], 'detective film': ['Mystery'],
  'romance film': ['Romance'], 'romance': ['Romance'], 'romantic drama': ['Romance', 'Drama'],
  'science fiction film': ['Sci-Fi'], 'cyberpunk': ['Sci-Fi'], 'space opera': ['Sci-Fi'],
  'dystopian film': ['Sci-Fi'], 'kaiju film': ['Sci-Fi'],
  'silent film': ['Silent'],
  'thriller film': ['Thriller'], 'psychological thriller film': ['Thriller'],
  'spy film': ['Thriller'], 'disaster film': ['Thriller'], 'suspense': ['Thriller'],
  'war film': ['War'], 'anti-war film': ['War'],
  'western film': ['Western'], 'western': ['Western'], 'spaghetti western': ['Western'],
}));

/**
 * At most four, so the badge row stays readable on a listing card.
 *
 * Wikidata returns genres in no useful order, and a blind `.slice(0, 4)` throws
 * away whichever happened to come last. Format markers go first because they are
 * the most informative word on the badge for this programme — a Silent Film
 * Festival screening that does not say "Silent" has lost the point of the label.
 */
const FIRST = ['Silent', 'Animation', 'Documentary'];

export function mapGenres(raw) {
  const out = [];
  for (const g of raw) {
    for (const mapped of GENRE_MAP.get(String(g).toLowerCase().trim()) ?? []) {
      if (!out.includes(mapped)) out.push(mapped);
    }
  }
  out.sort((a, b) => {
    const ai = FIRST.indexOf(a), bi = FIRST.indexOf(b);
    return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
  });
  return out.slice(0, 4);
}

// ------------------------------------------------------------------ wikidata

const SPARQL = 'https://query.wikidata.org/sparql';
const UA = 'KenworthyGenreBackfill/1.0 (https://kenworthy.org; ops@kenworthy.org)';

async function lookup(labels) {
  const values = labels.map((l) => `"${l.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@en`).join(' ');
  const query = `
    SELECT ?label ?film ?genreLabel WHERE {
      VALUES ?label { ${values} }
      ?film rdfs:label ?label .
      ?film wdt:P31/wdt:P279* wd:Q11424 .
      OPTIONAL {
        { ?film wdt:P136 ?g } UNION { ?film wdt:P31 ?g }
        ?g rdfs:label ?genreLabel . FILTER(lang(?genreLabel)="en")
      }
    }`;
  const res = await fetch(`${SPARQL}?query=${encodeURIComponent(query)}&format=json`, {
    headers: { 'User-Agent': UA, Accept: 'application/sparql-results+json' },
  });
  if (!res.ok) throw new Error(`SPARQL ${res.status}`);
  const json = await res.json();
  const byLabel = new Map();
  for (const b of json.results.bindings) {
    const label = b.label.value;
    if (!byLabel.has(label)) byLabel.set(label, { films: new Set(), genres: new Map() });
    const e = byLabel.get(label);
    e.films.add(b.film.value);
    if (b.genreLabel) {
      if (!e.genres.has(b.film.value)) e.genres.set(b.film.value, []);
      e.genres.get(b.film.value).push(b.genreLabel.value);
    }
  }
  return byLabel;
}

// ---------------------------------------------------------------------- main

async function fetchAll() {
  const rows = [];
  for (let from = 0; ; from += 1000) {
    // PostgREST silently caps a select at 1000 rows, so this pages explicitly.
    const res = await fetch(`${API}/movies?select=id,title,genre&limit=1000&offset=${from}`, { headers: H });
    if (!res.ok) throw new Error(`movies read ${res.status}: ${await res.text()}`);
    const batch = await res.json();
    rows.push(...batch);
    if (batch.length < 1000) return rows;
  }
}

const movies = await fetchAll();
const skipped = [];
const candidates = [];
for (const row of movies) {
  const c = isCandidate(row);
  if (c.ok) candidates.push({ ...row, clean: c.clean });
  else skipped.push({ ...row, why: c.why });
}
console.log(`${env}: ${movies.length} movies, ${candidates.length} candidates, ${skipped.length} skipped`);

const byClean = new Map();
for (const c of candidates) {
  if (!byClean.has(c.clean)) byClean.set(c.clean, []);
  byClean.get(c.clean).push(c);
}
const labels = [...byClean.keys()];
const resolved = new Map();
const dropped = [];
for (let i = 0; i < labels.length; i += 60) {
  const chunk = labels.slice(i, i + 60);
  process.stdout.write(`  wikidata ${i + chunk.length}/${labels.length}\r`);
  let hits = null;
  for (let attempt = 1; attempt <= 4 && !hits; attempt++) {
    try { hits = await lookup(chunk); }
    catch (e) {
      if (attempt === 4) { dropped.push(...chunk); console.error(`\n  batch ${i} gave up after 4 tries: ${e.message}`); }
      else await new Promise((r) => setTimeout(r, attempt * 3000));
    }
  }
  if (!hits) continue;
  for (const [label, e] of hits) resolved.set(label, e);
  await new Promise((r) => setTimeout(r, 900)); // be a good citizen
}
console.log('');

const writes = [];
const rejected = [];
for (const [clean, rows] of byClean) {
  const e = resolved.get(clean);
  if (!e) { rejected.push({ clean, why: 'no film with that exact title' }); continue; }
  if (e.films.size > 1) {
    rejected.push({ clean, why: `ambiguous — ${e.films.size} different films share this title` });
    continue;
  }
  const film = [...e.films][0];
  const genres = mapGenres(e.genres.get(film) ?? []);
  if (!genres.length) { rejected.push({ clean, why: 'matched, but no mappable genre' }); continue; }
  for (const row of rows) writes.push({ id: row.id, title: row.title, clean, genre: genres.join(', '), film });
}

const stamp = new Date().toISOString().slice(0, 10);
const csv = ['id,title,matched_title,genres,wikidata']
  .concat(writes.map((w) => [w.id, w.title, w.clean, w.genre, w.film].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(',')))
  .join('\n');
writeFileSync(`genre-backfill-${env}-${stamp}.csv`, csv);

console.log(`\n  would write : ${writes.length} rows`);
console.log(`  no match    : ${rejected.filter((r) => r.why.startsWith('no film')).length}`);
console.log(`  ambiguous   : ${rejected.filter((r) => r.why.startsWith('ambiguous')).length}`);
console.log(`  no genre    : ${rejected.filter((r) => r.why.startsWith('matched')).length}`);
console.log(`  report      : genre-backfill-${env}-${stamp}.csv`);
// Never let a network failure masquerade as "this film has no genre".
if (dropped.length) console.log(`  NOT CHECKED : ${dropped.length} titles — Wikidata errored; re-run to cover them`);

if (!APPLY) { console.log('\ndry run — nothing written. Re-run with --apply to write.'); process.exit(0); }

let ok = 0, bad = 0;
for (const w of writes) {
  // An RLS denial returns 204 with no error, so the write is only believed when
  // the row comes back. Prefer=return=representation + a length check is the
  // difference between "wrote 900 rows" and "wrote 900 rows, we think".
  const res = await fetch(`${API}/movies?id=eq.${w.id}&genre=is.null`, {
    method: 'PATCH',
    headers: { ...H, Prefer: 'return=representation' },
    body: JSON.stringify({ genre: w.genre }),
  });
  const body = res.ok ? await res.json() : await res.text();
  if (res.ok && Array.isArray(body) && body.length === 1 && body[0].genre === w.genre) ok++;
  else { bad++; console.error(`  FAILED ${w.title}: ${res.status} ${JSON.stringify(body).slice(0, 120)}`); }
}
console.log(`\napplied: ${ok} written, ${bad} failed`);
