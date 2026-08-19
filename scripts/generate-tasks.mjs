#!/usr/bin/env node
// Regenerates docs/TASKS.md from the frontmatter in docs/briefs/.
//
//   node scripts/generate-tasks.mjs          write docs/TASKS.md
//   node scripts/generate-tasks.mjs --check  exit 1 if the file is out of date
//
// Do not hand-edit docs/TASKS.md; edit a brief's frontmatter and re-run this.
// The one exception is the hand-maintained block at the bottom, which is copied
// through verbatim — it holds items that have no brief behind them, and which a
// naive regeneration would silently delete.
//
// See docs/briefs/.frontmatter-schema.md for the fields.

import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BRIEFS = join(ROOT, 'docs', 'briefs');
const OUT = join(ROOT, 'docs', 'TASKS.md');

const HAND_START = '<!-- HAND-MAINTAINED:START -->';
const HAND_END = '<!-- HAND-MAINTAINED:END -->';

/** Minimal frontmatter reader — scalars and ["a", "b"] lists, which is all the
 *  schema uses. Avoids adding a YAML dependency for ten fields. */
function frontmatter(text) {
  if (!text.startsWith('---')) return null;
  const end = text.indexOf('\n---', 3);
  if (end === -1) return null;
  const out = {};
  for (const line of text.slice(4, end).split('\n')) {
    const m = line.match(/^([a-z_]+):\s*(.*)$/);
    if (!m) continue;
    let [, k, v] = m;
    v = v.trim();
    if (v.startsWith('[')) {
      out[k] = [...v.matchAll(/"([^"]+)"/g)].map((x) => x[1]);
    } else if (v === 'true' || v === 'false') {
      out[k] = v === 'true';
    } else {
      out[k] = v;
    }
  }
  return out;
}

const briefs = readdirSync(BRIEFS)
  .filter((f) => f.startsWith('BRIEF-') && f.endsWith('.md') && !f.endsWith('-OUTCOME.md'))
  .map((f) => ({ file: f, fm: frontmatter(readFileSync(join(BRIEFS, f), 'utf8')) }))
  .filter((b) => b.fm);

const missing = readdirSync(BRIEFS)
  .filter((f) => f.startsWith('BRIEF-') && f.endsWith('.md') && !f.endsWith('-OUTCOME.md'))
  .filter((f) => !frontmatter(readFileSync(join(BRIEFS, f), 'utf8')));

const SEV = { P0: 0, P1: 1, P2: 2, P3: 3 };
const by = (pred) => briefs.filter((b) => pred(b.fm));
const bySeverity = (a, b) =>
  (SEV[a.fm.severity] ?? 9) - (SEV[b.fm.severity] ?? 9) ||
  a.fm.brief.localeCompare(b.fm.brief);

function row(b, { showSeverity = true } = {}) {
  const { fm, file } = b;
  const sev = showSeverity && fm.severity ? `\`${fm.severity}\` ` : '';
  const refs = (fm.shipped_in ?? []).map((r) => `\`${r}\``).join(', ');
  const links = [`[brief](briefs/${encodeURI(file)})`];
  if (fm.findings) links.push(`[notes](briefs/${encodeURI(fm.findings)})`);
  const tail = [refs, links.join(' · ')].filter(Boolean).join(' — ');
  const flag = fm.status === 'shipped' && !fm.verified ? ' ⚠️ unverified' : '';
  return `- ${sev}**${fm.title}**${flag}<br>\`${fm.track}\` — ${tail}`;
}

const triage = by((f) => f.status === 'needs-triage').sort(bySeverity);
const built = by((f) => f.status === 'built').sort(bySeverity);
const open = by((f) => ['queued', 'in-progress'].includes(f.status)).sort(bySeverity);
const shipped = by((f) => f.status === 'shipped')
  .sort((a, b) => (b.fm.shipped_at ?? b.fm.date ?? '').localeCompare(a.fm.shipped_at ?? a.fm.date ?? ''));
