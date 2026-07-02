import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { toast } from 'sonner';
import { CreditCard, DollarSign, Clock, ShoppingCart } from 'lucide-react';

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
  pass_type: PassType | null;
}

export default function MyPasses() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [passes, setPasses] = useState<UserPass[]>([]);
  const [passTypes, setPassTypes] = useState<PassType[]>([]);
  const [loading, setLoading] = useState(true);
  const [purchasing, setPurchasing] = useState(false);

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

    setPasses((passesRes.data || []).map((p: any) => ({
      ...p,
      pass_type: p.film_pass_types,
    })));
    setPassTypes(typesRes.data || []);
    setLoading(false);
  }

  async function handlePurchase(passType: PassType) {
    if (!user) return;
    setPurchasing(true);
    try {
      const expiresAt = passType.expiration_days
        ? new Date(Date.now() + passType.expiration_days * 86400000).toISOString()
        : null;

      const { error } = await supabase.from('user_film_passes').insert({
        user_id: user.id,
        pass_type_id: passType.id,
        remaining_balance: passType.initial_balance,
        payment_method: 'online',
        expires_at: expiresAt,
      });

      if (error) throw error;
      toast.success(`${passType.name} purchased! Balance: $${passType.initial_balance.toFixed(2)}`);
      loadData();
    } catch (err: any) {
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
                  <Button className="w-full" onClick={() => handlePurchase(pt)} disabled={purchasing}>
                    <ShoppingCart className="h-4 w-4 mr-1" />
                    {purchasing ? 'Processing...' : 'Purchase'}
                  </Button>
                  <p className="text-xs text-muted-foreground text-center mt-2">
                    Simulated checkout — no real charge
                  </p>
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
