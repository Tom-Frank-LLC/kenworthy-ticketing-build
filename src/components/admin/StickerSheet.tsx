import { createPortal } from 'react-dom';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
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
      `}</style>

      <div className="sticker-sheet__meta mb-4 flex flex-wrap items-center gap-3">
        <Button onClick={() => window.print()}>
          <Printer className="h-4 w-4 mr-1" /> Print sheet
        </Button>
        <Button variant="outline" onClick={onDone}>Done</Button>
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
