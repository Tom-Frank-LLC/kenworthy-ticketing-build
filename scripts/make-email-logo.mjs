#!/usr/bin/env node
// Generate public/email-logo.png — the wordmark used in transactional email headers.
//
// Why this exists rather than "just use the logo in src/assets":
//
//   1. Email clients need a *stable absolute URL*. Anything under src/assets is
//      content-hashed by Vite at build time, so its URL changes on every build
//      and an email sent last month would 404. public/ is served verbatim at the
//      site root, so ${SITE_URL}/email-logo.png is durable.
//   2. Gmail drops SVG in <img>, so it has to be a PNG.
//   3. The source artwork (kenworthy-full-logo.png) is BLACK on transparent.
//      The email header sits on brand.bg (#0F0F0F), so black-on-black would be
//      invisible. The site solves this with a CSS `invert()` filter
//      (src/components/brand/KenworthyLogo.tsx) — email has no filters, so the
//      recolour has to be baked into the file.
//
// This recolours every pixel's RGB to brand.cream while preserving the alpha
// channel, which is the correct operation for black-on-transparent artwork:
// antialiased edge pixels keep their partial alpha and simply composite as
// lighter cream instead of lighter black.
//
// Run after any change to the source logo or to `cream` in
// supabase/functions/_shared/brand.ts:
//
//   node scripts/make-email-logo.mjs
//
// Requires `sips` (macOS, for the resample) and `pngjs`.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE = join(repoRoot, 'src/assets/kenworthy-full-logo.png');
const OUTPUT = join(repoRoot, 'public/email-logo.png');

// Must match `cream` in supabase/functions/_shared/brand.ts (--foreground).
const CREAM = { r: 0xf4, g: 0xf1, b: 0xeb };

// Displayed at 180px wide in the email; rendered at 2x so it stays crisp on
// retina screens and in clients that upscale.
const WIDTH = 360;

const work = mkdtempSync(join(tmpdir(), 'email-logo-'));
try {
  const resized = join(work, 'resized.png');
  // sips resamples with a decent filter and preserves the alpha channel.
  execFileSync('sips', ['-Z', String(WIDTH), SOURCE, '--out', resized], { stdio: 'ignore' });

  const png = PNG.sync.read(readFileSync(resized));
  for (let i = 0; i < png.data.length; i += 4) {
    // Alpha (i + 3) is deliberately left alone — it carries the whole shape.
    png.data[i] = CREAM.r;
    png.data[i + 1] = CREAM.g;
    png.data[i + 2] = CREAM.b;
  }
  writeFileSync(OUTPUT, PNG.sync.write(png));

  console.log(`Wrote ${OUTPUT} — ${png.width}x${png.height}, cream on transparent.`);
} finally {
  rmSync(work, { recursive: true, force: true });
}
