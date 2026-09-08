/**
 * The document title for a showing, in three sizes: the full form with the
 * venue, then without it, then the bare title — whichever is the first to fit
 * the 60-character limit a search result prints. `<SEO>` clamps anything
 * longer with an ellipsis, which for a long film title cut off the *date*,
 * the one part a shared link needs.
 *
 * Shared with worker/index.ts, which writes the same title into the no-JS head.
 */
export function showingTitle(title: string, when: string, limit = 60): string {
  const full = `${title} — ${when} at Kenworthy`;
  if (full.length <= limit) return full;
  const dated = `${title} — ${when}`;
  if (dated.length <= limit) return dated;
  return title;
}
