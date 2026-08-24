import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Printer, QrCode } from 'lucide-react';
import { toast } from 'sonner';
import { invokeFunction } from '@/lib/functions';
import { formatShowtime } from '@/lib/datetime';
import { StickerSheet, type StickerPassType, type Sticker } from './StickerSheet';
import { useFilmPassBatches, type BatchSummary } from '@/hooks/useFilmPassBatches';

/**
 * Print QRs — mint a run of blank pass stickers and put it on paper.
 *
 * This lived inside FilmPassesTab, which made it an admin-only feature by
 * accident: printing a sheet of stickers is counter work, not management. It is
 * a component rather than a page so it can mount in both places — the Film
 * Passes tab, where someone managing pass types is already standing, and the
 * Staff section, where someone running the counter is. One component, two
 * mounts: a second copy would drift, and both copies write real pass rows.
 *
 * Everything here goes through `film-pass-batch`, which gates on
 * `has_role(uid, 'staff')` — satisfied by staff, admin and superadmin (see
 * migration 20260812063211_has_role_hierarchy.sql). The service role is the
 * only writer; nothing in this component can mint a code by itself.
 */

/** Just enough of a pass type to fill the picker. */
interface PickerPassType {
  id: string;
  name: string;
}

export interface PrintQrPanelProps {
  /**
   * Called after a run is minted.
   *
   * A fresh batch writes `user_film_passes` rows, which is what makes a pass
   * type undeletable and what the Issued Passes list is counting. The Film
   * Passes tab uses this to re-read both; the Staff section has nothing to
   * refresh and leaves it off.
   */
  onMinted?: () => void;
  /**
   * Past runs, when the host page already holds them — see useFilmPassBatches.
   * Omit both of these and the panel loads its own; pass both or neither.
   */
  batches?: BatchSummary[];
  onReloadBatches?: () => void;
}

export function PrintQrPanel({ onMinted, batches: given, onReloadBatches }: PrintQrPanelProps) {
  const [passTypes, setPassTypes] = useState<PickerPassType[]>([]);
  const [typeId, setTypeId] = useState('');
  const [quantity, setQuantity] = useState('30');
  const [minting, setMinting] = useState(false);
  const [sheet, setSheet] = useState<
    { stickers: Sticker[]; passType: StickerPassType; batchId: string } | null
  >(null);

  // Read straight from the table rather than through a function: active pass
  // types are already readable by anyone (the public /film-passes page lists
  // them), so this needs no privilege the panel does not have.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from('film_pass_types')
        .select('id, name')
        .eq('is_active', true)
        .order('created_at', { ascending: false });
      if (cancelled) return;
      const types = (data || []) as PickerPassType[];
      setPassTypes(types);
      // Pre-selected so the common case — one pass type, print thirty — is a
      // single click. Only when nothing is chosen yet, or this would fight the
      // operator's own choice on every refetch.
      setTypeId(prev => (prev ? prev : types[0]?.id ?? ''));
    })();
    return () => { cancelled = true; };
  }, []);

  const own = useFilmPassBatches(given === undefined);
  const batches = given ?? own.batches;
  const loadBatches = onReloadBatches ?? own.reload;

  async function handleMint() {
    const count = parseInt(quantity, 10);
    if (!typeId) { toast.error('Choose a pass type'); return; }
    if (!Number.isFinite(count) || count < 1) { toast.error('How many stickers?'); return; }

    setMinting(true);
    try {
      const data = await invokeFunction<{
        batch_id: string;
        quantity: number;
        pass_type: StickerPassType;
        passes: { qr_code: string; pass_number: number | null }[];
      }>('film-pass-batch', {
        action: 'create',
        pass_type_id: typeId,
        quantity: count,
      });

      setSheet({
        stickers: data.passes.map(p => ({ code: p.qr_code, pass_number: p.pass_number ?? null })),
        passType: data.pass_type,
        batchId: data.batch_id,
      });
      toast.success(`${data.quantity} blank stickers ready to print`);
      loadBatches();
      onMinted?.();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not create the batch');
    } finally {
      setMinting(false);
    }
  }

  async function reprintBatch(batchId: string) {
    try {
      const data = await invokeFunction<{
        batch_id: string;
        pass_type: StickerPassType | null;
        passes: { qr_code: string; pass_number: number | null; status: string }[];
      }>('film-pass-batch', { action: 'list', batch_id: batchId });

      if (!data.pass_type) { toast.error('That batch has no pass type'); return; }
      // Reprinting only the blanks, never the activated ones. A second sticker
      // carrying a code already stuck to somebody's pass is a duplicate pass.
      const blanks = data.passes
        .filter(p => p.status === 'unassigned')
        .map(p => ({ code: p.qr_code, pass_number: p.pass_number ?? null }));
      if (blanks.length === 0) {
        toast.info('Every sticker in that batch has already been activated.');
        return;
      }
      setSheet({ stickers: blanks, passType: data.pass_type, batchId: data.batch_id });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not load that batch');
    }
  }

  return (
    <>
      {/* A sibling of the card, not a child of it: StickerSheet portals itself
          to <body>, which is what its print rule requires, and returning it in
          place would put it back inside #root — the bug that printed a blank
          page. */}
      {sheet && (
        <StickerSheet
          stickers={sheet.stickers}
          passType={sheet.passType}
          batchId={sheet.batchId}
          onDone={() => setSheet(null)}
        />
      )}

      <Card className="glass">
        <CardContent className="p-4 space-y-4">
          <p className="text-sm text-muted-foreground">
            Stickers are printed blank and worth nothing until a staff member scans one at the
            counter. Print a sheet, stick them on the paper passes, and keep them behind the desk.
          </p>
          <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
            <div className="space-y-2">
              <Label>Pass type</Label>
              <Select value={typeId} onValueChange={setTypeId}>
                <SelectTrigger><SelectValue placeholder="Choose a pass type..." /></SelectTrigger>
                <SelectContent>
                  {passTypes.map(pt => (
                    <SelectItem key={pt.id} value={pt.id}>{pt.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="batch-qty">How many</Label>
              <Input
                id="batch-qty"
                type="number"
                min={1}
                max={500}
                className="sm:w-28"
                value={quantity}
                onChange={e => setQuantity(e.target.value)}
              />
            </div>
            <Button onClick={handleMint} disabled={minting || !typeId}>
              {minting ? (
                <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Minting…</>
              ) : (
                <><QrCode className="h-4 w-4 mr-1" /> Generate</>
              )}
            </Button>
          </div>

          {batches.length > 0 && (
            <div className="space-y-2 pt-2 border-t">
              {batches.map(b => (
                <div key={b.batch_id} className="flex items-center justify-between gap-3 text-sm">
                  <div className="min-w-0">
                    <p className="font-medium truncate">{b.pass_type_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatShowtime(b.created_at, 'MMM d, yyyy')} · {b.unassigned} of {b.total}{' '}
                      still blank
                    </p>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={b.unassigned === 0}
                    onClick={() => reprintBatch(b.batch_id)}
                  >
                    <Printer className="h-4 w-4 mr-1" /> Reprint blanks
                  </Button>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </>
  );
}
