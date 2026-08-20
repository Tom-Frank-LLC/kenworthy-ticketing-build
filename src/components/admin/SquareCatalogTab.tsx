import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Link2, AlertTriangle, Plus } from 'lucide-react';

/**
 * Square catalog mapping, for a human.
 *
 * Everything here already existed as an edge function and could only be reached
 * by hand-crafting an authenticated POST, which is not a workflow a box office
 * can run. This is the same engine with a front door.
 *
 * The one thing it deliberately does NOT do is decide which Square item a film
 * is. The first run against the live catalog reported ten productions as needing
 * a new item and five already existed under a bare title — creating those would
 * have split each film's revenue across two items. So candidates are shown and a
 * person confirms.
 */

type PassRow = {
  pass_type_id: string;
  name: string;
  price_cents: number;
  status: 'linked' | 'match_found' | 'needs_item';
  square_variation_id: string | null;
  square_item_name: string | null;
  variations: Array<{
    id: string;
    name: string | null;
    price_cents: number | null;
    item_id?: string;
    item_name?: string | null;
    archived?: boolean;
  }>;
  /** Distinct Square items carrying this name. Above 1 means duplicate SKUs. */
  matching_items?: number;
  /** Everything filed under 9 Film Passes that the name did not already match. */
  category_options?: Array<{
    id: string;
    name: string | null;
    price_cents: number | null;
    item_id?: string;
    item_name?: string | null;
    archived?: boolean;
  }>;
  possible_matches?: Array<{ id: string; name: string; why: string }>;
};

type Plan = {
  showings: number;
  catalog_items: number;
  counts: Record<string, number>;
  needs_dashboard_item: Array<{
    production_id: string;
    kind: 'movie' | 'event' | 'live_performance';
    title: string;
    category: string;
    showings: number;
    possible_matches?: Array<{ id: string; name: string; why: string }>;
  }>;
  adoptable?: Array<{ variation_name: string; production_title: string }>;
  appendable?: Array<{ variation_name: string; production_title: string; price_cents: number }>;
  price_drift?: Array<{ variation_name: string; production_title: string; reason?: string }>;
};

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

interface SquareCatalogTabProps {
  /**
   * Passes now have their own panel on the Passes tab, so this screen suppresses
   * its pass section when mounted beside it. What is left is the showtime work —
   * variations to append, prices that disagree with Square — which has no other
   * home yet.
   */
  showPasses?: boolean;
}

