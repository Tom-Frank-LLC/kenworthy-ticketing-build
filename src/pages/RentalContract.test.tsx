import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import RentalContract, { BLANK_DRAFT_KEY, EMPTY_BLANK, blankCosts, parseBlankFields } from './RentalContract';

/**
 * Two promises the contract page makes that only show up on paper.
 *
 * A blank contract is for writing on. Any merge field that falls back to
 * something — today's date, `__________`, `$0.00` — prints a value the person
 * holding the pen then has to cross out, so every fill-in must come out as an
 * empty ruled line, and the page must not need a request to render at all.
 *
 * A blank contract is also a worksheet: whatever a staffer types fills its
 * line, and everything else stays a line. A partly filled form must print
 * exactly what was typed and nothing that was not.
 *
 * Print must be the same file as Download. `window.print()` printed the web
 * page with the browser's URL and date stamped on it; the button now builds the
 * html2pdf output and opens that.
 */

const rpc = vi.fn();
// supabase.from(table): a chain that records each write and answers from
// `updated` (an update or insert; [] is what an RLS refusal looks like) or
// `rows[table]` (a read).
type Result = { data: unknown[] | null; error: { message: string } | null };
const update = vi.fn();
const insert = vi.fn();
let writtenTo: string[] = [];
let updated: Result = { data: [{ id: 'req_1' }], error: null };
let rows: Record<string, Result> = {};
const invoke = vi.fn().mockResolvedValue({ data: { error: 'stop here' }, error: null });
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: (table: string) => {
      let write = false;
      const chain: Record<string, unknown> = {
        update: (patch: unknown) => { update(patch); writtenTo.push(table); write = true; return chain; },
        insert: (row: unknown) => { insert(row); writtenTo.push(table); write = true; return chain; },
        select: () => chain, eq: () => chain, in: () => chain, order: () => chain, limit: () => chain, range: () => chain,
        then: (ok: (r: Result) => unknown, fail: (e: unknown) => unknown) =>
          Promise.resolve(write ? updated : rows[table] ?? { data: [], error: null }).then(ok, fail),
      };
      return chain;
    },
    functions: { invoke: (...args: unknown[]) => invoke(...args) },
  },
}));

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m), success: (m: string) => toastSuccess(m) } }));

let isAdmin = true;
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ isAdmin }) }));

// html2pdf is a chain; record what the page asked of it.
const outputPdf = vi.fn().mockResolvedValue(new Blob(['%PDF'], { type: 'application/pdf' }));
const save = vi.fn().mockResolvedValue(undefined);
const set = vi.fn();
vi.mock('html2pdf.js', () => ({
  default: () => {
    type Chain = { set(o: unknown): Chain; from(): Chain; outputPdf(...a: unknown[]): Promise<Blob>; save(): Promise<void> };
    const chain: Chain = {
      set: (o: unknown) => { set(o); return chain; },
      from: () => chain,
      outputPdf: (...a: unknown[]) => outputPdf(...a),
      save: () => save(),
    };
    return chain;
  },
}));

const REQUEST = {
  id: 'req_1',
  event_title: 'Harvest Gala',
  applicant_name: 'Ada Lovelace',
  email: 'ada@example.com',
  created_at: '2026-10-01T12:00:00Z',
  proposed_date: '2026-11-14',
  event_start_time: '18:00',
  event_end_time: '22:00',
  event_description: 'A dinner',
  wants_beer_wine: false,
  contract_data: null,
};

// Where the router ended up, for a link that moves to the request's contract.
let location = '';
function LocationProbe() {
  const l = useLocation();
  location = l.pathname + l.search;
  return null;
}

// The link step's "Not now", for tests about what a standalone blank does.
async function notNow() {
  fireEvent.click(await screen.findByRole('button', { name: /not now/i }));
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/contract/blank" element={<RentalContract blank />} />
        <Route path="/contract/blank/:blankId" element={<RentalContract blank />} />
        <Route path="/contract/:token" element={<RentalContract />} />
      </Routes>
      <LocationProbe />
    </MemoryRouter>,
  );
}

// The blank form's own buttons, beside Clear form. An admin also has a pair in
// the toolbar, so the page as a whole has two of each.
function editor() {
  return within(screen.getByRole('region', { name: 'Fill in the contract' }));
}

function contractText() {
  return document.getElementById('contract-body')!.textContent!;
}

beforeEach(() => {
  isAdmin = true;
  rpc.mockReset().mockResolvedValue({ data: [REQUEST], error: null });
  update.mockClear();
  insert.mockClear();
  writtenTo = [];
  rows = {};
  invoke.mockClear();
  toastError.mockClear();
  toastSuccess.mockClear();
  updated = { data: [{ id: 'req_1' }], error: null };
  outputPdf.mockClear();
  save.mockClear();
  set.mockClear();
  window.sessionStorage.clear();
});

