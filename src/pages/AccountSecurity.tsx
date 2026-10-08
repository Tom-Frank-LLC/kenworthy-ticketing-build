import { useCallback, useEffect, useId, useState } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import type { Factor } from '@supabase/supabase-js';
import { ShieldCheck, Smartphone, Copy, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { SEO } from '@/components/SEO';
import { MfaCodeStep } from '@/components/MfaCodeStep';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  cleanCode,
  factorTypeLabel,
  friendlyMfaError,
  isCompleteCode,
  needsCode,
} from '@/lib/mfa';
import { safeRedirectPath } from '@/lib/safeUrl';

/**
 * /account/security: set up and manage two-step sign-in
 * (security audit 2026-10-06, M9; docs/briefs/BRIEF-admin-mfa.md).
 *
 * Reachable by anyone signed in. Admin-tier accounts with no authenticator are
 * sent here after signing in (`?setup=1&redirect=…`). While the server isn't
 * yet requiring it they may skip; once it is, this page is the way back in.
 *
 * Factors are listed generically, by type, and an account may hold several:
 * two authenticators (a phone and a password manager) is the advice, so losing
 * one isn't a lockout. A passkey would join this list in Phase 2 with its own
 * "Add" button. Nothing here assumes one TOTP factor.
 *
 * Changing factors needs an aal2 session once one is verified (auth enforces
 * this), so an account that has a factor but signed in with the password only is
 * asked for the code first.
 */

type Enrolling = { factorId: string; qr: string; secret: string; name: string };