export default function SquareCatalogTab({ showPasses = true }: SquareCatalogTabProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [passes, setPasses] = useState<PassRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('square-showing-variations', { body });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [p, fp] = await Promise.all([
        call({ action: 'plan', horizon_days: 120 }),
        call({ action: 'plan_film_passes' }),
      ]);
      setPlan(p);
      setPasses(fp.pass_types ?? []);
    } catch (e: any) {
      toast.error(e.message || 'Could not read the Square catalog');
    } finally {
      setLoading(false);
    }
  }, [call]);

  useEffect(() => { load(); }, [load]);

  /** Record variations Square already has. Database only — no catalog write. */
  const adopt = async () => {
    setBusy('adopt');
    try {
      const r = await call({ action: 'apply', dry_run: false, confirm: 'WRITE', max_batch: 0 });
      toast.success(`Recorded ${r.adopted} showtime(s) Square already had.`);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Could not record them');
    } finally { setBusy(null); }
  };

  /**
   * Write new variations. Serial and capped inside the function — Square locks
   * the catalog during an upsert, so a big batch is re-run rather than hammered.
   */
  const append = async (count: number) => {
    setBusy('append');
    try {
      const r = await call({ action: 'apply', dry_run: false, confirm: 'WRITE', max_batch: count });
      const wrote = r.tally?.written ?? 0;
      const bad = (r.tally?.accepted_but_not_stored ?? 0) + (r.tally?.error ?? 0) + (r.tally?.refused ?? 0);
      if (wrote) toast.success(`Created ${wrote} showtime(s) in Square.`);
      if (bad) toast.warning(`${bad} did not go through. Re-run, or check the logs.`);
      if (r.remaining) toast.info(`${r.remaining} still to do.`);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Could not create them');
    } finally { setBusy(null); }
  };

  const createPassItem = async (passTypeId: string, name: string) => {
    if (!confirm(`Create "${name}" in Square under 9 Film Passes, and link it?`)) return;
    setBusy(passTypeId);
    try {
      // dry_run:false and confirm:"WRITE" together are the function's ritual for
      // a real catalog write; either one alone returns a plan and writes nothing.
      await call({
        action: 'create_pass_item',
        pass_type_id: passTypeId,
        dry_run: false,
        confirm: 'WRITE',
      });
      toast.success(`Created "${name}" in Square and linked it.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create that item');
    } finally { setBusy(null); }
  };

  const linkPass = async (passTypeId: string, variationId: string, name: string) => {
    setBusy(passTypeId);
    try {
      await call({ action: 'link_pass_type', pass_type_id: passTypeId, square_variation_id: variationId });
      toast.success(`Linked to ${name}.`);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Could not link that pass');
    } finally { setBusy(null); }
  };

  const link = async (kind: string, productionId: string, itemId: string, name: string) => {
    setBusy(productionId);
    try {
      await call({ action: 'link_item', kind, production_id: productionId, square_item_id: itemId });
      toast.success(`Linked to ${name}.`);
      await load();
    } catch (e: any) {
      toast.error(e.message || 'Could not link that item');
    } finally { setBusy(null); }
  };

  if (loading) {
    return <div className="flex items-center gap-2 p-6 text-muted-foreground">
      <Loader2 className="h-4 w-4 animate-spin" /> Reading the Square catalog…
    </div>;
  }
  if (!plan) return null;

  const c = plan.counts || {};
  const adoptable = c.adopt_existing ?? 0;
  const appendable = c.would_append ?? 0;
  const needs = plan.needs_dashboard_item ?? [];

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="font-display text-lg font-bold">Square catalog</h3>
          <p className="text-sm text-muted-foreground">
            {plan.showings} showing(s) on sale · {plan.catalog_items} items in Square.
            A showtime with no Square item still sells, but it will not appear in
            item sales or under a category.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={!!busy}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <div className="flex flex-wrap gap-2">
        {Object.entries(c).map(([k, v]) => (
          <Badge key={k} variant={k === 'linked' ? 'default' : 'outline'}>
            {k.replace(/_/g, ' ')}: {v}
          </Badge>
        ))}
        {!Object.keys(c).length && <Badge variant="outline">nothing on sale in this window</Badge>}
      </div>

      {adoptable > 0 && (
        <Card className="p-4 space-y-2">
          <div className="font-medium">{adoptable} showtime(s) already in Square</div>
          <p className="text-sm text-muted-foreground">
            These exist in the catalog and only need recording on our side. Nothing
            is written to Square.
          </p>
          <Button onClick={adopt} disabled={!!busy}>
            {busy === 'adopt' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Record {adoptable}
          </Button>
        </Card>
      )}

      {appendable > 0 && (
        <Card className="p-4 space-y-2">
          <div className="font-medium">{appendable} showtime(s) to create in Square</div>
          <ul className="text-sm text-muted-foreground space-y-0.5">
            {(plan.appendable ?? []).slice(0, 8).map((a, i) => (
              <li key={i}>{a.production_title} — {a.variation_name} · {money(a.price_cents)}</li>
            ))}
          </ul>
          <div className="flex gap-2">
            <Button onClick={() => append(1)} disabled={!!busy} variant="outline">
              {busy === 'append' && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create one, to check
            </Button>
            <Button onClick={() => append(appendable)} disabled={!!busy}>
              Create all {appendable}
            </Button>
          </div>
        </Card>
      )}

      {needs.length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="flex items-center gap-2 font-medium">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            {needs.length} production(s) with no Square item
          </div>
          <p className="text-sm text-muted-foreground">
            Link one that already exists rather than making a second — a duplicate
            splits the film's takings across two items in every report.
          </p>
          {needs.map((n) => (
            <div key={n.production_id} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{n.title}</span>
                <Badge variant="outline" className="text-xs">{n.category}</Badge>
              </div>
              {(n.possible_matches ?? []).length > 0 ? (
                <div className="space-y-1">
                  {n.possible_matches!.map((m) => (
                    <div key={m.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">{m.name} — {m.why}</span>
                      <Button size="sm" variant="outline" disabled={!!busy}
                        onClick={() => link(n.kind, n.production_id, m.id, m.name)}>
                        {busy === n.production_id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <><Link2 className="h-3 w-3 mr-1" /> This one</>}
                      </Button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Nothing similar in the catalog. Create it in Square as an
                  <strong> Event</strong> item under <strong>{n.category}</strong>, then refresh.
                  Only Event items can hold a venue and showtimes, and the type
                  cannot be changed afterwards.
                </p>
              )}
            </div>
          ))}
        </Card>
      )}

      {showPasses && (passes ?? []).length > 0 && (
        <Card className="p-4 space-y-3">
          <div className="font-medium">Film passes</div>
          <p className="text-sm text-muted-foreground">
            A pass is one item in Square with no showtimes, so it is linked once
            and then stays linked. Pick the variation, not just the item — that is
            what a sale actually charges against.
          </p>
          {(passes ?? []).map((pt) => (
            <div key={pt.pass_type_id} className="rounded-md border border-border p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-sm">{pt.name} · {money(pt.price_cents)}</span>
                <Badge variant={pt.status === 'linked' ? 'default' : 'outline'} className="text-xs">
                  {pt.status === 'linked' ? 'linked' : pt.status === 'match_found' ? 'match found' : 'no item'}
                </Badge>
              </div>
              {pt.status !== 'linked' && pt.variations.length > 0 && (
                <div className="space-y-1">
                  {(pt.matching_items ?? 1) > 1 ? (
                    // The case this catalog actually has: three items sharing a
                    // name. Saying so is the difference between choosing and
                    // guessing, because an archived duplicate looks identical.
                    <p className="text-xs text-amber-500">
                      {pt.matching_items} separate Square items are named “{pt.name}”.
                      Every variation is listed below — pick the one on the item you
                      actually sell.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">In Square as {pt.square_item_name}:</p>
                  )}
                  {pt.variations.map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">
                        {v.name || 'Regular'}{v.price_cents != null && ` · ${money(v.price_cents)}`}
                        {(pt.matching_items ?? 1) > 1 && v.item_name && (
                          <span className="opacity-70"> · {v.item_name}</span>
                        )}
                        {v.archived && (
                          <Badge variant="outline" className="ml-1 text-[10px]">archived</Badge>
                        )}
                      </span>
                      <Button size="sm" variant="outline" disabled={!!busy}
                        onClick={() => linkPass(pt.pass_type_id, v.id, v.name || pt.name)}>
                        {busy === pt.pass_type_id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <><Link2 className="h-3 w-3 mr-1" /> Use this</>}
                      </Button>
                    </div>
                  ))}
                </div>
              )}
              {/* Passes whose Square name is nothing like ours — the standard
                  pass is "10-film pass" here and "KENWORTHY FILM PASS" there.
                  Filed under the same category though, which is a handful of
                  items rather than the whole 887-item catalog. */}
              {pt.status !== 'linked' && (pt.category_options ?? []).length > 0 && (
                <div className="space-y-1 border-t border-border pt-2">
                  <p className="text-xs text-muted-foreground">
                    Also filed under <strong>9 Film Passes</strong> in Square:
                  </p>
                  {(pt.category_options ?? []).map((v) => (
                    <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
                      <span className="text-muted-foreground">
                        {v.item_name} · {v.name || 'Regular'}
                        {v.price_cents != null && ` · ${money(v.price_cents)}`}
                        {v.archived && <Badge variant="outline" className="ml-1 text-[10px]">archived</Badge>}
                      </span>
                      <Button size="sm" variant="outline" disabled={!!busy}
                        onClick={() => linkPass(pt.pass_type_id, v.id, v.item_name || pt.name)}>
                        {busy === pt.pass_type_id
                          ? <Loader2 className="h-3 w-3 animate-spin" />
                          : <><Link2 className="h-3 w-3 mr-1" /> Use this</>}
                      </Button>
                    </div>
                  ))}
                </div>
              )}

              {pt.status === 'needs_item' && !pt.variations.length && (
                <div className="space-y-2">
                  <p className="text-xs text-muted-foreground">
                    {(pt.possible_matches ?? []).length
                      ? <>Similar in Square: {(pt.possible_matches ?? []).map(m => m.name).join(', ')}. Check those first — creating another item when one of these is the same pass is how duplicates start.</>
                      : <>Nothing in the catalog matches this pass by name.</>}
                  </p>
                  <Button size="sm" variant="outline" disabled={!!busy}
                    onClick={() => createPassItem(pt.pass_type_id, pt.name)}>
                    {busy === pt.pass_type_id
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <><Plus className="h-3 w-3 mr-1" /> Create in Square and link</>}
                  </Button>
                </div>
              )}
            </div>
          ))}
        </Card>
      )}

      {(plan.price_drift ?? []).length > 0 && (
        <Card className="p-4 space-y-1">
          <div className="font-medium">Prices that disagree with Square</div>
          {(plan.price_drift ?? []).slice(0, 8).map((p, i) => (
            <p key={i} className="text-sm text-muted-foreground">
              {p.production_title} — {p.variation_name}: {p.reason}
            </p>
          ))}
          <p className="text-xs text-muted-foreground">
            We charge our own price regardless; this only affects what Square's
            catalog says the ticket costs.
          </p>
        </Card>
      )}
    </div>
  );
}
