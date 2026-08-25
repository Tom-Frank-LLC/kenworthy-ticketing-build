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
    guestInfo: {
      name: string;
      email: string;
      phone: string;
      newsletter: boolean;
      /**
       * Whether the buyer ticked the SMS box. Distinct from `phone` being
       * non-empty: a number typed and not consented to must never be texted,
       * and the server cannot infer that from the number alone.
       */
      smsConsent: boolean;
    },
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
  // Unchecked, and it stays unchecked — A2P 10DLC requires SMS consent to be an
  // affirmative act, never a default the buyer has to notice and undo. It is
  // also why nothing on this form is blocked when it is off: a purchase must be
  // completable without agreeing to texts.
  const [smsConsent, setSmsConsent] = useState(false);
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
    // Name is asked for, never required. It is a courtesy — it puts a person's
    // name on the confirmation and gives the box office something to search —
    // and none of that is worth turning a paying customer away over. The
    // server agrees: ticket-checkout dropped its own name check with this
    // change, so a blank name is a complete order, not a rejected one.
    if (SMS_DELIVERY_LIVE) {
      // A phone only counts as a contact if it has been consented to. Without
      // the tick we will not text it, so a buyer with no email and no consent
      // has given us nothing we can deliver to — which is the same hole as the
      // one that charged phone-only buyers and sent them nothing in August.
      if (!email.trim() && !smsOptIn) {
        newErrors.contact = phone.trim()
          ? 'Tick the box to have your tickets texted, or add an email'
          : 'Email or phone is required';
      }
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
  // Consent is only meaningful about a number we actually have.
  const smsOptIn = COLLECT_PHONE && smsConsent && contactPhone.length > 0;

  const handleSubmit = async () => {
    if (!validate()) return;
    // Free ($0) showing — no card step. The server skips Square for $0 orders,
    // so there is no token to collect; hand back an empty source.
    if (isFree) {
      onPurchase(
        { name: name.trim(), email: email.trim(), phone: contactPhone, newsletter, smsConsent: smsOptIn },
        '',
      );
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
      onPurchase(
      { name: name.trim(), email: email.trim(), phone: contactPhone, newsletter, smsConsent: smsOptIn },
      sourceId,
    );
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
            <Label htmlFor="guest-name" className="text-sm">Name</Label>
            <Input
              id="guest-name"
              placeholder="Your name"
              value={name}
              onChange={e => setName(e.target.value)}
              maxLength={100}
            />
            {errors.name && <p className="text-sm text-destructive mt-1">{errors.name}</p>}
          </div>
          <div>
            <Label htmlFor="guest-email" className="text-sm flex items-center gap-1">
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
            {errors.email && <p className="text-sm text-destructive mt-1">{errors.email}</p>}
          </div>
          {/* The phone field and its consent box are the opt-in an A2P 10DLC
              campaign is reviewed on, which is why they are live before the
              texts are. Both stay attached to the input rather than living in
              the footer. STOP and HELP are answered by the Twilio Messaging
              Service's Advanced Opt-Out, not by anything in this repo — there
              is no inbound webhook here, so never disclose a keyword the
              service is not configured to handle. */}
          {COLLECT_PHONE && (
            <div>
              <Label htmlFor="guest-phone" className="text-sm flex items-center gap-1">
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
              {/* The A2P 10DLC disclosure block. Twilio's campaign review
                  rejects an opt-in that is missing any of four things, so all
                  four are here and stay here: what we send, how often, that
                  rates apply, and how to stop. Unchecked by default and
                  optional — the buyer can complete this purchase without it,
                  which is the third thing the review checks for. */}
              <label className="flex items-start gap-2 mt-2 text-sm text-muted-foreground cursor-pointer">
                <Checkbox
                  id="guest-sms-consent"
                  checked={smsConsent}
                  onCheckedChange={v => setSmsConsent(v === true)}
                  className="mt-0.5"
                />
                <span>
                  Text me my tickets. I agree to receive ticket confirmations and updates about
                  this order by text message from Kenworthy Performing Arts Centre at the
                  number above. Message frequency varies &mdash; usually one message per order.
                  Msg &amp; data rates may apply. Reply STOP to cancel, HELP for help. Optional
                  &mdash; your tickets come by email either way.
                </span>
              </label>
            </div>
          )}
          {errors.contact && <p className="text-sm text-destructive mt-1">{errors.contact}</p>}
          <p className="text-sm text-muted-foreground">
            {SMS_DELIVERY_LIVE
              ? 'Provide email or phone so we can send your tickets and QR codes.'
              : 'Enter your email so we can send your tickets and QR codes.'}
          </p>
          {/* The one place a ticket buyer can opt into email. The signup form
              used to carry this and fed Mailchimp off the new account; there is
              no signup form now, so the ask lives on the form everyone fills
              in. Ticked by default, and it only ever means "yes" because they
              left it ticked — never because they bought something. */}
          <label className="flex items-start gap-2 pt-1 text-sm text-muted-foreground cursor-pointer">
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
          {errors.card && <p className="text-sm text-destructive mt-1">{errors.card}</p>}
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
        <p className="text-sm text-muted-foreground text-center">
          Payments are processed securely by Square. Your card details never reach our servers.
        </p>
      )}
    </div>
  );
}
