import { describe, it, expect } from 'vitest';
import { blankTitle, contractFilename, contractRows, requestContractDate } from './contracts';

describe('contractFilename', () => {
  it('is the event day then the title, underscored', () => {
    expect(contractFilename({ date: '2026-11-13', title: 'French Film Festival' }))
      .toBe('2026_11_13_French_Film_Festival.pdf');
  });

  it('reads the day as written, not as UTC midnight', () => {
    // new Date('2026-11-01') is Oct 31 in Pacific time.
    expect(contractFilename({ date: '2026-11-01', title: 'Gala' })).toBe('2026_11_01_Gala.pdf');
  });

  it('marks the signed copy', () => {
    expect(contractFilename({ date: '2026-11-13', title: 'Gala', signed: true })).toBe('2026_11_13_Gala-signed.pdf');
  });

  it('keeps letters outside ASCII and drops punctuation', () => {
    expect(contractFilename({ date: '2026-11-13', title: "  Café & Ciné: L'été!  " }))
      .toBe('2026_11_13_Café_Ciné_L_été.pdf');
  });

  it('falls back to BLANK without a title, and leaves out a missing date', () => {
    expect(contractFilename({ date: '', title: '' })).toBe('BLANK.pdf');
    expect(contractFilename({ date: '2026-11-13', title: null })).toBe('2026_11_13_BLANK.pdf');
    expect(contractFilename({ date: undefined, title: 'Gala' })).toBe('Gala.pdf');
  });
});

describe('blankTitle', () => {
  it('is the purpose, else the licensee, else the organization', () => {
    expect(blankTitle({ purpose: ' Recital ', name: 'Ada', organization: 'Org' })).toBe('Recital');
    expect(blankTitle({ purpose: '', name: 'Ada', organization: 'Org' })).toBe('Ada');
    expect(blankTitle({ purpose: '', name: ' ', organization: 'Org' })).toBe('Org');
    expect(blankTitle({ purpose: '', name: '', organization: '' })).toBe('');
  });
});

describe('requestContractDate', () => {
  it('prefers the Term staff set, then the requested day', () => {
    expect(requestContractDate({ term_date: '2026-11-12' }, '2026-11-13')).toBe('2026-11-12');
    expect(requestContractDate(null, '2026-11-13')).toBe('2026-11-13');
    expect(requestContractDate({}, '2026-11-13')).toBe('2026-11-13');
  });

  it('treats a deliberately blank Term date as no date, as the contract prints it', () => {
    expect(requestContractDate({ term_date: '' }, '2026-11-13')).toBeNull();
  });
});

describe('contractRows', () => {
  const req = (over: Partial<Parameters<typeof contractRows>[0][number]>) => ({
    id: 'r', event_title: 'Gala', proposed_date: '2026-11-13', contract_data: null,
    signed_at: null, signed_pdf_path: null, assigned_to: null, invite_token: 'tok', status: 'pending',
    ...over,
  });

  const requests = [
    req({ id: 'r1', event_title: 'Signed show', proposed_date: '2026-10-01', signed_at: '2026-09-01T00:00:00Z', signed_pdf_path: 'r1/abc.pdf', invite_token: 't1' }),
    req({ id: 'r2', event_title: 'Moved by Term', proposed_date: '2026-09-01', contract_data: { term_date: '2026-12-24' }, invite_token: 't2', assigned_to: 'u1' }),
  ];
  const blanks = [
    { id: 'b1', title: 'Recital', event_date: '2026-11-20' },
    { id: 'b2', title: '', event_date: null },
  ];

  it('lists both sources together, latest event first, undated last', () => {
    expect(contractRows(requests, blanks).map(r => r.key))
      .toEqual(['request:r2', 'blank:b1', 'request:r1', 'blank:b2']);
  });

  it('links each to its own page, and only requests to a renter', () => {
    const rows = contractRows(requests, blanks);
    expect(rows[0]).toMatchObject({ kind: 'request', path: '/contract/t2', renterPath: '/contract/t2', assignedTo: 'u1', eventDate: '2026-12-24' });
    expect(rows[1]).toMatchObject({ kind: 'blank', path: '/contract/blank/b1', renterPath: null, signed: false });
    expect(rows[3].title).toBe('Untitled blank contract');
  });

  it('filters by signed and draft; a blank is never signed', () => {
    expect(contractRows(requests, blanks, 'signed').map(r => r.key)).toEqual(['request:r1']);
    expect(contractRows(requests, blanks, 'draft').map(r => r.key)).toEqual(['request:r2', 'blank:b1', 'blank:b2']);
    expect(contractRows(requests, blanks, 'signed')[0].signedPdfPath).toBe('r1/abc.pdf');
  });
});