export default function AccountSecurity() {
  const { user, loading, mfa, mfaRequired, refreshMfa, isAdmin, signOut } = useAuth();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const setup = params.get('setup') === '1';
  const redirect = safeRedirectPath(params.get('redirect'));

  const [factors, setFactors] = useState<Factor[] | null>(null);
  const [enrolling, setEnrolling] = useState<Enrolling | null>(null);
  const [removing, setRemoving] = useState<Factor | null>(null);

  const loadFactors = useCallback(async () => {
    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) {
      toast.error(error.message);
      return;
    }
    setFactors(data.all.filter(f => f.status === 'verified'));
  }, []);

  useEffect(() => {
    if (user && !needsCode(mfa)) void loadFactors();
  }, [user, mfa, loadFactors]);

  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }
  if (!user) {
    return <Navigate to={`/auth?redirect=${encodeURIComponent('/account/security')}`} replace />;
  }

  const seo = (
    <SEO
      title="Sign-in security — Kenworthy"
      description="Set up an authenticator app for your Kenworthy staff account."
      noindex
    />
  );

  if (needsCode(mfa)) {
    return (
      <div className="container py-8 px-4 max-w-md">
        {seo}
        <h1 className="font-display text-3xl font-bold mb-8">Sign-in security</h1>
        <Card className="glass">
          <CardContent className="pt-6">
            <MfaCodeStep
              factors={mfa.verifiedFactors}
              onCancel={() => {
                void signOut().finally(() => { window.location.href = '/auth'; });
              }}
            />
          </CardContent>
        </Card>
      </div>
    );
  }

  const verified = factors ?? [];
  const lastOne = verified.length === 1;

  const onEnrolled = async () => {
    setEnrolling(null);
    await Promise.all([loadFactors(), refreshMfa()]);
    toast.success('Authenticator app added');
  };

  const confirmRemove = async () => {
    if (!removing) return;
    const factor = removing;
    setRemoving(null);
    const { error } = await supabase.auth.mfa.unenroll({ factorId: factor.id });
    if (error) {
      toast.error(friendlyMfaError(error.message));
      return;
    }
    // The stored session still lists the removed factor until it is refreshed,
    // and the rest of the app reads factors from the session.
    await supabase.auth.refreshSession();
    await Promise.all([loadFactors(), refreshMfa()]);
    toast.success(`Removed ${factor.friendly_name || factorTypeLabel(factor)}`);
  };

  return (
    <div className="container py-8 px-4 max-w-xl">
      {seo}
      <h1 className="font-display text-3xl font-bold mb-2">Sign-in security</h1>
      <p className="text-muted-foreground mb-8">
        A code from an app on your phone, as well as your password, every time you sign in. If
        someone learns your password, they still can't get in.
      </p>

      {setup && verified.length === 0 && !enrolling && (
        <Card className="glass mb-6">
          <CardContent className="pt-6 space-y-2">
            <p className="font-semibold">
              {mfaRequired
                ? 'Your account needs an authenticator app before you can continue.'
                : 'Please set up an authenticator app for your account.'}
            </p>
            <p className="text-sm text-muted-foreground">
              {isAdmin
                ? 'Admin accounts can change the schedule, refunds and staff access, so they need more than a password. It takes about two minutes.'
                : 'It takes about two minutes.'}
            </p>
          </CardContent>
        </Card>
      )}

      <Card className="glass mb-6">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 font-display">
            <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" /> Your sign-in methods
          </CardTitle>
          <CardDescription>
            {verified.length === 0
              ? 'None yet. You sign in with your password only.'
              : 'Any of these can give the code when you sign in.'}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {factors === null ? (
            <p className="text-muted-foreground">Loading…</p>
          ) : (
            verified.length > 0 && (
              <ul className="divide-y divide-border">
                {verified.map(f => (
                  <li key={f.id} className="flex items-center justify-between gap-3 py-3">
                    <div className="flex items-center gap-3 min-w-0">
                      <Smartphone className="h-5 w-5 shrink-0 text-primary" aria-hidden="true" />
                      <div className="min-w-0">
                        <p className="font-medium truncate">{f.friendly_name || factorTypeLabel(f)}</p>
                        <p className="text-sm text-muted-foreground">
                          {factorTypeLabel(f)} · added {new Date(f.created_at).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setRemoving(f)}
                      disabled={mfaRequired && lastOne}
                      aria-label={`Remove ${f.friendly_name || factorTypeLabel(f)}`}
                    >
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                      <span className="ml-1">Remove</span>
                    </Button>
                  </li>
                ))}
              </ul>
            )
          )}
          {mfaRequired && lastOne && (
            <p className="text-sm text-muted-foreground">
              Your account must keep at least one. To replace it, add the new one first, then
              remove this.
            </p>
          )}

          {enrolling ? (
            <EnrollTotp
              enrolling={enrolling}
              onDone={onEnrolled}
              onCancel={async () => {
                await supabase.auth.mfa.unenroll({ factorId: enrolling.factorId }).catch(() => {});
                setEnrolling(null);
              }}
            />
          ) : (
            factors !== null && (
              <StartTotp existing={factors} onStarted={setEnrolling} first={verified.length === 0} />
            )
          )}
        </CardContent>
      </Card>

      {verified.length === 1 && !enrolling && (
        <p className="text-sm text-muted-foreground mb-6">
          Tip: add a second one, such as a password manager (1Password, Bitwarden) as well as
          your phone. Then losing one device doesn't lock you out.
        </p>
      )}

      {setup && (
        <div className="flex flex-wrap gap-3">
          {verified.length > 0 ? (
            <Button onClick={() => navigate(redirect)}>Continue</Button>
          ) : (
            !mfaRequired && (
              <Link to={redirect} className="text-sm text-muted-foreground hover:text-primary underline">
                Not now
              </Link>
            )
          )}
        </div>
      )}

      <AlertDialog open={removing !== null} onOpenChange={open => { if (!open) setRemoving(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Remove {removing?.friendly_name || (removing ? factorTypeLabel(removing) : '')}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lastOne
                ? 'You will sign in with your password only until you add another.'
                : 'It will no longer give codes for this account.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction onClick={confirmRemove}>Remove</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * "Add an authenticator app": name it, then ask auth for a secret.
 *
 * Auth refuses two factors with the same name on one account, so the default
 * name is numbered past what is there. Unverified leftovers from an abandoned
 * attempt are cleared first; they count toward auth's per-account limit and
 * can never be used.
 */
function StartTotp({
  existing,
  onStarted,
  first,
}: {
  existing: Factor[];
  onStarted: (e: Enrolling) => void;
  first: boolean;
}) {
  const id = useId();
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const { data: all } = await supabase.auth.mfa.listFactors();
      for (const f of all?.all ?? []) {
        if (f.status !== 'verified') await supabase.auth.mfa.unenroll({ factorId: f.id });
      }
      const taken = new Set(existing.map(f => f.friendly_name));
      let friendlyName = name.trim();
      if (!friendlyName) {
        friendlyName = 'Authenticator app';
        for (let n = 2; taken.has(friendlyName); n++) friendlyName = `Authenticator app ${n}`;
      }
      if (taken.has(friendlyName)) {
        toast.error('You already have one with that name. Pick another.');
        return;
      }
      const { data, error } = await supabase.auth.mfa.enroll({ factorType: 'totp', friendlyName });
      if (error) throw error;
      onStarted({ factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret, name: friendlyName });
    } catch (err) {
      toast.error(friendlyMfaError(err instanceof Error ? err.message : String(err)));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={start} className="space-y-3 border-t border-border pt-4">
      <div className="space-y-2">
        <Label htmlFor={`${id}-name`}>Name it (optional)</Label>
        <Input
          id={`${id}-name`}
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={first ? 'e.g. My phone' : 'e.g. 1Password'}
          maxLength={60}
        />
      </div>
      <Button type="submit" disabled={busy}>
        {busy ? 'Starting…' : first ? 'Set up an authenticator app' : 'Add another authenticator app'}
      </Button>
    </form>
  );
}

/** Scan, type the code, done. The secret is shown as text: it is the QR's text alternative. */
function EnrollTotp({
  enrolling,
  onDone,
  onCancel,
}: {
  enrolling: Enrolling;
  onDone: () => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const verify = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!isCompleteCode(code)) {
      setError('Enter the 6-digit code your app shows.');
      return;
    }
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.mfa.challengeAndVerify({
      factorId: enrolling.factorId,
      code: cleanCode(code),
    });
    setBusy(false);
    if (err) {
      setError(friendlyMfaError(err.message));
      setCode('');
      return;
    }
    onDone();
  };

  const copySecret = async () => {
    try {
      await navigator.clipboard.writeText(enrolling.secret);
      toast.success('Setup key copied');
    } catch {
      toast.error('Could not copy. Select the key and copy it by hand.');
    }
  };

  return (
    <form onSubmit={verify} className="space-y-4 border-t border-border pt-4" noValidate>
      <ol className="list-decimal pl-5 space-y-4">
        <li>
          <p>Open your authenticator app (Google Authenticator, 1Password, Authy…) and scan this code.</p>
          <div className="mt-3 inline-block rounded-md bg-white p-3">
            <img
              src={enrolling.qr}
              width={180}
              height={180}
              alt="QR code for setting up your authenticator app. If you can't scan it, use the setup key below."
            />
          </div>
          <p className="mt-3 text-sm text-muted-foreground">
            Can't scan it? Choose "enter a setup key" in your app and type this:
          </p>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <code className="break-all rounded bg-muted px-2 py-1 text-sm" aria-label="Setup key">
              {enrolling.secret}
            </code>
            <Button type="button" variant="outline" size="sm" onClick={copySecret}>
              <Copy className="h-4 w-4" aria-hidden="true" />
              <span className="ml-1">Copy</span>
            </Button>
          </div>
        </li>
        <li>
          <Label htmlFor={`${id}-code`}>Enter the 6-digit code it now shows</Label>
          <Input
            id={`${id}-code`}
            className="mt-2 max-w-[12rem]"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9 ]*"
            maxLength={7}
            value={code}
            onChange={e => setCode(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-error` : undefined}
          />
          {error && (
            <p id={`${id}-error`} role="alert" className="mt-2 text-sm">
              {error}
            </p>
          )}
        </li>
      </ol>
      <div className="flex flex-wrap gap-3">
        <Button type="submit" disabled={busy}>
          {busy ? 'Checking…' : 'Finish setup'}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
