import { useEffect } from 'react';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

import { CollapsibleSection } from '@/components/admin/CollapsibleSection';

/** Stands in for a section that fetches on mount, so "lazy" can be asserted. */
function HeavyContents({ onMount }: { onMount: () => void }) {
  useEffect(() => {
    onMount();
  }, [onMount]);
  return <div>heavy contents</div>;
}

const triggerFor = (name: RegExp | string) => screen.getByRole('button', { name });

describe('CollapsibleSection', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('renders a real button that reports its state', () => {
    render(
      <CollapsibleSection id="t.a" title="Orders">
        <p>body</p>
      </CollapsibleSection>,
    );
    const trigger = triggerFor(/orders/i);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
  });

  it('is reachable and toggleable from the keyboard', () => {
    render(
      <CollapsibleSection id="t.b" title="Orders">
        <p>body</p>
      </CollapsibleSection>,
    );
    const trigger = triggerFor(/orders/i);
    trigger.focus();
    expect(trigger).toHaveFocus();
    // A <button> is activated by Enter/Space natively; asserting it is a button
    // is what guarantees that, so assert the element rather than the key.
    expect(trigger.tagName).toBe('BUTTON');
  });

  it('shows the count on a closed section', () => {
    render(
      <CollapsibleSection id="t.c" title="Orders" count={42}>
        <p>body</p>
      </CollapsibleSection>,
    );
    expect(screen.getByText('42')).toBeInTheDocument();
  });

  it('does not mount contents until first expanded', () => {
    const onMount = vi.fn();
    render(
      <CollapsibleSection id="t.d" title="Heavy">
        <HeavyContents onMount={onMount} />
      </CollapsibleSection>,
    );
    expect(onMount).not.toHaveBeenCalled();
    expect(screen.queryByText('heavy contents')).not.toBeInTheDocument();

    fireEvent.click(triggerFor(/heavy/i));
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  // The reason for forceMount: a section that re-fetches on every toggle would
  // be worse to work with than one that never collapsed.
  it('keeps contents mounted across a collapse, so the query runs once', () => {
    const onMount = vi.fn();
    render(
      <CollapsibleSection id="t.e" title="Heavy" defaultOpen>
        <HeavyContents onMount={onMount} />
      </CollapsibleSection>,
    );
    expect(onMount).toHaveBeenCalledTimes(1);

    const trigger = triggerFor(/heavy/i);
    fireEvent.click(trigger);
    fireEvent.click(trigger);
    expect(onMount).toHaveBeenCalledTimes(1);
  });

  it('remembers a section closed against a default of open', () => {
    const { unmount } = render(
      <CollapsibleSection id="t.f" title="Orders" defaultOpen>
        <p>body</p>
      </CollapsibleSection>,
    );
    fireEvent.click(triggerFor(/orders/i));
    unmount();

    render(
      <CollapsibleSection id="t.f" title="Orders" defaultOpen>
        <p>body</p>
      </CollapsibleSection>,
    );
    expect(triggerFor(/orders/i)).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens on mount when a stored preference says so', () => {
    render(
      <CollapsibleSection id="t.h" title="Orders">
        <p>body</p>
      </CollapsibleSection>,
    );
    fireEvent.click(triggerFor(/orders/i));

    render(
      <CollapsibleSection id="t.h" title="Orders">
        <p>stored body</p>
      </CollapsibleSection>,
    );
    expect(screen.getAllByRole('button', { name: /orders/i })[1]).toHaveAttribute('aria-expanded', 'true');
  });

  it('renders header actions outside the trigger, and they do not toggle it', () => {
    const onAdd = vi.fn();
    render(
      <CollapsibleSection id="t.g" title="Orders" actions={<button onClick={onAdd}>Add</button>}>
        <p>body</p>
      </CollapsibleSection>,
    );
    const trigger = triggerFor(/orders/i);
    const add = screen.getByRole('button', { name: 'Add' });
    // A button nested inside a button is invalid, and browsers make the inner
    // one unreachable from the keyboard.
    expect(trigger).not.toContainElement(add);

    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });

  // An "Add" button that flips on an inline form must not do so behind a
  // closed section: from the operator's side that is a dead button.
  it('lets a header action expand its own section', () => {
    render(
      <CollapsibleSection
        id="t.i"
        title="Pass types"
        actions={({ open }) => <button onClick={open}>Add</button>}
      >
        <p>form</p>
      </CollapsibleSection>,
    );
    const trigger = triggerFor(/pass types/i);
    expect(trigger).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('form')).toBeInTheDocument();
  });

  it('persists an expand driven by a header action', () => {
    const { unmount } = render(
      <CollapsibleSection id="t.j" title="Pass types" actions={({ open }) => <button onClick={open}>Add</button>}>
        <p>form</p>
      </CollapsibleSection>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    unmount();

    render(
      <CollapsibleSection id="t.j" title="Pass types">
        <p>form</p>
      </CollapsibleSection>,
    );
    expect(triggerFor(/pass types/i)).toHaveAttribute('aria-expanded', 'true');
  });

  it('points the trigger at the content it controls', () => {
    render(
      <CollapsibleSection id="passes.orders" title="Orders" defaultOpen>
        <p>body</p>
      </CollapsibleSection>,
    );
    const trigger = triggerFor(/orders/i);
    const controls = trigger.getAttribute('aria-controls');
    expect(controls).toBeTruthy();
    expect(document.getElementById(controls!)).toBeInTheDocument();
  });

  // Lazy content means the target does not exist yet; advertising it anyway
  // offers a screen reader a jump to nothing.
  it('omits aria-controls until the content is mounted', () => {
    render(
      <CollapsibleSection id="t.k" title="Orders">
        <p>body</p>
      </CollapsibleSection>,
    );
    const trigger = triggerFor(/orders/i);
    expect(trigger).not.toHaveAttribute('aria-controls');

    fireEvent.click(trigger);
    const controls = trigger.getAttribute('aria-controls');
    expect(document.getElementById(controls!)).toBeInTheDocument();
  });
});
