import * as XLSX from 'xlsx';

export type FinancialRow = {
  entry_date: string | null;
  source_year: number;
  source_month: string;
  event_name: string | null;
  series: string | null;
  weekday: string | null;
  format: string | null;
  check_status: string | null;
  distributor: string | null;
  fee_terms: string | null;
  attendance: number | null;
  adult: number | null;
  child: number | null;
  kfs: number | null;
  free: number | null;
  box_office: number | null;
  box_tax: number | null;
  concessions: number | null;
  concession_tax: number | null;
  rental: number | null;
  sponsorship: number | null;
  passes: number | null;
  merch: number | null;
  total_income: number | null;
  licensing: number | null;
  other_fees: number | null;
  shipping: number | null;
  online_mkt: number | null;
  print_mkt: number | null;
  staff: number | null;
  utilities: number | null;
  square_fee: number | null;
  sales_tax: number | null;
  supply: number | null;
  total_expense: number | null;
  net: number | null;
  pass_amount: number | null;
  net_plus_pass: number | null;
  con_avg: number | null;
  notes: string | null;
  is_month_total: boolean;
  raw_row: Record<string, any>;
};

const MONTHS = ['january','february','march','april','may','june','july','august','september','october','november','december'];
const MONTH_NUM: Record<string, number> = Object.fromEntries(MONTHS.map((m, i) => [m, i + 1]));

/** Column header → canonical key. Accepts the schema drift across years. */
const HEADER_MAP: Record<string, keyof FinancialRow | 'date'> = {
  'event': 'event_name', 'o': 'event_name',
  'series': 'series',
  'date': 'date',
  'weekday': 'weekday',
  'format': 'format',
  'check status': 'check_status',
  'distributor': 'distributor',
  'fee': 'fee_terms',
  'attendance': 'attendance', 'att': 'attendance',
  'adult': 'adult',
  'child': 'child',
  'free': 'free',
  'kfs': 'kfs',
  'box office': 'box_office', 'box': 'box_office',
  'box tax': 'box_tax',
  'concessions': 'concessions', 'conc': 'concessions',
  'con tax': 'concession_tax',
  'rental': 'rental',
  'sponsorship': 'sponsorship', 'sponsor': 'sponsorship',
  'passes': 'passes',
  'merch': 'merch',
  'total inc': 'total_income',
  'licensing': 'licensing',
  'other fees': 'other_fees', 'fees': 'other_fees',
  'shipping': 'shipping',
  'online mktg': 'online_mkt', 'onl mktg': 'online_mkt',
  'print mktg': 'print_mkt',
  'staff': 'staff',
  'util': 'utilities', 'utilities': 'utilities',
  'square fee': 'square_fee', 'square': 'square_fee',
  'sales tax': 'sales_tax', 'tax': 'sales_tax',
  'supply': 'supply',
  'tot exp': 'total_expense',
  'net': 'net',
  'notes': 'notes',
  'pass amount': 'pass_amount',
  'net+pass': 'net_plus_pass',
  'con avg': 'con_avg',
};

function toNum(v: any): number | null {
  if (v == null || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[$,]/g, '').trim();
  if (!s || s === '-' || s.toLowerCase() === 'merch' || s.toLowerCase() === 'total') return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: any): number | null {
  const n = toNum(v);
  return n == null ? null : Math.round(n);
}

function toIsoDate(v: any): string | null {
  if (!v) return null;
  if (v instanceof Date) {
    return `${v.getUTCFullYear()}-${String(v.getUTCMonth() + 1).padStart(2, '0')}-${String(v.getUTCDate()).padStart(2, '0')}`;
  }
  if (typeof v === 'number') {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`;
  }
  const s = String(v).trim();
  const m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return `${m[3]}-${String(m[1]).padStart(2, '0')}-${String(m[2]).padStart(2, '0')}`;
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

/** Parse a yearly Income & Expenses workbook (one sheet per month). */
export function parseFinancialWorkbook(buffer: ArrayBuffer, year: number): FinancialRow[] {
  const wb = XLSX.read(buffer, { type: 'array', cellDates: true });
  const out: FinancialRow[] = [];

  for (const sheetName of wb.SheetNames) {
    const monthKey = sheetName.toLowerCase();
    if (!MONTH_NUM[monthKey]) continue; // skip Totals etc.
    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    if (rows.length < 2) continue;
    const header = rows[0].map((h: any) => (h == null ? '' : String(h).trim().toLowerCase()));

    const colKey: (keyof FinancialRow | 'date' | null)[] = header.map(h => HEADER_MAP[h] ?? null);

    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      if (!row || row.every(v => v == null || v === '')) continue;

      const rec: any = {
        source_year: year,
        source_month: sheetName,
        is_month_total: false,
      };
      const raw: Record<string, any> = {};
      let hasContent = false;

      for (let c = 0; c < colKey.length; c++) {
        const k = colKey[c];
        const v = row[c];
        if (v != null && v !== '') hasContent = true;
        if (header[c]) raw[header[c]] = v instanceof Date ? v.toISOString() : v;
        if (!k) continue;
        if (k === 'date') {
          rec.entry_date = toIsoDate(v);
        } else if (
          k === 'event_name' || k === 'series' || k === 'weekday' || k === 'format' ||
          k === 'check_status' || k === 'distributor' || k === 'fee_terms' || k === 'notes'
        ) {
          rec[k] = v == null ? null : String(v).trim() || null;
        } else if (k === 'attendance' || k === 'adult' || k === 'child' || k === 'kfs' || k === 'free') {
          rec[k] = toInt(v);
        } else {
          rec[k] = toNum(v);
        }
      }

      if (!hasContent) continue;

      // Skip stray total/summary rows that have neither date nor event
      const ev = (rec.event_name || '').toString().toUpperCase();
      if (ev === 'MONTH TOTAL' || ev === 'TOTAL') {
        rec.is_month_total = true;
      } else if (!rec.entry_date && !rec.event_name) {
        continue;
      }

      rec.raw_row = raw;
      out.push(rec as FinancialRow);
    }
  }

  return out;
}