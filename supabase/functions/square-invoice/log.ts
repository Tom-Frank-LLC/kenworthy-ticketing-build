// What of a Square error body may be written to the function log.

/**
 * A Square error response as it may appear in a log line: category and code
 * only. The full body echoes back what was sent — the renter's email address,
 * name and phone — into function logs that outlive any retention we apply to
 * the data itself (security audit 2026-10-06, L15). The detail still reaches
 * the staff member through squareErrorMessage.
 */
export function squareErrorSummary(data: any): string {
  const errors = Array.isArray(data?.errors) ? data.errors : [];
  if (errors.length === 0) return 'no error body';
  return errors.map((e: any) => `${e?.category ?? '?'}/${e?.code ?? '?'}${e?.field ? ` (${e.field})` : ''}`).join(', ');
}
