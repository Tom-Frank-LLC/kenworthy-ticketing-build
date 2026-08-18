#!/usr/bin/env node
// Phase 0 — READ-ONLY discovery for the venue + event date/time restore.
//
// Makes no writes of any kind. Every call is a GET, except CatalogSearch,
// which Square models as POST but is a read.
//
// What it answers, in order of how much the answer matters:
//
//  1. Where do the venue and the event date/time actually live on a Square
//     catalog object? Standard CatalogItem has no field for either. The lead
//     is an UNDOCUMENTED `item_data.event` block.
//
//  2. Does RetrieveCatalogObject return that block? This is the one that
//     decides whether Phase 1 is possible at all. Our only safe write is
//     retrieve -> edit one field -> upsert the whole object back. If the
//     event block is visible to CatalogSearch but NOT to RetrieveCatalogObject,
//     then the object we send back is missing it, and UpsertCatalogObject
//     replaces the stored object with what we send. That would WIPE the venue
//     and date off every item we touched -- the Aug 14 incident again, aimed
//     at the exact field this job exists to restore.
//
//  3. Does the pinned API version (2024-01-18) see the same fields as a
//     current one? A field absent at the pinned version is a field our write
//     would silently drop.
//
// Usage:
//   SQUARE_ACCESS_TOKEN=... node scripts/square-inspect-events.mjs
//
// Optional:
//   SQUARE_ENV=sandbox        (default: production -- the catalog we care about)
//   TOKENS=ABC,DEF            inspect these specific catalog object ids

import { writeFileSync, mkdirSync } from 'node:fs';

const TOKEN = process.env.SQUARE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error('SQUARE_ACCESS_TOKEN is not set. Nothing was called.');
  process.exit(1);
}

const ENV = process.env.SQUARE_ENV === 'sandbox' ? 'sandbox' : 'production';
const BASE = ENV === 'sandbox'
  ? 'https://connect.squareupsandbox.com/v2'
  : 'https://connect.squareup.com/v2';

// The version the edge functions are pinned to, and a current one. Any field
// that appears only in the second column is a field our deployed code is blind
// to -- and therefore a field a write from our deployed code would drop.
const PINNED = '2024-01-18';
const CURRENT = '2025-07-16';

const OUT = new URL('../.phase0-out/', import.meta.url).pathname;
mkdirSync(OUT, { recursive: true });

let calls = 0;

