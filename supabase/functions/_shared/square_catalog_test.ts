import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import {
  CATEGORY,
  canonicalTier,
  categoryForProduction,
  diffPaths,
  formatShowtime,
  isNoisyPath,
  normalizeTitle,
  parseVariationName,
  sameVariation,
  variationName,
} from './square-catalog.ts';

/**
 * The grammar is the interface to a live catalog of 1,584 variations.
 *
 * If a generated name does not match the shape the theatre already uses, the
 * sale still succeeds — it just lands on a NEW variation beside the right one,
 * splitting a showtime's revenue across two rows in Item Sales with no error
 * anywhere. That is a reporting fault that nothing in the request path can
 * catch, so the grammar is pinned here against the examples measured in
 * docs/SQUARE-TRANSACTION-CONVENTIONS.md.
 */

// 2026-09-16 19:00 Pacific == 2026-09-17T02:00Z. Written as UTC on purpose:
// this is the case that catches formatting in the server's zone instead of the
// venue's, which would name the variation for the WRONG DAY.
const SEPT_16_7PM = '2026-09-17T02:00:00Z';

Deno.test('showtime drops :00 on the hour', () => {
  assertEquals(formatShowtime(SEPT_16_7PM), 'Wednesday, September 16 at 7 PM');
});

Deno.test('showtime keeps real minutes', () => {
  // 9:55 AM Pacific on 14 Jan 2026 == 17:55Z.
  assertEquals(formatShowtime('2026-01-14T17:55:00Z'), 'Wednesday, January 14 at 9:55 AM');
});

Deno.test('showtime is formatted in the venue zone, not the server zone', () => {
  // 11:30 PM Pacific is already the NEXT day in UTC. Naming it in UTC would
  // produce "September 17 at 6:30 AM" and point buyers at a showing that does
  // not exist.
  const name = formatShowtime('2026-09-17T06:30:00Z');
  assert(name.startsWith('Wednesday, September 16 at 11:30 PM'), name);
});

Deno.test('tiered and untiered grammar', () => {
  assertEquals(
    variationName('Adult', SEPT_16_7PM),
    'Adult - Wednesday, September 16 at 7 PM',
  );
  // No tier => the bare showtime form, which 712 live variations use.
  assertEquals(variationName('', SEPT_16_7PM), 'Wednesday, September 16 at 7 PM');
  assertEquals(variationName(null, SEPT_16_7PM), 'Wednesday, September 16 at 7 PM');
});

Deno.test('tier vocabulary collapses to one spelling', () => {
  assertEquals(canonicalTier('GA'), 'General Admission');
  assertEquals(canonicalTier('general admission'), 'General Admission');
  assertEquals(canonicalTier('Students'), 'Student');
  assertEquals(canonicalTier('student'), 'Student');
  assertEquals(canonicalTier('Student/Senior'), 'Student/Senior');
  assertEquals(canonicalTier('adults'), 'Adult');
  assertEquals(canonicalTier('  Child '), 'Child');
});

Deno.test('an unknown tier passes through rather than blocking a sale', () => {
  assertEquals(canonicalTier('opening night'), 'Opening Night');
  // Short all-caps is an acronym, not a word to title-case.
  assertEquals(canonicalTier('VIP'), 'VIP');
});

Deno.test('both separators parse, and the legacy one is not a new variation', () => {
  assertEquals(
    parseVariationName('Adult ~ Wednesday, September 16 at 7 PM'),
    { tier: 'Adult', showtime: 'Wednesday, September 16 at 7 PM' },
  );
  assertEquals(
    parseVariationName('Adult - Wednesday, September 16 at 7 PM'),
    { tier: 'Adult', showtime: 'Wednesday, September 16 at 7 PM' },
  );
  // The whole point: the legacy "~" row IS the "-" row.
  assert(sameVariation(
    'Adult ~ Wednesday, September 16 at 7 PM',
    'Adult - Wednesday, September 16 at 7 PM',
  ));
  // ...and so is a differently-spelled tier.
  assert(sameVariation(
    'GA - Wednesday, September 16 at 7 PM',
    'General Admission - Wednesday, September 16 at 7 PM',
  ));
});

