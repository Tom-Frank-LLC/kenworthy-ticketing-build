// Resolve our film titles to Wikidata items, matched on title AND release year.
//
// The rules are the ones scripts/backfill-archive-credits.mjs used for director
// and cast (#419, docs/FINDINGS-archive-credits-backfill.md), lifted here so the
// poster backfill matches films exactly the same way:
//   - an English label or alias equal to the title, an instance of film,
//     published within YEAR_SLACK years of ours;
//   - if several qualify, the single nearest year wins, and a tie is skipped.
// That script keeps its own copy: it has already run, and is left as it ran.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

export const YEAR_SLACK = 2;
const SPARQL = 'https://query.wikidata.org/sparql';
let BATCH = 50;
/** Titles per label query. Larger batches mean fewer requests under a rate limit. */
export const setBatch = (n) => { BATCH = n; };

export function openCache(path, empty) {
  const cache = path && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : empty;
  return { cache, save: () => path && writeFileSync(path, JSON.stringify(cache)) };
}

export const lit = (s) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"@en`;

/**
 * gapMs spaces requests at least that far apart. The query service sometimes
 * rate-limits everyone hard (1 request a minute during its Nov 2026 outage),
 * and retrying into a 429 only extends the wait.
 */
export function makeSparql(userAgent, { gapMs = 700 } = {}) {
  let last = 0;
  return async function sparql(query, { attempts = 5 } = {}) {
    for (let attempt = 1; ; attempt++) {
      const wait = last + gapMs - Date.now();
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      last = Date.now();
      try {
        const res = await fetch(SPARQL, {
          method: 'POST',
          headers: { 'User-Agent': userAgent, Accept: 'application/sparql-results+json', 'Content-Type': 'application/x-www-form-urlencoded' },
          body: new URLSearchParams({ query }),
        });
        if (res.status === 429) {
          // Not a failure of this query: wait as told and ask again.
          const after = Number(res.headers.get('retry-after')) || 60;
          await new Promise((r) => setTimeout(r, after * 1000));
          attempt--;
          continue;
        }
        if (!res.ok) throw new Error(`SPARQL ${res.status}`);
        const json = await res.json();
        return json.results.bindings;
      } catch (e) {
        if (attempt >= attempts) throw e;
        await new Promise((r) => setTimeout(r, attempt * 4000));
      }
    }
  };
}

/**
 * Fills cache.labels: label -> [{ qid, year }] for every film carrying that
 * English label or alias. A batch the query service times out on (504) is split
 * in half and retried, so one slow title (a common word with thousands of
 * matching items) cannot sink the other 49. A single title that still times
 * out is recorded in cache.timedOut and left unresolved.
 */
export async function resolveLabels(sparql, labels, cache, save) {
  cache.timedOut ??= [];
  const todo = labels.filter((l) => !(l in cache.labels) && !cache.timedOut.includes(l));
  let done = 0;
  const run = async (chunk) => {
    let rows;
    try {
      rows = await sparql(`
        SELECT ?label ?film (MIN(YEAR(?d)) AS ?y) WHERE {
          VALUES ?label { ${chunk.map(lit).join(' ')} }
          ?film rdfs:label|skos:altLabel ?label ;
                wdt:P31/wdt:P279* wd:Q11424 ;
                wdt:P577 ?d .
        } GROUP BY ?label ?film`, { attempts: chunk.length > 1 ? 2 : 3 });
    } catch (e) {
      if (chunk.length === 1) { cache.timedOut.push(chunk[0]); save(); done++; return; }
      const half = Math.ceil(chunk.length / 2);
      await run(chunk.slice(0, half));
      await run(chunk.slice(half));
      return;
    }
    for (const l of chunk) cache.labels[l] = [];
    for (const b of rows) {
      // No year (unusual date precision or calendar): can't be matched on year.
      if (!b.y) continue;
      cache.labels[b.label.value].push({ qid: b.film.value.split('/').pop(), year: Number(b.y.value) });
    }
    save();
    done += chunk.length;
    process.stdout.write(`  titles ${done}/${todo.length}\r`);
  };
  for (let i = 0; i < todo.length; i += BATCH) await run(todo.slice(i, i + BATCH));
  if (todo.length) console.log('');
}

/** { qid, wdYear } for the one film that matches, or { why } when none or several do. */
export function pickFilm(cache, label, year, overrides = {}) {
  const pinned = overrides[`${label}|${year}`];
  if (pinned) return { qid: pinned, wdYear: year };
  const all = cache.labels[label] ?? [];
  // The same film can come back twice (label and alias); count distinct films.
  const byQid = new Map();
  for (const c of all) {
    const gap = Math.abs(c.year - year);
    if (gap > YEAR_SLACK) continue;
    if (!byQid.has(c.qid) || byQid.get(c.qid).gap > gap) byQid.set(c.qid, { ...c, gap });
  }
  const cands = [...byQid.values()].sort((a, b) => a.gap - b.gap);
  if (!cands.length) return { why: all.length ? 'title found, no film within 2 years' : 'no film with that title' };
  if (cands.length > 1 && cands[0].gap === cands[1].gap) return { why: `ambiguous: ${cands.length} films` };
  return { qid: cands[0].qid, wdYear: cands[0].year };
}
