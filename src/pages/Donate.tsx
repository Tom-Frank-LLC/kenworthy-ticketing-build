import { useRef, useState } from 'react';
import { invokeFunction } from '@/lib/functions';
import { SEO } from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Heart, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { SquareCardForm, type SquareCardFormHandle } from '@/components/SquareCardForm';

const TIERS = [25, 50, 100, 250];

export default function Donate() {
  // The SDK lifecycle used to be inlined here; it now lives in SquareCardForm,
  // shared with ticket and film-pass checkout. Behaviour is unchanged except
  // that sandbox vs production comes from the server rather than a hardcoded
  // sandbox URL.
  const cardRef = useRef<SquareCardFormHandle>(null);
  const [cardReady, setCardReady] = useState(false);

  const [selectedTier, setSelectedTier] = useState<number | null>(50);
  const [customAmount, setCustomAmount] = useState('');
  const amount = selectedTier ?? Number(customAmount || 0);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [dedicationType, setDedicationType] = useState<'' | 'in_honor' | 'in_memory'>('');
  const [dedicateTo, setDedicateTo] = useState('');
  const [notifyName, setNotifyName] = useState('');
  const [notifyEmail, setNotifyEmail] = useState('');
  const [message, setMessage] = useState('');

  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ receiptUrl: string | null; amount: number } | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (submitting) return;

    if (!amount || amount < 1) {
      toast.error('Please choose or enter a donation amount.');
      return;
    }
    if (amount > 100000) {
      toast.error('Please enter an amount of $100,000 or less.');
      return;
    }
    if (!name.trim() || !email.trim()) {
      toast.error('Your name and email are required for the receipt.');
      return;
    }
    if (!cardRef.current) {
      toast.error('Card form is not ready yet — give it a moment.');
      return;
    }

    setSubmitting(true);
    try {
      let token: string;
      try {
        token = await cardRef.current.tokenize();
      } catch (err) {
        toast.error(err instanceof Error ? err.message : 'Please check your card details.');
        return;
      }

      // invokeFunction unwraps the decline reason Square gave; supabase-js
      // otherwise reports every 4xx as "non-2xx status code".
      const data = await invokeFunction<{ success: boolean; receiptUrl: string | null }>(
        'square-donation',
        {
          action: 'create_payment',
          sourceId: token,
          amountCents: Math.round(amount * 100),
          donorName: name.trim(),
          donorEmail: email.trim(),
          donorPhone: phone.trim() || null,
          dedicationType: dedicationType || null,
          dedicateTo: dedicationType ? dedicateTo.trim() : null,
          notifyName: dedicationType ? notifyName.trim() : null,
          notifyEmail: dedicationType ? notifyEmail.trim() : null,
          message: message.trim() || null,
        },
      );

      if (!data?.success) {
        toast.error('Donation could not be processed.');
        return;
      }

      setDone({ receiptUrl: data.receiptUrl ?? null, amount });
      // Fire-and-forget Mailchimp sync — server-side subscribe also happens
      // in square-donation for the anonymous case; this covers logged-in
      // donors and refreshes their LTV/segmentation.
      try {
        const { syncMailchimpProfile } = await import('@/lib/mailchimp');
        void syncMailchimpProfile({ extraTags: ['donor'], source: 'donation' });
      } catch { /* noop */ }
    } catch (err) {
      console.error('Donation submit error:', err);
      toast.error(err instanceof Error ? err.message : 'Something went wrong.');
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="container max-w-2xl py-20 text-center">
        <SEO
          title="Thank You — Kenworthy Performing Arts Centre"
          description="Thank you for supporting Kenworthy Performing Arts Centre."
        />
        <CheckCircle2 className="h-16 w-16 text-accent mx-auto mb-6" />
        <p className="text-xs uppercase tracking-[0.3em] text-accent font-display mb-3">
          With Gratitude
        </p>
        <h1 className="font-display text-5xl uppercase tracking-wide text-foreground mb-6">
          Thank You
        </h1>
        <p className="font-serif text-lg text-muted-foreground leading-relaxed mb-2">
          Your gift of <span className="text-foreground font-semibold">${done.amount.toFixed(2)}</span> helps
          keep the lights on at 508 South Main — a century of stories, still being told.
        </p>
        <p className="font-serif italic text-sm text-muted-foreground mb-8">
          A receipt is on its way to {email}.
        </p>
        {done.receiptUrl && (
          <a
            href={done.receiptUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent underline underline-offset-4 hover:text-primary"
          >
            View your Square receipt
          </a>
        )}
      </div>
    );
  }

  return (
    <div className="container max-w-5xl py-16">
      <SEO
        title="Donate — Kenworthy Performing Arts Centre"
        description="Support Kenworthy Performing Arts Centre, Moscow Idaho's historic non-profit cinema, with a tax-deductible donation."
      />

      <header className="text-center mb-12">
        <p className="text-xs uppercase tracking-[0.3em] text-accent font-display mb-3">
          Support the Mission
        </p>
        <h1 className="font-display text-5xl md:text-6xl uppercase tracking-wide text-foreground mb-6">
          Keep the Marquee Lit
        </h1>
        <p className="font-serif text-lg text-muted-foreground max-w-3xl mx-auto leading-relaxed">
          Operational income covers about 60% of what we need to maintain the historic building,
          exceptional programming, and our role as a community gathering space. The rest comes from
          passionate people like you who want to help us provide unforgettable experiences to
          patrons each year. Your tax-deductible gift secures the future of the arts on the Palouse.
        </p>
        <p className="font-serif italic text-sm text-muted-foreground mt-4">
          All gifts have value; we use every level of contribution to its best use, with equal enthusiasm.
        </p>
      </header>

      <div className="grid lg:grid-cols-[1fr_1.2fr] gap-10">
        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="border border-accent/20 bg-card/40 p-6 md:p-8 rounded-sm space-y-6"
        >
          <div>
            <h2 className="font-display text-2xl uppercase tracking-wide text-foreground mb-1">
              Make a Donation Today
            </h2>
            <p className="font-serif text-sm text-muted-foreground">One-time gift</p>
          </div>

          {/* Amount */}
          <div>
            <Label className="font-display uppercase text-xs tracking-[0.2em] text-accent mb-3 block">
              Amount
            </Label>
            <div className="grid grid-cols-4 gap-2 mb-3">
              {TIERS.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => { setSelectedTier(t); setCustomAmount(''); }}
                  className={`h-12 border font-display uppercase tracking-wide transition-colors ${
                    selectedTier === t
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-accent/30 text-foreground hover:border-accent'
                  }`}
                >
                  ${t}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="font-serif text-muted-foreground">$</span>
              <Input
                type="number"
                min={1}
                max={100000}
                step="1"
                placeholder="Custom amount"
                value={customAmount}
                onChange={(e) => { setCustomAmount(e.target.value); setSelectedTier(null); }}
                className="bg-background"
              />
              <span className="font-serif text-sm text-muted-foreground">USD</span>
            </div>
            <p className="text-sm text-muted-foreground mt-2 font-serif italic">
              Please enter an amount between $1 and $100,000.
            </p>
          </div>

          {/* Donor info */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <Label htmlFor="d-name">Full Name</Label>
              <Input id="d-name" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="d-email">Email (for receipt)</Label>
              <Input id="d-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="d-phone">Phone (optional)</Label>
              <Input id="d-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
          </div>

          {/* Dedication */}
          <div className="border-t border-accent/20 pt-5">
            <div className="flex items-center gap-2 mb-3">
              <Heart className="h-4 w-4 text-accent" />
              <Label className="font-display uppercase text-xs tracking-[0.2em] text-accent">
                Dedicate this gift (optional)
              </Label>
            </div>
            <div className="grid grid-cols-3 gap-2 mb-3">
              {[
                { v: '', l: 'No' },
                { v: 'in_honor', l: 'In Honor' },
                { v: 'in_memory', l: 'In Memory' },
              ].map((opt) => (
                <button
                  key={opt.v}
                  type="button"
                  onClick={() => setDedicationType(opt.v as typeof dedicationType)}
                  className={`h-10 text-sm border font-display uppercase tracking-wide transition-colors ${
                    dedicationType === opt.v
                      ? 'border-primary bg-primary text-primary-foreground'
                      : 'border-accent/30 text-foreground hover:border-accent'
                  }`}
                >
                  {opt.l}
                </button>
              ))}
            </div>
            {dedicationType && (
              <div className="space-y-3">
                <div>
                  <Label htmlFor="d-to">In honor / memory of</Label>
                  <Input id="d-to" value={dedicateTo} onChange={(e) => setDedicateTo(e.target.value)} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <Label htmlFor="d-notify-name">Notify (name)</Label>
                    <Input id="d-notify-name" value={notifyName} onChange={(e) => setNotifyName(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="d-notify-email">Notify (email)</Label>
                    <Input id="d-notify-email" type="email" value={notifyEmail} onChange={(e) => setNotifyEmail(e.target.value)} />
                  </div>
                </div>
                <div>
                  <Label htmlFor="d-message">A short message (optional)</Label>
                  <Textarea id="d-message" rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          {/* Card */}
          <div className="border-t border-accent/20 pt-5">
            <Label className="font-display uppercase text-xs tracking-[0.2em] text-accent mb-3 block">
              Payment Card
            </Label>
            <SquareCardForm ref={cardRef} source="square-donation" onReadyChange={setCardReady} />
          </div>

          <Button
            type="submit"
            disabled={submitting || !cardReady}
            className="w-full h-12 text-base font-display uppercase tracking-wider"
          >
            {submitting ? (
              <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Processing…</>
            ) : (
              <><Heart className="h-4 w-4 mr-2" /> Donate ${amount > 0 ? amount.toFixed(0) : ''}</>
            )}
          </Button>

          <p className="font-serif italic text-sm text-muted-foreground text-center">
            The Kenworthy Performing Arts Centre is a 501(c)(3) non-profit. Tax ID 82-0519693.
          </p>
        </form>

        {/* Other ways to give */}
        <aside className="space-y-8">
          <section>
            <h2 className="font-display text-2xl uppercase tracking-wide text-foreground mb-3">
              Or Mail Your Support
            </h2>
            <p className="font-serif text-muted-foreground leading-relaxed">
              <strong className="text-foreground">Kenworthy Performing Arts Centre</strong><br />
              PO Box 8126<br />
              Moscow, ID 83843
            </p>
          </section>

          <section>
            <h2 className="font-display text-2xl uppercase tracking-wide text-foreground mb-3">
              Additional Ways to Support
            </h2>
            <dl className="space-y-4 font-serif text-muted-foreground leading-relaxed">
              <div>
                <dt className="text-foreground font-semibold">In-Kind Gifts</dt>
                <dd>
                  We need many items to host the multitude of events at Kenworthy each year.
                  Purchase an item from our Amazon wish list and donate it to the theatre.{' '}
                  <a href="http://a.co/e3VuGbF" target="_blank" rel="noopener noreferrer" className="text-accent underline underline-offset-2 hover:text-primary">
                    View the wish list
                  </a>.
                </dd>
              </div>
              <div>
                <dt className="text-foreground font-semibold">Qualified Charitable Distribution (QCD)</dt>
                <dd>
                  A direct transfer of funds from your IRA custodian, payable to a qualified charity.
                  QCDs can count toward satisfying your required minimum distributions (RMDs) for the
                  year. Instruct the firm that manages your IRA to direct some or all of your RMD to
                  Kenworthy.
                </dd>
              </div>
              <div>
                <dt className="text-foreground font-semibold">Stock Transfers</dt>
                <dd>
                  Contact your broker or financial advisor to send an electronic transfer using:
                  <ul className="mt-2 text-sm space-y-0.5">
                    <li>Tax ID #: 82-0519693</li>
                    <li>DTC #: 0361</li>
                    <li>Account #: 44906167</li>
                    <li>Broker: DA Davidson &amp; Co.</li>
                    <li>872 Troy Rd Ste 130, Moscow, ID 83843</li>
                    <li>Contact: Rusty Schatz, 208-883-5396 or rschatz@dadco.com</li>
                  </ul>
                </dd>
              </div>
            </dl>
          </section>

          <section className="border-t border-accent/20 pt-6">
            <p className="font-serif italic text-muted-foreground leading-relaxed">
              We would love to personally meet with you to discuss yours and your family's level
              of giving.{' '}
              <a
                href="mailto:support@kenworthy.org?subject=Donation%20Inquiry"
                className="text-accent underline underline-offset-2 hover:text-primary"
              >
                Send us an email
              </a>{' '}
              with any questions.
            </p>
          </section>
        </aside>
      </div>
    </div>
  );
}