import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';

// October 2026's real shape: long show titles, 23 categories, and an
// Uncategorized item whose total is the sum of many small sales.
const LONG = 'Grand Kyiv Ballet ~ THE NUTCRACKER: SYMPHONY OF LIGHTS';
const performers = [
  { title: LONG, revenueCents: 655000, count: 60 },
  { title: 'Page to Screen: The Silence of the Lambs', revenueCents: 360000, count: 300 },
  { title: 'Inland Harmony Chorus: Razzle, Dazzle, Stars and Stripes', revenueCents: 155000, count: 78 },
  { title: 'Centennial Series: Little Miss Sunshine', revenueCents: 90000, count: 1 },
];
const categories = Array.from({ length: 12 }, (_, i) => ({
  name: `${i + 1} Category ${i + 1}`, amountCents: (12 - i) * 10000, quantity: 1,
}));
const payload = {
  range: { start: '2026-10-01', end: '2026-10-31' },
  granularity: 'day',
  totals: {
    totalCollectedCents: 1, netSalesCents: 1, grossSalesCents: 1, ticketsSold: 1, avgPerTicketCents: 1,
    concessionRevenueCents: 1, refundCount: 0, refundCents: 0, tipsCents: 0, taxCents: 0,
  },
  revenueByDay: [],
  revenueByCategory: categories,
  topPerformers: performers,
  uncategorized: [
    { name: "Women's World Cup", amountCents: 300000, quantity: 1 },
    { name: 'Donation', amountCents: 20200, quantity: 30 },
  ],
  meta: { orders: 1, categories: 12, truncated: false, source: 'reporting-api' },
};

vi.mock('@/integrations/supabase/client', () => {
  const chain: any = {
    select: () => chain, eq: () => chain, order: () => chain,
    range: () => Promise.resolve({ data: [], error: null }),
  };
  return {
    supabase: {
      functions: { invoke: () => Promise.resolve({ data: payload, error: null }) },
      from: () => chain,
    },
  };
});
vi.mock('./labor/LaborVsSales', () => ({ LaborVsSales: () => null }));

const { writeSectionOpen } = await import('@/lib/adminSectionState');
const { default: AnalyticsTab } = await import('./AnalyticsTab');

// These sections start collapsed; open them the way a returning admin would.
beforeEach(() => {
  for (const id of ['analytics.by-category', 'analytics.uncategorized', 'analytics.top-performers']) {
    writeSectionOpen(id, true);
  }
});

describe('Overview ranked lists', () => {
  it('names every Top Performers bar in full, with its ticket count', async () => {
    render(<AnalyticsTab />);
    expect(await screen.findByText(LONG)).toBeTruthy();
    for (const p of performers) expect(screen.getByText(p.title)).toBeTruthy();
    expect(screen.getByText('60 tickets')).toBeTruthy();
    expect(screen.getByText('1 ticket')).toBeTruthy();
  });

  it('says which categories "Other" stands for', async () => {
    render(<AnalyticsTab />);
    expect(await screen.findByText('Other (3 more)')).toBeTruthy();
    expect(screen.getByText('10 Category 10, 11 Category 11, 12 Category 12')).toBeTruthy();
  });

  it('shows Uncategorized as Sold and Total, so a total does not read as a unit price', async () => {
    render(<AnalyticsTab />);
    const row = (await screen.findByText('Donation')).closest('tr')!;
    const cells = within(row).getAllByRole('cell').map(c => c.textContent);
    expect(cells).toEqual(['Donation', '30', '$202.00']);
    expect(screen.getByRole('columnheader', { name: 'Total' })).toBeTruthy();
  });
});
