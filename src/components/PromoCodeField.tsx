import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { promoNotice, type PromoOutcome } from '@/lib/quote';

/**
 * The promo-code box, for the showing page and the box office
 * (BRIEF-promo-codes).
 *
 * It holds only what was typed. Whether the code is real, applies here, and has
 * uses left is the database's answer, which arrives through useOrderQuote as
 * `promo` (accepted) or `error` (refused, in words). The parent owns the
 * applied code because the quote and the checkout both need it.
 *
 * Collapsed behind a link by default: most buyers have no code, and an open
 * empty box reads as "you are paying more than someone else".
 */
export function PromoCodeField({
  applied,
  onApply,
  onRemove,
  promo,
  error,
  checking,
  disabled,
  note,
  startOpen = false,
}: {
  /** The code the parent is quoting with, or null. */
  applied: string | null;
  onApply: (code: string) => void;
  onRemove: () => void;
  /** The database's verdict on `applied`, when it accepted it. */
  promo: PromoOutcome | null;
  /** Its refusal, when it did not. */
  error: string | null;
  checking?: boolean;
  disabled?: boolean;
  /** An extra line under an accepted code, e.g. a per-person limit at the counter. */
  note?: string | null;
  startOpen?: boolean;
}) {
  const [open, setOpen] = useState(startOpen || !!applied);
  const [draft, setDraft] = useState(applied ?? '');
  const inputId = useId();
  const statusId = useId();

  if (!open) {
    return (
      <button
        type="button"
        className="text-sm underline underline-offset-2 text-muted-foreground hover:text-foreground"
        onClick={() => setOpen(true)}
        disabled={disabled}
      >
        Have a promo code?
      </button>
    );
  }

  const notice = promoNotice(promo);
  const accepted = !!applied && !!promo && !error;

  return (
    <div className="space-y-2">
      <label htmlFor={inputId} className="text-sm font-medium">Promo code</label>
      {accepted ? (
        <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
          <span className="text-sm font-medium tracking-wide">{promo.code}</span>
          <Button type="button" variant="ghost" size="sm" onClick={() => { onRemove(); setDraft(''); }} disabled={disabled}>
            Remove
          </Button>
        </div>
      ) : (
        <form
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            const code = draft.trim();
            if (code) onApply(code);
          }}
        >
          <Input
            id={inputId}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={32}
            aria-describedby={error || notice ? statusId : undefined}
            aria-invalid={!!error}
            disabled={disabled}
          />
          <Button type="submit" variant="outline" disabled={disabled || checking || !draft.trim()}>
            {checking && applied ? 'Checking…' : 'Apply'}
          </Button>
        </form>
      )}
      {error && (
        <p id={statusId} className="text-sm text-destructive" role="alert">{error}</p>
      )}
      {!error && notice && (
        <p id={statusId} className="text-sm text-muted-foreground" role="status">{notice}</p>
      )}
      {accepted && !notice && note && (
        <p className="text-sm text-muted-foreground" role="status">{note}</p>
      )}
    </div>
  );
}
