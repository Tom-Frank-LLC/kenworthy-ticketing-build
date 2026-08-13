import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Printer } from 'lucide-react';

export interface StickerPassType {
  name: string;
  initial_balance: number;
  redemption_price: number;
}

/**
 * A printable sheet of blank film-pass QR stickers.
 *
 * What is deliberately *not* on a sticker: the balance, the expiry, the
 * patron's name. None of those exist yet — a printed sticker is worth nothing
 * until someone scans it at the counter, and printing "$60" on a worthless
 * piece of paper is how a box of stickers becomes a box of apparent vouchers.
 *
 * The code itself is printed beneath each QR in monospace, so a sticker with a
 * scuffed or badly-printed code can still be typed in by hand rather than
 * thrown away.
 *
 * ---------------------------------------------------------------------------
 * Why this renders through a portal
 * ---------------------------------------------------------------------------
 * The print rule below is `body > *:not(.print-root) { display: none }`: hide
 * everything at the top level except the sheet. That only works if the sheet
 * really is a child of <body>. Rendered in place it is not — it sits deep
 * inside #root, so the rule matched #root itself and hid the whole app, sheet
 * included, and printing produced a blank page.
 *
 * The fix is structural rather than a stronger selector. `display: none` on an
 * ancestor cannot be undone by a descendant, so no amount of overriding further
 * down would have rescued it; the element has to actually be where the CSS
 * says it is. A portal puts it there, which also means the sheet escapes any
 * ancestor `overflow` clipping and paginates normally across a long run —
 * 500 stickers is about 17 pages.
 *
 * Keeping the toolbar inside the portal is the other half: the component that
 * owns the print CSS owns the DOM placement that CSS depends on, so the two
 * cannot drift apart in separate files.
 *
 * ---------------------------------------------------------------------------
 * Why the toolbar buttons are hand-styled rather than <Button>
 * ---------------------------------------------------------------------------
 * This surface is a sheet of white paper, not app chrome, and it hard-codes its
 * own colours so it looks and prints the same whatever the app theme is doing.
 * Themed components do not belong on it: `<Button variant="outline">` resolves
 * to `bg-background` with no text colour of its own, and the app's default
 * theme is dark (`--background: 0 0% 6%`), so on this white sheet it rendered a
 * near-black button whose text inherited the sheet's black — an unreadable
 * "Done".
 *
 * That is the same mistake as the blank page above, one level down: mixing a
 * fixed colour system with a themed one and expecting them to agree. The fix is
 * the same in kind — make the element genuinely belong to the surface it is on.
 */
export function StickerSheet({
  codes,
  passType,
  batchId,
  onDone,
}: {
  codes: string[];
  passType: StickerPassType;
  batchId: string;
  onDone: () => void;
}) {
  const admissions = passType.redemption_price
    ? Math.floor(passType.initial_balance / passType.redemption_price)
    : 0;

  return createPortal(
    <div className="print-root">
      <style>{`
        /* On screen this is a full-page preview laid over the admin UI. In
           print it becomes ordinary flow content so pages break naturally —
           a fixed or absolutely positioned root prints only its first page in
           some browsers, which would silently drop most of a large batch. */
        .print-root {
          position: fixed;
          inset: 0;
          z-index: 60;
          overflow: auto;
          background: #ffffff;
          color: #000000;
          padding: 1rem;
        }
        @media print {
          body > *:not(.print-root) { display: none !important; }
          .print-root {
            position: static;
            overflow: visible;
            padding: 0;
            z-index: auto;
          }
          .sticker-sheet__meta { display: none !important; }
          @page { margin: 0.4in; }
        }
        .sticker-sheet__grid {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(1.7in, 1fr));
          gap: 0.18in;
        }
        .sticker {
          /* break-inside keeps a QR from being sliced across a page boundary,
             which produces stickers that will not scan. */
          break-inside: avoid;
          page-break-inside: avoid;
          border: 1px dashed #999;
          border-radius: 6px;
          padding: 0.10in;
          text-align: center;
          background: #fff;
          color: #000;
        }
        .sticker__name {
          font: 600 8pt/1.2 Helvetica, Arial, sans-serif;
          margin-bottom: 0.05in;
        }
        .sticker__sub {
          font: 400 6pt/1.2 Helvetica, Arial, sans-serif;
          color: #444;
          margin-bottom: 0.05in;
        }
        .sticker__code {
          font: 400 5pt/1.15 'SFMono-Regular', Consolas, monospace;
          color: #333;
          margin-top: 0.05in;
          word-break: break-all;
        }
        /* Screen-only controls, coloured for this white sheet rather than for
           the app theme. Every value is explicit for the reason in the header
           comment: nothing here may resolve against --background. */
        .sheet-btn {
          display: inline-flex;
          align-items: center;
          gap: 0.375rem;
          border-radius: 6px;
          padding: 0.5rem 0.9rem;
          font: 600 14px/1 Helvetica, Arial, sans-serif;
          cursor: pointer;
          border: 1px solid transparent;
        }
        .sheet-btn--primary {
          background: #26211d;
          color: #ffffff;
        }
        .sheet-btn--primary:hover { background: #3a332d; }
        .sheet-btn--secondary {
          background: #ffffff;
          color: #26211d;
          border-color: #c9c2ba;
        }
        .sheet-btn--secondary:hover { background: #f2efea; }
        .sheet-btn:focus-visible {
          outline: 2px solid #7c4dcc;
          outline-offset: 2px;
        }
      `}</style>

      <div className="sticker-sheet__meta mb-4 flex flex-wrap items-center gap-3">
        <button type="button" className="sheet-btn sheet-btn--primary" onClick={() => window.print()}>
          <Printer className="h-4 w-4" /> Print sheet
        </button>
        <button type="button" className="sheet-btn sheet-btn--secondary" onClick={onDone}>
          Done
        </button>
        <div className="text-sm text-neutral-600">
          <span className="font-medium text-black">
            {codes.length} × {passType.name}
          </span>
          {' — '}batch {batchId.slice(0, 8)}, each activates to $
          {passType.initial_balance.toFixed(2)} ({admissions} films) when scanned at the counter
        </div>
      </div>

      <div className="sticker-sheet__grid">
        {codes.map(code => (
          <div className="sticker" key={code}>
            <div className="sticker__name">{passType.name}</div>
            <div className="sticker__sub">The Kenworthy · {admissions} films</div>
            {/* Explicit colours: the admin UI may be in dark mode, and a QR
                inheriting a light foreground on white will not scan. */}
            <QRCodeSVG
              value={code}
              size={104}
              level="M"
              marginSize={0}
              bgColor="#ffffff"
              fgColor="#000000"
            />
            <div className="sticker__code">{code}</div>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
