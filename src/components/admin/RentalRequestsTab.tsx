import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Copy, ExternalLink, Trash2, Eye, FileText, Link2, Receipt, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { formatPlainDateRange } from '@/lib/datetime';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { invokeFunction } from '@/lib/functions';
import RentalInvoiceLines from './RentalInvoiceLines';

type RentalRequest = any;

const STATUS_OPTIONS = ['pending', 'reviewing', 'approved', 'declined', 'archived'] as const;

const STATUS_VARIANT: Record<string, 'default' | 'secondary' | 'outline' | 'destructive'> = {
  pending: 'default',
  reviewing: 'secondary',
  approved: 'default',
  declined: 'destructive',
  archived: 'outline',
};

export default function RentalRequestsTab() {
  const [requests, setRequests] = useState<RentalRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('all');
  const [open, setOpen] = useState<RentalRequest | null>(null);
  const [lineCounts, setLineCounts] = useState<Record<string, number>>({});
  const [generating, setGenerating] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const [{ data, error }, lines] = await Promise.all([
      supabase
        .from('rental_requests')
        .select('*')
        .order('submitted_at', { ascending: false }),
      // Just the owning ids: enough to know which requests have something to
      // bill, without loading every line of every rental to find out.
      fetchAllRows<{ rental_request_id: string }>((from, to) =>
        supabase
          .from('rental_invoice_lines' as any)
          .select('rental_request_id')
          .order('rental_request_id')
          .range(from, to) as any),
    ]);
    if (error) toast.error(error.message);
    if (lines.error) toast.error((lines.error as any).message);

    const counts: Record<string, number> = {};
    for (const line of lines.data) {
      counts[line.rental_request_id] = (counts[line.rental_request_id] || 0) + 1;
    }
    setLineCounts(counts);
    setRequests(data || []);
    // Keep an open details dialog looking at the row that was just reloaded,
    // or it goes on showing the invoice state from before the click.
    setOpen(prev => (prev ? (data || []).find(r => r.id === prev.id) || prev : prev));
    setLoading(false);
  }

  /**
   * Build the Square invoice from this request's invoice lines.
   *
   * The function creates a DRAFT and stops — staff send it from Square. A
   * second click cannot open a second invoice: the server answers with the
   * existing one unless `regenerate` is asked for explicitly, and a
   * regeneration deletes the old draft in Square first.
   */
  async function generateInvoice(request: RentalRequest, regenerate = false) {
    if (
      regenerate &&
      !confirm('Replace this rental\'s Square invoice? The current draft is deleted in Square and a new one built from the lines below.')
    ) return;

    setGenerating(request.id);
    try {
      const result = await invokeFunction<{
        invoice_url?: string;
        status?: string;
        already_generated?: boolean;
        warning?: string | null;
        total_cents?: number | null;
      }>('square-invoice', { rental_request_id: request.id, regenerate });

      if (result.warning) toast.warning(result.warning);
      if (result.already_generated) {
        toast.info('This rental already has a Square invoice');
      } else {
        const amount = typeof result.total_cents === 'number'
          ? ` — $${(result.total_cents / 100).toFixed(2)}`
          : '';
        toast.success(`Draft invoice created in Square${amount}. Review and send it there.`);
      }
      await load();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setGenerating(null);
    }
  }

  useEffect(() => { load(); }, []);

  const publicFormUrl = `${window.location.origin}/rental-request`;

  const filtered = filter === 'all' ? requests : requests.filter(r => r.status === filter);

  async function updateStatus(id: string, status: string) {
    const { error } = await supabase.from('rental_requests').update({ status: status as any }).eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Status updated'); load(); }
  }

  async function saveNotes(id: string, admin_notes: string) {
    const { error } = await supabase.from('rental_requests').update({ admin_notes }).eq('id', id);
    if (error) toast.error(error.message);
    else toast.success('Notes saved');
  }

  async function deleteRequest(id: string) {
    if (!confirm('Delete this rental request? This cannot be undone.')) return;
    const { error } = await supabase.from('rental_requests').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Deleted'); setOpen(null); load(); }
  }

  function copyLink(token?: string) {
    const url = token ? `${publicFormUrl}?token=${token}` : publicFormUrl;
    navigator.clipboard.writeText(url);
    toast.success('Link copied to clipboard');
  }

  return (
    <div className="space-y-4">
      <CollapsibleSection id="rentals.public-form" title="Public rental form">
        <p className="font-serif text-xs text-muted-foreground break-all">{publicFormUrl}</p>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" onClick={() => copyLink()}>
            <Copy className="h-4 w-4 mr-1" /> Copy link
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={publicFormUrl} target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 mr-1" /> Open
            </a>
          </Button>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="rentals.requests"
        title="Rental Requests"
        count={filtered.length}
        defaultOpen
        actions={
          <Select value={filter} onValueChange={setFilter}>
            <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All</SelectItem>
              {STATUS_OPTIONS.map(s => (
                <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      >
        {loading ? (
          <p className="text-muted-foreground text-center py-8">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground text-center py-8 font-serif">No rental requests {filter !== 'all' && `with status "${filter}"`}.</p>
        ) : (
          <div className="space-y-3">
            {filtered.map(r => (
              <Card key={r.id} className="glass">
                <CardContent className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{r.event_title}</p>
                      <Badge variant={STATUS_VARIANT[r.status]} className="capitalize text-xs">{r.status}</Badge>
                    </div>
                    <p className="font-serif text-xs text-muted-foreground mt-1">
                      {r.applicant_name} • {r.email}
                      {r.proposed_date && ` • ${formatPlainDateRange(r.proposed_date, r.end_date)}`}
                    </p>
                    <p className="font-serif text-xs text-muted-foreground">
                      Submitted {format(new Date(r.submitted_at), 'MMM d, yyyy h:mm a')}
                    </p>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button size="sm" variant="outline" asChild title="Open contract">
                      <a href={`/contract/${r.invite_token}`} target="_blank" rel="noreferrer">
                        <FileText className="h-4 w-4 mr-1" /> Contract
                      </a>
                    </Button>
                    {r.square_invoice_id ? (
                      <Button
                        size="sm"
                        variant="outline"
                        asChild
                        title={`Square invoice — ${(r.square_invoice_status || 'draft').toLowerCase()}`}
                      >
                        <a href={r.square_invoice_url} target="_blank" rel="noreferrer">
                          <Receipt className="h-4 w-4 mr-1" /> View Invoice
                        </a>
                      </Button>
                    ) : (
                      // A disabled button swallows its own tooltip, so the reason
                      // it is disabled lives on the wrapper.
                      <span title={lineCounts[r.id] ? 'Create a draft invoice in Square' : 'Add invoice lines under Details first'}>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!lineCounts[r.id] || generating === r.id}
                          onClick={() => generateInvoice(r)}
                        >
                          <Receipt className="h-4 w-4 mr-1" />
                          {generating === r.id ? 'Generating…' : 'Generate Invoice'}
                        </Button>
                      </span>
                    )}
                    <Button size="sm" variant="ghost" title="Copy contract link for renter" onClick={() => {
                      navigator.clipboard.writeText(`${window.location.origin}/contract/${r.invite_token}`);
                      toast.success('Renter contract link copied');
                    }}>
                      <Link2 className="h-4 w-4" />
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setOpen(r)}>
                      <Eye className="h-4 w-4 mr-1" /> Details
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </CollapsibleSection>

      <Dialog open={!!open} onOpenChange={v => !v && setOpen(null)}>
        <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
          {open && (
            <RequestDetail
              request={open}
              onStatus={(s) => updateStatus(open.id, s)}
              onSaveNotes={(n) => saveNotes(open.id, n)}
              onDelete={() => deleteRequest(open.id)}
              onGenerateInvoice={(regenerate) => generateInvoice(open, regenerate)}
              generating={generating === open.id}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function RequestDetail({ request: r, onStatus, onSaveNotes, onDelete, onGenerateInvoice, generating }: {
  request: RentalRequest;
  onStatus: (s: string) => void;
  onSaveNotes: (n: string) => void;
  onDelete: () => void;
  onGenerateInvoice: (regenerate: boolean) => void;
  generating: boolean;
}) {
  const [notes, setNotes] = useState(r.admin_notes || '');
  const equipment = (r.equipment && typeof r.equipment === 'object') ? r.equipment as Record<string, number> : {};
  const equipmentEntries = Object.entries(equipment);

  return (
    <>
      <DialogHeader>
        <DialogTitle className="font-display text-2xl uppercase">{r.event_title}</DialogTitle>
      </DialogHeader>

      <div className="flex items-center gap-3 flex-wrap">
        <Label className="font-serif text-xs">Status</Label>
        <Select value={r.status} onValueChange={onStatus}>
          <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            {STATUS_OPTIONS.map(s => (
              <SelectItem key={s} value={s} className="capitalize">{s}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="ghost" onClick={onDelete} className="ml-auto text-destructive">
          <Trash2 className="h-4 w-4 mr-1" /> Delete
        </Button>
      </div>

      <DetailSection title="Contact">
        <KV k="Applicant" v={r.applicant_name} />
        <KV k="Organization" v={r.organization_name} />
        <KV k="Email" v={r.email} />
        <KV k="Phone" v={r.phone} />
        <KV k="Secondary contact" v={[r.secondary_contact_name, r.secondary_contact_email, r.secondary_contact_phone].filter(Boolean).join(' • ')} />
      </DetailSection>

      <DetailSection title="Event">
        <KV k={r.end_date ? 'Proposed dates' : 'Proposed date'} v={formatPlainDateRange(r.proposed_date, r.end_date, { month: 'long' }) || null} />
        <KV k="Venue area" v={r.venue_area?.replace(/_/g, ' ')} />
        <KV k="Arrival" v={r.arrival_time} />
        <KV k="Event start" v={r.event_start_time} />
        <KV k="Event end" v={r.event_end_time} />
        <KV k="Departure" v={r.departure_time} />
        <KV k="Marquee text" v={r.marquee_text} />
      </DetailSection>

      <DetailSection title="Concessions & Ticketing">
        <KV k="Wants concessions" v={r.wants_concessions ? 'Yes' : 'No'} />
        <KV k="Wants beer & wine" v={r.wants_beer_wine ? 'Yes' : 'No'} />
        <KV k="Ticketed" v={r.is_ticketed ? 'Yes' : 'No'} />
        <KV k="Open to public" v={r.is_public ? 'Yes' : 'No'} />
        <KV k="Needs digital ticketing" v={r.needs_digital_ticketing ? 'Yes' : 'No'} />
      </DetailSection>

      <DetailSection title="Guests">
        <KV k="Expected guests" v={r.expected_guests} />
        <KV k="Age range" v={r.age_range} />
        <KV k="Special needs" v={r.special_needs} />
        <KV k="Accessibility" v={r.accessibility_requirements} />
      </DetailSection>

      <DetailSection title="Equipment">
        {equipmentEntries.length === 0
          ? <p className="font-serif text-sm text-muted-foreground">None requested.</p>
          : equipmentEntries.map(([k, n]) => (
              <KV key={k} k={k.replace(/_/g, ' ')} v={String(n)} />
            ))}
      </DetailSection>

      <DetailSection title="Film / Media">
        <KV k="Renter provides media" v={r.renter_provides_media ? 'Yes' : 'No'} />
        <KV k="Kenworthy provides media" v={r.kenworthy_provides_media ? 'Yes' : 'No'} />
        <KV k="Media notes" v={r.media_notes} />
      </DetailSection>

      <DetailSection title="Description">
        <KV k="Event description" v={r.event_description} multiline />
        <KV k="Activity order" v={r.activity_order} multiline />
      </DetailSection>

      <DetailSection title="Invoice">
        {r.square_invoice_id && (
          <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
            <div className="min-w-0">
              <p className="font-serif text-sm">
                Square invoice{' '}
                <span className="uppercase text-xs tracking-wider text-accent">
                  {(r.square_invoice_status || 'draft').toLowerCase()}
                </span>
              </p>
              <p className="font-serif text-xs text-muted-foreground">
                Generated {r.square_invoice_created_at ? format(new Date(r.square_invoice_created_at), 'MMM d, yyyy h:mm a') : '—'}
                {' • '}send it from Square
              </p>
            </div>
            <div className="flex gap-2 shrink-0">
              <Button size="sm" variant="outline" asChild>
                <a href={r.square_invoice_url} target="_blank" rel="noreferrer">
                  <ExternalLink className="h-4 w-4 mr-1" /> Open in Square
                </a>
              </Button>
              <Button size="sm" variant="ghost" disabled={generating} onClick={() => onGenerateInvoice(true)}>
                <RefreshCw className="h-4 w-4 mr-1" /> {generating ? 'Working…' : 'Regenerate'}
              </Button>
            </div>
          </div>
        )}
        <RentalInvoiceLines rentalRequestId={r.id} />
        {!r.square_invoice_id && (
          <div className="flex justify-end">
            <Button size="sm" variant="outline" disabled={generating} onClick={() => onGenerateInvoice(false)}>
              <Receipt className="h-4 w-4 mr-1" />
              {generating ? 'Generating…' : 'Generate Square invoice'}
            </Button>
          </div>
        )}
      </DetailSection>

      <DetailSection title="Admin notes">
        <Textarea rows={4} value={notes} onChange={e => setNotes(e.target.value)} placeholder="Internal notes…" />
        <Button size="sm" onClick={() => onSaveNotes(notes)}>Save notes</Button>
      </DetailSection>
    </>
  );
}

function DetailSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-2 border-t border-border/40 pt-4">
      <h3 className="font-display uppercase text-sm text-accent tracking-wide">{title}</h3>
      <div className="space-y-2">{children}</div>
    </section>
  );
}

function KV({ k, v, multiline }: { k: string; v: any; multiline?: boolean }) {
  if (v === null || v === undefined || v === '') return null;
  return (
    <div className={multiline ? 'space-y-1' : 'grid grid-cols-[160px_1fr] gap-3'}>
      <span className="font-serif text-xs uppercase text-muted-foreground tracking-wider capitalize">{k}</span>
      <span className="font-serif text-sm whitespace-pre-wrap">{v}</span>
    </div>
  );
}