import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { inviteTargetMatches } from './target.ts';

Deno.test('H1: an account whose auth address differs from the invite is refused', () => {
  // The attack: a buyer set profiles.email to the address an admin would invite.
  assertEquals(inviteTargetMatches('newmanager@kenworthy.org', { user: { email: 'attacker@example.com' } }, null), false);
});

Deno.test('the invited address, any case, is accepted', () => {
  assertEquals(inviteTargetMatches('newhire@kenworthy.org', { user: { email: 'NewHire@Kenworthy.org' } }, null), true);
});

Deno.test('no user, no email, or an auth error refuses', () => {
  assertEquals(inviteTargetMatches('a@b.org', null, null), false);
  assertEquals(inviteTargetMatches('a@b.org', { user: { email: null } }, null), false);
  assertEquals(inviteTargetMatches('a@b.org', { user: { email: 'a@b.org' } }, { message: 'x' }), false);
  assertEquals(inviteTargetMatches('', { user: { email: '' } }, null), false);
});
