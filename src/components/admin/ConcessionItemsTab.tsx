import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeFunction } from '@/lib/functions';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { CONCESSION_SQUARE_PUSH_ENABLED } from '@/lib/flags';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Edit, Trash2, UtensilsCrossed, Package, X, RefreshCw, Cloud, CloudOff } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';

interface ConcessionItem {
  id: string;
  name: string;
  price: number;
  category: string;
  is_active: boolean;
  is_combo: boolean;
  square_catalog_id?: string | null;
  square_synced_at?: string | null;
}

/** What the dry run reports back, so staff can see a pull before it writes. */
interface PullPreview {
  environment?: string;
  allowlist?: string[];
  included?: { category: string; count: number }[];
  excluded?: { category: string; count: number }[];
  will_import?: number;
  will_skip?: number;
  over_sanity_limit?: boolean;
  sanity_limit?: number;
}

/** What repair_categories reports back from its dry run. */
interface RepairPlan {
  environment?: string;
  mode?: string;
  needs_repair?: number;
  would_repair?: number;
  restoring?: number;
  organizing?: number;
  no_longer_in_square?: number;
  by_category?: { category: string; count: number }[];
  items?: { name: string; category: string }[];
}

/** What an applied repair reports back, including why items failed. */
interface RepairResult {
  repaired?: number;
  attempted?: number;
  failure_count?: number;
  failures?: { id: string; name: string; error: string }[];
  error_summary?: { error: string; count: number }[];
}

interface ComboChild {
  id: string;
  combo_id: string;
  child_item_id: string;
  quantity: number;
  display_order: number;
  child?: ConcessionItem;
}

