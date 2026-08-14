/**
 * Tagging a festival's whole run at once.
 *
 * The showing form sets eligibility one screening at a time, which is right for
 * the ordinary case and useless for the case this feature exists to serve: a
 * festival is a fortnight of screenings, and twenty trips through a form is how
 * a feature ends up unused and the festival pass ends up hand-waved at the door.
 *
 * Why this lives under Film Passes rather than in the schedule list. The
 * schedule is organised by production — a Movies tab, a Live Events tab — and a
 * festival crosses all of them: a film on Tuesday, a gala on Wednesday, a
 * performance on Friday. Selecting across three tabs is not one gesture. Here
 * the question is asked the way the work is actually done: pick the pass, then
 * tick the screenings it covers, from one flat list of everything scheduled.
 *
 * Scoped to a single pass type on purpose. Every write only adds or removes
 * rows for the chosen pass, so tagging a festival can never disturb which
 * screenings the standard pass covers — the failure that a "set eligibility for
 * these showings" bulk action would invite.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { CalendarRange, Loader2, Search, Ticket } from 'lucide-react';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { formatShowtime } from '@/lib/datetime';
import { setBulkEligibility, type PassTypeOption } from '@/lib/passEligibility';

/** One showing as the schedule select returns it, embeds included. */
interface ScheduleRow {
  id: string;
  start_time: string;
  ticket_price: number | string | null;
  movies: { title: string } | null;
  events: { title: string } | null;
  live_performances: { title: string } | null;
}

interface ScheduledShowing {
  id: string;
  start_time: string;
  ticket_price: number;
  title: string;
  kind: 'Film' | 'Event' | 'Performance';
}

