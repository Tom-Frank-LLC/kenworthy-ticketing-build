import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { CreditCard, DollarSign, Search, ShoppingCart } from 'lucide-react';
import { PaymentMethodSelector, type PaymentMethod } from './PaymentMethodSelector';
import { invokeFunction } from '@/lib/functions';

interface PassType {
  id: string;
  name: string;
  price: number;
  initial_balance: number;
  expiration_days: number | null;
}

export function FilmPassPOS() {
  const [passTypes, setPassTypes] = useState<PassType[]>([]);
  const [selectedTypeId, setSelectedTypeId] = useState('');
  const [patronEmail, setPatronEmail] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [selling, setSelling] = useState(false);

  // Lookup section
  const [lookupEmail, setLookupEmail] = useState('');
  const [foundPasses, setFoundPasses] = useState<any[]>([]);
  const [searching, setSearching] = useState(false);

  // Reused if the same sale is submitted twice, replaced after a failure.
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    supabase.from('film_pass_types').select('*').eq('is_active', true).order('price')
      .then(({ data }) => {
        setPassTypes(data || []);
        if (data && data.length > 0) setSelectedTypeId(data[0].id);
      });
  }, []);

  const selectedType = passTypes.find(t => t.id === selectedTypeId);

  /**
   * Take a card on the Square Terminal and wait for it to complete.
   *
   * Same sequencing as the ticket POS: the pass is not created until Square
   * says COMPLETED. Returns the Square payment id when there is one, which is
   * what makes the sale refundable later.
   */
  async function collectTerminalPayment(amountCents: number, note: string): Promise<string | null> {
    const created = await invokeFunction<{
      simulated?: boolean;
      checkout?: { id?: string; status?: string };
    }>('square-terminal', {
      action: 'create_checkout',
      amount_cents: amountCents,
      note,
      idempotency_key: crypto.randomUUID(),
    });

    if (created.simulated) return null;

    const checkoutId = created.checkout?.id;
    if (!checkoutId) throw new Error('The terminal did not start a payment.');

    for (let attempt = 0; attempt < 60; attempt++) {
      const status = await invokeFunction<{
        checkout?: { status?: string };
        payment_id?: string | null;
      }>('square-terminal', {
        action: 'get_checkout',
        checkout_id: checkoutId,
      });
      const state = status.checkout?.status;
      if (state === 'COMPLETED') return status.payment_id ?? null;
      if (state === 'CANCELED' || state === 'CANCEL_REQUESTED') {
        throw new Error('Payment was canceled on the terminal.');
      }
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    throw new Error('Payment timed out. Check the terminal.');
  }

  async function handleSell() {
    if (!selectedType) { toast.error('Select a pass type'); return; }
    if (!patronEmail.trim()) { toast.error('Enter patron email'); return; }

    setSelling(true);
    try {
      // Card first, then the pass — a pass that was never paid for must not
      // exist. Cash sales are attested by the staff member ringing them up.
      let squarePaymentId: string | null = null;
      if (paymentMethod === 'card') {
        squarePaymentId = await collectTerminalPayment(
          Math.round(selectedType.price * 100),
          `${selectedType.name} film pass`,
        );
      }

      // The pass is created for the *patron*, server-side. It used to be
      // created under the staff member's own account whenever the patron had no
      // profile, which handed the balance to the employee.
      const data = await invokeFunction<{ pass_name: string; balance: number }>('film-pass-checkout', {
        action: 'staff_sale',
        pass_type_id: selectedType.id,
        email: patronEmail.trim(),
        payment_method: paymentMethod,
        square_payment_id: squarePaymentId,
        idempotency_key: idempotencyKeyRef.current,
      });

      toast.success(`${data.pass_name} sold! Balance: $${Number(data.balance).toFixed(2)}`);
      idempotencyKeyRef.current = crypto.randomUUID();
      setPatronEmail('');
    } catch (err: any) {
      idempotencyKeyRef.current = crypto.randomUUID();
      toast.error(err.message || 'Failed to sell pass');
    } finally {
      setSelling(false);
    }
  }

  async function handleLookup() {
    if (!lookupEmail.trim()) return;
    setSearching(true);
    try {
      // Resolved server-side against auth.users. The old client-side version
      // searched profiles.display_name for an email address, which is not where
      // email is stored — so it found almost nobody.
      const term = lookupEmail.trim();
      const data = await invokeFunction<{
        patron: { user_id: string; display_name: string } | null;
        passes: {
          id: string;
          remaining_balance: number;
          expires_at: string | null;
          pass_type_name: string;
        }[];
      }>('film-pass-checkout', {
        action: 'lookup',
        email: term.includes('@') ? term : undefined,
        phone: term.includes('@') ? undefined : term,
      });

      const passes = (data.passes || []).map((p: any) => ({
        ...p,
        display_name: data.patron?.display_name || term,
      }));
      setFoundPasses(passes);

      if (passes.length === 0) toast.info('No active passes found');
    } catch (err: any) {
      setFoundPasses([]);
      toast.error(err.message || 'Lookup failed');
    } finally {
      setSearching(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 gap-6">
      {/* Sell New Pass */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <ShoppingCart className="h-5 w-5 text-primary" /> Sell Film Pass
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label>Pass Type</Label>
            <Select value={selectedTypeId} onValueChange={setSelectedTypeId}>
              <SelectTrigger>
                <SelectValue placeholder="Choose a pass..." />
              </SelectTrigger>
              <SelectContent>
                {passTypes.map(pt => (
                  <SelectItem key={pt.id} value={pt.id}>
                    {pt.name} — ${pt.price.toFixed(2)} (${pt.initial_balance.toFixed(2)} balance)
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Patron Email</Label>
            <Input
              type="email"
              placeholder="patron@email.com"
              value={patronEmail}
              onChange={e => setPatronEmail(e.target.value)}
            />
          </div>

          <PaymentMethodSelector paymentMethod={paymentMethod} onSelect={setPaymentMethod} />

          {selectedType && (
            <div className="p-4 rounded-lg bg-secondary/50 space-y-2">
              <div className="flex justify-between text-sm">
                <span>{selectedType.name}</span>
                <span className="font-bold">${selectedType.price.toFixed(2)}</span>
              </div>
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>Pass Balance</span>
                <span>${selectedType.initial_balance.toFixed(2)}</span>
              </div>
              {selectedType.expiration_days && (
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>Valid For</span>
                  <span>{selectedType.expiration_days} days</span>
                </div>
              )}
            </div>
          )}

          <Button className="w-full" size="lg" onClick={handleSell} disabled={selling || !selectedTypeId}>
            <CreditCard className="h-4 w-4 mr-1" />
            {selling ? 'Processing...' : `Sell Pass — $${selectedType?.price.toFixed(2) || '0.00'}`}
          </Button>
        </CardContent>
      </Card>

      {/* Lookup Passes */}
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <Search className="h-5 w-5 text-primary" /> Look Up Pass
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder="Search by email..."
              value={lookupEmail}
              onChange={e => setLookupEmail(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleLookup()}
            />
            <Button onClick={handleLookup} disabled={searching}>
              <Search className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-3">
            {foundPasses.map(pass => (
              <div key={pass.id} className="p-4 rounded-lg bg-secondary/50">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{pass.display_name}</p>
                    <p className="text-xs text-muted-foreground">{pass.pass_type_name}</p>
                  </div>
                  <Badge variant="default">
                    <DollarSign className="h-3 w-3 mr-0.5" />
                    ${Number(pass.remaining_balance).toFixed(2)}
                  </Badge>
                </div>
                {pass.expires_at && (
                  <p className="text-xs text-muted-foreground mt-1">
                    Expires {new Date(pass.expires_at).toLocaleDateString()}
                  </p>
                )}
              </div>
            ))}
            {foundPasses.length === 0 && lookupEmail && !searching && (
              <p className="text-sm text-muted-foreground text-center py-4">No active passes found</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