afterEach(() => vi.restoreAllMocks());

describe('blank contract', () => {
  it('renders without loading a request', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('leaves every fill-in as a ruled blank: no date, no name, no money', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    const text = contractText();

    // The clauses quote fees of their own ($200, $100.00), so look for ours.
    expect(text).not.toContain('$0.00');
    expect(text).not.toContain('$180');        // the default hourly rate
    expect(text).not.toContain('2026');        // no agreement or event date
    expect(text).not.toContain('__________');  // ruled lines, not underscores
    expect(text).not.toContain('Ada');

    // Date ×2, licensee, contact, term date + start + end time, consideration,
    // purpose, attendees, two rate × hours pairs (theater, staff; additional
    // hours and rehearsal are dropped until typed), estimated and total cost.
    expect(document.querySelectorAll('[data-blank-fill]').length).toBe(16);
  });

  it('keeps the boilerplate, and carries both addenda for the writer to choose', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    const text = contractText();
    expect(text).toContain('FIVE HUNDRED THOUSAND DOLLARS');
    expect(text).toContain('Non-Discrimination Clause');
    // Stipulation B names the alcohol addendum too, so count headings, not text.
    expect(screen.getByRole('heading', { name: 'Addendum 1 — Alcohol Agreement' })).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Addendum 1 — No Alcohol Service' })).toBeTruthy();
  });

  it('can be saved but never signed', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /sign/i })).toBeNull();
  });

  it('downloads an empty form as BLANK.pdf, and keeps no record of it', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ filename: 'BLANK.pdf' }));
    expect(insert).not.toHaveBeenCalled();
  });
});

describe('filling in the blank contract', () => {
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  it('a name alone fills the name and leaves every other line ruled', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Licensee name', 'Jane Doe');

    const text = contractText();
    expect(text).toContain('Jane Doe');
    expect(text).not.toContain('$0.00');
    expect(text).not.toContain('2026');
    // Licensee and correspondence lines are filled; the other 14 stay ruled.
    expect(document.querySelectorAll('[data-blank-fill]').length).toBe(14);

    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await notNow();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ filename: 'Jane_Doe.pdf' }));
  });

  for (const admin of [true, false]) {
    it(`puts Download and Print beside Clear form (${admin ? 'admin' : 'renter'})`, async () => {
      isAdmin = admin;
      const tab = { location: { href: '' }, close: vi.fn() };
      vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      URL.createObjectURL = vi.fn(() => 'blob:contract');
      URL.revokeObjectURL = vi.fn();

      renderAt('/contract/blank');
      await screen.findByText('License Agreement');
      expect(editor().getByRole('button', { name: /clear form/i })).toBeTruthy();
      fireEvent.click(editor().getByRole('button', { name: /print \/ save pdf/i }));
      await waitFor(() => expect(tab.location.href).toBe('blob:contract'));
      expect(outputPdf).toHaveBeenCalledWith('blob');
    });
  }

  it('prints what was typed, and only that', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Event date', '2026-11-14');
    type('Start time', '18:00');
    type('Hourly rate ($/hr)', '180');
    type('Base hours', '4');

    const text = contractText();
    expect(text).toContain('Saturday November 14th, 2026');
    expect(text).toContain('6:00 PM');
    expect(text).toContain('$720.00');
    expect(text).not.toContain('through');  // no end date typed
    expect(text).not.toContain('$0.00');    // untyped cost lines stay lines
  });

  it('carries one addendum once it is chosen', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Alcohol addendum', 'not_served');
    expect(screen.queryByRole('heading', { name: 'Addendum 1 — Alcohol Agreement' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Addendum 1 — No Alcohol Service' })).toBeTruthy();
  });

  it('survives a refresh, and Clear empties it', async () => {
    const first = renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Licensee name', 'Jane Doe');
    first.unmount();

    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(contractText()).toContain('Jane Doe');

    fireEvent.click(screen.getByRole('button', { name: /clear form/i }));
    expect(contractText()).not.toContain('Jane Doe');
    expect(document.querySelectorAll('[data-blank-fill]').length).toBe(16);
    expect(window.sessionStorage.getItem(BLANK_DRAFT_KEY)).toBeNull();
  });
});

