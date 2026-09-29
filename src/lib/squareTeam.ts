/**
 * What the roster says about a Square team member.
 *
 * Square's `TeamMember.status` is ACTIVE or INACTIVE, and it describes the
 * *record* — deactivated in the Dashboard or not. It does not say whether the
 * person accepted their Square invitation or can sign in: the Team API has no
 * field for that ("Invite expired" exists only in the Dashboard). The badge
 * used to read "Active in Square", which a record created years ago and never
 * used also earns, and it read as "set up in Square". So the label names the
 * record, and the explanation says what it cannot tell you.
 * See docs/briefs/FINDINGS-square-team-member-status.md.
 */
export const SQUARE_STATUS_HELP =
  'Square status is the team-member record: active, or deactivated. Whether they have accepted ' +
  'their Square invitation and can sign in to Square is managed in Square Dashboard → Team, and ' +
  "Square's API doesn't report it.";

export function squareStatusBadge(status: string | null | undefined): {
  label: string;
  variant: 'default' | 'secondary';
} {
  if (status === 'ACTIVE') return { label: 'Active record in Square', variant: 'default' };
  if (status === 'INACTIVE') return { label: 'Inactive in Square', variant: 'secondary' };
  return { label: `${status ? status.toLowerCase() : 'unknown'} in Square`, variant: 'secondary' };
}

/** First word is the given name, the rest the family name — Square wants
 *  both, and a prefill the admin corrects beats two empty boxes. */
export function splitName(full: string | null | undefined): { given: string; family: string } {
  const words = (full ?? '').trim().split(/\s+/).filter(Boolean);
  return { given: words[0] ?? '', family: words.slice(1).join(' ') };
}
