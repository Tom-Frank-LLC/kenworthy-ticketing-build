import { useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Check, User, Mail, Phone, CreditCard, Loader2 } from 'lucide-react';
import { Checkbox } from '@/components/ui/checkbox';
import { SquareCardForm, type SquareCardFormHandle } from '@/components/SquareCardForm';
import { COLLECT_PHONE, SMS_DELIVERY_LIVE } from '@/lib/flags';

interface GuestCheckoutFormProps {
  ticketCount: number;
  total: number;
  purchasing: boolean;
  /**
   * Receives the buyer's details plus a single-use Square card token.
   *
   * `newsletter` is the buyer's own answer, not an inference. It used to be
   * unnecessary here: marketing tagging rode on the signed-in buyer's profile,
   * so a guest simply was not tagged. With no patron accounts left, every buyer
   * is a guest, and the only honest way to know whether someone wants email is
   * to ask on this form.
   */
  onPurchase: (
    guestInfo: { name: string; email: string; phone: string; newsletter: boolean },
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
  const [newsletter, setNewsletter] = useState(true);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [tokenizing, setTokenizing] = useState(false);
  const [cardReady, setCardReady] = useState(false);
  const cardRef = useRef<SquareCardFormHandle>(null);

  // The contact rule follows the channels that can actually deliver, which is
  // SMS_DELIVERY_LIVE and deliberately not COLLECT_PHONE. Showing the field is
  // one question; whether a number alone is enough to reach someone is another,
  // and right now the answer is no — the A2P campaign is unregistered, so every
  // text is rejected by the carrier. So the number is collected and email stays
  // mandatory. Both branches stay written down so flipping the flag never means
  // reconstructing the other rule from memory.
  const validate = () => {
    const newErrors: Record<string, string> = {};
    if (!name.trim()) newErrors.name = 'Name is required';
    if (SMS_DELIVERY_LIVE) {
      if (!email.trim() && !phone.trim()) newErrors.contact = 'Email or phone is required';
    } else if (!email.trim()) {
      newErrors.email = 'Email is required so we can send your tickets';
    }
    if (email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      newErrors.email = 'Invalid email format';
    }
    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const isFree = total <= 0;
  // Sent explicitly rather than by accident: the server contract carries the
  // key either way, and with the field hidden this is deliberately ''. Passed
  // through as typed — `toE164` in _shared/notify.ts is what normalises it for
  // Twilio, and pre-mangling it here would only give that one less to work with.
  const contactPhone = COLLECT_PHONE ? phone.trim() : '';

  const handleSubmit = async () => {
    if (!validate()) return;
    // Free ($0) showing — no card step. The server skips Square for $0 orders,
    // so there is no token to collect; hand back an empty source.
    if (isFree) {
      onPurchase({ name: name.trim(), email: email.trim(), phone: contactPhone, newsletter }, '');
      return;
    }
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
      onPurchase({ name: name.trim(), email: email.trim(), phone: contactPhone, newsletter }, sourceId);
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
              <Mail className="h-3 w-3" /> Email{SMS_DELIVERY_LIVE ? '' : ' *'}
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
          {/* The consent line below is not decoration: it is the disclosure an
              A2P 10DLC campaign is reviewed on, which is why the field can be
              live before the texts are. It stays attached to the input rather
              than living in the footer, and it says only what is true today —
              until SMS_DELIVERY_LIVE flips, email is what carries the tickets.
              STOP is handled by the Twilio Messaging Service, not by us. */}
          {COLLECT_PHONE && (
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
              <p className="text-xs text-muted-foreground mt-1">
                {SMS_DELIVERY_LIVE
                  ? 'We\u2019ll text your tickets and updates about this order to this number.'
                  : 'We\u2019ll text updates about this order to this number once text delivery is live \u2014 your tickets come by email either way.'}{' '}
                Message and data rates may apply. Reply STOP to opt out.
              </p>
            </div>
          )}
          {errors.contact && <p className="text-xs text-destructive mt-1">{errors.contact}</p>}
          <p className="text-xs text-muted-foreground">
            {SMS_DELIVERY_LIVE
              ? 'Provide email or phone so we can send your tickets and QR codes.'
              : 'Enter your email so we can send your tickets and QR codes.'}
          </p>
          {/* The one place a ticket buyer can opt into email. The signup form
              used to carry this and fed Mailchimp off the new account; there is
              no signup form now, so the ask lives on the form everyone fills
              in. Ticked by default, and it only ever means "yes" because they
              left it ticked — never because they bought something. */}
          <label className="flex items-start gap-2 pt-1 text-xs text-muted-foreground cursor-pointer">
            <Checkbox
              checked={newsletter}
              onCheckedChange={v => setNewsletter(v === true)}
              className="mt-0.5"
            />
            <span>Email me about upcoming films, performances, and Kenworthy news.</span>
          </label>
        </div>
      </div>

      {!isFree && (
        <div className="border-t border-border pt-3">
          <p className="text-sm font-medium mb-3 flex items-center gap-1">
            <CreditCard className="h-4 w-4" /> Payment
          </p>
          <SquareCardForm ref={cardRef} source="ticket-checkout" onReadyChange={setCardReady} />
          {errors.card && <p className="text-xs text-destructive mt-1">{errors.card}</p>}
        </div>
      )}

      <Button
        className="w-full"
        size="lg"
        onClick={handleSubmit}
        disabled={busy || (!isFree && !cardReady)}
      >
        {busy ? (
          <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Processing…</>
        ) : isFree ? (
          <><Check className="h-4 w-4 mr-1" /> Reserve {ticketCount} Ticket(s)</>
        ) : (
          <><Check className="h-4 w-4 mr-1" /> Pay ${total.toFixed(2)} — {ticketCount} Ticket(s)</>
        )}
      </Button>
      {!isFree && (
        <p className="text-xs text-muted-foreground text-center">
          Payments are processed securely by Square. Your card details never reach our servers.
        </p>
      )}
    </div>
  );
}
