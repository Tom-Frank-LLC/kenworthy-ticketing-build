import { useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { FileText, Download, Loader2, Search, X } from 'lucide-react';
import html2pdf from 'html2pdf.js';

interface Showing {
  id: string;
  start_time: string;
  ticket_price: number;
  movie_id: string | null;
  movies: {
    id: string;
    title: string;
    release_year: number | null;
    release_label: string | null;
    distributor: string | null;
    circuit: string | null;
    terms_percent: number | null;
  } | null;
}

interface TicketRow {
  id: string;
  price: number;
  tax_amount: number;
  total_price: number;
  status: string;
  tier_id: string | null;
  showing_price_tiers: { tier_name: string } | null;
}

interface LineItem {
  ticketName: string;
  admissions: number;
  refunds: number;
  unitGross: number;
  unitNet: number;
  gross: number;
  net: number;
}

const money = (n: number) =>
  n.toLocaleString('en-US', { style: 'currency', currency: 'USD' });

export default function BoxOfficeReceiptsTab() {
  const [showings, setShowings] = useState<Showing[]>([]);
  const [loading, setLoading] = useState(true);
  const [active, setActive] = useState<Showing | null>(null);
  const [tickets, setTickets] = useState<TicketRow[]>([]);
  const [busy, setBusy] = useState(false);
  const [query, setQuery] = useState('');
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');

  // Editable receipt header fields
  const [distributor, setDistributor] = useState('');
  const [circuit, setCircuit] = useState('');
  const [terms, setTerms] = useState<string>('');
  const [releaseYear, setReleaseYear] = useState<string>('');
  const [releaseLabel, setReleaseLabel] = useState<string>('');
  const [persistOnMovie, setPersistOnMovie] = useState(true);

  const receiptRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from('showings')
        .select(
          'id, start_time, ticket_price, movie_id, movies(id, title, release_year, release_label, distributor, circuit, terms_percent)'
        )
        .not('movie_id', 'is', null)
        .lte('start_time', new Date().toISOString())
        .order('start_time', { ascending: false })
        .limit(200);
      if (error) toast.error(error.message);
      setShowings((data as any) || []);
      setLoading(false);
    })();
  }, []);

  async function openReceipt(s: Showing) {
    setActive(s);
    setDistributor(s.movies?.distributor ?? '');
    setCircuit(s.movies?.circuit ?? '');
    setTerms(s.movies?.terms_percent != null ? String(s.movies.terms_percent) : '');
    setReleaseYear(s.movies?.release_year != null ? String(s.movies.release_year) : '');
    setReleaseLabel(s.movies?.release_label ?? '');
    setPersistOnMovie(true);
    setTickets([]);

    const { data, error } = await supabase
      .from('tickets')
      .select('id, price, tax_amount, total_price, status, tier_id, showing_price_tiers(tier_name)')
      .eq('showing_id', s.id);
    if (error) toast.error(error.message);
    setTickets((data as any) || []);
  }

  const lineItems = useMemo<LineItem[]>(() => {
    if (!active) return [];
    const buckets = new Map<string, LineItem>();
    for (const t of tickets) {
      const name = t.showing_price_tiers?.tier_name || `General Admission $${Number(t.price).toFixed(2)}`;
      const key = `${name}|${Number(t.price).toFixed(2)}`;
      let bucket = buckets.get(key);
      if (!bucket) {
        bucket = {
          ticketName: name,
          admissions: 0,
          refunds: 0,
          unitGross: Number(t.total_price),
          unitNet: Number(t.price),
          gross: 0,
          net: 0,
        };
        buckets.set(key, bucket);
      }
      if (t.status === 'refunded' || t.status === 'voided') {
        bucket.refunds += 1;
      } else {
        bucket.admissions += 1;
        bucket.gross += Number(t.total_price);
        bucket.net += Number(t.price);
      }
    }
    return Array.from(buckets.values()).sort((a, b) => a.ticketName.localeCompare(b.ticketName));
  }, [tickets, active]);

  const totals = useMemo(() => {
    const admissions = lineItems.reduce((s, l) => s + l.admissions, 0);
    const refunds = lineItems.reduce((s, l) => s + l.refunds, 0);
    const gross = lineItems.reduce((s, l) => s + l.gross, 0);
    const net = lineItems.reduce((s, l) => s + l.net, 0);
    const tax = Math.round((gross - net) * 100) / 100;
    const termsPct = parseFloat(terms || '0');
    const netDue = Math.round(net * (termsPct / 100) * 100) / 100;
    return { admissions, refunds, gross, net, tax, termsPct, netDue };
  }, [lineItems, terms]);

  async function downloadPdf() {
    if (!active || !receiptRef.current) return;
    setBusy(true);
    try {
      if (persistOnMovie && active.movie_id) {
        const patch: any = {
          distributor: distributor || null,
          circuit: circuit || null,
          terms_percent: terms ? Number(terms) : null,
          release_year: releaseYear ? Number(releaseYear) : null,
          release_label: releaseLabel || null,
        };
        await supabase.from('movies').update(patch).eq('id', active.movie_id);
      }
      const title = active.movies?.title ?? 'showing';
      const date = format(new Date(active.start_time), 'yyyy_MM_dd');
      const safeTitle = title.replace(/[^\w]+/g, '');
      const filename = `${date}_${safeTitle}_BOR.pdf`;
      await html2pdf()
        .from(receiptRef.current)
        .set({
          margin: 0.4,
          filename,
          image: { type: 'jpeg', quality: 0.98 },
          html2canvas: { scale: 2, backgroundColor: '#ffffff' },
          jsPDF: { unit: 'in', format: 'letter', orientation: 'portrait' },
        })
        .save();
    } catch (e: any) {
      toast.error(e?.message ?? 'PDF generation failed');
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading showings…
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display flex items-center gap-2">
            <FileText className="h-5 w-5" /> Box Office Receipts (Comscore format)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground mb-4">
            Generate a per-showing receipt to submit to distributors via Comscore. Pulls ticket
            counts and gross/net from confirmed sales for each past film showing.
          </p>
          <div className="mb-4 space-y-2">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
              <Input
                className="pl-9"
                placeholder="Search by title, distributor, circuit, year, weekday…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="flex-1">
                <Label className="text-xs">From</Label>
                <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
              </div>
              <div className="flex-1">
                <Label className="text-xs">To</Label>
                <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
              </div>
              {(query || fromDate || toDate) && (
                <div className="flex items-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => { setQuery(''); setFromDate(''); setToDate(''); }}
                  >
                    <X className="h-4 w-4 mr-1" /> Clear
                  </Button>
                </div>
              )}
            </div>
          </div>
          {(() => {
            const q = query.trim().toLowerCase();
            const from = fromDate ? new Date(fromDate) : null;
            const to = toDate ? new Date(toDate) : null;
            if (to) to.setHours(23, 59, 59, 999);
            const filtered = showings.filter((s) => {
              const d = new Date(s.start_time);
              if (from && d < from) return false;
              if (to && d > to) return false;
              if (!q) return true;
              const m = s.movies;
              const hay = [
                m?.title,
                m?.distributor,
                m?.circuit,
                m?.release_label,
                m?.release_year != null ? String(m.release_year) : '',
                format(d, 'EEEE MMMM d yyyy h:mm a'),
                format(d, 'yyyy-MM-dd'),
                'film movie showing',
              ]
                .filter(Boolean)
                .join(' ')
                .toLowerCase();
              return hay.includes(q);
            });
            return (
              <>
                <p className="text-xs text-muted-foreground mb-2">
                  {filtered.length} of {showings.length} showings
                </p>
                {showings.length === 0 ? (
            <p className="text-sm text-muted-foreground">No past film showings yet.</p>
                ) : filtered.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No showings match your search.</p>
                ) : (
                  <div className="space-y-2">
                    {filtered.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between p-3 rounded-md border border-border/40 hover:bg-accent/5"
                >
                  <div>
                    <p className="font-medium">{s.movies?.title ?? 'Untitled'}</p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(s.start_time), 'EEE, MMM d, yyyy · h:mm a')}
                    </p>
                  </div>
                  <Button size="sm" variant="outline" onClick={() => openReceipt(s)}>
                    <FileText className="h-4 w-4 mr-1" /> Receipt
                  </Button>
                </div>
                    ))}
                  </div>
                )}
              </>
            );
          })()}
        </CardContent>
      </Card>

      <Dialog open={!!active} onOpenChange={(o) => !o && setActive(null)}>
        <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-display">
              Box Office Receipt — {active?.movies?.title}
            </DialogTitle>
          </DialogHeader>

          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div className="space-y-1">
              <Label className="text-xs">Distributor</Label>
              <Input value={distributor} onChange={(e) => setDistributor(e.target.value)} placeholder="Warner Bros." />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Circuit / Buyer</Label>
              <Input value={circuit} onChange={(e) => setCircuit(e.target.value)} placeholder="Clark Film Buying" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Terms %</Label>
              <Input type="number" step="0.01" value={terms} onChange={(e) => setTerms(e.target.value)} placeholder="35" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Release Year</Label>
              <Input type="number" value={releaseYear} onChange={(e) => setReleaseYear(e.target.value)} placeholder="1986" />
            </div>
            <div className="space-y-1 md:col-span-2">
              <Label className="text-xs">Release Label (optional)</Label>
              <Input value={releaseLabel} onChange={(e) => setReleaseLabel(e.target.value)} placeholder="2D / Default" />
            </div>
          </div>

          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={persistOnMovie}
              onChange={(e) => setPersistOnMovie(e.target.checked)}
            />
            Save distributor, circuit, terms, and release info to this movie for next time
          </label>

          {/* Printable receipt */}
          <div className="border border-border rounded-md overflow-hidden bg-white">
            <div ref={receiptRef} style={{
              padding: '24px',
              background: '#ffffff',
              color: '#000',
              fontFamily: 'Helvetica, Arial, sans-serif',
              fontSize: '11px',
            }}>
              <div style={{ borderBottom: '2px solid #000', paddingBottom: 8, marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <div style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1 }}>BOX OFFICE RECEIPT</div>
                <div style={{ fontSize: 10, color: '#555' }}>Kenworthy Performing Arts Centre</div>
              </div>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 12 }}>
                <tbody>
                  <tr>
                    <td style={{ padding: '2px 6px', width: '15%' }}><b>Theater</b></td>
                    <td style={{ padding: '2px 6px', width: '35%' }}>Kenworthy Arts Center (4701)</td>
                    <td style={{ padding: '2px 6px', width: '15%' }}><b>Release</b></td>
                    <td style={{ padding: '2px 6px', width: '35%' }}>
                      {active?.movies?.title}
                      {releaseYear ? ` (${releaseYear})` : ''}
                      {releaseLabel ? ` (${releaseLabel})` : ''}
                    </td>
                  </tr>
                  <tr>
                    <td style={{ padding: '2px 6px' }}><b>Circuit</b></td>
                    <td style={{ padding: '2px 6px' }}>{circuit || '—'}</td>
                    <td style={{ padding: '2px 6px' }}><b>Distributor</b></td>
                    <td style={{ padding: '2px 6px' }}>{distributor || '—'}</td>
                  </tr>
                  <tr>
                    <td style={{ padding: '2px 6px' }}><b>City, State</b></td>
                    <td style={{ padding: '2px 6px' }}>Moscow, ID</td>
                    <td style={{ padding: '2px 6px' }}><b>Play Dates</b></td>
                    <td style={{ padding: '2px 6px' }}>
                      {active ? format(new Date(active.start_time), 'MM/dd/yy') : ''}
                    </td>
                  </tr>
                </tbody>
              </table>

              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 10 }}>
                <thead>
                  <tr style={{ background: '#eee' }}>
                    <th style={th}>Admissions</th>
                    <th style={th}>Refunds</th>
                    <th style={th}>Ticket Name</th>
                    <th style={thR}>Ticket Gross</th>
                    <th style={thR}>Ticket Net</th>
                    <th style={thR}>Gross</th>
                    <th style={thR}>Net</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td colSpan={7} style={{ ...td, background: '#fafafa', fontWeight: 600 }}>
                      Date{' '}
                      {active ? format(new Date(active.start_time), 'MMMM d, yyyy (EEEE)') : ''}
                    </td>
                  </tr>
                  {lineItems.length === 0 ? (
                    <tr>
                      <td colSpan={7} style={{ ...td, textAlign: 'center', color: '#777' }}>
                        No tickets recorded for this showing.
                      </td>
                    </tr>
                  ) : (
                    lineItems.map((li, i) => (
                      <tr key={i}>
                        <td style={td}>{li.admissions}</td>
                        <td style={td}>{li.refunds}</td>
                        <td style={td}>{li.ticketName}</td>
                        <td style={tdR}>{money(li.unitGross)}</td>
                        <td style={tdR}>{money(li.unitNet)}</td>
                        <td style={tdR}>{money(li.gross)}</td>
                        <td style={tdR}>{money(li.net)}</td>
                      </tr>
                    ))
                  )}
                  <tr style={{ background: '#f5f5f5', fontWeight: 700 }}>
                    <td style={td}>{totals.admissions}</td>
                    <td style={td}>{totals.refunds}</td>
                    <td style={td}>Subtotals</td>
                    <td style={tdR}></td>
                    <td style={tdR}></td>
                    <td style={tdR}>{money(totals.gross)}</td>
                    <td style={tdR}>{money(totals.net)}</td>
                  </tr>
                </tbody>
              </table>

              <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: 16, fontSize: 11 }}>
                <tbody>
                  <tr>
                    <td style={summary}><div style={lbl}>Admissions</div><div>{totals.admissions}</div></td>
                    <td style={summary}><div style={lbl}>Refunds</div><div>{totals.refunds}</div></td>
                    <td style={summary}><div style={lbl}>Total Gross</div><div>{money(totals.gross)}</div></td>
                    <td style={summary}><div style={lbl}>Total Tax</div><div>{money(totals.tax)}</div></td>
                  </tr>
                  <tr>
                    <td style={summary} colSpan={2}>
                      <div style={lbl}>Terms</div>
                      <div>{totals.termsPct ? `${totals.termsPct}%` : '—'}</div>
                    </td>
                    <td style={summary}><div style={lbl}>Final Net</div><div>{money(totals.net)}</div></td>
                    <td style={summary}><div style={lbl}>Net Due</div><div>{money(totals.netDue)}</div></td>
                  </tr>
                </tbody>
              </table>

              <div style={{ marginTop: 28, borderTop: '1px solid #000', paddingTop: 6, fontSize: 10 }}>
                <div style={{ height: 28 }} />
                <div>Signature</div>
                <div style={{ fontStyle: 'italic', color: '#555' }}>Operations Manager</div>
              </div>

              <div style={{ marginTop: 16, fontSize: 9, color: '#666' }}>
                Generated {format(new Date(), "yyyy-MM-dd HH:mm")} · Kenworthy Performing Arts Centre · 508 S Main St, Moscow, ID
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setActive(null)}>Close</Button>
            <Button onClick={downloadPdf} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Download className="h-4 w-4 mr-1" />}
              Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

const th: React.CSSProperties = { border: '1px solid #999', padding: '4px 6px', textAlign: 'left', fontWeight: 700 };
const thR: React.CSSProperties = { ...th, textAlign: 'right' };
const td: React.CSSProperties = { border: '1px solid #ccc', padding: '4px 6px' };
const tdR: React.CSSProperties = { ...td, textAlign: 'right' };
const summary: React.CSSProperties = { border: '1px solid #999', padding: '6px 8px', verticalAlign: 'top', width: '25%' };
const lbl: React.CSSProperties = { fontSize: 9, textTransform: 'uppercase', color: '#666', letterSpacing: 0.5 };