import { QRCodeSVG } from 'qrcode.react';

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
 * Print styling lives inline in a <style> block rather than in the Tailwind
 * layer: this markup only ever exists inside a print window, and a print
 * stylesheet that ships in the app bundle is a stylesheet nobody remembers is
 * there.
 */
export function StickerSheet({
  codes,
  passType,
  batchId,
}: {
  codes: string[];
  passType: StickerPassType;
  batchId: string;
}) {
  const admissions = passType.redemption_price
    ? Math.floor(passType.initial_balance / passType.redemption_price)
    : 0;

  return (
    <div className="sticker-sheet">
      <style>{`
        @media print {
          /* Only the sheet prints — no app chrome, no navigation. */
          body > *:not(.print-root) { display: none !important; }
          .print-root, .print-root * { visibility: visible; }
          .print-root { position: absolute; inset: 0; margin: 0; padding: 0; }
          .sticker-sheet__meta { display: none; }
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

      <div className="sticker-sheet__meta mb-4 text-sm text-muted-foreground">
        <p className="font-medium text-foreground">
          {codes.length} × {passType.name}
        </p>
        <p>
          Batch {batchId.slice(0, 8)} · each activates to ${passType.initial_balance.toFixed(2)} (
          {admissions} films) when scanned at the counter
        </p>
      </div>

      <div className="sticker-sheet__grid">
        {codes.map(code => (
          <div className="sticker" key={code}>
            <div className="sticker__name">{passType.name}</div>
            <div className="sticker__sub">The Kenworthy · {admissions} films</div>
            <QRCodeSVG value={code} size={104} level="M" marginSize={0} />
            <div className="sticker__code">{code}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
