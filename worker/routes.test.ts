import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { classify, isKnownAppRoute, INDEXABLE_STATIC_PATHS } from './routes';

describe('classify', () => {
  it('knows the home page and the static pages', () => {
    expect(classify('/')).toMatchObject({ kind: 'static', path: '/' });
    expect(classify('/calendar')).toMatchObject({ kind: 'static' });
    expect(classify('/silent-film-festival')).toMatchObject({ kind: 'static' });
  });

  it('parses a showing and a pass id, and refuses a non-UUID', () => {
    const id = '8f07c7c3-6145-4158-b354-139d46f8fe82';
    expect(classify(`/showing/${id}`)).toEqual({ kind: 'showing', id });
    expect(classify(`/film-pass/${id}`)).toEqual({ kind: 'pass', id });
    expect(classify('/showing/old-flyer')).toEqual({ kind: 'unknown' });
  });

  it('marks staff and patron-private surfaces noindex, including nested paths', () => {
    for (const p of ['/admin', '/admin/showings/new', '/staff/pos', '/host', '/auth', '/t/abc', '/verify/123', '/superadmin']) {
      expect(classify(p).kind, p).toBe('private');
    }
  });

  it('hands files and standalone documents to the asset layer', () => {
    for (const p of ['/favicon.svg', '/assets/index-abc123.js', '/sms', '/colorlab', '/sms.html', '/manifest.webmanifest', '/index.html']) {
      expect(classify(p).kind, p).toBe('asset');
    }
  });

  it('calls everything else unknown', () => {
    expect(classify('/no-such-page')).toEqual({ kind: 'unknown' });
    expect(classify('/contact-us')).toEqual({ kind: 'unknown' });
  });

  it('never lists a private or unlisted page in the sitemap', () => {
    for (const p of INDEXABLE_STATIC_PATHS) {
      expect(classify(p).kind, p).toBe('static');
    }
    expect(INDEXABLE_STATIC_PATHS).not.toContain('/dvds');
  });
});

describe('every route in App.tsx is classified', () => {
  // A page added to the router without a row here would be served with a
  // 404 status to every crawler. This is the guard.
  const app = readFileSync(resolve(process.cwd(), 'src/App.tsx'), 'utf8');
  const routes = [...app.matchAll(/<Route\s+path="([^"]+)"/g)].map((m) => m[1]);

  it('found the router', () => {
    expect(routes.length).toBeGreaterThan(30);
  });

  it.each(routes)('%s', (path) => {
    expect(isKnownAppRoute(path)).toBe(true);
  });
});
