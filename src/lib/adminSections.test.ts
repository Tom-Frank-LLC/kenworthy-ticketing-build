import { describe, it, expect } from 'vitest';
import { resolveAdminSection } from '@/lib/adminSections';

describe('resolveAdminSection', () => {
  it('defaults to listings with no parameters', () => {
    expect(resolveAdminSection(null, null)).toEqual({ section: 'listings', pagesTab: 'festival' });
  });

  it('leaves an ordinary section alone', () => {
    expect(resolveAdminSection('rentals', null).section).toBe('rentals');
  });

  // The point of the whole module: links written before Pages existed.
  it.each(['festival', 'hiring', 'press'])(
    'sends a bookmarked ?section=%s to Pages with that sub-tab open',
    (legacy) => {
      expect(resolveAdminSection(legacy, null)).toEqual({ section: 'pages', pagesTab: legacy });
    },
  );

  it('honours an explicit ?page= alongside a current section', () => {
    expect(resolveAdminSection('pages', 'press')).toEqual({ section: 'pages', pagesTab: 'press' });
  });

  it('lets a legacy section override a stale page parameter', () => {
    expect(resolveAdminSection('press', 'hiring')).toEqual({ section: 'pages', pagesTab: 'press' });
  });

  it('falls back rather than opening an unknown sub-tab', () => {
    expect(resolveAdminSection('pages', 'nonsense').pagesTab).toBe('festival');
  });
});
