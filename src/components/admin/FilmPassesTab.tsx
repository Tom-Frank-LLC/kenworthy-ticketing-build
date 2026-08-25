import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { PASS_IMAGE_BUCKET, passImageUrl } from '@/lib/passImage';
import {
  Plus, Trash2, CreditCard, DollarSign, Loader2, Ban,
  Package, Mail, Store, ScanLine, Pencil, Search, X,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { invokeFunction } from '@/lib/functions';
import { PrintQrPanel } from './PrintQrPanel';
import { useFilmPassBatches } from '@/hooks/useFilmPassBatches';
import { formatShowtime } from '@/lib/datetime';
import {
  formatMailingAddress,
  passOrderBuyerLabel,
  type QueuedPassOrder,
  type AwaitingPostOrder,
} from '@/lib/passOrders';
import { MailQueueCard } from './MailQueueCard';
import { CollapsibleSection } from './CollapsibleSection';
import { PassEligibilityPanel } from './PassEligibilityPanel';
import type { PassTypeOption } from '@/lib/passEligibility';

interface FilmPassType {
  id: string;
  name: string;
  price: number;
  initial_balance: number;
  redemption_price: number;
  /** Window price of one ticket this pass admits you to. NULL = don't claim one. */
  ticket_face_value: number | null;
  expiration_days: number | null;
  is_active: boolean;
  /** NULL = unlimited: the balance is the only bound, so a holder can bring friends. */
  per_showing_use_limit: number | null;
  /** Pre-ticked on a newly created standard-priced movie screening. */
  is_default_for_movies: boolean;
  /** Set on the pass a festival page advertises; NULL on an ordinary pass. */
  festival_slug: string | null;
  /** Artwork in the pass-images bucket, shown beside the pass when it sells. */
  image_path: string | null;
  /** Where this pass is and is not valid, printed on the purchase page. */
  fine_print: string | null;
}

const BLANK_FORM = {
  name: '',
  price: '60',
  initial_balance: '60',
  redemption_price: '6',
  ticket_face_value: '',
  expiration_days: '',
  per_showing_use_limit: '',
  is_default_for_movies: true,
  festival_slug: '',
  fine_print: '',
};

/**
 * A row as `search_film_passes` returns it — already flattened across the pass,
 * its type, the account it belongs to, and the order it was bought under.
 *
 * The flattening happens in SQL rather than here because a bearer pass has no
 * account at all: its only contact details live on the order. Assembling that
 * client-side would mean this list could only search what it had already
 * loaded, which is the bug the whole feature exists to remove.
 */
interface SearchedPass {
  id: string;
  pass_number: number | null;
  qr_code: string | null;
  status: string;
  remaining_balance: number | null;
  payment_method: string | null;
  purchased_at: string;
  activated_at: string | null;
  expires_at: string | null;
  user_id: string | null;
  pass_type_name: string | null;
  holder_name: string | null;
  holder_email: string | null;
  holder_phone: string | null;
  buyer_name: string | null;
  buyer_email: string | null;
  buyer_phone: string | null;
  redemption_count: number;
}

interface PassSearchResult {
  /** Matching the search *and* the status filter. */
  total: number;
  /** Per status, matching the search but before the status filter. */
  counts: Record<string, number>;
  passes: SearchedPass[];
}

/**
 * Statuses a pass may be deleted in — the same three the edge function
 * enforces. Repeated here only to decide whether to draw the button; the
 * server is the authority, and a browser with a stale bundle that offers the
 * button anyway gets a 409 rather than a delete.
 */
const DELETABLE_STATUSES = new Set(['void', 'unassigned', 'depleted']);

const PAGE_SIZE = 50;

/** Value, label. 'issued' and 'all' are views; the rest are literal statuses. */
const STATUS_FILTERS: { value: string; label: string }[] = [
  { value: 'issued', label: 'Issued (hides blanks)' },
  { value: 'all', label: 'Everything' },
  { value: 'active', label: 'Active' },
  { value: 'depleted', label: 'Used up' },
  { value: 'expired', label: 'Expired' },
  { value: 'void', label: 'Cancelled' },
  { value: 'unassigned', label: 'Blank' },
];

const SORTS: { value: string; label: string }[] = [
  { value: 'newest', label: 'Newest first' },
  { value: 'oldest', label: 'Oldest first' },
  { value: 'expiring', label: 'Expiring soonest' },
  { value: 'balance_desc', label: 'Highest balance' },
  { value: 'balance_asc', label: 'Lowest balance' },
  { value: 'name', label: 'Name (A–Z)' },
  { value: 'number', label: 'Pass number' },
];

/** The order the summary chips read in: live money first, housekeeping last. */
const COUNT_ORDER = ['active', 'depleted', 'expired', 'void', 'unassigned'];

/**
 * Who the pass belongs to, in one line.
 *
 * The fallbacks are ordered by how much they are worth knowing: the account
 * name, then the name it was bought under, then the honest admission that a
 * bearer pass has no owner — which is a fact about the pass, not a gap in the
 * record, and reads wrongly as "Unknown".
 */
function holderLabel(p: SearchedPass): string {
  return p.holder_name || p.buyer_name || (p.user_id ? 'Unknown user' : 'Bearer pass');
}

/** Contact lines worth showing, deduplicated — holder and buyer often agree. */
function contactLines(p: SearchedPass): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of [p.holder_email, p.buyer_email, p.holder_phone, p.buyer_phone]) {
    const trimmed = (v ?? '').trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'destructive' | 'outline'> = {
  active: 'default',
  unassigned: 'outline',
  depleted: 'secondary',
  expired: 'destructive',
  void: 'destructive',
};

const STATUS_LABEL: Record<string, string> = {
  unassigned: 'Blank',
  active: 'Active',
  depleted: 'Used up',
  expired: 'Expired',
  void: 'Cancelled',
  pending: 'Awaiting payment',
  failed: 'Payment failed',
  refunded: 'Refunded',
};

export default function FilmPassesTab() {
  // Held here rather than inside PrintQrPanel because the count badge sits on a
  // header that can be closed, and CollapsibleSection does not mount a closed
  // section's children — a panel that owned this list could not report its size
  // until someone had already opened the section to see it. Handed straight
  // down, so it is still one request.
  const { batches, reload: reloadBatches } = useFilmPassBatches();
  const [passTypes, setPassTypes] = useState<FilmPassType[]>([]);
  /** Passes issued per type — what makes a type undeletable. Keyed by type id. */
  const [typePassCounts, setTypePassCounts] = useState<Record<string, number>>({});
  const [showForm, setShowForm] = useState(false);
  // The same form creates and edits. Pass types gained two fields that decide
  // real behaviour at the door, and there was no edit path at all — a type
  // created before this change could never acquire a per-screening limit,
  // which would have made the feature reachable only by deleting and
  // recreating a pass patrons already hold.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Artwork is uploaded to storage before the row is saved, so the row never
  // points at an object that is not there yet.
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [existingImage, setExistingImage] = useState<string | null>(null);
  const [form, setForm] = useState({ ...BLANK_FORM });

  // Outstanding orders — paid online, physical pass not yet handed over
  const [queue, setQueue] = useState<QueuedPassOrder[]>([]);
  const [awaitingPost, setAwaitingPost] = useState<AwaitingPostOrder[]>([]);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  // Issued passes — searched server-side, because the list is longer than a page
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('issued');
  const [sort, setSort] = useState('newest');
  const [passes, setPasses] = useState<SearchedPass[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [total, setTotal] = useState(0);
  const [loadingPasses, setLoadingPasses] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [passesError, setPassesError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    const { data } = await supabase
      .from('film_pass_types')
      .select('*')
      .order('created_at', { ascending: false });
    const types = (data || []) as FilmPassType[];
    setPassTypes(types);

    // How many passes each type has issued.
    //
    // `pass_type_id` is ON DELETE RESTRICT, so a type with even one pass —
    // including a blank sticker nobody has sold — cannot be deleted. That rule
    // is right: deleting the type would orphan passes people are holding. But
    // it was invisible until you clicked Delete and got a foreign-key error
    // naming a constraint, which tells an admin nothing they can act on.
    //
    // Counted per type rather than in one grouped query because PostgREST has
    // no GROUP BY, and there are a handful of types, not hundreds. `head: true`
    // means these fetch a count and no rows.
    const counts = await Promise.all(
      types.map(async t => {
        const { count } = await supabase
          .from('user_film_passes')
          .select('id', { count: 'exact', head: true })
          .eq('pass_type_id', t.id);
        return [t.id, count ?? 0] as const;
      }),
    );
    setTypePassCounts(Object.fromEntries(counts));
  }, []);

  // Typing is not a query. Without this, every keystroke is a round trip and
  // the answers race each other back — the list settling on whichever reply
  // happened to arrive last rather than on what was typed.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search), 250);
    return () => clearTimeout(timer);
  }, [search]);

  /**
   * One RPC serves the page, the total, and the per-status counts.
   *
   * `offset` is the only argument because the rest of the search lives in
   * state: changing the query, filter or sort rebuilds this callback, which
   * re-runs the effect below from offset 0. Appending is the one case that
   * needs to say where it is up to.
   */
  const loadPasses = useCallback(async (offset = 0) => {
    if (offset === 0) setLoadingPasses(true);
    else setLoadingMore(true);
    try {
      const { data, error } = await supabase.rpc('search_film_passes', {
        p_query: query.trim() || null,
        p_status: statusFilter,
        p_sort: sort,
        p_limit: PAGE_SIZE,
        p_offset: offset,
      });
      if (error) throw error;

      const result = (data ?? { total: 0, counts: {}, passes: [] }) as unknown as PassSearchResult;
      setPasses(prev => (offset === 0 ? result.passes : [...prev, ...result.passes]));
      setCounts(result.counts ?? {});
      setTotal(result.total ?? 0);
      setPassesError(null);
    } catch (err) {
      // Surfaced rather than swallowed, for the same reason the pickup queue
      // is: an empty list that is really a failed fetch answers "is this pass
      // in the system?" with a confident no.
      setPassesError(err instanceof Error ? err.message : 'Could not search the passes');
    } finally {
      setLoadingPasses(false);
      setLoadingMore(false);
    }
  }, [query, statusFilter, sort]);

  useEffect(() => { loadPasses(0); }, [loadPasses]);

  /**
   * The same `queue` action the box office reads, shown here as oversight.
   *
   * A failure here is surfaced rather than swallowed: this section exists to
   * answer "is anything outstanding?", and an empty list that is really a
   * failed fetch answers it wrongly, which is the exact failure this section
   * is meant to catch.
   */
  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    try {
      const data = await invokeFunction<{
        orders: QueuedPassOrder[];
        awaiting_post: AwaitingPostOrder[];
      }>('film-pass-checkout', { action: 'queue' });
      setQueue(data.orders || []);
      setAwaitingPost(data.awaiting_post || []);
      setQueueError(null);
    } catch (err) {
      setQueueError(err instanceof Error ? err.message : 'Could not load outstanding orders');
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  const markPosted = useCallback(async (orderId: string) => {
    let data: { result: string; notice?: string };
    try {
      data = await invokeFunction<{ result: string; notice?: string }>('film-pass-checkout', {
        action: 'mark_posted',
        order_id: orderId,
      });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Could not mark that order posted');
      return; // Leave the row where it is — nothing was recorded.
    }

    if (data.result === 'already_posted') {
      toast.info('Somebody already marked that one posted.');
    } else if (data.notice === 'failed') {
      // The order is posted either way — only the email fell over. Say so, or
      // staff will re-click looking for the confirmation that never sent.
      toast.warning('Marked posted, but the email to the buyer did not send.');
    } else if (data.notice === 'no_email') {
      toast.success('Marked posted. No email on file for this buyer.');
    } else {
      toast.success('Marked posted — the buyer has been emailed.');
    }
    await loadQueue();
  }, [loadQueue]);

  useEffect(() => { loadData(); loadQueue(); }, [loadData, loadQueue]);

  function startEdit(pt: FilmPassType) {
    setEditingId(pt.id);
    setImageFile(null);
    setExistingImage(pt.image_path ?? null);
    setForm({
      name: pt.name,
      price: String(pt.price),
      initial_balance: String(pt.initial_balance),
      redemption_price: String(pt.redemption_price),
      ticket_face_value: pt.ticket_face_value == null ? '' : String(pt.ticket_face_value),
      expiration_days: pt.expiration_days === null ? '' : String(pt.expiration_days),
      per_showing_use_limit:
        pt.per_showing_use_limit === null ? '' : String(pt.per_showing_use_limit),
      is_default_for_movies: pt.is_default_for_movies,
      festival_slug: pt.festival_slug ?? '',
      fine_print: pt.fine_print ?? '',
    });
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingId(null);
    setImageFile(null);
    setExistingImage(null);
    setForm({ ...BLANK_FORM });
  }

  async function handleSaveType() {
    if (!form.name.trim()) { toast.error('Name is required'); return; }

    // Blank means unlimited, and that has to survive the trip: parseInt('')
    // is NaN, which Postgres would reject, and 0 would trip the CHECK — a pass
    // that admits nobody is a deactivated pass, not a configured one.
    let limit: number | null = null;
    if (form.per_showing_use_limit.trim()) {
      limit = parseInt(form.per_showing_use_limit, 10);
      if (!Number.isFinite(limit) || limit < 1) {
        toast.error('Uses per screening must be 1 or more — leave it blank for unlimited.');
        return;
      }
    }

    // The picture first: a row must never reference an object that has not
    // finished uploading. A failed upload keeps whatever artwork was there
    // before rather than dropping it.
    let imagePath: string | null = existingImage;
    if (imageFile) {
      const safe = imageFile.name.replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${Date.now()}_${safe}`;
      const { error: upErr } = await supabase.storage
        .from(PASS_IMAGE_BUCKET)
        .upload(path, imageFile, { contentType: imageFile.type, upsert: false });
      if (upErr) {
        toast.error(`Image upload failed: ${upErr.message}`);
        return;
      }
      imagePath = path;
    }
    const payload = {
      name: form.name.trim(),
      price: parseFloat(form.price) || 60,
      initial_balance: parseFloat(form.initial_balance) || 60,
      redemption_price: parseFloat(form.redemption_price) || 6,
      // Blank stays NULL: the email and the passes page then state how many
      // films the pass is worth without claiming a price, which is true of any
      // pass. A wrong number here is worse than no number.
      ticket_face_value: form.ticket_face_value.trim() ? parseFloat(form.ticket_face_value) : null,
      expiration_days: form.expiration_days ? parseInt(form.expiration_days) : null,
      per_showing_use_limit: limit,
      is_default_for_movies: form.is_default_for_movies,
      // Empty means "not a festival pass". It must reach Postgres as NULL, not
      // '': the unique index only ignores NULLs, so a second pass saved with a
      // blank box would collide with the first instead of being unconstrained.
      festival_slug: form.festival_slug.trim() || null,
      image_path: imagePath,
      // Empty means the purchase page prints no validity line for this pass,
      // which is safer than inheriting another pass's claim.
      fine_print: form.fine_print.trim() || null,
    };


    // RLS filters writes rather than failing them, so a blocked update comes
    // back as 204 with no error. The returned rows are the only thing that
    // says whether anything landed.
    const { data, error } = editingId
      ? await supabase.from('film_pass_types').update(payload).eq('id', editingId).select('id')
      : await supabase.from('film_pass_types').insert(payload).select('id');

    if (error) { toast.error(error.message); return; }
    if (!data || data.length === 0) {
      toast.error('That did not save — check your permissions.');
      return;
    }

    toast.success(editingId ? 'Pass type updated' : 'Pass type created');
    closeForm();
    loadData();
  }

  async function toggleActive(id: string, isActive: boolean) {
    const { error } = await supabase.from('film_pass_types').update({ is_active: !isActive }).eq('id', id);
    if (error) toast.error(error.message);
    else loadData();
  }

  /**
   * Delete a pass *type* — not a pass. The two are a click apart in this tab
   * and mean very different things, so the refusals below say which is which.
   *
   * A type that has issued passes cannot be deleted, and should not be: the
   * database refuses it (ON DELETE RESTRICT) because deleting the type would
   * orphan passes patrons are holding in their wallets. Retiring a type is
   * what the Active switch is for — an inactive type stops being offered and
   * stops accepting new print runs, while the passes already out there keep
   * working until they expire.
   *
   * This used to hand Postgres's own words to the admin: "violates foreign key
   * constraint user_film_passes_pass_type_id_fkey". True, and useless — it
   * names an internal constraint rather than the thing to do about it.
   */
  async function deleteType(pt: FilmPassType) {
    const issued = typePassCounts[pt.id] ?? 0;

    if (issued > 0) {
      toast.error(
        `"${pt.name}" has ${issued} pass${issued === 1 ? '' : 'es'} issued against it, ` +
          'so it cannot be deleted. Switch it to Inactive to retire it — passes already ' +
          'out there keep working. To delete it outright, clear those passes first under ' +
          'Issued Passes.',
        { duration: 10000 },
      );
      return;
    }

    if (!confirm(
      `Delete the pass type "${pt.name}"?\n\nThis removes the type itself, not any pass. ` +
      'No passes have been issued against it.',
    )) return;

    // .select() because a delete blocked by RLS comes back as a success with
    // no rows — the row count is the only thing that says anything happened.
    const { data, error } = await supabase
      .from('film_pass_types')
      .delete()
      .eq('id', pt.id)
      .select('id');

    if (error) {
      // Almost always the same foreign key, lost to a race: somebody minted a
      // batch against this type between the count above and this click.
      console.error('[FilmPassesTab] deleteType failed', error);
      toast.error(
        error.code === '23503'
          ? `"${pt.name}" has passes issued against it now — reload and check Issued Passes.`
          : `Could not delete "${pt.name}".`,
      );
      return;
    }
    if (!data || data.length === 0) {
      toast.error('That did not delete — check your permissions.');
      return;
    }

    toast.success(`Deleted the "${pt.name}" pass type`);
    loadData();
  }

  /** "Pass 1042 (Jane Smith)" — what a confirmation dialog has to name. */
  function passLabel(pass: SearchedPass): string {
    const id = pass.pass_number ? `Pass ${pass.pass_number}` : pass.qr_code || 'this pass';
    return `${id} (${holderLabel(pass)})`;
  }

  async function voidPass(pass: SearchedPass) {
    if (!confirm(
      `Cancel ${passLabel(pass)}?\n\nThe pass stops working immediately. Any balance on it is lost — refund from the till separately if that is the agreement.`,
    )) return;

    try {
      await invokeFunction('film-pass-checkout', { action: 'void', pass_id: pass.id });
      toast.success('Pass cancelled');
      loadPasses(0);
    } catch (err: any) {
      toast.error(err.message || 'Could not cancel that pass');
    }
  }

  /**
   * Delete: housekeeping, and irreversible.
   *
   * The dialog is built rather than fixed because the consequences differ by
   * status, and the one thing a person needs at the moment of clicking is the
   * consequence *of this pass*. A generic "are you sure?" gives them nothing
   * to be sure about — most importantly it hides the redemption count, which
   * is the only warning that deleting this row also removes people from past
   * attendance figures.
   */
  async function deletePass(pass: SearchedPass) {
    const lines = [
      `Delete ${passLabel(pass)}?`,
      '',
      'The pass record is removed permanently. This cannot be undone.',
    ];

    if (pass.redemption_count > 0) {
      lines.push(
        '',
        `${pass.redemption_count} recorded admission${pass.redemption_count === 1 ? '' : 's'} ` +
          'will be deleted with it, so past attendance figures will drop by that much.',
      );
    }
    if (pass.status === 'unassigned') {
      lines.push('', 'If that sticker has been printed, it will stop working when scanned.');
    }
    if (!confirm(lines.join('\n'))) return;

    try {
      const data = await invokeFunction<{ redemptions_removed: number }>('film-pass-checkout', {
        action: 'delete',
        pass_id: pass.id,
      });
      // Reported after the fact as well as warned about before it: the count
      // in the dialog was read from a list that may have been minutes old.
      toast.success(
        data.redemptions_removed > 0
          ? `Pass deleted, along with ${data.redemptions_removed} admission${
              data.redemptions_removed === 1 ? '' : 's'
            }.`
          : 'Pass deleted',
      );
      loadPasses(0);
      // Deleting the last pass on a type is what makes that type deletable, so
      // the "N issued" badge has to move with it or Delete stays wrongly barred.
      loadData();
    } catch (err: any) {
      toast.error(err.message || 'Could not delete that pass');
    }
  }

  // The panel takes the shared PassTypeOption shape so it reads the same
  // fields the showing form does; numerics arrive from PostgREST as strings.
  const eligibilityOptions: PassTypeOption[] = passTypes.map(pt => ({
    id: pt.id,
    name: pt.name,
    redemption_price: Number(pt.redemption_price ?? 0),
    per_showing_use_limit: pt.per_showing_use_limit ?? null,
    is_default_for_movies: !!pt.is_default_for_movies,
    is_active: !!pt.is_active,
  }));

  return (
    <div className="space-y-6">
      {/* ---- Waiting to be handed over ----
          A mirror of the box office queue (FilmPassPOS), read-only. Activation
          needs a blank sticker under a scanner, which is a counter job — but a
          paid order that nobody has posted or handed over is an open
          obligation, and the admin dashboard is where someone thinks to look
          for it. Both views read the same `queue` action, so they cannot
          disagree about what is outstanding. */}
      <CollapsibleSection
        id="passes.queue"
        title="Waiting to be handed over"
        icon={Package}
        count={queue.length}
        defaultOpen
        actions={
          queue.length > 0 ? (
            <Button size="sm" variant="outline" asChild>
              <Link to="/staff/pos">
                <ScanLine className="h-4 w-4 mr-1" /> Activate at the counter
              </Link>
            </Button>
          ) : undefined
        }
      >
        {loadingQueue ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </p>
        ) : queueError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">
              Could not load outstanding orders — {queueError}
            </p>
            <p className="text-xs text-muted-foreground">
              This is not the same as "nothing outstanding". Retry, and check the box
              office queue before assuming there is nothing to post.
            </p>
            <Button size="sm" variant="outline" onClick={loadQueue}>Retry</Button>
          </div>
        ) : queue.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing outstanding — every paid pass has been handed over or posted.
          </p>
        ) : (
          <div className="space-y-3">
            {queue.map(o => {
              const address = formatMailingAddress(o.mailing_address);
              return (
                <div key={o.id} className="p-4 rounded-lg bg-secondary/50 space-y-2">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                    <div className="min-w-0 space-y-1">
                      <p className="font-medium text-sm flex items-center gap-1.5">
                        {o.fulfillment === 'mail' ? (
                          <Mail className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        ) : (
                          <Store className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        )}
                        <span className="truncate">{passOrderBuyerLabel(o)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {o.quantity} × {o.pass_type_name} · ${o.amount_paid.toFixed(2)} paid ·{' '}
                        {formatShowtime(o.created_at, 'MMM d')}
                      </p>
                      {o.buyer_email && (
                        <p className="text-xs text-muted-foreground break-all">{o.buyer_email}</p>
                      )}
                      {o.buyer_phone && (
                        <p className="text-xs text-muted-foreground">{o.buyer_phone}</p>
                      )}
                      {/* Shown in full: posting is a manual job and this is the
                          label the staff member has to write. */}
                      {o.fulfillment === 'mail' && (
                        address ? (
                          <p className="text-xs text-muted-foreground mt-1">Post to: {address}</p>
                        ) : (
                          <p className="text-xs text-destructive mt-1">
                            Mail order with no address on file — contact the buyer before posting.
                          </p>
                        )
                      )}
                    </div>
                    <Badge variant={o.fulfillment === 'mail' ? 'default' : 'secondary'} className="shrink-0 self-start">
                      {o.fulfillment === 'mail' ? 'To post' : 'Pickup'}
                    </Badge>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CollapsibleSection>

      {/* Open by default, empty state included: an admin opening this tab is
          asking "is anything outstanding?", and a silent absence is not an
          answer. The counter hides it when empty instead. Collapsible, so an
          admin who has dealt with the post can put it away — but the count on
          the header still answers the question without expanding it. */}
      <CollapsibleSection
        id="passes.to-post"
        title="To be posted"
        icon={Mail}
        count={awaitingPost.length}
        defaultOpen
      >
        <MailQueueCard
          bare
          orders={awaitingPost}
          loading={loadingQueue}
          error={queueError}
          onRetry={loadQueue}
          onMarkPosted={markPosted}
        />
      </CollapsibleSection>

      {/* Pass Types */}
      <CollapsibleSection
        id="passes.types"
        title="Film Pass Types"
        count={passTypes.length}
        actions={({ open }) => (
          <Button
            size="sm"
            onClick={() => {
              // Opening the section first: the form this toggles lives inside it.
              if (!showForm) open();
              showForm ? closeForm() : setShowForm(true);
            }}
          >
            <Plus className="h-4 w-4 mr-1" /> Add Pass Type
          </Button>
        )}
      >
        {showForm && (
          <Card className="glass">
            <CardContent className="p-4 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Name</Label>
                  <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. 10-Film Pass" />
                </div>
                <div className="space-y-2">
                  <Label>Sale Price ($)</Label>
                  <Input type="number" step="0.01" value={form.price} onChange={e => setForm(f => ({ ...f, price: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Initial Balance ($)</Label>
                  <Input type="number" step="0.01" value={form.initial_balance} onChange={e => setForm(f => ({ ...f, initial_balance: e.target.value }))} />
                </div>
                <div className="space-y-2">
                  <Label>Cost Per Admission ($)</Label>
                  <Input type="number" step="0.01" value={form.redemption_price} onChange={e => setForm(f => ({ ...f, redemption_price: e.target.value }))} />
                  <p className="text-xs text-muted-foreground">
                    Deducted at the door. Balance ÷ this is how many films the pass is worth.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Ticket Face Value ($, blank = don't say)</Label>
                  <Input
                    type="number"
                    step="0.01"
                    value={form.ticket_face_value}
                    onChange={e => setForm(f => ({ ...f, ticket_face_value: e.target.value }))}
                    placeholder="8"
                  />
                  <p className="text-xs text-muted-foreground">
                    What one of these seats costs at the window — the price the holder
                    avoids paying, not the {'\u201C'}cost per admission{'\u201D'} above. This is what makes
                    the pass a deal, and it is what the confirmation email and the
                    passes page quote. Leave blank and both state the film count
                    without a price.
                  </p>
                </div>
                <div className="space-y-2">
                  <Label>Expiration (days, blank = none)</Label>
                  <Input type="number" value={form.expiration_days} onChange={e => setForm(f => ({ ...f, expiration_days: e.target.value }))} placeholder="365" />
                  <p className="text-xs text-muted-foreground">Counted from activation, not from purchase.</p>
                </div>
                <div className="space-y-2">
                  <Label>Uses per screening</Label>
                  <Input
                    type="number"
                    min={1}
                    value={form.per_showing_use_limit}
                    onChange={e => setForm(f => ({ ...f, per_showing_use_limit: e.target.value }))}
                    placeholder="blank = unlimited"
                  />
                  <p className="text-xs text-muted-foreground">
                    How many people one pass may admit to a single screening. Blank lets the holder
                    bring friends, bounded only by the balance. Set 1 for one admission each.
                  </p>
                </div>
              </div>

              {/* The successor to showings.film_pass_eligible defaulting to true.
                  Without a pass carrying this, every screening created from now
                  on would start eligible for nothing, and the standard pass would
                  stop working at the door with no error anywhere. */}
              <label className="flex items-start gap-2 text-sm cursor-pointer border-t border-border pt-4">
                <input
                  type="checkbox"
                  checked={form.is_default_for_movies}
                  onChange={e => setForm(f => ({ ...f, is_default_for_movies: e.target.checked }))}
                  className="rounded mt-0.5"
                />
                <span>
                  <span className="font-semibold">Standard pass for ordinary films</span>
                  <span className="block text-xs text-muted-foreground">
                    Pre-ticked on new movie screenings priced at the standard $8. Leave this off for
                    a festival pass or anything else valid only at screenings you tag by hand.
                  </span>
                </span>
              </label>

              {/* Which festival page, if any, advertises this pass.
                  The page finds its pass by this value rather than by name,
                  because the name is editable here and three duplicate
                  "SILENT FILM FESTIVAL PASS" SKUs already exist in Square. It
                  controls only what that page shows; what the pass admits to is
                  still the screenings tagged under Eligibility. */}
              <div className="border-t border-border pt-4">
                <Label htmlFor="festival-slug">Festival page (optional)</Label>
                <Input
                  id="festival-slug"
                  placeholder="silent-film-festival"
                  value={form.festival_slug}
                  onChange={e => setForm(f => ({ ...f, festival_slug: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  Leave blank for an ordinary pass. Enter{' '}
                  <code className="font-mono">silent-film-festival</code> to make this the pass
                  sold on the Silent Film Festival page. One pass per festival.
                </p>
              </div>

              {/* Printed under the order summary for whichever pass is selected.
                  It used to be one sentence hard-coded into the page, which meant
                  the festival pass was sold beneath a line saying it was not
                  valid at special events. */}
              <div className="border-t border-border pt-4">
                <Label htmlFor="pass-fine-print">Validity note on the purchase page</Label>
                <RichTextEditor
                  id="pass-fine-print"
                  rows={2}
                  placeholder="Valid on standard movies. Not on special events or premium screenings."
                  value={form.fine_print}
                  onChange={fine_print => setForm(f => ({ ...f, fine_print }))}
                />
                <p className="text-xs text-muted-foreground mt-1">
                  One line saying where this pass is and is not valid. Leave blank to
                  print nothing — better than a sentence that is wrong for this pass.
                </p>
              </div>

              {/* Shown beside the pass on /film-passes and on a festival page.
                  Optional throughout — without one both surfaces draw the ticket
                  icon they always have. */}
              <div className="border-t border-border pt-4">
                <Label htmlFor="pass-image">Pass image (optional)</Label>
                <div className="flex items-center gap-3 mt-1">
                  {(imageFile || existingImage) && (
                    <img
                      src={imageFile ? URL.createObjectURL(imageFile) : passImageUrl(existingImage!)}
                      alt=""
                      className="w-14 h-18 rounded object-cover border border-border bg-background shrink-0"
                    />
                  )}
                  <div className="flex-1 min-w-0">
                    <Input
                      id="pass-image"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      onChange={e => setImageFile(e.target.files?.[0] || null)}
                    />
                    <p className="text-xs text-muted-foreground mt-1">
                      {existingImage && !imageFile
                        ? 'An image is set. Choosing a file replaces it.'
                        : 'Portrait artwork works best — it is shown at roughly 3:4.'}
                    </p>
                  </div>
                </div>
              </div>

              <div className="flex gap-2">
                <Button onClick={handleSaveType}>{editingId ? 'Save changes' : 'Create'}</Button>
                <Button variant="outline" onClick={closeForm}>Cancel</Button>
              </div>
            </CardContent>
          </Card>
        )}

        <div className="space-y-3">
          {passTypes.map(pt => (
            <Card key={pt.id} className="glass">
              <CardContent className="p-4 flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <CreditCard className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{pt.name}</p>
                    <div className="flex flex-wrap gap-2 mt-1">
                      <Badge variant="outline" className="text-xs">${Number(pt.price).toFixed(2)} sale price</Badge>
                      <Badge variant="outline" className="text-xs">${Number(pt.initial_balance).toFixed(2)} balance</Badge>
                      <Badge variant="outline" className="text-xs">
                        ${Number(pt.redemption_price).toFixed(2)} per film ·{' '}
                        {Math.floor(Number(pt.initial_balance) / Number(pt.redemption_price || 1))} films
                      </Badge>
                      {pt.expiration_days && <Badge variant="secondary" className="text-xs">{pt.expiration_days} day expiry</Badge>}
                      <Badge variant="outline" className="text-xs">
                        {pt.per_showing_use_limit === null
                          ? 'Unlimited per screening'
                          : `Max ${pt.per_showing_use_limit} per screening`}
                      </Badge>
                      {pt.is_default_for_movies && (
                        <Badge variant="secondary" className="text-xs">Standard — auto on new films</Badge>
                      )}
                      <Badge variant={pt.is_active ? 'default' : 'secondary'} className="text-xs">
                        {pt.is_active ? 'Active' : 'Inactive'}
                      </Badge>
                      {/* Shown because it is the reason Delete will refuse. A
                          constraint you only meet by tripping over it is a trap. */}
                      {(typePassCounts[pt.id] ?? 0) > 0 && (
                        <Badge variant="outline" className="text-xs">
                          {typePassCounts[pt.id]} issued
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Switch checked={pt.is_active} onCheckedChange={() => toggleActive(pt.id, pt.is_active)} />
                  <Button variant="ghost" size="sm" onClick={() => startEdit(pt)} title="Edit this pass type">
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteType(pt)}
                    title={
                      (typePassCounts[pt.id] ?? 0) > 0
                        ? `Cannot delete — ${typePassCounts[pt.id]} pass(es) issued. Switch to Inactive to retire it.`
                        : 'Delete this pass type'
                    }
                  >
                    <Trash2 className="h-4 w-4 text-destructive" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
          {passTypes.length === 0 && <p className="text-muted-foreground text-center py-8">No film pass types configured.</p>}
        </div>
      </CollapsibleSection>

      {/* Eligibility, directly under the pass types that carry it. A pass is
          defined above and given its screenings here, which is the order the
          job is actually done in — creating a festival pass and then hunting
          through the schedule for its run is the same task split across two
          screens. */}
      <CollapsibleSection id="passes.eligibility" title="Screenings & Passes">
        {passTypes.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Create a pass type above before tagging screenings.
          </p>
        ) : (
          <PassEligibilityPanel passTypes={eligibilityOptions} />
        )}
      </CollapsibleSection>

      {/* Print QRs — the same panel the Staff section mounts. Kept here
          because pass types are managed on this tab, and choosing which type a
          run of stickers belongs to is the one decision it needs.

          The section id stays `passes.stickers` on purpose: it is the
          localStorage key for the remembered open/closed state, and renaming
          it would quietly reset everyone's preference. The heading is what
          changed, not the switch behind it. */}
      <CollapsibleSection id="passes.stickers" title="Print QRs" count={batches.length}>
        <PrintQrPanel
          batches={batches}
          onReloadBatches={reloadBatches}
          onMinted={() => {
            // A fresh batch writes pass rows: it is the usual way a type stops
            // being deletable, and the Issued Passes list just got longer.
            loadData();
            loadPasses(0);
          }}
        />
      </CollapsibleSection>

      {/* ---- Issued passes ----
          Searched, filtered and sorted in the database. The list used to be
          the newest 50 rows with no controls, which is fine as a dashboard and
          wrong as a register: the pass somebody is asking about at the counter
          is exactly the one that has aged off the bottom. */}
      <CollapsibleSection id="passes.issued" title="Issued Passes" count={total}>
        <Card className="glass">
          <CardContent className="p-4 space-y-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto]">
              <div className="space-y-2">
                <Label htmlFor="pass-search">Search</Label>
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                  <Input
                    id="pass-search"
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    placeholder="Pass number, name, email, phone or QR code"
                    className="pl-8 pr-8"
                  />
                  {search && (
                    <button
                      type="button"
                      aria-label="Clear search"
                      onClick={() => setSearch('')}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label>Status</Label>
                <Select value={statusFilter} onValueChange={setStatusFilter}>
                  <SelectTrigger className="sm:w-52"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_FILTERS.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Sort</Label>
                <Select value={sort} onValueChange={setSort}>
                  <SelectTrigger className="sm:w-48"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SORTS.map(s => (
                      <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Counts describe the search, not the current filter — so they say
                in advance what switching the filter will turn up, and clicking
                one is the fastest way to get there. */}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {COUNT_ORDER.filter(s => (counts[s] ?? 0) > 0).map(s => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setStatusFilter(s)}
                  className="focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-full"
                >
                  <Badge
                    variant={statusFilter === s ? (STATUS_VARIANT[s] ?? 'secondary') : 'outline'}
                    className="text-xs cursor-pointer"
                  >
                    {counts[s]} {STATUS_LABEL[s] ?? s}
                  </Badge>
                </button>
              ))}
              {Object.keys(counts).length === 0 && !loadingPasses && (
                <span className="text-xs text-muted-foreground">Nothing matches that search.</span>
              )}
            </div>
          </CardContent>
        </Card>

        {passesError ? (
          <div className="space-y-2">
            <p className="text-sm text-destructive">Could not search the passes — {passesError}</p>
            <p className="text-xs text-muted-foreground">
              This is not the same as "no such pass". Retry before telling anyone their pass is
              not in the system.
            </p>
            <Button size="sm" variant="outline" onClick={() => loadPasses(0)}>Retry</Button>
          </div>
        ) : loadingPasses ? (
          <p className="text-sm text-muted-foreground flex items-center gap-2 py-6 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" /> Searching…
          </p>
        ) : passes.length === 0 ? (
          <p className="text-muted-foreground text-center py-8">
            {query.trim()
              ? 'No pass matches that search.'
              : 'No passes issued yet.'}
          </p>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">
              Showing {passes.length} of {total}
              {query.trim() ? ' matching' : ''} {total === 1 ? 'pass' : 'passes'}.
            </p>

            {passes.map(up => (
              <Card key={up.id} className="glass">
                <CardContent className="p-4 flex items-start justify-between gap-3">
                  <div className="flex items-start gap-3 min-w-0 flex-1">
                    <DollarSign className="h-5 w-5 text-primary shrink-0 mt-0.5" />
                    <div className="min-w-0 flex-1">
                      <p className="font-medium flex flex-wrap items-baseline gap-x-2">
                        {up.pass_number !== null && (
                          <span className="font-mono text-sm text-muted-foreground">
                            #{up.pass_number}
                          </span>
                        )}
                        <span>{holderLabel(up)}</span>
                      </p>
                      <div className="flex flex-wrap gap-2 mt-1">
                        {up.pass_type_name && (
                          <Badge variant="outline" className="text-xs">{up.pass_type_name}</Badge>
                        )}
                        {up.remaining_balance !== null && (
                          <Badge variant="secondary" className="text-xs">
                            ${Number(up.remaining_balance).toFixed(2)} remaining
                          </Badge>
                        )}
                        <Badge variant={STATUS_VARIANT[up.status] ?? 'secondary'} className="text-xs">
                          {STATUS_LABEL[up.status] ?? up.status}
                        </Badge>
                        {up.payment_method && (
                          <Badge variant="outline" className="text-xs">{up.payment_method}</Badge>
                        )}
                        {up.redemption_count > 0 && (
                          <Badge variant="outline" className="text-xs">
                            {up.redemption_count} admitted
                          </Badge>
                        )}
                        {up.expires_at && (
                          <Badge
                            variant={new Date(up.expires_at) < new Date() ? 'destructive' : 'secondary'}
                            className="text-xs"
                          >
                            {new Date(up.expires_at) < new Date()
                              ? 'Expired'
                              : `Expires ${formatShowtime(up.expires_at, 'MMM d, yyyy')}`}
                          </Badge>
                        )}
                      </div>
                      {/* Shown because they are searchable: a staff member who
                          found this row by typing an email should be able to see
                          which email matched. */}
                      {contactLines(up).length > 0 && (
                        <p className="text-xs text-muted-foreground break-all mt-1">
                          {contactLines(up).join(' · ')}
                        </p>
                      )}
                      {up.qr_code && (
                        <p className="text-xs font-mono text-muted-foreground break-all mt-1">
                          {up.qr_code}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {up.status !== 'void' && (
                      <Button variant="ghost" size="sm" onClick={() => voidPass(up)} title="Cancel this pass">
                        <Ban className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                    {/* Active and expired passes are absent here on purpose:
                        cancel is the step that decides a pass is finished, and
                        delete only clears up after it. */}
                    {DELETABLE_STATUSES.has(up.status) && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => deletePass(up)}
                        title="Delete this pass permanently"
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            ))}

            {passes.length < total && (
              <div className="flex justify-center pt-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => loadPasses(passes.length)}
                >
                  {loadingMore ? (
                    <><Loader2 className="h-4 w-4 mr-1 animate-spin" /> Loading…</>
                  ) : (
                    `Show ${Math.min(PAGE_SIZE, total - passes.length)} more`
                  )}
                </Button>
              </div>
            )}
          </div>
        )}
      </CollapsibleSection>
    </div>
  );
}
