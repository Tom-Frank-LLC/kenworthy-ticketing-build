#!/usr/bin/env node
// READ-ONLY: what does Square's Team API actually say about our team members,
// and can our token write to it?
//
// Written for BRIEF-square-create-team-member. Two questions it answers:
//
//  1. Is there any field on a TeamMember that carries invitation / sign-in
//     state? Square's docs say no — "Invite expired" is a Dashboard-only state —
//     and the roster's "Active in Square" badge was reworded on that basis.
//     This dumps every member's raw object, at the version our edge functions
//     are pinned to and at a current one, and lists every key path seen, so
//     the claim is checked rather than inherited. It also searches with NO
//     location filter and NO status filter (list_team filters to our location),
//     so a second record for the same person — one active, one not — shows up.
//
//  2. Does the access token carry EMPLOYEES_WRITE? CreateTeamMember needs it.
//     RetrieveTokenStatus (POST /oauth2/token/status) reports a token's scopes.
//
// Makes no writes. The only POSTs are TeamMember search and token status,
// both reads.
//
// Usage (the token never needs to be pasted into a shared transcript — run it
// in your own terminal):
//   SQUARE_ACCESS_TOKEN=... node scripts/square-inspect-team.mjs
//
// Optional:
//   SQUARE_ENV=sandbox   (default: production)
//   NAME=ben             print only members whose name/email contains this
//   OUT=/some/dir        where the raw dumps go (default: ~/square-team-inspect)
//
// The dumps hold staff names, emails and phone numbers. They are written
// outside the repo on purpose.

import { writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';

const TOKEN = process.env.SQUARE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('SQUARE_ACCESS_TOKEN is not set. Nothing was called.');
  process.exit(1);
}

const ENV = process.env.SQUARE_ENV === 'sandbox' ? 'sandbox' : 'production';
const HOST = ENV === 'sandbox' ? 'https://connect.squareupsandbox.com' : 'https://connect.squareup.com';
const PINNED = '2024-01-18';   // _shared/square.ts SQUARE_API_VERSION
const CURRENT = '2025-07-16';
const NAME = (process.env.NAME || '').toLowerCase();
const OUT = process.env.OUT || `${homedir()}/square-team-inspect`;
mkdirSync(OUT, { recursive: true });

const READS = new Set(['/v2/team-members/search', '/oauth2/token/status']);
let calls = 0;

async function sq(path, { method = 'GET', body, version = PINNED } = {}) {
  const bare = path.split('?')[0];
  if (method !== 'GET' && !READS.has(bare)) throw new Error(`REFUSING non-read call: ${method} ${path}`);
  calls++;
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: { 'Square-Version': version, Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { ok: res.ok, status: res.status, data };
}

async function allMembers(version) {
  const out = [];
  let cursor;
  do {
    const r = await sq('/v2/team-members/search', { method: 'POST', version, body: { limit: 200, ...(cursor ? { cursor } : {}) } });
    if (!r.ok) throw new Error(`Square ${r.status} on team search: ${JSON.stringify(r.data?.errors ?? r.data)}`);
    out.push(...(r.data.team_members ?? []));
    cursor = r.data.cursor;
  } while (cursor);
  return out;
}

function keyPaths(value, prefix = '', out = new Set()) {
  if (value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) { if (value.length) keyPaths(value[0], `${prefix}[]`, out); return out; }
  for (const [k, v] of Object.entries(value)) {
    const p = prefix ? `${prefix}.${k}` : k;
    out.add(p);
    keyPaths(v, p, out);
  }
  return out;
}

// --- 1. token scopes -------------------------------------------------------
const token = await sq('/oauth2/token/status', { method: 'POST', body: {} });
writeFileSync(`${OUT}/token-status.json`, JSON.stringify(token, null, 2));
console.log(`\n== ${ENV} token status (HTTP ${token.status}) ==`);
if (token.ok) {
  const scopes = token.data.scopes ?? [];
  console.log(`scopes: ${scopes.length ? scopes.join(' ') : '(none listed)'}`);
  console.log(`EMPLOYEES_READ:  ${scopes.includes('EMPLOYEES_READ') ? 'yes' : 'NO'}`);
  console.log(`EMPLOYEES_WRITE: ${scopes.includes('EMPLOYEES_WRITE') ? 'yes' : 'NO'}`);
  console.log(`expires_at: ${token.data.expires_at ?? '(never — personal access token)'}`);
} else {
  console.log(JSON.stringify(token.data));
}

// --- 2. every team member, raw, at two versions -----------------------------
const byVersion = {};
for (const v of [PINNED, CURRENT]) {
  byVersion[v] = await allMembers(v);
  writeFileSync(`${OUT}/team-members-${v}.json`, JSON.stringify(byVersion[v], null, 2));
}
const pinnedKeys = new Set(byVersion[PINNED].flatMap(m => [...keyPaths(m)]));
const currentKeys = new Set(byVersion[CURRENT].flatMap(m => [...keyPaths(m)]));
console.log(`\n== team members: ${byVersion[PINNED].length} (all locations, all statuses) ==`);
console.log(`key paths at ${PINNED}: ${[...pinnedKeys].sort().join(', ')}`);
const onlyCurrent = [...currentKeys].filter(k => !pinnedKeys.has(k)).sort();
console.log(`key paths only at ${CURRENT}: ${onlyCurrent.length ? onlyCurrent.join(', ') : '(none)'}`);

const nameOf = m => [m.given_name, m.family_name].filter(Boolean).join(' ');
const rows = byVersion[CURRENT]
  .filter(m => !NAME || `${nameOf(m)} ${m.email_address ?? ''}`.toLowerCase().includes(NAME))
  .sort((a, b) => nameOf(a).localeCompare(nameOf(b)));
console.log('');
for (const m of rows) {
  const locs = m.assigned_locations?.assignment_type === 'ALL_CURRENT_AND_FUTURE_LOCATIONS'
    ? 'all locations' : (m.assigned_locations?.location_ids ?? []).join(',') || '(none)';
  console.log(
    `${nameOf(m).padEnd(24)} ${String(m.status).padEnd(8)} owner=${m.is_owner ? 'y' : 'n'} ` +
    `created=${(m.created_at ?? '').slice(0, 10)} updated=${(m.updated_at ?? '').slice(0, 10)} ` +
    `ref=${m.reference_id ?? '-'} locs=${locs} id=${m.id}`,
  );
}

const counts = new Map();
for (const m of byVersion[CURRENT]) counts.set(nameOf(m).toLowerCase(), (counts.get(nameOf(m).toLowerCase()) ?? 0) + 1);
const dupes = [...counts].filter(([, n]) => n > 1).map(([k]) => k);
console.log(`\nsame name on more than one record: ${dupes.length ? dupes.join(', ') : '(none)'}`);
console.log(`\n${calls} read calls, 0 writes. Raw dumps in ${OUT}\n`);
