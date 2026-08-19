import { useEffect, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import {
  Check, CreditCard, Loader2, Mail, Minus, Plus, Store, Ticket,
} from 'lucide-react';
import { SquareCardForm, type SquareCardFormHandle } from '@/components/SquareCardForm';
import { SEO } from '@/components/SEO';
import { invokeFunction } from '@/lib/functions';
import { COLLECT_PHONE } from '@/lib/flags';

/**
 * Buying a film pass online.
 *
 * The thing this page must not do is give anyone the impression they now hold
 * something. A film pass is a physical card, and paying for one here buys a
 * *promise* of one — collected at the box office or posted out. So there is no
 * QR anywhere on this page or in the email that follows it, and the wording
 * after payment says where the pass will be rather than "here is your pass".
 *
 * No sign-in. Patrons do not log in, so this follows the guest-ticket pattern:
 * name and email, an account created silently behind the scenes so the order
 * has an owner, and nothing the buyer has to remember.
 */

interface PassType {
  id: string;
  name: string;
  price: number;
  initial_balance: number;
  redemption_price: number;
  expiration_days: number | null;
}

type Fulfillment = 'pickup' | 'mail';

interface Placed {
  passName: string;
  quantity: number;
  fulfillment: Fulfillment;
  total: number;
}

const MAX_QUANTITY = 10;

export default function FilmPasses() {
  const [passTypes, setPassTypes] = useState<PassType[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedId, setSelectedId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [fulfillment, setFulfillment] = useState<Fulfillment>('pickup');

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState({
    line1: '', line2: '', city: '', state: 'ID', postal_code: '',
  });

  const [errors, setErrors] = useState<Record<string, string>>({});
  const [cardReady, setCardReady] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [placed, setPlaced] = useState<Placed | null>(null);

  const cardRef = useRef<SquareCardFormHandle>(null);
  // One key per attempt, kept across a repeated submit so the server returns
  // the order it already made rather than charging twice; replaced after a
  // failure, or Square replays the old decline at a corrected card.
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  useEffect(() => {
    supabase
      .from('film_pass_types')
      .select('id, name, price, initial_balance, redemption_price, expiration_days')
      .eq('is_active', true)
      .order('price')
      .then(({ data }) => {
        const types = (data || []) as PassType[];
        setPassTypes(types);
        if (types.length > 0) setSelectedId(types[0].id);
        setLoading(false);
      });
  }, []);

  const selected = passTypes.find(p => p.id === selectedId) ?? null;
  const total = selected ? Math.round(Number(selected.price) * quantity * 100) / 100 : 0;
  const admissions = selected
    ? Math.floor(Number(selected.initial_balance) / Number(selected.redemption_price || 1))
    : 0;

  function validate(): boolean {
    const next: Record<string, string> = {};
    if (!selected) next.pass = 'Choose a pass';
    if (!name.trim()) next.name = 'Name is required';
    if (!email.trim()) next.email = 'Email is required so we can confirm your order';
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) next.email = 'Invalid email format';

    if (fulfillment === 'mail') {
      if (!address.line1.trim()) next.line1 = 'Street address is required';
      if (!address.city.trim()) next.city = 'City is required';
      if (!address.state.trim()) next.state = 'State is required';
      if (!/^\d{5}(-\d{4})?$/.test(address.postal_code.trim())) next.postal_code = 'Enter a 5-digit ZIP';
    }

    setErrors(next);
    return Object.keys(next).length === 0;
  }

  async function handleBuy() {
    if (!validate() || !selected) return;
    if (!cardRef.current) {
      setErrors({ card: 'The card form is not ready yet. Give it a moment, or reload the page.' });
      return;
    }

    setPurchasing(true);
    try {
      const sourceId = await cardRef.current.tokenize();

      // The server prices this from film_pass_types and records the order only
      // once Square has taken the money. Nothing here is trusted.
      await invokeFunction('film-pass-checkout', {
        action: 'order',
        pass_type_id: selected.id,
        quantity,
        fulfillment,
        mailing_address: fulfillment === 'mail'
          ? {
              line1: address.line1.trim(),
              line2: address.line2.trim() || null,
              city: address.city.trim(),
              state: address.state.trim(),
              postal_code: address.postal_code.trim(),
            }
          : undefined,
        source_id: sourceId,
        name: name.trim(),
        email: email.trim(),
        phone: COLLECT_PHONE ? (phone.trim() || undefined) : undefined,
        idempotency_key: idempotencyKeyRef.current,
      });

      setPlaced({
        passName: selected.name,
        quantity,
        fulfillment,
        total,
      });
      idempotencyKeyRef.current = crypto.randomUUID();
    } catch (err: any) {
      idempotencyKeyRef.current = crypto.randomUUID();
      toast.error(err.message || 'Could not complete your purchase');
    } finally {
      setPurchasing(false);
    }
  }

  const money = (n: number) => `$${n.toFixed(2)}`;

  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  // ---- After payment ------------------------------------------------------
  // Says where the pass will be, not "here is your pass". There is deliberately
  // nothing to screenshot: a buyer who thinks this screen is the pass turns up
  // at the door with a phone and no card.
  if (placed) {
    return (
      <div className="container py-12 px-4 max-w-xl">
        <SEO
          title="Film pass ordered — Kenworthy"
          description="Your Kenworthy film pass order is confirmed."
        />
        <Card className="glass">
          <CardContent className="p-8 text-center space-y-4">
            <Check className="h-14 w-14 mx-auto text-[hsl(var(--success))]" />
            <h1 className="font-display text-2xl font-bold">Thank you — your order is in</h1>
            <p className="text-muted-foreground">
              {placed.quantity} × {placed.passName} · {money(placed.total)}
            </p>
            <div className="p-4 rounded-lg bg-secondary/50 text-left space-y-2">
              <p className="font-medium flex items-center gap-2">
                {placed.fulfillment === 'pickup' ? (
                  <><Store className="h-4 w-4" /> Collect it at the box office</>
                ) : (
                  <><Mail className="h-4 w-4" /> On its way to you</>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {placed.fulfillment === 'pickup'
                  ? 'Ask for it by name when you next visit. We activate it and hand it over then.'
                  : 'We activate it before it goes in the envelope, so it is ready to use the moment it arrives.'}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              A film pass is a physical card — there is no QR code to print and nothing on this
              screen you need to keep. A confirmation is on its way to {email.trim()}.
            </p>
            <Button variant="outline" onClick={() => { setPlaced(null); setQuantity(1); }}>
              Buy another
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Nothing for sale ---------------------------------------------------
  if (passTypes.length === 0) {
    return (
      <div className="container py-16 px-4 max-w-xl text-center">
        <SEO
          title="Film Passes — Kenworthy"
          description="Prepaid film passes for the Kenworthy Performing Arts Centre in Moscow, Idaho."
        />
        <Ticket className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">Film Passes</h1>
        <p className="text-muted-foreground">
          No film passes are on sale right now. Ask at the box office next time you visit.
        </p>
      </div>
    );
  }

  return (
    <div className="container py-8 px-4 max-w-3xl">
      <SEO
        title="Film Passes — Kenworthy"
        description="Buy a prepaid film pass for the Kenworthy in Moscow, Idaho. Collect it at the box office or have it posted, then hand it over at the door."
      />

      <h1 className="font-display text-3xl font-bold mb-2">Film Passes</h1>
      <p className="text-muted-foreground mb-8">
        A film pass is a physical card you hand to our staff at the door. Buy one here and
        collect it at the box office, or have it posted to you.
      </p>

      <div className="grid lg:grid-cols-[1fr_20rem] gap-6 items-start">
        <div className="space-y-6">
          {/* Which pass */}
          <div className="space-y-3">
            <h2 className="font-display text-lg font-bold">Choose a pass</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {passTypes.map(pt => {
                const films = Math.floor(
                  Number(pt.initial_balance) / Number(pt.redemption_price || 1),
                );
                return (
                  <Card
                    key={pt.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedId(pt.id)}
                    onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') setSelectedId(pt.id); }}
                    className={`glass cursor-pointer transition-shadow ${
                      selectedId === pt.id ? 'ring-2 ring-primary' : 'hover:glow-primary'
                    }`}
                  >
                    <CardContent className="p-5">
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <h3 className="font-display text-lg font-bold">{pt.name}</h3>
                        <span className="text-xl font-bold text-primary">
                          {money(Number(pt.price))}
                        </span>
                      </div>
                      <p className="text-sm text-muted-foreground">
                        {money(Number(pt.initial_balance))} of credit — about {films} films at{' '}
                        {money(Number(pt.redemption_price))} each.
                      </p>
                      {pt.expiration_days && (
                        <Badge variant="secondary" className="mt-2 text-xs">
                          Valid {pt.expiration_days} days from activation
                        </Badge>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>
            {errors.pass && <p className="text-sm text-destructive">{errors.pass}</p>}
          </div>

          {/* How many */}
          <div className="space-y-2">
            <h2 className="font-display text-lg font-bold">How many</h2>
            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                size="icon"
                aria-label="One fewer"
                onClick={() => setQuantity(q => Math.max(1, q - 1))}
                disabled={quantity <= 1}
              >
                <Minus className="h-4 w-4" />
              </Button>
              <span className="text-xl font-bold w-8 text-center">{quantity}</span>
              <Button
                variant="outline"
                size="icon"
                aria-label="One more"
                onClick={() => setQuantity(q => Math.min(MAX_QUANTITY, q + 1))}
                disabled={quantity >= MAX_QUANTITY}
              >
                <Plus className="h-4 w-4" />
              </Button>
              <span className="text-sm text-muted-foreground">
                Up to {MAX_QUANTITY} — call the box office for more.
              </span>
            </div>
          </div>

          {/* How it reaches them */}
          <div className="space-y-3">
            <h2 className="font-display text-lg font-bold">How would you like it?</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              {([
                { key: 'pickup', icon: Store, title: 'Collect at the box office',
                  blurb: 'Ready when you next visit. We activate it as we hand it over.' },
                { key: 'mail', icon: Mail, title: 'Post it to me',
                  blurb: 'Activated before it goes in the envelope, so it works on arrival.' },
              ] as const).map(opt => {
                const Icon = opt.icon;
                return (
                  <Card
                    key={opt.key}
                    role="button"
                    tabIndex={0}
                    onClick={() => setFulfillment(opt.key)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' || e.key === ' ') setFulfillment(opt.key);
                    }}
                    className={`glass cursor-pointer transition-shadow ${
                      fulfillment === opt.key ? 'ring-2 ring-primary' : 'hover:glow-primary'
                    }`}
                  >
                    <CardContent className="p-4">
                      <p className="font-medium flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" /> {opt.title}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">{opt.blurb}</p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {fulfillment === 'mail' && (
              <div className="grid gap-3 sm:grid-cols-2 pt-1">
                <div className="sm:col-span-2">
                  <Label htmlFor="addr1" className="text-sm">Street address *</Label>
                  <Input
                    id="addr1"
                    value={address.line1}
                    onChange={e => setAddress(a => ({ ...a, line1: e.target.value }))}
                    maxLength={120}
                  />
                  {errors.line1 && <p className="text-sm text-destructive mt-1">{errors.line1}</p>}
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="addr2" className="text-sm">Apartment, suite (optional)</Label>
                  <Input
                    id="addr2"
                    value={address.line2}
                    onChange={e => setAddress(a => ({ ...a, line2: e.target.value }))}
                    maxLength={120}
                  />
                </div>
                <div>
                  <Label htmlFor="addr-city" className="text-sm">City *</Label>
                  <Input
                    id="addr-city"
                    value={address.city}
                    onChange={e => setAddress(a => ({ ...a, city: e.target.value }))}
                  />
                  {errors.city && <p className="text-sm text-destructive mt-1">{errors.city}</p>}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="addr-state" className="text-sm">State *</Label>
                    <Input
                      id="addr-state"
                      value={address.state}
                      onChange={e => setAddress(a => ({ ...a, state: e.target.value }))}
                      maxLength={2}
                    />
                    {errors.state && <p className="text-sm text-destructive mt-1">{errors.state}</p>}
                  </div>
                  <div>
                    <Label htmlFor="addr-zip" className="text-sm">ZIP *</Label>
                    <Input
                      id="addr-zip"
                      value={address.postal_code}
                      onChange={e => setAddress(a => ({ ...a, postal_code: e.target.value }))}
                      maxLength={10}
                    />
                    {errors.postal_code && (
                      <p className="text-sm text-destructive mt-1">{errors.postal_code}</p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Who they are */}
          <div className="space-y-3">
            <h2 className="font-display text-lg font-bold">Your details</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="pass-name" className="text-sm">Name *</Label>
                <Input
                  id="pass-name"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  maxLength={100}
                />
                {errors.name && <p className="text-sm text-destructive mt-1">{errors.name}</p>}
              </div>
              <div>
                <Label htmlFor="pass-email" className="text-sm">Email *</Label>
                <Input
                  id="pass-email"
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  maxLength={255}
                />
                {errors.email && <p className="text-sm text-destructive mt-1">{errors.email}</p>}
              </div>
              {/* Shown with COLLECT_PHONE (see @/lib/flags), but deliberately
                  without the SMS consent line ticket checkout carries. Pass
                  orders confirm by email only — film-pass-checkout calls
                  sendTransactionalEmail and never deliverConfirmation — so
                  promising a text here would be a promise nothing keeps. */}
              {COLLECT_PHONE && (
                <div className="sm:col-span-2">
                  <Label htmlFor="pass-phone" className="text-sm">Phone (optional)</Label>
                  <Input
                    id="pass-phone"
                    type="tel"
                    value={phone}
                    onChange={e => setPhone(e.target.value)}
                    maxLength={20}
                  />
                </div>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              We use your name to find your pass at the counter, and your email to confirm the
              order.{COLLECT_PHONE ? ' A phone number is optional, and only so we can reach you about this order.' : ''}
            </p>
          </div>
        </div>

        {/* Summary + payment */}
        <Card className="glass lg:sticky lg:top-20">
          <CardContent className="p-5 space-y-4">
            <h2 className="font-display text-lg font-bold">Order Summary</h2>

            {selected && (
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span>{selected.name} × {quantity}</span>
                  <span>{money(total)}</span>
                </div>
                <p className="text-sm text-muted-foreground">
                  Each carries {money(Number(selected.initial_balance))} — about {admissions}{' '}
                  films at {money(Number(selected.redemption_price))} each.
                </p>
                <div className="flex justify-between font-bold text-base pt-2 border-t border-border mt-2">
                  <span>Total</span>
                  <span className="text-primary">{money(total)}</span>
                </div>
              </div>
            )}

            <div className="border-t border-border pt-3">
              <p className="text-sm font-medium mb-3 flex items-center gap-1">
                <CreditCard className="h-4 w-4" /> Payment
              </p>
              <SquareCardForm
                ref={cardRef}
                source="film-pass-checkout"
                onReadyChange={setCardReady}
              />
              {errors.card && <p className="text-sm text-destructive mt-1">{errors.card}</p>}
            </div>

            <Button
              className="w-full"
              size="lg"
              onClick={handleBuy}
              disabled={purchasing || !cardReady || !selected}
            >
              {purchasing ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing…</>
              ) : (
                <><Check className="h-4 w-4 mr-1" /> Pay {money(total)}</>
              )}
            </Button>

            <p className="text-sm text-muted-foreground text-center">
              Payments are processed securely by Square. Your card details never reach our
              servers.
            </p>

            {/* The two rules people otherwise discover at the door. */}
            <div className="text-sm text-muted-foreground border-t border-border pt-3 space-y-1">
              <p>Passes are used in person — they cannot book tickets online.</p>
              <p>Valid on standard movies. Not on special events or premium screenings.</p>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
