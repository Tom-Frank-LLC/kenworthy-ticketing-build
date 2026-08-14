import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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
const stickers = codes.map((code, i) => ({ code, pass_number: 1000 + i }));

describe('StickerSheet', () => {
  it('renders as a direct child of <body>, which is what the print CSS requires', () => {
    render(
      <StickerSheet stickers={stickers} passType={passType} batchId="batch-1234-5678" onDone={() => {}} />,
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
      <StickerSheet stickers={stickers} passType={passType} batchId="batch-1234-5678" onDone={() => {}} />,
    );

    expect(document.querySelectorAll('.sticker')).toHaveLength(3);
    // The code is printed under each QR so a badly-printed sticker can still be
    // typed in by hand rather than binned.
    for (const code of codes) {
      expect(screen.getByText(code)).toBeInTheDocument();
    }
    expect(document.querySelectorAll('.sticker svg')).toHaveLength(3);
  });

  it('prints the pass number, which is the half a person can actually use', () => {
    render(
      <StickerSheet stickers={stickers} passType={passType} batchId="b" onDone={() => {}} />,
    );
    // Without this on the paper, "search by pass number" is a search for a
    // number nobody can read off the pass.
    for (const s of stickers) {
      expect(screen.getByText(`No. ${s.pass_number}`)).toBeInTheDocument();
    }
  });

  it('pairs each number with its own code, not with whatever came back first', () => {
    render(
      <StickerSheet stickers={stickers} passType={passType} batchId="b" onDone={() => {}} />,
    );
    // The failure this rules out is a sheet where every sticker is numbered but
    // the numbers belong to the wrong codes — invisible on the page and only
    // discovered when a lookup returns somebody else's pass.
    const drawn = Array.from(document.querySelectorAll('.sticker'));
    expect(drawn).toHaveLength(stickers.length);
    drawn.forEach((el, i) => {
      expect(el.textContent).toContain(stickers[i].code);
      expect(el.textContent).toContain(`No. ${stickers[i].pass_number}`);
    });
  });

  it('omits the number rather than faking one when a batch predates them', () => {
    render(
      <StickerSheet
        stickers={[{ code: 'PASS:old', pass_number: null }]}
        passType={passType}
        batchId="b"
        onDone={() => {}}
      />,
    );
    // "No. —" on a sticker invites somebody to search for a pass number that
    // does not exist.
    expect(document.querySelector('.sticker')!.textContent).not.toMatch(/No\./);
    expect(document.querySelector('.sticker__number')).toBeNull();
  });

  it('never prints a balance or an expiry as data on a sticker', () => {
    render(
      <StickerSheet
        stickers={stickers}
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
        stickers={[{ code: 'PASS:x', pass_number: 1042 }]}
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
      <StickerSheet stickers={[{ code: 'PASS:x', pass_number: 1042 }]} passType={passType} batchId="b" onDone={() => {}} />,
    );
    const svg = document.querySelector('.sticker svg')!;
    expect(svg.innerHTML).toContain('#000000');
  });
});

describe('StickerSheet — the sheet is not app chrome', () => {
  /**
   * Theme-coupled Tailwind utilities. Each resolves against a CSS custom
   * property, and the app's default theme is dark (`--background: 0 0% 6%`).
   * On this hard-coded white sheet that is how "Done" became black text on a
   * near-black button: `variant="outline"` supplies `bg-background` and no text
   * colour of its own, so the text inherited the sheet's black.
   */
  const THEMED = [
    'bg-background', 'bg-primary', 'bg-secondary', 'bg-accent', 'bg-card',
    'bg-muted', 'bg-popover', 'bg-destructive',
    'text-foreground', 'text-primary', 'text-secondary', 'text-accent',
    'text-muted', 'text-card', 'text-popover', 'text-destructive',
    'border-input', 'border-border',
  ];

  it('uses no theme-dependent colour anywhere on the sheet', () => {
    render(
      <StickerSheet stickers={stickers} passType={passType} batchId="b" onDone={() => {}} />,
    );

    const root = document.querySelector('.print-root')!;
    const offenders: string[] = [];
    for (const el of Array.from(root.querySelectorAll('*'))) {
      const cls = el.getAttribute('class');
      if (!cls) continue;
      for (const token of cls.split(/\s+/)) {
        // Match the utility itself and its variants (hover:bg-accent), but not
        // fixed-palette classes that merely start the same (text-primary vs
        // text-neutral-600 — only the former reads a theme variable).
        const bare = token.replace(/^[a-z-]+:/, '');
        if (THEMED.some(t => bare === t || bare.startsWith(`${t}/`))) {
          offenders.push(`<${el.tagName.toLowerCase()}> ${token}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('gives both controls an explicit colour of their own', () => {
    render(
      <StickerSheet stickers={stickers} passType={passType} batchId="b" onDone={() => {}} />,
    );
    for (const name of [/print sheet/i, /done/i]) {
      const btn = screen.getByRole('button', { name });
      // Hand-styled against the white sheet rather than inheriting from it.
      expect(btn.className).toMatch(/\bsheet-btn\b/);
      expect(btn.className).toMatch(/sheet-btn--(primary|secondary)/);
    }
  });

  it('Done closes the sheet', () => {
    const onDone = vi.fn();
    render(<StickerSheet stickers={stickers} passType={passType} batchId="b" onDone={onDone} />);
    fireEvent.click(screen.getByRole('button', { name: /done/i }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });
});