/** Where the window starts by default — yesterday, so tonight is never off the top. */
function defaultFrom(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

function defaultTo(): string {
  const d = new Date();
  d.setDate(d.getDate() + 90);
  return d.toISOString().slice(0, 10);
}

export function PassEligibilityPanel({ passTypes }: { passTypes: PassTypeOption[] }) {
  const [passTypeId, setPassTypeId] = useState('');
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [search, setSearch] = useState('');

  const [showings, setShowings] = useState<ScheduledShowing[]>([]);
  const [taggedIds, setTaggedIds] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!passTypeId && passTypes.length > 0) setPassTypeId(passTypes[0].id);
  }, [passTypes, passTypeId]);

  const load = useCallback(async () => {
    if (!passTypeId) return;
    setLoading(true);
    setError(null);

    // Paged: the theatre has ~1,800 screenings on file and PostgREST truncates
    // at 1,000 with no error, so an unpaged read would silently hide the tail
    // of a long window — as "that screening isn't in the list", which reads
    // like the screening does not exist.
    const [showingsRes, taggedRes] = await Promise.all([
      fetchAllRows<ScheduleRow>((lo, hi) =>
        supabase
          .from('showings')
          .select(
            'id, start_time, ticket_price, movies(title), events(title), live_performances(title)',
          )
          .gte('start_time', `${from}T00:00:00Z`)
          .lte('start_time', `${to}T23:59:59Z`)
          .order('start_time')
          .order('id')
          .range(lo, hi),
      ),
      // Paged for the same reason as the schedule above, and not hypothetically:
      // the 10-film pass is already tagged to 1,108 screenings, so an unpaged
      // read dropped 108 of them and the panel drew screenings that do accept
      // the pass as "Not accepted". (Applying only ever writes the rows an
      // admin explicitly selected, so the truncation misreported the state
      // without ever untagging anything.)
      fetchAllRows<{ showing_id: string }>((lo, hi) =>
        supabase
          .from('pass_type_showings')
          .select('showing_id')
          .eq('pass_type_id', passTypeId)
          .order('showing_id')
          .range(lo, hi),
      ),
    ]);

    if (showingsRes.error || taggedRes.error) {
      setError(
        showingsRes.error?.message ?? taggedRes.error?.message ?? 'Could not load the schedule',
      );
      setLoading(false);
      return;
    }

    setShowings(
      showingsRes.data.map(s => ({
        id: s.id,
        start_time: s.start_time,
        ticket_price: Number(s.ticket_price ?? 0),
        title: s.movies?.title || s.events?.title || s.live_performances?.title || 'Untitled',
        kind: s.movies ? 'Film' : s.events ? 'Event' : 'Performance',
      })),
    );
    setTaggedIds(new Set((taggedRes.data ?? []).map(r => r.showing_id)));
    setSelected(new Set());
    setLoading(false);
  }, [passTypeId, from, to]);

  useEffect(() => { load(); }, [load]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? showings.filter(s => s.title.toLowerCase().includes(q)) : showings;
  }, [showings, search]);

  const toggle = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // Acts on what is on screen, not on everything loaded. Ticking "all" after
  // filtering to "Festival" must not quietly select the other eighty
  // screenings the filter is hiding.
  const selectAllVisible = () => setSelected(new Set(visible.map(s => s.id)));

  const apply = async (eligible: boolean) => {
    if (!passTypeId || selected.size === 0) return;
    setSaving(true);
    try {
      const ids = [...selected];
      const changed = await setBulkEligibility(passTypeId, ids, eligible);
      const passName = passTypes.find(p => p.id === passTypeId)?.name ?? 'that pass';

      // The count is the interesting half: re-tagging screenings that were
      // already tagged is normal when extending a run, and "12 selected, 3
      // changed" is the difference between "it worked" and "I clicked the
      // wrong thing".
      toast.success(
        eligible
          ? `${changed} of ${ids.length} screening${ids.length === 1 ? '' : 's'} now accept ${passName}${
              changed < ids.length ? ' — the rest already did' : ''
            }`
          : `${changed} screening${changed === 1 ? '' : 's'} no longer accept ${passName}`,
      );
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not update pass eligibility');
    } finally {
      setSaving(false);
    }
  };

  const selectedType = passTypes.find(p => p.id === passTypeId);
  const taggedCount = showings.filter(s => taggedIds.has(s.id)).length;

  return (
    <Card className="glass">
      <CardContent className="p-4 space-y-4">
        <div>
          <h2 className="font-display text-xl font-bold flex items-center gap-2">
            <CalendarRange className="h-5 w-5 text-primary" /> Which screenings take a pass
          </h2>
          <p className="text-sm text-muted-foreground mt-1">
            A pass works at a screening only if it is tagged here or on the showing itself. Pick a
            pass, then tick its screenings — this is how a festival pass gets its whole run in one
            go, and it never touches which screenings the other passes cover.
          </p>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="space-y-2">
            <Label>Pass</Label>
            <Select value={passTypeId} onValueChange={v => { if (v) setPassTypeId(v); }}>
              <SelectTrigger><SelectValue placeholder="Choose a pass…" /></SelectTrigger>
              <SelectContent>
                {passTypes.map(pt => (
                  <SelectItem key={pt.id} value={pt.id}>
                    {pt.name}{pt.is_active ? '' : ' — no longer sold'}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="elig-from">From</Label>
            <Input id="elig-from" type="date" value={from} onChange={e => setFrom(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="elig-to">To</Label>
            <Input id="elig-to" type="date" value={to} onChange={e => setTo(e.target.value)} />
          </div>
          <div className="space-y-2">
            <Label htmlFor="elig-search">Title</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="elig-search"
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Filter by title…"
                className="pl-8"
              />
            </div>
          </div>
        </div>

        {selectedType && (
          <p className="text-xs text-muted-foreground">
            <Ticket className="h-3.5 w-3.5 inline mr-1" />
            {selectedType.name} · ${selectedType.redemption_price.toFixed(2)} per admission ·{' '}
            {selectedType.per_showing_use_limit === null
              ? 'unlimited admissions per screening'
              : `up to ${selectedType.per_showing_use_limit} per screening`}
            {' · '}
            {taggedCount} of {showings.length} screenings in this window tagged
          </p>
        )}

        {error ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Could not load the schedule — {error}</p>
            <Button size="sm" variant="outline" onClick={load}>Retry</Button>
          </div>
        ) : loading ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading the schedule…
          </p>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={selectAllVisible} disabled={visible.length === 0}>
                Select all {visible.length}
              </Button>
              <Button size="sm" variant="outline" onClick={() => setSelected(new Set())} disabled={selected.size === 0}>
                Clear
              </Button>
              <span className="text-sm text-muted-foreground">{selected.size} selected</span>
              <div className="ml-auto flex gap-2">
                <Button size="sm" onClick={() => apply(true)} disabled={saving || selected.size === 0}>
                  {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null} Accept this pass
                </Button>
                <Button size="sm" variant="outline" onClick={() => apply(false)} disabled={saving || selected.size === 0}>
                  Stop accepting
                </Button>
              </div>
            </div>

            <div className="max-h-[28rem] overflow-y-auto space-y-1 rounded-md border border-border p-2">
              {visible.map(s => {
                const tagged = taggedIds.has(s.id);
                return (
                  <label
                    key={s.id}
                    className="flex items-center gap-3 rounded-md px-2 py-1.5 text-sm cursor-pointer hover:bg-secondary/50"
                  >
                    <input
                      type="checkbox"
                      checked={selected.has(s.id)}
                      onChange={() => toggle(s.id)}
                      className="rounded shrink-0"
                    />
                    <span className="w-40 shrink-0 text-muted-foreground tabular-nums">
                      {formatShowtime(s.start_time, 'EEE MMM d, h:mm a')}
                    </span>
                    <span className="min-w-0 flex-1 truncate">{s.title}</span>
                    <Badge variant="outline" className="text-xs shrink-0">{s.kind}</Badge>
                    <span className="text-xs text-muted-foreground shrink-0 w-14 text-right tabular-nums">
                      ${s.ticket_price.toFixed(2)}
                    </span>
                    <Badge
                      variant={tagged ? 'default' : 'secondary'}
                      className="text-xs shrink-0 w-24 justify-center"
                    >
                      {tagged ? 'Accepted' : 'Not accepted'}
                    </Badge>
                  </label>
                );
              })}
              {visible.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  Nothing scheduled in this window.
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
