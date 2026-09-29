import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { ADMIN_ACTIONS, createTeamMemberBody } from "./team.ts";

Deno.test("creating a Square team member is admin-only", () => {
  assert(ADMIN_ACTIONS.has("create_team_member"));
});

Deno.test("the existing write actions stay admin-only", () => {
  for (const a of ["force_close_shift", "upsert_scheduled_shift", "delete_scheduled_shift", "publish_week"]) {
    assert(ADMIN_ACTIONS.has(a), a);
  }
});

Deno.test("staff keep their own clock and the reads", () => {
  for (const a of ["list_team", "clock_in", "clock_out", "start_break", "end_break", "current_shift", "my_upcoming_shifts"]) {
    assert(!ADMIN_ACTIONS.has(a), a);
  }
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
