import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ArrowLeft, Link2, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { formatClockTime, formatPlainDate, formatPlainDateRange } from '@/lib/datetime';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { blankTitle } from '@/lib/contracts';
import type { BlankFields } from '@/lib/blankFields';
import {
  blankToContractData,
  fieldDiffs,
  newRequestFrom,
  rankMatches,
  type FieldDiff,
  type LinkableRequest,
  type TermKey,
} from '@/lib/blankLink';

type Request = LinkableRequest & { invite_token: string };

const COLUMNS = 'id, event_title, applicant_name, organization_name, email, phone, event_description, proposed_date, end_date, event_start_time, event_end_time, signed_at, status, submitted_at, invite_token';

/**
 * Make a blank contract a rental request's contract: link it to a request
 * already in the queue, or create one from it. Either way it then has a renter
 * link, signing, an invoice and a place in review.
 *
 * Matches come first so the request a renter already sent is found before a
 * second one is made for the same rental. "Not now" leaves it a standalone
 * blank, listed as not linked.
 */
export default function LinkToRequestDialog({ open, fields, ensureBlankId, onLinked, onSkip, onClose, canSkip = true }: {
  open: boolean;
  fields: BlankFields;
  /** The blank's row id, saving it first if it has none yet. Throws why not. */
  ensureBlankId: () => Promise<string>;
  onLinked: (inviteToken: string) => void;
  onSkip: () => void;
  onClose: () => void;
  canSkip?: boolean;
}) {
  const [requests, setRequests] = useState<Request[] | null>(null);
  const [mode, setMode] = useState<'choose' | 'existing' | 'new'>('choose');
  const [picked, setPicked] = useState<Request | null>(null);
  const [search, setSearch] = useState('');
  // Per difference, true = keep what was typed. Default: the request's.
  const [useTyped, setUseTyped] = useState<Record<string, boolean>>({});
  const [details, setDetails] = useState({ event_title: '', applicant_name: '', email: '', organization_name: '', phone: '' });
  const [working, setWorking] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode('choose');
    setPicked(null);
    setSearch('');
    setDetails({
      event_title: blankTitle(fields),
      applicant_name: fields.name.trim(),
      email: fields.email.trim(),
      organization_name: fields.organization.trim(),
      phone: fields.phone.trim(),
    });
    (async () => {
      const { data, error } = await fetchAllRows<Request>((from, to) =>
        supabase.from('rental_requests').select(COLUMNS).order('id').range(from, to) as any);
      if (error) toast.error((error as any).message);
      setRequests(data);
    })();
    // Read the form as it is when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const matches = useMemo(() => (requests ? rankMatches(fields, requests) : []), [requests, fields]);
  const searched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q || !requests) return [];
    return requests
      .filter(r => [r.event_title, r.applicant_name, r.organization_name, r.email].some(v => (v ?? '').toLowerCase().includes(q)))
      .sort((a, b) => b.submitted_at.localeCompare(a.submitted_at))
      .slice(0, 20);
  }, [search, requests]);
  const diffs = useMemo(() => (picked ? fieldDiffs(fields, picked) : []), [picked, fields]);
  const strongMatch = matches.find(m => m.score >= 3 && !m.request.signed_at);

  function pick(r: Request) {
    setPicked(r);
    setUseTyped({});
    setMode('existing');
  }

  async function link(requestId: string | null) {
    setWorking(true);
    try {
      const blankId = await ensureBlankId();
      const chosen = (k: FieldDiff) => !!useTyped[k.key];
      const patch = requestId
        ? Object.fromEntries(diffs.filter(d => d.kind === 'identity' && chosen(d)).map(d => [d.key, d.blank]))
        : {};
      const term = requestId ? diffs.filter(d => d.kind === 'term' && chosen(d)).map(d => d.key as TermKey) : [];
      const { data, error } = await supabase.rpc('link_blank_contract', {
        p_blank_id: blankId,
        p_request_id: requestId,
        p_new: requestId ? null : newRequestFrom(fields, details),
        p_patch: patch,
        p_contract_data: blankToContractData(fields, term),
      } as any);
      if (error) throw new Error(error.message);
      const row = (data as { invite_token: string }[] | null)?.[0];
      if (!row) throw new Error('Not linked: no request came back.');
      onLinked(row.invite_token);
    } catch (e: any) {
      toast.error(e?.message || 'Could not link the contract');
    } finally {
      setWorking(false);
    }
  }

  const newValid = details.event_title.trim() && details.applicant_name.trim() && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(details.email.trim());

  return (
    <Dialog open={open} onOpenChange={v => !v && !working && onClose()}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display uppercase">Which rental request is this for?</DialogTitle>
          <DialogDescription className="font-serif">
            A contract needs a rental request behind it for the renter link, signing, the invoice and review.
            Link it to the request already in, or create one. From then on it is that request's contract.
          </DialogDescription>
        </DialogHeader>

        {mode === 'choose' && (
          <div className="space-y-4">
            {requests === null ? (
              <p className="font-serif text-sm text-muted-foreground">Looking for matching requests…</p>
            ) : (
              <>
                <section aria-label="Possible matches" className="space-y-2">
                  <h3 className="font-display uppercase text-sm tracking-wide">
                    {matches.length ? 'Possible matches' : 'No request looks like this one'}
                  </h3>
                  {matches.slice(0, 5).map(m => (
                    <RequestOption key={m.request.id} r={m.request as Request} reasons={m.reasons} onPick={pick} />
                  ))}
                </section>
                <div className="space-y-1">
                  <Label htmlFor="link-search" className="text-sm">Find another request</Label>
                  <Input id="link-search" value={search} onChange={e => setSearch(e.target.value)} placeholder="Title, name or email" />
                </div>
                {searched.map(r => <RequestOption key={r.id} r={r} onPick={pick} />)}
              </>
            )}
            <div className="flex flex-wrap justify-end gap-2 border-t border-border/40 pt-4">
              {canSkip && (
                <Button variant="outline" onClick={onSkip} disabled={working}>Not now — keep it a standalone blank</Button>
              )}
              <Button onClick={() => setMode('new')} disabled={working}>
                <Plus className="h-4 w-4 mr-1" /> Create a new request
              </Button>
            </div>
          </div>
        )}

        {mode === 'existing' && picked && (
          <div className="space-y-4">
            <RequestSummary r={picked} />
            {diffs.length === 0 ? (
              <p className="font-serif text-sm">What was typed agrees with this request.</p>
            ) : (
              <fieldset className="space-y-2">
                <legend className="font-display uppercase text-sm tracking-wide mb-1">Where they differ, keep which?</legend>
                <p className="font-serif text-sm text-muted-foreground">
                  A date or time kept from the blank sets the contract&rsquo;s Term; the request keeps what the renter asked for.
                </p>
                {diffs.map(d => (
                  <div key={d.key} role="radiogroup" aria-label={d.label} className="grid sm:grid-cols-[9rem_1fr_1fr] gap-2 items-center rounded-md border border-border/40 px-3 py-2">
                    <span className="font-serif text-sm">{d.label}</span>
                    <Choice name={d.key} checked={!useTyped[d.key]} onChange={() => setUseTyped(u => ({ ...u, [d.key]: false }))}
                      label={`Request: ${show(d, d.request)}`} />
                    <Choice name={d.key} checked={!!useTyped[d.key]} onChange={() => setUseTyped(u => ({ ...u, [d.key]: true }))}
                      label={`Typed: ${show(d, d.blank)}`} />
                  </div>
                ))}
              </fieldset>
            )}
            <CostNote />
            <div className="flex flex-wrap justify-between gap-2 border-t border-border/40 pt-4">
              <Button variant="ghost" onClick={() => setMode('choose')} disabled={working}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={() => link(picked.id)} disabled={working}>
                <Link2 className="h-4 w-4 mr-1" /> {working ? 'Linking…' : "Link and open the request's contract"}
              </Button>
            </div>
          </div>
        )}

        {mode === 'new' && (
          <div className="space-y-4">
            {strongMatch && (
              <p className="font-serif text-sm rounded-md border border-border/40 px-3 py-2" role="note">
                <strong>{strongMatch.request.event_title}</strong> ({strongMatch.reasons.join(', ')}) may be this rental already.{' '}
                <Button size="sm" variant="outline" onClick={() => pick(strongMatch.request as Request)}>Link to it instead</Button>
              </p>
            )}
            <div className="grid sm:grid-cols-2 gap-3">
              <Field id="new-title" label="Event title (required)" value={details.event_title} onChange={v => setDetails(d => ({ ...d, event_title: v }))} />
              <Field id="new-name" label="Licensee name (required)" value={details.applicant_name} onChange={v => setDetails(d => ({ ...d, applicant_name: v }))} />
              <Field id="new-email" label="Email (required)" type="email" value={details.email} onChange={v => setDetails(d => ({ ...d, email: v }))} />
              <Field id="new-org" label="Organization" value={details.organization_name} onChange={v => setDetails(d => ({ ...d, organization_name: v }))} />
              <Field id="new-phone" label="Phone" type="tel" value={details.phone} onChange={v => setDetails(d => ({ ...d, phone: v }))} />
            </div>
            <p className="font-serif text-sm text-muted-foreground">
              It goes into Requests as pending, with the date, times and purpose from the blank. Nobody is emailed.
            </p>
            <CostNote />
            <div className="flex flex-wrap justify-between gap-2 border-t border-border/40 pt-4">
              <Button variant="ghost" onClick={() => setMode('choose')} disabled={working}>
                <ArrowLeft className="h-4 w-4 mr-1" /> Back
              </Button>
              <Button onClick={() => link(null)} disabled={working || !newValid}>
                <Plus className="h-4 w-4 mr-1" /> {working ? 'Creating…' : "Create the request and open its contract"}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function show(d: FieldDiff, v: string) {
  if (!v) return '(none)';
  if (d.key === 'term_date' || d.key === 'term_end_date') return formatPlainDate(v, 'EEE MMM d, yyyy');
  if (d.key === 'term_start' || d.key === 'term_end') return formatClockTime(v);
  return v;
}

function CostNote() {
  return (
    <p className="font-serif text-sm text-muted-foreground">
      A cost left empty on the blank prints the standard rate on the request&rsquo;s contract. Check the costs there before sending it.
    </p>
  );
}

function RequestSummary({ r }: { r: Request }) {
  return (
    <div className="font-serif text-sm">
      <p className="font-medium">{r.event_title}</p>
      <p className="text-muted-foreground">
        {[r.applicant_name, r.email, formatPlainDateRange(r.proposed_date, r.end_date)].filter(Boolean).join(' • ')}
      </p>
    </div>
  );
}

function RequestOption({ r, reasons, onPick }: { r: Request; reasons?: string[]; onPick: (r: Request) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap rounded-md border border-border/40 px-3 py-2">
      <div className="min-w-0">
        <p className="font-serif text-sm font-medium">
          {r.event_title}{' '}
          <Badge variant="outline" className="text-xs capitalize ml-1">{r.status}</Badge>
          {r.signed_at && <Badge className="text-xs ml-1">Signed</Badge>}
        </p>
        <p className="font-serif text-xs text-muted-foreground">
          {[r.applicant_name, r.email, formatPlainDateRange(r.proposed_date, r.end_date)].filter(Boolean).join(' • ')}
          {reasons?.length ? ` — ${reasons.join(', ')}` : ''}
        </p>
      </div>
      {/* A disabled button swallows its own tooltip, so the reason is on the wrapper. */}
      <span title={r.signed_at ? 'Its contract is signed; a blank cannot change it' : undefined}>
        <Button size="sm" variant="outline" disabled={!!r.signed_at} onClick={() => onPick(r)} aria-label={`Use ${r.event_title}`}>
          Use this request
        </Button>
      </span>
    </div>
  );
}

function Choice({ name, checked, onChange, label }: { name: string; checked: boolean; onChange: () => void; label: string }) {
  return (
    <label className="flex items-center gap-2 font-serif text-sm min-w-0">
      <input type="radio" name={name} checked={checked} onChange={onChange} className="h-4 w-4 shrink-0" />
      <span className="break-words min-w-0">{label}</span>
    </label>
  );
}

function Field({ id, label, value, onChange, type = 'text' }: {
  id: string; label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      <Input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}
