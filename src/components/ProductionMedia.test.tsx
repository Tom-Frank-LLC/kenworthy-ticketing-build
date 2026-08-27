import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProductionMetaBadges } from './ProductionMedia';

/**
 * This badge is the only place a run time reaches a patron's eye — the showing
 * page, the detail drawer and the listing cards all render this one component.
 *
 * The pairing is the thing worth protecting: the compact form is an
 * abbreviation, and a screen reader announces "1h 48m" as letters. So the badge
 * carries both, and they have to stay in step. A change that updates one and
 * not the other is silent — it looks right on screen and reads as nonsense
 * aloud, which is exactly the kind of regression nobody notices for months.
 */
describe('ProductionMetaBadges', () => {
  it('shows the compact run time and announces the spelled-out one', () => {
    const { container } = render(<ProductionMetaBadges durationMinutes={108} />);

    expect(screen.getByText('1h 48m')).toBeTruthy();
    expect(screen.getByText('1 hour 48 minutes')).toBeTruthy();

    // The spoken twin must be the hidden one, not a second visible copy.
    expect(container.querySelector('.sr-only')?.textContent).toBe('1 hour 48 minutes');
    expect(screen.getByText('1h 48m').getAttribute('aria-hidden')).toBe('true');
  });

  it('renders no runtime for an event, which has none in the schema', () => {
    const { container } = render(<ProductionMetaBadges rating="PG" durationMinutes={null} />);

    expect(screen.getByText('PG')).toBeTruthy();
    expect(container.textContent).not.toMatch(/\d+\s*m\b|minute/);
  });

  it('renders nothing at all when there is no meta to show', () => {
    const { container } = render(<ProductionMetaBadges durationMinutes={0} />);
    expect(container.firstChild).toBeNull();
  });

  it('does not leave an empty badge row for a nonsense duration', () => {
    // A negative or fractional duration is truthy, so guarding on the raw
    // number rather than the formatted string used to render an empty row.
    const { container } = render(<ProductionMetaBadges durationMinutes={-30} />);
    expect(container.firstChild).toBeNull();
  });

  it('gives each genre its own badge', () => {
    // One badge for the whole string reads as a genre called "Drama, Comedy".
    render(<ProductionMetaBadges genre="Drama, Comedy" durationMinutes={108} />);

    expect(screen.getByText('Drama')).toBeTruthy();
    expect(screen.getByText('Comedy')).toBeTruthy();
    expect(screen.queryByText('Drama, Comedy')).toBeNull();
  });

  it('renders a single-genre row exactly as it did before', () => {
    render(<ProductionMetaBadges rating="PG" genre="Drama" durationMinutes={108} />);
    expect(screen.getByText('Drama')).toBeTruthy();
  });

  it('does not render a badge for a genre string that is only punctuation', () => {
    // `genre &&` was the old guard, and ', ,' is truthy — it would have drawn
    // an empty badge, or a whole row for a production with no real meta.
    const { container } = render(<ProductionMetaBadges genre=", ," durationMinutes={0} />);
    expect(container.firstChild).toBeNull();
  });
});