export default function ConcessionItemsTab() {
  const [items, setItems] = useState<ConcessionItem[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<ConcessionItem | null>(null);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('Snacks');
  const [isCombo, setIsCombo] = useState(false);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [preview, setPreview] = useState<PullPreview | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [repair, setRepair] = useState<RepairPlan | null>(null);
  const [repairOpen, setRepairOpen] = useState(false);
  const [repairMode, setRepairMode] = useState<'restore' | 'organize'>('restore');
  const [repairing, setRepairing] = useState(false);
  const [repairResult, setRepairResult] = useState<RepairResult | null>(null);
  const [repairProgress, setRepairProgress] = useState<string | null>(null);
  // Categories the operator has chosen NOT to restore this run.
  const [skipCategories, setSkipCategories] = useState<Set<string>>(new Set());

  // Combo management
  const [comboDialogOpen, setComboDialogOpen] = useState(false);
  const [comboParent, setComboParent] = useState<ConcessionItem | null>(null);
  const [comboChildren, setComboChildren] = useState<ComboChild[]>([]);
  const [newChildItemId, setNewChildItemId] = useState<string>('');
  const [newChildQty, setNewChildQty] = useState<string>('1');

  // Paged: a Square pull can leave far more than PostgREST's 1,000-row ceiling
  // in this table, and an unpaged select drops the tail with no error — which is
  // how the 2026-08-14 over-pull left rows nobody could see here to switch off.
  const loadItems = async () => {
    const { data, error } = await fetchAllRows<ConcessionItem>((from, to) =>
      supabase
        .from('concession_items')
        .select('*')
        .order('category')
        .order('name')
        .range(from, to) as never,
    );
    if (error) toast.error(`Could not load items: ${error.message}`);
    setItems(data);
  };

  // invokeFunction unwraps the function's own error text. Plain
  // supabase.functions.invoke reports every 500 as "non-2xx status code", which
  // is how a missing Square secret reached staff as an unreadable toast.
  const pushToSquare = async (itemId: string, isCombo: boolean) => {
    // Phase 2. These items are the website's display menu and Square is the
    // source of truth, so edits here stay here until admin-edits-reach-the-
    // register has an architecture. The server refuses this too — see
    // CONCESSION_SQUARE_PUSH — so a stale bundle cannot write either.
    if (!CONCESSION_SQUARE_PUSH_ENABLED) return;
    if (isCombo) return; // combos not synced
    try {
      await invokeFunction('square-catalog-sync', { action: 'push_item', itemId });
    } catch (e) {
      toast.error(`Square push failed: ${(e as Error).message}`);
    }
  };

  // Two steps on purpose. "Pull from Square" now only ever runs a dry run first;
  // nothing is written until staff see the counts and confirm. One unguarded
  // click used to import the entire catalog — 998 items, all active, straight
  // onto the public home page.
  const previewPull = async () => {
    setSyncing(true);
    try {
      const result = await invokeFunction<PullPreview>('square-catalog-sync', {
        action: 'preview',
      });
      setPreview(result);
      setPreviewOpen(true);
    } catch (e) {
      toast.error(`Could not read the Square catalog: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  const confirmPull = async () => {
    setSyncing(true);
    try {
      const result = await invokeFunction<{
        pulled?: number; created?: number; updated?: number;
        skipped?: number; environment?: string; note?: string;
      }>('square-catalog-sync', { action: 'pull' });
      // The environment is whatever the server resolved — never assumed here, so
      // this can't read "sandbox" while the pull hit the live catalog.
      toast.success(
        `Imported ${result?.created ?? 0} new, updated ${result?.updated ?? 0}, ` +
          `skipped ${result?.skipped ?? 0} out-of-scope (${result?.environment ?? 'unknown'})`,
      );
      if (result?.note) toast.info(result.note);
      setPreviewOpen(false);
      loadItems();
    } catch (e) {
      toast.error(`Sync failed: ${(e as Error).message}`);
    } finally {
      setSyncing(false);
    }
  };

  // Square catalog repair. Always dry-runs first and shows every affected name,
  // because this writes to the live Square catalog rather than to our own table.
  const planRepair = async (mode: 'restore' | 'organize') => {
    setRepairMode(mode);
    setRepairing(true);
    try {
      const result = await invokeFunction<RepairPlan>('square-catalog-sync', {
        action: 'repair_categories',
        mode,
        dry_run: true,
      });
      setRepair(result);
      setRepairResult(null);
      setSkipCategories(new Set());
      setRepairOpen(true);
    } catch (e) {
      toast.error(`Could not read the Square catalog: ${(e as Error).message}`);
    } finally {
      setRepairing(false);
    }
  };

  /**
   * Categories whose items can show up on a register screen at the stand.
   * Restoring these puts items back where they were, but that still changes what
   * staff see on the till — so they are called out and can be skipped.
   */
  const STAND_FACING = new Set([
    'Concessions', 'Cocktails', 'Cafe', 'Drinks', 'Beer & Wine', 'Candy',
    '7 Merch', '1 Combos', '2 Candy', '3 Bottles', '3 Soda', '4 Beer',
    '4 Wine', '5 Popcorn',
  ]);

  const toggleSkip = (category: string) => {
    setSkipCategories((prev) => {
      const next = new Set(prev);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  };

  /** Items actually eligible after the operator's category choices. */
  const repairSelection = (repair?.items ?? []).filter(
    (i) => !skipCategories.has(i.category),
  );

  /**
   * Apply in batches, because one call cannot finish the job.
   *
   * Each item costs up to three sequential Square calls — retrieve, then the
   * modern category shape, then the legacy one if that is rejected. Across ~390
   * items that is well over a thousand round trips, which exceeds the edge
   * function's wall-clock limit: it dies without a body, and supabase-js can
   * only report the generic "returned a non-2xx status code".
   *
   * Convergence is tracked HERE, not inferred from Square. Each call rebuilds
   * its plan from `/catalog/list`, and that list does not necessarily show a
   * write we made a second ago — so items we just fixed can look unfixed and be
   * written again. That is what turned a 381-item job into 1,040 redundant
   * writes. The remaining set is therefore narrowed on the client after every
   * batch, which makes the loop terminate on our own arithmetic rather than on
   * Square's read-your-writes behaviour.
   */
  const applyRepair = async () => {
    const BATCH = 40;
    setRepairing(true);
    let repaired = 0;
    const failures: RepairResult['failures'] = [];
    const errorCounts = new Map<string, number>();
    // Names still to attempt. Shrinks every pass, so the loop cannot revisit.
    let pending = repairSelection.map((i) => i.name);
    try {
      for (let pass = 0; pending.length > 0; pass++) {
        const batch = pending.slice(0, BATCH);
        const result = await invokeFunction<RepairResult & { remaining?: number }>(
          'square-catalog-sync',
          {
            action: 'repair_categories',
            mode: repairMode,
            dry_run: false,
            // Exactly this batch, and nothing else — no limit needed, and no
            // chance of the server picking a different 40 than we think.
            only_names: batch,
          },
        );
        // Attempted is attempted: drop the whole batch either way, so a failing
        // item is reported once rather than retried until the backstop trips.
        pending = pending.slice(batch.length);
        repaired += result?.repaired ?? 0;
        for (const f of result?.failures ?? []) failures.push(f);
        for (const e of result?.error_summary ?? []) {
          errorCounts.set(e.error, (errorCounts.get(e.error) ?? 0) + e.count);
        }
        setRepairResult({
          repaired,
          failure_count: failures.length,
          failures: failures.slice(0, 20),
          error_summary: [...errorCounts.entries()]
            .map(([error, count]) => ({ error, count }))
            .sort((a, b) => b.count - a.count),
        });
        setRepairProgress(
          `Re-filed ${repaired} of ${repairSelection.length}…`,
        );
        if (pass > 200) break; // backstop only; `pending` is the real bound
      }

      toast.success(`Re-filed ${repaired} item(s) in Square`);
      if (failures.length) {
        toast.error(`${failures.length} item(s) failed — reasons shown below`);
      } else {
        setRepairOpen(false);
      }
    } catch (e) {
      toast.error(
        `Repair stopped after ${repaired} item(s): ${(e as Error).message}`,
      );
    } finally {
      setRepairProgress(null);
      setRepairing(false);
    }
  };

  useEffect(() => { loadItems(); }, []);

  const openNew = () => {
    setEditing(null);
    setName('');
    setPrice('');
    setCategory('Snacks');
    setIsCombo(false);
    setDialogOpen(true);
  };

  const openEdit = (item: ConcessionItem) => {
    setEditing(item);
    setName(item.name);
    setPrice(String(item.price));
    setCategory(item.category);
    setIsCombo(item.is_combo);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!name.trim() || !price) return;
    setSaving(true);
    const row = {
      name: name.trim(),
      price: parseFloat(price),
      category: category.trim(),
      is_combo: isCombo,
    };

    if (editing) {
      const { error } = await supabase.from('concession_items').update(row).eq('id', editing.id);
      if (error) toast.error(error.message);
      else { toast.success('Item updated'); await pushToSquare(editing.id, row.is_combo); }
    } else {
      const { data: inserted, error } = await supabase.from('concession_items').insert(row).select('id').single();
      if (error) toast.error(error.message);
      else { toast.success('Item added'); if (inserted?.id) await pushToSquare(inserted.id, row.is_combo); }
    }
    setSaving(false);
    setDialogOpen(false);
    loadItems();
  };

  // Active/inactive is purely "show this on our site" — Square has no such field,
  // so there is nothing to push. It used to call pushToSquare anyway, and because
  // push rebuilt the Square object from our four columns, switching items off by
  // hand overwrote 906 live catalog entries on 2026-08-14. Never push from here.
  const toggleActive = async (item: ConcessionItem) => {
    const { error } = await supabase
      .from('concession_items')
      .update({ is_active: !item.is_active })
      .eq('id', item.id);
    if (error) toast.error(error.message);
    else loadItems();
  };

  // Removing an item from this menu does NOT remove it from the Square catalog.
  // It used to: any row with a square_catalog_id also fired a Square DELETE, so
  // tidying the menu quietly destroyed catalog objects — and after the 2026-08-14
  // over-pull that would have meant deleting hundreds of real items (films, MET
  // broadcasts, passes) from the live catalog. Square is the system of record for
  // the catalog; this table only decides what our site shows. Deleting there is a
  // deliberate, separate act, so it asks a second time and says what it means.
  const deleteItem = async (id: string) => {
    const target = items.find(i => i.id === id);
    if (!confirm('Remove this item from the site menu?')) return;

    const { error } = await supabase.from('concession_items').delete().eq('id', id);
    if (error) { toast.error(error.message); return; }
    toast.success('Removed from the site menu');
    loadItems();

    if (!CONCESSION_SQUARE_PUSH_ENABLED) return; // phase 2; Square is untouched
    if (!target?.square_catalog_id) return;
    if (
      !confirm(
        `Also DELETE "${target.name}" from the Square catalog?\n\n` +
          'This removes it from Square itself — registers, reporting and item ' +
          'history included. Cancel to leave Square untouched.',
      )
    ) return;
    try {
      await invokeFunction('square-catalog-sync', {
        action: 'delete_item',
        square_catalog_id: target.square_catalog_id,
      });
      toast.success('Deleted from the Square catalog');
    } catch (e) {
      toast.error(`Square delete failed: ${(e as Error).message}`);
    }
  };

  const openComboManager = async (item: ConcessionItem) => {
    setComboParent(item);
    setNewChildItemId('');
    setNewChildQty('1');
    const { data } = await supabase
      .from('concession_combo_items')
      .select('id, combo_id, child_item_id, quantity, display_order, child:concession_items!concession_combo_items_child_item_id_fkey(*)')
      .eq('combo_id', item.id)
      .order('display_order');
    setComboChildren((data as ComboChild[]) || []);
    setComboDialogOpen(true);
  };

  const reloadComboChildren = async (comboId: string) => {
    const { data } = await supabase
      .from('concession_combo_items')
      .select('id, combo_id, child_item_id, quantity, display_order, child:concession_items!concession_combo_items_child_item_id_fkey(*)')
      .eq('combo_id', comboId)
      .order('display_order');
    setComboChildren((data as ComboChild[]) || []);
  };

  const addComboChild = async () => {
    if (!comboParent || !newChildItemId) return;
    const qty = parseInt(newChildQty, 10);
    if (!qty || qty < 1) {
      toast.error('Quantity must be at least 1');
      return;
    }
    const { error } = await supabase.from('concession_combo_items').insert({
      combo_id: comboParent.id,
      child_item_id: newChildItemId,
      quantity: qty,
      display_order: comboChildren.length,
    });
    if (error) {
      toast.error(error.message);
      return;
    }
    setNewChildItemId('');
    setNewChildQty('1');
    reloadComboChildren(comboParent.id);
  };

  const updateChildQty = async (childRow: ComboChild, qty: number) => {
    if (!qty || qty < 1) return;
    const { error } = await supabase
      .from('concession_combo_items')
      .update({ quantity: qty })
      .eq('id', childRow.id);
    if (error) toast.error(error.message);
    else if (comboParent) reloadComboChildren(comboParent.id);
  };

  const removeComboChild = async (id: string) => {
    const { error } = await supabase.from('concession_combo_items').delete().eq('id', id);
    if (error) toast.error(error.message);
    else if (comboParent) reloadComboChildren(comboParent.id);
  };

  const childTotal = comboChildren.reduce(
    (sum, c) => sum + (c.child ? Number(c.child.price) * c.quantity : 0),
    0,
  );

  // Eligible children: any non-combo item (DB trigger also enforces this).
  const eligibleChildren = items.filter(
    (i) => !i.is_combo && i.id !== comboParent?.id,
  );

  const grouped = items.reduce<Record<string, ConcessionItem[]>>((acc, item) => {
    (acc[item.category] ||= []).push(item);
    return acc;
  }, {});

  return (
    <div>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div>
          <h2 className="font-display text-xl font-bold">Concession Menu</h2>
          <p className="text-xs text-muted-foreground">
            {CONCESSION_SQUARE_PUSH_ENABLED ? (
              <>Name and price sync with Square. Active/inactive is site-only.</>
            ) : (
              <>
                This is the <span className="font-medium">website’s display menu</span>.
                Square is the source of truth — “Pull from Square” brings prices in,
                and nothing here is written back to the register.
              </>
            )}{' '}
            “Pull from Square” shows what it would import first.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={previewPull} disabled={syncing}>
            <RefreshCw className={`h-4 w-4 mr-1 ${syncing ? 'animate-spin' : ''}`} />
            {syncing ? 'Checking…' : 'Pull from Square'}
          </Button>
          <Button size="sm" onClick={openNew}>
            <Plus className="h-4 w-4 mr-1" /> Add Item
          </Button>
        </div>
      </div>

      <Card className="glass mb-6 border-accent/30">
        <CardContent className="p-4">
          <p className="font-medium text-sm mb-1">Square catalog categories</p>
          <p className="text-xs text-muted-foreground mb-3">
            Works on the Square catalog itself, not this menu. Both options show
            you every affected item before anything is written.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => planRepair('restore')}
              disabled={repairing}
            >
              Restore wiped categories
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => planRepair('organize')}
              disabled={repairing}
            >
              File uncategorized items
            </Button>
          </div>
        </CardContent>
      </Card>

      {Object.entries(grouped).map(([cat, catItems]) => (
        <div key={cat} className="mb-6">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">{cat}</h3>
          <div className="space-y-2">
            {catItems.map(item => (
              <Card key={item.id} className="glass">
                <CardContent className="p-4 flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    {item.is_combo ? (
                      <Package className="h-5 w-5 text-accent" />
                    ) : (
                      <UtensilsCrossed className="h-5 w-5 text-primary" />
                    )}
                    <div>
                      <p className="font-medium flex items-center gap-2">
                        {item.name}
                        {item.is_combo && (
                          <Badge variant="outline" className="text-[10px] uppercase tracking-wide">Combo</Badge>
                        )}
                        {!item.is_combo && (item.square_catalog_id ? (
                          <span title={`Synced${item.square_synced_at ? ' ' + new Date(item.square_synced_at).toLocaleString() : ''}`}>
                            <Cloud className="h-3 w-3 text-accent" />
                          </span>
                        ) : (
                          <span title="Not yet in Square">
                            <CloudOff className="h-3 w-3 text-muted-foreground" />
                          </span>
                        ))}
                      </p>
                      <p className="text-sm text-muted-foreground">${Number(item.price).toFixed(2)}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Switch checked={item.is_active} onCheckedChange={() => toggleActive(item)} />
                    <Badge variant={item.is_active ? 'default' : 'secondary'} className="text-xs">
                      {item.is_active ? 'Active' : 'Inactive'}
                    </Badge>
                    {item.is_combo && (
                      <Button variant="ghost" size="sm" onClick={() => openComboManager(item)} title="Manage combo contents">
                        <Package className="h-4 w-4" />
                      </Button>
                    )}
                    <Button variant="ghost" size="sm" onClick={() => openEdit(item)}>
                      <Edit className="h-4 w-4" />
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => deleteItem(item.id)}>
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      ))}

      {items.length === 0 && (
        <p className="text-muted-foreground text-center py-8">No concession items yet. Add your first item!</p>
      )}

      <Dialog open={repairOpen} onOpenChange={setRepairOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {repairMode === 'restore'
                ? 'Restore wiped categories'
                : 'File uncategorized items'}
              {' — '}{repair?.environment ?? 'unknown'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <p className="text-muted-foreground">
              {repairMode === 'restore'
                ? 'Re-files items under the category they had before 14 Aug, taken from the pre-incident snapshot. Descriptions, images and extra variations cannot be restored this way.'
                : 'Files items Square never categorized, matching only clear name patterns. Anything ambiguous is left alone.'}
              {' '}Nothing has been written yet.
            </p>

            <div className="rounded-md border border-border/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Will change — {repair?.would_repair ?? 0} item(s)
              </p>
              <ul className="space-y-1">
                {(repair?.by_category ?? []).map((c) => {
                  const skipped = skipCategories.has(c.category);
                  const stand = STAND_FACING.has(c.category);
                  return (
                    <li key={c.category} className="flex items-center gap-2">
                      <input
                        type="checkbox"
                        id={`cat-${c.category}`}
                        checked={!skipped}
                        onChange={() => toggleSkip(c.category)}
                        className="shrink-0"
                      />
                      <label
                        htmlFor={`cat-${c.category}`}
                        className={`flex-1 cursor-pointer ${skipped ? 'line-through opacity-50' : ''}`}
                      >
                        {c.category}
                        {stand && (
                          <span className="ml-2 text-[10px] uppercase tracking-wide text-accent">
                            on the till
                          </span>
                        )}
                      </label>
                      <span className="tabular-nums text-muted-foreground">{c.count}</span>
                    </li>
                  );
                })}
              </ul>
              {(repair?.would_repair ?? 0) === 0 && (
                <p className="italic text-muted-foreground">
                  Nothing to change — Square already matches.
                </p>
              )}
              <p className="mt-3 text-xs text-muted-foreground">
                Items marked <span className="text-accent">on the till</span> sit in
                categories a register at the stand may display. Restoring them puts
                them back where they were before 14 Aug — it never adds an item that
                did not already exist — but untick any you would rather leave until
                you can see a register.
              </p>
            </div>

            {(repair?.items ?? []).length > 0 && (
              <details className="rounded-md border border-border/40 p-3">
                <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground">
                  Review all {repair?.items?.length} item(s)
                </summary>
                <ul className="mt-2 max-h-64 overflow-y-auto space-y-1">
                  {(repair?.items ?? []).map((i) => (
                    <li key={i.name} className="flex justify-between gap-3">
                      <span className="truncate">{i.name}</span>
                      <span className="text-muted-foreground shrink-0">{i.category}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {(repairResult?.failure_count ?? 0) > 0 && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 space-y-2">
                <p className="text-xs uppercase tracking-wide text-destructive">
                  {repairResult?.repaired ?? 0} succeeded,{' '}
                  {repairResult?.failure_count} failed — Square's reasons
                </p>
                <ul className="space-y-1">
                  {(repairResult?.error_summary ?? []).map((e) => (
                    <li key={e.error} className="flex justify-between gap-3">
                      <span className="break-words">{e.error}</span>
                      <span className="tabular-nums shrink-0">{e.count}</span>
                    </li>
                  ))}
                </ul>
                <details>
                  <summary className="cursor-pointer text-xs text-muted-foreground">
                    Show affected items
                  </summary>
                  <ul className="mt-2 max-h-48 overflow-y-auto space-y-1 text-xs">
                    {(repairResult?.failures ?? []).map((f) => (
                      <li key={f.id} className="flex justify-between gap-3">
                        <span className="truncate">{f.name}</span>
                        <span className="text-muted-foreground shrink-0">{f.error}</span>
                      </li>
                    ))}
                  </ul>
                </details>
              </div>
            )}

            {(repair?.no_longer_in_square ?? 0) > 0 && (
              <p className="text-xs text-muted-foreground">
                {repair?.no_longer_in_square} snapshot item(s) are no longer in the
                Square catalog and were skipped.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRepairOpen(false)}>Cancel</Button>
            <Button onClick={applyRepair} disabled={repairing || !repairSelection.length}>
              {repairing
                ? (repairProgress ?? 'Writing…')
                : `Apply to ${repairSelection.length} item(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Pull from Square — {preview?.environment ?? 'unknown'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2 text-sm">
            <p className="text-muted-foreground">
              Nothing has been written yet. Only the categories below count as
              concessions; everything else in the Square catalog is left alone.
              Newly imported items arrive <span className="font-medium">inactive</span>,
              so nothing reaches the public site until you switch it on.
            </p>

            <div className="rounded-md border border-border/40 p-3">
              <p className="text-xs uppercase tracking-wide text-muted-foreground mb-2">
                Will import — {preview?.will_import ?? 0} item(s)
              </p>
              {(preview?.included ?? []).length === 0 && (
                <p className="italic text-muted-foreground">
                  Nothing in scope. Check the category allowlist.
                </p>
              )}
              <ul className="space-y-1">
                {(preview?.included ?? []).map((c) => (
                  <li key={c.category} className="flex justify-between">
                    <span>{c.category}</span>
                    <span className="tabular-nums text-muted-foreground">{c.count}</span>
                  </li>
                ))}
              </ul>
            </div>

            <details className="rounded-md border border-border/40 p-3">
              <summary className="cursor-pointer text-xs uppercase tracking-wide text-muted-foreground">
                Will skip — {preview?.will_skip ?? 0} item(s)
              </summary>
              <ul className="space-y-1 mt-2">
                {(preview?.excluded ?? []).map((c) => (
                  <li key={c.category} className="flex justify-between">
                    <span>{c.category}</span>
                    <span className="tabular-nums text-muted-foreground">{c.count}</span>
                  </li>
                ))}
              </ul>
            </details>

            {preview?.over_sanity_limit && (
              <p className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-destructive">
                That is more than {preview?.sanity_limit} items — well past a
                plausible concessions menu. The server will refuse this pull.
                Narrow the category allowlist first.
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreviewOpen(false)}>Cancel</Button>
            <Button
              onClick={confirmPull}
              disabled={syncing || preview?.over_sanity_limit || !preview?.will_import}
            >
              {syncing ? 'Importing…' : `Import ${preview?.will_import ?? 0} item(s)`}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? 'Edit Item' : 'Add Concession Item'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label>Name</Label>
              <Input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Large Popcorn" />
            </div>
            <div className="space-y-2">
              <Label>Price</Label>
              <Input type="number" step="0.01" min="0" value={price} onChange={e => setPrice(e.target.value)} placeholder="5.00" />
            </div>
            <div className="space-y-2">
              <Label>Category</Label>
              <Input value={category} onChange={e => setCategory(e.target.value)} placeholder="Snacks, Drinks, Candy..." />
            </div>
            <div className="flex items-center justify-between rounded-md border border-border/40 p-3">
              <div>
                <p className="text-sm font-medium">This is a combo bundle</p>
                <p className="text-xs text-muted-foreground">
                  Combos let you group child items. Price stays as set above (override).
                </p>
              </div>
              <Switch checked={isCombo} onCheckedChange={setIsCombo} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleSave} disabled={saving || !name.trim() || !price}>
              {editing ? 'Save Changes' : 'Add Item'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={comboDialogOpen} onOpenChange={setComboDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {comboParent?.name ?? 'Combo'} — Contents
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="rounded-md border border-border/40 bg-muted/20 p-3 text-xs space-y-1">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Combo price (override)</span>
                <span className="tabular-nums">${comboParent ? Number(comboParent.price).toFixed(2) : '0.00'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Sum of children (à la carte)</span>
                <span className="tabular-nums">${childTotal.toFixed(2)}</span>
              </div>
              {comboParent && childTotal > Number(comboParent.price) && (
                <div className="flex justify-between text-accent">
                  <span>Customer savings</span>
                  <span className="tabular-nums">
                    ${(childTotal - Number(comboParent.price)).toFixed(2)}
                  </span>
                </div>
              )}
            </div>

            <div className="space-y-2">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Included items</Label>
              {comboChildren.length === 0 && (
                <p className="text-sm text-muted-foreground italic">No items added yet.</p>
              )}
              {comboChildren.map((c) => (
                <div key={c.id} className="flex items-center gap-2 rounded-md border border-border/40 p-2">
                  <span className="flex-1 text-sm">{c.child?.name ?? 'Unknown item'}</span>
                  <span className="text-xs text-muted-foreground tabular-nums w-16 text-right">
                    ${c.child ? Number(c.child.price).toFixed(2) : '0.00'} ea
                  </span>
                  <Input
                    type="number"
                    min="1"
                    value={c.quantity}
                    onChange={(e) => updateChildQty(c, parseInt(e.target.value, 10))}
                    className="w-16 h-8"
                  />
                  <Button variant="ghost" size="sm" onClick={() => removeComboChild(c.id)}>
                    <X className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              ))}
            </div>

            <div className="space-y-2 border-t border-border/40 pt-3">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Add item</Label>
              <div className="flex gap-2">
                <Select value={newChildItemId} onValueChange={setNewChildItemId}>
                  <SelectTrigger className="flex-1">
                    <SelectValue placeholder="Choose an item…" />
                  </SelectTrigger>
                  <SelectContent>
                    {eligibleChildren
                      .filter((i) => !comboChildren.some((c) => c.child_item_id === i.id))
                      .map((i) => (
                        <SelectItem key={i.id} value={i.id}>
                          {i.name} — ${Number(i.price).toFixed(2)}
                        </SelectItem>
                      ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  min="1"
                  value={newChildQty}
                  onChange={(e) => setNewChildQty(e.target.value)}
                  className="w-20"
                />
                <Button onClick={addComboChild} disabled={!newChildItemId}>
                  <Plus className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[11px] text-muted-foreground italic">
                Editing a child item's price elsewhere will update the "sum of children" reference here automatically. The combo's customer-facing price stays at the override above.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button onClick={() => setComboDialogOpen(false)}>Done</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