Deno.test('bare showtime parses as no tier', () => {
  assertEquals(
    parseVariationName('Wednesday, September 16 at 7 PM'),
    { tier: null, showtime: 'Wednesday, September 16 at 7 PM' },
  );
});

Deno.test('a tier is not torn apart at its own punctuation', () => {
  // "Student/Senior" has no spaced separator, so it must survive whole. A naive
  // split on "-" or "/" would invent a tier called "Student".
  const parsed = parseVariationName('Student/Senior - Wednesday, September 16 at 7 PM');
  assertEquals(parsed.tier, 'Student/Senior');
  assertEquals(parsed.showtime, 'Wednesday, September 16 at 7 PM');
});

Deno.test('categories follow the numbered taxonomy, by anchored prefix', () => {
  assertEquals(categoryForProduction('movie', 'EMILY THE CRIMINAL'), CATEGORY.film);
  assertEquals(categoryForProduction('movie', 'MET Live in HD: FEDORA'), CATEGORY.metLive);
  assertEquals(
    categoryForProduction('movie', 'NT LIVE: THE IMPORTANCE OF BEING EARNEST'),
    CATEGORY.ntLive,
  );
  assertEquals(
    categoryForProduction('movie', 'National Theatre Live: Prima Facie'),
    CATEGORY.ntLive,
  );
  assertEquals(categoryForProduction('event', 'Palouse Poetry Night'), CATEGORY.liveEvent);
  assertEquals(categoryForProduction('live_performance', 'The Nutcracker'), CATEGORY.liveEvent);
});

Deno.test('classification is anchored, never substring', () => {
  // The PINOCCHIO lesson from the Aug 14 incident: a film that merely CONTAINS a
  // strand name is not part of that strand.
  assertEquals(
    categoryForProduction('movie', 'A Night at the Met: The Documentary'),
    CATEGORY.film,
  );
});

Deno.test('diffPaths finds the moved leaf, not the whole array', () => {
  const before = { item_data: { name: 'X', variations: [{ id: 'a', price: 800 }] } };
  const after = { item_data: { name: 'X', variations: [{ id: 'a', price: 900 }] } };
  assertEquals(diffPaths(before, after), ['item_data.variations[0].price']);
});

Deno.test('diffPaths reports an appended variation as a length change', () => {
  // This is the signal the writer keys on: appending is expected, and it must be
  // distinguishable from an edit to an existing variation.
  const before = { item_data: { variations: [{ id: 'a' }] } };
  const after = { item_data: { variations: [{ id: 'a' }, { id: '#new' }] } };
  assertEquals(diffPaths(before, after), ['item_data.variations.length']);
});

Deno.test('version and updated_at are noise, a price is not', () => {
  assert(isNoisyPath('item_data.variations[0].version'));
  assert(isNoisyPath('updated_at'));
  assert(!isNoisyPath('item_data.variations[0].item_variation_data.price_money.amount'));
  assert(!isNoisyPath('item_data.description'));
});

Deno.test('title normalisation is conservative', () => {
  assertEquals(normalizeTitle('The Green Knight'), 'green knight');
  assertEquals(normalizeTitle("GUILLERMO DEL TORO'S PINOCCHIO"), 'guillermo del toros pinocchio');
  // Two genuinely different films must not normalise together.
  assert(normalizeTitle('Dune') !== normalizeTitle('Dune: Part Two'));
});

// --- desiredVariations ------------------------------------------------------
//
// This decides how many Square variations a showing needs and what each is
// called. It mirrors _shared/pricing.ts, which is the code that actually charges
// the buyer: tiers come from showing_price_tiers, and a showing with no active
// tier sells at showings.ticket_price. If the two ever disagree, a sale rings up
// against a variation priced differently from the ticket it sold.

import { desiredVariations } from './square-catalog.ts';

const SHOWING = {
  id: 's1',
  start_time: '2026-09-17T02:00:00Z',   // Wed 16 Sept, 7 PM Pacific
  ticket_price: 8,
};
const MOVIE = new Map([['s1', { kind: 'movie' as const, id: 'm1', title: 'Emily the Criminal' }]]);

