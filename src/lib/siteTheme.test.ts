import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The published theme is the half of the Color Lab that can affect strangers,
 * so the things worth pinning are the ones that decide *who* sees what:
 * the precedence between a tab's audition and the site's published colours,
 * and the fact that a refused write is reported as a failure rather than
 * silently congratulated.
 *
 * That second one is not hypothetical. PostgREST answers an RLS-blocked write
 * with success and zero rows, so an admin who is not a superadmin would see
 * "Published" and no change at all unless the row count is checked.
 */

const upsertResult = { data: [] as unknown, error: null as unknown };
const selectResult = { data: null as unknown, error: null as unknown };

const select = vi.fn(() => Promise.resolve(selectResult));
const upsert = vi.fn(() => ({ select }));
const maybeSingle = vi.fn(() => Promise.resolve(selectResult));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle }) }),
      upsert,
    }),
  },
}));

import {
  applyEffectiveTheme,
  isEmpty,
  NO_THEME,
  publishSiteTheme,
  revertSiteTheme,
} from './siteTheme';
import { hexToHslCss, writeLabState, OFF } from './colorLab';

const root = () => document.documentElement.style;

beforeEach(() => {
  document.documentElement.removeAttribute('style');
  window.sessionStorage.clear();
  window.localStorage.clear();
  upsert.mockClear();
  select.mockClear();
  selectResult.data = null;
  selectResult.error = null;
  upsertResult.data = [];
});

describe('precedence', () => {
  it('uses the published theme when this tab has no override', () => {
    writeLabState(OFF);
    applyEffectiveTheme({ purple: '#B262DA', green: '#73A94C' });
    expect(root().getPropertyValue('--primary')).toBe(hexToHslCss('#B262DA'));
    expect(root().getPropertyValue('--success')).toBe(hexToHslCss('#73A94C'));
  });

  it("lets this tab's override win, so a colleague publishing cannot yank the page away mid-audition", () => {
    writeLabState({ on: true, purple: '#8443B1', green: null });
    applyEffectiveTheme({ purple: '#B262DA', green: '#73A94C' });
    expect(root().getPropertyValue('--primary')).toBe(hexToHslCss('#8443B1'));
  });

  it('resolves precedence per colour, not wholesale', () => {
    // Auditioning a green against the published purple is a normal thing to
    // want, so a session green must not drag the session's null purple with it.
    writeLabState({ on: true, purple: null, green: '#125A51' });
    applyEffectiveTheme({ purple: '#B262DA', green: '#73A94C' });
    expect(root().getPropertyValue('--primary')).toBe(hexToHslCss('#B262DA'));
    expect(root().getPropertyValue('--success')).toBe(hexToHslCss('#125A51'));
  });

  it('falls through to index.css when neither layer has an opinion', () => {
    writeLabState(OFF);
    applyEffectiveTheme(NO_THEME);
    // null when nothing was ever set, '' once something was set and removed.
    expect(document.documentElement.getAttribute('style') || '').toBe('');
  });

  it('ignores a closed Lab session even if it still carries colours', () => {
    writeLabState({ on: false, purple: '#8443B1', green: '#125A51' });
    applyEffectiveTheme({ purple: '#B262DA', green: null });
    expect(root().getPropertyValue('--primary')).toBe(hexToHslCss('#B262DA'));
    expect(root().getPropertyValue('--success')).toBe('');
  });
});

describe('publishing', () => {
  it('reports an RLS refusal as an error instead of a success', async () => {
    // Zero rows back with no error is exactly what a blocked write looks like.
    selectResult.data = [];
    await expect(publishSiteTheme({ purple: '#B262DA', green: null })).rejects.toThrow(
      /superadmin/i,
    );
  });

  it('surfaces a real database error rather than swallowing it', async () => {
    selectResult.error = { message: 'boom' };
    await expect(publishSiteTheme({ purple: '#B262DA', green: null })).rejects.toBeTruthy();
  });

  it('upserts on the key, since the row may never have existed', async () => {
    selectResult.data = [{ value: { purple: '#B262DA', green: null } }];
    await publishSiteTheme({ purple: '#B262DA', green: null });
    expect(upsert).toHaveBeenCalledTimes(1);
    const [row, opts] = upsert.mock.calls[0] as unknown as [
      Record<string, unknown>,
      Record<string, unknown>,
    ];
    expect(row.key).toBe('site_theme');
    expect(opts.onConflict).toBe('key');
  });

  it('reverts by writing an empty theme, not by deleting the row', async () => {
    // There is no DELETE policy on app_config, and an empty theme means the
    // same thing as no row: fall through to index.css.
    selectResult.data = [{ value: {} }];
    const result = await revertSiteTheme();
    expect(isEmpty(result)).toBe(true);
    const [row] = upsert.mock.calls[0] as unknown as [Record<string, unknown>];
    expect(row.value).toEqual({ purple: null, green: null });
  });

  it('refuses to trust a junk value coming back from the database', async () => {
    selectResult.data = [{ value: { purple: 'javascript:alert(1)', green: 42 } }];
    const result = await publishSiteTheme({ purple: '#B262DA', green: null });
    expect(result).toEqual(NO_THEME);
  });
});
