// The testable half of square-labor: which actions are admin-only, and the
// CreateTeamMember request built from what the roster sends.
//
// index.ts calls Deno.serve at import time, so nothing in it can be imported
// by a test. Anything worth pinning lives here instead.

/** Actions that write to Square or act on somebody else. Staff may call the
 *  rest (their own clock, the schedule, the roster read). One set, checked
 *  once before the switch, so a new write action cannot forget its gate. */
export const ADMIN_ACTIONS: ReadonlySet<string> = new Set([
  "force_close_shift",
  "upsert_scheduled_shift",
  "delete_scheduled_shift",
  "publish_week",
  "create_team_member",
]);

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
