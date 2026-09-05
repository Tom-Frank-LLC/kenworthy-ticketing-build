import { useRef, useState, type ReactNode } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Check, CreditCard, Loader2, Mail, Minus, Plus, Store } from 'lucide-react';
import { SquareCardForm, type SquareCardFormHandle } from '@/components/SquareCardForm';
import { RichText } from '@/components/RichText';
import { invokeFunction } from '@/lib/functions';
import { COLLECT_PHONE } from '@/lib/flags';
import {
  MAX_PASS_QUANTITY,
  money,
  passOrderTotals,
  passWorthClause,
  type PassType,
} from '@/lib/filmPass';

/**
 * Buying one film pass: quantity, how it reaches them, who they are, and the
 * card.
 *
 * This is the money path, and it exists once. /film-passes used to carry a
 * chooser and this form together, so a buyer arriving from a "buy this pass"
 * link landed on a page listing every other pass as well. Splitting that into a
 * gallery and a per-pass page is what created the second place a pass could be
 * bought from — and forking the form to fill it would have left two copies of
 * the tax arithmetic, the idempotency handling and the Square call to keep in
 * agreement. So the pass is a prop, the surrounding page supplies its own
 * presentation through `children`, and there is still only one of these.
 *
 * No sign-in. Patrons do not log in, so this follows the guest-ticket pattern:
 * name and email, an account created silently behind the scenes so the order
 * has an owner, and nothing the buyer has to remember.
 */

type Fulfillment = 'pickup' | 'mail';

export interface Placed {
  passName: string;
  quantity: number;
  fulfillment: Fulfillment;
  total: number;
  /** Where the confirmation went, so the page after can name it. */
  email: string;
}

interface FilmPassPurchaseProps {
  pass: PassType;
  /**
   * Handed the order once Square has taken the money. The page owns what
   * happens next, because the confirmation replaces the whole page rather than
   * sitting beside a payment form the buyer has already used.
   */
  onPlaced: (placed: Placed) => void;
  /** The pass's own presentation, above the controls in the left column. */
  children?: ReactNode;
}

export function FilmPassPurchase({ pass, onPlaced, children }: FilmPassPurchaseProps) {
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

  const cardRef = useRef<SquareCardFormHandle>(null);
  // One key per attempt, kept across a repeated submit so the server returns
  // the order it already made rather than charging twice; replaced after a
  // failure, or Square replays the old decline at a corrected card.
  const idempotencyKeyRef = useRef(crypto.randomUUID());

  const { subtotal, taxDue, total } = passOrderTotals(pass, quantity);

  function validate(): boolean {
    const next: Record<string, string> = {};
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
    if (!validate()) return;
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
        pass_type_id: pass.id,
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

      onPlaced({
        passName: pass.name,
        quantity,
        fulfillment,
        total,
        email: email.trim(),
      });
      idempotencyKeyRef.current = crypto.randomUUID();
    } catch (err: any) {
      idempotencyKeyRef.current = crypto.randomUUID();
      toast.error(err.message || 'Could not complete your purchase');
    } finally {
      setPurchasing(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-[1fr_20rem] gap-6 items-start">
      <div className="space-y-6">
        {children}

        {/* How many */}
        <div className="space-y-2">
          <h2 className="font-display text-lg font-bold">How many</h2>
          <div className="flex items-center gap-3">
            <Button
              variant="outline"
              size="icon"
              aria-label="One less"
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
              onClick={() => setQuantity(q => Math.min(MAX_PASS_QUANTITY, q + 1))}
              disabled={quantity >= MAX_PASS_QUANTITY}
            >
              <Plus className="h-4 w-4" />
            </Button>
            <span className="text-sm text-muted-foreground">
              Up to {MAX_PASS_QUANTITY} — call the box office for more.
            </span>
          </div>
        </div>

        {/* How it reaches them */}
        <div className="space-y-3">
          {/* A fieldset around real radio inputs, not a row of role="button"
              cards. The cards were reachable by Tab, but nothing told anyone
              which delivery method was chosen — no aria-pressed, no
              aria-checked — and ui/card.tsx has no focus style, so the focus
              ring was invisible too. A single-select group is a radio group;
              saying so gets the state, the arrow keys and the grouping for
              free. The input is sr-only and the card looks exactly as it did. */}
          <fieldset>
            <legend className="mb-3">
              <h2 className="font-display text-lg font-bold">How would you like it?</h2>
            </legend>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              { key: 'pickup', icon: Store, title: 'Collect at the box office',
                blurb: 'Ready when you next visit. We activate it as we hand it over.' },
              { key: 'mail', icon: Mail, title: 'Ship it to me',
                blurb: 'Activated before it goes in the envelope, so it works on arrival.' },
            ] as const).map(opt => {
              const Icon = opt.icon;
              return (
                <label key={opt.key} className="block cursor-pointer">
                  <input
                    type="radio"
                    name="film-pass-fulfillment"
                    className="peer sr-only"
                    checked={fulfillment === opt.key}
                    onChange={() => setFulfillment(opt.key)}
                  />
                  <Card
                    className={`glass h-full transition-shadow peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background ${
                      fulfillment === opt.key ? 'ring-2 ring-primary' : 'hover:glow-primary'
                    }`}
                  >
                    <CardContent className="p-4">
                      <p className="font-medium flex items-center gap-2">
                        <Icon className="h-4 w-4 text-primary" aria-hidden /> {opt.title}
                      </p>
                      <p className="text-sm text-muted-foreground mt-1">{opt.blurb}</p>
                    </CardContent>
                  </Card>
                </label>
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
          </fieldset>
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

          <div className="space-y-1 text-sm">
            <div className="flex justify-between">
              <span>{pass.name} × {quantity}</span>
              <span>{money(subtotal)}</span>
            </div>
            <div className="flex justify-between text-muted-foreground">
              <span>Idaho sales tax (6%)</span>
              <span>{money(taxDue)}</span>
            </div>
            <p className="text-sm text-muted-foreground">Each is {passWorthClause(pass)}</p>
            <div className="flex justify-between font-bold text-base pt-2 border-t border-border mt-2">
              <span>Total</span>
              <span className="text-primary">{money(total)}</span>
            </div>
          </div>

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
            disabled={purchasing || !cardReady}
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

          {/* The rules people otherwise discover at the door.
              The first is true of every pass, so it is written here. The second
              is a claim about one product — the standard pass is not valid at
              special events, the festival pass is valid at nothing else — so it
              comes from the pass being bought, and a pass with nothing to say
              prints nothing rather than inheriting another pass's wording. */}
          <div className="text-sm text-muted-foreground border-t border-border pt-3 space-y-1">
            <p>Passes are redeemed in person — they cannot book tickets online.</p>
            <RichText html={pass.fine_print} />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default FilmPassPurchase;
