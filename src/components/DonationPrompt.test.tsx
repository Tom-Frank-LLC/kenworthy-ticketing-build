import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { DonationPrompt, MAX_BUNDLED_DONATION_CENTS } from './DonationPrompt';

/**
 * What is worth testing here is the arithmetic at the boundary, not the layout.
 *
 * The prompt reports cents to a checkout that adds them to a card charge, so a
 * dollars/cents slip is a wrong amount taken from a real card. And anything it
 * reports has to be an amount the server will accept — the donations table
 * refuses under $1, so a 40-cent "gift" must come back as no gift rather than
 * as a charge that cannot be recorded.
 */
describe('DonationPrompt', () => {
  it('defaults to no gift and reports presets in cents', () => {
    const onChange = vi.fn();
    render(<DonationPrompt valueCents={0} onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'No thanks' })).toHaveAttribute('aria-pressed', 'true');

    fireEvent.click(screen.getByRole('button', { name: '$5' }));
    expect(onChange).toHaveBeenCalledWith(500);

    fireEvent.click(screen.getByRole('button', { name: '$1' }));
    expect(onChange).toHaveBeenCalledWith(100);

    fireEvent.click(screen.getByRole('button', { name: '$10' }));
    expect(onChange).toHaveBeenCalledWith(1000);
  });

  it('declining is a real choice, not just an empty field', () => {
    const onChange = vi.fn();
    render(<DonationPrompt valueCents={500} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'No thanks' }));
    expect(onChange).toHaveBeenCalledWith(0);
  });

  it('converts a custom dollar amount to cents', () => {
    const onChange = vi.fn();
    render(<DonationPrompt valueCents={0} onChange={onChange} />);
    const custom = screen.getByLabelText('Custom donation amount');

    fireEvent.change(custom, { target: { value: '7' } });
    expect(onChange).toHaveBeenLastCalledWith(700);

    fireEvent.change(custom, { target: { value: '12.34' } });
    expect(onChange).toHaveBeenLastCalledWith(1234);
  });

  it('treats an amount the server would refuse as no gift', () => {
    const onChange = vi.fn();
    render(<DonationPrompt valueCents={0} onChange={onChange} />);
    const custom = screen.getByLabelText('Custom donation amount');

    // Below the donations table's own $1 floor.
    fireEvent.change(custom, { target: { value: '0.40' } });
    expect(onChange).toHaveBeenLastCalledWith(0);

    fireEvent.change(custom, { target: { value: '-5' } });
    expect(onChange).toHaveBeenLastCalledWith(0);

    fireEvent.change(custom, { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith(0);
  });

  it('clamps to the ceiling the server enforces', () => {
    const onChange = vi.fn();
    render(<DonationPrompt valueCents={0} onChange={onChange} />);
    fireEvent.change(screen.getByLabelText('Custom donation amount'), {
      target: { value: '99999' },
    });
    expect(onChange).toHaveBeenLastCalledWith(MAX_BUNDLED_DONATION_CENTS);
  });

  it('picking a preset clears a previously typed custom amount', () => {
    const onChange = vi.fn();
    render(<DonationPrompt valueCents={0} onChange={onChange} />);
    const custom = screen.getByLabelText('Custom donation amount') as HTMLInputElement;

    fireEvent.change(custom, { target: { value: '25' } });
    expect(custom.value).toBe('25');

    fireEvent.click(screen.getByRole('button', { name: '$5' }));
    expect(custom.value).toBe('');
    expect(onChange).toHaveBeenLastCalledWith(500);
  });
});
