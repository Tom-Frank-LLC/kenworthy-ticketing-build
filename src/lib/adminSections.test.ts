import { describe, it, expect } from 'vitest';
import { resolveAdminSection } from '@/lib/adminSections';

describe('resolveAdminSection', () => {
  it('defaults to listings with no parameters', () => {
    expect(resolveAdminSection(null, null)).toEqual({
      section: 'listings',
      pagesTab: 'festival',
      scheduleTab: 'movies',
    });
  });

  it('leaves an ordinary section alone', () => {
    expect(resolveAdminSection('rentals', null).section).toBe('rentals');
  });

  // The point of the whole module: links written before Pages existed.
  it.each(['festival', 'hiring', 'press'])(
    'sends a bookmarked ?section=%s to Pages with that sub-tab open',
    (legacy) => {
      expect(resolveAdminSection(legacy, null)).toEqual({
        section: 'pages',
        pagesTab: legacy,
        scheduleTab: 'movies',
      });
    },
  );

  it('honours an explicit ?page= alongside a current section', () => {
    expect(resolveAdminSection('pages', 'press').pagesTab).toBe('press');
  });

  it('lets a legacy section override a stale page parameter', () => {
    expect(resolveAdminSection('press', 'hiring').pagesTab).toBe('press');
  });

  it('falls back rather than opening an unknown sub-tab', () => {
    expect(resolveAdminSection('pages', 'nonsense').pagesTab).toBe('festival');
  });

  // Backstage was born inside Pages, so it is a sub-tab that was never a
  // section. The two lists are separate for exactly this pair of cases.
  it('opens a sub-tab that was never a top-level section', () => {
    expect(resolveAdminSection('pages', 'backstage').pagesTab).toBe('backstage');
  });

  it('does not invent a redirect for a section that never existed', () => {
    expect(resolveAdminSection('backstage', null).section).toBe('backstage');
  });

  describe('the Listings sub-tab', () => {
    it('opens the one the URL names', () => {
      expect(resolveAdminSection('listings', null, 'venues').scheduleTab).toBe('venues');
      expect(resolveAdminSection('listings', null, 'featured').scheduleTab).toBe('featured');
    });

    it('falls back to Movies rather than opening a blank panel', () => {
      // Radix renders nothing for a value with no TabsContent, so an unknown
      // ?tab= would be an empty page with no error to search for.
      expect(resolveAdminSection('listings', null, 'squares').scheduleTab).toBe('movies');
      expect(resolveAdminSection('listings', null, null).scheduleTab).toBe('movies');
    });
  });

  describe('a sub-tab that has moved out of Pages', () => {
    // The curator's-pick editor shipped under Pages as "Home" and moved to
    // Listings as "Featured" the next day. A day is long enough for a link to
    // exist, and this module's premise is that a URL outlives its layout.
    it('sends ?section=pages&page=home to Listings → Featured', () => {
      expect(resolveAdminSection('pages', 'home')).toEqual({
        section: 'listings',
        pagesTab: 'festival',
        scheduleTab: 'featured',
      });
    });

    it('ignores a stale ?tab= riding along with it', () => {
      // The old URL's `tab` belonged to Listings, which the reader was not
      // looking at. Where they were going is the only part still worth reading.
      expect(resolveAdminSection('pages', 'home', 'venues').scheduleTab).toBe('featured');
    });

    it('believes a deliberate section over a stale page', () => {
      // ?section=analytics&page=home is someone on Analytics carrying an old
      // page parameter, not someone asking for the pick editor.
      expect(resolveAdminSection('analytics', 'home').section).toBe('analytics');
    });

    it('still lets a legacy section win outright', () => {
      expect(resolveAdminSection('press', 'home')).toEqual({
        section: 'pages',
        pagesTab: 'press',
        scheduleTab: 'movies',
      });
    });

    it('no longer treats home as a Pages sub-tab', () => {
      // Belt and braces on the redirect above: if `home` ever came back as a
      // real sub-tab this test fails, which is the moment to decide which of
      // the two rules wins.
      expect(resolveAdminSection('pages', 'home').section).not.toBe('pages');
    });
  });
});
