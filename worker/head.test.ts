import { clamp, escapeAttr, ldJson, renderHead } from './head';
import { renderSitemap } from './sitemap';
import { showingJsonLd, lowestPrice } from './jsonld';
import type { ShowingRow } from './data';

describe('renderHead', () => {
  const head = {
    title: 'Casablanca — Sep 12, 2026 at Kenworthy',
    description: 'Here\'s looking at you, kid. <b>Bold</b> & "quoted"',
    url: 'https://kenworthy.org/showing/abc',
    image: 'https://example.supabase.co/poster.jpg',
    ogType: 'event' as const,
    noindex: false,
    jsonLd: [{ '@type': 'Event', name: '</script><script>alert(1)</script>' }],
  };

  it('writes every tag a crawler or share preview reads', () => {
    const html = renderHead(head);
    expect(html).toContain('<title>Casablanca — Sep 12, 2026 at Kenworthy</title>');
    expect(html).toContain('<link rel="canonical" href="https://kenworthy.org/showing/abc">');
    expect(html).toContain('<meta property="og:url" content="https://kenworthy.org/showing/abc">');
    expect(html).toContain('<meta property="og:image" content="https://example.supabase.co/poster.jpg">');
    expect(html).toContain('<meta property="og:type" content="event">');
    expect(html).not.toContain('noindex');
  });

  it('escapes attribute values and cannot be broken out of by JSON-LD', () => {
    const html = renderHead(head);
    expect(html).toContain('&lt;b&gt;Bold&lt;/b&gt; &amp; &quot;quoted&quot;');
    expect(html).not.toContain('</script><script>alert');
    expect(html).toContain('\\u003c/script>');
  });

  it('adds noindex when asked', () => {
    expect(renderHead({ ...head, noindex: true })).toContain('<meta name="robots" content="noindex, nofollow">');
  });

  it('clamps like SEO.tsx does', () => {
    expect(clamp('a'.repeat(70), 60)).toHaveLength(58);
    expect(clamp('short', 60)).toBe('short');
    expect(escapeAttr('a<b')).toBe('a&lt;b');
    expect(ldJson({ a: '<' })).toBe('{"a":"\\u003c"}');
  });
});

describe('renderSitemap', () => {
  it('lists static pages, showings and passes with absolute URLs', () => {
    const xml = renderSitemap('https://kenworthy.org', ['/', '/calendar'], {
      showings: [{ id: 's1', updated_at: '2026-09-01T10:00:00Z' }],
      passes: [{ id: 'p1', updated_at: null }],
    });
    expect(xml).toContain('<loc>https://kenworthy.org/</loc>');
    expect(xml).toContain('<loc>https://kenworthy.org/calendar</loc>');
    expect(xml).toContain('<loc>https://kenworthy.org/showing/s1</loc>');
    expect(xml).toContain('<lastmod>2026-09-01</lastmod>');
    expect(xml).toContain('<loc>https://kenworthy.org/film-pass/p1</loc>');
    expect(xml).toContain('<loc>https://kenworthy.org/sms</loc>');
    expect(xml).not.toContain('%SITE_URL%');
  });
});

describe('showingJsonLd', () => {
  const base: ShowingRow = {
    id: 'abc',
    start_time: '2026-09-12T02:00:00+00:00',
    duration_minutes: null,
    ticket_price: '8.00',
    manually_sold_out: false,
    no_ticket_required: false,
    is_active: true,
    created_at: '2026-08-01T00:00:00Z',
    updated_at: null,
    movies: { title: 'Casablanca', description: '<p>Play it, Sam.</p>', poster_url: 'https://x/p.jpg', duration_minutes: 102 },
    events: null,
    live_performances: null,
    venues: { name: 'Main Theater' },
    showing_price_tiers: null,
  };
  const before = new Date('2026-09-01T00:00:00Z').getTime();
  const after = new Date('2026-10-01T00:00:00Z').getTime();

  it('is a ScreeningEvent with offers, an end time and the venue geo', () => {
    const ld = showingJsonLd(base, 'https://kenworthy.org', before)!;
    expect(ld['@type']).toBe('ScreeningEvent');
    expect(ld.description).toBe('Play it, Sam.');
    expect(ld.endDate).toBe('2026-09-12T03:42:00.000Z');
    expect(ld.offers).toMatchObject({ price: '8.00', priceCurrency: 'USD', availability: 'https://schema.org/InStock', url: 'https://kenworthy.org/showing/abc' });
    expect((ld.location as Record<string, unknown>).geo).toMatchObject({ latitude: 46.7307309 });
    expect(ld.isAccessibleForFree).toBe(false);
  });

  it('reads sold-out, free and past states from the showing row', () => {
    expect((showingJsonLd({ ...base, manually_sold_out: true }, 'https://k', before)!.offers as Record<string, unknown>).availability).toBe('https://schema.org/SoldOut');
    const free = showingJsonLd({ ...base, ticket_price: 0, no_ticket_required: true }, 'https://k', before)!;
    expect(free.isAccessibleForFree).toBe(true);
    expect((free.offers as Record<string, unknown>).price).toBe('0.00');
    expect((showingJsonLd(base, 'https://k', after)!.offers as Record<string, unknown>).availability).toBe('https://schema.org/Discontinued');
  });

  it('uses the lowest active tier when tiers exist', () => {
    expect(lowestPrice({ ...base, showing_price_tiers: [{ price: '25', is_active: true }, { price: '15', is_active: true }, { price: '1', is_active: false }] })).toBe(15);
  });

  it('types live performances and events differently', () => {
    const concert = showingJsonLd({ ...base, movies: null, live_performances: { title: 'Band', description: null, poster_url: null } }, 'https://k', before)!;
    expect(concert['@type']).toBe('MusicEvent');
    expect(concert.workPresented).toBeUndefined();
  });
});
