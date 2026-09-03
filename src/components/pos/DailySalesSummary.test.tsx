import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DailySalesSummary } from './DailySalesSummary';

/**
 * The two cards answer different questions and will normally disagree.
 *
 * "Today's Revenue" is scoped by when the money arrived; "Tickets for Today"
 * is scoped by when the showing is. A seat bought last week for tonight is in
 * the second and not the first. They were both labelled "today" once and staff
 * read one against the other, so the labels are load-bearing.
 */
describe('DailySalesSummary', () => {
  const props = {
    revenue: 461.6,
    ticketRevenue: 381.6,
    filmPassRevenue: 80,
    concessionRevenue: 0,
    todaysTicketCount: 39,
    refundCount: 0,
  };

  it('breaks the day’s takings into its three streams', () => {
    render(<DailySalesSummary {...props} />);
    expect(screen.getByText('$461.60')).toBeInTheDocument();
    expect(screen.getByText('$381.60')).toBeInTheDocument();
    expect(screen.getByText('$80.00')).toBeInTheDocument();
    // Concessions stays visible at zero: the line is where the number will
    // appear once the tab takes payment, not a claim that it is broken.
    expect(screen.getByText('Concessions')).toBeInTheDocument();
    expect(screen.getByText('$0.00')).toBeInTheDocument();
  });

  it('the three lines sum to the headline', () => {
    const { ticketRevenue, filmPassRevenue, concessionRevenue, revenue } = props;
    expect(ticketRevenue + filmPassRevenue + concessionRevenue).toBeCloseTo(revenue, 2);
  });

  it('counts tonight’s house separately from the day’s sales', () => {
    render(<DailySalesSummary {...props} />);
    expect(screen.getByText('Tickets for Today')).toBeInTheDocument();
    expect(screen.getByText('39')).toBeInTheDocument();
    expect(screen.getByText("Sold for today's showings")).toBeInTheDocument();
    // The old label invited exactly the comparison that misleads.
    expect(screen.queryByText('Tickets Sold')).not.toBeInTheDocument();
  });
});
