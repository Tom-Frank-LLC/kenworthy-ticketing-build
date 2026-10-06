import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import { parseFinancialWorkbook } from './parseFinancialXlsx';

/**
 * Pins what the Accounting tab's upload reads out of a workbook, so the SheetJS
 * upgrade (0.18.5 from npm → 0.20.3 from SheetJS's own CDN, for the prototype
 * pollution and ReDoS advisories npm never got a fix for) is proven to change
 * nothing. Dates are the risky part: SheetJS changed how it builds Date objects
 * between those versions, and the parser reads them with getUTC*. Run this
 * under more than one TZ (`TZ=America/Los_Angeles npx vitest run …`, `TZ=UTC`)
 * — the theatre is on Pacific time.
 */

/** A workbook the way Excel stores one: dates as serial numbers with a date format. */
function workbook(): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  const march = XLSX.utils.aoa_to_sheet([
    ['Event', 'Date', 'Att', 'Box Office', 'Conc', 'Notes'],
    ['Casablanca', { t: 'n', v: 46096, z: 'm/d/yy' }, 112, '$1,234.50', 310.25, '  restored print '],
    ['Late Show', '3/31/2026', '87', 600, null, null],
    [null, null, null, null, null, null],
    ['MONTH TOTAL', null, 199, 1834.5, 310.25, null],
  ]);
  XLSX.utils.book_append_sheet(wb, march, 'March');
  // A non-month sheet is skipped.
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([['Totals'], [1]]), 'Totals');
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}

describe('parseFinancialWorkbook', () => {
  const rows = parseFinancialWorkbook(workbook(), 2026);

  it('reads only the month sheets, keeping the month total and dropping blank rows', () => {
    expect(rows.map(r => [r.source_month, r.event_name, r.is_month_total])).toEqual([
      ['March', 'Casablanca', false],
      ['March', 'Late Show', false],
      ['March', 'MONTH TOTAL', true],
    ]);
  });

  // West of UTC (the theatre, and UTC itself) only. East of UTC the parser
  // reads SheetJS's local-midnight Date with getUTC* and lands a day early —
  // identically on 0.18.5 and 0.20.3, so it predates the upgrade and is
  // recorded in docs/briefs/BRIEF-sec-deps.md rather than changed here.
  it.runIf(new Date(2026, 2, 15).getTimezoneOffset() >= 0)(
    'turns a serial-number date into the same calendar day',
    () => {
    // 46096 is 2026-03-15 in Excel's 1900 date system.
    expect(rows[0].entry_date).toBe('2026-03-15');
    expect(rows[1].entry_date).toBe('2026-03-31');
    },
  );

  it('coerces money and counts the way the tab stores them', () => {
    expect(rows[0]).toMatchObject({
      source_year: 2026,
      attendance: 112,
      box_office: 1234.5,
      concessions: 310.25,
      notes: 'restored print',
    });
    expect(rows[1]).toMatchObject({ attendance: 87, box_office: 600, concessions: null, notes: null });
  });
});
