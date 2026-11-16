#!/usr/bin/env node
// Find public-domain posters for films with no working poster, from Wikimedia
// Commons via Wikidata. Only public-domain files are taken.
//
// WHY THIS SOURCE
//   Posters belong to the studios and distributors. An image found by web search
//   carries no licence, and TMDB's terms rule out commercial use (decided Aug
//   2026, 18bfa0b). Commons hosts only freely licensed files and states each
//   file's licence; Wikidata's "film poster" (P3383) points a film at its Commons
//   file. Old posters are often public domain in the US: published 1930 or
//   earlier, or later without a copyright notice or without a renewal. We take a
//   file only when Commons marks it public domain, and record the licence it
//   states for every file. See docs/FINDINGS-archive-posters-commons.md.
//
//   1. Export (read-only), with the CLI linked to the target project:
//        supabase db query --linked -f scripts/sql/archive-poster-candidates.sql > films.json
//   2. Match and download (network: query.wikidata.org, commons.wikimedia.org,
//      upload.wikimedia.org; no database access):
//        node scripts/backfill-archive-posters.mjs --in films.json --out <dir> [--cache wd-cache.json]
//          [--batch 150 --sparql-gap 65]   (when the query service is rate-limiting)
//      writes <dir>/report.csv (every film: found or why not), <dir>/found.json and
//      <dir>/img/<movie id>.<ext> (Commons thumbnails, 960px wide).
//   3. LOOK AT EVERY IMAGE. A Wikidata poster can belong to a remake of the same
//      name, or be a lobby card or still. Write the ids you keep, one per line.
//   4. Upload the kept images to posters/commons/<id>.jpg, then:
//        node scripts/backfill-archive-posters.mjs --in films.json --out <dir> \
//          --keep keep.txt --storage-base https://<ref>.supabase.co/storage/v1/object/public/posters/commons
//      writes <dir>/apply.sql. It fills a poster only where the listing's poster is
//      still what the export saw (blank, or that dead URL), under audit_bulk_begin.
//      Apply with `supabase db query --linked -f <dir>/apply.sql` (not db push:
//      audit_bulk_begin admits only a postgres login).

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { cleanTitle, EXCLUDE_STRANDS, EXCLUDE_WORDS } from './lib/film-titles.mjs';
import { makeSparql, openCache, pickFilm, resolveLabels, setBatch } from './lib/wikidata-films.mjs';

const args = process.argv.slice(2);
const arg = (k) => (args.includes(k) ? args[args.indexOf(k) + 1] : null);
const IN = arg('--in');
const OUT = arg('--out');
const CACHE = arg('--cache');
const KEEP = arg('--keep');
const STORAGE_BASE = arg('--storage-base');
const GAP_S = Number(arg('--sparql-gap') ?? 0.7);
const LABEL_BATCH = Number(arg('--batch') ?? 50);
if (!IN || !OUT || (KEEP && !STORAGE_BASE)) {
  console.error('usage: backfill-archive-posters.mjs --in films.json --out <dir> [--cache wd-cache.json] [--keep keep.txt --storage-base <url>]');
  process.exit(1);
}

const UA = 'ArchivePosterMatcher/1.0';
/**
 * From 1 March 1989 a US work is copyrighted with or without a notice, so a
 * public-domain poster for a later film is essentially never there to find.
 * Those films are skipped rather than looked up.
 */
const LAST_YEAR = 1989;
const COMMONS_API = 'https://commons.wikimedia.org/w/api.php';
// One of Wikimedia's standard thumbnail widths: other widths are rendered on
// demand and rate-limited hard (429 after a few dozen requests).
const THUMB_WIDTH = 960;
const BATCH = 200; // Wikidata poster lookups by QID are cheap
const COMMONS_BATCH = 50; // the API's limit on titles per query

/** Matches found wrong on review, pinned to the right film: "title|year" -> QID. */
const OVERRIDES = {
  'Pinocchio|2022': 'Q73895818', // carried over from backfill-archive-credits
};

