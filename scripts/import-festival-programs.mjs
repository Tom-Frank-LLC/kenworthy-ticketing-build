/**
 * Import scanned festival programs into the festival-programs bucket.
 *
 *   SUPABASE_URL=https://<ref>.supabase.co \
 *   SUPABASE_SERVICE_ROLE_KEY=<service-role key> \
 *   node scripts/import-festival-programs.mjs "<archive dir>" [--dry-run] [--replace] [--publish]
 *
 * Rows land UNPUBLISHED unless --publish is given, so nothing appears on the
 * public page until someone has looked at it in Admin → Festival.
 *
 * ---------------------------------------------------------------------------
 * What it expects to find
 * ---------------------------------------------------------------------------
 *
 * The archive is not uniform and is not going to become uniform, because each
 * year was handed over in whatever form that year's designer had. So the rules
 * are shape-based rather than a fixed list:
 *
 *   A DIRECTORY whose name contains a year  → its images are that year's pages,
 *   ordered by the leading number in each filename (1.png, 2.png, …).
 *
 *   A PDF FILE whose name contains a year   → that year's whole programme. Every
 *   page is rendered to an image so the year is browsable, AND the PDF itself is
 *   uploaded so the full thing can be downloaded.
 *
 * PDFs *inside* a year directory are deliberately SKIPPED. In the 2023 folder
 * those are the printer's spreads — back cover and front cover imposed on one
 * landscape sheet — which is the right artefact for reprinting and the wrong one
 * for reading online. The same content is already there as single portrait
 * pages. Pass --include-spreads if you ever want them anyway.
 *
 * ---------------------------------------------------------------------------
 * Why the files are re-encoded rather than uploaded as they are
 * ---------------------------------------------------------------------------
 *
 * Page one of 2023 is a 24 MB, 3559×5500 PNG. Nothing on the web wants that:
 * the archive grid asks for a ~400px thumbnail (via Supabase's image transform
 * endpoint) and a reader who clicks through wants a page they can read, not a
 * print master. Both are served from one stored file, so that file is
 * normalised to PAGE_WIDTH — wide enough to read every word, ~95% smaller.
 *
 * The originals are untouched on disk. This script only ever reads them.
 */
import { createClient } from '@supabase/supabase-js';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { basename, extname, join } from 'node:path';
import { tmpdir } from 'node:os';

const BUCKET = 'festival-programs';
const FESTIVAL_SLUG = 'silent-film-festival';

/** Stored page width. A 5.5in booklet page at this width is ~360dpi. */
const PAGE_WIDTH = 2000;
/** High enough that small caption type stays crisp; JPEG because these are scans. */
const PAGE_QUALITY = 88;

const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.webp']);

const args = process.argv.slice(2);
const flags = new Set(args.filter(a => a.startsWith('--')));
const archiveDir = args.find(a => !a.startsWith('--'));

const dryRun = flags.has('--dry-run');
const replace = flags.has('--replace');
const publish = flags.has('--publish');
const includeSpreads = flags.has('--include-spreads');

const url = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!archiveDir) {
  console.error('Usage: node scripts/import-festival-programs.mjs "<archive dir>" [--dry-run] [--replace] [--publish]');
  process.exit(1);
}
if (!dryRun && (!url || !serviceRoleKey)) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set (or pass --dry-run)');
  process.exit(1);
}

for (const tool of ['pdftoppm', 'sips']) {
  try {
    execFileSync('/usr/bin/which', [tool], { stdio: 'ignore' });
  } catch {
    console.error(`Missing required tool: ${tool}. pdftoppm comes from poppler (brew install poppler); sips ships with macOS.`);
    process.exit(1);
  }
}

const supabase = dryRun ? null : createClient(url, serviceRoleKey, { auth: { persistSession: false } });
const work = mkdtempSync(join(tmpdir(), 'festival-programs-'));

/** The first 19xx/20xx in a name. Returns null rather than guessing. */
function yearOf(name) {
  const m = name.match(/\b(19|20)\d{2}\b/);
  return m ? parseInt(m[0], 10) : null;
}

