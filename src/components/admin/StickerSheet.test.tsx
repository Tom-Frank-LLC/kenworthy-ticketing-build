import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StickerSheet } from './StickerSheet';

/**
 * These tests exist because of a specific failure: clicking Print produced a
 * blank page.
 *
 * The print rule is `body > *:not(.print-root) { display: none }`. Rendered in
 * place the sheet sat deep inside #root, so that selector matched #root and hid
 * the whole app — the sheet with it. `display: none` on an ancestor cannot be
 * overridden by a descendant, so the bug was structural: the element was not
 * where the CSS said it was.
 *
 * The first test below is therefore not a rendering detail. It is the exact
 * invariant the print stylesheet depends on, and nothing else in the suite
 * would catch it regressing — jsdom does not paginate, so only the DOM
 * relationship is checkable here.
 */

const passType = { name: '$60 Film Pass', initial_balance: 60, redemption_price: 6 };
const codes = ['PASS:aaa-111', 'PASS:bbb-222', 'PASS:ccc-333'];

describe('StickerSheet', () => {
  it('renders as a direct child of <body>, which is what the print CSS requires', () => {
    render(
      <StickerSheet codes={codes} passType={passType} batchId="batch-1234-5678" onDone={() => {}} />,
    );

    const roots = Array.from(document.body.children).filter(el =>
      el.classList.contains('print-root'),
    );
    expect(roots).toHaveLength(1);

    // Restating the failure directly: `body > *:not(.print-root)` must not be
    // able to match an ancestor of the sheet.
    const sheet = document.querySelector('.print-root')!;
    for (const child of Array.from(document.body.children)) {
      if (child.classList.contains('print-root')) continue;
      expect(child.contains(sheet)).toBe(false);
    }
  });

  it('prints one sticker per code, each carrying its code as text', () => {
    render(
      <StickerSheet codes={codes} passType={passType} batchId="batch-1234-5678" onDone={() => {}} />,
    );

    expect(document.querySelectorAll('.sticker')).toHaveLength(3);
    // The code is printed under each QR so a badly-printed sticker can still be
    // typed in by hand rather than binned.
    for (const code of codes) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
    expect(document.querySelectorAll('.sticker svg')).toHaveLength(3);
  });

  it('never prints a balance or an expiry as data on a sticker', () => {
    render(
      <StickerSheet
        codes={codes}
        // A name with no money in it, so the assertion is about what the
        // component renders rather than about what staff called the product.
        passType={{ name: 'Standard Film Pass', initial_balance: 60, redemption_price: 6 }}
        batchId="batch-1234-5678"
        onDone={() => {}}
      />,
    );

    // A blank sticker is worth nothing until someone scans it. Stamping a live
    // balance or expiry on one turns a box of stationery into a box of apparent
    // vouchers — and both values are still NULL at this point anyway.
    for (const sticker of Array.from(document.querySelectorAll('.sticker'))) {
      expect(sticker.textContent).not.toMatch(/\$/);
      expect(sticker.textContent).not.toMatch(/\b60(\.00)?\b/);
      expect(sticker.textContent).not.toMatch(/expir/i);
    }
  });

  it('states what a sticker will be worth, derived rather than hardcoded', () => {
    render(
      <StickerSheet
        codes={['PASS:x']}
        passType={{ name: 'Half Pass', initial_balance: 30, redemption_price: 6 }}
        batchId="b"
        onDone={() => {}}
      />,
    );
    // Scoped to the sticker: the toolbar says the same thing, and the sticker
    // is the half that leaves the building.
    expect(document.querySelector('.sticker')!.textContent).toContain('5 films');
  });

  it('renders QR codes in explicit black on white, not inherited theme colours', () => {
    // The admin UI has a dark theme. A QR that inherited a light foreground
    // would render on screen and print as an unscannable ghost.
    render(
      <StickerSheet codes={['PASS:x']} passType={passType} batchId="b" onDone={() => {}} />,
    );
    const svg = document.querySelector('.sticker svg')!;
    expect(svg.innerHTML).toContain('#000000');
  });
});