Deno.test('an untiered showing needs exactly one bare-showtime variation', () => {
  const { desired } = desiredVariations([SHOWING], new Map(), MOVIE);
  assertEquals(desired.length, 1);
  assertEquals(desired[0].tier_name, '');
  assertEquals(desired[0].variation_name, 'Wednesday, September 16 at 7 PM');
  assertEquals(desired[0].price_cents, 800);
  assertEquals(desired[0].category, CATEGORY.film);
});

Deno.test('a tiered showing needs one variation per tier, not one per showing', () => {
  // The brief proposed a single square_variation_id column on `showings`. This
  // is why that could not work.
  const tiers = new Map([['s1', [
    { tier_name: 'Adult', price: 8, is_active: true },
    { tier_name: 'Student', price: 5, is_active: true },
    { tier_name: 'Child', price: 3, is_active: true },
  ]]]);
  const { desired } = desiredVariations([SHOWING], tiers, MOVIE);
  assertEquals(desired.length, 3);
  assertEquals(
    desired.map((d) => d.variation_name).sort(),
    [
      'Adult - Wednesday, September 16 at 7 PM',
      'Child - Wednesday, September 16 at 7 PM',
      'Student - Wednesday, September 16 at 7 PM',
    ],
  );
  assertEquals(desired.find((d) => d.tier_name === 'Student')!.price_cents, 500);
});

Deno.test('an inactive tier is not given a variation', () => {
  const tiers = new Map([['s1', [
    { tier_name: 'Adult', price: 8, is_active: true },
    { tier_name: 'Industry Comp', price: 0, is_active: false },
  ]]]);
  const { desired } = desiredVariations([SHOWING], tiers, MOVIE);
  assertEquals(desired.map((d) => d.tier_name), ['Adult']);
});

Deno.test('tiers that mean the same thing collapse to one variation', () => {
  // "Student" and "Students" on one showing are one variation. Without the
  // collapse both would claim the same (showing_id, tier_name) row and the
  // second would fail the unique constraint partway through a run.
  const tiers = new Map([['s1', [
    { tier_name: 'Student', price: 5, is_active: true },
    { tier_name: 'Students', price: 5, is_active: true },
  ]]]);
  const { desired, skipped } = desiredVariations([SHOWING], tiers, MOVIE);
  assertEquals(desired.length, 1);
  assertEquals(desired[0].tier_name, 'Student');
  assertEquals(skipped.length, 1);
  assert(String(skipped[0].reason).includes('duplicate tier'));
});

Deno.test('a showing with no production row is skipped, not guessed at', () => {
  const { desired, skipped } = desiredVariations([SHOWING], new Map(), new Map());
  assertEquals(desired.length, 0);
  assertEquals(skipped.length, 1);
});

Deno.test('MET and NT Live showings carry their own categories', () => {
  const met = new Map([['s1', { kind: 'movie' as const, id: 'm2', title: 'MET Live in HD: FEDORA' }]]);
  assertEquals(desiredVariations([SHOWING], new Map(), met).desired[0].category, CATEGORY.metLive);
});

Deno.test('a free tier is legal, a negative price is not', () => {
  const tiers = new Map([['s1', [
    { tier_name: 'Comp', price: 0, is_active: true },
    { tier_name: 'Broken', price: -1, is_active: true },
  ]]]);
  const { desired, skipped } = desiredVariations([SHOWING], tiers, MOVIE);
  assertEquals(desired.map((d) => d.tier_name), ['Comp']);
  assertEquals(desired[0].price_cents, 0);
  assert(String(skipped[0].reason).includes('no valid price'));
});

// --- catalog integrity ------------------------------------------------------

import { compareToBaseline, summarizeItem } from './square-catalog.ts';

const AT = '2026-08-18T00:00:00Z';

