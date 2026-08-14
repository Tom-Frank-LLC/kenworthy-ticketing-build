import { describe, expect, it } from 'vitest';
import { MAX_FEATURED, safeHttpUrl, splitPressArticles, type PressArticle } from './press';
import { formatPlainDate } from './datetime';

/**
 * Two things on the Press page are easy to get wrong in ways nobody notices
 * until a journalist does: the order coverage appears in, and whether a
 * staff-typed link is safe to turn into an anchor. Both are pure functions on
 * purpose, so both can be checked here rather than by clicking around.
 */

function article(over: Partial<PressArticle> & { id: string }): PressArticle {
  return {
    title: `Story ${over.id}`,
    outlet: 'Moscow-Pullman Daily News',
    url: 'https://example.com/story',
    published_date: null,
    excerpt: null,
    image_url: null,
    is_featured: false,
    feature_order: 0,
    is_active: true,
    ...over,
  };
}

describe('splitPressArticles', () => {
  const oldest = article({ id: 'oldest', published_date: '2024-01-05' });
  const middle = article({ id: 'middle', published_date: '2025-06-30' });
  const newest = article({ id: 'newest', published_date: '2026-08-01' });

  it('pins the featured articles in feature_order and lists the rest newest first', () => {
    const { featured, rest } = splitPressArticles([
      oldest,
      { ...middle, is_featured: true, feature_order: 2 },
      { ...newest, is_featured: true, feature_order: 1 },
    ]);
    // feature_order wins over date among the pinned — that is the whole point
    // of letting staff choose which of the two leads.
    expect(featured.map(a => a.id)).toEqual(['newest', 'middle']);
    expect(rest.map(a => a.id)).toEqual(['oldest']);
  });

  it('works with one featured article, and with none', () => {
    expect(splitPressArticles([oldest, newest]).featured).toEqual([]);
    expect(splitPressArticles([oldest, newest]).rest.map(a => a.id))
      .toEqual(['newest', 'oldest']);

    const one = splitPressArticles([oldest, { ...newest, is_featured: true }]);
    expect(one.featured.map(a => a.id)).toEqual(['newest']);
    expect(one.rest.map(a => a.id)).toEqual(['oldest']);
  });

  it('demotes a third featured article instead of dropping or rendering it', () => {
    // The admin tab refuses to pin a third, but a row edited directly in SQL
    // can still arrive this way. The page must not grow a third hero card,
    // and — the failure that would actually cost us — must not silently swallow
    // the article.
    const { featured, rest } = splitPressArticles([
      { ...oldest, is_featured: true, feature_order: 3 },
      { ...middle, is_featured: true, feature_order: 2 },
      { ...newest, is_featured: true, feature_order: 1 },
    ]);
    expect(featured).toHaveLength(MAX_FEATURED);
    expect(featured.map(a => a.id)).toEqual(['newest', 'middle']);
    expect(rest.map(a => a.id)).toEqual(['oldest']);
  });

  it('sorts undated coverage last rather than first', () => {
    const undated = article({ id: 'undated' });
    const { rest } = splitPressArticles([undated, oldest, newest]);
    expect(rest.map(a => a.id)).toEqual(['newest', 'oldest', 'undated']);
  });
});

describe('safeHttpUrl', () => {
  it('keeps ordinary links', () => {
    expect(safeHttpUrl('https://dnews.com/story')).toBe('https://dnews.com/story');
    expect(safeHttpUrl('  http://dnews.com/story  ')).toBe('http://dnews.com/story');
  });

  it('adds https to a bare domain rather than making it a relative link', () => {
    expect(safeHttpUrl('dnews.com/local/kenworthy')).toBe('https://dnews.com/local/kenworthy');
  });

  it('refuses schemes an anchor would execute', () => {
    // eslint-disable-next-line no-script-url
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
  });

  it('refuses empty and unparseable input', () => {
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl('   ')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl(undefined)).toBeNull();
  });
});

describe('formatPlainDate', () => {
  it('renders a DATE column as the day it says, not the day before', () => {
    // `new Date('2026-08-01')` is UTC midnight, which is July 31 in Pacific.
    // Every press card west of Greenwich would print the wrong date.
    expect(formatPlainDate('2026-08-01')).toBe('August 1, 2026');
    expect(formatPlainDate('2026-01-01')).toBe('January 1, 2026');
  });

  it('tolerates a missing date', () => {
    expect(formatPlainDate(null)).toBe('');
    expect(formatPlainDate('')).toBe('');
  });
});
