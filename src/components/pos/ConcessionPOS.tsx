import { useEffect, useState, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { UtensilsCrossed, Minus, Plus, ShoppingCart, Loader2, Banknote, CreditCard } from 'lucide-react';
import { PaymentMethodSelector, type PaymentMethod } from '@/components/pos/PaymentMethodSelector';
import { toast } from 'sonner';
import { formatShowtime } from '@/lib/datetime';

interface ConcessionItem {
  id: string;
  name: string;
  price: number;
  category: string;
}

interface CartLine {
  item: ConcessionItem;
  quantity: number;
}

interface ShowingOption {
  id: string;
  label: string;
}

interface ConcessionPOSProps {
  onSaleComplete?: () => void;
}

const TAX_RATE = 0.06;

export function ConcessionPOS({ onSaleComplete }: ConcessionPOSProps) {
  const [items, setItems] = useState<ConcessionItem[]>([]);
  const [showings, setShowings] = useState<ShowingOption[]>([]);
  const [selectedShowingId, setSelectedShowingId] = useState('');
  const [cart, setCart] = useState<Map<string, CartLine>>(new Map());
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>('cash');
  const [selling, setSelling] = useState(false);

  useEffect(() => {
    (async () => {
      const [itemsRes, showingsRes] = await Promise.all([
        supabase.from('concession_items').select('id, name, price, category').eq('is_active', true).order('category').order('name'),
        supabase.from('showings').select('id, start_time, movies(title), events(title), concerts(title)')
          .eq('is_active', true)
          .gte('start_time', new Date().toISOString())
          .order('start_time'),
      ]);
      setItems((itemsRes.data as ConcessionItem[]) || []);
      setShowings(
        (showingsRes.data || []).map((s: any) => ({
          id: s.id,
          label: `${s.movies?.title || s.events?.title || s.concerts?.title || 'Unknown'} — ${formatShowtime(s.start_time, 'MMM d, h:mm a')}`,
        }))
      );
    })();
  }, []);

  const addToCart = (item: ConcessionItem) => {
    setCart(prev => {
      const next = new Map(prev);
      const existing = next.get(item.id);
      if (existing) {
        next.set(item.id, { ...existing, quantity: existing.quantity + 1 });
      } else {
        next.set(item.id, { item, quantity: 1 });
      }
      return next;
    });
  };

  const updateQty = (itemId: string, delta: number) => {
    setCart(prev => {
      const next = new Map(prev);
      const line = next.get(itemId);
      if (!line) return prev;
      const newQty = line.quantity + delta;
      if (newQty <= 0) next.delete(itemId);
      else next.set(itemId, { ...line, quantity: newQty });
      return next;
    });
  };

  const cartLines = Array.from(cart.values());
  const subtotal = cartLines.reduce((s, l) => s + l.item.price * l.quantity, 0);
  const taxAmount = +(subtotal * TAX_RATE).toFixed(2);
  const total = +(subtotal + taxAmount).toFixed(2);

  const handleSell = useCallback(async () => {
    if (cartLines.length === 0) {
      toast.error('Add items to the cart first');
      return;
    }
    setSelling(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      // Create the sale
      const { data: sale, error: saleErr } = await supabase.from('concession_sales').insert({
        showing_id: selectedShowingId || null,
        staff_user_id: user.id,
        payment_method: paymentMethod,
        subtotal,
        tax_rate: TAX_RATE,
        tax_amount: taxAmount,
        total,
      }).select('id').single();

      if (saleErr) throw saleErr;

      // Insert line items
      const lineRows = cartLines.map(l => ({
        sale_id: sale.id,
        concession_item_id: l.item.id,
        quantity: l.quantity,
        unit_price: l.item.price,
        line_total: +(l.item.price * l.quantity).toFixed(2),
      }));

      const { error: lineErr } = await supabase.from('concession_sale_items').insert(lineRows);
      if (lineErr) throw lineErr;

      toast.success(`Concession sale — $${total.toFixed(2)} (${paymentMethod})`);
      setCart(new Map());
      setSelectedShowingId('');
      onSaleComplete?.();
    } catch (err: any) {
      toast.error(err.message || 'Failed to process sale');
    } finally {
      setSelling(false);
    }
  }, [cartLines, selectedShowingId, paymentMethod, subtotal, taxAmount, total, onSaleComplete]);

  const grouped = items.reduce<Record<string, ConcessionItem[]>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display text-lg flex items-center gap-2">
            <UtensilsCrossed className="h-5 w-5 text-primary" /> Concession Menu
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Optional showing association */}
          <div className="mb-4">
            <Select value={selectedShowingId} onValueChange={setSelectedShowingId}>
              <SelectTrigger>
                <SelectValue placeholder="Link to a showing (optional)" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">No showing</SelectItem>
                {showings.map(s => (
                  <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Menu items grid */}
          {Object.entries(grouped).map(([cat, catItems]) => (
            <div key={cat} className="mb-4">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">{cat}</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {catItems.map(item => (
                  <Button
                    key={item.id}
                    variant="outline"
                    className="h-auto py-3 flex flex-col items-center gap-1"
                    onClick={() => addToCart(item)}
                  >
                    <span className="text-sm font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">${Number(item.price).toFixed(2)}</span>
                  </Button>
                ))}
              </div>
            </div>
          ))}
          {items.length === 0 && (
            <p className="text-muted-foreground text-sm text-center py-4">No concession items configured. Add items in the admin dashboard.</p>
          )}
        </CardContent>
      </Card>

      {/* Cart */}
      {cartLines.length > 0 && (
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display text-lg flex items-center gap-2">
              <ShoppingCart className="h-5 w-5 text-primary" /> Cart
              <Badge variant="secondary" className="ml-auto">{cartLines.reduce((s, l) => s + l.quantity, 0)} items</Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {cartLines.map(line => (
              <div key={line.item.id} className="flex items-center justify-between">
                <span className="text-sm font-medium">{line.item.name}</span>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(line.item.id, -1)}>
                    <Minus className="h-3 w-3" />
                  </Button>
                  <span className="text-sm w-6 text-center">{line.quantity}</span>
                  <Button variant="outline" size="icon" className="h-7 w-7" onClick={() => updateQty(line.item.id, 1)}>
                    <Plus className="h-3 w-3" />
                  </Button>
                  <span className="text-sm w-16 text-right">${(line.item.price * line.quantity).toFixed(2)}</span>
                </div>
              </div>
            ))}

            <div className="border-t border-border pt-3 space-y-1 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Subtotal</span>
                <span>${subtotal.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Tax (6%)</span>
                <span>${taxAmount.toFixed(2)}</span>
              </div>
              <div className="flex justify-between font-bold text-base pt-1">
                <span>Total</span>
                <span className="text-primary">${total.toFixed(2)}</span>
              </div>
            </div>

            <PaymentMethodSelector paymentMethod={paymentMethod} onSelect={setPaymentMethod} />

            <Button className="w-full" size="lg" onClick={handleSell} disabled={selling}>
              {selling ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing...</>
              ) : (
                <>
                  {paymentMethod === 'cash' ? <Banknote className="h-4 w-4 mr-1" /> : <CreditCard className="h-4 w-4 mr-1" />}
                  Sell — ${total.toFixed(2)}
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
