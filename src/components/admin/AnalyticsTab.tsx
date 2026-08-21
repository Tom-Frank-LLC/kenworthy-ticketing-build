// The admin Overview.
//
// The money cards read SQUARE, not our own tables. That is the whole point of
// this component's shape: the theatre's revenue lives in Square — Point of Sale,
// Square Online, invoices — and exactly one order has ever come through this
// build. Computing revenue from `tickets` and `concession_sales`, as this tab
// used to, returned ~zero for every card. It was not broken arithmetic; it was
// the wrong source. See docs/SQUARE-TRANSACTION-CONVENTIONS.md.
//
// Genre Popularity and Venue Utilization stay build-sourced, because neither
// exists in Square: genre is a `movies`/`events`/`concerts` column, and seat
// capacity is `showings.total_seats`. They are labelled as such on the cards, so
// a sparse genre chart next to a full revenue chart reads as "we only know this
// for showings in the build" rather than as a bug.

import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DollarSign, TrendingUp, Users, BarChart3, UtensilsCrossed, RefreshCw } from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, Legend,
} from 'recharts';

const COLORS = [
  'hsl(var(--primary))',
  'hsl(var(--accent))',
  'hsl(210, 70%, 55%)',
  'hsl(340, 65%, 55%)',
  'hsl(160, 55%, 45%)',
  'hsl(45, 80%, 55%)',
];

const RANGES = [
  { key: '30d', label: '30 days' },
  { key: '90d', label: '90 days' },
  { key: 'ytd', label: 'Year to date' },
  { key: 'custom', label: 'Custom' },
] as const;

type RangeKey = typeof RANGES[number]['key'];

/**
 * Exactly what `square-analytics` returns. Money is always in cents.
 *
 * These figures come from Square's Reporting API — the same engine behind
 * Square's own Dashboard reports — so they agree with Square by construction.
 * The previous implementation summed /v2/orders/search here and under-reported
 * by ~35%. See docs/briefs/FINDINGS-square-reporting-api.md.
 */
interface Analytics {
  range: { start: string; end: string };
  granularity: 'day' | 'month';
  totals: {
    totalCollectedCents: number;
    netSalesCents: number;
    grossSalesCents: number;
    ticketsSold: number;
    avgPerTicketCents: number;
    concessionRevenueCents: number;
    refundCount: number;
    refundCents: number;
    tipsCents: number;
    taxCents: number;
  };
  revenueByDay: Array<{ date: string; ticketsCents: number; concessionsCents: number; otherCents: number; totalCents: number }>;
  revenueByCategory: Array<{ name: string; amountCents: number; quantity: number }>;
  topPerformers: Array<{ title: string; revenueCents: number; count: number }>;
  uncategorized: Array<{ name: string; amountCents: number; quantity: number }>;
  meta: { orders: number; categories: number; truncated: boolean; source: string };
  cached?: boolean;
}

/** Build-sourced rows, for the two cards Square cannot answer. */
interface ShowingTicketRow {
  showing_id: string;
  status: string;
  showings: {
    total_seats: number;
    venue_id: string | null;
    movies: { genre: string | null } | null;
    events: { genre: string | null } | null;
    concerts: { genre: string | null } | null;
    venues: { name: string } | null;
  } | null;
}

