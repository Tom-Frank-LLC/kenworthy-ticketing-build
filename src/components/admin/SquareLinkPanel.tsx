import { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeFunction } from '@/lib/functions';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { ChevronDown, Link2, Loader2, Plus, RefreshCw, EyeOff, Undo2 } from 'lucide-react';
import { toast } from 'sonner';
import { PRODUCTION_KIND_TABLE, dismissedKeys, needsForScope } from '@/lib/squareLink';
import type { ProductionKind } from '@/lib/squareLink';

/**
 * The Square catalog link, shown where the thing being linked already lives.
 *
 * It used to be one screen under Analytics listing everything at once, which
 * put the answer a long way from the question: someone editing a pass had to
 * know that a different section of a different tab was where its Square link
 * lived. So the panel comes to them instead, once per surface, scoped to what
 * that surface is about.
 *
 * Collapsed by default, and that is not only tidiness. Opening it lists the
 * whole Square catalog — ~890 objects, several seconds — so a panel that
 * fetched on mount would make every tab that carries it slower for the sake of
 * a question most visits are not asking. Nothing is requested until it is
 * opened.
 */

export type SquareScope = 'passes' | 'movies' | 'events' | 'live_performances';

const PASS_TABLE = 'film_pass_types';

/**
 * Which production kinds a scope answers for.
 *
 * `live_performances` covers **two** kinds, and that is the point. The Listings
 * tab has one "Live Events" surface holding both events and performances, so a
 * panel there that matched only `live_performance` left every unlinked *event*
 * with nowhere to appear — not in Movies, not here, and visible only on the
 * separate Square screen. That screen is gone now, which turns a gap into a
 * disappearance, so the scope has to cover what its surface actually lists.
 */
const SCOPE_KINDS: Record<Exclude<SquareScope, 'passes'>, ProductionKind[]> = {
  movies: ['movie'],
  events: ['event'],
  live_performances: ['event', 'live_performance'],
};

/**
 * Which tables a scope's dismissals can land in.
 *
 * Note the plural. A dismissal is recorded against the table the row actually
 * lives in, which is *not* a property of the surface: the Live Events panel
 * lists events and live performances together, so it reads and writes both.
 * Keying every row on the surface's own name — which this did — filed a
 * dismissed event under `live_performances` with an `events` id. Self-
 * consistent while this panel was the only reader, and wrong the moment
 * anything else looked the dismissal up by the production's real kind.
 */
const scopeTables = (scope: SquareScope): string[] =>
  scope === 'passes'
    ? [PASS_TABLE]
    : [...new Set(SCOPE_KINDS[scope].map(k => PRODUCTION_KIND_TABLE[k]))];

interface PassRow {
  pass_type_id: string;
  name: string;
  price_cents: number;
  status: 'linked' | 'match_found' | 'needs_item';
  matching_items?: number;
  variations: Array<{
    id: string;
    name: string | null;
    price_cents: number | null;
    item_name?: string | null;
    archived?: boolean;
  }>;
  category_options?: PassRow['variations'];
}

interface ProductionRow {
  production_id: string;
  kind: ProductionKind;
  title: string;
  category: string;
  showings: number;
  /*
   * Both of these were always in the response and simply never declared here,
   * which is why this panel could only offer Dismiss. `status` separates "the
   * catalog has nothing by this name" from "it has more than one and the
   * planner refused to choose"; `possible_matches` is the candidate list the
   * planner offers but deliberately will not act on.
   */
  status?: 'needs_item' | 'ambiguous_item';
  possible_matches?: Array<{ id: string; name: string; why: string }>;
}

interface Plan {
  catalog_items?: number;
  pass_category_items?: number;
  pass_types?: PassRow[];
  needs_dashboard_item?: ProductionRow[];
}

/** One choice offered against a pending row, in a shape both sources share. */
interface PendingOption {
  id: string;
  label: string;
  hint?: string;
  archived?: boolean;
}

/** An item the panel is warning about, flattened across the two shapes. */
interface Pending {
  entityId: string;
  /** The table this row's dismissal is filed under — its own, not the surface's. */
  entityType: string;
  title: string;
  detail: string;
  options: PendingOption[];
  /**
   * What linking this row actually writes.
   *
   * A pass is linked by VARIATION, because that is what a checkout line sends.
   * A production is linked by ITEM, because its showtimes become variations of
   * that item later. Same button, two different calls, so the row has to say
   * which it is rather than the click site guessing.
   */
  mode: 'pass' | 'production';
  kind?: ProductionKind;
  /** Only a pass can be created from here; a production's item is a dashboard job. */
  canCreate: boolean;
  /** What to say when there is nothing to offer. */
  guidance?: 'create_event_item' | 'ambiguous';
  category?: string;
}

interface Props {
  scope: SquareScope;
  /** Heading, e.g. "Square catalog" — the surface supplies its own wording. */
  title?: string;
}

