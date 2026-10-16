import { describe, it, expect } from 'vitest';
import { blankToContractData, fieldDiffs, newRequestFrom, rankMatches, type LinkableRequest } from './blankLink';
import { EMPTY_BLANK, type BlankFields } from '@/lib/blankFields';

const blank = (over: Partial<BlankFields>): BlankFields => ({ ...EMPTY_BLANK, ...over });

const req = (over: Partial<LinkableRequest>): LinkableRequest => ({
  id: 'r', event_title: 'Harvest Gala', applicant_name: 'Ada Lovelace', organization_name: null,
  email: 'ada@example.com', phone: null, event_description: null, proposed_date: '2026-11-14', end_date: null,
  event_start_time: '18:00:00', event_end_time: '22:00:00', signed_at: null, status: 'pending',
  submitted_at: '2026-10-01T00:00:00Z', ...over,
});

describe('fieldDiffs', () => {
  it('lists only what was typed and differs', () => {
    const f = blank({ name: 'Ada Byron', email: 'ADA@example.com', event_date: '2026-11-13', start_time: '18:00', phone: '' });
    expect(fieldDiffs(f, req({}))).toEqual([
      { kind: 'identity', key: 'applicant_name', label: 'Licensee name', request: 'Ada Lovelace', blank: 'Ada Byron' },
      { kind: 'term', key: 'term_date', label: 'Event date', request: '2026-11-14', blank: '2026-11-13' },
    ]);
  });

  it('is empty for a blank that agrees with the request, or says nothing', () => {
    expect(fieldDiffs(EMPTY_BLANK, req({}))).toEqual([]);
    expect(fieldDiffs(blank({ name: ' Ada Lovelace ', end_time: '22:00' }), req({}))).toEqual([]);
  });
});

describe('blankToContractData', () => {
  it('carries typed costs as numbers and leaves untyped ones to the standard rates', () => {
    const f = blank({ hourly_rate: '150', base_hours: '3', staff_hours: '', nonprofit_discount: '25', max_attendees: '120', alcohol_addendum: 'served', agreement_date: '2026-10-16' });
    expect(blankToContractData(f)).toEqual({
      hourly_rate: 150, base_hours: 3, nonprofit_discount: 25, max_attendees: 120,
      alcohol_addendum: 'served', agreement_date: '2026-10-16',
    });
  });

  it('sets the Term only for the dates and times chosen from the blank', () => {
    const f = blank({ event_date: '2026-11-13', start_time: '17:30', end_time: '23:00' });
    expect(blankToContractData(f, ['term_date', 'term_start'])).toEqual({ term_date: '2026-11-13', term_start: '17:30' });
  });

  it('keeps the other Term days, dropping empty rows', () => {
    const f = blank({ extra_days: [{ label: ' load-in ', date: '2026-11-12', start: '09:00', end: '12:00' }, { label: '', date: '', start: '', end: '' }] });
    expect(blankToContractData(f).extra_days).toEqual([{ label: 'load-in', date: '2026-11-12', start: '09:00', end: '12:00' }]);
  });
});

describe('newRequestFrom', () => {
  it("is the blank's when, purpose and alcohol choice, with the details the dialog asked for", () => {
    const f = blank({ event_date: '2026-11-20', start_time: '19:00', purpose: 'Piano recital', alcohol_addendum: 'served' });
    expect(newRequestFrom(f, { event_title: ' Recital ', applicant_name: 'Jane', email: 'j@x.test', organization_name: '', phone: '' }))
      .toMatchObject({ event_title: 'Recital', proposed_date: '2026-11-20', event_start_time: '19:00', event_description: 'Piano recital', wants_beer_wine: true });
  });
});

describe('rankMatches', () => {
  const requests = [
    req({ id: 'email', email: 'jane@x.test', applicant_name: 'J. Doe', proposed_date: '2027-01-01' }),
    req({ id: 'date', proposed_date: '2026-11-20', applicant_name: 'Someone', event_title: 'Other' }),
    req({ id: 'both', email: 'jane@x.test', proposed_date: '2026-11-20', applicant_name: 'Jane Doe' }),
    req({ id: 'none', email: 'z@z.test', applicant_name: 'Zed', event_title: 'Zzz', proposed_date: null }),
  ];

  it('puts the same email and date first, and leaves out requests with no reason', () => {
    const m = rankMatches(blank({ name: 'Jane Doe', email: 'Jane@x.test', event_date: '2026-11-20' }), requests);
    expect(m.map(x => x.request.id)).toEqual(['both', 'email', 'date']);
    expect(m[0].reasons).toEqual(['same email', 'same date', '"jane", "doe"']);
  });
});
