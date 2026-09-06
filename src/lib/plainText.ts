/**
 * Stored HTML to a single readable line, with no DOM and no dependencies.
 *
 * Split out of `richText.ts` so the Cloudflare Worker (`worker/`) can share it:
 * the Worker writes meta descriptions and JSON-LD for crawlers, and must print
 * exactly the text the page would. `richText.ts` re-exports these, so app code
 * keeps importing from there. The Deno copy for edge functions is
 * `supabase/functions/_shared/html_text.ts`; keep the three in step.
 */

/**
 * Tags that end a line of prose. Turned into newlines before the rest of the
 * markup is dropped, so `<p>One</p><p>Two</p>` becomes `One Two` rather than
 * `OneTwo` — which would otherwise corrupt every meta description and search
 * haystack in the app.
 */
const BLOCK_BOUNDARY = /<\/?(?:p|br|div|h[1-6]|li|ul|ol|blockquote|hr|tr|td)\b[^>]*>/gi;

const ANY_TAG = /<[^>]*>/g;

/**
 * `&amp;` is decoded last on purpose. Decoding it first would turn the
 * literal text `&amp;lt;` into `<`, re-creating markup out of something the
 * author escaped deliberately.
 */
const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/gi, ' '],
  [/&lt;/gi, '<'],
  [/&gt;/gi, '>'],
  [/&quot;/gi, '"'],
  [/&#0*39;|&apos;/gi, "'"],
  [/&#x27;/gi, "'"],
  [/&amp;/gi, '&'],
];

/**
 * Flatten to a single line of readable text.
 *
 * For meta descriptions, JSON-LD, search haystacks, PDFs and email — anywhere
 * markup would be printed literally or matched against by accident. Legacy
 * plain text passes through unchanged apart from whitespace collapsing.
 */
export function htmlToPlainText(value: string | null | undefined): string {
  if (!value) return '';
  let text = value.replace(BLOCK_BOUNDARY, '\n').replace(ANY_TAG, '');
  for (const [pattern, replacement] of ENTITIES) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Trim to a length limit on a word boundary, for meta tags.
 *
 * Slicing mid-word is what the old `description.slice(0, 160)` did; since every
 * meta description now goes through this file anyway, it may as well stop
 * somewhere sensible.
 */
export function toMetaDescription(
  value: string | null | undefined,
  limit = 160,
): string {
  const text = htmlToPlainText(value);
  if (text.length <= limit) return text;
  const cut = text.slice(0, limit - 1);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > limit * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
