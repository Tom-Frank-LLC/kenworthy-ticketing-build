import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { PosterUpload } from '@/components/admin/PosterUpload';
import { CollapsibleSection } from './CollapsibleSection';
import { RoleControls } from './RoleControls';
import { InviteStaffDialog } from './InviteStaffDialog';
import { toast } from 'sonner';
import {
  UserPlus, Loader2, Link2, AlertTriangle, ArrowUp, ArrowDown, Save, X, Trash2, Unlink, ListOrdered,
  Image as ImageIcon,
} from 'lucide-react';
import { byStaffOrder, STAFF_BIO_COLUMNS, type StaffBio } from '@/lib/staffBios';
import { htmlToPlainText } from '@/lib/richText';
import { TEAM_ROLES, roleRank, type Role } from '@/lib/roleRules';

/**
 * The team, one card per account: roles, the Square Labor link, and the
 * public bio, all on the same line.
 *
 * Three tables meet here and they are deliberately not the same set of
 * people. `user_roles`/`profiles` is who can sign in; `staff_square_links` is
 * which Square team member each of them clocks in as; `staff_bios` is who the
 * public reads about on /about — editorial, and allowed to include someone
 * who never logs in. The card is the account, and the other two hang off it
 * by `user_id`. A bio with no account is not lost: it is listed below the
 * roster with a picker to attach it, and an unlinked Square member is named
 * so someone can tell that a login is missing.
 *
 * Only team roles appear — a past ticket buyer is not a team member. To make
 * one, Invite: `invite-staff` grants the role onto the account they already
 * have rather than creating a second one.
 */

interface SquareMember {
  id: string;
  given_name?: string;
  family_name?: string;
  email?: string;
  status?: string;
  wage?: { hourly_rate_cents?: number; title?: string } | null;
}

interface Member {
  id: string;
  email: string | null;
  display_name: string | null;
  roles: Role[];
}

/** A bio being edited, or one not yet saved. */
type Draft = {
  id: string | null;
  user_id: string | null;
  name: string;
  title: string;
  bio: string;
  headshot_url: string;
  is_active: boolean;
};

const squareName = (m: SquareMember) =>
  [m.given_name, m.family_name].filter(Boolean).join(' ') || m.email || m.id;

const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]!.toUpperCase()).join('') || '?';

