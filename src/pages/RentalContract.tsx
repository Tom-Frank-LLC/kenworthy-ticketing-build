import { useEffect, useId, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Download, Printer, Save, ShieldCheck, BadgeCheck, Eraser } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import { formatClockTime, formatPlainDate } from '@/lib/datetime';
// @ts-ignore - no types
import html2pdf from 'html2pdf.js';
import { withHtml2CanvasBaseline } from '@/lib/html2canvasBaseline';

type ContractData = {
  agreement_date?: string;
  hourly_rate?: number;
  base_hours?: number;
  additional_hours_rate?: number;
  additional_hours?: number;
  staff_rate?: number;
  staff_hours?: number;
  concessions_fee?: number;
  av_fee?: number;
  max_attendees?: number;
  alcohol_addendum?: 'served' | 'not_served';
};

const DEFAULTS: ContractData = {
  hourly_rate: 180,
  base_hours: 4,
  additional_hours_rate: 50,
  additional_hours: 0,
  staff_rate: 30,
  staff_hours: 0,
  concessions_fee: 0,
  av_fee: 0,
  max_attendees: 268,
  alcohol_addendum: 'not_served',
};

/**
 * What a staffer has typed into the blank contract. Strings throughout, numbers
 * included: an empty field must stay empty and print as a ruled line, where a
 * number would fall back to 0 and print "$0.00" for someone to cross out.
 * `alcohol_addendum` empty means undecided, and the form carries both addenda.
 */
export type BlankFields = {
  name: string;
  organization: string;
  email: string;
  phone: string;
  agreement_date: string;
  event_date: string;
  end_date: string;
  start_time: string;
  end_time: string;
  purpose: string;
  max_attendees: string;
  hourly_rate: string;
  base_hours: string;
  additional_hours_rate: string;
  additional_hours: string;
  staff_rate: string;
  staff_hours: string;
  concessions_fee: string;
  av_fee: string;
  alcohol_addendum: '' | 'served' | 'not_served';
};

export const EMPTY_BLANK: BlankFields = {
  name: '', organization: '', email: '', phone: '',
  agreement_date: '', event_date: '', end_date: '', start_time: '', end_time: '',
  purpose: '', max_attendees: '',
  hourly_rate: '', base_hours: '', additional_hours_rate: '', additional_hours: '',
  staff_rate: '', staff_hours: '', concessions_fee: '', av_fee: '',
  alcohol_addendum: '',
};

// sessionStorage, not localStorage: the draft survives a refresh, which is what
// a long fill needs, and is gone when the tab closes. The page is public and
// the box office machines are shared; a renter's name and phone number should
// not wait there for the next person to open /contract/blank.
export const BLANK_DRAFT_KEY = 'kenworthy.blankContract.v1';

function loadBlankDraft(): BlankFields {
  try {
    const raw = window.sessionStorage.getItem(BLANK_DRAFT_KEY);
    if (!raw) return EMPTY_BLANK;
    const saved = JSON.parse(raw);
    const out = { ...EMPTY_BLANK };
    for (const k of Object.keys(EMPTY_BLANK) as (keyof BlankFields)[]) {
      if (typeof saved?.[k] === 'string') (out as Record<string, string>)[k] = saved[k];
    }
    return out;
  } catch {
    return EMPTY_BLANK;
  }
}

/**
 * The rental licence agreement, at /contract/:token for one request.
 *
 * `blank` (at /contract/blank) is the same document as a worksheet: no request
 * is loaded, an editor above it takes whatever the staffer knows, and every
 * field left empty prints as a ruled line to write on. It has nothing to save
 * or sign; only the merge fields differ, so a blank form and a real contract
 * can never drift apart in their clauses.
 */