describe('another day in the Term', () => {
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const day = (n: number) => within(screen.getByRole('group', { name: `Another day in the Term (${n})` }));
  const typeDay = (n: number, label: string, value: string) =>
    fireEvent.change(day(n).getByLabelText(label), { target: { value } });
  const term = () => document.querySelector('[data-term-day]')!.closest('p')!.textContent!.replace(/\s+/g, ' ');

  it('adds a day with its own date and hours after the event', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Event date', '2026-11-13');
    type('Start time', '18:00');
    type('End time', '20:30');
    fireEvent.click(screen.getByRole('button', { name: /add another day/i }));
    typeDay(1, 'Date', '2026-11-12');
    typeDay(1, 'Start time', '18:00');
    typeDay(1, 'End time', '21:00');

    expect(term()).toContain(
      'shall include Friday November 13th, 2026, from 6:00 PM to 8:30 PM, '
      + 'and for rehearsal / load-in Thursday November 12th, 2026, from 6:00 PM to 9:00 PM. '
      + 'Term is assessed from the time in which KPAC staff begins preparations',
    );
  });

  it('an empty added day is three ruled blanks, not a placeholder', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    fireEvent.click(screen.getByRole('button', { name: /add another day/i }));
    expect(document.querySelectorAll('[data-blank-fill]').length).toBe(16 + 3);
    expect(contractText()).not.toContain('0:00');

    // Times without a date, and a cleared label: the date stays a line, no "for".
    typeDay(1, 'For', '');
    typeDay(1, 'Start time', '09:00');
    expect(term()).toContain(', and , from 9:00 AM to');
    expect(document.querySelectorAll('[data-term-day] [data-blank-fill]').length).toBe(2);
  });

  it('removes a day, keeps the rest, and Clear empties them all', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    const add = screen.getByRole('button', { name: /add another day/i });
    fireEvent.click(add);
    fireEvent.click(add);
    typeDay(1, 'For', 'load-in');
    typeDay(2, 'For', 'tech rehearsal');
    fireEvent.click(day(1).getByRole('button', { name: /remove this day/i }));
    expect(contractText()).not.toContain('load-in');
    expect(contractText()).toContain('for tech rehearsal');

    fireEvent.click(editor().getByRole('button', { name: /clear form/i }));
    expect(document.querySelector('[data-term-day]')).toBeNull();
    expect(window.sessionStorage.getItem(BLANK_DRAFT_KEY)).toBeNull();
  });

  it('survives a refresh', async () => {
    const first = renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    fireEvent.click(screen.getByRole('button', { name: /add another day/i }));
    typeDay(1, 'Date', '2026-11-12');
    first.unmount();

    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(contractText()).toContain('for rehearsal / load-in Thursday November 12th, 2026');
  });

  it('an added day with nothing typed is still a draft worth keeping', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    fireEvent.click(screen.getByRole('button', { name: /add another day/i }));
    typeDay(1, 'For', '');
    await waitFor(() => expect(window.sessionStorage.getItem(BLANK_DRAFT_KEY)).not.toBeNull());
  });

  it('ignores a malformed saved draft rather than crashing', async () => {
    window.sessionStorage.setItem(BLANK_DRAFT_KEY, JSON.stringify({ name: 'Jane', extra_days: [null, { date: 5 }] }));
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(contractText()).toContain('Jane');
    expect(document.querySelectorAll('[data-term-day]').length).toBe(2);
  });

  it('a renter opening a real contract can read the Term but not edit it', async () => {
    isAdmin = false;
    rpc.mockResolvedValue({
      data: [{ ...REQUEST, contract_data: { extra_days: [{ label: 'load-in', date: '2026-11-13', start: '', end: '' }] } }],
      error: null,
    });
    renderAt('/contract/tok_1');
    await screen.findByText('License Agreement');
    expect(screen.queryByRole('button', { name: /add another day/i })).toBeNull();
    expect(contractText()).toContain('and for load-in Friday November 13th, 2026');
  });
});

describe('the buttons below the contract', () => {
  const bottom = () => screen.queryByTestId('contract-bottom-actions');

  it('are on the blank form for an admin too', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    fireEvent.click(within(bottom()!).getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(within(bottom()!).getByRole('button', { name: /print \/ save pdf/i })).toBeTruthy();
  });

  it('stay off a real contract for an admin, who has the toolbar', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(bottom()).toBeNull();
  });
});

