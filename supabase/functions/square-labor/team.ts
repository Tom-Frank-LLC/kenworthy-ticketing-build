// The testable half of square-labor: which actions are admin-only, and the
// CreateTeamMember request built from what the roster sends.
//
// index.ts calls Deno.serve at import time, so nothing in it can be imported
// by a test. Anything worth pinning lives here instead.

/** Actions that write to Square, act on somebody else, or read anybody's pay.
 *  Staff may call the rest: their own clock (current_shift, clock_in,
 *  clock_out, breaks) and their own schedule (my_upcoming_shifts). One set,
 *  checked once before the switch, so a new action cannot forget its gate.
 *
 *  The four reads are here because they return every coworker's email and
 *  hourly rate (list_team, and list_shifts through the wage Square stamps on
 *  each shift), the whole schedule, and revenue against labor cost. They back
 *  the admin-only Team, Timecards, Payroll, Schedule and Labor-vs-Sales tabs;
 *  the staff time clock never needed them (security audit 2026-10-06, M6). */
export const ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  "force_close_shift",
  "upsert_scheduled_shift",
  "delete_scheduled_shift",
  "publish_week",
  "create_team_member",
  "list_team",
  "list_shifts",
  "list_scheduled_shifts",
  "labor_summary",
]);

/** Shift actions a staff member may take on a timecard — only their own. */
export const OWN_SHIFT_ACTIONS: ReadonlySet<string> = new Set([
  "clock_out",
  "start_break",
  "end_break",
]);

/**
 * Why this caller may not change this shift, or null if they may.
 *
 * An admin may change any shift (force_close_shift is the same write). Anyone
 * else must be the shift's own team member, through their staff_square_links
 * row; with no link they own no shift. Without this, clock_out on a coworker's
 * open shift_id did at staff level what force_close_shift does for admins.
 */
export function shiftAccessError(
  shift: { team_member_id?: unknown } | null | undefined,
  callerTeamMemberId: string | null,
  isAdmin: boolean,
): string | null {
  if (isAdmin) return null;
  if (!callerTeamMemberId) {
    return "No Square team member linked to your account. Ask an admin to link you under Labor → Team & Linking.";
  }
  if (!shift || shift.team_member_id !== callerTeamMemberId) {
    return "That shift is not yours. Ask an admin to change someone else's timecard.";
  }
  return null;
}

/** A Square object id as one URL path segment. Ids come from the request
 *  body, so an id carrying "/" or "?" must not be able to reach a different
 *  Square endpoint than the one this code names. */
export const pathId = (id: string) => encodeURIComponent(id);

export interface CreateTeamMemberInput {
  user_id?: unknown;
  given_name?: unknown;
  family_name?: unknown;
  email?: unknown;
  phone?: unknown;
}

const text = (v: unknown) => (typeof v === "string" ? v.trim() : "");

/**
 * The body for Square's CreateTeamMember, or the reason it can't be built.
 *
 * - `reference_id` is our user id, so the account and the Square member are
 *   tied together at creation rather than only through staff_square_links.
 * - Assigned explicitly to our one location: `list_team` searches by location,
 *   so a member with no location would be created and then never seen.
 * - No wage_setting. Wages are set in Square (brief decision 3).
 * - Email and phone are passed through as typed; Square validates both and
 *   its message is the one worth showing (e.g. a duplicate email).
 *
 * Creating a team member does NOT invite them. Square only sends the Team app
 * invitation after someone assigns permissions in Dashboard → Team.
 */
export function createTeamMemberBody(
  input: CreateTeamMemberInput,
  locationId: string,
  idempotencyKey: string,
): { ok: true; body: Record<string, unknown>; userId: string } | { ok: false; error: string } {
  const userId = text(input.user_id);
  const given = text(input.given_name);
  const family = text(input.family_name);
  const email = text(input.email);
  const phone = text(input.phone);
  if (!userId) return { ok: false, error: "user_id is required" };
  if (!given || !family) return { ok: false, error: "Square needs both a first and a last name." };

  return {
    ok: true,
    userId,
    body: {
      idempotency_key: idempotencyKey,
      team_member: {
        reference_id: userId,
        given_name: given,
        family_name: family,
        ...(email ? { email_address: email } : {}),
        ...(phone ? { phone_number: phone } : {}),
        assigned_locations: {
          assignment_type: "EXPLICIT_LOCATIONS",
          location_ids: [locationId],
        },
      },
    },
  };
}