export default function RentalContract({ blank = false }: { blank?: boolean }) {
  const { token } = useParams();
  const { isAdmin } = useAuth();
  const [request, setRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ContractData>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [signing, setSigning] = useState(false);
  const [fields, setFields] = useState<BlankFields>(() => (blank ? loadBlankDraft() : EMPTY_BLANK));

  useEffect(() => {
    if (!blank) return;
    try {
      if (Object.values(fields).some(Boolean)) {
        window.sessionStorage.setItem(BLANK_DRAFT_KEY, JSON.stringify(fields));
      } else {
        window.sessionStorage.removeItem(BLANK_DRAFT_KEY);
      }
    } catch {
      // Storage blocked: the form still works, it just won't survive a refresh.
    }
  }, [blank, fields]);

  useEffect(() => {
    (async () => {
      if (blank) { setLoading(false); return; }
      if (!token) return;
      const { data: rows, error } = await supabase.rpc('get_rental_request_by_token', { p_token: token });
      if (error) toast.error(error.message);
      const row = rows?.[0] || null;
      setRequest(row);
      if (row?.contract_data) {
        setData({ ...DEFAULTS, ...(row.contract_data as ContractData) });
      }
      setLoading(false);
    })();
  }, [token, blank]);

  const blankTotals = useMemo(() => blankCosts(fields), [fields]);

  const totals = useMemo(() => {
    const base = (data.hourly_rate || 0) * (data.base_hours || 0);
    const extra = (data.additional_hours_rate || 0) * (data.additional_hours || 0);
    const staff = (data.staff_rate || 0) * (data.staff_hours || 0);
    const conc = data.concessions_fee || 0;
    const av = data.av_fee || 0;
    return { base, extra, staff, conc, av, subtotal: base + extra + staff + conc + av };
  }, [data]);

  async function save() {
    if (!request) return;
    setSaving(true);
    const { error } = await supabase
      .from('rental_requests')
      .update({ contract_data: data as any })
      .eq('id', request.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else toast.success('Contract saved');
  }

  const blankLicensee = (fields.name.trim() || fields.organization.trim());
  const filename = blank
    ? `Kenworthy-Contract-${slug(blankLicensee) || 'BLANK'}.pdf`
    : `Kenworthy-Contract-${(request?.event_title || 'rental').replace(/[^a-z0-9]+/gi, '-')}.pdf`;

  async function exportPdf() {
    const el = document.getElementById('contract-body');
    if (!el) return;
    setExporting(true);
    try {
      await withHtml2CanvasBaseline(() => html2pdf()
        .set({ ...PDF_OPTIONS, filename } as any)
        .from(breakableCopy(el))
        .save());
    } catch (e: any) {
      toast.error(e?.message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  }

  // Print is the same PDF as Download, opened in a tab for the browser's PDF
  // viewer to print. `window.print()` printed the web page instead, and the
  // browser stamps its own URL, date and page numbers on that — chrome no page
  // CSS can remove — and paginated it differently from the file.
  //
  // The tab is opened before the render, while the click still counts as a
  // user gesture: a window.open after an await is a popup, and gets blocked.
  async function printPdf() {
    const tab = window.open('', '_blank');
    setExporting(true);
    try {
      const blob = await renderPdfBlob();
      const url = URL.createObjectURL(blob);
      if (tab) {
        tab.location.href = url;
      } else {
        // Popups blocked: hand over the file instead of doing nothing.
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
      // The tab loads the blob on its own schedule; revoking now can beat it.
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch (e: any) {
      tab?.close();
      toast.error(e?.message || 'Failed to build the PDF');
    } finally {
      setExporting(false);
    }
  }

  async function renderPdfBlob(): Promise<Blob> {
    const el = document.getElementById('contract-body');
    if (!el) throw new Error('Contract body not found');
    return await withHtml2CanvasBaseline(() =>
      html2pdf().set(PDF_OPTIONS as any).from(breakableCopy(el)).outputPdf('blob'));
  }

  function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onloadend = () => {
        const s = String(r.result || '');
        resolve(s.substring(s.indexOf(',') + 1));
      };
      r.onerror = reject;
      r.readAsDataURL(blob);
    });
  }

  async function signAndDownload() {
    if (!request) return;
    setSigning(true);
    try {
      // Save latest contract data first so the signed PDF reflects it
      await supabase.from('rental_requests').update({ contract_data: data as any }).eq('id', request.id);

      const blob = await renderPdfBlob();
      const pdf_base64 = await blobToBase64(blob);
      const { data: resp, error } = await supabase.functions.invoke('sign-contract', {
        body: { request_id: request.id, pdf_base64 },
      });
      if (error) throw error;
      if ((resp as any)?.error) throw new Error((resp as any).error);

      const signedB64 = (resp as any).pdf_base64 as string;
      const bin = atob(signedB64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const signedBlob = new Blob([bytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(signedBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `Kenworthy-Contract-${(request.event_title || 'rental').replace(/[^a-z0-9]+/gi, '-')}-signed.pdf`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success('Contract signed and downloaded');
      // Refresh local request copy
      const { data: rows } = await supabase.rpc('get_rental_request_by_token', { p_token: token! });
      if (rows?.[0]) setRequest(rows[0]);
    } catch (e: any) {
      toast.error(e?.message || 'Failed to sign contract');
    } finally {
      setSigning(false);
    }
  }

  if (loading) return <div className="container py-16 text-center text-muted-foreground">Loading…</div>;
  if (!request && !blank) return <div className="container py-16 text-center text-muted-foreground">Contract not found.</div>;

  // A blank form leaves every merge field it was not given empty — not today's
  // date, not `__________`, not $0.00 — and Fill draws a ruled line in its place.
  // `agreement_date` and `proposed_date` are calendar days, not instants:
  // `new Date('2026-08-14')` is UTC midnight and prints as the 13th here, on
  // the document a renter signs. formatPlainDate reads the day as written.
  const b = trimmed(fields);
  const agreementDate = blank
    ? formatPlainDate(b.agreement_date)
    : data.agreement_date
      ? formatPlainDate(data.agreement_date)
      : format(new Date(request.created_at), 'MMMM d, yyyy');
  const eventDate = blank
    ? eventDays(b.event_date, b.end_date === b.event_date ? '' : b.end_date)
    : eventDays(request.proposed_date, request.end_date) || '__________';
  const timeRange = blank
    ? ''
    : [formatClockTime(request.event_start_time), formatClockTime(request.event_end_time)].filter(Boolean).join('–') ||
      '__________';
  const licensee = blank ? blankLicensee : request.applicant_name || request.organization_name || '__________';
  const contact = blank
    ? [b.name, b.organization, b.email, b.phone].filter(Boolean).join(', ')
    : [request.applicant_name, request.email].filter(Boolean).join(', ');
  const purpose = blank ? b.purpose : request.event_description || request.event_title || '__________';
  const alcoholYes = data.alcohol_addendum === 'served' || request?.wants_beer_wine;
  // Undecided, the blank form carries both addenda for the writer to choose.
  const showAlcohol = blank ? fields.alcohol_addendum !== 'not_served' : alcoholYes;
  const showNoAlcohol = blank ? fields.alcohol_addendum !== 'served' : !alcoholYes;
  const money = (v: number | undefined) => (v === undefined ? '' : `$${v.toFixed(2)}`);
  const subtotal = blank ? blankTotals.subtotal : totals.subtotal;
  const set = (k: keyof BlankFields) => (v: string) => setFields(f => ({ ...f, [k]: v }));

  return (
    <div className="min-h-screen bg-background print:bg-white">
      {/* Admin/editor toolbar — hidden on print */}
      {isAdmin && (
        <div className="print:hidden border-b border-border/40 bg-card/50 sticky top-0 z-10">
          <div className="container max-w-5xl py-4 px-4 flex items-center justify-between gap-3">
            <div>
              <h1 className="font-display uppercase">
                {blank ? 'Blank Contract — fill in here or by hand' : `Contract Editor — ${request.event_title}`}
              </h1>
              {request?.signed_at && (
                <p className="font-serif text-sm text-accent flex items-center gap-1 mt-1">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  Signed {format(new Date(request.signed_at), 'PPp')} by {request.signed_by_name}
                  {' • '}
                  <a href={`/verify/${request.id}`} target="_blank" rel="noreferrer" className="underline">verify</a>
                </p>
              )}
            </div>
            <div className="flex gap-2">
              {!blank && (
                <Button size="sm" onClick={save} disabled={saving}>
                  <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save'}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={exportPdf} disabled={exporting}>
                <Download className="h-4 w-4 mr-1" /> {exporting ? 'Exporting…' : blank ? 'Download PDF' : 'Draft PDF'}
              </Button>
              {!blank && (
                <Button size="sm" onClick={signAndDownload} disabled={signing}>
                  <ShieldCheck className="h-4 w-4 mr-1" /> {signing ? 'Signing…' : 'Sign & Download'}
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={printPdf} disabled={exporting}>
                <Printer className="h-4 w-4 mr-1" /> Print / Save PDF
              </Button>
            </div>
          </div>
        </div>
      )}

      {blank && (
        <section aria-label="Fill in the contract" className="print:hidden container max-w-5xl px-4 mt-4">
          <Card className="glass">
            <CardContent className="p-4 space-y-4">
              <p className="font-serif text-sm text-muted-foreground">
                Fill in as much or as little as you like; anything left empty prints as a line to write on.
                Download or print at any point. Nothing here is saved to a rental.
              </p>
              <FieldGroup legend="Who">
                <BlankField label="Licensee name" value={fields.name} onChange={set('name')} />
                <BlankField label="Organization" value={fields.organization} onChange={set('organization')} />
                <BlankField label="Email" type="email" value={fields.email} onChange={set('email')} />
                <BlankField label="Phone" type="tel" value={fields.phone} onChange={set('phone')} />
              </FieldGroup>
              <FieldGroup legend="When">
                <BlankField label="Agreement date" type="date" value={fields.agreement_date} onChange={set('agreement_date')} />
                <BlankField label="Event date" type="date" value={fields.event_date} onChange={set('event_date')} />
                <BlankField label="End date" type="date" value={fields.end_date} onChange={set('end_date')} />
                <BlankField label="Start time" type="time" value={fields.start_time} onChange={set('start_time')} />
                <BlankField label="End time" type="time" value={fields.end_time} onChange={set('end_time')} />
              </FieldGroup>
              <FieldGroup legend="What">
                <BlankField label="Purpose" value={fields.purpose} onChange={set('purpose')} />
                <BlankField label="Max attendees" type="number" value={fields.max_attendees} onChange={set('max_attendees')} />
                <SelectField
                  label="Alcohol addendum"
                  value={fields.alcohol_addendum}
                  onChange={v => set('alcohol_addendum')(v)}
                  options={[
                    ['', 'Not decided — include both'],
                    ['not_served', 'No alcohol service'],
                    ['served', 'Alcohol served (Addendum 1)'],
                  ]}
                />
              </FieldGroup>
              <FieldGroup legend="Costs">
                <BlankField label="Hourly rate ($/hr)" type="number" value={fields.hourly_rate} onChange={set('hourly_rate')} />
                <BlankField label="Base hours" type="number" value={fields.base_hours} onChange={set('base_hours')} />
                <BlankField label="Add'l hour rate" type="number" value={fields.additional_hours_rate} onChange={set('additional_hours_rate')} />
                <BlankField label="Add'l hours" type="number" value={fields.additional_hours} onChange={set('additional_hours')} />
                <BlankField label="Staff rate ($/hr)" type="number" value={fields.staff_rate} onChange={set('staff_rate')} />
                <BlankField label="Staff hours" type="number" value={fields.staff_hours} onChange={set('staff_hours')} />
                <BlankField label="Concessions fee" type="number" value={fields.concessions_fee} onChange={set('concessions_fee')} />
                <BlankField label="LCD/DVD/DCP fee" type="number" value={fields.av_fee} onChange={set('av_fee')} />
              </FieldGroup>
              {/* The form is long; download and print sit where the typing ends. */}
              <div className="flex flex-wrap justify-end gap-2">
                <Button size="sm" variant="outline" onClick={() => setFields(EMPTY_BLANK)}>
                  <Eraser className="h-4 w-4 mr-1" /> Clear form
                </Button>
                <Button size="sm" variant="outline" onClick={exportPdf} disabled={exporting}>
                  <Download className="h-4 w-4 mr-1" /> {exporting ? 'Exporting…' : 'Download PDF'}
                </Button>
                <Button size="sm" variant="outline" onClick={printPdf} disabled={exporting}>
                  <Printer className="h-4 w-4 mr-1" /> Print / Save PDF
                </Button>
              </div>
            </CardContent>
          </Card>
        </section>
      )}

      {isAdmin && !blank && (
        <div className="print:hidden container max-w-5xl px-4 mt-4">
          <Card className="glass">
            <CardContent className="p-4 grid md:grid-cols-3 gap-3">
              <NumField label="Hourly rate ($/hr)" value={data.hourly_rate} onChange={v => setData({ ...data, hourly_rate: v })} />
              <NumField label="Base hours" value={data.base_hours} onChange={v => setData({ ...data, base_hours: v })} />
              <NumField label="Add'l hour rate" value={data.additional_hours_rate} onChange={v => setData({ ...data, additional_hours_rate: v })} />
              <NumField label="Add'l hours" value={data.additional_hours} onChange={v => setData({ ...data, additional_hours: v })} />
              <NumField label="Staff rate ($/hr)" value={data.staff_rate} onChange={v => setData({ ...data, staff_rate: v })} />
              <NumField label="Staff hours" value={data.staff_hours} onChange={v => setData({ ...data, staff_hours: v })} />
              <NumField label="Concessions fee" value={data.concessions_fee} onChange={v => setData({ ...data, concessions_fee: v })} />
              <NumField label="LCD/DVD/DCP fee" value={data.av_fee} onChange={v => setData({ ...data, av_fee: v })} />
              <NumField label="Max attendees" value={data.max_attendees} onChange={v => setData({ ...data, max_attendees: v })} />
              <div className="space-y-1">
                <Label className="text-sm">Alcohol addendum</Label>
                <select
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={data.alcohol_addendum}
                  onChange={e => setData({ ...data, alcohol_addendum: e.target.value as any })}
                >
                  <option value="not_served">No alcohol service</option>
                  <option value="served">Alcohol served (Addendum 1)</option>
                </select>
              </div>
              <div className="space-y-1">
                <Label className="text-sm">Agreement date</Label>
                <Input
                  type="date"
                  value={data.agreement_date || ''}
                  onChange={e => setData({ ...data, agreement_date: e.target.value })}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/*
        Contract body — print target.

        Black on white, deliberately outside the site theme. The site is a dark
        theme, so `bg-background text-foreground` here rendered the licence
        agreement as pale text — and the PDF export forces a white html2canvas
        background (see renderPdfBlob), which left the signed document nearly
        invisible on the page. A contract is a paper document; it is styled as
        one on screen, in Print, and in the export, with fixed neutrals rather
        than theme tokens so no future theme change can wash it out again.
      */}
      <article id="contract-body" className="container max-w-3xl py-10 px-6 md:px-12 bg-white text-neutral-900 font-serif text-base leading-relaxed print:py-0">
        <header className="text-center mb-8">
          <h1 className="font-display text-3xl uppercase tracking-wider">License Agreement</h1>
          <p className="text-neutral-600 text-sm mt-2">{agreementDate || <Fill width="10em" />}</p>
        </header>

        <p>
          This License Agreement (the &ldquo;Agreement&rdquo;) is made on <Fill width="10em">{agreementDate}</Fill> between
          {' '}<strong>Kenworthy Performing Arts Centre, Inc.</strong>, an Idaho non-profit corporation (&ldquo;Owner&rdquo;),
          and <Fill width="16em">{licensee}</Fill> (&ldquo;Licensee&rdquo;).
        </p>

        <H2>Recitals</H2>
        <p><strong>A.</strong> Owner owns fee simple title to the Kenworthy Performing Arts Centre located in Latah County, State of Idaho, more particularly described as a theater located at 508 S. Main Street in Moscow, Idaho. <strong>Correspondence should be addressed to: PO Box 8126, Moscow, ID 83843. Telephone (208) 882-4127.</strong></p>
        <p><strong>B.</strong> Licensee desires to use the theater (&ldquo;Licensed Premises&rdquo;). <strong>Correspondence should be addressed to: <Fill width="20em">{contact || licensee}</Fill></strong></p>
        <p><strong>C.</strong> Owner will agree to Licensee&rsquo;s use of the Licensed Premises upon terms and conditions as set forth in this Agreement and the attached addendum(s).</p>

        <p>Owner and Licensee agree as follows:</p>

        <H2>1. Grant of License</H2>
        <p>Owner hereby grants to Licensee a license to use the Licensed Premises during the Term; subject to all of the terms and conditions of this Agreement.</p>

        <H2>2. Term</H2>
        <p>
          The term of this Agreement (the &ldquo;Term&rdquo;) shall include {blank
            ? <><Fill width="16em">{eventDate}</Fill>, from <Fill width="5em">{formatClockTime(b.start_time)}</Fill> to <Fill width="5em">{formatClockTime(b.end_time)}</Fill></>
            : <Fill>{eventDate}, from {timeRange}</Fill>}.
          Term is assessed from the time in which KPAC staff begins preparations for event and ends when staff completes clean-up after event.
        </p>

        <H2>3. Consideration</H2>
        <p>
          Licensee shall pay to Owner as a consideration for the License granted by this Agreement the total sum of
          {' '}<Fill width="6em">{money(subtotal)}</Fill>, plus additional items <strong>To Be Determined</strong>.
          Estimated itemization may be found below.
        </p>
        <p>
          A <strong>$200 fee</strong> shall be forfeited if event is cancelled within 60 days of the event date. The balance of the rental fee must be paid in full no later than fourteen (14) days following the receipt of event invoice. Owner may impose a late fee of not more than twenty-five dollars ($25.00) and the maximum current allowable interest rate to delinquent accounts aged past due date.
        </p>

        <H2>4. Use of Licensed Premises</H2>
        <p>
          Licensee shall use the Licensed Premises only for the following purpose(s): <Fill width="20em">{purpose}</Fill>.
          Licensee shall not occupy or use the Licensed Premises for any purpose not authorized by this Agreement, nor make or permit any use of the Licensed Premises which directly or indirectly is forbidden by law, ordinance or governmental regulation or order, or which may be dangerous to life, limb or property or which increases the premium costs or invalidates any policy of insurance covering the Licensed Premises or the Owner. Licensee shall also be subject to all reasonable rules and regulations imposed by Owner.
        </p>
        <p>
          Licensee shall be responsible for following current social distancing and attendance guidelines as outlined by Owner. Owner maintains the ability to refuse service if guidelines are not met and/or followed. Attendance of private rentals will be limited to a {blank
            ? <>maximum of <Fill width="4em">{b.max_attendees}</Fill> attendees</>
            : <Fill>maximum of {data.max_attendees} attendees</Fill>}.
        </p>
        <p>
          Licensee shall during the Term at Licensee&rsquo;s own cost and expense keep in force by advance payment of premiums, public liability and property damage insurance in an amount of not less than <strong>FIVE HUNDRED THOUSAND DOLLARS ($500,000)</strong> per occurrence, insuring, protecting, indemnifying and defending Licensee and Owner against all liability, loss, damage or claim that may arise against them or either of them on account of any occurrences in or about the Licensed Premises or the Center during the Term in consequence of Licensee&rsquo;s use of the Licensed Premises. Said insurance shall be with an insurance carrier or insurance carriers satisfactory to Owner and shall not be subject to cancellation except after at least ten (10) days&rsquo; prior written notice to Owner, and the policy for said insurance or a duly executed certificate of said insurance shall be delivered to Owner a minimum of forty-eight (48) hours prior to Licensee&rsquo;s use hereunder.
        </p>

        <H2>5. Stipulations</H2>
        <p><strong>A. Food and/or beverages.</strong> If food and/or beverages are sold a $100 cleaning fee may be assessed if building is deemed soiled beyond normal wear and tear. If food is served to attendees of event and KPAC concessions are not requested a $50 fee will be assessed to offset the loss of sales. No outside food and/or beverages are permitted that overlap with items available in KPAC concession stand.</p>
        <p><strong>B. Alcohol.</strong> Alcohol may not be served at any event at the KPAC unless the Addendum 1 — Alcohol Agreement has been executed and attached to this license agreement. If alcohol is not requested, an alternative addendum (Addendum 2a) will be executed. A $100.00 cleaning fee may be assessed if alcohol is served in conjunction with the event.</p>
        <p><strong>C. Decorations.</strong> Licensee shall not by use of nails, screws, tacks, or any similar implement affix any item to the screen, walls, ceiling, chairs, doors or any portion thereof. Licensee shall not use glitter, feather boas, or helium filled balloons within the auditorium. Licensee may affix temporary decorations to the walls using only <strong>blue painters tape</strong>. Any other tape will not be allowed and damage to walls by tape will be assessed in the final billing. Licensee prior to vacating the theater shall remove all decorations and tape.</p>
        <p><strong>D. KPAC Equipment.</strong> All equipment, including but not limited to film projector, lights, ice machine, popcorn machine, movie screen, and stage curtain will only be operated by the Owner or Owner&rsquo;s authorized staff. Any damage to theater interior and/or breakage of theater equipment resulting from Licensee actions shall be repaired and/or replaced at the Licensee&rsquo;s expense. <strong>No patrons, props, or materials shall be placed on stage while the movie screen is in a down position.</strong> Attaching anything to the front of the stage must be approved by a KPAC staff person.</p>
        <p><strong>E. Provided during your event.</strong> Use of the building interior, including lobby, restrooms, theater, backstage areas, and a general wash lighting of the stage is included. Special equipment, additional light and sound support to be determined no later than 3 weeks prior to event. Cleaning service and trash removal included. Owner at its discretion will assess a one hundred dollar ($100.00) cleaning fee if the premises are deemed soiled beyond normal wear and tear. Concession sales may be made available during any rental; proceeds will be retained by Owner and will not be credited towards rental costs.</p>
        <p><strong>F. Ticketing.</strong> If the Kenworthy is selling tickets for event, ticketing fees will be assessed at cost (3.5%) plus labor for listings, service, and web management: 5% gross ticketing revenue.</p>

        <H2>Itemized Breakdown of Rental Costs</H2>
        <table className="w-full border-collapse text-sm my-4">
          <tbody>
            {blank ? (
              <>
                <Row label={<>Theater Rental ($<Fill width="3em">{b.hourly_rate}</Fill>/hr × <Fill width="2em">{b.base_hours}</Fill>)</>} value={money(blankTotals.base)} />
                <Row label={<>Additional Hours ($<Fill width="3em">{b.additional_hours_rate}</Fill>/hr × <Fill width="2em">{b.additional_hours}</Fill>)</>} value={money(blankTotals.extra)} />
                <Row label={<>Additional KPAC Staff ($<Fill width="3em">{b.staff_rate}</Fill>/hr × <Fill width="2em">{b.staff_hours}</Fill>)</>} value={money(blankTotals.staff)} />
              </>
            ) : (
              <>
                <Row label={`Theater Rental ($${num(data.hourly_rate)}/hr × ${num(data.base_hours)})`} value={money(totals.base)} />
                {totals.extra > 0 && (
                  <Row label={`Additional Hours ($${num(data.additional_hours_rate)}/hr × ${num(data.additional_hours)})`} value={money(totals.extra)} />
                )}
                <Row label={`Additional KPAC Staff ($${num(data.staff_rate)}/hr × ${num(data.staff_hours)})`} value={money(totals.staff)} />
              </>
            )}
            <Row label="Concessions Fees" value={money(blank ? blankTotals.conc : totals.conc)} />
            <Row label="LCD / DVD / DCP Fees" value={money(blank ? blankTotals.av : totals.av)} />
            <tr className="border-t border-neutral-400 font-semibold">
              <td className="py-2">Subtotal</td>
              <td className="py-2 text-right">{money(subtotal)}</td>
            </tr>
          </tbody>
        </table>
        <p><strong>Estimated Rental Cost: <Fill width="6em">{money(subtotal)}</Fill></strong></p>
        <p><strong>Total Rental Cost: <Fill width="6em">{money(subtotal)}</Fill></strong> (plus any fees to be determined in planning or after the event).</p>

        <H2>6. Indemnification</H2>
        <p>Licensee shall defend, indemnify and hold harmless Owner from all claims arising out of any injury or death to any person or damage to property arising from Licensee&rsquo;s and its customers, clients, invitees, agents, and employees use of the Licensed Premises and Center during the Term. Owner shall not be held responsible for any event participants who contract COVID-19 or any other communicable diseases.</p>

        <H2>7. Applicable Law</H2>
        <p>This Agreement shall be construed and interpreted in accordance with the laws of the State of Idaho, and in the event that any suit or action shall be brought in connection with this Agreement, jurisdiction and venue of such suit or action shall properly lie in Latah County, Idaho.</p>

        <H2>8. Attorney Fees</H2>
        <p>If either party commences an action against the other in connection with this Agreement, the prevailing party shall be entitled to recover from the other party reasonable attorneys&rsquo; fees and costs of suit.</p>

        <H2>9. Non-Discrimination Clause</H2>
        <p>The Kenworthy Performing Arts Centre prohibits discrimination, in the entertainment and in the audience, on the basis of race, religion, color, national origin, gender, sexual orientation, disability, or age. Licensee agrees to abide by non-discrimination policy while using the premises.</p>

        <Keep>
          <p>IN WITNESS WHEREOF, the parties executed this Agreement as of the day and year first set forth above.</p>

          <div className="grid md:grid-cols-2 gap-8 mt-10">
            <div>
              <p className="font-semibold">OWNER</p>
              <p>Kenworthy Performing Arts Centre, Inc.</p>
              <div className="mt-12 border-t border-neutral-800 pt-2">
                <p>Jordan Goins</p>
                <p className="text-sm text-neutral-600">Operations Manager</p>
              </div>
            </div>
            <div>
              <p className="font-semibold">LICENSEE</p>
              <p>&nbsp;</p>
              <div className="mt-12 border-t border-neutral-800 pt-2">
                <p>{licensee || '\u00a0'}</p>
              </div>
            </div>
          </div>
        </Keep>

        <hr className="my-12 border-neutral-400" />

        {/* Addendum. A blank form carries both, each with its own signatures;
            whoever fills it in completes the one that applies. */}
        {showAlcohol && (
          <Keep>
            <section>
              <HeadingKeep>
                <h2 className="font-display text-xl uppercase text-center">Addendum 1 — Alcohol Agreement</h2>
              </HeadingKeep>
              <ol className="list-decimal pl-6 mt-4 space-y-2 text-sm">
                <li>Alcohol may NOT be served at any event at the KPAC without execution of this addendum.</li>
                <li>Beer and wine will be served under the Kenworthy Performing Arts Centre beer and wine license.</li>
                <li>Beer and wine will be served/sold by Kenworthy employees.</li>
                <li>A $100.00 cleaning deposit may be assessed if alcohol is served. Additional cleaning charges up to $300.00 may be assessed if deemed necessary by Owner.</li>
                <li>Licensees will not be permitted to bring any alcoholic beverages on premises. Only KPAC can provide alcohol products for consumption on premises.</li>
                <li>Alcohol consumption will be limited to the auditorium, backstage, and lobby. Not in restrooms, balcony, or outside the building.</li>
                <li>Alcohol sales during rental event may only be sold, served and/or consumed during hours listed on the rental agreement and in accordance with City Code Title 9, Chapter 6-32.</li>
                <li>Licensee will assume all liability arising from and in connection with alcohol consumption.</li>
                <li>All guests are required to provide valid ID to be served. No one under 21 will be served. Any guest providing alcohol to a minor will be required to leave immediately.</li>
                <li>Licensee will be fined $100 and possible early closure if patrons are consuming alcohol not vendored by the Kenworthy.</li>
                <li>KPAC will retain 100% of beer and wine sales.</li>
                <li>Kenworthy employees have the duty and right to remove any patron unlawfully bringing beer or wine on premises.</li>
                <li>The Kenworthy reserves the right to refuse service to any patron for any reason.</li>
                <li>Employees shall not serve patrons who appear intoxicated or exhibit inappropriate, unsafe, or unruly behavior.</li>
                <li>Kenworthy employees reserve the right to remove anyone from the premises under circumstances they deem appropriate.</li>
                <li>At the discretion of the Kenworthy, security may be required at the sole expense of the Licensee for the duration of the event (one uniformed police officer).</li>
                <li>KPAC at its sole discretion may terminate alcohol sale or distribution if any provision of this addendum is breached or a safety concern exists.</li>
              </ol>
            </section>
            <div className="grid md:grid-cols-2 gap-8 mt-10">
              <div>
                <div className="mt-12 border-t border-neutral-800 pt-2">
                  <p>Jordan Goins</p>
                  <p className="text-sm text-neutral-600">Operations Manager</p>
                </div>
              </div>
              <div>
                <div className="mt-12 border-t border-neutral-800 pt-2">
                  <p>{licensee || '\u00a0'}</p>
                </div>
              </div>
            </div>
          </Keep>
        )}
        {showAlcohol && showNoAlcohol && <div className="mt-16" />}
        {showNoAlcohol && (
          <Keep>
            <section>
              <HeadingKeep>
                <h2 className="font-display text-xl uppercase text-center">Addendum 1 — No Alcohol Service</h2>
              </HeadingKeep>
              <ol className="list-decimal pl-6 mt-4 space-y-2 text-sm">
                <li>This addendum marks acknowledgement from Licensee that no sales of alcohol will take place during their event at the Kenworthy Performing Arts Centre.</li>
                <li>Licensees will not be permitted to bring any alcoholic beverages on premises.</li>
                <li>Licensee will be fined $100 and may face possible early closure of the event if patrons are consuming alcoholic beverages not vendored by the Kenworthy.</li>
                <li>Kenworthy employees will have the duty and right to remove any patron who has unlawfully brought beer or wine onto the premises.</li>
                <li>Kenworthy employees reserve the right to remove anyone from the premises under circumstances they deem appropriate.</li>
              </ol>
            </section>
            <div className="grid md:grid-cols-2 gap-8 mt-10">
              <div>
                <div className="mt-12 border-t border-neutral-800 pt-2">
                  <p>Jordan Goins</p>
                  <p className="text-sm text-neutral-600">Operations Manager</p>
                </div>
              </div>
              <div>
                <div className="mt-12 border-t border-neutral-800 pt-2">
                  <p>{licensee || '\u00a0'}</p>
                </div>
              </div>
            </div>
          </Keep>
        )}

      </article>

      {/* A renter's only buttons. On the blank form they are also where a
          staffer lands after reading it through, so admins get them too.
          Below the paper, not on it: these are theme-styled buttons, and on
          the contract's white sheet the outline one was dark-on-dark. */}
      {(!isAdmin || blank) && (
        <div data-testid="contract-bottom-actions" className="print:hidden container max-w-3xl px-4 py-8 flex flex-wrap justify-center gap-2">
          <Button onClick={exportPdf} disabled={exporting}>
            <Download className="h-4 w-4 mr-1" /> {exporting ? 'Exporting…' : 'Download PDF'}
          </Button>
          <Button variant="outline" onClick={printPdf} disabled={exporting}>
            <Printer className="h-4 w-4 mr-1" /> Print / Save PDF
          </Button>
        </div>
      )}
    </div>
  );
}

function num(v: number | undefined) {
  return v ?? 0;
}

function trimmed(f: BlankFields): BlankFields {
  const out = { ...f };
  for (const k of Object.keys(out) as (keyof BlankFields)[]) (out as Record<string, string>)[k] = out[k].trim();
  return out;
}

function slug(s: string) {
  return s.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
}

// "Saturday November 14th, 2026", or "… through …" when there is an end date.
function eventDays(start: string | null | undefined, end: string | null | undefined) {
  const first = formatPlainDate(start, 'EEEE MMMM do, yyyy');
  if (!first) return '';
  return end ? `${first} through ${formatPlainDate(end, 'EEEE MMMM do, yyyy')}` : first;
}

function amount(s: string): number | undefined {
  if (s.trim() === '') return undefined;
  const n = Number(s);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * The blank form's cost lines. A line has an amount only once everything it is
 * made of has been typed: a rate with no hours is not a $0 line, it is a line
 * still to be filled in. The subtotal adds up the lines that have amounts, and
 * is itself blank until at least one does, which is what a staffer filling the
 * paper form by hand would write.
 */
export function blankCosts(f: BlankFields) {
  const times = (a: string, b: string) => {
    const x = amount(a), y = amount(b);
    return x === undefined || y === undefined ? undefined : x * y;
  };
  const lines = {
    base: times(f.hourly_rate, f.base_hours),
    extra: times(f.additional_hours_rate, f.additional_hours),
    staff: times(f.staff_rate, f.staff_hours),
    conc: amount(f.concessions_fee),
    av: amount(f.av_fee),
  };
  const known = Object.values(lines).filter((v): v is number => v !== undefined);
  return { ...lines, subtotal: known.length ? known.reduce((a, v) => a + v, 0) : undefined };
}

function H2({ children }: { children: React.ReactNode }) {
  return (
    <HeadingKeep>
      <h2 className="font-display uppercase text-base mt-6 mb-2 tracking-wide">{children}</h2>
    </HeadingKeep>
  );
}

function Fill({ children, width = '8em' }: { children?: React.ReactNode; width?: string }) {
  // The filled-in values of the agreement, set in bold. This span is rasterized
  // by html2canvas for the PDF, so keep it to plain text styling: html2canvas
  // paints a background on a wrapped inline span as one box over its whole
  // bounding rectangle, covering the neighbouring words, and it draws
  // underlines through descenders with no offset. Check a change in the
  // generated PDF, not on screen.
  //
  // Empty, it is a line to write on: a bottom border on an inline-block, not a
  // text underline, so it sits below the baseline and cannot wrap. `width` is
  // in em so the blank scales with the type.
  if (children === undefined || children === null || children === '' || children === false) {
    return (
      <span
        data-blank-fill=""
        className="inline-block border-b border-neutral-800 align-baseline"
        style={{ width }}
      >
        {'\u00a0'}
      </span>
    );
  }
  return <span className="font-semibold">{children}</span>;
}

// Shared by Draft PDF / Download PDF and Sign & Download, so the copy a renter
// downloads and the copy that gets signed are laid out the same way.
//
// html2pdf cuts a page every 10 inches whatever is there, slicing lines of text
// in half. With `avoid`, an element that would straddle a cut is pushed whole onto
// the next page. Whole paragraphs left half-empty pages, so `breakableCopy` puts
// each word in its own span instead. The word that would straddle the cut moves
// down and takes the rest of its line with it, which is a break between lines.
const PDF_OPTIONS = {
  margin: [0.5, 0.5, 0.5, 0.5],
  image: { type: 'jpeg', quality: 0.95 },
  html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
  jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
  pagebreak: { mode: ['css', 'legacy'], avoid: ['.pdf-keep', '.pdf-word', 'tr'] },
};

// A detached copy of the contract for html2pdf, with every word of running text
// in a `.pdf-word` span. Only the copy is changed; React's DOM is left alone.
function breakableCopy(el: HTMLElement): HTMLElement {
  const copy = el.cloneNode(true) as HTMLElement;
  // What print leaves out, the PDF leaves out. The patron's Download / Print
  // buttons once sat inside the contract and were printed on its last page;
  // they are below it now, and this keeps anything print-hidden from returning.
  copy.querySelectorAll('.print\\:hidden').forEach((n) => n.remove());
  const walker = document.createTreeWalker(copy, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (n.nodeValue?.trim()) texts.push(n as Text);
  }
  for (const text of texts) {
    const frag = document.createDocumentFragment();
    for (const part of text.nodeValue!.split(/(\s+)/)) {
      if (!part) continue;
      if (/^\s+$/.test(part)) {
        frag.appendChild(document.createTextNode(part));
      } else {
        const word = document.createElement('span');
        word.className = 'pdf-word';
        word.textContent = part;
        frag.appendChild(word);
      }
    }
    text.replaceWith(frag);
  }
  return copy;
}

// Kept on one page in the PDF (see PDF_OPTIONS). Only for blocks shorter than a
// page; html2pdf lets a taller one break, and its words still break by line.
function Keep({ children }: { children: React.ReactNode }) {
  return <div className="pdf-keep">{children}</div>;
}

// A heading must not be the last thing on a page. The padding reserves room for
// the first lines after it inside the kept box, and the matching negative margin
// gives that room back, so the layout is unchanged.
function HeadingKeep({ children }: { children: React.ReactNode }) {
  return <div className="pdf-keep pb-[4.5em] -mb-[4.5em]">{children}</div>;
}


// `value` is preformatted; empty on a blank form, where the row's own rule is
// the line to write the amount on.
function Row({ label, value }: { label: React.ReactNode; value: string }) {
  return (
    <tr className="border-b border-neutral-300">
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right">{value || '\u00a0'}</td>
    </tr>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-sm">{label}</Label>
      <Input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
      />
    </div>
  );
}

function FieldGroup({ legend, children }: { legend: string; children: React.ReactNode }) {
  return (
    <fieldset>
      <legend className="font-display uppercase text-sm tracking-wide mb-2">{legend}</legend>
      <div className="grid sm:grid-cols-2 md:grid-cols-3 gap-3">{children}</div>
    </fieldset>
  );
}

function BlankField({ label, value, onChange, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      <Input id={id} type={type} value={value} onChange={e => onChange(e.target.value)} />
    </div>
  );
}

function SelectField<T extends string>({ label, value, onChange, options }: {
  label: string; value: T; onChange: (v: T) => void; options: [T, string][];
}) {
  const id = useId();
  return (
    <div className="space-y-1">
      <Label htmlFor={id} className="text-sm">{label}</Label>
      <select
        id={id}
        className="w-full h-9 rounded-md border border-input bg-background px-2 text-sm"
        value={value}
        onChange={e => onChange(e.target.value as T)}
      >
        {options.map(([v, text]) => <option key={v} value={v}>{text}</option>)}
      </select>
    </div>
  );
}
