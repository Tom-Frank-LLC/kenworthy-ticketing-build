import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader } from '@/components/ui/card';
import { SEO } from '@/components/SEO';
import { KenworthyMark } from '@/components/brand/KenworthyLogo';
import {
  LINK_SENT_MESSAGE,
  isSignInCode,
  requestHostSignInLink,
  verifyHostSignInCode,
} from '@/lib/hostSignIn';

/**
 * Sign-in for event hosts: an emailed link or code, no password.
 * See src/lib/hostSignIn.ts for what the session can and cannot do.
 *
 * Not linked from anywhere a patron would look. A host reaches it from the link
 * staff send, or from /host when signed out.
 */
export default function HostSignIn() {
  const { user, isHost, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Already in (the link was clicked in this browser, or the code just went
  // through): straight to the dashboard.
  useEffect(() => {
    if (!authLoading && user && isHost) navigate('/host', { replace: true });
  }, [authLoading, user, isHost, navigate]);

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const failure = await requestHostSignInLink(email);
    setBusy(false);
    if (failure) setError(failure);
    else setStep('code');
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault();
    if (!isSignInCode(code)) {
      setError('Enter the code from the email: six digits.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await verifyHostSignInCode(email, code);
      navigate('/host', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <SEO
        title="Host sign in — Kenworthy"
        description="Sign-in for people hosting an event at the Kenworthy, to follow their ticket sales."
      />
      <h1 className="sr-only">Host sign in</h1>
      <Card className="w-full max-w-md glass glow-primary">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <KenworthyMark treatment="white" className="h-12 sm:h-14" />
          </div>
          <CardDescription>Host sign in — follow your event's ticket sales</CardDescription>
        </CardHeader>
        <CardContent>
          {step === 'email' ? (
            <form onSubmit={sendLink} className="space-y-4 mt-2">
              <div className="space-y-2">
                <Label htmlFor="host-email">Email</Label>
                <Input
                  id="host-email"
                  type="email"
                  autoComplete="email"
                  required
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                />
                <p className="text-sm text-muted-foreground">
                  The address the Kenworthy has on file for your event. We'll email you a link and a code; no password needed.
                </p>
              </div>
              {error && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Sending…' : 'Email me a sign-in link'}
              </Button>
            </form>
          ) : (
            <form onSubmit={submitCode} className="space-y-4 mt-2">
              <p className="text-sm" role="status">{LINK_SENT_MESSAGE}</p>
              <p className="text-sm text-muted-foreground">
                Click the link in the email, or type the code here. Both work once, and expire after a while.
              </p>
              <div className="space-y-2">
                <Label htmlFor="host-code">Code</Label>
                <Input
                  id="host-code"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  value={code}
                  onChange={e => setCode(e.target.value)}
                />
              </div>
              {error && <p role="alert" className="rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? 'Signing in…' : 'Sign in'}
              </Button>
              <button
                type="button"
                className="w-full text-sm text-muted-foreground hover:text-primary underline"
                onClick={() => { setStep('email'); setCode(''); setError(null); }}
              >
                Use a different address, or send another email
              </button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
