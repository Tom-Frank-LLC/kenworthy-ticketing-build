/**
 * PosTodayStats — the three things the counter needs at a glance.
 *
 * Pass eligibility, tonight's house, and the day's refunds. Revenue is
 * deliberately not here: it moved to the admin dashboard, because running a
 * till and reviewing the theatre's takings are different jobs.
 *
 * ## Eligibility is the existence of a row, and nothing else
 *
 * `redeem_film_pass` decides admission with exactly one test — is there a
 * `pass_type_showings` row pairing this pass's type with this screening. Its
 * own comment is worth repeating, because two plausible shortcuts are both
 * wrong:
 *
 *   "No category test, because the category stopped meaning anything the
 *    moment a festival pass could cover a live performance; and no default,
 *    because 'nobody tagged it' has to mean no rather than yes or a screening
 *    becomes redeemable by inattention."
 *
 * So `film_pass_types.is_default_for_movies` is **not** consulted here. It
 * looks like it ought to be — it is a tempting column with an authoritative
 * name — but the door does not read it, and a card that said "accepted" where
 * the scanner says "not eligible" would send staff to argue with a patron
 * holding a pass. This card asks the same question the scanner asks.
 *
 * ## Reading it is public, so this needs no privileges
 *
 * `pass_type_showings` grants SELECT to anon under a `USING (true)` policy —
 * the pairing is the answer to "does my pass work on Friday", which the public
 * site answers without anyone signing in. It exposes no balance and no patron.
 */

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Ticket, ShoppingCart, RotateCcw } from 'lucide-react';
import { venueDayBounds } from '@/lib/datetime';

interface Stats {
  showingCount: number;
  /** Showings today that at least one pass type is tagged against. */
  eligibleShowings: number;
  /** Distinct pass names accepted somewhere today. */
  passNames: string[];
  todaysTicketCount: number;
  refundCount: number;
}

const EMPTY: Stats = {
  showingCount: 0,
  eligibleShowings: 0,
  passNames: [],
  todaysTicketCount: 0,
  refundCount: 0,
};

export function PosTodayStats() {
  const [s, setStats] = useState<Stats>(EMPTY);

  // Recomputed per load rather than captured at mount: the POS stays open
  // across a whole shift, and a `today` fixed at render would still say
  // yesterday after midnight on a late event night.
  const load = useCallback(async () => {
    const { start, end } = venueDayBounds(new Date());
    const from = start.toISOString();
    const to = end.toISOString();

    const [showingsRes, refundsRes] = await Promise.all([
      supabase.from('showings').select('id').eq('is_active', true)
        .gte('start_time', from).lt('start_time', to),
      supabase.from('tickets').select('id').eq('status', 'refunded')
        .gte('purchased_at', from).lt('purchased_at', to),
    ]);

    const showingIds = (showingsRes.data ?? []).map(r => r.id);
    const next: Stats = { ...EMPTY, showingCount: showingIds.length,
      refundCount: refundsRes.data?.length ?? 0 };

    if (showingIds.length > 0) {
      const [ticketsRes, tagsRes] = await Promise.all([
        supabase.from('tickets').select('id').in('showing_id', showingIds).eq('status', 'confirmed'),
        supabase.from('pass_type_showings')
          .select('showing_id, film_pass_types(name)')
          .in('showing_id', showingIds),
      ]);
      next.todaysTicketCount = ticketsRes.data?.length ?? 0;

      const tagged = new Set<string>();
      const names = new Set<string>();
      for (const row of (tagsRes.data ?? []) as any[]) {
        tagged.add(row.showing_id);
        const name = row.film_pass_types?.name;
        if (name) names.add(name);
      }
      next.eligibleShowings = tagged.size;
      // Sorted so the card does not reshuffle its own text between refreshes.
      next.passNames = [...names].sort();
    }

    setStats(next);
  }, []);

  useEffect(() => { load(); }, [load]);

  const { showingCount, eligibleShowings, passNames, todaysTicketCount, refundCount } = s;

  // What the first card says, in the counter's terms. The distinction that
  // matters to a staff member holding a pass is accepted / not accepted; the
  // pass *names* are the follow-up, because "which one" is the actual question
  // when more than one pass exists.
  let passHeadline: string;
  let passDetail: string;
  if (showingCount === 0) {
    passHeadline = '—';
    passDetail = 'Nothing scheduled today';
  } else if (eligibleShowings === 0) {
    // Said plainly. "Nobody tagged it" and "passes are refused" are the same
    // thing at the door, so the card must not hedge into looking uncertain.
    passHeadline = 'No';
    passDetail = 'No pass is accepted today';
  } else {
    passHeadline = 'Yes';
    passDetail =
      showingCount > 1 && eligibleShowings < showingCount
        ? `${passNames.join(', ')} — ${eligibleShowings} of ${showingCount} showings`
        : passNames.join(', ');
  }

  return (
    <div className="grid grid-cols-1 gap-4 mb-8 sm:grid-cols-3">
      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2.5">
            <Ticket className="h-5 w-5 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Film Pass Eligible</p>
            <p className="text-xl font-bold">{passHeadline}</p>
            <p className="mt-1 text-xs text-muted-foreground break-words">{passDetail}</p>
          </div>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-start gap-3">
          <div className="rounded-full bg-primary/10 p-2.5">
            <ShoppingCart className="h-5 w-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Tickets for Today</p>
            <p className="text-xl font-bold">{todaysTicketCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">Sold for today’s showings</p>
          </div>
        </CardContent>
      </Card>

      <Card className="glass">
        <CardContent className="pt-5 pb-4 flex items-start gap-3">
          <div className="rounded-full bg-destructive/10 p-2.5">
            <RotateCcw className="h-5 w-5 text-destructive" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Refunds</p>
            <p className="text-xl font-bold">{refundCount}</p>
            <p className="mt-1 text-xs text-muted-foreground">Refunded today</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
