import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { PromoCodeField } from './PromoCodeField';

const noop = () => {};

describe('PromoCodeField', () => {
  it('starts as a link, so a buyer without a code is not shown an empty box', () => {
    render(<PromoCodeField applied={null} onApply={noop} onRemove={noop} promo={null} error={null} />);
    expect(screen.queryByLabelText('Promo code')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Have a promo code?' }));
    expect(screen.getByLabelText('Promo code')).toBeInTheDocument();
  });

  it('hands the trimmed code to the parent', () => {
    const onApply = vi.fn();
    render(<PromoCodeField applied={null} onApply={onApply} onRemove={noop} promo={null} error={null} startOpen />);
    fireEvent.change(screen.getByLabelText('Promo code'), { target: { value: '  fall25 ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(onApply).toHaveBeenCalledWith('fall25');
  });

  it("shows the database's refusal as an alert, and keeps the box to try again", () => {
    render(<PromoCodeField applied="GONE" onApply={noop} onRemove={noop} promo={null} error="That promo code has expired." />);
    expect(screen.getByRole('alert')).toHaveTextContent('That promo code has expired.');
    expect(screen.getByLabelText('Promo code')).toHaveAttribute('aria-invalid', 'true');
  });

  it('an accepted code can be removed; a valid one that does nothing says why', () => {
    const onRemove = vi.fn();
    const { rerender } = render(
      <PromoCodeField applied="FALL25" onApply={noop} onRemove={onRemove} promo={{ code: 'FALL25', status: 'applied', minQuantity: 1 }} error={null} note="Limit 2 tickets per person." />,
    );
    expect(screen.getByText('FALL25')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Limit 2 tickets per person.');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onRemove).toHaveBeenCalled();
    rerender(<PromoCodeField applied="HALF4" onApply={noop} onRemove={noop} promo={{ code: 'HALF4', status: 'below_minimum', minQuantity: 4 }} error={null} />);
    expect(screen.getByRole('status')).toHaveTextContent('HALF4 needs at least 4 tickets in the order.');
  });
});
