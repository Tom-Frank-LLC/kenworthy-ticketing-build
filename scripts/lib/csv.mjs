/**
 * Minimal RFC 4180 CSV reader/writer — enough for the DVD inventory, no dependency.
 * Handles quoted fields, embedded commas/newlines, and doubled quotes ("").
 */

/** @returns {{header: string[], rows: string[][]}} */
export function parseCsv(text) {
  const records = [];
  let field = '';
  let record = [];
  let inQuotes = false;

  // Strip a UTF-8 BOM and normalise CRLF so field values don't carry stray \r.
  const src = text.replace(/^﻿/, '').replace(/\r\n/g, '\n');

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      record.push(field);
      field = '';
    } else if (ch === '\n') {
      record.push(field);
      records.push(record);
      field = '';
      record = [];
    } else {
      field += ch;
    }
  }
  // Trailing record when the file doesn't end in a newline.
  if (field !== '' || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [header, ...rows] = records;
  if (!header) throw new Error('CSV is empty');
  return { header, rows };
}

function escapeField(value) {
  const s = value ?? '';
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(header, rows) {
  return [header, ...rows].map((r) => r.map(escapeField).join(',')).join('\n') + '\n';
}
