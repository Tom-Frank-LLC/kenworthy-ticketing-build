import { useState } from 'react';
import { Heart } from 'lucide-react';
import { Input } from '@/components/ui/input';

/**
 * The largest gift the checkout prompt will take, in cents.
 *
 * Mirrors MAX_BUNDLED_DONATION_CENTS in supabase/functions/_shared/pricing.ts,
 * which is the copy that matters — the server refuses anything above it. A
 * bigger gift is very welcome, just not through a $9 ticket purchase, so the
 * copy points at the Donate page instead of failing at the card step.
 */
export const MAX_BUNDLED_DONATION_CENTS = 100_000;

const PRESETS_CENTS = [100, 500, 1000];

interface DonationPromptProps {
  /** Current gift in cents. 0 means "no thanks", which is the default. */
  valueCents: number;
  onChange: (cents: number) => void;
  disabled?: boolean;
  className?: string;
  /**
   * Box-office wording differs from the buyer-facing page. `display` is the
   * patron-facing display at the box office (/pos/display): the patron's words,
   * bigger targets, and no link off the page — it is a kiosk, and the staff
   * member takes any email. There every `onChange` is a decision the screen
   * moves on from, so a typed amount waits for its own button rather than
   * being sent a keystroke at a time ("25" would otherwise send $2 first).
   */
  variant?: 'customer' | 'staff' | 'display';
}

/**
 * "Add a donation?" — the same prompt online and at the counter.
 *
 * One component for both surfaces on purpose: the online checkout and the box
 * office have to treat a gift identically (added to the one charge, never
 * taxed, recorded as contribution income), and two implementations of the same
 * offer is how the two drift apart.
 *
 * Zero is the default and "No thanks" is a real, visible choice rather than the
 * absence of one — a prompt that makes declining feel like an omission is the
 * kind that gets a theatre complained about.
 */
/** A typed dollar amount as a gift in cents; 0 for anything that is not one. */
function customCents(raw: string): number {
  const dollars = Number(raw);
  if (!raw.trim() || !Number.isFinite(dollars) || dollars <= 0) return 0;
  const cents = Math.min(Math.round(dollars * 100), MAX_BUNDLED_DONATION_CENTS);
  // Under a dollar is not a donation the server can record — the donations
  // table itself refuses it — so it counts as no donation rather than as an
  // error the buyer has to solve at the pay button.
  return cents < 100 ? 0 : cents;
}

export function DonationPrompt({
  valueCents,
  onChange,
  disabled,
  className,
  variant = 'customer',
}: DonationPromptProps) {
  const [custom, setCustom] = useState('');
  const isPreset = PRESETS_CENTS.includes(valueCents);
  const big = variant === 'display';
  const buttonSize = big ? 'h-12 sm:h-14 text-lg' : 'h-10 text-sm';

  const pick = (cents: number) => {
    setCustom('');
    onChange(cents);
  };

  const handleCustom = (raw: string) => {
    setCustom(raw);
    if (variant !== 'display') onChange(customCents(raw));
  };
  const typedCents = customCents(custom);

  return (
    <div className={`border-t border-border pt-3 ${className ?? ''}`}>
      <p className="text-sm font-medium mb-1 flex items-center gap-1">
        <Heart className="h-4 w-4 text-primary" />
        {variant === 'staff' ? 'Add a donation?' : 'Add a donation to support Kenworthy?'}
      </p>
      <p className="text-sm text-muted-foreground mb-3">
        {variant === 'staff'
          ? 'Tax-deductible, no sales tax, added to this charge.'
          : 'Every gift helps keep the marquee lit. Tax-deductible, and not taxed.'}
      </p>

      {/* Two by two on a phone-sized display: four across, "No thanks" at
          display size does not fit its button and breaks mid-word. */}
      <div className={`grid gap-2 ${big ? 'grid-cols-2 sm:grid-cols-4' : 'grid-cols-4'}`}>
        <button
          type="button"
          disabled={disabled}
          onClick={() => pick(0)}
          aria-pressed={valueCents === 0}
          className={`${buttonSize} border rounded-md transition-colors disabled:opacity-50 ${
            valueCents === 0
              ? 'border-primary bg-primary text-primary-foreground'
              : 'border-border hover:border-primary/60'
          }`}
        >
          No thanks
        </button>
        {PRESETS_CENTS.map((cents) => (
          <button
            key={cents}
            type="button"
            disabled={disabled}
            onClick={() => pick(cents)}
            aria-pressed={valueCents === cents}
            className={`${buttonSize} border rounded-md transition-colors disabled:opacity-50 ${
              valueCents === cents
                ? 'border-primary bg-primary text-primary-foreground'
                : 'border-border hover:border-primary/60'
            }`}
          >
            ${cents / 100}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-2 mt-2">
        <span className="text-sm text-muted-foreground">$</span>
        <Input
          type="number"
          min={1}
          max={MAX_BUNDLED_DONATION_CENTS / 100}
          step="1"
          inputMode="decimal"
          aria-label="Custom donation amount"
          placeholder="Other amount"
          value={custom}
          disabled={disabled}
          onChange={(e) => handleCustom(e.target.value)}
          className={big ? 'h-12 sm:h-14 text-lg' : 'h-9'}
        />
        {variant === 'display' && (
          <button
            type="button"
            disabled={disabled || typedCents === 0}
            onClick={() => onChange(typedCents)}
            className={`${buttonSize} shrink-0 px-3 rounded-md border border-primary bg-primary text-primary-foreground disabled:opacity-50`}
          >
            {typedCents > 0 ? `Add $${(typedCents / 100).toFixed(2)}` : 'Add'}
          </button>
        )}
      </div>

      {/* Said here, where the gift is chosen, rather than only at the email
          field below — a requirement that appears without a reason reads as an
          obstacle. Customer-facing only: the box office still takes an
          emailless walk-in gift, which is recorded locally and not synced. */}
      {valueCents > 0 && variant === 'customer' && (
        <p className="text-sm text-muted-foreground mt-2">
          We&rsquo;ll need your email below &mdash; that&rsquo;s where your tax-deductible receipt
          goes.
        </p>
      )}

      {typedCents >= MAX_BUNDLED_DONATION_CENTS && variant === 'display' && (
        <p className="text-sm text-muted-foreground mt-2">
          For a gift larger than ${MAX_BUNDLED_DONATION_CENTS / 100}, please ask at the window so we
          can thank you properly.
        </p>
      )}

      {valueCents >= MAX_BUNDLED_DONATION_CENTS && !isPreset && variant !== 'display' && (
        <p className="text-sm text-muted-foreground mt-2">
          For a gift larger than ${MAX_BUNDLED_DONATION_CENTS / 100}, visit our{' '}
          <a href="/donate" className="underline underline-offset-2">
            donation page
          </a>{' '}
          so we can thank you properly.
        </p>
      )}
    </div>
  );
}