const dollars = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export default function AnalyticsTab() {
  const [range, setRange] = useState<RangeKey>('30d');
  const [custom, setCustom] = useState({ start: '', end: '' });
  const [data, setData] = useState<Analytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<ShowingTicketRow[]>([]);

  const load = useCallback(async (opts: { refresh?: boolean } = {}) => {
    // A custom range is only a valid query once both ends are set; until then
    // keep showing the last good result rather than asking Square for nonsense.
    if (range === 'custom' && !(custom.start && custom.end)) return;
    setLoading(true);
    setError(null);
    const { data: res, error: err } = await supabase.functions.invoke('square-analytics', {
      body: { range, start: custom.start || undefined, end: custom.end || undefined, refresh: opts.refresh },
    });
    if (err || (res as { error?: string })?.error) {
      setError((res as { error?: string })?.error || err?.message || 'Could not read Square.');
      setData(null);
    } else {
      setData(res as Analytics);
    }
    setLoading(false);
  }, [range, custom.start, custom.end]);

  useEffect(() => { void load(); }, [load]);

  // Build-sourced, and independent of the Square range — these two cards
  // describe what the build knows about its own showings.
  useEffect(() => {
    (async () => {
      const { data: rows } = await fetchAllRows<ShowingTicketRow>((from, to) =>
        supabase
          .from('tickets')
          .select('showing_id, status, showings(total_seats, venue_id, movies(genre), events(genre), concerts(genre), venues(name))')
          .eq('status', 'confirmed')
          .range(from, to) as unknown as PromiseLike<{ data: ShowingTicketRow[] | null; error: null }>);
      setTickets(rows);
    })();
  }, []);

  const t = data?.totals;

  const revenueSeries = (data?.revenueByDay ?? []).map(d => ({
    date: d.date.slice(5),
    tickets: d.ticketsCents / 100,
    concessions: d.concessionsCents / 100,
    other: d.otherCents / 100,
  }));

  const categoryData = (data?.revenueByCategory ?? []).map(c => ({
    name: c.name,
    value: +(c.amountCents / 100).toFixed(2),
  }));

  const topPerformers = (data?.topPerformers ?? []).map(p => ({
    title: p.title.length > 28 ? `${p.title.slice(0, 27)}…` : p.title,
    revenue: +(p.revenueCents / 100).toFixed(2),
    count: p.count,
  }));

  // --- Genre popularity (build-sourced) ---
  const genreMap: Record<string, number> = {};
  tickets.forEach(t => {
    const s = t.showings;
    if (!s) return;
    const genre = s.movies?.genre || s.events?.genre || s.concerts?.genre || 'Other';
    genreMap[genre] = (genreMap[genre] || 0) + 1;
  });
  const genreData = Object.entries(genreMap)
    .sort(([, a], [, b]) => b - a)
    .slice(0, 8)
    .map(([name, value]) => ({ name, value }));

  // --- Venue utilization (build-sourced) ---
  const venueMap: Record<string, { name: string; ticketsSold: number; showingIds: Set<string>; totalCapacity: number }> = {};
  tickets.forEach(t => {
    const s = t.showings;
    if (!s?.venues?.name || !s.venue_id) return;
    const name = s.venues.name;
    if (!venueMap[name]) venueMap[name] = { name, ticketsSold: 0, showingIds: new Set(), totalCapacity: 0 };
    venueMap[name].ticketsSold += 1;
    if (!venueMap[name].showingIds.has(t.showing_id)) {
      venueMap[name].showingIds.add(t.showing_id);
      venueMap[name].totalCapacity += s.total_seats ?? 0;
    }
  });
  const venueData = Object.values(venueMap).map(v => ({
    name: v.name,
    utilization: v.totalCapacity > 0 ? +((v.ticketsSold / v.totalCapacity) * 100).toFixed(1) : 0,
    tickets: v.ticketsSold,
  }));

  return (
    <div className="space-y-6">
      {/* Range selector */}
      <div className="flex flex-wrap items-center gap-2">
        {RANGES.map(r => (
          <Button
            key={r.key}
            size="sm"
            variant={range === r.key ? 'default' : 'outline'}
            onClick={() => setRange(r.key)}
          >
            {r.label}
          </Button>
        ))}
        {range === 'custom' && (
          <div className="flex items-center gap-2">
            <Input
              type="date"
              value={custom.start}
              onChange={e => setCustom(c => ({ ...c, start: e.target.value }))}
              className="w-auto"
              aria-label="Range start"
            />
            <span className="text-muted-foreground">to</span>
            <Input
              type="date"
              value={custom.end}
              onChange={e => setCustom(c => ({ ...c, end: e.target.value }))}
              className="w-auto"
              aria-label="Range end"
            />
          </div>
        )}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void load({ refresh: true })}
          disabled={loading}
          className="ml-auto"
        >
          <RefreshCw className={`h-4 w-4 mr-1.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      {error && (
        <Card className="glass border-destructive/40">
          <CardContent className="p-4">
            <p className="text-destructive font-medium">Could not read Square</p>
            <p className="text-muted-foreground mt-1">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && !data && <p className="text-center text-muted-foreground py-12">Reading Square…</p>}

      {data && (
        <>
          {/* KPI cards — all from Square */}
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
            <KPI icon={<DollarSign className="h-5 w-5 text-primary" />} label="Total Revenue" value={dollars(t!.totalCollectedCents)} />
            <KPI icon={<TrendingUp className="h-5 w-5 text-primary" />} label="Tickets Sold" value={String(t!.ticketsSold)} />
            <KPI icon={<BarChart3 className="h-5 w-5 text-primary" />} label="Avg / Ticket" value={dollars(t!.avgPerTicketCents)} />
            <KPI icon={<UtensilsCrossed className="h-5 w-5 text-primary" />} label="Concession Rev" value={dollars(t!.concessionRevenueCents)} />
            <KPI icon={<Users className="h-5 w-5 text-destructive" />} label="Refunds" value={`${t!.refundCount} · ${dollars(t!.refundCents)}`} />
          </div>

          {/* A silently short total is the failure mode worth shouting about. */}
          {data.meta.truncated && (
            <p className="text-destructive">
              This range has more orders than one read can cover, so the totals below are incomplete.
              Choose a shorter range.
            </p>
          )}

          {/* Revenue over time */}
          <Card className="glass">
            <CardHeader>
              <CardTitle className="text-base">Revenue Over Time</CardTitle>
              <p className="text-muted-foreground">
                Gross sales, before tax and tips — the basis Square's Item Sales report uses.
                Total Revenue above is what was collected, so it is higher by tax and tips.
              </p>
            </CardHeader>
            <CardContent>
              {revenueSeries.length > 0 ? (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={revenueSeries}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="date" className="text-xs" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                    <Legend />
                    <Bar dataKey="tickets" stackId="rev" fill="hsl(var(--primary))" name="Tickets" />
                    <Bar dataKey="concessions" stackId="rev" fill="hsl(var(--accent))" name="Concessions" />
                    <Bar dataKey="other" stackId="rev" fill="hsl(210, 70%, 55%)" name="Other" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-muted-foreground text-center py-8">No sales in this range.</p>}
            </CardContent>
          </Card>

          <div className="grid md:grid-cols-2 gap-4">
            {/* Revenue by category */}
            <Card className="glass">
              <CardHeader><CardTitle className="text-base">Revenue by Category</CardTitle></CardHeader>
              <CardContent>
                {categoryData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={categoryData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}>
                        {categoryData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip formatter={(v: number) => `$${v.toFixed(2)}`} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-muted-foreground text-center py-8">No sales in this range.</p>}
              </CardContent>
            </Card>

            {/* Genre popularity — build-sourced */}
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">Genre Popularity</CardTitle>
                <p className="text-muted-foreground">
                  From this build's own ticket sales — Square does not record genre.
                </p>
              </CardHeader>
              <CardContent>
                {genreData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={240}>
                    <PieChart>
                      <Pie data={genreData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name, value }) => `${name} (${value})`}>
                        {genreData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                      </Pie>
                      <Tooltip contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : <p className="text-muted-foreground text-center py-8">No tickets sold through this build yet.</p>}
              </CardContent>
            </Card>
          </div>

          {/* What is inside Square's own "Uncategorized" bucket.
              On the live account this is the largest single category, so an
              unexplained wedge would make the whole pie untrustworthy. Note
              this is no longer a diagnostic for a bug on our side: Square
              genuinely holds no category for these items, and this list is
              Square's answer to "which ones". */}
          {data.uncategorized.length > 0 && (
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">What's in "Uncategorized"</CardTitle>
                <p className="text-muted-foreground">
                  Items Square holds no reporting category for. Largest first.
                </p>
              </CardHeader>
              <CardContent>
                <ul className="space-y-1">
                  {data.uncategorized.map((u, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-4">
                      <span className="truncate">
                        {u.name}
                        <span className="text-muted-foreground">{' · '}{u.quantity}&times;</span>
                      </span>
                      <span className="tabular-nums shrink-0">{dollars(u.amountCents)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}

          {/* Top performers */}
          <Card className="glass">
            <CardHeader><CardTitle className="text-base">Top Performers — Ticket Revenue</CardTitle></CardHeader>
            <CardContent>
              {topPerformers.length > 0 ? (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={topPerformers} layout="vertical">
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis type="number" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis dataKey="title" type="category" width={160} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip
                      formatter={(v: number, name: string) => name === 'revenue' ? `$${v.toFixed(2)}` : v}
                      contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }}
                    />
                    <Legend />
                    <Bar dataKey="revenue" fill="hsl(var(--primary))" name="Revenue" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <p className="text-muted-foreground text-center py-8">No ticket sales in this range.</p>}
            </CardContent>
          </Card>

          {/* Venue utilization — build-sourced */}
          {venueData.length > 0 && (
            <Card className="glass">
              <CardHeader>
                <CardTitle className="text-base">Venue Utilization</CardTitle>
                <p className="text-muted-foreground">
                  From this build's own sales and seat counts — Square does not record capacity.
                </p>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={240}>
                  <BarChart data={venueData}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                    <XAxis dataKey="name" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <YAxis unit="%" tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                    <Tooltip formatter={(v: number, name: string) => name === 'utilization' ? `${v}%` : v} contentStyle={{ background: 'hsl(var(--card))', border: '1px solid hsl(var(--border))' }} />
                    <Bar dataKey="utilization" fill="hsl(var(--accent))" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <p className="text-muted-foreground text-center">
            {data.meta.orders.toLocaleString()} Square orders · {data.meta.categories} categories ·{' '}
            {data.range.start} to {data.range.end} · from Square's own reports
            {data.cached && ' · cached'}
          </p>
        </>
      )}
    </div>
  );
}

function KPI({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="glass">
      <CardContent className="p-4 flex items-center gap-3">
        <div className="rounded-full bg-primary/10 p-2.5">{icon}</div>
        <div>
          <p className="text-xs text-muted-foreground">{label}</p>
          <p className="text-xl font-bold">{value}</p>
        </div>
      </CardContent>
    </Card>
  );
}
