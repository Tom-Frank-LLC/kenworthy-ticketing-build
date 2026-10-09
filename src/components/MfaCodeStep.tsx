import { useId, useState } from 'react';
import type { Factor } from '@supabase/supabase-js';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cleanCode, codeFactors, isCompleteCode, verifyCode } from '@/lib/mfa';

/**
 * "Enter the code from your authenticator app": the second step of signing in.
 *
 * Shown after the password on /auth, and in place of any staff or admin page
 * when the session is still aal1 (a session that predates enrolling, or a tab
 * left open from before). On success supabase-js stores the aal2 session and
 * fires onAuthStateChange, so the page behind this re-renders by itself;
 * `onVerified` is for callers that also want to navigate.
 *
 * One plain text field rather than six boxes: password managers fill it
 * (`one-time-code`), and a screen reader hears one field, not six.
 */
export function MfaCodeStep({
  factors,
  onVerified,
  onCancel,
  cancelLabel = 'Sign out',
}: {
  /** The account's verified factors; the ones that take a code are offered. */
  factors: Factor[];
  onVerified?: () => void;
  onCancel?: () => void;
  cancelLabel?: string;
}) {
  const usable = codeFactors(factors);
  const [factorId, setFactorId] = useState(usable[0]?.id ?? '');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleteCode(code)) {
      setError('Enter the 6-digit code from your authenticator app.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyCode(factorId, cleanCode(code));
      onVerified?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That code did not work. Please try again.');
      setCode('');
    } finally {
      setBusy(false);
    }
  };

  if (usable.length === 0) {
    // Only reachable once a factor type with no code exists (a passkey, in
    // Phase 2) and is the account's only one. Say so rather than show an input
    // that cannot work.
    return (
      <p className="text-sm">
        This account's second step can't be completed in this browser. Ask the
        superadmin to reset it.
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-4" noValidate>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold">Enter your code</h2>
        <p className="text-sm text-muted-foreground">
          Open your authenticator app and enter the 6-digit code it shows for Kenworthy.
        </p>
      </div>

      {usable.length > 1 && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium">Which app are you using?</legend>
          {usable.map(f => (
            <label key={f.id} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                type="radio"
                name={`${id}-factor`}
                value={f.id}
                checked={factorId === f.id}
                onChange={() => setFactorId(f.id)}
              />
              {f.friendly_name || 'Authenticator app'}
            </label>
          ))}
        </fieldset>
      )}

      <div className="space-y-2">
        <Label htmlFor={`${id}-code`}>6-digit code</Label>
        <Input
          id={`${id}-code`}
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="[0-9 ]*"
          maxLength={7}
          autoFocus
          required
          value={code}
          onChange={e => setCode(e.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
        />
        {error && (
          <p id={`${id}-error`} role="alert" className="text-sm">
            {error}
          </p>
        )}
      </div>

      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Checking…' : 'Continue'}
      </Button>
      {onCancel && (
        <button
          type="button"
          className="w-full text-sm text-muted-foreground hover:text-primary underline"
          onClick={onCancel}
        >
          {cancelLabel}
        </button>
      )}
      <p className="text-sm text-muted-foreground">
        Lost your phone? Ask the superadmin to reset your sign-in code. You can set up a
        new app the next time you sign in.
      </p>
    </form>
  );
}
