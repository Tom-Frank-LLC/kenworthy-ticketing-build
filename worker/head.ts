/**
 * The `<head>` a crawler reads: built as a string here, stitched into the
 * asset layer's `index.html` by HTMLRewriter in `worker/index.ts`.
 *
 * Pure so it can be tested without a Workers runtime. Mirrors what
 * `src/components/SEO.tsx` renders for a human's tab — same title/description
 * limits, same tag set — so a page's shared card and its search snippet
 * cannot disagree with what the page says about itself once hydrated.
 */

export interface PageHead {
  title: string;
  description: string;
  /** Absolute canonical URL of this page. */
  url: string;
  /** Absolute image URL. */
  image: string;
  ogType: 'website' | 'event' | 'product';
  noindex: boolean;
  jsonLd: Array<Record<string, unknown>>;
}

const TITLE_LIMIT = 60;
const DESCRIPTION_LIMIT = 160;

export function escapeAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** Same rule as SEO.tsx: hard slice with an ellipsis. */
export function clamp(text: string, limit: number): string {
  const one = text.replace(/\s+/g, ' ').trim();
  return one.length > limit ? one.slice(0, limit - 3) + '…' : one;
}

/**
 * JSON that is safe inside a `<script>`: `<` becomes `<` so a stored
 * description containing `</script>` cannot end the block early. Standard
 * escaping, the same one React's dangerouslySetInnerHTML users reach for.
 */
export function ldJson(value: unknown): string {
  return JSON.stringify(value)
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029');
}

export function renderHead(head: PageHead): string {
  const title = escapeAttr(clamp(head.title, TITLE_LIMIT));
  const description = escapeAttr(clamp(head.description, DESCRIPTION_LIMIT));
  const url = escapeAttr(head.url);
  const image = escapeAttr(head.image);
  const lines = [
    `<title>${title}</title>`,
    `<meta name="description" content="${description}">`,
    head.noindex ? `<meta name="robots" content="noindex, nofollow">` : '',
    `<link rel="canonical" href="${url}">`,
    `<meta property="og:site_name" content="Kenworthy Performing Arts Centre">`,
    `<meta property="og:title" content="${title}">`,
    `<meta property="og:description" content="${description}">`,
    `<meta property="og:url" content="${url}">`,
    `<meta property="og:type" content="${head.ogType}">`,
    `<meta property="og:image" content="${image}">`,
    `<meta name="twitter:card" content="summary_large_image">`,
    `<meta name="twitter:title" content="${title}">`,
    `<meta name="twitter:description" content="${description}">`,
    `<meta name="twitter:image" content="${image}">`,
    ...head.jsonLd.map((blob) => `<script type="application/ld+json">${ldJson(blob)}</script>`),
  ];
  return lines.filter(Boolean).join('\n    ');
}
