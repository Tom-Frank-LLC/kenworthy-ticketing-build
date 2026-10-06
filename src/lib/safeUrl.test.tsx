// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import { BrowserRouter, useNavigate } from 'react-router-dom';
import { useEffect } from 'react';
import routerPkg from 'react-router-dom/package.json';
import { safeHttpUrl, safeRedirectPath } from './safeUrl';

/**
 * The open redirect after sign-in (audit 2026-10-06, M5), reproduced against
 * the router this app actually ships rather than against a model of it.
 *
 * `/auth?redirect=//evil.example` reached `navigate()` unchecked. In
 * react-router 6.30.1 the target resolves to a cross-origin URL; `pushState`
 * throws SecurityError on that, and the router's catch block falls back to
 * `window.location.assign(url)` — the browser leaves the site. jsdom's
 * pushState does not enforce same-origin, so the harness below adds the check
 * a real browser makes, and records both what was pushed and what was assigned.
 */
const HOSTILE = [
  '//evil.example/phish',
  '/\\evil.example/phish',
  '/\t/evil.example/phish',
  '/..//evil.example/phish',
  'https://evil.example/phish',
  'javascript:alert(1)',
  '\\\\evil.example',
];

const ORIGIN = window.location.origin;

/** Navigate to `target` inside a real BrowserRouter; report every URL it tried to visit. */
function attempt(target: string): string[] {
  const assign = vi.fn();
  const pushes: string[] = [];
  const realLocation = window.location;
  const realPush = window.history.pushState;
  delete (window as unknown as { location?: unknown }).location;
  (window as unknown as { location: unknown }).location = {
    ...realLocation,
    assign,
    href: realLocation.href,
    origin: realLocation.origin,
    pathname: realLocation.pathname,
    search: '',
    hash: '',
  };
  window.history.pushState = (state: unknown, title: string, url?: string | URL | null) => {
    pushes.push(String(url));
    const next = new URL(String(url), ORIGIN + '/');
    if (next.origin !== ORIGIN) throw new DOMException('cross-origin pushState', 'SecurityError');
    realPush.call(window.history, state, title, url);
  };
  try {
    function Go() {
      const navigate = useNavigate();
      useEffect(() => {
        navigate(target);
      }, [navigate]);
      return null;
    }
    render(
      <BrowserRouter>
        <Go />
      </BrowserRouter>,
    );
  } finally {
    (window as unknown as { location: unknown }).location = realLocation;
    window.history.pushState = realPush;
  }
  return [...pushes, ...assign.mock.calls.map(c => String(c[0]))].map(u => new URL(u, ORIGIN + '/').href);
}

const offSite = (visited: string[]) => visited.filter(u => new URL(u).origin !== ORIGIN);

describe('safeRedirectPath', () => {
  afterEach(() => window.history.replaceState(null, '', '/'));

  it('keeps an ordinary path on this site, query and hash included', () => {
    expect(safeRedirectPath('/admin')).toBe('/admin');
    expect(safeRedirectPath('/admin?tab=movies&page=2#x')).toBe('/admin?tab=movies&page=2#x');
    expect(safeRedirectPath('/showing/3f1c?from=email')).toBe('/showing/3f1c?from=email');
  });

  it('falls back to / for nothing at all', () => {
    expect(safeRedirectPath(null)).toBe('/');
    expect(safeRedirectPath(undefined)).toBe('/');
    expect(safeRedirectPath('')).toBe('/');
  });

  it.each(HOSTILE)('refuses %j', raw => {
    expect(safeRedirectPath(raw)).toBe('/');
  });

  it('refuses relative paths too — the sign-in page has no business resolving them', () => {
    expect(safeRedirectPath('admin')).toBe('/');
    expect(safeRedirectPath('../admin')).toBe('/');
  });

  // The control: without the guard, the installed router really does leave the
  // site. Pinned to 6.30.1, the version the audit traced, so a router upgrade
  // that fixes the advisory does not turn this red — the guarded cases below
  // are what must hold on every version.
  it.runIf(routerPkg.version === '6.30.1')(
    'control: react-router 6.30.1 leaves the site for an unguarded //host or /\\host',
    () => {
      expect(offSite(attempt('//evil.example/phish'))).not.toEqual([]);
      expect(offSite(attempt('/\\evil.example/phish'))).not.toEqual([]);
    },
  );

  it.each(HOSTILE)('through the installed router, %j guarded stays on this site', raw => {
    const visited = attempt(safeRedirectPath(raw));
    expect(offSite(visited)).toEqual([]);
    expect(visited.map(u => new URL(u).pathname)).toEqual(['/']);
  });

  it('a legitimate redirect still arrives where it was going', () => {
    const visited = attempt(safeRedirectPath('/admin?tab=movies'));
    expect(visited).toEqual([`${ORIGIN}/admin?tab=movies`]);
  });
});

describe('safeHttpUrl', () => {
  it('passes http(s) and normalises a bare host to https', () => {
    expect(safeHttpUrl('https://tickets.example.org/e/1')).toBe('https://tickets.example.org/e/1');
    expect(safeHttpUrl(' http://example.org ')).toBe('http://example.org/');
    expect(safeHttpUrl('example.org/rsvp')).toBe('https://example.org/rsvp');
  });

  it('refuses every other scheme', () => {
    for (const raw of [
      'javascript:alert(1)',
      'JavaScript:alert(1)',
      ' javascript:alert(1)',
      'java\tscript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'vbscript:msgbox(1)',
      'file:///etc/passwd',
    ]) {
      expect(safeHttpUrl(raw), raw).toBeNull();
    }
  });

  it('returns null for nothing', () => {
    expect(safeHttpUrl(null)).toBeNull();
    expect(safeHttpUrl('  ')).toBeNull();
  });
});