async function sq(path, { method = 'GET', body, version = PINNED } = {}) {
  if (method !== 'GET' && !path.startsWith('/catalog/search')) {
    throw new Error(`REFUSING non-read call: ${method} ${path}`);
  }
  calls++;
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'Square-Version': version,
      Authorization: `Bearer ${TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      `Square ${res.status} on ${method} ${path}: ` +
      (data?.errors?.[0]?.detail ?? JSON.stringify(data)?.slice(0, 300)),
    );
  }
  return data ?? {};
}

/** Walk the whole catalog once, at a given API version. */
async function listAllItems(version) {
  const objects = [];
  let cursor;
  do {
    const q = new URLSearchParams({ types: 'ITEM' });
    if (cursor) q.set('cursor', cursor);
    const res = await sq(`/catalog/list?${q}`, { version });
    objects.push(...(res.objects ?? []));
    cursor = res.cursor;
  } while (cursor);
  return objects;
}

/** CatalogSearch — the endpoint the Square forum thread says surfaces venue. */
async function searchAllItems(version) {
  const objects = [];
  let cursor;
  do {
    const res = await sq('/catalog/search', {
      method: 'POST',
      version,
      body: { object_types: ['ITEM'], include_deleted_objects: false, cursor, limit: 1000 },
    });
    objects.push(...(res.objects ?? []));
    cursor = res.cursor;
  } while (cursor);
  return objects;
}

/** Every dotted key path in an object, so nothing gets missed by guessing. */
function keyPaths(value, prefix = '', out = new Set()) {
  if (value === null || typeof value !== 'object') return out;
  if (Array.isArray(value)) {
    if (value.length) keyPaths(value[0], `${prefix}[]`, out);
    return out;
  }
  for (const [k, v] of Object.entries(value)) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    keyPaths(v, path, out);
  }
  return out;
}

/** Anything that smells like a venue, an address, or a date/time. */
function eventish(object) {
  const hits = {};
  const walk = (value, path) => {
    if (value === null || value === undefined) return;
    if (typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        walk(v, path ? `${path}.${k}` : k);
      }
      return;
    }
    const p = path.toLowerCase();
    const s = String(value);
    if (
      /event|venue|location_name|address|start|end|date|time/.test(p) ||
      /508 S Main/i.test(s)
    ) {
      hits[path] = value;
    }
  };
  walk(object, '');
  return hits;
}

const report = (o) => console.log(JSON.stringify(o, null, 2));

console.log(`\n=== Square catalog event-field discovery (${ENV}, READ-ONLY) ===\n`);

// ---------------------------------------------------------------------------
// 1. Full catalog at both API versions, via both list and search.
// ---------------------------------------------------------------------------
const listPinned = await listAllItems(PINNED);
const listCurrent = await listAllItems(CURRENT);
const searchCurrent = await searchAllItems(CURRENT);

console.log(
  `items: list@${PINNED}=${listPinned.length}  ` +
  `list@${CURRENT}=${listCurrent.length}  search@${CURRENT}=${searchCurrent.length}\n`,
);

// product_type spread tells us how many are true EVENT items.
const byProductType = {};
for (const o of listCurrent) {
  const t = o.item_data?.product_type ?? '(unset)';
  byProductType[t] = (byProductType[t] ?? 0) + 1;
}
console.log('product_type across the catalog:');
report(byProductType);

// ---------------------------------------------------------------------------
// 2. Which items carry an event block, and what is in it?
// ---------------------------------------------------------------------------
const index = (objs) => new Map(objs.map((o) => [o.id, o]));
const byIdList = index(listCurrent);
const byIdSearch = index(searchCurrent);

const withEvent = listCurrent.filter((o) => o.item_data?.event);
const withEventSearch = searchCurrent.filter((o) => o.item_data?.event);

console.log(
  `\nitems with item_data.event: list=${withEvent.length} search=${withEventSearch.length}`,
);

const eventKeys = new Set();
for (const o of [...withEvent, ...withEventSearch]) {
  for (const p of keyPaths(o.item_data.event, 'item_data.event')) eventKeys.add(p);
}
console.log('\nevery key seen inside item_data.event:');
report([...eventKeys].sort());

// Populated venue/date values, so we can see the EXACT format to match.
const samples = [...withEvent, ...withEventSearch].slice(0, 8).map((o) => ({
  id: o.id,
  name: o.item_data?.name,
  product_type: o.item_data?.product_type,
  version: o.version,
  event: o.item_data.event,
}));
console.log('\npopulated event blocks (format to match):');
report(samples);

// ---------------------------------------------------------------------------
// 3. THE DECIDING TEST: does RetrieveCatalogObject return the event block?
//    If list/search show it and retrieve does not, read-modify-write DROPS it.
// ---------------------------------------------------------------------------
const probeIds = (process.env.TOKENS?.split(',').map((s) => s.trim()).filter(Boolean))
  ?? [...withEvent, ...withEventSearch].slice(0, 5).map((o) => o.id);

console.log(`\n=== retrieve vs list vs search, for ${probeIds.length} items ===`);

const roundTrip = [];
for (const id of probeIds) {
  const rPinned = await sq(`/catalog/object/${id}?include_related_objects=false`, { version: PINNED });
  const rCurrent = await sq(`/catalog/object/${id}?include_related_objects=false`, { version: CURRENT });

  const row = {
    id,
    name: rCurrent.object?.item_data?.name,
    product_type: rCurrent.object?.item_data?.product_type,
    event_in_list: !!byIdList.get(id)?.item_data?.event,
    event_in_search: !!byIdSearch.get(id)?.item_data?.event,
    [`event_in_retrieve@${PINNED}`]: !!rPinned.object?.item_data?.event,
    [`event_in_retrieve@${CURRENT}`]: !!rCurrent.object?.item_data?.event,
    event_from_retrieve: rCurrent.object?.item_data?.event ?? null,
    eventish_fields: eventish(rCurrent.object ?? {}),
  };
  roundTrip.push(row);

  writeFileSync(`${OUT}/object-${id}.json`, JSON.stringify(
    { retrieve_pinned: rPinned, retrieve_current: rCurrent,
      from_list: byIdList.get(id) ?? null, from_search: byIdSearch.get(id) ?? null },
    null, 2,
  ));
}
report(roundTrip);

// The headline: any item where the field exists upstream but not in retrieve
// is an item a read-modify-write would silently strip.
const wouldDrop = roundTrip.filter(
  (r) => (r.event_in_list || r.event_in_search) && !r[`event_in_retrieve@${CURRENT}`],
);
console.log(
  `\nitems whose event block RetrieveCatalogObject does NOT return: ${wouldDrop.length}` +
  (wouldDrop.length ? '  <-- read-modify-write would WIPE these. STOP.' : '  (round-trip is safe on this axis)'),
);

// ---------------------------------------------------------------------------
// 4. Cross-reference the CSV: how many of the 484 are EVENT items at all?
// ---------------------------------------------------------------------------
const csv = process.env.CSV;
if (csv) {
  const { readFileSync } = await import('node:fs');
  const lines = readFileSync(csv, 'utf8').split(/\r?\n/).filter(Boolean).slice(1);
  const tokens = lines.map((l) => l.split(',').pop().trim()).filter(Boolean);
  const present = tokens.filter((t) => byIdList.has(t) || byIdSearch.has(t));
  const asEvent = present.filter(
    (t) => (byIdList.get(t) ?? byIdSearch.get(t))?.item_data?.product_type === 'EVENT',
  );
  const hasEventBlock = present.filter(
    (t) => (byIdList.get(t) ?? byIdSearch.get(t))?.item_data?.event,
  );
  console.log('\n=== CSV cross-reference ===');
  report({
    csv_rows: tokens.length,
    found_in_catalog: present.length,
    missing_from_catalog: tokens.length - present.length,
    product_type_EVENT: asEvent.length,
    already_has_event_block: hasEventBlock.length,
  });
}

writeFileSync(`${OUT}/summary.json`, JSON.stringify(
  { env: ENV, byProductType, eventKeys: [...eventKeys].sort(), roundTrip, samples }, null, 2,
));

console.log(`\n${calls} read calls made. 0 writes. Dumps in ${OUT}\n`);
