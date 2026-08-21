import { describe, it, expect, beforeEach } from 'vitest';
import { readSectionOpen, writeSectionOpen, clearSectionState } from '@/lib/adminSectionState';

const STORAGE_KEY = 'kenworthy.admin.sections';

describe('adminSectionState', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  it('falls back to the caller default when nothing is stored', () => {
    expect(readSectionOpen('passes.orders', true)).toBe(true);
    expect(readSectionOpen('passes.orders', false)).toBe(false);
  });

  it('round-trips a stored state', () => {
    writeSectionOpen('passes.orders', true);
    expect(readSectionOpen('passes.orders', false)).toBe(true);
  });

  // The asymmetry that makes the feature worth having: closing a section that
  // opens by default is exactly the preference we must not forget.
  it('lets a stored false win over a default of true', () => {
    writeSectionOpen('passes.orders', false);
    expect(readSectionOpen('passes.orders', true)).toBe(false);
  });

  it('keeps sections independent', () => {
    writeSectionOpen('a', true);
    writeSectionOpen('b', false);
    expect(readSectionOpen('a', false)).toBe(true);
    expect(readSectionOpen('b', true)).toBe(false);
  });

  it('stores every section under one key', () => {
    writeSectionOpen('a', true);
    writeSectionOpen('b', false);
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.key(0)).toBe(STORAGE_KEY);
  });

  it('clears everything', () => {
    writeSectionOpen('a', true);
    clearSectionState();
    expect(readSectionOpen('a', false)).toBe(false);
  });

  it.each([
    ['not json', 'nonsense{'],
    ['an array', '[]'],
    ['a bare string', '"open"'],
    ['null', 'null'],
  ])('ignores %s and uses the default', (_label, raw) => {
    window.localStorage.setItem(STORAGE_KEY, raw);
    expect(readSectionOpen('a', true)).toBe(true);
    expect(readSectionOpen('a', false)).toBe(false);
  });

  // A truthy string must not pin a heavy section open.
  it('drops non-boolean values rather than coercing them', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ a: 'yes', b: 1, c: true }));
    expect(readSectionOpen('a', false)).toBe(false);
    expect(readSectionOpen('b', false)).toBe(false);
    expect(readSectionOpen('c', false)).toBe(true);
  });

  it('preserves other sections when one is rewritten', () => {
    writeSectionOpen('a', true);
    writeSectionOpen('b', true);
    writeSectionOpen('a', false);
    expect(readSectionOpen('b', false)).toBe(true);
  });
});
