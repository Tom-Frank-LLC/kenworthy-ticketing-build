// Retired: guest-checkout issued free tickets.
//
// This function created confirmed, scannable tickets for anyone who could POST
// to it — no card step, no charge, no Square code of any kind. It was reachable
// with only the public anon key, so it was not merely a checkout without
// payment; it was an open ticket printer.
//
// Its replacement is `ticket-checkout`, which prices the order server-side,
// charges Square, and only then creates the tickets. Both the guest and the
// signed-in checkout go through it.
//
// The endpoint is kept, and answers 410, rather than being deleted:
//   * A deployed function that is deleted from the repo keeps running in the
//     project until someone remembers to remove it. Redeploying this shim is
//     what actually closes the hole.
//   * A stale client that still calls it gets a clear answer instead of a
//     network error.

import { json, preflight } from '../_shared/http.ts';

// Deno globals
declare const Deno: any;

Deno.serve((req: Request) => {
  if (req.method === 'OPTIONS') return preflight();

  console.warn('[guest-checkout] rejected call to retired endpoint');

  return json(
    {
      error:
        'This checkout endpoint has been retired. Please reload the page and try again — ticket purchases now go through ticket-checkout, which takes payment.',
      moved_to: 'ticket-checkout',
    },
    410,
  );
});
