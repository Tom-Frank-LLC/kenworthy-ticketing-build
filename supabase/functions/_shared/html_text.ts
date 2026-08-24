/**
 * Flatten stored description HTML to plain text, for edge functions.
 *
 * The description columns hold HTML now — written by the admin rich-text
 * editor (`src/components/ui/rich-text-editor.tsx`). Anything server-side that
 * puts a description into an email, a PDF, a calendar entry or a payload for
 * another system has to flatten it first, or it prints the tags.
 *
 * **This is a deliberate copy of `htmlToPlainText` in `src/lib/richText.ts`.**
 * Edge functions are Deno and cannot import from `src/`; `npm run build` and
 * vitest never compile this directory, so the two cannot be checked against
 * each other by the type system. `html_text_test.ts` carries the same cases as
 * the front-end test to keep them honest. If you change one, change both.
 *
 * Rows written before the editor shipped are plain text and pass through with
 * only their whitespace collapsed.
 */

/** Tags that end a line of prose, so blocks do not run together into one word. */
const BLOCK_BOUNDARY = /<\/?(?:p|br|div|h[1-6]|li|ul|ol|blockquote|hr|tr|td)\b[^>]*>/gi;

const ANY_TAG = /<[^>]*>/g;

/**
 * `&amp;` decodes last. Decoding it first would turn the literal text
 * `&amp;lt;` into `<`, re-creating markup the author escaped on purpose.
 */
const ENTITIES: ReadonlyArray<readonly [RegExp, string]> = [
  [/&nbsp;/gi, " "],
  [/&lt;/gi, "<"],
  [/&gt;/gi, ">"],
  [/&quot;/gi, '"'],
  [/&#0*39;|&apos;/gi, "'"],
  [/&#x27;/gi, "'"],
  [/&amp;/gi, "&"],
];

export function htmlToPlainText(value: string | null | undefined): string {
  if (!value) return "";
  let text = value.replace(BLOCK_BOUNDARY, "\n").replace(ANY_TAG, "");
  for (const [pattern, replacement] of ENTITIES) {
    text = text.replace(pattern, replacement);
  }
  return text.replace(/\s+/g, " ").trim();
}
