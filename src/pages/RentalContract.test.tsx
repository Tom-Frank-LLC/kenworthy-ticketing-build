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
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

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
    // purpose, attendees, three rate × hours pairs, estimated and total cost.
    expect(document.querySelectorAll('[data-blank-fill]').length).toBe(18);
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
    // Licensee and correspondence lines are filled; the other 16 stay ruled.
    expect(document.querySelectorAll('[data-blank-fill]').length).toBe(16);

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
    expect(document.querySelectorAll('[data-blank-fill]').length).toBe(18);
    expect(window.sessionStorage.getItem(BLANK_DRAFT_KEY)).toBeNull();
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

describe('blankCosts', () => {
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
