import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from 'sonner';
import { Plus, Trash2, Save, RotateCcw, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

// Layout constants — match SeatMap.tsx (Kenworthy auditorium banks)
const LEFT_COLS = [1, 2, 3, 4, 5, 6, 7];
const CENTER_COLS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const RIGHT_COLS = [20, 21, 22, 23, 24, 25, 26];
const ROW_ORDER = ['M', 'L', 'K', 'J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];

const PALETTE = ['#C8377A', '#D7A85C', '#5C8FD7', '#7AB87A', '#B07AD7', '#D77A7A', '#6B7280'];

interface TierRow {
  id?: string;            // server id once persisted
  localId: string;        // stable local key used by the seat map (uuid or temp)
  tier_name: string;
  price: string;
  color: string;
  display_order: number;
}

interface VenueSeat {
  id: string;
  seat_row: string;
  seat_number: number;
  section: string | null;
}

type Mode = 'production' | 'showing';

interface SeatTierEditorProps {
  mode: Mode;
  productionType?: 'movie' | 'event' | 'concert';
  productionId?: string;
  showingId?: string;
  venueId?: string | null;
  // For showing mode: defaults to seed from this production when no overrides exist
  seedFromProduction?: { type: 'movie' | 'event' | 'concert'; id: string };
}

function tempId() {
  return 'tmp-' + Math.random().toString(36).slice(2, 10);
}

export function SeatTierEditor({
  mode,
  productionType,
  productionId,
  showingId,
  venueId,
  seedFromProduction,
}: SeatTierEditorProps) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [seats, setSeats] = useState<VenueSeat[]>([]);
  const [tiers, setTiers] = useState<TierRow[]>([]);
  const [seatMap, setSeatMap] = useState<Record<string, string>>({}); // venue_seat_id -> tier localId
  const [activeTier, setActiveTier] = useState<string | null>(null);
  const [resolvedVenueId, setResolvedVenueId] = useState<string | null>(venueId || null);

  // Resolve venue: explicit > the default assigned-seat venue
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (venueId) { setResolvedVenueId(venueId); return; }
      const { data } = await supabase
        .from('venues')
        .select('id')
        .eq('has_assigned_seating', true)
        .eq('is_active', true)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      if (!cancelled) setResolvedVenueId(data?.id ?? null);
    })();
    return () => { cancelled = true; };
  }, [venueId]);

  // Load seats + tiers + mapping
  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      if (!resolvedVenueId) { setLoading(false); return; }

      const seatRes = await supabase
        .from('venue_seats')
        .select('id, seat_row, seat_number, section')
        .eq('venue_id', resolvedVenueId);
      if (cancelled) return;
      const venueSeats = (seatRes.data ?? []) as VenueSeat[];
      setSeats(venueSeats);

      if (mode === 'production' && productionType && productionId) {
        const [tierRes, mapRes] = await Promise.all([
          supabase.from('production_price_tiers')
            .select('*').eq('production_type', productionType).eq('production_id', productionId)
            .order('display_order'),
          supabase.from('production_seat_tiers')
            .select('venue_seat_id, tier_template_id')
            .eq('production_type', productionType).eq('production_id', productionId),
        ]);
        const tierRows: TierRow[] = (tierRes.data ?? []).map((t: any) => ({
          id: t.id, localId: t.id, tier_name: t.tier_name, price: String(t.price),
          color: t.color || PALETTE[0], display_order: t.display_order,
        }));
        const map: Record<string, string> = {};
        for (const row of mapRes.data ?? []) map[(row as any).venue_seat_id] = (row as any).tier_template_id;
        if (!cancelled) {
          setTiers(tierRows);
          setSeatMap(map);
          setActiveTier(tierRows[0]?.localId ?? null);
          setLoading(false);
        }
      } else if (mode === 'showing' && showingId) {
        // Load showing tiers + seat overrides; if none and we have a production, seed from it.
        let tierRes = await supabase.from('showing_price_tiers')
          .select('*').eq('showing_id', showingId).order('display_order');
        let mapRes = await supabase.from('showing_seat_tiers')
          .select('venue_seat_id, tier_id').eq('showing_id', showingId);

        if ((tierRes.data ?? []).length === 0 && seedFromProduction) {
          const [ptRes, psRes] = await Promise.all([
            supabase.from('production_price_tiers')
              .select('*').eq('production_type', seedFromProduction.type).eq('production_id', seedFromProduction.id)
              .order('display_order'),
            supabase.from('production_seat_tiers')
              .select('venue_seat_id, tier_template_id')
              .eq('production_type', seedFromProduction.type).eq('production_id', seedFromProduction.id),
          ]);
          const seedTiers: TierRow[] = (ptRes.data ?? []).map((t: any) => ({
            localId: tempId(), tier_name: t.tier_name, price: String(t.price),
            color: t.color || PALETTE[0], display_order: t.display_order,
          }));
          // remap seat → template id → new localId
          const templateToLocal: Record<string, string> = {};
          (ptRes.data ?? []).forEach((t: any, i: number) => { templateToLocal[t.id] = seedTiers[i].localId; });
          const map: Record<string, string> = {};
          for (const row of psRes.data ?? []) {
            const tplId = (row as any).tier_template_id;
            if (templateToLocal[tplId]) map[(row as any).venue_seat_id] = templateToLocal[tplId];
          }
          if (!cancelled) {
            setTiers(seedTiers);
            setSeatMap(map);
            setActiveTier(seedTiers[0]?.localId ?? null);
            setLoading(false);
          }
          return;
        }

        const tierRows: TierRow[] = (tierRes.data ?? []).map((t: any) => ({
          id: t.id, localId: t.id, tier_name: t.tier_name, price: String(t.price),
          color: t.color || PALETTE[0], display_order: t.display_order,
        }));
        const map: Record<string, string> = {};
        for (const row of mapRes.data ?? []) map[(row as any).venue_seat_id] = (row as any).tier_id;
        if (!cancelled) {
          setTiers(tierRows);
          setSeatMap(map);
          setActiveTier(tierRows[0]?.localId ?? null);
          setLoading(false);
        }
      } else {
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [mode, productionType, productionId, showingId, resolvedVenueId, seedFromProduction]);

  // Build a lookup by row|section|number for grid rendering
  const seatLookup = useMemo(() => {
    const m = new Map<string, VenueSeat>();
    for (const s of seats) {
      const sec = (s.section || 'center').toLowerCase();
      m.set(`${s.seat_row}|${sec}|${s.seat_number}`, s);
    }
    return m;
  }, [seats]);

  const rowsWithAny = useMemo(() => ROW_ORDER.filter(row =>
    [...LEFT_COLS, ...CENTER_COLS, ...RIGHT_COLS].some(col =>
      seatLookup.has(`${row}|left|${col}`) ||
      seatLookup.has(`${row}|center|${col}`) ||
      seatLookup.has(`${row}|right|${col}`),
    ),
  ), [seatLookup]);

  const tierByLocal = useMemo(() => {
    const m: Record<string, TierRow> = {};
    for (const t of tiers) m[t.localId] = t;
    return m;
  }, [tiers]);

  const tierCounts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const tid of Object.values(seatMap)) c[tid] = (c[tid] || 0) + 1;
    return c;
  }, [seatMap]);

  const unassignedCount = seats.length - Object.keys(seatMap).length;

  function addTier() {
    const idx = tiers.length;
    const localId = tempId();
    setTiers(prev => [...prev, {
      localId, tier_name: '', price: '8.00',
      color: PALETTE[idx % PALETTE.length], display_order: idx,
    }]);
    if (!activeTier) setActiveTier(localId);
  }

  function removeTier(localId: string) {
    setTiers(prev => prev.filter(t => t.localId !== localId));
    setSeatMap(prev => {
      const next: Record<string, string> = {};
      for (const [seatId, tid] of Object.entries(prev)) if (tid !== localId) next[seatId] = tid;
      return next;
    });
    if (activeTier === localId) setActiveTier(null);
  }

  function updateTier(localId: string, patch: Partial<TierRow>) {
    setTiers(prev => prev.map(t => t.localId === localId ? { ...t, ...patch } : t));
  }

  function paintSeat(seatId: string) {
    if (!activeTier) return;
    setSeatMap(prev => ({ ...prev, [seatId]: activeTier }));
  }

  function clearSeat(seatId: string) {
    setSeatMap(prev => {
      const next = { ...prev };
      delete next[seatId];
      return next;
    });
  }

  function paintRow(row: string) {
    if (!activeTier) return;
    setSeatMap(prev => {
      const next = { ...prev };
      for (const s of seats) if (s.seat_row === row) next[s.id] = activeTier;
      return next;
    });
  }

  function clearAll() {
    if (!confirm('Clear all seat assignments?')) return;
    setSeatMap({});
  }

  async function save() {
    if (tiers.some(t => !t.tier_name.trim())) {
      toast.error('Every tier needs a name.');
      return;
    }
    setSaving(true);
    try {
      if (mode === 'production' && productionType && productionId) {
        // Replace all production tiers + mappings transactionally-ish
        await supabase.from('production_seat_tiers')
          .delete().eq('production_type', productionType).eq('production_id', productionId);
        await supabase.from('production_price_tiers')
          .delete().eq('production_type', productionType).eq('production_id', productionId);

        const inserts = tiers.map((t, i) => ({
          production_type: productionType, production_id: productionId,
          tier_name: t.tier_name.trim(), price: parseFloat(t.price),
          color: t.color, display_order: i,
        }));
        if (inserts.length === 0) { toast.success('Seat pricing cleared.'); setSaving(false); return; }
        const { data: insertedTiers, error: tierErr } = await supabase
          .from('production_price_tiers').insert(inserts).select('id, display_order');
        if (tierErr) throw tierErr;

        // Map old localId → new server id by display_order
        const orderToServer: Record<number, string> = {};
        for (const r of insertedTiers || []) orderToServer[(r as any).display_order] = (r as any).id;
        const localToServer: Record<string, string> = {};
        tiers.forEach((t, i) => { localToServer[t.localId] = orderToServer[i]; });

        const mapRows = Object.entries(seatMap)
          .filter(([, tid]) => !!localToServer[tid])
          .map(([seatId, tid]) => ({
            production_type: productionType, production_id: productionId,
            venue_seat_id: seatId, tier_template_id: localToServer[tid],
          }));
        if (mapRows.length > 0) {
          const { error: mapErr } = await supabase.from('production_seat_tiers').insert(mapRows);
          if (mapErr) throw mapErr;
        }
        toast.success('Seat pricing saved.');
      } else if (mode === 'showing' && showingId) {
        await supabase.from('showing_seat_tiers').delete().eq('showing_id', showingId);
        await supabase.from('showing_price_tiers').delete().eq('showing_id', showingId);

        const inserts = tiers.map((t, i) => ({
          showing_id: showingId, tier_name: t.tier_name.trim(),
          price: parseFloat(t.price), color: t.color, display_order: i, is_active: true,
        }));
        if (inserts.length === 0) { toast.success('Seat pricing cleared for this showing.'); setSaving(false); return; }
        const { data: insertedTiers, error: tierErr } = await supabase
          .from('showing_price_tiers').insert(inserts).select('id, display_order');
        if (tierErr) throw tierErr;
        const orderToServer: Record<number, string> = {};
        for (const r of insertedTiers || []) orderToServer[(r as any).display_order] = (r as any).id;
        const localToServer: Record<string, string> = {};
        tiers.forEach((t, i) => { localToServer[t.localId] = orderToServer[i]; });

        const mapRows = Object.entries(seatMap)
          .filter(([, tid]) => !!localToServer[tid])
          .map(([seatId, tid]) => ({
            showing_id: showingId, venue_seat_id: seatId, tier_id: localToServer[tid],
          }));
        if (mapRows.length > 0) {
          const { error: mapErr } = await supabase.from('showing_seat_tiers').insert(mapRows);
          if (mapErr) throw mapErr;
        }
        toast.success('Showing seat pricing saved.');
      }
    } catch (err: any) {
      toast.error(err?.message || 'Could not save seat pricing.');
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="text-sm text-muted-foreground py-4">Loading seat map…</p>;
  }
  if (!resolvedVenueId || seats.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-4">
        No assigned-seating venue is configured yet, so there are no seats to group. Add a venue with assigned seating first.
      </p>
    );
  }

  const renderCell = (row: string, section: 'left' | 'center' | 'right', col: number) => {
    const seat = seatLookup.get(`${row}|${section}|${col}`);
    if (!seat) {
      return <div key={`sp-${row}-${section}-${col}`} className="h-6 w-6 shrink-0" aria-hidden />;
    }
    const tid = seatMap[seat.id];
    const tier = tid ? tierByLocal[tid] : undefined;
    const bg = tier?.color || 'transparent';
    return (
      <button
        key={seat.id}
        type="button"
        onClick={() => paintSeat(seat.id)}
        onContextMenu={(e) => { e.preventDefault(); clearSeat(seat.id); }}
        className={cn(
          'h-6 w-6 shrink-0 rounded-t text-[9px] font-medium border transition-colors',
          tier ? 'border-transparent text-white' : 'border-border bg-secondary text-foreground hover:bg-primary/20',
        )}
        style={tier ? { backgroundColor: bg } : undefined}
        title={`Row ${seat.seat_row} · Seat ${seat.seat_number}${tier ? ` · ${tier.tier_name}` : ''}`}
      >
        {seat.seat_number}
      </button>
    );
  };

  return (
    <div className="space-y-4">
      {/* Tier list */}
      <div className="space-y-2">
        {tiers.map((t) => {
          const isActive = activeTier === t.localId;
          return (
            <div key={t.localId}
              className={cn(
                'flex items-center gap-2 rounded-md border p-2 transition-colors',
                isActive ? 'border-primary bg-primary/5' : 'border-border',
              )}
            >
              <button
                type="button"
                onClick={() => setActiveTier(t.localId)}
                className="flex items-center gap-2 shrink-0"
                title="Use this tier for painting"
              >
                <span className="h-6 w-6 rounded border border-border" style={{ backgroundColor: t.color }} />
                {isActive && <Check className="h-3 w-3 text-primary -ml-1" />}
              </button>
              <Input
                value={t.tier_name}
                onChange={e => updateTier(t.localId, { tier_name: e.target.value })}
                placeholder="Tier name"
                className="flex-1 h-8"
              />
              <div className="relative w-24">
                <span className="absolute left-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground">$</span>
                <Input
                  type="number" step="0.01"
                  value={t.price}
                  onChange={e => updateTier(t.localId, { price: e.target.value })}
                  className="pl-5 h-8"
                />
              </div>
              <Input
                type="color"
                value={t.color}
                onChange={e => updateTier(t.localId, { color: e.target.value })}
                className="h-8 w-10 p-1 cursor-pointer"
                title="Swatch color"
              />
              <span className="text-xs text-muted-foreground w-12 text-right tabular-nums">
                {tierCounts[t.localId] || 0}
              </span>
              <Button type="button" variant="ghost" size="icon" className="h-8 w-8 shrink-0"
                onClick={() => removeTier(t.localId)}>
                <Trash2 className="h-3.5 w-3.5 text-destructive" />
              </Button>
            </div>
          );
        })}
        <Button type="button" variant="outline" size="sm" onClick={addTier} className="w-full">
          <Plus className="h-3.5 w-3.5 mr-1" /> Add tier
        </Button>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span>
          Click a seat to paint it with the active tier. Right-click a seat to clear it.
          Click a row label to paint the whole row. {unassignedCount} unassigned.
        </span>
        <Button type="button" variant="ghost" size="sm" onClick={clearAll}>
          <RotateCcw className="h-3.5 w-3.5 mr-1" /> Clear all
        </Button>
      </div>

      {/* Seat grid */}
      <div className="overflow-x-auto rounded-md border border-border bg-background/40 p-3">
        <div className="mx-auto w-fit space-y-1 py-1">
          {rowsWithAny.map(row => (
            <div key={row} className="flex items-center gap-2">
              <div className="flex items-center gap-0.5">
                {LEFT_COLS.map(col => renderCell(row, 'left', col))}
              </div>
              <button type="button" onClick={() => paintRow(row)}
                className="w-5 text-xs font-display tracking-wider text-muted-foreground hover:text-primary text-center"
                title={`Paint row ${row}`}>{row}</button>
              <div className="flex items-center gap-0.5">
                {CENTER_COLS.map(col => renderCell(row, 'center', col))}
              </div>
              <button type="button" onClick={() => paintRow(row)}
                className="w-5 text-xs font-display tracking-wider text-muted-foreground hover:text-primary text-center"
                title={`Paint row ${row}`}>{row}</button>
              <div className="flex items-center gap-0.5">
                {RIGHT_COLS.map(col => renderCell(row, 'right', col))}
              </div>
            </div>
          ))}
          <div className="pt-4 flex flex-col items-center">
            <div className="w-2/3 rounded-t-[2rem] border border-foreground/30 bg-foreground/5 px-8 py-1.5 text-center">
              <p className="font-display uppercase tracking-[0.3em] text-foreground/60 text-xs">Stage</p>
            </div>
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button type="button" onClick={save} disabled={saving}>
          <Save className="h-3.5 w-3.5 mr-1" />
          {saving ? 'Saving…' : mode === 'production' ? 'Save seat pricing' : 'Save showing override'}
        </Button>
      </div>
    </div>
  );
}