import * as XLSX from 'xlsx';
import { normalizeTitle, extractFilmYear, stripYearSuffix } from './normalizeTitle';

export type HistoricalRow = {
  screening_date: string; // YYYY-MM-DD
  year: number;
  venue_name: string;
  film_title_normalized: string;
  film_title_display: string;
  film_year: number | null;
  is_double_feature: boolean;
  raw_cell: string;
};

function toIsoDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/**
 * Parse the "Full List of Movies at Palouse Theaters 1926 to 2026" workbook.
 * Each sheet = a year, columns = [Date, <Theater 1>, <Theater 2>, ...].
 * Returns one row per (date, venue, film title), splitting double features on " / ".
 */
export function parseHistoricalWorkbook(buffer: ArrayBuffer): HistoricalRow[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const out: HistoricalRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (!rows.length) continue;

    const header = rows[0].map((h: any) => (h == null ? '' : String(h).trim()));
    if (!header.length || header[0]?.toLowerCase() !== 'date') continue;
    const venues = header.slice(1);

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || !row[0]) continue;
      const iso = toIsoDate(row[0]);
      if (!iso) continue;
      const year = parseInt(iso.slice(0, 4), 10);

      for (let c = 0; c < venues.length; c++) {
        const venue = venues[c];
        if (!venue) continue;
        const cell = row[c + 1];
        if (cell == null || String(cell).trim() === '') continue;
        const raw = String(cell).trim();
        const parts = raw.split(/\s*\/\s*/);
        const isDouble = parts.length > 1;
        for (const part of parts) {
          if (!part) continue;
          const display = stripYearSuffix(part);
          out.push({
            screening_date: iso,
            year,
            venue_name: venue,
            film_title_normalized: normalizeTitle(part),
            film_title_display: display,
            film_year: extractFilmYear(part),
            is_double_feature: isDouble,
            raw_cell: raw,
          });
        }
      }
    }
  }

  return out;
}