const readRows = (path) => {
  const text = readFileSync(path, 'utf8');
  const parsed = JSON.parse(text.slice(text.search(/[[{]/)));
  return Array.isArray(parsed) ? parsed : parsed.rows;
};
const films = readRows(IN);
mkdirSync(join(OUT, 'img'), { recursive: true });

// ------------------------------------------------------------------ apply step

if (KEEP) {
  const found = JSON.parse(readFileSync(join(OUT, 'found.json'), 'utf8'));
  const byId = new Map(found.map((f) => [f.id, f]));
  const keep = readFileSync(KEEP, 'utf8').split('\n').map((s) => s.trim()).filter(Boolean);
  const missing = keep.filter((id) => !byId.has(id));
  if (missing.length) { console.error(`not in found.json: ${missing.join(', ')}`); process.exit(1); }
  const sq = (v) => (v == null ? 'NULL' : `'${String(v).replace(/'/g, "''")}'`);
  const values = keep.map((id) => {
    const f = byId.get(id);
    return `('${id}'::uuid, ${sq(f.poster_url)}, ${sq(`${STORAGE_BASE.replace(/\/$/, '')}/${id}.jpg`)})`;
  }).join(',\n    ');
  writeFileSync(join(OUT, 'apply.sql'), `-- backfill-archive-posters: ${keep.length} public-domain posters from Wikimedia Commons.
-- Fills only where the poster is still what the export saw (blank, or that dead URL).
DO $$
DECLARE v_run uuid; v_n integer;
BEGIN
  v_run := public.audit_bulk_begin(ARRAY['movies'], 'archive.backfill_posters', '{}'::jsonb, 15, NULL);
  UPDATE public.movies m
     SET poster_url = v.new_url
    FROM (VALUES
    ${values}
    ) AS v(id, old_url, new_url)
   WHERE m.id = v.id
     AND m.poster_url IS NOT DISTINCT FROM v.old_url;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  PERFORM public.audit_bulk_end(v_run, 'archive.backfill_posters', jsonb_build_object('movies_updated', v_n, 'expected', ${keep.length}, 'source', 'wikimedia commons (public domain)'), NULL);
  RAISE NOTICE 'posters filled: % of %', v_n, ${keep.length};
END
$$;
`);
  console.log(`wrote apply.sql for ${keep.length} films`);
  process.exit(0);
}

// ------------------------------------------------------------------ match

setBatch(LABEL_BATCH);
const sparql = makeSparql(UA, { gapMs: GAP_S * 1000 });
const { cache, save } = openCache(CACHE, { labels: {}, posters: {}, files: {} });
cache.posters ??= {};
cache.files ??= {};

const report = [];
const want = [];
for (const f of films) {
  const { title, strand } = cleanTitle(f.title);
  let why = null;
  if (!f.year) why = 'no release year';
  else if (f.year > LAST_YEAR) why = `after ${LAST_YEAR}: poster not public domain`;
  else if (strand && EXCLUDE_STRANDS.includes(strand)) why = `not a film (${strand})`;
  else if (EXCLUDE_WORDS.test(f.title)) why = 'not a screening';
  else if (title.length < 2) why = 'title too short';
  if (why) report.push({ f, why });
  else want.push({ f, label: title });
}
console.log(`${films.length} films; ${want.length} to look up`);

await resolveLabels(sparql, [...new Set(want.map((w) => w.label))], cache, save);

const matched = [];
for (const { f, label } of want) {
  const m = pickFilm(cache, label, f.year, OVERRIDES);
  if (m.why) report.push({ f, why: cache.timedOut?.includes(label) ? 'wikidata lookup timed out' : m.why });
  else matched.push({ f, ...m });
}

// ------------------------------------------------------------------ wikidata P3383

const qids = [...new Set(matched.map((m) => m.qid))].filter((q) => !(q in cache.posters));
for (let i = 0; i < qids.length; i += BATCH) {
  const chunk = qids.slice(i, i + BATCH);
  process.stdout.write(`  posters ${Math.min(i + BATCH, qids.length)}/${qids.length}\r`);
  const rows = await sparql(`SELECT ?film ?p WHERE { VALUES ?film { ${chunk.map((q) => `wd:${q}`).join(' ')} } ?film wdt:P3383 ?p }`);
  for (const q of chunk) cache.posters[q] = [];
  for (const b of rows) {
    // ?p is http://commons.wikimedia.org/wiki/Special:FilePath/<name>
    cache.posters[b.film.value.split('/').pop()].push(decodeURIComponent(b.p.value.split('/').pop()));
  }
  save();
}
if (qids.length) console.log('');

// ------------------------------------------------------------------ commons licence

const files = [...new Set(matched.flatMap((m) => cache.posters[m.qid] ?? []))].filter((n) => !(n in cache.files));
for (let i = 0; i < files.length; i += COMMONS_BATCH) {
  const chunk = files.slice(i, i + COMMONS_BATCH);
  process.stdout.write(`  commons ${Math.min(i + COMMONS_BATCH, files.length)}/${files.length}\r`);
  const qs = new URLSearchParams({
    action: 'query', format: 'json', formatversion: '2', prop: 'imageinfo',
    iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(THUMB_WIDTH),
    iiextmetadatafilter: 'License|LicenseShortName|UsageTerms|Copyrighted|NonFree|Artist|DateTimeOriginal',
    titles: chunk.map((n) => `File:${n}`).join('|'),
  });
  const res = await fetch(`${COMMONS_API}?${qs}`, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`commons ${res.status}`);
  const json = await res.json();
  // Commons normalizes titles (underscores to spaces); map back to what we asked.
  const norm = new Map((json.query.normalized ?? []).map((n) => [n.to, n.from]));
  for (const n of chunk) cache.files[n] = null;
  for (const p of json.query.pages ?? []) {
    const asked = (norm.get(p.title) ?? p.title).replace(/^File:/, '');
    const ii = p.imageinfo?.[0];
    if (!ii) continue;
    const md = ii.extmetadata ?? {};
    const v = (k) => md[k]?.value ?? null;
    cache.files[asked] = {
      page: ii.descriptionurl, thumb: ii.thumburl, width: ii.width, height: ii.height, mime: ii.mime,
      license: v('License'), licenseName: v('LicenseShortName'), usage: v('UsageTerms'),
      copyrighted: v('Copyrighted'), nonFree: v('NonFree'),
      artist: v('Artist')?.replace(/<[^>]+>/g, '').trim() ?? null, date: v('DateTimeOriginal')?.replace(/<[^>]+>/g, '').trim() ?? null,
    };
  }
  save();
  await new Promise((r) => setTimeout(r, 300));
}
if (files.length) console.log('');

/** Public domain as Commons states it: the licence code is pd-*, or the file is marked not copyrighted. */
/**
 * Poster-shaped: portrait (at least 1.2 tall per wide) and at least 280px wide.
 * Wikidata's "film poster" sometimes holds a landscape lobby card, a newspaper
 * ad or a programme spread (seen on review); those fill the 2:3 poster slot
 * badly, and a file narrower than 280px blurs at the page's poster width.
 */
const MIN_WIDTH = 280;
const MIN_RATIO = 1.2;
const isPosterShaped = (c) => c.width >= MIN_WIDTH && c.height / c.width >= MIN_RATIO;

const isPublicDomain = (c) => !!c && !c.nonFree && (/^pd/i.test(c.license ?? '') || c.copyrighted === 'False');

// ------------------------------------------------------------------ choose + download

const found = [];
for (const m of matched) {
  const names = cache.posters[m.qid] ?? [];
  if (!names.length) { report.push({ f: m.f, why: 'matched, no poster on Wikidata', qid: m.qid }); continue; }
  const pd = names.map((n) => ({ n, c: cache.files[n] })).filter(({ c }) => isPublicDomain(c));
  if (!pd.length) {
    const c = cache.files[names[0]];
    report.push({ f: m.f, why: c ? `poster not public domain (${c.licenseName ?? c.license ?? 'no licence stated'})` : 'poster file missing on Commons', qid: m.qid, file: names[0] });
    continue;
  }
  const shaped = pd.filter(({ c }) => isPosterShaped(c));
  if (!shaped.length) {
    const c = pd[0].c;
    report.push({ f: m.f, why: `not poster-shaped (${c.width}x${c.height})`, qid: m.qid, file: pd[0].n, licence: c.licenseName });
    continue;
  }
  const { n, c } = shaped[0];
  found.push({ id: m.f.id, title: m.f.title, year: m.f.year, poster_url: m.f.poster_url, qid: m.qid, wdYear: m.wdYear, file: n, ...c });
}

let done = 0;
async function download(f) {
  // A thumb URL cached at another width: ask for the standard one instead.
  f.thumb = f.thumb.replace(/\/\d+px-([^/]+)$/, `/${THUMB_WIDTH}px-$1`);
  const ext = (f.thumb.match(/\.(\w+)$/)?.[1] ?? 'jpg').toLowerCase();
  const path = join(OUT, 'img', `${f.id}.${ext}`);
  f.local = path;
  if (existsSync(path)) return;
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(f.thumb, { headers: { 'User-Agent': UA } });
    if (res.ok) { writeFileSync(path, Buffer.from(await res.arrayBuffer())); break; }
    if (attempt >= 6) { f.downloadError = `HTTP ${res.status}`; return; }
    // upload.wikimedia.org answers 429 to a burst; wait as told.
    const after = res.status === 429 ? (Number(res.headers.get('retry-after')) || 20) : attempt * 3;
    await new Promise((r) => setTimeout(r, after * 1000));
  }
  await new Promise((r) => setTimeout(r, 1000));
  process.stdout.write(`  images ${++done}\r`);
}
// One at a time: the image server rate-limits parallel fetches.
for (const f of found) await download(f);
if (found.length) console.log('');

for (const f of found) report.push({ f: films.find((x) => x.id === f.id), why: f.downloadError ? `download failed (${f.downloadError})` : 'found', qid: f.qid, file: f.file, licence: f.licenseName });

// ------------------------------------------------------------------ output

const csvCell = (v) => (v == null ? '' : /[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
writeFileSync(join(OUT, 'report.csv'), [
  'id,title,year,archival,result,wikidata,commons_file,licence',
  ...report.map((r) => [r.f.id, r.f.title, r.f.year, r.f.is_archival, r.why, r.qid ?? '', r.file ?? '', r.licence ?? ''].map(csvCell).join(',')),
].join('\n') + '\n');
writeFileSync(join(OUT, 'found.json'), JSON.stringify(found.filter((f) => !f.downloadError), null, 1));

const tally = {};
for (const r of report) { const k = r.why.replace(/ \(.*\)$/, '').replace(/: \d+ films$/, ''); tally[k] = (tally[k] ?? 0) + 1; }
const lic = {};
for (const f of found) lic[f.licenseName ?? f.license] = (lic[f.licenseName ?? f.license] ?? 0) + 1;
const summary = [
  `films: ${films.length}`,
  ...Object.entries(tally).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`),
  'licences of found posters:',
  ...Object.entries(lic).sort((a, b) => b[1] - a[1]).map(([k, n]) => `  ${k}: ${n}`),
].join('\n');
writeFileSync(join(OUT, 'summary.txt'), summary + '\n');
console.log(summary);
