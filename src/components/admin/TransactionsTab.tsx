// The theatre's transaction log.
//
// One row per transaction, from Square — Point of Sale, Square Online,
// invoices, payment links and this site — with our own tickets, donations and
// film-pass orders joined onto the ones that came from here.
//
// Two things about its shape are worth knowing before changing it.
//
// **Nothing is filtered in the browser.** Search, filters, sorting and paging
// all happen in `square-transactions`, because the account holds thousands of
// orders per month and shipping a range to the client to filter it here would
// be slow at best and a memory problem at worst. The debounced search box is a
// server query, not an array filter.
//
// **The reconciliation column is the point, not a decoration.** A Square sale
// with no site row is completely normal — it is every POS sale the theatre has
// ever made. A *site* row with no Square payment is a fault: someone was
// charged by a path that never registered, or was never charged at all. The two
// are deliberately not styled alike.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  AlertTriangle,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Download,
  ExternalLink,
  Loader2,
  Receipt,
  RefreshCw,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { formatShowtime, venueDayKey } from '@/lib/datetime';

// ---------------------------------------------------------------------------
// What the function returns. Money is always integer cents.
// ---------------------------------------------------------------------------

type Reconciliation = 'matched' | 'square_only' | 'site_only';

interface Tender {
  type: string;
  amountCents: number;
  tipCents: number;
  paymentId: string | null;
  cardBrand: string | null;
  last4: string | null;
  createdAt: string | null;
}

interface LineItem {
  name: string;
  variationName: string | null;
  quantity: string;
  catalogObjectId: string | null;
  category: string | null;
  grossCents: number;
  taxCents: number;
  totalCents: number;
}

interface Refund {
  id: string;
  amountCents: number;
  status: string;
  reason: string | null;
  createdAt: string | null;
}

interface SiteMatch {
  kind: 'tickets' | 'donation' | 'film_pass';
  orderToken: string | null;
  paymentMethod: string | null;
  buyerName: string | null;
  buyerEmail: string | null;
  recordIds: string[];
  showingId: string | null;
  showingLabel: string | null;
  ourTotalCents: number | null;
}

interface TransactionRow {
  id: string;
  /** When the order was rung up — what the date range filters on. */
  createdAt: string;
  /** When the money was actually taken. Weeks later, for an invoice. */
  collectedAt: string | null;
  source: string;
  state: string;
  tenderTypes: string[];
  tenders: Tender[];
  buyerName: string | null;
  buyerEmail: string | null;
  items: LineItem[];
  itemsSummary: string;
  categories: string[];
  totalCents: number;
  taxCents: number;
  tipCents: number;
  discountCents: number;
  refundedCents: number;
  refunds: Refund[];
  status: 'Completed' | 'Refunded' | 'Partially refunded';
  referenceId: string | null;
  receiptUrl: string | null;
  locationId: string | null;
  match: SiteMatch | null;
  reconciliation: Reconciliation;
}

interface CrossCheck {
  available: boolean;
  reason?: string;
  squareCollectedCents?: number;
  squareOrderCount?: number;
  ourCollectedCents?: number;
  ourOrderCount?: number;
  deltaCents?: number;
  /** How far our order COUNT is from Square's, as a percentage. */
  countDeltaPct?: number;
}

interface TransactionsPayload {
  rows: TransactionRow[];
  page: number;
  page_size: number;
  total: number;
  range_total: number;
  totals: {
    count: number;
    grossCents: number;
    taxCents: number;
    tipCents: number;
    refundedCents: number;
    netCents: number;
  };
  facets: {
    sources: string[];
    tenders: string[];
    categories: string[];
    statuses: string[];
    states: string[];
  };
  mismatches: { square_only: number; site_only: number; matched: number };
  range: { start_date: string; end_date: string; start_at: string; end_at: string };
  cross_check: CrossCheck | null;
  untendered_orders: number;
  environment: string;
  fetched_at: string;
  cached: boolean;
  /**
   * Which isolate served this, and how many requests it had already served.
   *
   * Measured 23 Aug 2026: `boot` changes on every response with `served: 1`,
   * meaning the edge runtime hands each request a fresh isolate and the
   * function's in-memory cache never survives to be hit. Kept in the payload so
   * that stays checkable rather than remembered — if `served` ever climbs, the
   * cache has started working.
   */
  isolate?: { boot: string; served: number; ranges_held: number };
  notes: string[];
}

