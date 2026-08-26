import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { toast } from 'sonner';
import { Loader2, RefreshCw, Link2, AlertTriangle, Plus } from 'lucide-react';
import { dismissedKeys, needsForScope } from '@/lib/squareLink';
import type { ProductionKind } from '@/lib/squareLink';

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
    kind: ProductionKind;
    title: string;
    category: string;
    showings: number;
    /*
     * Why this production has no item. `needs_item` means the catalog has
     * nothing by this name; `ambiguous_item` means it has more than one and the
     * planner refused to pick. The distinction decides what to tell someone,
     * and getting it wrong is expensive in one direction — see the render.
     */
    status?: 'needs_item' | 'ambiguous_item';
    possible_matches?: Array<{ id: string; name: string; why: string }>;
  }>;
  /*
   * Each of these is built server-side by spreading a `Desired` row, which
   * carries `production_kind` (see `_shared/square-catalog.ts`). The field was
   * simply never declared here. Declaring it is what lets one panel be scoped
   * to the surface it sits on without touching the edge function.
   *
   * Server-side these are `.slice(0, 50)` while `counts` holds the true totals,
   * so a scoped view counts the rows it actually received and says "50+" rather
   * than quoting an unscoped total against a filtered list.
   */
  adoptable?: Array<{ variation_name: string; production_title: string; production_kind?: ProductionKind }>;
  appendable?: Array<{ variation_name: string; production_title: string; price_cents: number; production_kind?: ProductionKind }>;
  price_drift?: Array<{ variation_name: string; production_title: string; reason?: string; production_kind?: ProductionKind }>;
};

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

interface SquareCatalogTabProps {
  /**
   * Passes have their own panel on the Passes tab, so this screen suppresses its
   * pass section when mounted beside it.
   */
  showPasses?: boolean;
  /**
   * Restrict the showtime work to these production kinds.
   *
   * Given, the panel stops being a screen of its own and becomes a section of
   * the Listings sub-tab it sits on: Movies shows movie showtimes, Live Events
   * shows events and performances.
   *
   * It used to also drop the "productions with no Square item" list, on the
   * grounds that `SquareLinkPanel` was already on those surfaces doing that
   * job. It was not. That panel can only *dismiss* a production — the link and
   * create-in-dashboard affordances live here — and since every mount of this
   * component is scoped, the effect was that a movie or event could be waved
   * away but never actually linked. The two panels now answer two different
   * questions on the same tab, and share the dismissal list so they agree on
   * what has been waved away.
   */
  kinds?: ProductionKind[];
}

