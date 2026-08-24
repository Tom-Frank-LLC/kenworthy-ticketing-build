import DOMPurify from 'dompurify';

/**
 * The description fields hold HTML now, written by the admin rich-text editor.
 *
 * Two facts drive everything in this file:
 *
 * 1. **The rows are mixed.** Every description written before the editor
 *    shipped is plain text with newlines, and stays that way until somebody
 *    edits it. There is no migration — `toRichHtml` normalises at read time
 *    instead, so an untouched row renders exactly as it did under the old
 *    `whitespace-pre-line` markup.
 * 2. **The writers are not all staff.** `/host` lets an external event
 *    organiser edit the same `description` column the public showing page
 *    renders (`HostDashboard.tsx`). Sanitising on render is therefore
 *    load-bearing, not decoration. Nothing here trusts stored HTML.
 *
 * See `docs/briefs/FINDINGS-richtext-description-surface.md` for the full consumer map.
 */

/**
 * Everything the editor can produce, and nothing else. Deliberately small: no
 * images, no tables, no styling attributes, no `<span>`. Widening this list
 * means widening what a host account can put on a public page, so treat it as a
 * security boundary rather than a formatting preference.
 */
const ALLOWED_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i',
  'ul', 'ol', 'li', 'a', 'h3', 'blockquote', 'hr',
];

const ALLOWED_ATTR = ['href', 'target', 'rel'];

/**
 * Absolute http(s), mail, phone, root-relative and same-page only.
 *
 * This is stricter than DOMPurify's default, which permits a longer scheme
 * list. `javascript:` and `data:` are what matter — both are excluded by not
 * being named here.
 */
const ALLOWED_URI = /^(?:https?:|mailto:|tel:|\/|#)/i;

/** Does this value already carry markup we recognise? */
const HAS_MARKUP = new RegExp(`</?(?:${ALLOWED_TAGS.join('|')})\\b[^>]*>`, 'i');

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

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Registered once, at module load. DOMPurify hooks are global to the module
 * instance, and this file is the only place the app sanitises, so a single
 * registration is safe — but it is the reason all sanitising must go through
 * `sanitizeRichText` rather than calling DOMPurify directly elsewhere.
 */
let hooked = false;
function ensureHook() {
  if (hooked) return;
  hooked = true;
  DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (!(node instanceof Element) || node.tagName !== 'A') return;
    const href = node.getAttribute('href') ?? '';
    // A link the allowlist rejected is left in place as plain text rather than
    // silently deleted along with the words the author wrote inside it.
    if (!ALLOWED_URI.test(href)) {
      node.removeAttribute('href');
      node.removeAttribute('target');
      node.removeAttribute('rel');
      return;
    }
    // Always set, never trusted from the stored markup: `rel` is what stops the
    // opened page from reaching back through `window.opener`.
    node.setAttribute('rel', 'noopener noreferrer');
    if (/^https?:/i.test(href)) node.setAttribute('target', '_blank');
    else node.removeAttribute('target');
  });
}

/** True when the value looks like editor output rather than legacy plain text. */
export function looksLikeHtml(value: string | null | undefined): boolean {
  return !!value && HAS_MARKUP.test(value);
}

/**
 * Legacy plain text to the markup the old renderers implied: a blank line
 * starts a paragraph, a single newline is a line break.
 *
 * This is the exact behaviour of `whitespace-pre-line` plus the blank-line
 * split that `backstageParagraphs()` used to do, which is why untouched rows
 * look unchanged after the editor ships.
 */
export function plainTextToHtml(text: string | null | undefined): string {
  const trimmed = (text ?? '').trim();
  if (!trimmed) return '';
  return trimmed
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .filter(Boolean)
    .map((block) => `<p>${escapeHtml(block).replace(/\n/g, '<br>')}</p>`)
    .join('');
}

/** Run stored markup through the allowlist. Never skip this before rendering. */
export function sanitizeRichText(html: string | null | undefined): string {
  if (!html) return '';
  ensureHook();
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
    // Keeps the text of a stripped element instead of deleting it with the tag.
    KEEP_CONTENT: true,
  });
}

/**
 * The one entry point for turning a stored description into safe display HTML,
 * whichever era it was written in. Used by `<RichText>` and by the editor when
 * it loads a value.
 */
export function toRichHtml(value: string | null | undefined): string {
  if (!value || !value.trim()) return '';
  return looksLikeHtml(value)
    ? sanitizeRichText(value)
    : plainTextToHtml(value);
}

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
 * Whether a value carries any actual copy.
 *
 * TipTap represents an emptied editor as `<p></p>`, which is truthy and would
 * otherwise be stored — leaving every render site to decide for itself whether
 * an empty paragraph counts as a description. The forms use this to store
 * `null` instead.
 */
export function isRichTextEmpty(value: string | null | undefined): boolean {
  return htmlToPlainText(value).length === 0 && !/<hr\b/i.test(value ?? '');
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
