import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ADMIN_ACTIONS, createTeamMemberBody, OWN_SHIFT_ACTIONS, pathId, shiftAccessError } from "./team.ts";

Deno.test("creating a Square team member is admin-only", () => {
  assert(ADMIN_ACTIONS.has("create_team_member"));
});

Deno.test("the existing write actions stay admin-only", () => {
  for (const a of ["force_close_shift", "upsert_scheduled_shift", "delete_scheduled_shift", "publish_week"]) {
    assert(ADMIN_ACTIONS.has(a), a);
  }
});

Deno.test("staff keep their own clock and their own schedule", () => {
  for (const a of ["clock_in", "clock_out", "start_break", "end_break", "current_shift", "my_upcoming_shifts"]) {
    assert(!ADMIN_ACTIONS.has(a), a);
  }
});

Deno.test("the payroll and schedule reads are admin-only (M6)", () => {
  for (const a of ["list_team", "list_shifts", "list_scheduled_shifts", "labor_summary"]) {
    assert(ADMIN_ACTIONS.has(a), a);
  }
});

Deno.test("every staff shift mutation is ownership-checked", () => {
  for (const a of ["clock_out", "start_break", "end_break"]) {
    assert(OWN_SHIFT_ACTIONS.has(a), a);
  }
  // force_close_shift is the admin path and is not ownership-checked.
  assert(!OWN_SHIFT_ACTIONS.has("force_close_shift"));
});

Deno.test("a staffer may change only their own shift", () => {
  assertEquals(shiftAccessError({ team_member_id: "TM1" }, "TM1", false), null);
  assert(shiftAccessError({ team_member_id: "TM2" }, "TM1", false));
  assert(shiftAccessError({ team_member_id: "TM1" }, null, false));
  assert(shiftAccessError(null, "TM1", false));
  assert(shiftAccessError({}, "TM1", false));
});

Deno.test("an admin may change anyone's shift", () => {
  assertEquals(shiftAccessError({ team_member_id: "TM2" }, null, true), null);
});

Deno.test("ids are one path segment", () => {
  assertEquals(pathId("ABC123"), "ABC123");
  assertEquals(pathId("../team-members/X?y=1"), "..%2Fteam-members%2FX%3Fy%3D1");
});

Deno.test("the create body ties the member to the account and the location", () => {
  const r = createTeamMemberBody(
    { user_id: " u-1 ", given_name: " Ada ", family_name: "Lovelace", email: "ada@example.org", phone: "+12085550100" },
    "LOC",
    "key-1",
  );
  assert(r.ok);
  assertEquals(r.userId, "u-1");
  assertEquals(r.body, {
    idempotency_key: "key-1",
    team_member: {
      reference_id: "u-1",
      given_name: "Ada",
      family_name: "Lovelace",
      email_address: "ada@example.org",
      phone_number: "+12085550100",
      assigned_locations: { assignment_type: "EXPLICIT_LOCATIONS", location_ids: ["LOC"] },
    },
  });
});

Deno.test("blank email and phone are left out, not sent empty", () => {
  const r = createTeamMemberBody({ user_id: "u", given_name: "A", family_name: "B", email: " ", phone: "" }, "L", "k");
  assert(r.ok);
  const member = r.body.team_member as Record<string, unknown>;
  assert(!("email_address" in member));
  assert(!("phone_number" in member));
  assert(!("wage_setting" in member));
});

Deno.test("both names and the account are required", () => {
  assertEquals(createTeamMemberBody({ user_id: "u", given_name: "A" }, "L", "k").ok, false);
  assertEquals(createTeamMemberBody({ user_id: "u", family_name: "B" }, "L", "k").ok, false);
  assertEquals(createTeamMemberBody({ given_name: "A", family_name: "B" }, "L", "k").ok, false);
});
