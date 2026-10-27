#!/usr/bin/env node
/**
 * Confirms a native project holds exactly the web build that was just made.
 * Usage: verify-native-sync.mjs ios|android
 *
 * `cap sync` can copy nothing and still exit 0: on the Centerview app a
 * `# comment` typed after `npm run mobile:prep` at a zsh prompt became
 * arguments to the script's last command, `cap sync` logged "Platform # not
 * found", and the build went out with a stale bundle. Neither Xcode nor Gradle
 * runs a sync itself, so a build simply takes whatever is in the platform's
 * public/ folder. This compares it file by file with dist-native/, and takes
 * exactly one argument — the platform — so a stray extra one fails loudly
 * instead of being swallowed.
 */
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const PUBLIC = { ios: 'ios/App/App/public', android: 'android/app/src/main/assets/public' };
const args = process.argv.slice(2);
if (args.length !== 1 || !Object.hasOwn(PUBLIC, args[0])) {
  console.error(`✖ verify-native-sync: takes exactly one argument, ios or android; got ${JSON.stringify(args)}`);
  process.exit(1);
}

const SRC = 'dist-native';
const DST = PUBLIC[args[0]];
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
