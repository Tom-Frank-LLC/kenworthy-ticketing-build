#!/usr/bin/env node
/**
 * One-shot cleanup of the messy `Format:` values the source spreadsheet carried.
 * Rewrites scripts/data/dvds_inventory_import.csv in place.
 *
 *   node scripts/normalize-dvd-formats.mjs [--csv path] [--dry-run]
 *
 * Two rules, per the box office:
 *
 *  - A combined format ("DVD + BLU-RAY", "DVD / BLU-RAY", "DVD/BLU-RAY") means the title is
 *    held on BOTH discs, so the row is SPLIT into two — one `Format: DVD`, one
 *    `Format: BLU-RAY`, each keeping its own copies_total. That's a real second physical
 *    disc, not a duplicate listing.
 *  - "DVD X2" (a double-disc set) and "SAME?" (someone's note to themselves) are not formats.
 *    Both become plain `Format: DVD`; the X2 does not change the copy count, since a
 *    two-disc set is still one thing you check out.
 *
 * Other `notes` segments (Keywords, Source) are preserved on both sides of a split.
 * Idempotent: after one run no combined values remain, so re-running is a no-op.
 *
 * The equivalent SQL was applied to the already-loaded production and staging tables —
 * see scripts/data/README.md. Keep the two in step: this CSV is what a fresh import
 * reproduces.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv, toCsv } from './lib/csv.mjs';

const SPLIT_INTO_BOTH = ['DVD + BLU-RAY', 'DVD / BLU-RAY', 'DVD/BLU-RAY'];
const RELABEL_AS_DVD = ['DVD X2', 'SAME?'];

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const csvPath = args.includes('--csv')
  ? args[args.indexOf('--csv') + 1]
  : new URL('./data/dvds_inventory_import.csv', import.meta.url).pathname;

const { header, rows } = parseCsv(readFileSync(csvPath, 'utf8'));
const notesIdx = header.indexOf('notes');
const titleIdx = header.indexOf('title');
if (notesIdx === -1) throw new Error('input CSV has no `notes` column');

const formatOf = (notes) => {
  const seg = (notes || '').split('|').map((s) => s.trim()).find((s) => s.startsWith('Format:'));
  return seg ? seg.slice('Format:'.length).trim() : null;
};

/** Rebuild `notes` with the Format segment set to `format`, other segments untouched. */
const withFormat = (notes, format) =>
  (notes || '')
    .split('|')
    .map((s) => s.trim())
    .map((s) => (s.startsWith('Format:') ? `Format: ${format}` : s))
    .join(' | ');

const out = [];
const changes = [];
for (const row of rows) {
  const format = formatOf(row[notesIdx]);

  if (SPLIT_INTO_BOTH.includes(format)) {
    const dvd = [...row];
    const bluray = [...row];
    dvd[notesIdx] = withFormat(row[notesIdx], 'DVD');
    bluray[notesIdx] = withFormat(row[notesIdx], 'BLU-RAY');
    out.push(dvd, bluray);
    changes.push(`split   ${row[titleIdx]}  (${format}) -> DVD + BLU-RAY rows`);
    continue;
  }

  if (RELABEL_AS_DVD.includes(format)) {
    const fixed = [...row];
    fixed[notesIdx] = withFormat(row[notesIdx], 'DVD');
    out.push(fixed);
    changes.push(`relabel ${row[titleIdx]}  (${format}) -> DVD`);
    continue;
  }

  out.push(row);
}

for (const c of changes) console.log('  ' + c);
console.log(`${rows.length} rows in, ${out.length} rows out (${changes.length} touched)`);

if (dryRun) {
  console.log('--dry-run: nothing written');
} else {
  writeFileSync(csvPath, toCsv(header, out));
  console.log(`wrote ${csvPath}`);
}
