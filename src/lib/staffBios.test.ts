import { describe, it, expect } from 'vitest';
import { byStaffOrder, publishedStaff, type StaffBio } from './staffBios';

function bio(over: Partial<StaffBio> & { name: string }): StaffBio {
  return {
    id: over.name,
    title: null,
    bio: null,
    headshot_url: null,
    display_on_about: true,
    sort_order: 0,
    is_active: true,
    ...over,
  };
}

describe('byStaffOrder', () => {
  it('puts the lowest sort_order first', () => {
    const rows = [bio({ name: 'Zoe', sort_order: 0 }), bio({ name: 'Abe', sort_order: 1 })];
    expect([...rows].sort(byStaffOrder).map(b => b.name)).toEqual(['Zoe', 'Abe']);
  });

  // The case that actually happens: nobody has reordered anything yet, so
  // every row is still at the default 0 and the sort has nothing to go on but
  // the name. Without the tie-break the order is whatever the database
  // returned, which changes the next time a row is touched.
  it('falls back to the name when every row is at the default sort_order', () => {
    const rows = [bio({ name: 'Zoe' }), bio({ name: 'Abe' }), bio({ name: 'Mo' })];
    expect([...rows].sort(byStaffOrder).map(b => b.name)).toEqual(['Abe', 'Mo', 'Zoe']);
  });
});

describe('publishedStaff', () => {
  it('drops the un-flagged and the former staff, and orders what is left', () => {
    const rows = [
      bio({ name: 'Shown second', sort_order: 2 }),
      bio({ name: 'Not flagged', display_on_about: false }),
      bio({ name: 'Left the theatre', is_active: false }),
      bio({ name: 'Shown first', sort_order: 1 }),
      // Ticked for the page but no longer staff — both flags have to hold.
      bio({ name: 'Ticked but gone', is_active: false, sort_order: 0 }),
    ];
    expect(publishedStaff(rows).map(b => b.name)).toEqual(['Shown first', 'Shown second']);
  });

  it('returns nothing when nobody is flagged, so the section can hide itself', () => {
    expect(publishedStaff([bio({ name: 'Draft', display_on_about: false })])).toEqual([]);
  });
});