describe('cost lines', () => {
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const costs = () => document.querySelector('#contract-body table')!.textContent!;
  const subtotalRow = () => screen.getByText('Subtotal').closest('tr')!.textContent!;

  it('drops additional hours, rehearsal and discount from a blank form until typed', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(costs()).not.toContain('Additional Hours');
    expect(costs()).not.toContain('Rehearsal');
    expect(costs()).not.toContain('Discount');
    expect(costs()).toContain('Concessions Fees');

    // A rate alone brings the line back, with its hours still to write in.
    type("Add'l hour rate", '50');
    expect(costs()).toContain('Additional Hours');
    type('Rehearsal rate ($/hr)', '90');
    expect(costs()).toContain('Rehearsal');
    // Zero hours is no line at all.
    type("Add'l hours", '0');
    expect(costs()).not.toContain('Additional Hours');
  });

  it('adds rehearsal and takes off the discount, on a blank form', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Hourly rate ($/hr)', '180');
    type('Base hours', '4');
    type('Rehearsal rate ($/hr)', '90');
    type('Rehearsal hours', '2');
    type('Non-profit discount ($)', '100');
    expect(costs()).toContain('Rehearsal ($90/hr × 2)$180.00');
    expect(costs()).toContain('Non-Profit Discount-$100.00');
    expect(subtotalRow()).toContain('$800.00');           // 720 + 180 − 100
    expect(contractText()).toContain('Total Rental Cost: $800.00');
  });

  it('a blank form bills a second rental rate only once it is typed', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    const rentalRows = () => costs().match(/Theater Rental/g)?.length ?? 0;
    expect(rentalRows()).toBe(1);
    type('Hourly rate ($/hr)', '120');
    type('Base hours', '3');
    type('Second rental rate ($/hr)', '180');
    expect(rentalRows()).toBe(2);           // a rate alone brings the line back
    type('Second rental hours', '2');
    expect(costs()).toContain('Theater Rental ($120/hr × 3)$360.00');
    expect(costs()).toContain('Theater Rental ($180/hr × 2)$360.00');
    expect(subtotalRow()).toContain('$720.00');
    expect(contractText()).toContain('Total Rental Cost: $720.00');
    type('Second rental hours', '0');
    expect(rentalRows()).toBe(1);
  });

  it('a real contract shows a second rental rate only when set, and saves it', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(costs().match(/Theater Rental/g)).toHaveLength(1);

    type('Second rental rate ($/hr)', '120');
    type('Second rental hours', '2');
    expect(costs()).toContain('Theater Rental ($120/hr × 2)$240.00');
    expect(subtotalRow()).toContain('$960.00');           // 720 + 240
    expect(contractText()).toContain('Estimated Rental Cost: $960.00');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Contract saved'));
    expect(update).toHaveBeenCalledWith({
      contract_data: expect.objectContaining({ rental_rate_2: 120, rental_hours_2: 2 }),
    });
  });

  it('sets the contract in Georgia, and leaves the rest of the page alone', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    const body = document.getElementById('contract-body')!;
    expect(body.className).toContain('font-contract');
    expect(body.querySelector('.font-display, .font-serif')).toBeNull();
    // The global h1–h6 rule is Anton in capitals; every heading here overrides it.
    for (const h of body.querySelectorAll('h1, h2')) {
      expect(h.className).toContain('font-contract');
      expect(h.className).toContain('normal-case');
    }
    expect(screen.getByText(/Contract Editor/).className).toContain('font-display');
  });

  it('prints TBD for an unset DCP fee and leaves it out of the subtotal', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(costs()).toContain('LCD / DVD / DCP FeesTBD');
    expect(subtotalRow()).toContain('$720.00');

    type('LCD/DVD/DCP fee', '75');
    expect(costs()).toContain('LCD / DVD / DCP Fees$75.00');
    expect(subtotalRow()).toContain('$795.00');
  });

  it('a blank form prints TBD for the DCP fee too', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(costs()).toContain('LCD / DVD / DCP FeesTBD');
  });

  it('a real contract shows rehearsal and discount only when set, and saves them', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(costs()).not.toContain('Rehearsal');
    expect(costs()).not.toContain('Discount');

    type('Rehearsal rate ($/hr)', '60');
    type('Rehearsal hours', '3');
    type('Non-profit discount ($)', '50');
    expect(costs()).toContain('Rehearsal ($60/hr × 3)$180.00');
    expect(costs()).toContain('Non-Profit Discount-$50.00');
    expect(subtotalRow()).toContain('$850.00');           // 720 + 180 − 50
    expect(contractText()).toContain('Estimated Rental Cost: $850.00');

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Contract saved'));
    expect(update).toHaveBeenCalledWith({
      contract_data: expect.objectContaining({ rehearsal_rate: 60, rehearsal_hours: 3, nonprofit_discount: 50 }),
    });
  });

  it('reads saved rehearsal and discount back', async () => {
    rpc.mockResolvedValue({
      data: [{ ...REQUEST, contract_data: { rehearsal_rate: 50, rehearsal_hours: 2, nonprofit_discount: 20 } }],
      error: null,
    });
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(subtotalRow()).toContain('$800.00');           // 720 + 100 − 20
  });

  it('the ticketing clause no longer quotes 3.5%', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(contractText()).not.toContain('3.5%');
    expect(contractText()).toContain('assessed at cost plus labor for listings, service, and web management: 5% gross ticketing revenue.');
  });

  it('the new blank fields survive a refresh, and Clear empties them', async () => {
    const first = renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Rehearsal hours', '2');
    type('Non-profit discount ($)', '40');
    type('Second rental rate ($/hr)', '120');
    first.unmount();

    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(costs()).toContain('Rehearsal');
    expect(costs()).toContain('Theater Rental ($120/hr');
    expect(costs()).toContain('-$40.00');
    fireEvent.click(editor().getByRole('button', { name: /clear form/i }));
    expect(costs()).not.toContain('Rehearsal');
    expect(costs()).not.toContain('Discount');
  });
});