/** Leading number in a filename, for page order. Falls back to name order. */
function leadingNumber(name) {
  const m = basename(name).match(/^(\d+)/);
  return m ? parseInt(m[1], 10) : Number.MAX_SAFE_INTEGER;
}

/** Re-encode to a web-readable page. Returns the new path. */
function normaliseImage(src, outName) {
  const out = join(work, `${outName}.jpg`);
  // --resampleWidth, not -Z: -Z fits the LONGEST side, which on a portrait page
  // caps the height and leaves the width ~35% short of every PDF-rendered page.
  execFileSync('sips', [
    '--resampleWidth', String(PAGE_WIDTH),
    '-s', 'format', 'jpeg',
    '-s', 'formatOptions', String(PAGE_QUALITY),
    src, '--out', out,
  ], { stdio: 'ignore' });
  return out;
}

/** Render every page of a PDF to normalised images, in page order. */
function renderPdfPages(src, outPrefix) {
  // 360dpi on a 5.5in page lands at ~PAGE_WIDTH without a second resample.
  execFileSync('pdftoppm', ['-jpeg', '-r', '360', '-jpegopt', `quality=${PAGE_QUALITY}`,
    src, join(work, outPrefix)], { stdio: 'ignore' });
  return readdirSync(work)
    .filter(f => f.startsWith(`${outPrefix}-`) && f.endsWith('.jpg'))
    .sort((a, b) => leadingNumber(a.slice(outPrefix.length + 1)) - leadingNumber(b.slice(outPrefix.length + 1)))
    .map(f => join(work, f));
}

/** Everything to upload for one year, in display order. */
function planYear(year, entries) {
  return { year, entries };
}

function scan(dir) {
  const plans = [];
  for (const name of readdirSync(dir).sort()) {
    if (name.startsWith('.')) continue;
    const full = join(dir, name);
    const year = yearOf(name);
    if (!year) {
      console.warn(`  ! no year in "${name}" — skipped`);
      continue;
    }

    if (statSync(full).isDirectory()) {
      const files = readdirSync(full).filter(f => !f.startsWith('.'));
      const images = files
        .filter(f => IMAGE_EXT.has(extname(f).toLowerCase()))
        .sort((a, b) => leadingNumber(a) - leadingNumber(b));
      const pdfs = files.filter(f => extname(f).toLowerCase() === '.pdf');

      if (pdfs.length && !includeSpreads) {
        console.log(`  ${year}: skipping ${pdfs.length} PDF(s) in the folder (printer's spreads — pass --include-spreads to keep)`);
      }

      const entries = images.map((f, i) => ({
        kind: 'image',
        source: join(full, f),
        title: `Page ${i + 1}`,
        order: i + 1,
      }));
      if (includeSpreads) {
        pdfs.sort((a, b) => leadingNumber(a) - leadingNumber(b)).forEach((f, i) => {
          entries.push({ kind: 'pdf', source: join(full, f), title: `Print spread ${i + 1}`, order: 900 + i });
        });
      }
      plans.push(planYear(year, entries));
      continue;
    }

    if (extname(name).toLowerCase() === '.pdf') {
      plans.push(planYear(year, [{ kind: 'pdf-booklet', source: full, title: null, order: 0 }]));
    }
  }
  return plans.sort((a, b) => b.year - a.year);
}

async function existingYears() {
  const { data, error } = await supabase
    .from('festival_programs')
    .select('year')
    .eq('festival_slug', FESTIVAL_SLUG);
  if (error) throw error;
  return new Set((data ?? []).map(r => r.year));
}

async function uploadOne({ year, path, body, contentType, title, fileType, order }) {
  const { error: upErr } = await supabase.storage
    .from(BUCKET)
    .upload(path, body, { contentType, upsert: false });
  if (upErr) throw new Error(`upload ${path}: ${upErr.message}`);

  const { data, error } = await supabase
    .from('festival_programs')
    .insert({
      festival_slug: FESTIVAL_SLUG,
      year,
      title,
      file_path: path,
      file_type: fileType,
      display_order: order,
      is_published: publish,
    })
    .select('id');
  if (error) throw new Error(`insert ${path}: ${error.message}`);
  if (!data?.length) throw new Error(`insert ${path}: no row returned`);
}