export function SquareLinkPanel({ scope, title = 'Square catalog' }: Props) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  /** Dismissed rows as "table:id" — the same key `SquareCatalogTab` filters on. */
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      // Derived in here rather than in the body so the callback depends on the
      // scope string alone; a fresh array on every render would either churn
      // the identity or need excusing from the dependency list.
      const tables = scopeTables(scope);
      const [data, { data: dis }] = await Promise.all([
        invokeFunction('square-showing-variations', {
          action: scope === 'passes' ? 'plan_film_passes' : 'plan',
        }),
        supabase
          .from('square_link_dismissals')
          .select('entity_type, entity_id')
          .in('entity_type', tables),
      ]);
      setPlan(data as Plan);
      setDismissed(dismissedKeys(dis));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not read the Square catalog');
    } finally {
      setLoading(false);
    }
  }, [scope]);

  const onOpenChange = (next: boolean) => {
    setOpen(next);
    // Fetch on first open only. Re-opening shows what was already read; the
    // refresh button is there for when that is not what you want.
    if (next && !plan && !loading) void load();
  };

  /**
   * Record the choice a person just made.
   *
   * Neither branch writes to Square's catalog — both only store which object we
   * already meant. That is what makes offering the button safe: the destructive
   * direction is *creating* a second item, and nothing here can do that.
   */
  const link = async (p: Pending, optionId: string, label: string) => {
    setBusy(p.entityId);
    try {
      await invokeFunction('square-showing-variations', p.mode === 'pass'
        ? { action: 'link_pass_type', pass_type_id: p.entityId, square_variation_id: optionId }
        : { action: 'link_item', kind: p.kind, production_id: p.entityId, square_item_id: optionId });
      toast.success(`Linked to ${label}.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not link that');
    } finally { setBusy(null); }
  };

  const createItem = async (entityId: string, label: string) => {
    if (!confirm(`Create "${label}" in Square under 9 Film Passes, and link it?`)) return;
    setBusy(entityId);
    try {
      // dry_run:false and confirm:"WRITE" together are the function's ritual for
      // a real catalog write; either alone returns a plan and writes nothing.
      await invokeFunction('square-showing-variations', {
        action: 'create_pass_item',
        pass_type_id: entityId,
        dry_run: false,
        confirm: 'WRITE',
      });
      toast.success(`Created "${label}" in Square and linked it.`);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not create that item');
    } finally { setBusy(null); }
  };

  const dismiss = async (entityType: string, entityId: string, label: string) => {
    setBusy(entityId);
    try {
      // The row is the record. film_pass_types, movies, events and
      // live_performances already carry audit triggers, so the link that may
      // have preceded this is in the activity log too — and this table carries
      // one of its own, so the dismissal lands beside it in the same shape.
      const { data, error } = await supabase
        .from('square_link_dismissals')
        .insert({ entity_type: entityType, entity_id: entityId })
        .select('id');
      if (error) throw error;
      if (!data?.length) throw new Error('Nothing saved — you may not have admin rights.');
      setDismissed(prev => new Set(prev).add(`${entityType}:${entityId}`));
      toast.success(`Hidden. “${label}” will stop being flagged here.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not dismiss that');
    } finally { setBusy(null); }
  };

  const restore = async (entityType: string, entityId: string) => {
    setBusy(entityId);
    try {
      const { error } = await supabase
        .from('square_link_dismissals')
        .delete()
        .eq('entity_type', entityType)
        .eq('entity_id', entityId);
      if (error) throw error;
      setDismissed(prev => {
        const next = new Set(prev);
        next.delete(`${entityType}:${entityId}`);
        return next;
      });
      toast.success('Warning restored.');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not restore that');
    } finally { setBusy(null); }
  };

  // Both shapes reduced to one list, so the rendering below does not branch.
  const pending: Pending[] = scope === 'passes'
    ? (plan?.pass_types ?? [])
        .filter(p => p.status !== 'linked')
        .map(p => ({
          entityId: p.pass_type_id,
          entityType: PASS_TABLE,
          title: p.name,
          detail: (p.matching_items ?? 0) > 1
            ? `${p.matching_items} Square items share this name`
            : 'Not linked to a Square item',
          options: [...(p.variations ?? []), ...(p.category_options ?? [])].map(v => ({
            id: v.id,
            label: v.name || 'Regular',
            hint: [v.item_name, v.price_cents != null ? `$${(v.price_cents / 100).toFixed(2)}` : null]
              .filter(Boolean).join(' · ') || undefined,
            archived: v.archived,
          })),
          mode: 'pass' as const,
          canCreate: p.status === 'needs_item',
        }))
    // Kind filter only — dismissals are applied below, because this panel still
    // has to list what was dismissed so it can offer Restore.
    : needsForScope(
        plan?.needs_dashboard_item,
        SCOPE_KINDS[scope as Exclude<SquareScope, 'passes'>],
      ).map(p => ({
        entityId: p.production_id,
        entityType: PRODUCTION_KIND_TABLE[p.kind],
        title: p.title,
        detail: `${p.showings} showing(s) · ${p.category}`,
        // The candidates the planner found and refused to act on. Offering them
        // here is the whole point: five of the first ten titles it reported as
        // needing a new item already existed under a bare title, and creating
        // those would have split each film's takings across two items.
        options: (p.possible_matches ?? []).map(m => ({ id: m.id, label: m.name, hint: m.why })),
        mode: 'production' as const,
        kind: p.kind,
        canCreate: false,
        guidance: p.status === 'ambiguous_item' ? ('ambiguous' as const) : ('create_event_item' as const),
        category: p.category,
      }));

  const key = (p: Pending) => `${p.entityType}:${p.entityId}`;
  const visible = pending.filter(p => !dismissed.has(key(p)));
  const hidden = pending.filter(p => dismissed.has(key(p)));

  return (
    <Collapsible open={open} onOpenChange={onOpenChange}>
      <Card className="p-0 overflow-hidden">
        <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 p-4 text-left hover:bg-muted/40 transition-colors">
          <span className="flex items-center gap-2">
            <span className="font-medium">{title}</span>
            {plan && visible.length > 0 && (
              <Badge variant="outline" className="text-xs">{visible.length} unlinked</Badge>
            )}
            {plan && visible.length === 0 && (
              <Badge className="text-xs">all linked</Badge>
            )}
          </span>
          <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? 'rotate-180' : ''}`} />
        </CollapsibleTrigger>

        <CollapsibleContent>
          <div className="p-4 pt-0 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                What a sale is charged against in Square. Unlinked items still sell — they
                book as an ad-hoc line rather than against the catalog item.
              </p>
              <Button size="sm" variant="ghost" onClick={() => void load()} disabled={loading}>
                {loading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </Button>
            </div>

            {loading && !plan && (
              <p className="text-sm text-muted-foreground">Reading the Square catalog…</p>
            )}

            {plan && visible.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Nothing here needs linking.
              </p>
            )}

            {visible.map(p => (
              <div key={p.entityId} className="rounded-md border border-border p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium">{p.title}</span>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={busy === p.entityId}
                    onClick={() => dismiss(p.entityType, p.entityId, p.title)}
                    title="Stop flagging this. Recorded in the activity log."
                  >
                    <EyeOff className="h-3 w-3 mr-1" /> Dismiss
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">{p.detail}</p>
                {p.canCreate && p.options.length === 0 && (
                  <Button size="sm" variant="outline" disabled={busy === p.entityId}
                    onClick={() => createItem(p.entityId, p.title)}>
                    {busy === p.entityId
                      ? <Loader2 className="h-3 w-3 animate-spin" />
                      : <><Plus className="h-3 w-3 mr-1" /> Create in Square and link</>}
                  </Button>
                )}
                {p.options.map(v => (
                  <div key={v.id} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">
                      {v.label}
                      {v.hint && <span className="opacity-70"> — {v.hint}</span>}
                      {v.archived && <Badge variant="outline" className="ml-1 text-[10px]">archived</Badge>}
                    </span>
                    <Button size="sm" variant="outline" disabled={busy === p.entityId}
                      onClick={() => link(p, v.id, v.label)}>
                      {busy === p.entityId
                        ? <Loader2 className="h-3 w-3 animate-spin" />
                        : <><Link2 className="h-3 w-3 mr-1" /> Use this</>}
                    </Button>
                  </div>
                ))}

                {/*
                  * A production with nothing to offer. Which sentence appears
                  * matters more than it looks: telling someone to create an item
                  * for a title Square already has two of is how a third gets
                  * made, and a film's takings then split across all of them in
                  * every report.
                  */}
                {p.mode === 'production' && p.options.length === 0 && (
                  p.guidance === 'ambiguous' ? (
                    <p className="text-xs text-amber-500">
                      More than one Square item is already named “{p.title}”, so nothing was
                      linked. Archive the duplicate in Square, or link it there by hand — do
                      not create another.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Nothing in the catalog matches this title. Create it in Square as an
                      <strong> Event</strong> item under <strong>{p.category}</strong>, then
                      refresh. Only Event items can hold a venue and showtimes, and the type
                      cannot be changed after the item is made.
                    </p>
                  )
                )}
              </div>
            ))}

            {hidden.length > 0 && (
              <div className="border-t border-border pt-3 space-y-1">
                <p className="text-xs text-muted-foreground">
                  Dismissed ({hidden.length}) — recorded in the activity log, and reversible.
                </p>
                {hidden.map(p => (
                  <div key={p.entityId} className="flex items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{p.title}</span>
                    <Button size="sm" variant="ghost" disabled={busy === p.entityId}
                      onClick={() => restore(p.entityType, p.entityId)}>
                      <Undo2 className="h-3 w-3 mr-1" /> Restore
                    </Button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </CollapsibleContent>
      </Card>
    </Collapsible>
  );
}