/** A live Square item with two priced variations and an event block. */
function liveItem(over: Record<string, any> = {}) {
  return {
    id: 'ITEM1',
    version: 100,
    updated_at: AT,
    item_data: {
      name: 'MET Live in HD: FEDORA',
      product_type: 'EVENT',
      category_id: 'CAT_MET',
      event: { start_at: '2026-01-14T17:55:00Z', event_location_name: 'Kenworthy' },
      variations: [
        { id: 'V1', item_variation_data: { name: 'Adult - January 14 at 9:55 AM', price_money: { amount: 2000 } } },
        { id: 'V2', item_variation_data: { name: 'Student - January 14 at 9:55 AM', price_money: { amount: 1500 } } },
      ],
      ...over,
    },
  };
}

const baselineOf = (o: any) => ({ ...summarizeItem(o), captured_at: AT });

Deno.test('summarizeItem pulls the fields a CSV round-trip destroys', () => {
  const s = summarizeItem(liveItem());
  assertEquals(s.product_type, 'EVENT');
  assertEquals(s.has_event_block, true);
  assertEquals(s.variation_count, 2);
  assertEquals(s.category_id, 'CAT_MET');
  assertEquals(s.variations[1], { id: 'V2', name: 'Student - January 14 at 9:55 AM', price_cents: 1500 });
});

Deno.test('an unchanged item reports nothing', () => {
  assertEquals(compareToBaseline(baselineOf(liveItem()), summarizeItem(liveItem())), []);
});

Deno.test('a stripped event block is reported', () => {
  const after = liveItem();
  delete (after.item_data as any).event;
  const found = compareToBaseline(baselineOf(liveItem()), summarizeItem(after));
  assertEquals(found.map((f) => f.kind), ['lost_event_block']);
  // The baseline capture time is what a repair reads back from.
  assertEquals(found[0].known_good_at, AT);
});

Deno.test('deleted variations are reported by id, not by count', () => {
  const after = liveItem({
    variations: [{ id: 'V1', item_variation_data: { name: 'Adult - January 14 at 9:55 AM', price_money: { amount: 2000 } } }],
  });
  const found = compareToBaseline(baselineOf(liveItem()), summarizeItem(after));
  assertEquals(found.map((f) => f.kind), ['lost_variations']);
  assertEquals(found[0].lost_variation_ids, ['V2']);
});

Deno.test('a RENAMED variation is not a lost one', () => {
  // Renames keep the id. Treating a rename as a deletion would fire on ordinary
  // editing and train everyone to ignore the alarm.
  const after = liveItem({
    variations: [
      { id: 'V1', item_variation_data: { name: 'Adult ~ January 14 at 9:55 AM', price_money: { amount: 2000 } } },
      { id: 'V2', item_variation_data: { name: 'Student - January 14 at 9:55 AM', price_money: { amount: 1500 } } },
    ],
  });
  assertEquals(compareToBaseline(baselineOf(liveItem()), summarizeItem(after)), []);
});

Deno.test('growth is not damage', () => {
  // A new showtime appends a variation. The guard must stay quiet, or Part B's
  // own writes would set it off on every run.
  const after = liveItem({
    variations: [
      ...liveItem().item_data.variations,
      { id: 'V3', item_variation_data: { name: 'Adult - January 16 at 6 PM', price_money: { amount: 2000 } } },
    ],
  });
  assertEquals(compareToBaseline(baselineOf(liveItem()), summarizeItem(after)), []);
});

Deno.test('the Aug 14 flattening signature is called out by name', () => {
  const after = liveItem({
    variations: [{ id: 'V1', item_variation_data: { name: 'Regular', price_money: { amount: 2000 } } }],
  });
  const kinds = compareToBaseline(baselineOf(liveItem()), summarizeItem(after)).map((f) => f.kind);
  assert(kinds.includes('flattened_to_regular'));
  assert(kinds.includes('lost_variations'));
});

Deno.test('a cleared category is reported, and gaining one is not', () => {
  const cleared = liveItem();
  delete (cleared.item_data as any).category_id;
  assertEquals(
    compareToBaseline(baselineOf(liveItem()), summarizeItem(cleared)).map((f) => f.kind),
    ['lost_category'],
  );
  const gained = liveItem();
  const noCat = liveItem();
  delete (noCat.item_data as any).category_id;
  assertEquals(compareToBaseline(baselineOf(noCat), summarizeItem(gained)), []);
});

