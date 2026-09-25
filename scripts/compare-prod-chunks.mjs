// Is production ahead of main? Compare the live kenworthy.org bundle against a
// local production build, ignoring Vite content hashes.
//
//   npm run build:production
//   mkdir -p /tmp/cmp/live && curl -s -H 'Cache-Control: no-cache' \
//     "https://kenworthy.org/?nocache=$RANDOM" -o /tmp/cmp/live/index.html
//   node scripts/compare-prod-chunks.mjs dist /tmp/cmp
//
// Crawls the live import graph from that index.html so lazy chunks are covered
// too (index.html only names the ~30 preloaded ones), strips the `-XXXXXXXX`
// hash from every chunk name and reference, and diffs each live chunk against
// the build chunk of the same stripped name. Chunk hashes alone are not a
// usable signal: a CSS-only change renames ~60 chunks because each one's
// preload list carries the CSS filename.
//
// Expected output when prod == main: every chunk identical, nothing only-live
// or only-dist. Chunks you changed on this branch will show under "differ".
//
// Known wart: several chunks are all named `dist-*.js`, so they collide on the
// stripped key and one can show as "differ" spuriously. Confirm by diffing
// that live chunk (saved under <workdir>/live-assets/) against every build
// `dist-*.js` before believing it.
import fs from 'node:fs';
import path from 'node:path';

const ORIGIN = 'https://kenworthy.org';
const DIST = process.argv[2];
const WORK = process.argv[3];
if (!DIST || !WORK) {
  console.error('usage: node scripts/compare-prod-chunks.mjs <dist-dir> <work-dir containing live/index.html>');
  process.exit(2);
}
const OUT = path.join(WORK, 'live-assets');
fs.mkdirSync(OUT, { recursive: true });

const HASH_RE = /-[A-Za-z0-9_-]{8}(\.(js|css))/g;
const strip = (n) => n.replace(HASH_RE, '-HASH$1');
const norm = (s) => s.replace(HASH_RE, '-HASH$1');

const html = fs.readFileSync(path.join(WORK, 'live', 'index.html'), 'utf8');
const seed = [...html.matchAll(/\/assets\/([A-Za-z0-9_.-]+\.(?:js|css))/g)].map((m) => m[1]);
const queue = [...new Set(seed)];
const live = new Map(); // stripped name -> {name, text}
const seen = new Set();

while (queue.length) {
  const name = queue.shift();
  if (seen.has(name)) continue;
  seen.add(name);
  const res = await fetch(`${ORIGIN}/assets/${name}?nocache=${Date.now()}`, { headers: { 'Cache-Control': 'no-cache' } });
  // The SPA fallback answers unknown paths with 200 text/html, so the status
  // alone does not prove the chunk exists.
  const type = res.headers.get('content-type') || '';
  if (!res.ok || type.includes('text/html')) { console.log(`MISSING LIVE ${name} ${res.status} ${type}`); continue; }
  const text = await res.text();
  fs.writeFileSync(path.join(OUT, name), text);
  live.set(strip(name), { name, text });
  for (const m of text.matchAll(/["'`](?:\.\/|\/assets\/)?([A-Za-z0-9_.-]+-[A-Za-z0-9_-]{8}\.(?:js|css))["'`]/g)) {
    if (!seen.has(m[1]) && !queue.includes(m[1])) queue.push(m[1]);
  }
}

const dist = new Map();
for (const f of fs.readdirSync(path.join(DIST, 'assets'))) {
  if (/\.(js|css)$/.test(f)) dist.set(strip(f), { name: f, text: fs.readFileSync(path.join(DIST, 'assets', f), 'utf8') });
}

const onlyLive = [...live.keys()].filter((k) => !dist.has(k));
const onlyDist = [...dist.keys()].filter((k) => !live.has(k));
const differ = [];
let same = 0;
for (const [k, l] of live) {
  const d = dist.get(k);
  if (!d) continue;
  if (norm(l.text) === norm(d.text)) same++;
  else differ.push(`${l.name} <-> ${d.name}`);
}
console.log(`live chunks crawled: ${live.size}, dist chunks: ${dist.size}`);
console.log(`identical (hash-stripped): ${same}`);
console.log(`differ:\n  ${differ.join('\n  ') || '(none)'}`);
console.log(`only live:\n  ${onlyLive.join('\n  ') || '(none)'}`);
console.log(`only dist:\n  ${onlyDist.join('\n  ') || '(none)'}`);
