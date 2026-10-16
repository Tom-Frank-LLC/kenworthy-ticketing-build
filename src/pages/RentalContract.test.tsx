import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import RentalContract, { BLANK_DRAFT_KEY, EMPTY_BLANK, blankCosts } from './RentalContract';

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
// rental_requests.update(...).eq(...).select('id'): record the patch, answer
// with whatever `updated` holds — [] is what an RLS refusal looks like.
const update = vi.fn();
let updated: { data: unknown[] | null; error: { message: string } | null } = { data: [{ id: 'req_1' }], error: null };
const invoke = vi.fn().mockResolvedValue({ data: { error: 'stop here' }, error: null });
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpc(...args),
    from: () => ({
      update: (patch: unknown) => {
        update(patch);
        return { eq: () => ({ select: () => Promise.resolve(updated) }) };
      },
    }),
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

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/contract/blank" element={<RentalContract blank />} />
        <Route path="/contract/:token" element={<RentalContract />} />
      </Routes>
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

  it('has nothing to save or sign', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(screen.queryByRole('button', { name: /^save$/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /sign/i })).toBeNull();
  });

  it('downloads as Kenworthy-Contract-BLANK.pdf', async () => {
    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    fireEvent.click(editor().getByRole('button', { name: /download pdf/i }));
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ filename: 'Kenworthy-Contract-BLANK.pdf' }));
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
    await waitFor(() => expect(save).toHaveBeenCalled());
    expect(set).toHaveBeenCalledWith(expect.objectContaining({ filename: 'Kenworthy-Contract-Jane-Doe.pdf' }));
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
    first.unmount();

    renderAt('/contract/blank');
    await screen.findByText('License Agreement');
    expect(costs()).toContain('Rehearsal');
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
