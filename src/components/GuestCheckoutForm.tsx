import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Check, User, Mail, Phone, CreditCard, Loader2 } from 'lucide-react';
import { SquareCardForm, type SquareCardFormHandle } from '@/components/SquareCardForm';

interface GuestCheckoutFormProps {
  ticketCount: number;
  total: number;
  purchasing: boolean;
  /** Receives the buyer's details plus a single-use Square card token. */
  onPurchase: (
    guestInfo: { name: string; email: string; phone: string },
    sourceId: string,
  ) => void;
}

/**
 * Guest checkout — now with the card step it never had.
 *
 * This form used to collect a name and an email and hand back a free ticket:
 * there was no card field anywhere on it, and the note under the button said
 * "Simulated checkout — no real charge", which was accurate. The card input
 * below is Square's own iframe; tokenising is the only thing that leaves it,
 * and the price is recomputed server-side regardless of what this component
 * displays.
 */
export function GuestCheckoutForm({ ticketCount, total, purchasing, onPurchase }: GuestCheckoutFormProps) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tokenizing, setTokenizing] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const cardRef = useRef<SquareCardFormHandle>(null);

  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (!email.trim() && !phone.trim()) newErrors.contact = 'Email or phone is required';
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = 'Invalid email format';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = async () => {
    if (!validate()) return;
    if (!cardRef.current) {
      // Never fail silently here. This guard was a bare `return`, and when the
      // card form's ref was left unwired the button did nothing at all — no
      // error, no spinner, no clue.
      setErrors({ card: 'The card form is not ready yet. Give it a moment, or reload the page.' });
      return;
    }

    setTokenizing(true);
    try {
      const sourceId = await cardRef.current.tokenize();
      onPurchase({ name: name.trim(), email: email.trim(), phone: phone.trim() }, sourceId);
    } catch (err) {
      setErrors({ card: err instanceof Error ? err.message : 'Please check your card details.' });
    } finally {
      setTokenizing(false);
    }
  };

  const busy = purchasing || tokenizing;

  return (
    <div className="space-y-3">
      <div className="border-t border-border pt-3">
        <p className="text-sm font-medium mb-3 flex items-center gap-1">
          <User className="h-4 w-4" /> Your Info
        </p>
        <div className="space-y-2">
          <div>
            <Label htmlFor="guest-name" className="text-xs">Name *</Label>
            <Input
              id="guest-name"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
            />
            {errors.name && <p className="text-xs text-destructive mt-1">{errors.name}</p>}
          </div>
          <div>
            <Label htmlFor="guest-email" className="text-xs flex items-center gap-1">
              <Mail className="h-3 w-3" /> Email
            </Label>
            <Input
              id="guest-email"
              type="email"
              placeholder="you@example.com"
              value={email}
              onChange={e => setEmail(e.target.value)}
              maxLength={255}
            />
            {errors.email && <p className="text-xs text-destructive mt-1">{errors.email}</p>}
          </div>
          <div>
            <Label htmlFor="guest-phone" className="text-xs flex items-center gap-1">
              <Phone className="h-3 w-3" /> Phone
            </Label>
            <Input
              id="guest-phone"
              type="tel"
              placeholder="(208) 555-1234"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              maxLength={20}
            />
          </div>
          {errors.contact && <p className="text-xs text-destructive mt-1">{errors.contact}</p>}
          <p className="text-xs text-muted-foreground">
            Provide email or phone so we can send your tickets. If you already have an account, the tickets will be added to it.
          </p>
        </div>
      </div>

      <div className="border-t border-border pt-3">
        <p className="text-sm font-medium mb-3 flex items-center gap-1">
          <CreditCard className="h-4 w-4" /> Payment
        </p>
        <SquareCardForm ref={cardRef} source="ticket-checkout" onReadyChange={setCardReady} />
        {errors.card && <p className="text-xs text-destructive mt-1">{errors.card}</p>}
      </div>

      <Button
        className="w-full"
        size="lg"
        onClick={handleSubmit}
        disabled={busy || !cardReady}
      >
        {busy ? (
          <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing…</>
        ) : (
          <><Check className="h-4 w-4 mr-1" /> Pay ${total.toFixed(2)} — {ticketCount} Ticket(s)</>
        )}
      </Button>
      <p className="text-xs text-muted-foreground text-center">
        Payments are processed securely by Square. Your card details never reach our servers.
      </p>
    </div>
  );
}
