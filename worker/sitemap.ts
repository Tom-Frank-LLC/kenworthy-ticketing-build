/**
 * The sitemap, rendered from live rows rather than a file in public/.
 *
 * The static file listed seven URLs and could not know a showing existed;
 * Google was left to discover event pages by following links, which for a
 * JS-rendered SPA it mostly did not. Served by the Worker at /sitemap.xml
 * (Decision 5: dynamic, so it is never stale).
 */
import type { SitemapRows } from './data';

interface Entry {
  loc: string;
  lastmod?: string;
  changefreq?: string;
  priority?: string;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const STATIC_PRIORITY: Record<string, [string, string]> = {
  '/': ['daily', '1.0'],
  '/calendar': ['daily', '0.9'],
  '/film-passes': ['weekly', '0.7'],
  '/silent-film-festival': ['weekly', '0.7'],
  '/rentals': ['monthly', '0.7'],
  '/privacy': ['yearly', '0.2'],
  '/terms': ['yearly', '0.2'],
};

export function renderSitemap(siteUrl: string, staticPaths: string[], rows: SitemapRows): string {
  const entries: Entry[] = [];
  for (const path of staticPaths) {
    const [changefreq, priority] = STATIC_PRIORITY[path] ?? ['monthly', '0.5'];
    entries.push({ loc: `${siteUrl}${path}`, changefreq, priority });
  }
  // Listed on purpose, unlike the other standalone page in public/. An A2P
  // 10DLC campaign is vetted partly on whether the SMS opt-in disclosure is
  // publicly findable, so this one wants to be crawled rather than merely
  // reachable.
  entries.push({ loc: `${siteUrl}/sms`, changefreq: 'yearly', priority: '0.2' });
  for (const s of rows.showings) {
    entries.push({ loc: `${siteUrl}/showing/${s.id}`, lastmod: s.updated_at?.slice(0, 10), changefreq: 'daily', priority: '0.8' });
  }
  for (const p of rows.passes) {
    entries.push({ loc: `${siteUrl}/film-pass/${p.id}`, lastmod: p.updated_at?.slice(0, 10), changefreq: 'weekly', priority: '0.6' });
  }
  const body = entries
    .map((e) => {
      const parts = [`<loc>${esc(e.loc)}</loc>`];
      if (e.lastmod) parts.push(`<lastmod>${e.lastmod}</lastmod>`);
      if (e.changefreq) parts.push(`<changefreq>${e.changefreq}</changefreq>`);
      if (e.priority) parts.push(`<priority>${e.priority}</priority>`);
      return `  <url>\n    ${parts.join('\n    ')}\n  </url>`;
    })
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}
