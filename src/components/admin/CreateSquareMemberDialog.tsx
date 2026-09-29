import { useEffect, useState } from 'react';
import { invokeFunction } from '@/lib/functions';
import { splitName } from '@/lib/squareTeam';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import { AlertTriangle } from 'lucide-react';

/** Somebody already in Square who might be the same person. */
export interface PossibleMatch {
  id: string;
  name: string;
  reason: string;
}

/**
 * Make a Square team member for an account that has none, and link it.
 *
 * The part that matters most is the sentence in the description: this makes
 * the Square *record* — enough for timecards and wages — and does not invite
 * anybody. Square sends its sign-in invitation only after someone assigns
 * permissions in Dashboard → Team. Until then the new member looks exactly
 * like a record created years ago and never used.
 */
export function CreateSquareMemberDialog({
  account,
  matches,
  onOpenChange,
  onCreated,
}: {
  /** The account to create for, or null when closed. */
  account: { id: string; email: string | null; display_name: string | null } | null;
  matches: PossibleMatch[];
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}) {
  const [given, setGiven] = useState('');
  const [family, setFamily] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!account) return;
    const { given, family } = splitName(account.display_name);
    setGiven(given);
    setFamily(family);
    setEmail(account.email ?? '');
    setPhone('');
  }, [account]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    setCreating(true);
    try {
      const res = await invokeFunction<{
        team_member: { id: string; given_name?: string; family_name?: string };
        linked: boolean;
        link_error: string | null;
      }>('square-labor', {
        action: 'create_team_member',
        user_id: account.id,
        given_name: given,
        family_name: family,
        email,
        phone,
      });
      const name = [res.team_member.given_name, res.team_member.family_name].filter(Boolean).join(' ');
      if (res.linked) {
        toast.success(`${name} created in Square and linked. Finish their invitation in Square Dashboard → Team.`);
      } else {
        toast.error(`${name} was created in Square but not linked (${res.link_error}). Pick them from the Square menu.`);
      }
      onOpenChange(false);
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the Square team member');
    } finally {
      setCreating(false);
    }
  }

  return (
    <Dialog open={!!account} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={create}>
          <DialogHeader>
            <DialogTitle className="font-display uppercase">Create in Square</DialogTitle>
            <DialogDescription className="font-serif">
              Creates their Square team-member record at the theatre and links it here, so their
              hours reach timecards and payroll. It does not invite them: to let them clock in
              or sign in to Square, finish the invitation in Square Dashboard → Team. Set their
              wage there too.
            </DialogDescription>
          </DialogHeader>

          {matches.length > 0 && (
            <div className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm flex gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p>Already in Square, and possibly the same person:</p>
                <ul className="list-disc pl-5">
                  {matches.map(m => <li key={m.id}>{m.name} <span className="text-muted-foreground">({m.reason})</span></li>)}
                </ul>
                <p>If so, cancel and pick them from the Square menu instead of making a second record.</p>
              </div>
            </div>
          )}

          <div className="space-y-4 py-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="sq-given">First name</Label>
                <Input id="sq-given" required value={given} onChange={e => setGiven(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="sq-family">Last name</Label>
                <Input id="sq-family" required value={family} onChange={e => setFamily(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="sq-email">Email <span className="text-muted-foreground font-normal">(optional — must not already be used in Square)</span></Label>
              <Input id="sq-email" type="email" value={email} onChange={e => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="sq-phone">Phone <span className="text-muted-foreground font-normal">(optional, with country code: +12085550100)</span></Label>
              <Input id="sq-phone" type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="+1…" />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={creating || !given.trim() || !family.trim()}>
              {creating ? 'Creating…' : 'Create in Square'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
