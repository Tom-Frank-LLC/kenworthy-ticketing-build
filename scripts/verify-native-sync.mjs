#!/usr/bin/env node
/**
 * Confirms the iOS project holds exactly the web build that was just made.
 *
 * `cap sync` can copy nothing and still exit 0: on the Centerview app a
 * `# comment` typed after `npm run mobile:prep` at a zsh prompt became
 * arguments to the script's last command, `cap sync` logged "Platform # not
 * found", and the build went out with a stale bundle. Xcode never runs a sync
 * itself, so an archive simply takes whatever is in ios/App/App/public. This
 * compares it file by file with dist-native/, and takes no arguments so a stray
 * one fails loudly instead of being swallowed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

if (process.argv.length > 2) {
  console.error(`✖ verify-native-sync: takes no arguments; got ${JSON.stringify(process.argv.slice(2))}`);
  process.exit(1);
}

const SRC = 'dist-native';
const DST = 'ios/App/App/public';
const NATIVE_ONLY = new Set(['cordova.js', 'cordova_plugins.js']);

function list(root) {
  const out = new Map();
  const walk = (d) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.set(relative(root, p), createHash('sha256').update(readFileSync(p)).digest('hex'));
    }
  };
  if (existsSync(root)) walk(root);
  return out;
}

const src = list(SRC);
const dst = list(DST);
const problems = [];
if (src.size === 0) problems.push(`${SRC} is empty or missing`);
for (const [f, h] of src) {
  if (!dst.has(f)) problems.push(`missing in app: ${f}`);
  else if (dst.get(f) !== h) problems.push(`differs: ${f}`);
}
for (const f of dst.keys()) if (!src.has(f) && !NATIVE_ONLY.has(f)) problems.push(`stale in app: ${f}`);

if (problems.length) {
  console.error(`✖ verify-native-sync: ${DST} does not match ${SRC}:\n  ${problems.slice(0, 20).join('\n  ')}`);
  process.exit(1);
}
console.log(`✔ verify-native-sync: ${src.size} files in ${DST} match ${SRC}.`);