const plans = scan(archiveDir);
if (!plans.length) {
  console.error(`No year-bearing files or folders found in ${archiveDir}`);
  process.exit(1);
}

console.log(`\n${dryRun ? 'DRY RUN — ' : ''}${plans.length} year(s) found in ${archiveDir}\n`);

let taken = new Set();
if (!dryRun) {
  taken = await existingYears();
}

let uploaded = 0;
try {
  for (const { year, entries } of plans) {
    if (taken.has(year) && !replace) {
      console.log(`  ${year}: already has rows — skipped (pass --replace to re-import)`);
      continue;
    }
    if (taken.has(year) && replace && !dryRun) {
      const { data: old, error } = await supabase
        .from('festival_programs')
        .delete()
        .eq('festival_slug', FESTIVAL_SLUG)
        .eq('year', year)
        .select('file_path');
      if (error) throw error;
      if (old?.length) {
        await supabase.storage.from(BUCKET).remove(old.map(r => r.file_path));
        console.log(`  ${year}: replaced — removed ${old.length} existing file(s)`);
      }
    }

    // Expand each planned entry into the concrete files to upload.
    const files = [];
    for (const entry of entries) {
      if (entry.kind === 'image') {
        files.push({
          body: entry.source, title: entry.title, fileType: 'image',
          order: entry.order, ext: 'jpg', contentType: 'image/jpeg', normalise: true,
        });
      } else if (entry.kind === 'pdf') {
        files.push({
          body: entry.source, title: entry.title, fileType: 'pdf',
          order: entry.order, ext: 'pdf', contentType: 'application/pdf', normalise: false,
        });
      } else if (entry.kind === 'pdf-booklet') {
        const pages = dryRun ? [] : renderPdfPages(entry.source, `y${year}`);
        const pageCount = dryRun
          ? Number(execFileSync('pdfinfo', [entry.source]).toString().match(/Pages:\s+(\d+)/)?.[1] ?? 0)
          : pages.length;
        pages.forEach((p, i) => files.push({
          body: p, title: `Page ${i + 1}`, fileType: 'image',
          order: i + 1, ext: 'jpg', contentType: 'image/jpeg', normalise: false,
        }));
        if (dryRun) {
          for (let i = 0; i < pageCount; i++) {
            files.push({ body: null, title: `Page ${i + 1}`, fileType: 'image', order: i + 1, ext: 'jpg' });
          }
        }
        // The whole booklet, last, so it reads as "and here is the lot".
        files.push({
          body: entry.source, title: `Full programme (${pageCount} pages)`, fileType: 'pdf',
          order: 500, ext: 'pdf', contentType: 'application/pdf', normalise: false,
        });
      }
    }

    console.log(`  ${year}: ${files.filter(f => f.fileType === 'image').length} page image(s)` +
      `${files.some(f => f.fileType === 'pdf') ? ' + PDF' : ''}`);

    if (dryRun) { files.forEach(f => console.log(`      ${String(f.order).padStart(3)}  ${f.title ?? '(untitled)'}  [${f.fileType}]`)); continue; }

    for (const f of files) {
      const src = f.normalise ? normaliseImage(f.body, `n${year}-${f.order}`) : f.body;
      const bytes = readFileSync(src);
      const path = `${FESTIVAL_SLUG}/${year}/${String(f.order).padStart(3, '0')}-${Date.now()}.${f.ext}`;
      await uploadOne({
        year, path, body: bytes, contentType: f.contentType,
        title: f.title, fileType: f.fileType, order: f.order,
      });
      uploaded++;
      process.stdout.write(`      ${f.title} → ${(bytes.length / 1024).toFixed(0)} KB\n`);
    }
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

console.log(`\n${dryRun ? 'Dry run complete — nothing uploaded.' : `Done: ${uploaded} file(s) uploaded, ${publish ? 'published' : 'unpublished (publish them in Admin → Festival)'}.`}\n`);
