// Shared shape and ordering for staff bios.
//
// Two screens read this table — the admin Bios sub-tab and the "Kenworthy
// Staff" section of /about — and they have to agree about the order, or the
// admin list stops being a preview of the page it edits. So the comparator
// lives here rather than being written twice as a pair of `.order()` chains
// that drift.

export interface StaffBio {
  id: string;
  name: string;
  title: string | null;
  bio: string | null;
  headshot_url: string | null;
  display_on_about: boolean;
  sort_order: number;
  is_active: boolean;
}

/** The columns both screens select. Kept in one place so they cannot diverge. */
export const STAFF_BIO_COLUMNS =
  'id, name, title, bio, headshot_url, display_on_about, sort_order, is_active';

/**
 * Lowest sort_order first, name breaking ties.
 *
 * The tie-break matters more than it looks: sort_order defaults to 0, so until
 * someone reorders anything *every* row ties. Without the name comparison the
 * order would be whatever Postgres returned, which is stable enough to look
 * deliberate and unstable enough to change the day a row is updated.
 */
export function byStaffOrder(a: StaffBio, b: StaffBio): number {
  return a.sort_order - b.sort_order || a.name.localeCompare(b.name);
}

/** The rows /about is allowed to show, in the order it shows them. */
export function publishedStaff(bios: StaffBio[]): StaffBio[] {
  return bios.filter(b => b.display_on_about && b.is_active).sort(byStaffOrder);
}
