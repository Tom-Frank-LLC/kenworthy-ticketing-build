import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { CreditCard, DollarSign, Clock, ShoppingCart, Loader2 } from 'lucide-react';
import { invokeFunction } from '@/lib/functions';
import { SquareCardForm, type SquareCardFormHandle } from '@/components/SquareCardForm';

interface PassType {
  id: string;
  name: string;
  price: number;
  initial_balance: number;
  expiration_days: number | null;
}

interface UserPass {
  id: string;
  remaining_balance: number;
  purchased_at: string;
  expires_at: string | null;
  status: string;
  pass_type: PassType | null;
}

export default function MyPasses() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [passes, setPasses] = useState<UserPass[]>([]);
  const [passTypes, setPassTypes] = useState<PassType[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

  // Buying a pass is now a two-step flow: choose the pass, then pay for it.
  // It used to be one click that inserted a funded pass row and charged nobody.
  const [buying, setBuying] = useState<PassType | null>(null);
  const [cardReady, setCardReady] = useState(false);
  const cardRef = useRef<SquareCardFormHandle>(null);
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/auth?redirect=' + encodeURIComponent(window.location.pathname + window.location.search)); return; }
    loadData();
  }, [user, authLoading, navigate]);

  async function loadData() {
    const [passesRes, typesRes] = await Promise.all([
      supabase
        .from('user_film_passes')
        .select('*, film_pass_types!user_film_passes_pass_type_id_fkey(*)')
        .eq('user_id', user!.id)
        .order('purchased_at', { ascending: false }),
      supabase.from('film_pass_types').select('*').eq('is_active', true).order('price'),
    ]);

    setPasses(
      (passesRes.data || [])
        // A pass row exists from the moment checkout starts; only the ones that
        // were actually paid for are the patron's.
        .filter((p: any) => p.status === 'active' || p.status === 'refunded')
        .map((p: any) => ({ ...p, pass_type: p.film_pass_types })),
    );
    setPassTypes(typesRes.data || []);
    setLoading(false);
  }

  async function handleConfirmPurchase() {
    if (!user || !buying || !cardRef.current) return;

    setPurchasing(true);
    try {
      const sourceId = await cardRef.current.tokenize();

      // The server prices the pass from film_pass_types and creates the balance
      // only once Square has taken the money.
      const data = await invokeFunction<{ pass_name: string; balance: number }>('film-pass-checkout', {
        action: 'purchase',
        pass_type_id: buying.id,
        source_id: sourceId,
        idempotency_key: idempotencyKeyRef.current,
      });

      toast.success(`${data.pass_name} purchased! Balance: $${Number(data.balance).toFixed(2)}`);
      setBuying(null);
      idempotencyKeyRef.current = crypto.randomUUID();
      loadData();
    } catch (err: any) {
      // A declined attempt must not reuse its key, or Square replays the
      // decline instead of trying the corrected card.
      idempotencyKeyRef.current = crypto.randomUUID();
      toast.error(err.message || 'Failed to purchase pass');
    } finally {
      setPurchasing(false);
    }
  }

  if (loading || authLoading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  const isExpired = (pass: UserPass) =>
    pass.expires_at ? new Date(pass.expires_at) < new Date() : false;

  return (
    <div className="container py-8 px-4 max-w-3xl">
      <h1 className="font-display text-3xl font-bold mb-2">My Film Passes</h1>
      <p className="text-muted-foreground mb-8">Manage your prepaid passes and purchase new ones</p>

      {/* Available Passes for purchase */}
      {passTypes.length > 0 && (
        <div className="mb-8">
          <h2 className="font-display text-xl font-bold mb-4">Available Passes</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {passTypes.map(pt => (
              <Card key={pt.id} className="glass hover:glow-primary transition-shadow">
                <CardContent className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <h3 className="font-display text-lg font-bold">{pt.name}</h3>
                      <p className="text-sm text-muted-foreground">
                        ${pt.initial_balance.toFixed(2)} balance
                        {pt.expiration_days && ` • Valid for ${pt.expiration_days} days`}
                      </p>
                    </div>
                    <span className="text-xl font-bold text-primary">${pt.price.toFixed(2)}</span>
                  </div>
                  {buying?.id === pt.id ? (
                    <div className="space-y-3">
                      <SquareCardForm source="film-pass-checkout" onReadyChange={setCardReady} />
                      <div className="flex gap-2">
                        <Button
                          className="flex-1"
                          onClick={handleConfirmPurchase}
                          disabled={purchasing || !cardReady}
                        >
                          {purchasing ? (
                            <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing…</>
                          ) : (
                            <><CreditCard className="h-4 w-4 mr-1" /> Pay ${pt.price.toFixed(2)}</>
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          onClick={() => setBuying(null)}
                          disabled={purchasing}
                        >
                          Cancel
                        </Button>
                      </div>
                      <p className="text-xs text-muted-foreground text-center">
                        Payments are processed securely by Square.
                      </p>
                    </div>
                  ) : (
                    <Button
                      className="w-full"
                      onClick={() => { setCardReady(false); setBuying(pt); }}
                      disabled={purchasing}
                    >
                      <ShoppingCart className="h-4 w-4 mr-1" />
                      Purchase
                    </Button>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      {/* My Passes */}
      <h2 className="font-display text-xl font-bold mb-4">Your Passes</h2>
      {passes.length === 0 ? (
        <Card className="glass p-12 text-center">
          <CreditCard className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground text-lg mb-4">No film passes yet</p>
          {passTypes.length === 0 && (
            <p className="text-sm text-muted-foreground">No passes are currently available for purchase.</p>
          )}
        </Card>
      ) : (
        <div className="space-y-4">
          {passes.map((pass, i) => {
            const expired = isExpired(pass);
            const depleted = pass.remaining_balance <= 0;
            return (
              <Card
                key={pass.id}
                className={`glass opacity-0 animate-fade-in ${expired || depleted ? 'opacity-60' : ''}`}
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div className="space-y-1">
                      <h3 className="font-display text-lg font-bold">{pass.pass_type?.name || 'Film Pass'}</h3>
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={depleted ? 'secondary' : 'default'}>
                          <DollarSign className="h-3 w-3 mr-0.5" />
                          ${Number(pass.remaining_balance).toFixed(2)} remaining
                        </Badge>
                        {expired && <Badge variant="destructive">Expired</Badge>}
                        {depleted && !expired && <Badge variant="secondary">Depleted</Badge>}
                        {!expired && !depleted && <Badge variant="outline">Active</Badge>}
                      </div>
                      <div className="flex gap-3 text-xs text-muted-foreground mt-1">
                        <span className="flex items-center gap-1">
                          <Clock className="h-3 w-3" /> Purchased {new Date(pass.purchased_at).toLocaleDateString()}
                        </span>
                        {pass.expires_at && (
                          <span>Expires {new Date(pass.expires_at).toLocaleDateString()}</span>
                        )}
                      </div>
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
