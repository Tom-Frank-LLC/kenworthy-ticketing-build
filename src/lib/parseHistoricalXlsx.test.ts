import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseHistoricalWorkbook } from './parseHistoricalXlsx';

/** Build an in-memory workbook from raw sheet grids, mirroring the real file's shape. */
function workbook(sheets: Record<string, any[][]>): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  for (const [name, grid] of Object.entries(sheets)) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(grid), name);
  }
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return out as ArrayBuffer;
}

describe('parseHistoricalWorkbook', () => {
  it('reads labelled venue columns', () => {
    const rows = parseHistoricalWorkbook(
      workbook({
        1976: [
          ['Date', 'Kenworthy', 'Nuart'],
          ['1976-01-01', 'Taxi Driver (1976)', 'Carrie (1976)'],
        ],
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.venue_name === 'Kenworthy')?.film_title_display).toBe('Taxi Driver');
    expect(rows.find((r) => r.venue_name === 'Nuart')?.film_title_display).toBe('Carrie');
  });

  // The 2006-2025 sheets stop labelling venues; the Kenworthy is the only theater left.
  it('attributes an unlabelled first column to the Kenworthy', () => {
    const rows = parseHistoricalWorkbook(
      workbook({
        2014: [
          ['Date', null],
          ['2014-01-02', 'The Hunger Games: Catching Fire (2013)'],
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].venue_name).toBe('Kenworthy');
    expect(rows[0].film_title_display).toBe('The Hunger Games: Catching Fire');
    expect(rows[0].film_year).toBe(2013);
    expect(rows[0].year).toBe(2014);
  });

  it('recovers the first column even when the header row is narrower than the data', () => {
    const rows = parseHistoricalWorkbook(
      workbook({
        2023: [['Date'], ['2023-05-05', 'Past Lives (2023)']],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].venue_name).toBe('Kenworthy');
  });

  // Trailing unlabelled columns hold building notes, not screenings.
  it('ignores unlabelled annotation columns after the first', () => {
    const rows = parseHistoricalWorkbook(
      workbook({
        1949: [
          ['Date', 'Kenworthy', 'Nuart', null, null],
          ['1949-06-01', 'White Heat (1949)', null, null, 'Kenworthy closes for remodel'],
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].venue_name).toBe('Kenworthy');
    expect(rows.some((r) => /remodel/i.test(r.raw_cell))).toBe(false);
  });

  it('splits double features and flags them', () => {
    const rows = parseHistoricalWorkbook(
      workbook({
        1976: [
          ['Date', 'Kenworthy'],
          ['1976-01-01', 'Dirty Harry (1971) / Magnum Force (1973)'],
        ],
      }),
    );
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.is_double_feature)).toBe(true);
    expect(rows.map((r) => r.film_title_display)).toEqual(['Dirty Harry', 'Magnum Force']);
    expect(rows.every((r) => r.raw_cell === 'Dirty Harry (1971) / Magnum Force (1973)')).toBe(true);
  });

  it('skips sheets without a Date header and rows without a date', () => {
    const rows = parseHistoricalWorkbook(
      workbook({
        Notes: [['Something', 'else'], ['x', 'y']],
        1980: [
          ['Date', 'Kenworthy'],
          [null, 'Orphaned row (1980)'],
          ['1980-03-03', 'Airplane! (1980)'],
        ],
      }),
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].film_title_display).toBe('Airplane!');
  });
});
