#!/usr/bin/env node
/**
 * Mirror kenworthy.org's live DNS into Cloudflare, then prove the two agree.
 *
 * The risk in the domain cutover is not the website. It is the theatre's
 * Google Workspace mail, the Mailchimp newsletter and every Resend ticket
 * email, all of which authenticate off records in this zone. A record that is
 * dropped or mistyped here does not fail loudly — it fails as a slow slide
 * into spam folders, days later.
 *
 * So this script never takes a frozen record list on faith. Every mode reads
 * the *live* zone from its authoritative nameserver and compares against
 * Cloudflare. Run it before the nameserver change and it tells you whether the
 * mirror is safe to cut over to.
 *
 *   node scripts/cf-zone-mirror.mjs dump     # the live zone; no token needed
 *   node scripts/cf-zone-mirror.mjs plan     # what would change; reads only
 *   node scripts/cf-zone-mirror.mjs apply    # create the missing records
 *   node scripts/cf-zone-mirror.mjs verify   # parity proof; exit 1 on any drift
 *
 * Token: CF_API_TOKEN, or a file path in CF_TOKEN_FILE (default
 * ~/.cf-kenworthy-token). Needs Zone:DNS:Edit + Zone:Zone:Read on this zone.
 *
 * See docs/RUNBOOK-golive-kenworthy-org.md.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const run = promisify(execFile);

const ZONE = process.env.ZONE_NAME || 'kenworthy.org';
const AUTH_NS = process.env.AUTH_NS || 'ns.fsr.com';
const API = 'https://api.cloudflare.com/client/v4';

/**
 * Names to interrogate. There is no AXFR on this zone, so a zone dump is not
 * available and the set has to be enumerated by hand. Anything absent from
 * this list is invisible to the script — which is why `plan` prints the count
 * and the runbook says to diff this against Cloudflare's own scan rather than
 * trusting either one alone.
 */
const NAMES = [
  { name: '@', types: ['A', 'AAAA', 'MX', 'TXT', 'CAA', 'NS'] },
  { name: 'www', types: ['A', 'CNAME'] },
  { name: 'send', types: ['TXT', 'MX'] },
  { name: '_dmarc', types: ['TXT'] },
  { name: 'google._domainkey', types: ['TXT'] },
  { name: 'resend._domainkey', types: ['TXT'] },
  { name: 'k1._domainkey', types: ['TXT', 'CNAME'] },
  { name: 'k2._domainkey', types: ['TXT', 'CNAME'] },
  { name: 'k3._domainkey', types: ['TXT', 'CNAME'] },
];

const fqdn = (n) => (n === '@' ? ZONE : `${n}.${ZONE}`);

/** A TXT value dig reports as `"chunk" "chunk"` is ONE value, not two.
 *
 * google._domainkey is stored as two DNS character-strings because a single
 * string caps at 255 bytes. Stripping the quotes without also removing the
 * separator leaves a space in the middle of the public key, and Google stops
 * signing. Cloudflare wants the joined value and re-splits it itself. */
function joinTxt(raw) {
  const chunks = [...raw.matchAll(/"((?:[^"\\]|\\.)*)"/g)].map((m) => m[1]);
  return chunks.length ? chunks.join('') : raw;
}