describe('blankCosts', () => {
  it('adds rehearsal and subtracts the discount', () => {
    const c = blankCosts({
      ...EMPTY_BLANK, hourly_rate: '180', base_hours: '4', rehearsal_rate: '90', rehearsal_hours: '2', nonprofit_discount: '100',
    });
    expect(c.rehearsal).toBe(180);
    expect(c.discount).toBe(100);
    expect(c.subtotal).toBe(800);
  });

  it('adds a second rental rate', () => {
    const c = blankCosts({
      ...EMPTY_BLANK, hourly_rate: '120', base_hours: '3', rental_rate_2: '180', rental_hours_2: '2',
    });
    expect(c.base2).toBe(360);
    expect(c.subtotal).toBe(720);
    expect(blankCosts({ ...EMPTY_BLANK, rental_rate_2: '180' }).base2).toBeUndefined();
  });

  it('leaves a line without an amount until all of it is typed', () => {
    const c = blankCosts({ ...EMPTY_BLANK, hourly_rate: '180', staff_rate: '30', staff_hours: '2', av_fee: '0' });
    expect(c.base).toBeUndefined();     // rate with no hours is not $0
    expect(c.staff).toBe(60);
    expect(c.av).toBe(0);               // a typed 0 is a 0
    expect(c.subtotal).toBe(60);
    expect(blankCosts(EMPTY_BLANK).subtotal).toBeUndefined();
  });
});

describe('a real contract', () => {
  it('still fills in its values', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    const text = contractText();
    expect(text).toContain('Ada Lovelace');
    expect(text).toContain('$720.00');        // 4 base hours × $180
    expect(text).toContain('November 14');
    expect(screen.queryByRole('heading', { name: 'Addendum 1 — Alcohol Agreement' })).toBeNull();
    expect(document.querySelectorAll('[data-blank-fill]').length).toBe(0);
    // The blank form's "no Save" assertion is only worth something if this one has it.
    expect(screen.getByRole('button', { name: /^save$/i })).toBeTruthy();
  });
});

describe('the Term on a real contract', () => {
  const term = () => contractText().match(/shall include (.*?)\. Term is assessed/s)![1].replace(/\s+/g, ' ');
  const termEditor = () => within(screen.getByRole('group', { name: 'Term' }));
  const withRequest = (r: Record<string, unknown>) => rpc.mockResolvedValue({ data: [{ ...REQUEST, ...r }], error: null });

  it('is the requested date and hours until staff change it', async () => {
    withRequest({ event_start_time: '18:00:00', event_end_time: '22:00:00' });
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(term()).toBe('Saturday November 14th, 2026, from 6:00 PM to 10:00 PM');
    expect(screen.queryByRole('button', { name: /reset term/i })).toBeNull();
  });

  it('takes staff hours over the request, and Save writes them', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    fireEvent.change(termEditor().getByLabelText('Start time'), { target: { value: '16:00' } });
    fireEvent.change(termEditor().getByLabelText('End time'), { target: { value: '23:30' } });
    fireEvent.click(screen.getByRole('button', { name: /add another day/i }));
    fireEvent.change(
      within(screen.getByRole('group', { name: 'Another day in the Term (1)' })).getByLabelText('Date'),
      { target: { value: '2026-11-13' } },
    );
    expect(term()).toBe(
      'Saturday November 14th, 2026, from 4:00 PM to 11:30 PM, '
      + 'and for rehearsal / load-in Friday November 13th, 2026, from __________ to __________',
    );
    expect(document.querySelectorAll('[data-blank-fill]').length).toBe(0);

    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Contract saved'));
    expect(update).toHaveBeenCalledWith({
      contract_data: expect.objectContaining({
        term_start: '16:00',
        term_end: '23:30',
        extra_days: [{ label: 'rehearsal / load-in', date: '2026-11-13', start: '', end: '' }],
      }),
    });
    expect(update.mock.calls[0][0].contract_data).not.toHaveProperty('term_date');
  });

  it('reads a saved Term back, and Reset returns to the request', async () => {
    withRequest({
      contract_data: {
        term_date: '2026-11-13', term_start: '17:00', term_end: '21:00',
        extra_days: [{ label: 'load-in', date: '2026-11-12', start: '09:00', end: '12:00' }, null],
      },
    });
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(term()).toBe(
      'Friday November 13th, 2026, from 5:00 PM to 9:00 PM, '
      + 'and for load-in Thursday November 12th, 2026, from 9:00 AM to 12:00 PM, '
      + 'and __________, from __________ to __________',
    );

    fireEvent.click(screen.getByRole('button', { name: /reset term to the request/i }));
    expect(term()).toBe('Saturday November 14th, 2026, from 6:00 PM to 10:00 PM');
  });

  it('a cleared field is a deliberate blank, not the request', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    fireEvent.change(termEditor().getByLabelText('End time'), { target: { value: '' } });
    expect(term()).toBe('Saturday November 14th, 2026, from 6:00 PM to __________');
  });
});

