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
  /** Box-office wording differs from the buyer-facing page. */
  variant?: 'customer' | 'staff';
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
export function DonationPrompt({
  valueCents,
  onChange,
  disabled,
  className,
  variant = 'customer',
}: DonationPromptProps) {
  const [custom, setCustom] = useState('');
  const isPreset = PRESETS_CENTS.includes(valueCents);

  const pick = (cents: number) => {
    setCustom('');
    onChange(cents);
  };

  const handleCustom = (raw: string) => {
    setCustom(raw);
    const dollars = Number(raw);
    if (!raw.trim() || !Number.isFinite(dollars) || dollars <= 0) {
      onChange(0);
      return;
    }
    const cents = Math.min(Math.round(dollars * 100), MAX_BUNDLED_DONATION_CENTS);
    // Under a dollar is not a donation the server can record — the donations
    // table itself refuses it — so it counts as no donation rather than as an
    // error the buyer has to solve at the pay button.
    onChange(cents < 100 ? 0 : cents);
  };

  return (
    <div className={`border-t border-border pt-3 ${className ?? ''}`}>
      <p className="text-sm font-medium mb-1 flex items-center gap-1">
        <Heart className="h-4 w-4 text-primary" />
        {variant === 'staff' ? 'Add a donation?' : 'Add a donation to support the Kenworthy?'}
      </p>
      <p className="text-sm text-muted-foreground mb-3">
        {variant === 'staff'
          ? 'Tax-deductible, no sales tax, added to this charge.'
          : 'Every gift helps keep the marquee lit. Tax-deductible, and not taxed.'}
      </p>

      <div className="grid grid-cols-4 gap-2">
        <button
          type="button"
          disabled={disabled}
          onClick={() => pick(0)}
          aria-pressed={valueCents === 0}
          className={`h-10 text-sm border rounded-md transition-colors disabled:opacity-50 ${
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
            className={`h-10 text-sm border rounded-md transition-colors disabled:opacity-50 ${
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
          className="h-9"
        />
      </div>

      {valueCents >= MAX_BUNDLED_DONATION_CENTS && !isPreset && (
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
