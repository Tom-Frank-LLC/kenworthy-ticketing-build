import { useCallback, useEffect, useState } from 'react';
import { KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { invokeFunction } from '@/lib/functions';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
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

interface AccountStatus {
  user_id: string;
  email: string | null;
  roles: string[];
  verified_factors: number;
  factor_types: string[];
  known: boolean;
}

const ADMIN_TIER = ['admin', 'superadmin'];

/**
 * The superadmin's view of two-step sign-in (BRIEF-admin-mfa): who has an
 * authenticator, whether the server is requiring one yet, and the reset for
 * someone who lost their phone. Backed by the admin-mfa-reset edge function,
 * which is superadmin-only and audited.
 *
 * This is also the rollout check: the switch should go on only when every admin
 * and superadmin row here shows a code.
 */
export function StaffMfaPanel() {
  const { user } = useAuth();
  const [accounts, setAccounts] = useState<AccountStatus[] | null>(null);
  const [required, setRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState<AccountStatus | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await invokeFunction<{ required: boolean; accounts: AccountStatus[] }>('admin-mfa-reset', {
        action: 'status',
      });
      setError(null);
      setRequired(res.required);
      setAccounts(
        [...res.accounts].sort(
          (a, b) =>
            Number(b.roles.some(r => ADMIN_TIER.includes(r))) - Number(a.roles.some(r => ADMIN_TIER.includes(r))) ||
            (a.email ?? '').localeCompare(b.email ?? ''),
        ),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const confirmReset = async () => {
    if (!resetting) return;
    const target = resetting;
    setResetting(null);
    try {
      const res = await invokeFunction<{ removed: number }>('admin-mfa-reset', {
        action: 'reset',
        user_id: target.user_id,
      });
      toast.success(`Reset ${target.email ?? 'account'}: ${res.removed} removed. They set up a new app at next sign-in.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    }
  };

  const adminTier = (accounts ?? []).filter(a => a.roles.some(r => ADMIN_TIER.includes(r)));
  const adminsReady = adminTier.filter(a => a.verified_factors > 0).length;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" aria-hidden="true" /> Two-step sign-in
        </CardTitle>
        <CardDescription>
          {required
            ? 'Required for admin and superadmin accounts: the server refuses them without a code.'
            : 'Not required yet. Admin and superadmin accounts are asked to set it up.'}{' '}
          {accounts && `${adminsReady} of ${adminTier.length} admin-tier accounts have an authenticator.`}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {error && <p role="alert" className="text-sm mb-4">{error}</p>}
        {accounts === null && !error && <p className="text-muted-foreground">Loading…</p>}
        {accounts && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Account</TableHead>
                <TableHead>Roles</TableHead>
                <TableHead>Authenticator</TableHead>
                <TableHead className="text-right">
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {accounts.map(a => (
                <TableRow key={a.user_id}>
                  <TableCell className="break-all">{a.email ?? a.user_id}</TableCell>
                  <TableCell>{a.roles.join(', ')}</TableCell>
                  <TableCell>
                    {!a.known ? (
                      <span className="text-muted-foreground">Couldn't check</span>
                    ) : a.verified_factors > 0 ? (
                      <Badge variant="secondary">
                        {a.verified_factors === 1 ? 'Set up' : `${a.verified_factors} set up`}
                      </Badge>
                    ) : (
                      <span>None</span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {a.verified_factors > 0 && a.user_id !== user?.id && (
                      <Button variant="outline" size="sm" onClick={() => setResetting(a)}>
                        Reset
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>

      <AlertDialog open={resetting !== null} onOpenChange={open => { if (!open) setResetting(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset {resetting?.email ?? 'this account'}'s authenticator?</AlertDialogTitle>
            <AlertDialogDescription>
              Every authenticator on the account is removed. They sign in with their password and
              set up a new app straight away. Do this only once you've confirmed it is really them
              asking: by phone or in person, not by email alone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmReset}>Reset</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