Deno.test('an item missing from the walk is reported once, not many times', () => {
  const found = compareToBaseline(baselineOf(liveItem()), null);
  assertEquals(found.length, 1);
  assertEquals(found[0].kind, 'vanished');
});

Deno.test('several losses on one item are reported separately', () => {
  // A CSV round-trip does all of this at once; each needs its own repair.
  const after = liveItem({ variations: [] });
  delete (after.item_data as any).event;
  delete (after.item_data as any).category_id;
  const kinds = compareToBaseline(baselineOf(liveItem()), summarizeItem(after)).map((f) => f.kind).sort();
  assertEquals(kinds, ['lost_category', 'lost_event_block', 'lost_variations']);
});

import { suggestTitleMatches } from './square-catalog.ts';

const CATALOG = [
  { id: 'I1', name: 'EVENT HORIZON' },
  { id: 'I2', name: 'WHO FRAMED ROGER RABBIT' },
  { id: 'I3', name: 'Silent Film Festival: CHAPLIN SHORTS' },
  { id: 'I4', name: 'DUNE' },
  { id: 'I5', name: 'Moscow Film Society: Event Horizon' },
];

Deno.test('a series prefix does not hide a film already in the catalog', () => {
  // Measured against production: ten titles reported as needing a new item, five
  // of which already existed. Creating those would have split each film's
  // revenue across two Square items.
  const s = suggestTitleMatches('Moscow Film Society: Event Horizon', CATALOG);
  assertEquals(s[0].id, 'I1');
  assert(s[0].why.includes('series prefix'));
});

Deno.test('a near title is offered, not assumed', () => {
  const s = suggestTitleMatches('Silent Film Festival: Charlie Chaplin Shorts', CATALOG);
  assert(s.some((x) => x.id === 'I3'));
});

Deno.test('an exact match is never a suggestion', () => {
  // It would already be linked; offering it as a maybe is noise.
  const s = suggestTitleMatches('Moscow Film Society: Event Horizon', [CATALOG[4]]);
  assertEquals(s.length, 0);
});

Deno.test('an unrelated film is not suggested', () => {
  assertEquals(suggestTitleMatches('Cinema Classics: On the Waterfront', [CATALOG[3]]), []);
});

Deno.test('partial words do not match', () => {
  // "Rabbit" must not pull in "WHO FRAMED ROGER RABBIT" for Peter Rabbit, and a
  // substring like "dune" inside another word must not match at all.
  const s = suggestTitleMatches('Summer Family Matinee: Peter Rabbit', CATALOG);
  assertEquals(s.length, 0);
});

// --- parseKindFilter --------------------------------------------------------
//
// This one guards a Square *write*. The scoped Listings sections promise that
// "Create all 3" under the movie list writes three movies, and this is where
// that promise is kept.
import { parseKindFilter } from './square-catalog.ts';

Deno.test('parseKindFilter: absent means no restriction', () => {
  assertEquals(parseKindFilter(undefined), { kinds: [] });
});

Deno.test('parseKindFilter: passes through a valid subset', () => {
  assertEquals(parseKindFilter(['movie']), { kinds: ['movie'] });
  assertEquals(
    parseKindFilter(['event', 'live_performance']),
    { kinds: ['event', 'live_performance'] },
  );
});

// The important ones: every rejection below would otherwise widen a scoped
// button into a write across every listing.
Deno.test('parseKindFilter: a misspelled kind is refused, not ignored', () => {
  const result = parseKindFilter(['mvoie']);
  assertEquals('error' in result, true);
  assertEquals((result as { error: string }).error.includes('mvoie'), true);
});

Deno.test('parseKindFilter: one bad kind among good ones still refuses', () => {
  assertEquals('error' in parseKindFilter(['movie', 'nonsense']), true);
});

Deno.test('parseKindFilter: an empty array is refused rather than read as global', () => {
  assertEquals('error' in parseKindFilter([]), true);
});

Deno.test('parseKindFilter: a non-array is refused', () => {
  assertEquals('error' in parseKindFilter('movie'), true);
  assertEquals('error' in parseKindFilter({ kind: 'movie' }), true);
  assertEquals('error' in parseKindFilter(null), true);
});
