#!/usr/bin/env node
/**
 * One-shot transform that produced scripts/data/dvds_inventory_import.csv from the
 * delivered dvds_inventory_import.csv.
 *
 * Why this exists: the delivered CSV separated the `notes` segments with "; ", but
 * `parseNote` in src/pages/Dvds.tsx matches `${label}:\s*([^|]+)` — it splits on "|".
 * With semicolons, `Format:` captures the entire remainder of the string, so 43 titles
 * would have produced junk Format options ("DVD; Keywords: HITCHCOCK") instead of "DVD".
 *
 * The transform is deliberately strict: every ";"-separated segment must be a known
 * label, otherwise it aborts rather than guessing.
 *
 *   node scripts/normalize-dvds-csv.mjs <input.csv> <output.csv>
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { parseCsv, toCsv } from './lib/csv.mjs';

const KNOWN_LABELS = ['Format', 'Keywords', 'Source'];

const [inPath, outPath] = process.argv.slice(2);
if (!inPath || !outPath) {
  console.error('usage: node scripts/normalize-dvds-csv.mjs <input.csv> <output.csv>');
  process.exit(1);
}

const { header, rows } = parseCsv(readFileSync(inPath, 'utf8'));
const notesIdx = header.indexOf('notes');
if (notesIdx === -1) throw new Error('input CSV has no `notes` column');

let rewritten = 0;
for (const row of rows) {
  const notes = row[notesIdx];
  if (!notes || !notes.includes(';')) continue;

  const segments = notes.split(';').map((s) => s.trim());
  for (const seg of segments) {
    const label = seg.split(':')[0];
    if (!KNOWN_LABELS.includes(label)) {
      throw new Error(
        `refusing to rewrite: segment ${JSON.stringify(seg)} in ${JSON.stringify(notes)} ` +
          `is not one of ${KNOWN_LABELS.join('/')} — the ";" may not be a separator here`,
      );
    }
  }
  row[notesIdx] = segments.join(' | ');
  rewritten++;
}

writeFileSync(outPath, toCsv(header, rows));
console.log(`rows: ${rows.length}, notes rewritten: ${rewritten} -> ${outPath}`);
