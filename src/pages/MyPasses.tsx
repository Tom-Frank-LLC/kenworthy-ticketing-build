import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreditCard, DollarSign, Clock, Ticket } from 'lucide-react';
import { formatShowtime } from '@/lib/datetime';

/**
 * What a signed-in patron holds — and nothing more.
 *
 * This page used to sell passes and redeem them against tickets. Both are gone:
 * a pass is a physical card now, bought at /film-passes or the box office, and
 * spent by handing it to staff at the door. There is no button here because
 * there is nothing a patron can do to a pass from a browser.
 *
 * It stays as a record. Somebody who wants to know what is left on their card
 * without asking at the counter can see it, and a bearer pass — one bought with
 * cash and no contact details — correctly appears nowhere, because it belongs
 * to whoever is holding the paper.
 */

interface UserPass {
  id: string;
  qr_code: string | null;
  status: string;
  remaining_balance: number | null;
  purchased_at: string;
  activated_at: string | null;
  expires_at: string | null;
  pass_type: {
    name: string;
    redemption_price: number;
  } | null;
}

const STATUS_LABEL: Record<string, string> = {
  active: 'Active',
  depleted: 'Used up',
  expired: 'Expired',
  void: 'Cancelled',
  refunded: 'Refunded',
};

export default function MyPasses() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [passes, setPasses] = useState<UserPass[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) {
      navigate('/auth?redirect=' + encodeURIComponent(window.location.pathname + window.location.search));
      return;
    }

    supabase
      .from('user_film_passes')
      .select('*, film_pass_types!user_film_passes_pass_type_id_fkey(name, redemption_price)')
      .eq('user_id', user.id)
      // A blank sticker or a failed charge is not a pass anyone holds.
      .in('status', ['active', 'depleted', 'expired', 'void', 'refunded'])
      .order('activated_at', { ascending: false, nullsFirst: false })
      .then(({ data }) => {
        setPasses(
          (data || []).map((p: any) => ({ ...p, pass_type: p.film_pass_types })),
        );
        setLoading(false);
      });
  }, [user, authLoading, navigate]);

  if (loading || authLoading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="container py-8 px-4 max-w-3xl">
      <h1 className="font-display text-3xl font-bold mb-2">My Film Passes</h1>
      <p className="text-muted-foreground mb-8">
        Film passes are physical cards. Hand yours to our staff at the door and they will scan it —
        there is nothing to show on a phone.
      </p>

      {passes.length === 0 ? (
        <Card className="glass p-12 text-center">
          <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground text-lg mb-2">No film passes on this account</p>
          <p className="text-sm text-muted-foreground mb-6">
            A pass bought with cash and no contact details belongs to whoever holds the card, so it
            will not appear here.
          </p>
          <Button asChild>
            <Link to="/film-passes">
              <Ticket className="h-4 w-4 mr-1" /> Buy a film pass
            </Link>
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {passes.map((pass, i) => {
            const balance = pass.remaining_balance === null ? null : Number(pass.remaining_balance);
            const cost = Number(pass.pass_type?.redemption_price ?? 0);
            const filmsLeft = balance !== null && cost > 0 ? Math.floor(balance / cost) : null;
            const spendable = pass.status === 'active';

            return (
              <Card
                key={pass.id}
                className={`glass opacity-0 animate-fade-in ${spendable ? '' : 'opacity-60'}`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <CardContent className="p-5">
                  <div className="space-y-1">
                    <h3 className="font-display text-lg font-bold">
                      {pass.pass_type?.name || 'Film Pass'}
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {balance !== null && (
                        <Badge variant={spendable ? 'default' : 'secondary'}>
                          <DollarSign className="h-3 w-3 mr-0.5" />
                          {balance.toFixed(2)} remaining
                        </Badge>
                      )}
                      {spendable && filmsLeft !== null && (
                        <Badge variant="outline">
                          {filmsLeft} {filmsLeft === 1 ? 'film' : 'films'} left
                        </Badge>
                      )}
                      {!spendable && (
                        <Badge variant={pass.status === 'depleted' ? 'secondary' : 'destructive'}>
                          {STATUS_LABEL[pass.status] ?? pass.status}
                        </Badge>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground pt-1">
                      {pass.activated_at && (
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" />
                          Activated {formatShowtime(pass.activated_at, 'MMM d, yyyy')}
                        </span>
                      )}
                      {pass.expires_at && (
                        <span>Expires {formatShowtime(pass.expires_at, 'MMM d, yyyy')}</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
