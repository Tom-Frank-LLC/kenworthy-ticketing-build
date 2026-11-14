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

import { cleanTitle, isCandidate, mapGenres } from './lib/film-titles.mjs';

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
    const res = await fetch(`${API}/movies?select=id,title,genre&is_archival=eq.false&limit=1000&offset=${from}`, { headers: H });
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