describe('saving a real contract', () => {
  it('says so when the write was refused, which looks like success', async () => {
    updated = { data: [], error: null };
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    fireEvent.click(screen.getByRole('button', { name: /^save$/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/not saved/i)));
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('does not sign terms it could not save', async () => {
    updated = { data: [], error: null };
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    fireEvent.click(screen.getByRole('button', { name: /sign & download/i }));
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/not saved/i)));
    expect(invoke).not.toHaveBeenCalled();
    expect(outputPdf).not.toHaveBeenCalled();
  });

  it('signs once the save went through', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    fireEvent.click(screen.getByRole('button', { name: /sign & download/i }));
    await waitFor(() => expect(invoke).toHaveBeenCalledWith('sign-contract', expect.anything()));
  });
});

describe('Print', () => {
  for (const admin of [true, false]) {
    it(`opens the generated PDF instead of printing the page (${admin ? 'admin' : 'renter'})`, async () => {
      isAdmin = admin;
      const tab = { location: { href: '' }, close: vi.fn() };
      const open = vi.spyOn(window, 'open').mockReturnValue(tab as unknown as Window);
      const print = vi.spyOn(window, 'print').mockImplementation(() => {});
      URL.createObjectURL = vi.fn(() => 'blob:contract');
      URL.revokeObjectURL = vi.fn();

      renderAt('/contract/tok_1');
      fireEvent.click(await screen.findByRole('button', { name: /print \/ save pdf/i }));

      await waitFor(() => expect(tab.location.href).toBe('blob:contract'));
      expect(outputPdf).toHaveBeenCalledWith('blob');
      expect(open).toHaveBeenCalledTimes(1);
      expect(print).not.toHaveBeenCalled();
    });
  }
});

describe('saving a blank contract', () => {
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });

  beforeEach(() => {
    updated = { data: [{ id: 'blank_1' }], error: null };
  });

  it('Save keeps it in blank_contracts and gives it its own address', async () => {
    const replace = vi.spyOn(window.history, 'replaceState');
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Purpose', 'Piano recital');
    type('Event date', '2026-11-20');
    expect(window.sessionStorage.getItem(BLANK_DRAFT_KEY)).not.toBeNull();

    fireEvent.click(editor().getByRole('button', { name: /save to contracts/i }));
    await notNow();
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith('Saved to Contracts'));
    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Piano recital', event_date: '2026-11-20', fields: expect.objectContaining({ purpose: 'Piano recital' }) }),
    );
    expect(writtenTo).toEqual(['blank_contracts']);
    expect(replace.mock.calls[replace.mock.calls.length - 1]?.[2]).toBe('/contract/blank/blank_1');
    // The row is the copy now; the tab's draft would only resurrect it on a new blank.
    expect(window.sessionStorage.getItem(BLANK_DRAFT_KEY)).toBeNull();

    // A second save updates the same row instead of making another.
    type('Max attendees', '120');
    fireEvent.click(editor().getByRole('button', { name: /save to contracts/i }));
    await waitFor(() => expect(update).toHaveBeenCalledWith(expect.objectContaining({ title: 'Piano recital' })));
    expect(insert).toHaveBeenCalledTimes(1);
    expect(writtenTo).toEqual(['blank_contracts', 'blank_contracts']);
  });

  it('a download of a filled-in form records it, named for its date and purpose', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Purpose', 'Piano recital');
    type('Event date', '2026-11-20');
    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await notNow();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(insert).toHaveBeenCalledTimes(1);
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ filename: '2026_11_20_Piano_recital.pdf' }));
  });

  it('a renter downloading the public blank writes nothing', async () => {
    isAdmin = false;
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Licensee name', 'Jane Doe');
    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(insert).not.toHaveBeenCalled();
  });

  it('still downloads when the record cannot be written, and says so', async () => {
    updated = { data: [], error: null };
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Licensee name', 'Jane Doe');
    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await notNow();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/not saved to contracts/i));
  });

  it('reopens a saved blank from its row, and an unchanged download writes nothing', async () => {
    rows.blank_contracts = { data: [{ id: 'blank_1', fields: { ...EMPTY_BLANK, name: 'Jane Doe', purpose: 'Recital' } }], error: null };
    renderAt('/contract/blank/blank_1');
    await screen.findByText('License Agreement');
    expect(contractText()).toContain('Jane Doe');
    expect(editor().getByRole('button', { name: /new blank contract/i })).toBeTruthy();

    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await notNow();
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(insert).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  it('says so when a saved blank is gone', async () => {
    renderAt('/contract/blank/missing');
    expect(await screen.findByText('Contract not found.')).toBeTruthy();
  });

  it('round-trips its fields through jsonb, distrusting the shape', () => {
    const typed = { ...EMPTY_BLANK, name: 'Jane', extra_days: [{ label: 'load-in', date: '2026-11-19', start: '09:00', end: '12:00' }] };
    expect(parseBlankFields(JSON.parse(JSON.stringify(typed)))).toEqual(typed);
    expect(parseBlankFields({ name: 7, extra_days: 'no', bogus: 'x' })).toEqual(EMPTY_BLANK);
    expect(parseBlankFields(null)).toEqual(EMPTY_BLANK);
  });
});

