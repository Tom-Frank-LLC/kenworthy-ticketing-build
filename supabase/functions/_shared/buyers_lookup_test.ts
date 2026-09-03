import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { findOrCreateBuyer, findUserIdByEmail } from './buyers.ts';

/**
 * The bug this file exists for, in the words the buyer saw:
 *
 *   Failed to create account: A user with this email address has already been
 *   registered
 *
 * `listUsers()` with no arguments returns the first page only — 50 users. Every
 * returning customer registered after that was invisible to the lookup, so
 * checkout tried to create an account they already had and Supabase refused.
 * It failed on the last step, after the card number had been typed.
 *
 * Reproduced on kenworthy.org 2026-09-03.
 */

/** A stub admin whose listUsers pages, and records how it was asked. */
function stubAdmin(opts: {
  emails: string[];
  profileHit?: string | null;
  createFails?: string;
}) {
  const calls: Array<Record<string, unknown> | undefined> = [];
  const created: Record<string, unknown>[] = [];
  return {
    calls,
    created,
    from() {
      return {
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: () =>
                Promise.resolve({ data: opts.profileHit ? { id: opts.profileHit } : null }),
            }),
          }),
        }),
        // findOrCreateBuyer updates profiles.phone after creating a user
        update: () => ({ eq: () => Promise.resolve({ error: null }) }),
      };
    },
    auth: {
      admin: {
        listUsers(args?: { page?: number; perPage?: number }) {
          calls.push(args);
          const perPage = args?.perPage ?? 50;
          const page = args?.page ?? 1;
          const slice = opts.emails.slice((page - 1) * perPage, page * perPage);
          return Promise.resolve({
            data: { users: slice.map((e, i) => ({ id: `id-${(page - 1) * perPage + i}`, email: e })) },
            error: null,
          });
        },
        createUser(payload: Record<string, unknown>) {
          created.push(payload);
          if (opts.createFails) {
            return Promise.resolve({ data: null, error: { message: opts.createFails } });
          }
          return Promise.resolve({ data: { user: { id: 'brand-new' } }, error: null });
        },
      },
    },
  };
}

/** 120 accounts — more than one page, which is the whole point. */
const MANY = Array.from({ length: 120 }, (_, i) => `person${i}@example.com`);

Deno.test('a user past the first page is found — the actual regression', async () => {
  // person99 sits at index 99. An unpaged listUsers() would never see them.
  const admin = stubAdmin({ emails: MANY, profileHit: null });
  const id = await findUserIdByEmail(admin, 'person99@example.com');
  assertEquals(id, 'id-99');
});

Deno.test('it asks for pages explicitly rather than taking the default', async () => {
  const admin = stubAdmin({ emails: MANY, profileHit: null });
  await findUserIdByEmail(admin, 'person99@example.com');
  // An unpaged call is the bug. Every call must name its page and size.
  for (const c of admin.calls) {
    assertEquals(typeof c?.page, 'number');
    assertEquals(typeof c?.perPage, 'number');
  }
});

Deno.test('it stops at a short page instead of running fifty round trips', async () => {
  const admin = stubAdmin({ emails: MANY, profileHit: null });
  await findUserIdByEmail(admin, 'nobody@example.com');
  // 120 accounts at 200 a page is one page, and it is short, so one call.
  assertEquals(admin.calls.length, 1);
});

Deno.test('the profiles index short-circuits the scan entirely', async () => {
  const admin = stubAdmin({ emails: MANY, profileHit: 'from-profiles' });
  const id = await findUserIdByEmail(admin, 'person99@example.com');
  assertEquals(id, 'from-profiles');
  assertEquals(admin.calls.length, 0); // never touched listUsers
});

Deno.test('email matching is case-insensitive and trims', async () => {
  const admin = stubAdmin({ emails: MANY, profileHit: null });
  assertEquals(await findUserIdByEmail(admin, '  PERSON7@Example.COM '), 'id-7');
});

Deno.test('a returning buyer is matched, not re-created', async () => {
  const admin = stubAdmin({ emails: MANY, profileHit: null });
  const out = await findOrCreateBuyer(admin, {
    name: 'Ada',
    email: 'person99@example.com',
    phone: null,
  });
  assertEquals(out, { userId: 'id-99', created: false });
  assertEquals(admin.created.length, 0); // no account was invented
});

Deno.test('"already registered" recovers by re-lookup instead of failing the sale', async () => {
  // Belt-and-braces: even if the lookup misses, the buyer must not eat the
  // error after typing a card number.
  const admin = stubAdmin({
    emails: MANY,
    profileHit: null,
    createFails: 'A user with this email address has already been registered',
  });
  // Force the miss, then let the recovery path find them.
  const original = admin.auth.admin.listUsers.bind(admin.auth.admin);
  let first = true;
  admin.auth.admin.listUsers = (args?: { page?: number; perPage?: number }) => {
    if (first) { first = false; return Promise.resolve({ data: { users: [] }, error: null }); }
    return original(args);
  };

  const out = await findOrCreateBuyer(admin, {
    name: 'Ada',
    email: 'person99@example.com',
    phone: null,
  });
  assertEquals(out, { userId: 'id-99', created: false });
});

Deno.test('a genuinely new buyer still gets an account', async () => {
  const admin = stubAdmin({ emails: MANY, profileHit: null });
  const out = await findOrCreateBuyer(admin, {
    name: 'New Person',
    email: 'nobody@example.com',
    phone: null,
  });
  assertEquals(out, { userId: 'brand-new', created: true });
  assertEquals(admin.created.length, 1);
});