async function dig(name, type) {
  try {
    const { stdout } = await run('dig', [`@${AUTH_NS}`, fqdn(name), type, '+short', '+time=3', '+tries=2']);
    return stdout.split('\n').map((l) => l.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/** The live zone, as its own nameserver answers today. */
async function readLive() {
  const out = [];
  for (const { name, types } of NAMES) {
    for (const type of types) {
      // Delegation NS at the apex belongs to the registrar, not to us.
      if (type === 'NS' && name === '@') continue;
      for (const line of await dig(name, type)) {
        if (type === 'TXT') {
          out.push({ name, type, content: joinTxt(line) });
        } else if (type === 'MX') {
          const [priority, ...rest] = line.split(/\s+/);
          out.push({ name, type, content: rest.join(' ').replace(/\.$/, ''), priority: Number(priority) });
        } else if (type === 'CNAME') {
          out.push({ name, type, content: line.replace(/\.$/, '') });
        } else {
          out.push({ name, type, content: line });
        }
      }
    }
  }
  // A query for any type at a CNAME'd name follows the chain, so dig reports
  // the target's answer as if it lived here: `www A` yields the resolved
  // address, and `k2._domainkey TXT` yields Mailchimp's DKIM string. Neither
  // is a record in this zone, and a CNAME cannot legally coexist with another
  // type at the same name — Cloudflare would reject the pair, or we would
  // mirror a record the zone does not actually have. The CNAME alone is the
  // truth; drop everything else at that name.
  const cnamed = new Set(out.filter((r) => r.type === 'CNAME').map((r) => r.name));
  return out.filter((r) => r.type === 'CNAME' || !cnamed.has(r.name));
}

function token() {
  if (process.env.CF_API_TOKEN) return process.env.CF_API_TOKEN.trim();
  const file = process.env.CF_TOKEN_FILE || path.join(homedir(), '.cf-kenworthy-token');
  try {
    return readFileSync(file, 'utf8').trim();
  } catch {
    console.error(`No token. Set CF_API_TOKEN, or write one to ${file}.`);
    process.exit(2);
  }
}

async function cf(pathname, init = {}) {
  const res = await fetch(`${API}${pathname}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/json',
      ...(init.headers || {}),
    },
  });
  const body = await res.json();
  if (!body.success) {
    const msg = (body.errors || []).map((e) => `${e.code} ${e.message}`).join('; ');
    throw new Error(`${init.method || 'GET'} ${pathname} failed: ${msg || res.status}`);
  }
  return body.result;
}

async function zoneId() {
  const zones = await cf(`/zones?name=${encodeURIComponent(ZONE)}`);
  if (!zones.length) {
    console.error(
      `${ZONE} is not in this Cloudflare account yet.\n` +
        `Add it first (dashboard -> Add a site -> Free). Nothing goes live from that;\n` +
        `the zone sits in "Pending Nameserver Update" until the registrar is changed.`,
    );
    process.exit(2);
  }
  return zones[0];
}

async function readCloudflare(id) {
  const out = [];
  for (let page = 1; ; page++) {
    const rows = await cf(`/zones/${id}/dns_records?per_page=100&page=${page}`);
    out.push(...rows);
    if (rows.length < 100) break;
  }
  return out.map((r) => ({
    id: r.id,
    name: r.name === ZONE ? '@' : r.name.replace(`.${ZONE}`, ''),
    type: r.type,
    content: r.type === 'TXT' ? joinTxt(r.content) : r.content.replace(/\.$/, ''),
    priority: r.priority,
    proxied: r.proxied,
    ttl: r.ttl,
  }));
}

const key = (r) => `${r.type} ${r.name} ${r.priority ?? ''} ${r.content}`;

const MIGRATION_TTL = 300;

function compare(live, remote) {
  const have = new Map(remote.map((r) => [key(r), r]));
  const want = new Set(live.map(key));
  return {
    missing: live.filter((r) => !have.has(key(r))),
    extra: remote.filter((r) => !want.has(key(r)) && r.type !== 'NS' && r.type !== 'SOA'),
    proxied: remote.filter((r) => r.proxied),
    // ttl 1 is Cloudflare's "Auto", which is 300s for a DNS-only record — the
    // rollback speed we want, so it is not slow and must not be rewritten.
    slow: remote.filter(
      (r) => r.ttl !== 1 && r.ttl > MIGRATION_TTL && r.type !== 'NS' && r.type !== 'SOA',
    ),
  };
}

function report(live, remote) {
  const c = compare(live, remote);
  console.log(`live zone (@${AUTH_NS}): ${live.length} records`);
  console.log(`cloudflare:              ${remote.length} records\n`);
  for (const r of c.missing) console.log(`  MISSING  ${key(r)}`);
  // EXTRA is not an accusation. NAMES below is a hand-written probe list and
  // cannot see a subdomain nobody thought to guess, so Cloudflare's own scan
  // routinely finds records this script does not. They are real records of the
  // old zone and must be KEPT — nothing here ever deletes one.
  for (const r of c.extra) console.log(`  EXTRA    ${key(r)}  <- not in our probe list; keep it`);
  for (const r of c.proxied) console.log(`  PROXIED  ${r.type} ${r.name}  <- must be DNS-only before the NS change`);
  for (const r of c.slow) console.log(`  TTL ${String(r.ttl).padEnd(5)} ${r.type} ${r.name}  <- want ${MIGRATION_TTL} for a fast rollback`);
  if (!c.missing.length && !c.proxied.length && !c.slow.length) console.log('  in parity, DNS-only, fast TTLs.');
  return c;
}

const [, , mode = 'plan'] = process.argv;

const live = await readLive();
if (!live.length) {
  console.error(`Read nothing from ${AUTH_NS}. Refusing to act on an empty view of the zone.`);
  process.exit(2);
}

if (mode === 'dump') {
  console.log(`${live.length} records on ${ZONE}, as @${AUTH_NS} answers them\n`);
  for (const r of live) console.log(`  ${key(r)}`);
  process.exit(0);
}

const zone = await zoneId();
console.log(`zone ${ZONE} (${zone.id}) status=${zone.status}\n`);
let remote = await readCloudflare(zone.id);

if (mode === 'plan') {
  report(live, remote);
  console.log('\nread-only. `apply` creates the MISSING rows; EXTRA and PROXIED are left for a human.');
} else if (mode === 'apply') {
  const { missing, proxied, slow } = report(live, remote);
  console.log('');
  for (const r of missing) {
    const body = {
      type: r.type,
      name: r.name === '@' ? ZONE : `${r.name}.${ZONE}`,
      content: r.content,
      ttl: MIGRATION_TTL,
      proxied: false,
    };
    if (r.priority !== undefined) body.priority = r.priority;
    await cf(`/zones/${zone.id}/dns_records`, { method: 'POST', body: JSON.stringify(body) });
    console.log(`  created    ${key(r)}`);
  }

  // Anything Cloudflare imported proxied would, the moment the nameservers
  // move, put the OLD WordPress site behind Cloudflare's proxy — new IP, new
  // TLS, and that site is our rollback target. Grey-cloud everything, and drop
  // TTLs so a rollback propagates in five minutes rather than a day.
  for (const r of new Set([...proxied, ...slow])) {
    await cf(`/zones/${zone.id}/dns_records/${r.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ ttl: MIGRATION_TTL, ...(r.proxied ? { proxied: false } : {}) }),
    });
    console.log(`  ${r.proxied ? 'unproxied  ' : 'ttl->300   '}${r.type} ${r.name}`);
  }

  // Never trust the 2xx. Re-read and compare.
  remote = await readCloudflare(zone.id);
  console.log('');
  const after = report(live, remote);
  process.exit(after.missing.length || after.proxied.length ? 1 : 0);
} else if (mode === 'verify') {
  const { missing, proxied, slow } = report(live, remote);
  console.log(`\nassigned nameservers: ${(zone.name_servers || []).join(' ')}`);
  const blocked = missing.length || proxied.length;
  if (blocked) {
    console.log('\nNOT SAFE to change nameservers yet.');
  } else {
    if (slow.length) console.log(`\n${slow.length} record(s) still above a ${MIGRATION_TTL}s TTL — rollback will be slower.`);
    console.log('\nParity holds and everything is DNS-only. Safe to change nameservers at eNom.');
  }
  process.exit(blocked ? 1 : 0);
} else {
  console.error(`unknown mode "${mode}" — expected plan | apply | verify`);
  process.exit(2);
}
