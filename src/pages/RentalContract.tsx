import { useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent } from '@/components/ui/card';
import { Printer, Save } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
// @ts-ignore - no types
import html2pdf from 'html2pdf.js';

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

export default function RentalContract() {
  const { token } = useParams();
  const { isAdmin } = useAuth();
  const [request, setRequest] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ContractData>(DEFAULTS);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    (async () => {
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
  }, [token]);

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

  async function exportPdf() {
    const el = document.getElementById('contract-body');
    if (!el) return;
    setExporting(true);
    try {
      const filename = `Kenworthy-Contract-${(request.event_title || 'rental').replace(/[^a-z0-9]+/gi, '-')}.pdf`;
      await html2pdf()
        .set({
          margin: [0.5, 0.5, 0.5, 0.5],
          filename,
          image: { type: 'jpeg', quality: 0.95 },
          html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        } as any)
        .from(el)
        .save();
    } catch (e: any) {
      toast.error(e?.message || 'Failed to export PDF');
    } finally {
      setExporting(false);
    }
  }

  if (loading) return <div className="container py-16 text-center text-muted-foreground">Loading…</div>;
  if (!request) return <div className="container py-16 text-center text-muted-foreground">Contract not found.</div>;

  const agreementDate = data.agreement_date
    ? format(new Date(data.agreement_date), 'MMMM d, yyyy')
    : format(new Date(request.created_at), 'MMMM d, yyyy');
  const eventDate = request.proposed_date
    ? format(new Date(request.proposed_date), 'EEEE MMMM do, yyyy')
    : '__________';
  const timeRange = [request.event_start_time, request.event_end_time].filter(Boolean).join('–') || '__________';
  const licensee = request.applicant_name || request.organization_name || '__________';
  const contact = [request.applicant_name, request.email].filter(Boolean).join(', ');
  const purpose = request.event_description || request.event_title || '__________';
  const alcoholYes = data.alcohol_addendum === 'served' || request.wants_beer_wine;

  return (
    <div className="min-h-screen bg-background">
      {/* Admin/editor toolbar — hidden on print */}
      {isAdmin && (
        <div className="print:hidden border-b border-border/40 bg-card/50 sticky top-0 z-10">
          <div className="container max-w-5xl py-4 px-4 flex items-center justify-between gap-3">
            <h1 className="font-display uppercase">Contract Editor — {request.event_title}</h1>
            <div className="flex gap-2">
              <Button size="sm" onClick={save} disabled={saving}>
                <Save className="h-4 w-4 mr-1" /> {saving ? 'Saving…' : 'Save'}
              </Button>
              <Button size="sm" onClick={exportPdf} disabled={exporting}>
                <Printer className="h-4 w-4 mr-1" /> {exporting ? 'Exporting…' : 'Export PDF'}
              </Button>
              <Button size="sm" variant="outline" onClick={() => window.print()}>
                <Printer className="h-4 w-4 mr-1" /> Print / PDF
              </Button>
            </div>
          </div>
        </div>
      )}

      {isAdmin && (
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
                <Label className="text-xs">Alcohol addendum</Label>
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
                <Label className="text-xs">Agreement date</Label>
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

      {/* Contract body — print target */}
      <article id="contract-body" className="container max-w-3xl py-10 px-6 md:px-12 bg-background text-foreground font-serif text-[15px] leading-relaxed print:py-0">
        <header className="text-center mb-8">
          <h1 className="font-display text-3xl uppercase tracking-wider">License Agreement</h1>
          <p className="text-muted-foreground text-sm mt-2">{agreementDate}</p>
        </header>

        <p>
          This License Agreement (the &ldquo;Agreement&rdquo;) is made on <Fill>{agreementDate}</Fill> between
          {' '}<strong>Kenworthy Performing Arts Centre, Inc.</strong>, an Idaho non-profit corporation (&ldquo;Owner&rdquo;),
          and <Fill>{licensee}</Fill> (&ldquo;Licensee&rdquo;).
        </p>

        <H2>Recitals</H2>
        <p><strong>A.</strong> Owner owns fee simple title to the Kenworthy Performing Arts Centre located in Latah County, State of Idaho, more particularly described as a theater located at 508 S. Main Street in Moscow, Idaho. <strong>Correspondence should be addressed to: PO Box 8126, Moscow, ID 83843. Telephone (208) 882-4127.</strong></p>
        <p><strong>B.</strong> Licensee desires to use the theater (&ldquo;Licensed Premises&rdquo;). <strong>Correspondence should be addressed to: <Fill>{contact || licensee}</Fill></strong></p>
        <p><strong>C.</strong> Owner will agree to Licensee&rsquo;s use of the Licensed Premises upon terms and conditions as set forth in this Agreement and the attached addendum(s).</p>

        <p>Owner and Licensee agree as follows:</p>

        <H2>1. Grant of License</H2>
        <p>Owner hereby grants to Licensee a license to use the Licensed Premises during the Term; subject to all of the terms and conditions of this Agreement.</p>

        <H2>2. Term</H2>
        <p>
          The term of this Agreement (the &ldquo;Term&rdquo;) shall include <Fill>{eventDate}, from {timeRange}</Fill>.
          Term is assessed from the time in which KPAC staff begins preparations for event and ends when staff completes clean-up after event.
        </p>

        <H2>3. Consideration</H2>
        <p>
          Licensee shall pay to Owner as a consideration for the License granted by this Agreement the total sum of
          {' '}<Fill>${totals.subtotal.toFixed(2)}</Fill>, plus additional items <strong>To Be Determined</strong>.
          Estimated itemization may be found below.
        </p>
        <p>
          A <strong>$200 fee</strong> shall be forfeited if event is cancelled within 60 days of the event date. The balance of the rental fee must be paid in full no later than fourteen (14) days following the receipt of event invoice. Owner may impose a late fee of not more than twenty-five dollars ($25.00) and the maximum current allowable interest rate to delinquent accounts aged past due date.
        </p>

        <H2>4. Use of Licensed Premises</H2>
        <p>
          Licensee shall use the Licensed Premises only for the following purpose(s): <Fill>{purpose}</Fill>.
          Licensee shall not occupy or use the Licensed Premises for any purpose not authorized by this Agreement, nor make or permit any use of the Licensed Premises which directly or indirectly is forbidden by law, ordinance or governmental regulation or order, or which may be dangerous to life, limb or property or which increases the premium costs or invalidates any policy of insurance covering the Licensed Premises or the Owner. Licensee shall also be subject to all reasonable rules and regulations imposed by Owner.
        </p>
        <p>
          Licensee shall be responsible for following current social distancing and attendance guidelines as outlined by Owner. Owner maintains the ability to refuse service if guidelines are not met and/or followed. Attendance of private rentals will be limited to a <Fill>maximum of {data.max_attendees} attendees</Fill>.
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
            <Row label={`Theater Rental ($${num(data.hourly_rate)}/hr × ${num(data.base_hours)})`} value={totals.base} />
            {totals.extra > 0 && (
              <Row label={`Additional Hours ($${num(data.additional_hours_rate)}/hr × ${num(data.additional_hours)})`} value={totals.extra} />
            )}
            <Row label={`Additional KPAC Staff ($${num(data.staff_rate)}/hr × ${num(data.staff_hours)})`} value={totals.staff} />
            <Row label="Concessions Fees" value={totals.conc} />
            <Row label="LCD / DVD / DCP Fees" value={totals.av} />
            <tr className="border-t border-border/60 font-semibold">
              <td className="py-2">Subtotal</td>
              <td className="py-2 text-right">${totals.subtotal.toFixed(2)}</td>
            </tr>
          </tbody>
        </table>
        <p><strong>Estimated Rental Cost: <Fill>${totals.subtotal.toFixed(2)}</Fill></strong></p>
        <p><strong>Total Rental Cost: <Fill>${totals.subtotal.toFixed(2)}</Fill></strong> (plus any fees to be determined in planning or after the event).</p>

        <H2>6. Indemnification</H2>
        <p>Licensee shall defend, indemnify and hold harmless Owner from all claims arising out of any injury or death to any person or damage to property arising from Licensee&rsquo;s and its customers, clients, invitees, agents, and employees use of the Licensed Premises and Center during the Term. Owner shall not be held responsible for any event participants who contract COVID-19 or any other communicable diseases.</p>

        <H2>7. Applicable Law</H2>
        <p>This Agreement shall be construed and interpreted in accordance with the laws of the State of Idaho, and in the event that any suit or action shall be brought in connection with this Agreement, jurisdiction and venue of such suit or action shall properly lie in Latah County, Idaho.</p>

        <H2>8. Attorney Fees</H2>
        <p>If either party commences an action against the other in connection with this Agreement, the prevailing party shall be entitled to recover from the other party reasonable attorneys&rsquo; fees and costs of suit.</p>

        <H2>9. Non-Discrimination Clause</H2>
        <p>The Kenworthy Performing Arts Centre prohibits discrimination, in the entertainment and in the audience, on the basis of race, religion, color, national origin, gender, sexual orientation, disability, or age. Licensee agrees to abide by non-discrimination policy while using the premises.</p>

        <p>IN WITNESS WHEREOF, the parties executed this Agreement as of the day and year first set forth above.</p>

        <div className="grid md:grid-cols-2 gap-8 mt-10">
          <div>
            <p className="font-semibold">OWNER</p>
            <p>Kenworthy Performing Arts Centre, Inc.</p>
            <div className="mt-12 border-t border-foreground/60 pt-2">
              <p>Jordan Goins</p>
              <p className="text-sm text-muted-foreground">Operations Manager</p>
            </div>
          </div>
          <div>
            <p className="font-semibold">LICENSEE</p>
            <p>&nbsp;</p>
            <div className="mt-12 border-t border-foreground/60 pt-2">
              <p>{licensee}</p>
            </div>
          </div>
        </div>

        <hr className="my-12 border-border/60" />

        {/* Addendum */}
        {alcoholYes ? (
          <section>
            <h2 className="font-display text-xl uppercase text-center">Addendum 1 — Alcohol Agreement</h2>
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
        ) : (
          <section>
            <h2 className="font-display text-xl uppercase text-center">Addendum 1 — No Alcohol Service</h2>
            <ol className="list-decimal pl-6 mt-4 space-y-2 text-sm">
              <li>This addendum marks acknowledgement from Licensee that no sales of alcohol will take place during their event at the Kenworthy Performing Arts Centre.</li>
              <li>Licensees will not be permitted to bring any alcoholic beverages on premises.</li>
              <li>Licensee will be fined $100 and may face possible early closure of the event if patrons are consuming alcoholic beverages not vendored by the Kenworthy.</li>
              <li>Kenworthy employees will have the duty and right to remove any patron who has unlawfully brought beer or wine onto the premises.</li>
              <li>Kenworthy employees reserve the right to remove anyone from the premises under circumstances they deem appropriate.</li>
            </ol>
          </section>
        )}

        <div className="grid md:grid-cols-2 gap-8 mt-10">
          <div>
            <div className="mt-12 border-t border-foreground/60 pt-2">
              <p>Jordan Goins</p>
              <p className="text-sm text-muted-foreground">Operations Manager</p>
            </div>
          </div>
          <div>
            <div className="mt-12 border-t border-foreground/60 pt-2">
              <p>{licensee}</p>
            </div>
          </div>
        </div>

        {!isAdmin && (
          <div className="print:hidden mt-10 text-center flex justify-center gap-2">
            <Button onClick={exportPdf} disabled={exporting}>
              <Printer className="h-4 w-4 mr-1" /> {exporting ? 'Exporting…' : 'Download PDF'}
            </Button>
            <Button variant="outline" onClick={() => window.print()}>
              <Printer className="h-4 w-4 mr-1" /> Print / Save as PDF
            </Button>
          </div>
        )}
      </article>
    </div>
  );
}

function num(v: number | undefined) {
  return v ?? 0;
}

function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="font-display uppercase text-base mt-6 mb-2 tracking-wide">{children}</h2>;
}

function Fill({ children }: { children: React.ReactNode }) {
  return <span className="bg-accent/15 border-b border-accent/60 px-1">{children}</span>;
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <tr className="border-b border-border/40">
      <td className="py-1.5">{label}</td>
      <td className="py-1.5 text-right">${value.toFixed(2)}</td>
    </tr>
  );
}

function NumField({ label, value, onChange }: { label: string; value: number | undefined; onChange: (v: number) => void }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <Input
        type="number"
        value={value ?? ''}
        onChange={e => onChange(e.target.value === '' ? 0 : parseFloat(e.target.value))}
      />
    </div>
  );
}