describe('request contract downloads', () => {
  it('are named for the Term day and the event title', async () => {
    rpc.mockResolvedValue({ data: [{ ...REQUEST, contract_data: { term_date: '2026-11-13' } }], error: null });
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    fireEvent.click(screen.getByRole('button', { name: /draft pdf/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ filename: '2026_11_13_Harvest_Gala.pdf' }));
  });

  it('fall back to the requested day', async () => {
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    fireEvent.click(screen.getByRole('button', { name: /draft pdf/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ filename: '2026_11_14_Harvest_Gala.pdf' }));
  });

  it('?download=1 downloads once the contract has drawn', async () => {
    renderAt('/contract/tok_1?download=1');
    await screen.findByText(/Contract Editor/);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ filename: '2026_11_14_Harvest_Gala.pdf' }));
  });
});

describe('History', () => {
  const VERSION = {
    id: 'v1', event: 'saved', saved_by: null, saved_at: '2026-10-01T18:00:00Z',
    signed_pdf_sha256: null, signed_pdf_path: null,
    contract_data: { hourly_rate: 100, base_hours: 2 },
    request_snapshot: { applicant_name: 'Ada Byron', event_title: 'Harvest Gala' },
  };

  it('loads nothing until it is opened', async () => {
    const from = vi.spyOn(await import('@/integrations/supabase/client').then(m => m.supabase), 'from');
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(from).not.toHaveBeenCalledWith('contract_versions');
    fireEvent.click(screen.getByRole('button', { name: /^history$/i }));
    await waitFor(() => expect(from).toHaveBeenCalledWith('contract_versions'));
  });

  it('?version= opens showing that version, with History open', async () => {
    rows.contract_versions = { data: [VERSION], error: null };
    renderAt('/contract/tok_1?version=v1');
    await screen.findByText(/Contract Editor/);
    await waitFor(() => expect(contractText()).toContain('Ada Byron'));
    expect(screen.getByRole('status').textContent).toMatch(/Showing the version saved/);
    expect(screen.getByRole('button', { name: /hide history/i })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /back to the current version/i }));
    expect(contractText()).toContain('Ada Lovelace');
  });

  it('?version= of a version it cannot find says so and shows the current contract', async () => {
    renderAt('/contract/tok_1?version=nope');
    await screen.findByText(/Contract Editor/);
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/not found/i)));
    expect(contractText()).toContain('Ada Lovelace');
  });

  it('shows a version as it was, will not sign it, and goes back', async () => {
    rows.contract_versions = { data: [VERSION], error: null };
    renderAt('/contract/tok_1');
    await screen.findByText(/Contract Editor/);
    expect(contractText()).toContain('Ada Lovelace');

    fireEvent.click(screen.getByRole('button', { name: /^history$/i }));
    fireEvent.click(await screen.findByRole('button', { name: /view/i }));
    expect(contractText()).toContain('Ada Byron');
    expect(contractText()).toContain('$200.00');
    expect((screen.getByRole('button', { name: /sign & download/i }) as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: /back to the current version/i }));
    expect(contractText()).toContain('Ada Lovelace');
    expect((screen.getByRole('button', { name: /sign & download/i }) as HTMLButtonElement).disabled).toBe(false);
  });
});

