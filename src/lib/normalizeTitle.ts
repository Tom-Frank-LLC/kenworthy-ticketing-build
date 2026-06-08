/**
 * Normalize a film title for matching across the historical archive,
 * current `movies` table, and financial entries.
 * - lowercase
 * - strip "(YYYY)" suffix
 * - drop leading articles (the/a/an)
 * - collapse punctuation/whitespace
 */
export function normalizeTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw).toLowerCase();
  s = s.replace(/\(\d{4}\)/g, ' ');
  s = s.replace(/[\u2018\u2019']/g, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  s = s.replace(/^(the|a|an)\s+/, '');
  return s.replace(/\s+/g, ' ');
}

/** Pull "(YYYY)" out of a raw title cell. */
export function extractFilmYear(raw: string): number | null {
  const m = String(raw).match(/\((\d{4})\)/);
  return m ? parseInt(m[1], 10) : null;
}

/** Strip the "(YYYY)" suffix and trim. */
export function stripYearSuffix(raw: string): string {
  return String(raw).replace(/\s*\(\d{4}\)\s*$/, '').trim();
}