export default function SquareCatalogTab({ showPasses = true, kinds }: SquareCatalogTabProps) {
  const [plan, setPlan] = useState<Plan | null>(null);
  const [passes, setPasses] = useState<PassRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  /*
   * Titles somebody has waved away in `SquareLinkPanel`, as "table:id".
   *
   * Read here so the two Square boxes on a tab agree. Dismissing is still done
   * over there — this list only respects it — because a dismissal is a single
   * decision and giving it two buttons in the same tab is how you end up with
   * one of them not working.
   */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  /*
   * The scope, in the shape the edge function wants. Spread into every write so
   * the button matches the section it sits under: "Create all 3" beneath the
   * movie list writes three movies, not the whole plan.
   *
   * `kinds` is omitted entirely when unscoped — the function reads absent as "no
   * restriction" and refuses an empty array, so sending `[]` would 400 rather
   * than mean what it looks like.
   */
  const scopeArg = kinds?.length ? { kinds } : {};

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke('square-showing-variations', { body });
    if (error) throw new Error(error.message);
    if ((data as any)?.error) throw new Error((data as any).error);
    return data as any;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Only the unscoped screen renders the unlinked list, so only it needs to
      // know what was dismissed. Deliberately not allowed to sink the panel: a
      // failure here should cost a hidden row reappearing, not the Square
      // section — a PostgREST error resolves rather than throws, so an empty
      // set is what a denial produces.
      const [p, fp, dis] = await Promise.all([
        call({ action: 'plan', horizon_days: 120, ...scopeArg }),
        call({ action: 'plan_film_passes' }),
        kinds?.length
          ? Promise.resolve({ data: [] })
          : supabase.from('square_link_dismissals').select('entity_type, entity_id'),
      ]);
      setPlan(p);
      setPasses(fp.pass_types ?? []);
      setDismissed(dismissedKeys(dis.data));
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
      const r = await call({ action: 'apply', dry_run: false, confirm: 'WRITE', max_batch: 0, ...scopeArg });
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
      const r = await call({ action: 'apply', dry_run: false, confirm: 'WRITE', max_batch: count, ...scopeArg });
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
  const scoped = !!kinds?.length;
  /*
   * Belt and braces. The server already scoped this read — that is what stops
   * the 50-row cap sampling the wrong kind — so this filter should be a no-op.
   * It stays because it costs nothing and because a stale bundle talking to an
   * older function would otherwise render another kind's rows under this
   * heading. Rows with no `production_kind` are kept rather than dropped: an
   * older function that cannot scope should under-filter visibly, not silently
   * show an empty section.
   */
  const inScope = <T extends { production_kind?: ProductionKind }>(rows: T[] | undefined) =>
    (rows ?? []).filter(r => !scoped || (r.production_kind ? kinds!.includes(r.production_kind) : true));

  const adoptableRows = inScope(plan.adoptable);
  const appendableRows = inScope(plan.appendable);
  const driftRows = inScope(plan.price_drift);

  /*
   * Unscoped, `counts` is the honest total and the arrays are a 50-row sample of
   * it. Scoped, that total is about the whole catalog and would overstate what
   * is on screen, so the filtered length is the only number that matches the
   * list. It can still under-report when the server truncated at 50 — hence the
   * "+" rather than a figure presented as complete.
   */
  const adoptable = scoped ? adoptableRows.length : (c.adopt_existing ?? 0);
  const appendable = scoped ? appendableRows.length : (c.would_append ?? 0);
  const truncated = (rows: unknown[]) => (scoped && rows.length >= 50 ? '+' : '');


  /*
   * The unlinked productions, for the unscoped screen only.
   *
   * Scoped, `SquareLinkPanel` sits directly above this on the same tab and now
   * genuinely does this job — it offers the candidate items, the create-in-the-
   * dashboard sentence and the duplicate-title warning, not just Dismiss. This
   * comment used to say the same thing while that was untrue, which is exactly
   * how movies ended up with nowhere to be linked: both components deferred to
   * the other and neither rendered anything. If the panel is ever removed from
   * a surface, drop the `scoped` test here rather than leaving both silent.
   *
   * Note `needsForScope` cannot be replaced by `inScope` above: the other three
   * lists are scoped server-side and carry `production_kind`, while
   * `needs_dashboard_item` is assembled *before* the edge function applies
   * `kinds`, and carries `kind`.
   */
  const needs = scoped ? [] : needsForScope(plan.needs_dashboard_item, kinds, dismissed);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          {/* Scoped, the enclosing section already names this; a second heading
              would title the same box twice. */}
          {!scoped && <h3 className="font-display text-lg font-bold">Square catalog</h3>}
          <p className="text-sm text-muted-foreground">
            {scoped ? (
              <>A showtime with no Square item still sells, but it will not appear in item sales or under a category.</>
            ) : (
              <>
                {plan.showings} showing(s) on sale · {plan.catalog_items} items in Square.
                A showtime with no Square item still sells, but it will not appear in
                item sales or under a category.
              </>
            )}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={!!busy}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      {/* Whole-catalog tallies. Hidden when scoped: they count every kind, and
          printed above a filtered list they would describe something else. */}
      {!scoped && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(c).map(([k, v]) => (
            <Badge key={k} variant={k === 'linked' ? 'default' : 'outline'}>
              {k.replace(/_/g, ' ')}: {v}
            </Badge>
          ))}
          {!Object.keys(c).length && <Badge variant="outline">nothing on sale in this window</Badge>}
        </div>
      )}

      {adoptable > 0 && (
        <Card className="p-4 space-y-2">
          <div className="font-medium">{adoptable}{truncated(adoptableRows)} showtime(s) already in Square</div>
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
          <div className="font-medium">{appendable}{truncated(appendableRows)} showtime(s) to create in Square</div>
          <ul className="text-sm text-muted-foreground space-y-0.5">
            {appendableRows.slice(0, 8).map((a, i) => (
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
        <CollapsibleSection
          id="listings.square.unlinked"
          title="Productions with no Square item"
          icon={AlertTriangle}
          count={needs.length}
          defaultOpen
        >
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
              ) : n.status === 'ambiguous_item' ? (
                /*
                 * Square already has more than one Event item under this exact
                 * title, which is why nothing was linked automatically. The
                 * create-it guidance below would be actively wrong here — it
                 * would make a third — and `possible_matches` is empty for this
                 * row precisely because it excludes exact-name matches, so
                 * there is nothing to offer as a button either. Say so plainly
                 * rather than falling through to the wrong instruction.
                 */
                <p className="text-xs text-amber-500">
                  More than one Square item is already named “{n.title}”, so nothing was
                  linked. Archive the duplicate in Square, or link this title by hand —
                  do not create another, or the takings split across items in every report.
                </p>
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
        </CollapsibleSection>
      )}

      {showPasses && (passes ?? []).length > 0 && (
        <CollapsibleSection id="listings.square.passes" title="Film passes" count={(passes ?? []).length} defaultOpen>
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
        </CollapsibleSection>
      )}

      {driftRows.length > 0 && (
        <Card className="p-4 space-y-1">
          <div className="font-medium">Prices that disagree with Square</div>
          {driftRows.slice(0, 8).map((p, i) => (
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