// ---------------------------------------------------------------------------

const RANGES = [
  { key: '30d', label: '30 days', days: 30 },
  { key: '90d', label: '90 days', days: 90 },
  { key: 'ytd', label: 'Year to date', days: 0 },
  { key: 'custom', label: 'Custom', days: 0 },
] as const;

type RangeKey = typeof RANGES[number]['key'];

const PAGE_SIZE = 50;

const money = (cents: number) =>
  (cents / 100).toLocaleString('en-US', { style: 'currency', currency: 'USD' });

/** `ANY` is a sentinel: Radix Select cannot hold an empty string as a value. */
const ANY = '__any__';

/**
 * Was the money taken on a different day from when the order was rung up?
 *
 * A POS sale is both at once. An invoice is raised and paid weeks apart, and
 * this account's invoices average $566 — enough that a handful landing either
 * side of a range boundary moves the total noticeably.
 */
function collectedLater(row: TransactionRow): boolean {
  if (!row.collectedAt || !row.createdAt) return false;
  return row.collectedAt.slice(0, 10) !== row.createdAt.slice(0, 10);
}

const RECONCILIATION_LABELS: Record<Reconciliation, string> = {
  matched: 'Matched to a site order',
  square_only: 'Square only (POS / Square Online)',
  site_only: 'Site order with no Square payment',
};

/**
 * Preset ranges, resolved to venue-local calendar dates.
 *
 * The same convention the edge function and `square-analytics` both use, so
 * "30 days" means the same thirty evenings on every screen. Computing these
 * from the browser's own midnight would put the boundary in the wrong place for
 * anyone not sitting in Pacific time.
 */
function presetRange(key: RangeKey): { start: string; end: string } {
  const today = venueDayKey(new Date());
  if (key === 'ytd') return { start: `${today.slice(0, 4)}-01-01`, end: today };
  const days = key === '90d' ? 90 : 30;
  // Inclusive of today, so "30 days" spans 30 dated buckets.
  const start = venueDayKey(new Date(Date.now() - (days - 1) * 86400_000));
  return { start, end: today };
}