const closed = by((f) => ['closed-not-a-bug', 'superseded'].includes(f.status));
const unverified = shipped.filter((b) => !b.fm.verified);

const prev = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
const hand = prev.includes(HAND_START)
  ? prev.slice(prev.indexOf(HAND_START) + HAND_START.length, prev.indexOf(HAND_END)).trim()
  : '_Nothing here yet._';

const L = [];
L.push('# Kenworthy Ticketing — Task catalogue');
L.push('');
L.push('> **Generated** by `scripts/generate-tasks.mjs` from the frontmatter in');
L.push('> `docs/briefs/`. Do not hand-edit above the hand-maintained block —');
L.push('> change a brief\'s frontmatter and re-run the script. Schema:');
L.push('> [`briefs/.frontmatter-schema.md`](briefs/.frontmatter-schema.md).');
L.push('');
L.push(`**${briefs.length} briefs** — ${shipped.length} shipped, ${built.length} built, ` +
       `${open.length} open, ${triage.length} needs triage, ${closed.length} closed.`);
L.push('');

if (triage.length) {
  L.push('## Needs triage');
  L.push('');
  L.push('Status is what the document claims, not something anyone checked. This has');
  L.push('gone wrong before: nineteen briefs sat marked open while all nineteen were in');
  L.push('production, and one was flagged as an architectural gap by the very PR that');
  L.push('fixed it. Confirm each against the repo, record `shipped_in`, set');
  L.push('`verified: true` — or correct the status.');
  L.push('');
  triage.forEach((b) => L.push(row(b)));
  L.push('');
}

if (built.length) {
  L.push('## Built, not deployed');
  L.push('');
  L.push('Code complete and merged. **Merging does not deploy** — only `wrangler deploy` does.');
  L.push('');
  built.forEach((b) => L.push(row(b)));
  L.push('');
}

if (open.length) {
  L.push('## Open');
  L.push('');
  open.forEach((b) => L.push(row(b)));
  L.push('');
}

if (unverified.length) {
  L.push('## Shipped, but unverified');
  L.push('');
  L.push('These say shipped without citing a commit or PR. Probably right; not evidence.');
  L.push('');
  unverified.forEach((b) => L.push(row(b, { showSeverity: false })));
  L.push('');
}

L.push('## Shipped');
L.push('');
shipped.filter((b) => b.fm.verified).forEach((b) => L.push(row(b, { showSeverity: false })));
L.push('');

if (closed.length) {
  L.push('## Closed without shipping');
  L.push('');
  closed.forEach((b) => L.push(`- **${b.fm.title}** — ${b.fm.closed_reason ?? b.fm.status}`));
  L.push('');
}

if (missing.length) {
  L.push('## Briefs with no frontmatter');
  L.push('');
  L.push('The generator cannot place these. Add frontmatter per the schema.');
  L.push('');
  missing.forEach((f) => L.push(`- \`${f}\``));
  L.push('');
}

L.push('---');
L.push('');
L.push('## Tracked outside the brief system');
L.push('');
L.push('Hand-maintained. The generator copies this block through untouched, so');
L.push('anything here survives regeneration. Give an item a brief when it grows one,');
L.push('then delete it from here.');
L.push('');
L.push(HAND_START);
L.push('');
L.push(hand);
L.push('');
L.push(HAND_END);
L.push('');

const output = L.join('\n');

if (process.argv.includes('--check')) {
  if (prev !== output) {
    console.error('docs/TASKS.md is out of date — run: node scripts/generate-tasks.mjs');
    process.exit(1);
  }
  console.log('docs/TASKS.md is up to date.');
} else {
  writeFileSync(OUT, output);
  console.log(
    `Wrote docs/TASKS.md — ${briefs.length} briefs ` +
    `(${shipped.length} shipped, ${triage.length} needs triage, ` +
    `${unverified.length} shipped-but-unverified)` +
    (missing.length ? `, ${missing.length} missing frontmatter` : '')
  );
}