export function TeamRoster() {
  const { user, isAdmin } = useAuth();
  const [loading, setLoading] = useState(true);
  const [members, setMembers] = useState<Member[]>([]);
  const [bios, setBios] = useState<StaffBio[]>([]);
  const [links, setLinks] = useState<Array<{ user_id: string; square_team_member_id: string }>>([]);
  const [square, setSquare] = useState<SquareMember[]>([]);
  const [squareError, setSquareError] = useState<string | null>(null);
  const [wagesError, setWagesError] = useState<string | null>(null);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    // Square is the one read that can fail on its own — a sandbox with no
    // team, a token that expired — and the roster is still useful without
    // it, so it is awaited separately and its failure is a banner, not a
    // blank tab.
    const [rolesRes, biosRes, linksRes, labor] = await Promise.all([
      supabase.from('user_roles').select('user_id, role').in('role', [...TEAM_ROLES]),
      supabase.from('staff_bios').select(STAFF_BIO_COLUMNS).order('sort_order').order('name'),
      supabase.from('staff_square_links').select('user_id, square_team_member_id'),
      supabase.functions.invoke('square-labor', { body: { action: 'list_team' } }),
    ]);
    if (rolesRes.error) toast.error(rolesRes.error.message);
    if (biosRes.error) toast.error(biosRes.error.message);
    if (linksRes.error) toast.error(linksRes.error.message);

    const roleMap = new Map<string, Role[]>();
    (rolesRes.data || []).forEach(r => {
      roleMap.set(r.user_id, [...(roleMap.get(r.user_id) || []), r.role as Role]);
    });
    const ids = [...roleMap.keys()];
    const { data: profiles } = ids.length
      ? await supabase.from('profiles').select('id, email, display_name').in('id', ids)
      : { data: [] };
    const combined: Member[] = (profiles || []).map(p => ({
      id: p.id, email: p.email, display_name: p.display_name, roles: roleMap.get(p.id) || [],
    }));
    combined.sort((a, b) =>
      roleRank(a.roles) - roleRank(b.roles)
      || (a.display_name || a.email || '').localeCompare(b.display_name || b.email || ''));
    setMembers(combined);
    setBios((biosRes.data as unknown as StaffBio[]) || []);
    setLinks(linksRes.data || []);

    if (labor.error) {
      setSquareError(labor.error.message || 'Could not read the Square team.');
      setSquare([]);
    } else {
      setSquareError(null);
      setSquare(labor.data?.team_members || []);
      setWagesError(labor.data?.wages_error ?? null);
    }
    setLoading(false);
  }, []);

  useEffect(() => { void load(); }, [load]);

  const bioFor = (userId: string) => bios.find(b => b.user_id === userId);
  const linkFor = (userId: string) => links.find(l => l.user_id === userId);
  const unlinkedBios = bios.filter(b => !b.user_id).sort(byStaffOrder);
  const unlinkedSquare = square.filter(m => !links.some(l => l.square_team_member_id === m.id));
  const published = bios.filter(b => b.display_on_about && b.is_active).sort(byStaffOrder);

  // --- Square link ---------------------------------------------------------

  async function setSquareLink(userId: string, memberId: string | null) {
    // Both columns are unique, so a link is moved by clearing whatever held
    // either end first. That is also why choosing a member already linked to
    // somebody else is allowed: it is how a wrong link gets corrected.
    const clear = supabase.from('staff_square_links').delete().eq('user_id', userId);
    if (memberId === null) {
      const { error } = await clear;
      if (error) { toast.error(error.message); return; }
    } else {
      const [{ error: e1 }, { error: e2 }] = await Promise.all([
        clear,
        supabase.from('staff_square_links').delete().eq('square_team_member_id', memberId),
      ]);
      if (e1 || e2) { toast.error((e1 || e2)!.message); return; }
      const { data, error } = await supabase
        .from('staff_square_links')
        .insert({ user_id: userId, square_team_member_id: memberId })
        .select('id');
      if (error) { toast.error(error.message); return; }
      if (!data?.length) { toast.error('Nothing was saved — linking is admin-only.'); return; }
    }
    toast.success(memberId ? 'Linked to Square' : 'Unlinked from Square');
    await load();
  }

  // --- Bio -----------------------------------------------------------------

  function startBio(member: Member | null, existing?: StaffBio) {
    setDraft(existing
      ? {
        id: existing.id,
        user_id: existing.user_id,
        name: existing.name,
        title: existing.title ?? '',
        bio: existing.bio ?? '',
        headshot_url: existing.headshot_url ?? '',
        is_active: existing.is_active,
      }
      : {
        id: null,
        user_id: member?.id ?? null,
        name: member?.display_name || member?.email || '',
        title: '',
        bio: '',
        headshot_url: '',
        is_active: true,
      });
  }

  async function saveDraft() {
    if (!draft) return;
    const name = draft.name.trim();
    if (!name) { toast.error('A bio needs a name.'); return; }
    const row = {
      name,
      title: draft.title.trim() || null,
      bio: draft.bio.trim() || null,
      headshot_url: draft.headshot_url.trim() || null,
      is_active: draft.is_active,
      user_id: draft.user_id,
    };
    setSaving(true);
    // .select() on every write: an RLS refusal comes back as a 204 with no
    // error, which otherwise reads as success and leaves a toast lying.
    const query = draft.id
      ? supabase.from('staff_bios').update(row).eq('id', draft.id).select('id')
      : supabase.from('staff_bios')
        // New bios land at the end of the About page order, not the top.
        .insert({ ...row, sort_order: Math.max(0, ...bios.map(b => b.sort_order)) + 1 })
        .select('id');
    const { data, error } = await query;
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was saved — you may not have permission.'); return; }
    toast.success(draft.id ? 'Bio updated' : 'Bio added — tick “Display on About Us” to publish it');
    setDraft(null);
    await load();
  }

  async function patchBio(b: StaffBio, patch: Partial<StaffBio>, done: string) {
    const { data, error } = await supabase.from('staff_bios').update(patch).eq('id', b.id).select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing changed — you may not have permission.'); return; }
    toast.success(done);
    await load();
  }

  async function removeBio(b: StaffBio) {
    if (!confirm(`Delete ${b.name}'s bio? Marking them former staff hides them and keeps the bio; deleting does not.`)) return;
    const { data, error } = await supabase.from('staff_bios').delete().eq('id', b.id).select('id');
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was deleted — deleting bios is admin-only.'); return; }
    toast.success('Bio deleted');
    setDraft(null);
    await load();
  }

  /**
   * Move a published bio one place in the About page order. Renumbers rather
   * than swapping: sort_order defaults to 0, so a fresh list is entirely ties
   * and a swap of two equal numbers is a no-op that looks like a dead button.
   */
  async function move(index: number, delta: number) {
    const target = index + delta;
    if (target < 0 || target >= published.length) return;
    const next = [...published];
    [next[index], next[target]] = [next[target], next[index]];
    const writes = next.map((b, i) => ({ b, i })).filter(({ b, i }) => b.sort_order !== i);
    if (!writes.length) return;
    setReordering(true);
    const results = await Promise.all(
      writes.map(({ b, i }) => supabase.from('staff_bios').update({ sort_order: i }).eq('id', b.id).select('id')),
    );
    setReordering(false);
    const failed = results.find(r => r.error || !r.data?.length);
    if (failed) toast.error(failed.error?.message || 'Could not reorder — you may not have permission.');
    await load();
  }

  // --- Render --------------------------------------------------------------

  if (loading) {
    return <div className="py-12 text-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin inline mr-2" />Loading team…</div>;
  }

  const editor = draft && (
    <Card className="glass border-primary/40">
      <CardContent className="p-4 space-y-3">
        <p className="font-display uppercase tracking-wider text-sm">
          {draft.id ? `Edit ${draft.name || 'bio'}` : 'New bio'}
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1">
            <Label htmlFor="bio-name">Name</Label>
            <Input id="bio-name" placeholder="As it should read on the page" value={draft.name} onChange={e => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="bio-title">Title (optional)</Label>
            <Input id="bio-title" placeholder="Executive Director" value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </div>
        </div>
        <div className="space-y-1">
          <Label htmlFor="bio-text">Bio (optional)</Label>
          <RichTextEditor id="bio-text" rows={5} placeholder="A paragraph or two, in their own voice if you have it." value={draft.bio} onChange={bio => setDraft({ ...draft, bio })} />
        </div>
        <PosterUpload
          currentUrl={draft.headshot_url}
          onUrlChange={url => setDraft(d => (d ? { ...d, headshot_url: url } : d))}
          folder="staff"
          label="Headshot (optional)"
          previewClassName="w-32 aspect-square"
          alt="Headshot preview"
        />
        <p className="font-serif text-xs text-muted-foreground">
          Headshots go in the same public image store as posters, so an uploaded photo is reachable by
          anyone who has its link even before the bio is published.
        </p>
        <label className="flex items-center gap-2 cursor-pointer w-fit">
          <Checkbox checked={draft.is_active} onCheckedChange={v => setDraft({ ...draft, is_active: v === true })} />
          <span className="text-sm">Current staff <span className="text-muted-foreground">— untick when someone leaves; it hides them from About and keeps the bio</span></span>
        </label>
        <div className="flex flex-wrap gap-2">
          <Button onClick={saveDraft} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save
          </Button>
          <Button variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            <X className="h-4 w-4 mr-1" /> Cancel
          </Button>
          {draft.id && draft.user_id && (
            <Button variant="ghost" onClick={() => setDraft({ ...draft, user_id: null })} disabled={saving}>
              <Unlink className="h-4 w-4 mr-1" /> Detach from account
            </Button>
          )}
          {draft.id && isAdmin && (
            <Button variant="ghost" className="ml-auto" onClick={() => removeBio(bios.find(b => b.id === draft.id)!)} disabled={saving}>
              <Trash2 className="h-4 w-4 mr-1 text-destructive" /> Delete bio
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );

  const bioSummary = (b: StaffBio) => (
    <div className="min-w-0 flex-1">
      <p className="text-sm">
        {b.title && <span>{b.title}</span>}
        {!b.is_active && <Badge variant="outline" className="ml-2">Former staff</Badge>}
      </p>
      {b.bio && <p className="text-xs text-muted-foreground font-serif line-clamp-2">{htmlToPlainText(b.bio)}</p>}
      <label className="flex items-center gap-2 mt-1 cursor-pointer w-fit">
        <Checkbox
          checked={b.display_on_about}
          onCheckedChange={() => patchBio(
            b,
            { display_on_about: !b.display_on_about },
            !b.display_on_about ? `${b.name} now appears on the About page` : `${b.name} removed from the About page`,
          )}
          aria-label={`Display ${b.name} on the About page`}
        />
        <span className="text-xs">
          Display on About Us
          {b.display_on_about && !b.is_active && <span className="text-muted-foreground"> — hidden while marked former staff</span>}
        </span>
      </label>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <p className="font-serif text-sm text-muted-foreground">
          {members.length} on the team · {published.length} on the About page
        </p>
        <Button className="ml-auto" onClick={() => setInviteOpen(true)}>
          <UserPlus className="h-4 w-4 mr-2" /> Invite staff member
        </Button>
      </div>
      <InviteStaffDialog open={inviteOpen} onOpenChange={setInviteOpen} onInvited={load} />

      {squareError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <span>Could not read the Square team, so Square linking is unavailable right now: {squareError}</span>
          </CardContent>
        </Card>
      )}
      {wagesError && (
        <Card className="border-destructive/40 bg-destructive/5">
          <CardContent className="py-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 text-destructive mt-0.5" />
            <span>Could not load wages from Square, so rates are blank: {wagesError}</span>
          </CardContent>
        </Card>
      )}

      <div className="space-y-2">
        {members.map(m => {
          const bio = bioFor(m.id);
          const link = linkFor(m.id);
          const sq = link ? square.find(s => s.id === link.square_team_member_id) : undefined;
          const name = m.display_name || bio?.name || m.email || m.id;
          const editingHere = draft && (draft.id ? draft.id === bio?.id : draft.user_id === m.id);
          return (
            <div key={m.id} className="space-y-2">
              <Card className="glass">
                <CardContent className="p-3 flex gap-3">
                  <Avatar className="h-14 w-14 shrink-0">
                    {bio?.headshot_url && <AvatarImage src={bio.headshot_url} alt="" className="object-cover" />}
                    <AvatarFallback className="font-display">{initials(name)}</AvatarFallback>
                  </Avatar>

                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium truncate">
                          {name}
                          {m.id === user?.id && <span className="ml-2 text-xs text-accent">(you)</span>}
                        </p>
                        <p className="text-xs font-serif text-muted-foreground truncate">{m.email || m.id}</p>
                      </div>
                      <RoleControls userId={m.id} roles={m.roles} onChanged={load} />
                    </div>

                    {/* Square Labor. Which team member this account clocks in
                        as — the join that puts their hours on the timecards
                        and payroll tabs. */}
                    <div className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="text-muted-foreground w-16 shrink-0 flex items-center gap-1"><Link2 className="h-3.5 w-3.5" /> Square</span>
                      {isAdmin ? (
                        <Select
                          value={link?.square_team_member_id || 'none'}
                          onValueChange={v => setSquareLink(m.id, v === 'none' ? null : v)}
                          disabled={!!squareError}
                        >
                          <SelectTrigger className="w-[260px] h-8" aria-label={`Square team member for ${name}`}>
                            <SelectValue placeholder="Not linked" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Not linked —</SelectItem>
                            {square.map(s => {
                              const holder = links.find(l => l.square_team_member_id === s.id);
                              const other = holder && holder.user_id !== m.id
                                ? members.find(x => x.id === holder.user_id)
                                : undefined;
                              return (
                                <SelectItem key={s.id} value={s.id}>
                                  {squareName(s)}
                                  {other ? ` (linked to ${other.display_name || other.email})` : ''}
                                </SelectItem>
                              );
                            })}
                          </SelectContent>
                        </Select>
                      ) : (
                        <span>{sq ? squareName(sq) : <span className="text-muted-foreground">Not linked</span>}</span>
                      )}
                      {sq && (
                        <span className="text-xs text-muted-foreground">
                          {sq.wage?.hourly_rate_cents ? `$${(sq.wage.hourly_rate_cents / 100).toFixed(2)}/hr` : 'no hourly rate in Square'}
                          {sq.status && sq.status !== 'ACTIVE' && ` · ${sq.status.toLowerCase()}`}
                        </span>
                      )}
                    </div>

                    {/* The public bio. One button whether or not a bio exists
                        yet — it opens the same form either way, and the summary
                        beside it is what says which. */}
                    <div className="flex flex-wrap items-start gap-3 text-sm">
                      <Button size="sm" variant="outline" className="h-8 shrink-0" onClick={() => startBio(m, bio)}>
                        <ImageIcon className="h-3.5 w-3.5 mr-1.5" /> Bio &amp; photo
                      </Button>
                      {bio && bioSummary(bio)}
                    </div>
                  </div>
                </CardContent>
              </Card>
              {editingHere && editor}
            </div>
          );
        })}
        {members.length === 0 && (
          <p className="text-center py-8 text-muted-foreground font-serif">Nobody holds a team role yet.</p>
        )}
      </div>

      {/* Bios that describe someone without a login — the Executive Director
          who never opens the box office, say. The About page is editorial, so
          these are as real as the ones above; they just have no account card
          to sit on. */}
      {unlinkedBios.length > 0 && (
        <CollapsibleSection
          id="labor.members.unlinked-bios"
          title="Bios without an account"
          count={unlinkedBios.length}
          description="On the About page, or drafted for it, but not tied to a login. Attach one to a team member, or edit it here."
          actions={({ open }) => (
            <Button size="sm" variant="outline" onClick={() => { open(); startBio(null); }}>
              <ImageIcon className="h-3.5 w-3.5 mr-1.5" /> Bio &amp; photo
            </Button>
          )}
        >
          <div className="space-y-2">
            {unlinkedBios.map(b => (
              <div key={b.id} className="space-y-2">
                <Card className="glass">
                  <CardContent className="p-3 flex flex-wrap gap-3">
                    <Avatar className="h-12 w-12 shrink-0">
                      {b.headshot_url && <AvatarImage src={b.headshot_url} alt="" className="object-cover" />}
                      <AvatarFallback className="font-display">{initials(b.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{b.name}</p>
                      {bioSummary(b)}
                    </div>
                    <div className="flex flex-col gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="h-8" onClick={() => startBio(null, b)}>
                        <ImageIcon className="h-3.5 w-3.5 mr-1.5" /> Bio &amp; photo
                      </Button>
                      {/* Attaching lives here, on the bio, rather than as a
                          second control on every account card. */}
                      {members.some(m => !bioFor(m.id)) && (
                        <Select onValueChange={id => patchBio(b, { user_id: id }, `Bio attached to ${members.find(m => m.id === id)?.display_name || 'the account'}`)}>
                          <SelectTrigger className="w-[220px] h-8" aria-label={`Attach ${b.name}'s bio to an account`}>
                            <SelectValue placeholder="Attach to a team member…" />
                          </SelectTrigger>
                          <SelectContent>
                            {members.filter(m => !bioFor(m.id)).map(m => (
                              <SelectItem key={m.id} value={m.id}>{m.display_name || m.email}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </div>
                  </CardContent>
                </Card>
                {draft?.id === b.id && editor}
              </div>
            ))}
            {draft && !draft.id && !draft.user_id && editor}
          </div>
        </CollapsibleSection>
      )}
      {draft && !draft.id && !draft.user_id && unlinkedBios.length === 0 && editor}

      {unlinkedSquare.length > 0 && (
        <p className="font-serif text-sm text-muted-foreground">
          In Square but not linked to an account here:{' '}
          {unlinkedSquare.map(squareName).join(', ')}. Pick them from a team member's Square menu
          above, or invite them if they have no login yet.
        </p>
      )}

      {/* The About page's own order, separate from the roster's role order. */}
      {published.length > 1 && (
        <CollapsibleSection
          id="labor.members.about-order"
          title="About page order"
          icon={ListOrdered}
          count={published.length}
          description="The order the Kenworthy Staff section reads in, top to bottom."
        >
          <ol className="space-y-1">
            {published.map((b, index) => (
              <li key={b.id} className="flex items-center gap-2">
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(index, -1)} disabled={index === 0 || reordering} aria-label={`Move ${b.name} earlier`}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => move(index, 1)} disabled={index === published.length - 1 || reordering} aria-label={`Move ${b.name} later`}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <span>{b.name}</span>
                {b.title && <span className="text-xs text-muted-foreground">{b.title}</span>}
              </li>
            ))}
          </ol>
        </CollapsibleSection>
      )}
    </div>
  );
}

export default TeamRoster;
