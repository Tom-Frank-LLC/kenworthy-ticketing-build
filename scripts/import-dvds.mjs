#!/usr/bin/env node
/**
 * Load the DVD inventory CSV into the `dvds` table.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
 *   node scripts/import-dvds.mjs [--csv path] [--force] [--dry-run]
 *
 * Never commit a service-role key — pass it through the environment for the run only.
 *
 * The table has no unique constraint on `title` (and the inventory genuinely contains
 * repeated titles), so a second run would duplicate every row. The script therefore
 * refuses to insert when `dvds` is non-empty unless `--force` is passed.
 */
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { parseCsv } from './lib/csv.mjs';

const DEFAULT_CSV = new URL('./data/dvds_inventory_import.csv', import.meta.url).pathname;
const BATCH_SIZE = 500;

const args = process.argv.slice(2);
const force = args.includes('--force');
const dryRun = args.includes('--dry-run');
const csvPath = args.includes('--csv') ? args[args.indexOf('--csv') + 1] : DEFAULT_CSV;

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceRoleKey) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set');
  process.exit(1);
}

/** '' -> null, so blank CSV cells become NULL rather than empty strings. */
const text = (v) => {
  const s = (v ?? '').trim();
  return s === '' ? null : s;
};
const int = (v) => (text(v) === null ? null : Number.parseInt(v, 10));
const num = (v) => (text(v) === null ? null : Number.parseFloat(v));
const bool = (v) => (text(v) === null ? null : v.trim().toLowerCase() === 'true');

const COLUMNS = {
  title: text,
  year: int,
  director: text,
  genre: text,
  synopsis: text,
  cover_url: text,
  copies_total: int,
  copies_available: int,
  rental_price: num,
  is_active: bool,
  notes: text,
};

const { header, rows } = parseCsv(readFileSync(csvPath, 'utf8'));

const unknown = header.filter((h) => !(h in COLUMNS));
if (unknown.length) throw new Error(`CSV has columns the table doesn't take: ${unknown.join(', ')}`);

const records = rows.map((row, i) => {
  const record = {};
  header.forEach((col, j) => {
    const value = COLUMNS[col](row[j]);
    // Let the column default apply rather than writing an explicit NULL into a NOT NULL column.
    if (value !== null) record[col] = value;
  });
  if (!record.title) throw new Error(`row ${i + 2} of ${csvPath} has no title`);
  return record;
});

console.log(`${csvPath}: ${records.length} rows -> ${url}`);

const supabase = createClient(url, serviceRoleKey, { auth: { persistSession: false } });

const { count, error: countError } = await supabase
  .from('dvds')
  .select('*', { count: 'exact', head: true });
if (countError) throw new Error(`could not count existing dvds: ${countError.message}`);

console.log(`existing rows in dvds: ${count}`);
if (count > 0 && !force) {
  console.error('refusing to insert into a non-empty dvds table — re-run with --force if you mean it');
  process.exit(1);
}

if (dryRun) {
  console.log('--dry-run: parsed and validated, nothing inserted');
  console.log('first record:', records[0]);
  process.exit(0);
}

let inserted = 0;
for (let i = 0; i < records.length; i += BATCH_SIZE) {
  const batch = records.slice(i, i + BATCH_SIZE);
  // .select() so a silently-blocked write shows up as 0 returned rows instead of a clean 204.
  const { data, error } = await supabase.from('dvds').insert(batch).select('id');
  if (error) throw new Error(`batch at offset ${i} failed: ${error.message}`);
  if (data.length !== batch.length) {
    throw new Error(`batch at offset ${i}: sent ${batch.length} rows but ${data.length} came back`);
  }
  inserted += data.length;
  console.log(`  inserted ${inserted}/${records.length}`);
}

const { count: finalCount } = await supabase
  .from('dvds')
  .select('*', { count: 'exact', head: true });
console.log(`done — inserted ${inserted}, dvds now holds ${finalCount} rows`);
