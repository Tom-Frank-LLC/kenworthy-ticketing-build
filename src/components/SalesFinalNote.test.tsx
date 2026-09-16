import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { SalesFinalNote, TICKETS_FINAL, PASSES_FINAL } from './SalesFinalNote';

// Pins the wording. The same sentences are repeated by hand in
// supabase/functions/_shared/notify.ts (the ticket receipt) and in Terms §6,
// and a change to one that misses the others is the contradiction the note
// exists to prevent. tickets_test.ts pins the receipt side.

describe('SalesFinalNote', () => {
  it('states the ticket line verbatim, with the cancellation exception and a link to §6', () => {
    render(
      <MemoryRouter>
        <SalesFinalNote />
      </MemoryRouter>,
    );
    expect(TICKETS_FINAL).toBe('Tickets are non-refundable. All sales are final.');
    expect(screen.getByText(/Tickets are non-refundable\. All sales are final\./)).toBeInTheDocument();
    expect(screen.getByText(/If the Kenworthy cancels a performance, you will be refunded in full\./)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Full ticket policy' })).toHaveAttribute('href', '/terms#refunds');
  });

  it('gives passes their own line and links to §7', () => {
    render(
      <MemoryRouter>
        <SalesFinalNote kind="pass" />
      </MemoryRouter>,
    );
    expect(PASSES_FINAL).toBe('Film passes are non-refundable. All sales are final.');
    expect(screen.getByText(/Film passes are non-refundable\. All sales are final\./)).toBeInTheDocument();
    expect(screen.queryByText(/Tickets are/)).toBeNull();
    expect(screen.getByRole('link', { name: 'Full pass policy' })).toHaveAttribute('href', '/terms#passes');
  });
});
