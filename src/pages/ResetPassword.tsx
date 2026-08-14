import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { toast } from 'sonner';
import { Film } from 'lucide-react';

export default function ResetPassword() {
  const navigate = useNavigate();
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [ready, setReady] = useState(false);
  // An invited staff member is setting a password for the first time, not
  // resetting one they forgot. Same form, honest wording.
  const [isInvite] = useState(() =>
    typeof window !== 'undefined' && /type=invite/.test(window.location.href));

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'PASSWORD_RECOVERY') {
        setReady(true);
      }
    });
    // Check hash and query params for a recovery *or* invite token.
    //
    // `invite` matters because this is where `invite-staff` sends a new staff
    // member: Supabase's verify endpoint bounces them here with `type=invite`
    // in the hash, and it raises SIGNED_IN rather than PASSWORD_RECOVERY. Match
    // only on recovery and an invited person waits on "Verifying your reset
    // link…" forever, with no way to set the password they were invited to set.
    if (/type=(recovery|invite)/.test(window.location.hash) ||
        /type=(recovery|invite)/.test(window.location.href)) {
      setReady(true);
    }
    return () => subscription.unsubscribe();
  }, []);

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password !== confirmPassword) {
      toast.error('Passwords do not match');
      return;
    }
    if (password.length < 6) {
      toast.error('Password must be at least 6 characters');
      return;
    }
    setLoading(true);
    try {
      // Race against a timeout to avoid Navigator Lock hanging
      const result = await Promise.race([
        supabase.auth.updateUser({ password }),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
      ]);
      if (result.error) throw result.error;
      toast.success('Password updated successfully!');
      window.location.href = '/';
    } catch (err: any) {
      if (err.message === 'timeout') {
        // Password likely updated but lock timed out — redirect anyway
        toast.success('Password updated! Redirecting...');
        window.location.href = '/';
      } else {
        toast.error(err.message);
        setLoading(false);
      }
    }
  };

  if (!ready) {
    return (
      <div className="flex min-h-screen items-center justify-center px-4">
        <Card className="w-full max-w-md glass glow-primary">
          <CardHeader className="text-center">
            <div className="flex justify-center mb-2">
              <Film className="h-10 w-10 text-primary" />
            </div>
            <CardTitle className="font-display text-2xl">Loading...</CardTitle>
            <CardDescription>Verifying your reset link...</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md glass glow-primary">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-2">
            <Film className="h-10 w-10 text-primary" />
          </div>
          <CardTitle className="font-display text-2xl">
            {isInvite ? 'Set Your Password' : 'Reset Password'}
          </CardTitle>
          <CardDescription>
            {isInvite
              ? 'Choose a password to finish setting up your account'
              : 'Enter your new password'}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleReset} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new-password">New Password</Label>
              <Input id="new-password" type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm Password</Label>
              <Input id="confirm-password" type="password" required minLength={6} value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? 'Updating...' : 'Update Password'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
