#!/usr/bin/env node
// Generate the wordmark PNGs used in transactional email headers.
//
// Produces two files:
//
//   public/email-logo.png            the standard lockup
//   public/email-logo-centenary.png  the "Celebrating 100 Years" lockup
//
// Both exist at once on purpose. `logoUrl()` in supabase/functions/_shared/brand.ts
// picks between them by date, so the centenary lockup runs through the end of
// 2026 and the standard one takes over automatically in 2027. Because the two
// live at separate stable URLs, an email sent during the centenary keeps
// rendering the centenary lockup forever — which is correct, it is a dated
// artifact — rather than silently changing under the recipient on New Year's Day.
//
// Why generated rather than exported by hand:
//
//   1. Email clients need a *stable absolute URL*. Anything under src/assets is
//      content-hashed by Vite at build time, so its URL changes on every build
//      and an email sent last month would 404. public/ is served verbatim at the
//      site root, so ${SITE_URL}/email-logo.png is durable.
//   2. Gmail drops SVG in <img>, so the centenary artwork — which *is* an SVG —
//      has to be rasterised to PNG.
//   3. Both source files are the wrong colour for the header. The standard
//      lockup is BLACK on transparent (the site fixes this with a CSS invert
//      filter, which email cannot do). The centenary SVG is pure #ffffff, which
//      is brighter than the brand cream. Both are recoloured to brand.cream here,
//      preserving alpha — the correct operation for single-colour artwork on
//      transparency, since antialiased edge pixels keep their partial alpha and
//      simply composite as lighter cream.
//
// Run after changing either source asset or `cream` in brand.ts:
//
//   node scripts/make-email-logo.mjs
//
// Requires `sips` (macOS — rasterises the SVG and resamples) and `pngjs`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// Must match `cream` in supabase/functions/_shared/brand.ts (--foreground).
const CREAM = { r: 0xf4, g: 0xf1, b: 0xeb };

const TARGETS = [
  {
    name: 'standard',
    source: join(repoRoot, 'src/assets/kenworthy-full-logo.png'),
    output: join(repoRoot, 'public/email-logo.png'),
    // Displayed at 180px; rendered at 2x so it stays crisp on retina.
    width: 360,
  },
  {
    name: 'centenary',
    // The git-tracked copy. There is an identical untracked "KPAC-100-logo-white 2.svg"
    // beside it; this script deliberately uses the tracked one so it still works
    // in a fresh clone.
    source: join(repoRoot, 'src/assets/KPAC-100-logo-white.svg'),
    output: join(repoRoot, 'public/email-logo-centenary.png'),
    // Displayed at 200px rather than 180: this lockup carries a third line
    // ("CELEBRATING 100 YEARS") in the same footprint, so at the standard width
    // that line drops below legibility. 2x again.
    width: 400,
  },
];

const work = mkdtempSync(join(tmpdir(), 'email-logo-'));
try {
  for (const t of TARGETS) {
    let raster = t.source;

    if (t.source.endsWith('.svg')) {
      // sips rasterises an SVG at its *declared* width/height, ignoring how much
      // detail the viewBox holds. Doubling the declared size first gives a
      // higher-resolution raster to downsample from, which is visibly cleaner on
      // the thin rule and the small caps than rasterising straight to target.
      const svg = readFileSync(t.source, 'utf8');
      const scaled = svg.replace(
        /width="(\d+)"\s+height="(\d+)"/,
        (_m, w, h) => `width="${Number(w) * 2}" height="${Number(h) * 2}"`,
      );
      const tmpSvg = join(work, `${t.name}.svg`);
      writeFileSync(tmpSvg, scaled);
      raster = join(work, `${t.name}-raster.png`);
      execFileSync('sips', ['-s', 'format', 'png', tmpSvg, '--out', raster], { stdio: 'ignore' });
    }

    const resized = join(work, `${t.name}-resized.png`);
    execFileSync('sips', ['-Z', String(t.width), raster, '--out', resized], { stdio: 'ignore' });

    const png = PNG.sync.read(readFileSync(resized));
    for (let i = 0; i < png.data.length; i += 4) {
      // Alpha (i + 3) is deliberately left alone — it carries the whole shape.
      png.data[i] = CREAM.r;
      png.data[i + 1] = CREAM.g;
      png.data[i + 2] = CREAM.b;
    }
    writeFileSync(t.output, PNG.sync.write(png));

    console.log(`${t.name.padEnd(10)} -> ${t.output}  (${png.width}x${png.height}, cream on transparent)`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
