import { describe, it, expect, vi, beforeAll } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SearchableSelect } from './searchable-select';

/**
 * Guards the movie picker on the showing form. Three things here are easy to
 * break and invisible to TypeScript:
 *
 *  - cmdk scores items against their `value`, which is a uuid. With the stock
 *    filter, a search genuinely matches hex characters scattered through the
 *    ids (verified by removing the custom filter — "cccc" then matches), so
 *    the "filter by title" promise fails quietly.
 *  - The picker lives inside a <form>. Choosing a title must not submit it.
 *  - On edit, the value arrives before the options finish loading; the trigger
 *    has to catch up and show the title once they do.
 */

beforeAll(() => {
  // jsdom implements neither, and both are reached by Radix's popper and
  // cmdk's "keep the active item in view".
  Element.prototype.scrollIntoView = () => {};
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
});

const OPTIONS = [
  { value: 'aaaaaaaa-1111-4000-8000-000000000001', label: 'Dune', hint: '1984' },
  { value: 'bbbbbbbb-2222-4000-8000-000000000002', label: 'Dune', hint: '2021' },
  { value: 'cccccccc-3333-4000-8000-000000000003', label: 'Star Wars: The Empire Strikes Back', hint: '1980' },
  { value: 'dddddddd-4444-4000-8000-000000000004', label: 'The Goonies', hint: '1985 · inactive' },
];

function open(props: Partial<React.ComponentProps<typeof SearchableSelect>> = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn(e => e.preventDefault());
  const view = render(
    <form onSubmit={onSubmit}>
      <SearchableSelect options={OPTIONS} value="" onChange={onChange} placeholder="Select a movie" {...props} />
    </form>,
  );
  return { onChange, onSubmit, ...view };
}

function search(text: string) {
  const input = screen.getByPlaceholderText('Type to search…');
  fireEvent.change(input, { target: { value: text } });
  return input;
}

describe('SearchableSelect', () => {
  it('shows the placeholder until something is selected', () => {
    open();
    expect(screen.getByRole('combobox')).toHaveTextContent('Select a movie');
  });

  it('shows the preselected title on the trigger, including once options arrive late', () => {
    const { rerender } = render(
      <SearchableSelect options={[]} value={OPTIONS[2].value} onChange={vi.fn()} placeholder="Select a movie" />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('Select a movie');

    rerender(
      <SearchableSelect options={OPTIONS} value={OPTIONS[2].value} onChange={vi.fn()} placeholder="Select a movie" />,
    );
    expect(screen.getByRole('combobox')).toHaveTextContent('Star Wars: The Empire Strikes Back');
  });

  it('filters by title as you type, matching words out of order', async () => {
    open();
    fireEvent.click(screen.getByRole('combobox'));
    search('empire strikes');

    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
    expect(screen.getByRole('option')).toHaveTextContent('Star Wars: The Empire Strikes Back');
  });

  it('does not match characters that only appear in the underlying id', async () => {
    open();
    fireEvent.click(screen.getByRole('combobox'));
    search('cccc');

    await waitFor(() => {
      expect(screen.queryAllByRole('option')).toHaveLength(0);
    });
    expect(screen.getByText('No match.')).toBeInTheDocument();
  });

  it('lists inactive titles, labelled, rather than hiding them', () => {
    open();
    fireEvent.click(screen.getByRole('combobox'));

    const goonies = screen.getAllByRole('option').find(o => o.textContent?.includes('The Goonies'));
    expect(goonies).toHaveTextContent('inactive');
  });

  it('selects the highlighted item on Enter without submitting the form', async () => {
    const { onChange, onSubmit } = open();
    fireEvent.click(screen.getByRole('combobox'));
    const input = search('dune 2021');

    await waitFor(() => {
      expect(screen.getAllByRole('option')).toHaveLength(1);
    });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onChange).toHaveBeenCalledWith(OPTIONS[1].value);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('selects on click and closes, without submitting the form', async () => {
    const { onChange, onSubmit } = open();
    fireEvent.click(screen.getByRole('combobox'));
    search('goonies');

    await waitFor(() => expect(screen.getAllByRole('option')).toHaveLength(1));
    fireEvent.click(screen.getByRole('option'));

    expect(onChange).toHaveBeenCalledWith(OPTIONS[3].value);
    expect(onSubmit).not.toHaveBeenCalled();
    await waitFor(() => expect(screen.queryByPlaceholderText('Type to search…')).not.toBeInTheDocument());
  });

  it('marks the current selection with a tick, even when titles collide', () => {
    open({ value: OPTIONS[1].value });
    fireEvent.click(screen.getByRole('combobox'));

    const [first, second] = screen.getAllByRole('option').filter(o => o.textContent?.startsWith('Dune'));
    expect(first.querySelector('.opacity-100')).toBeNull();
    expect(second.querySelector('.opacity-100')).not.toBeNull();
  });
});
