import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { RedeemedQr, RedemptionBadge } from './RedeemedQr';

describe('RedeemedQr', () => {
  it('shows a clean, scannable code for an unused ticket', () => {
    const { container } = render(<RedeemedQr value="QR-LIVE" scannedAt={null} />);

    expect(screen.queryByText(/Used/i)).not.toBeInTheDocument();

    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    // Nothing dims a live ticket — it has to scan at the door.
    expect(svg!.getAttribute('class') ?? '').not.toMatch(/opacity-15/);
  });

  it('stamps a redeemed ticket and kills the code', () => {
    const { container } = render(
      <RedeemedQr value="QR-USED" scannedAt="2026-08-12T02:42:00Z" />
    );

    expect(screen.getByText('Used')).toBeInTheDocument();
    expect(screen.getByText(/Scanned/i)).toBeInTheDocument();

    // A used ticket must not still look scannable — otherwise a screenshot of
    // it can be passed on, and the holder cannot tell it was already redeemed.
    const svg = container.querySelector('svg[class]');
    expect(svg!.getAttribute('class')).toMatch(/opacity-15/);
  });

  it('still renders the code underneath so the box office can read it', () => {
    const { container } = render(
      <RedeemedQr value="QR-USED" scannedAt="2026-08-12T02:42:00Z" />
    );
    expect(container.querySelector('svg')).toBeTruthy();
  });
});

describe('RedemptionBadge', () => {
  it('says nothing for an unused ticket', () => {
    const { container } = render(<RedemptionBadge scannedAt={null} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('reports when a ticket was used', () => {
    render(<RedemptionBadge scannedAt="2026-08-12T02:42:00Z" />);
    expect(screen.getByText(/Used ·/i)).toBeInTheDocument();
  });
});
