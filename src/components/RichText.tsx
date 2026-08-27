import { useMemo } from 'react';
import { cn } from '@/lib/utils';
import { isRichTextEmpty, toRichHtml } from '@/lib/richText';

interface RichTextProps {
  /**
   * A stored description. Either editor HTML or the plain text that predates
   * the editor — `toRichHtml` sorts out which, so callers never have to.
   */
  html: string | null | undefined;
  /** Typography for this slot. The component sets structure, not size or colour. */
  className?: string;
}

/**
 * Renders a description as formatted copy.
 *
 * The sanitising happens here, on every render, rather than once on save. Save
 * time is the wrong place to make that guarantee: rows written before the
 * editor existed never passed through it, and `/host` lets an external event
 * organiser write to the same column the public showing page reads. Render is
 * the only choke point every value goes through.
 *
 * **A clamped teaser can use this too** — pass `rich-text-teaser` alongside
 * the clamp. This comment used to say the opposite, on the belief that block
 * elements defeat `line-clamp`. Measured, they do not: `-webkit-line-clamp: 2`
 * over nested `<p>` and `<ul>` clamps to the same two lines a plain string
 * gets. It is the children's *block margins* that break it, because the box
 * counts margin boxes, and the teaser variant zeroes them.
 *
 * Two limits are real and remain:
 *
 * - **Not inside a `<button>`.** An `<a>` inside a `<button>` is invalid HTML
 *   and browsers recover from it unpredictably. A clickable row wanting
 *   formatted copy needs the control lifted out to an overlay, as
 *   `EditorialCalendar` does.
 * - **Not for a quoted excerpt.** Where the markup supplies its own quotation
 *   marks around the value (`TrailerFeed`), a block element puts the opening
 *   quote on a line of its own. Flatten with `htmlToPlainText()` there.
 *
 * See `docs/briefs/FINDINGS-richtext-description-surface.md`.
 */
export function RichText({ html, className }: RichTextProps) {
  const clean = useMemo(() => (isRichTextEmpty(html) ? '' : toRichHtml(html)), [html]);
  // The emptiness test is on the text, not the string: an editor the author
  // cleared out stores `<p></p>`, which is truthy and would otherwise render an
  // empty box with margins. Callers rely on this — the render sites dropped
  // their `{description && …}` guards when they moved to this component.
  if (!clean) return null;
  return (
    <div
      className={cn('rich-text', className)}
      // Safe by construction: `clean` is the output of the DOMPurify allowlist
      // in src/lib/richText.ts, which is the only way markup reaches this line.
      dangerouslySetInnerHTML={{ __html: clean }}
    />
  );
}

export default RichText;