describe('linking a blank to a rental request', () => {
  const type = (label: string, value: string) =>
    fireEvent.change(screen.getByLabelText(label), { target: { value } });
  const EXISTING = {
    id: 'req_9', event_title: 'Piano night', applicant_name: 'J. Doe', organization_name: null, email: 'jane@x.test',
    phone: null, event_description: null, proposed_date: '2026-11-20', end_date: null, event_start_time: null,
    event_end_time: null, signed_at: null, status: 'pending', submitted_at: '2026-10-01T00:00:00Z', invite_token: 'tok_9',
  };
  let linkArgs: Record<string, unknown> | null;

  beforeEach(() => {
    linkArgs = null;
    updated = { data: [{ id: 'blank_1' }], error: null };
    rpc.mockImplementation((name: string, args: Record<string, unknown>) => {
      if (name === 'link_blank_contract') {
        linkArgs = args;
        return Promise.resolve({ data: [{ request_id: 'req_new', invite_token: 'tok_new' }], error: null });
      }
      return Promise.resolve({ data: [REQUEST], error: null });
    });
  });

  it('is not asked about an empty form, and Not now is asked once per visit', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();

    type('Licensee name', 'Jane Doe');
    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await notNow();
    await waitFor(() => expect(save).toHaveBeenCalledTimes(2));
    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('creates the request from what was typed, then downloads from its contract', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Licensee name', 'Jane Doe');
    type('Email', 'jane@x.test');
    type('Purpose', 'Piano recital');
    type('Event date', '2026-11-20');
    type('Hourly rate ($/hr)', '150');
    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));

    const dialog = within(await screen.findByRole('dialog'));
    fireEvent.click(await dialog.findByRole('button', { name: /create a new request/i }));
    expect((dialog.getByLabelText(/event title/i) as HTMLInputElement).value).toBe('Piano recital');
    fireEvent.click(dialog.getByRole('button', { name: /create the request/i }));

    await waitFor(() => expect(linkArgs).not.toBeNull());
    expect(insert).toHaveBeenCalledTimes(1);  // the blank is kept first, so it can be linked
    expect(linkArgs).toMatchObject({
      p_blank_id: 'blank_1', p_request_id: null,
      p_new: expect.objectContaining({ event_title: 'Piano recital', applicant_name: 'Jane Doe', email: 'jane@x.test', proposed_date: '2026-11-20' }),
      p_contract_data: { hourly_rate: 150 },
    });
    await waitFor(() => expect(location).toBe('/contract/tok_new?download=1'));
    await screen.findByText(/Contract Editor/);
    await waitFor(() => expect(save).toHaveBeenCalledTimes(1));
  });

  it('offers the request already in, and keeps only the differences chosen', async () => {
    rows.rental_requests = { data: [EXISTING], error: null };
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    type('Licensee name', 'Jane Doe');
    type('Email', 'jane@x.test');
    type('Event date', '2026-11-21');
    fireEvent.click(editor().getByRole('button', { name: /save to contracts/i }));

    const dialog = within(await screen.findByRole('dialog'));
    const match = within(await dialog.findByRole('region', { name: /possible matches/i }));
    expect(match.getByText(/same email/)).toBeTruthy();
    fireEvent.click(match.getByRole('button', { name: /use piano night/i }));

    // Name and date differ; the request's are chosen until changed.
    fireEvent.click(within(dialog.getByRole('radiogroup', { name: 'Licensee name' })).getByLabelText(/typed/i));
    expect((within(dialog.getByRole('radiogroup', { name: 'Event date' })).getByLabelText(/request/i) as HTMLInputElement).checked).toBe(true);
    fireEvent.click(dialog.getByRole('button', { name: /link and open/i }));

    await waitFor(() => expect(linkArgs).not.toBeNull());
    expect(linkArgs).toMatchObject({ p_request_id: 'req_9', p_new: null, p_patch: { applicant_name: 'Jane Doe' } });
    expect(linkArgs!.p_contract_data).not.toHaveProperty('term_date');
    await waitFor(() => expect(location).toBe('/contract/tok_new'));
  });

  it('takes a linked blank to its request, unless a version of it was asked for', async () => {
    rows.blank_contracts = { data: [{ id: 'blank_1', fields: { ...EMPTY_BLANK, name: 'Jane' }, linked_request_id: 'req_1' }], error: null };
    rows.rental_requests = { data: [{ invite_token: 'tok_1' }], error: null };
    const first = renderAt('/contract/blank/blank_1');
    await waitFor(() => expect(location).toBe('/contract/tok_1'));
    first.unmount();

    renderAt('/contract/blank/blank_1?version=v1');
    expect(await screen.findByText(/now a rental request.s contract/i)).toBeTruthy();
    expect(location).toBe('/contract/blank/blank_1?version=v1');
    expect((editor().getByRole('button', { name: /save to contracts/i }) as HTMLButtonElement).disabled).toBe(true);
    expect(editor().queryByRole('button', { name: /link to a rental request/i })).toBeNull();
  });
});