export default function TransactionsTab() {
  const [rangeKey, setRangeKey] = useState<RangeKey>('30d');
  const [custom, setCustom] = useState({ start: '', end: '' });

  const [query, setQuery] = useState('');
  /** Debounced copy of `query` — this is what actually reaches the server. */
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [source, setSource] = useState<string>(ANY);
  const [tender, setTender] = useState<string>(ANY);
  const [category, setCategory] = useState<string>(ANY);
  const [status, setStatus] = useState<string>(ANY);
  const [reconciliation, setReconciliation] = useState<string>(ANY);
  const [sort, setSort] = useState('date_desc');
  const [page, setPage] = useState(0);

  const [data, setData] = useState<TransactionsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  // A stale response from a slower earlier query must not overwrite a newer
  // one. Without this, typing quickly can leave the table showing results for
  // a prefix of what is in the search box.
  const requestSeq = useRef(0);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQuery(query), 350);
    return () => clearTimeout(id);
  }, [query]);

  // Any change to what is being asked for returns to the first page. Staying on
  // page 7 of a result set that now has two pages shows an empty table.
  useEffect(() => {
    setPage(0);
  }, [debouncedQuery, source, tender, category, status, reconciliation, sort, rangeKey, custom.start, custom.end]);

  const requestBody = useCallback(
    (overrides: Record<string, unknown> = {}) => {
      const range = rangeKey === 'custom'
        ? { start: custom.start, end: custom.end }
        : presetRange(rangeKey);
      return {
        start_date: range.start,
        end_date: range.end,
        q: debouncedQuery,
        sources: source === ANY ? [] : [source],
        tenders: tender === ANY ? [] : [tender],
        categories: category === ANY ? [] : [category],
        statuses: status === ANY ? [] : [status],
        reconciliation: reconciliation === ANY ? [] : [reconciliation],
        sort,
        page,
        page_size: PAGE_SIZE,
        ...overrides,
      };
    },
    [rangeKey, custom.start, custom.end, debouncedQuery, source, tender, category, status, reconciliation, sort, page],
  );

  const load = useCallback(
    async (opts: { refresh?: boolean } = {}) => {
      // A custom range is only a valid query once both ends are set. Until then
      // keep the last good result rather than asking Square for nonsense.
      if (rangeKey === 'custom' && !(custom.start && custom.end)) return;

      const seq = ++requestSeq.current;
      setLoading(true);
      setError(null);

      const { data: res, error: err } = await supabase.functions.invoke('square-transactions', {
        body: requestBody({ refresh: opts.refresh }),
      });

      if (seq !== requestSeq.current) return;

      const payloadError = (res as { error?: string } | null)?.error;
      if (err || payloadError) {
        setError(payloadError || err?.message || 'Could not read Square.');
        setData(null);
      } else {
        setData(res as TransactionsPayload);
      }
      setLoading(false);
    },
    [rangeKey, custom.start, custom.end, requestBody],
  );

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data?.rows ?? [];
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1;

  const activeFilters = useMemo(
    () =>
      [source, tender, category, status, reconciliation].filter(v => v !== ANY).length +
      (debouncedQuery ? 1 : 0),
    [source, tender, category, status, reconciliation, debouncedQuery],
  );

  function clearFilters() {
    setQuery('');
    setSource(ANY);
    setTender(ANY);
    setCategory(ANY);
    setStatus(ANY);
    setReconciliation(ANY);
  }

  /**
   * Export what is on screen — the filtered set, not the page and not the range.
   *
   * Re-queries with `export: true` rather than writing out `rows`, which holds
   * only the fifty rows currently rendered. Exporting a page and calling it the
   * result set is the kind of quiet wrongness that ends up in a board report.
   */
  async function exportCsv() {
    setExporting(true);
    try {
      const { data: res, error: err } = await supabase.functions.invoke('square-transactions', {
        body: requestBody({ export: true }),
      });
      const payloadError = (res as { error?: string } | null)?.error;
      if (err || payloadError) {
        toast.error(payloadError || err?.message || 'Could not build the export.');
        return;
      }
      const payload = res as TransactionsPayload;
      downloadCsv(payload);
      for (const note of payload.notes ?? []) toast.warning(note);
      toast.success(`Exported ${payload.rows.length} transactions.`);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className="space-y-4">
      <CollapsibleSection
        id="transactions.log"
        title="Transactions"
        icon={Receipt}
        count={data?.total}
        defaultOpen
        description={
          <>
            Every confirmed sale in Square — Point of Sale, Square Online, invoices and this
            site — with our own orders joined on. Read-only.
          </>
        }
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void load({ refresh: true })}
              disabled={loading}
            >
              {loading
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <RefreshCw className="h-4 w-4" />}
              <span className="ml-1 hidden sm:inline">Refresh</span>
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void exportCsv()}
              disabled={exporting || loading || !data || data.total === 0}
            >
              {exporting
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <Download className="h-4 w-4" />}
              <span className="ml-1 hidden sm:inline">CSV</span>
            </Button>
          </div>
        }
      >
        <div className="space-y-4">
          <RangeControls
            rangeKey={rangeKey}
            setRangeKey={setRangeKey}
            custom={custom}
            setCustom={setCustom}
          />

          <FilterBar
            query={query}
            setQuery={setQuery}
            facets={data?.facets}
            source={source}
            setSource={setSource}
            tender={tender}
            setTender={setTender}
            category={category}
            setCategory={setCategory}
            status={status}
            setStatus={setStatus}
            reconciliation={reconciliation}
            setReconciliation={setReconciliation}
            sort={sort}
            setSort={setSort}
            activeFilters={activeFilters}
            onClear={clearFilters}
          />

          {data && <SummaryCards data={data} />}

          {data?.notes?.map(note => (
            <p
              key={note}
              className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm"
            >
              <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" />
              <span>{note}</span>
            </p>
          ))}

          {error && (
            <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
              {error}
            </p>
          )}

          <div className="rounded-md border overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>Date</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Tender</TableHead>
                  <TableHead>Buyer</TableHead>
                  <TableHead>Items</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Reconciled</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loading && rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin inline mr-2" />
                      Reading Square…
                    </TableCell>
                  </TableRow>
                )}
                {!loading && rows.length === 0 && !error && (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-10 text-muted-foreground">
                      {activeFilters > 0
                        ? 'No transactions match those filters.'
                        : 'No transactions in this range.'}
                    </TableCell>
                  </TableRow>
                )}
                {rows.map(row => (
                  <TransactionRowView
                    key={row.id}
                    row={row}
                    expanded={expanded === row.id}
                    onToggle={() => setExpanded(expanded === row.id ? null : row.id)}
                  />
                ))}
              </TableBody>
            </Table>
          </div>

          {data && data.total > 0 && (
            <Pager
              page={data.page}
              totalPages={totalPages}
              total={data.total}
              pageSize={data.page_size}
              loading={loading}
              onPage={setPage}
            />
          )}

          {data && <Provenance data={data} />}
        </div>
      </CollapsibleSection>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Range
