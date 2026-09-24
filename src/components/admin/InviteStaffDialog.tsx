import { useState } from 'react';
import { useAuth } from '@/lib/auth';
import { invokeFunction } from '@/lib/functions';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { INVITABLE_ROLES, ADMIN_INVITABLE_ROLES, type InvitableRole } from '@/lib/roleRules';

/**
 * The invite form, shared by /superadmin and the Team Members roster. Which
 * roles it offers follows the caller's own role, the same as `invite-staff`
 * decides server-side.
 */
export function InviteStaffDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: () => void;
}) {
  const { isSuperadmin } = useAuth();
  const invitable: readonly InvitableRole[] = isSuperadmin ? INVITABLE_ROLES : ADMIN_INVITABLE_ROLES;

  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<InvitableRole>('staff');
  const [inviting, setInviting] = useState(false);

  async function invite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    try {
      const res = await invokeFunction<{ created: boolean; email: string; role: string }>(
        'invite-staff',
        { email, display_name: name, role },
      );
      toast.success(
        res.created
          ? `Invited ${res.email} as ${res.role} — they'll get an email to set a password.`
          : `${res.email} already had an account — granted ${res.role}.`,
      );
      onOpenChange(false);
      setEmail('');
      setName('');
      setRole('staff');
      onInvited();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not send that invitation');
    } finally {
      setInviting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={invite}>
          <DialogHeader>
            <DialogTitle className="font-display uppercase">Invite staff member</DialogTitle>
            <DialogDescription className="font-serif">
              Creates their account and assigns the role. They receive an email with a link to
              set a password, then sign in at /auth. If they already have an account — a past
              ticket buyer, say — the role is added to it rather than making a second one.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                required
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="name@example.com"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-name">Display name <span className="text-muted-foreground font-normal">(optional)</span></Label>
              <Input
                id="invite-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Jane Doe"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="invite-role">Role</Label>
              <Select value={role} onValueChange={v => setRole(v as InvitableRole)}>
                <SelectTrigger id="invite-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {invitable.map(r => (
                    <SelectItem key={r} value={r}>{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={inviting || !email.trim()}>
              {inviting ? 'Sending…' : 'Send invitation'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