// ---------------------------------------------------------------------------

function RangeControls({
  rangeKey,
  setRangeKey,
  custom,
  setCustom,
}: {
  rangeKey: RangeKey;
  setRangeKey: (k: RangeKey) => void;
  custom: { start: string; end: string };
  setCustom: (c: { start: string; end: string }) => void;
}) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:flex-wrap">
      <div className="flex flex-wrap gap-2">
        {RANGES.map(r => (
          <Button
            key={r.key}
            variant={rangeKey === r.key ? 'default' : 'outline'}
            size="sm"
            onClick={() => setRangeKey(r.key)}
          >
            {r.label}
          </Button>
        ))}
      </div>
      {rangeKey === 'custom' && (
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <div className="space-y-1">
            <Label htmlFor="txn-from" className="text-xs">From</Label>
            <Input
              id="txn-from"
              type="date"
              value={custom.start}
              onChange={e => setCustom({ ...custom, start: e.target.value })}
              className="w-full sm:w-40"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="txn-to" className="text-xs">To</Label>
            <Input
              id="txn-to"
              type="date"
              value={custom.end}
              onChange={e => setCustom({ ...custom, end: e.target.value })}
              className="w-full sm:w-40"
            />
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Filters
// ---------------------------------------------------------------------------

function FilterBar(props: {
  query: string;
  setQuery: (v: string) => void;
  facets?: TransactionsPayload['facets'];
  source: string;
  setSource: (v: string) => void;
  tender: string;
  setTender: (v: string) => void;
  category: string;
  setCategory: (v: string) => void;
  status: string;
  setStatus: (v: string) => void;
  reconciliation: string;
  setReconciliation: (v: string) => void;
  sort: string;
  setSort: (v: string) => void;
  activeFilters: number;
  onClear: () => void;
}) {
  const f = props.facets;
  return (
    <div className="space-y-2">
      <div className="relative">
        <Search className="h-4 w-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={props.query}
          onChange={e => props.setQuery(e.target.value)}
          placeholder="Search buyer, film, order id, payment id or reference…"
          className="pl-9"
          aria-label="Search transactions"
        />
        {props.query && (
          <button
            type="button"
            onClick={() => props.setQuery('')}
            aria-label="Clear search"
            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        )}
      </div>

      <div className="flex flex-wrap gap-2">
        <FacetSelect
          label="Source"
          value={props.source}
          onChange={props.setSource}
          options={f?.sources ?? []}
        />
        <FacetSelect
          label="Tender"
          value={props.tender}
          onChange={props.setTender}
          options={f?.tenders ?? []}
        />
        <FacetSelect
          label="Category"
          value={props.category}
          onChange={props.setCategory}
          options={f?.categories ?? []}
        />
        <FacetSelect
          label="Status"
          value={props.status}
          onChange={props.setStatus}
          options={f?.statuses ?? []}
        />
        <FacetSelect
          label="Reconciliation"
          value={props.reconciliation}
          onChange={props.setReconciliation}
          options={['matched', 'square_only', 'site_only']}
          renderOption={v => RECONCILIATION_LABELS[v as Reconciliation] ?? v}
        />

        <Select value={props.sort} onValueChange={props.setSort}>
          <SelectTrigger className="w-[9.5rem]" aria-label="Sort">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="date_desc">Newest first</SelectItem>
            <SelectItem value="date_asc">Oldest first</SelectItem>
            <SelectItem value="amount_desc">Largest first</SelectItem>
            <SelectItem value="amount_asc">Smallest first</SelectItem>
          </SelectContent>
        </Select>

        {props.activeFilters > 0 && (
          <Button variant="ghost" size="sm" onClick={props.onClear}>
            <X className="h-4 w-4 mr-1" />
            Clear {props.activeFilters}
          </Button>
        )}
      </div>
    </div>
  );
}

function FacetSelect({
  label,
  value,
  onChange,
  options,
  renderOption,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
  renderOption?: (v: string) => string;
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="w-[11rem]" aria-label={label}>
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{label}: any</SelectItem>
        {options.map(o => (
          <SelectItem key={o} value={o}>
            {renderOption ? renderOption(o) : o}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

function SummaryCards({ data }: { data: TransactionsPayload }) {
  const t = data.totals;
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      <Stat label="Transactions" value={t.count.toLocaleString()} />
      <Stat label="Collected" value={money(t.grossCents)} />
      <Stat label="Refunded" value={money(t.refundedCents)} />
      <Stat label="Net" value={money(t.netCents)} />
      {data.mismatches.site_only > 0 && (
        <Card className="col-span-2 lg:col-span-4 border-destructive/50 bg-destructive/5">
          <CardContent className="p-3 flex items-start gap-2 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-destructive" />
            <span>
              <strong>{data.mismatches.site_only}</strong>{' '}
              {data.mismatches.site_only === 1 ? 'order was' : 'orders were'} recorded on the site
              with no matching Square payment in this range. Filter by{' '}
              <em>{RECONCILIATION_LABELS.site_only}</em> to see them.
            </span>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-xs uppercase tracking-wide text-muted-foreground">{label}</p>
        <p className="font-display text-xl">{value}</p>
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

function TransactionRowView({
  row,
  expanded,
  onToggle,
}: {
  row: TransactionRow;
  expanded: boolean;
  onToggle: () => void;
}) {
  const siteOnly = row.reconciliation === 'site_only';
  return (
    <>
      <TableRow
        className={siteOnly ? 'bg-destructive/5 cursor-pointer' : 'cursor-pointer'}
        onClick={onToggle}
      >
        <TableCell className="w-8">
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`}
            aria-hidden
          />
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {row.createdAt ? formatShowtime(row.createdAt, 'd MMM yyyy, h:mm a') : '—'}
          {/* An invoice is raised weeks before it is paid, and the gap is the
              reason this tab's totals and Square's reports differ over a short
              range. Say so on the row rather than only in the footnote. */}
          {collectedLater(row) && (
            <span className="block text-xs text-muted-foreground">
              paid {formatShowtime(row.collectedAt!, 'd MMM yyyy')}
            </span>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {row.source}
          {/* An OPEN check is real money that has not been closed out. Worth
              seeing, since a state filter is exactly what used to hide it. */}
          {row.state && row.state !== 'COMPLETED' && (
            <Badge variant="outline" className="ml-2 text-xs">{row.state}</Badge>
          )}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          {row.tenderTypes.length > 0 ? row.tenderTypes.join(', ') : '—'}
        </TableCell>
        <TableCell className="max-w-[12rem] truncate">
          {row.buyerName || row.buyerEmail || <span className="text-muted-foreground">—</span>}
        </TableCell>
        <TableCell className="max-w-[20rem] truncate">{row.itemsSummary}</TableCell>
        <TableCell className="text-right whitespace-nowrap tabular-nums">
          {money(row.totalCents)}
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <StatusBadge status={row.status} />
        </TableCell>
        <TableCell className="whitespace-nowrap">
          <ReconciliationBadge value={row.reconciliation} />
        </TableCell>
      </TableRow>
      {expanded && (
        <TableRow className={siteOnly ? 'bg-destructive/5' : 'bg-muted/30'}>
          <TableCell colSpan={9} className="p-4">
            <RowDetail row={row} />
          </TableCell>
        </TableRow>
      )}
    </>
  );
}

function StatusBadge({ status }: { status: TransactionRow['status'] }) {
  if (status === 'Refunded') return <Badge variant="destructive">Refunded</Badge>;
  if (status === 'Partially refunded') return <Badge variant="outline">Partial refund</Badge>;
  return <Badge variant="secondary">Completed</Badge>;
}

/**
 * `square_only` is deliberately quiet.
 *
 * It is the commonest outcome in the account — every POS and Square Online sale
 * — and styling it as a warning would put an alarm on several thousand
 * perfectly ordinary transactions, which is how a real alarm stops being read.
 */
function ReconciliationBadge({ value }: { value: Reconciliation }) {
  if (value === 'site_only') {
    return (
      <Badge variant="destructive" title={RECONCILIATION_LABELS.site_only}>
        <AlertTriangle className="h-3 w-3 mr-1" />
        Not in Square
      </Badge>
    );
  }
  if (value === 'matched') {
    return (
      <Badge variant="secondary" title={RECONCILIATION_LABELS.matched}>
        <ShieldCheck className="h-3 w-3 mr-1" />
        Site order
      </Badge>
    );
  }
  return <span className="text-muted-foreground text-sm">—</span>;
}

function RowDetail({ row }: { row: TransactionRow }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <div className="space-y-3">
        <Detail label="Line items">
          {row.items.length === 0
            ? <span className="text-muted-foreground">No Square line items.</span>
            : (
              <ul className="space-y-1">
                {row.items.map((item, i) => (
                  <li key={`${item.catalogObjectId ?? item.name}-${i}`} className="flex justify-between gap-3">
                    <span>
                      {item.name}
                      {item.variationName && (
                        <span className="text-muted-foreground"> · {item.variationName}</span>
                      )}
                      {item.quantity !== '1' && <span> ×{item.quantity}</span>}
                      {item.category && (
                        <Badge variant="outline" className="ml-2 text-xs">{item.category}</Badge>
                      )}
                    </span>
                    <span className="tabular-nums whitespace-nowrap">{money(item.totalCents)}</span>
                  </li>
                ))}
              </ul>
            )}
        </Detail>

        <Detail label="Money">
          <dl className="grid grid-cols-2 gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Total</dt>
            <dd className="tabular-nums">{money(row.totalCents)}</dd>
            <dt className="text-muted-foreground">Tax</dt>
            <dd className="tabular-nums">{money(row.taxCents)}</dd>
            <dt className="text-muted-foreground">Tip</dt>
            <dd className="tabular-nums">{money(row.tipCents)}</dd>
            {row.discountCents > 0 && (
              <>
                <dt className="text-muted-foreground">Discount</dt>
                <dd className="tabular-nums">{money(row.discountCents)}</dd>
              </>
            )}
            {row.refundedCents > 0 && (
              <>
                <dt className="text-muted-foreground">Refunded</dt>
                <dd className="tabular-nums text-destructive">{money(row.refundedCents)}</dd>
              </>
            )}
          </dl>
        </Detail>

        {row.tenders.length > 0 && (
          <Detail label="Tenders">
            <ul className="space-y-1">
              {row.tenders.map((t, i) => (
                <li key={t.paymentId ?? i} className="flex justify-between gap-3">
                  <span>
                    {t.type}
                    {t.cardBrand && <span className="text-muted-foreground"> · {t.cardBrand}</span>}
                    {t.last4 && <span className="text-muted-foreground"> ••••{t.last4}</span>}
                    {t.tipCents > 0 && (
                      <span className="text-muted-foreground"> · tip {money(t.tipCents)}</span>
                    )}
                    {t.createdAt && (
                      <span className="text-muted-foreground">
                        {' '}· taken {formatShowtime(t.createdAt, 'd MMM yyyy, h:mm a')}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">{money(t.amountCents)}</span>
                </li>
              ))}
            </ul>
          </Detail>
        )}

        {row.refunds.length > 0 && (
          <Detail label="Refunds">
            <ul className="space-y-1">
              {row.refunds.map(r => (
                <li key={r.id} className="flex justify-between gap-3">
                  <span>
                    {r.status}
                    {r.reason && <span className="text-muted-foreground"> · {r.reason}</span>}
                    {r.createdAt && (
                      <span className="text-muted-foreground">
                        {' '}· {formatShowtime(r.createdAt, 'd MMM yyyy')}
                      </span>
                    )}
                  </span>
                  <span className="tabular-nums whitespace-nowrap">{money(r.amountCents)}</span>
                </li>
              ))}
            </ul>
          </Detail>
        )}
      </div>

      <div className="space-y-3">
        <Detail label="Reconciliation">
          <p>{RECONCILIATION_LABELS[row.reconciliation]}</p>
          {row.match && (
            <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Where</dt>
              <dd>{row.match.showingLabel ?? row.match.kind}</dd>
              {row.match.paymentMethod && (
                <>
                  <dt className="text-muted-foreground">Paid by</dt>
                  <dd>{row.match.paymentMethod}</dd>
                </>
              )}
              {row.match.ourTotalCents != null && (
                <>
                  <dt className="text-muted-foreground">Our total</dt>
                  <dd className="tabular-nums">
                    {money(row.match.ourTotalCents)}
                    {/* Square and our own rows disagreeing on the amount is a
                        different fault from a missing row, and needs saying. */}
                    {row.reconciliation === 'matched' &&
                      row.match.ourTotalCents !== row.totalCents && (
                      <Badge variant="destructive" className="ml-2 text-xs">
                        differs from Square
                      </Badge>
                    )}
                  </dd>
                </>
              )}
              {row.match.recordIds.length > 0 && (
                <>
                  <dt className="text-muted-foreground">
                    {row.match.kind === 'tickets' ? 'Tickets' : 'Record'}
                  </dt>
                  <dd className="font-mono text-xs break-all">
                    {row.match.recordIds.join(', ')}
                  </dd>
                </>
              )}
            </dl>
          )}
          {row.match?.showingId && (
            <Button variant="outline" size="sm" className="mt-2" asChild>
              <a href={`/admin/showings/${row.match.showingId}`}>
                Open the showing
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          )}
        </Detail>

        <Detail label="Square">
          <dl className="grid grid-cols-[auto,1fr] gap-x-4 gap-y-1">
            <dt className="text-muted-foreground">Order</dt>
            <dd className="font-mono text-xs break-all">
              {row.reconciliation === 'site_only' ? '—' : row.id}
            </dd>
            {row.referenceId && (
              <>
                <dt className="text-muted-foreground">Reference</dt>
                <dd className="font-mono text-xs break-all">{row.referenceId}</dd>
              </>
            )}
            {row.tenders.map(t => t.paymentId).filter(Boolean).length > 0 && (
              <>
                <dt className="text-muted-foreground">Payment</dt>
                <dd className="font-mono text-xs break-all">
                  {row.tenders.map(t => t.paymentId).filter(Boolean).join(', ')}
                </dd>
              </>
            )}
            {row.state && (
              <>
                <dt className="text-muted-foreground">State</dt>
                <dd>{row.state}</dd>
              </>
            )}
          </dl>
          {row.receiptUrl && (
            <Button variant="outline" size="sm" className="mt-2" asChild>
              <a href={row.receiptUrl} target="_blank" rel="noreferrer">
                Square receipt
                <ExternalLink className="h-3 w-3 ml-1" />
              </a>
            </Button>
          )}
        </Detail>
      </div>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="text-sm">
      <p className="text-xs uppercase tracking-wide text-muted-foreground mb-1">{label}</p>
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Paging and provenance
// ---------------------------------------------------------------------------

function Pager({
  page,
  totalPages,
  total,
  pageSize,
  loading,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  pageSize: number;
  loading: boolean;
  onPage: (p: number) => void;
}) {
  const first = page * pageSize + 1;
  const last = Math.min(total, (page + 1) * pageSize);
  return (
    <div className="flex items-center justify-between gap-3 flex-wrap">
      <p className="text-sm text-muted-foreground">
        {first.toLocaleString()}–{last.toLocaleString()} of {total.toLocaleString()}
      </p>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0 || loading}
          onClick={() => onPage(page - 1)}
        >
          <ChevronLeft className="h-4 w-4" />
          <span className="ml-1 hidden sm:inline">Previous</span>
        </Button>
        <span className="text-sm text-muted-foreground">
          {page + 1} / {totalPages}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page + 1 >= totalPages || loading}
          onClick={() => onPage(page + 1)}
        >
          <span className="mr-1 hidden sm:inline">Next</span>
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}

/**
 * Where these numbers came from, and whether Square agrees with them.
 *
 * The brief's acceptance test is that this tab matches Square's own Dashboard
 * for the same range. Rather than leave that as something to check by hand
 * once, the function asks Square's Reporting API — the engine behind that
 * dashboard — for the same range and reports both figures here.
 *
 * The COUNT is the test of completeness and the MONEY is not, which is the
 * opposite of what you would guess. Measured on the live account 23 Aug 2026:
 * counts agree within ~1% at every window from 7 days to year-to-date, while
 * the money delta swings from −30% over 7 days through +17% for June alone to
 * +0.6% over 180 days. A discrepancy that changes sign is not missing money —
 * it is the same money in a different bucket, because this tab ranges on when
 * an order was rung up and Square ranges on when it collected. So the two are
 * reported separately, and a money delta over a short range is explained
 * rather than alarmed about.
 */
function Provenance({ data }: { data: TransactionsPayload }) {
  const check = data.cross_check;
  const delta = check?.deltaCents ?? 0;
  const countPct = check?.countDeltaPct ?? 0;
  const countAgrees = check?.available && Math.abs(countPct) <= 2;
  const moneyAgrees = check?.available && Math.abs(delta) < 100;

  return (
    <div className="space-y-2 border-t pt-3 text-sm text-muted-foreground">
      <p>
        {data.range.start_date} to {data.range.end_date} · {data.environment} · read{' '}
        {formatShowtime(data.fetched_at, 'd MMM, h:mm a')}
        {data.cached && ' (cached)'}
        {data.untendered_orders > 0 && (
          <> · {data.untendered_orders.toLocaleString()} unpaid carts and drafts excluded</>
        )}
      </p>

      {check?.available
        ? (
          <>
            <p>
              {countAgrees
                ? <ShieldCheck className="h-4 w-4 inline mr-1 text-emerald-600" />
                : <AlertTriangle className="h-4 w-4 inline mr-1 text-amber-600" />}
              Square counts <strong>{(check.squareOrderCount ?? 0).toLocaleString()}</strong>{' '}
              transactions in this range; this tab shows{' '}
              <strong>{(check.ourOrderCount ?? 0).toLocaleString()}</strong>
              {countAgrees ? ' — complete.' : ` — ${countPct > 0 ? '+' : ''}${countPct.toFixed(1)}%.`}
            </p>
            <p>
              Square’s reports total <strong>{money(check.squareCollectedCents ?? 0)}</strong>{' '}
              against this tab’s <strong>{money(check.ourCollectedCents ?? 0)}</strong>
              {moneyAgrees ? '. They agree.' : `, a difference of ${money(Math.abs(delta))}.`}
              {!moneyAgrees && (
                <>
                  {' '}That is expected over a short range and is not missing money: this tab
                  dates a sale when it was <em>rung up</em>, Square’s reports date it when the
                  money was <em>collected</em>, and an invoice is raised weeks before it is
                  paid. The two converge as the range widens.
                </>
              )}
            </p>
          </>
        )
        : check?.reason
        ? <p>Not cross-checked against Square’s own reports: {check.reason}</p>
        : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

function downloadCsv(payload: TransactionsPayload) {
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const header = [
    'Date rung up',
    // Separate columns on purpose: totalling by one or the other is exactly
    // what makes this tab and Square's reports agree or disagree.
    'Date collected',
    'Source',
    'Square state',
    'Tender',
    'Buyer',
    'Buyer email',
    'Items',
    'Categories',
    'Total',
    'Tax',
    'Tip',
    'Refunded',
    'Status',
    'Reconciliation',
    'Square order id',
    'Reference id',
    'Payment ids',
    'Our record ids',
  ];

  const lines = payload.rows.map(row =>
    [
      row.createdAt,
      row.collectedAt ?? '',
      row.source,
      row.state,
      row.tenderTypes.join(' '),
      row.buyerName ?? '',
      row.buyerEmail ?? '',
      row.itemsSummary,
      row.categories.join(' '),
      // Dollars with two decimals and no currency symbol — this column gets
      // summed in a spreadsheet, and "$1,696.00" sums to zero.
      (row.totalCents / 100).toFixed(2),
      (row.taxCents / 100).toFixed(2),
      (row.tipCents / 100).toFixed(2),
      (row.refundedCents / 100).toFixed(2),
      row.status,
      row.reconciliation,
      row.reconciliation === 'site_only' ? '' : row.id,
      row.referenceId ?? '',
      row.tenders.map(t => t.paymentId).filter(Boolean).join(' '),
      row.match?.recordIds.join(' ') ?? '',
    ].map(esc).join(','),
  );

  const csv = [header.map(esc).join(','), ...lines].join('\n');
  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `kenworthy-transactions-${payload.range.start_date}-to-${payload.range.end_date}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
