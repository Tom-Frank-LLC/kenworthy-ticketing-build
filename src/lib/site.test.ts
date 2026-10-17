import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';
import { SITE_URL, appBaseUrl } from './site';

describe('appBaseUrl', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is the page origin on the web, so staging and local tabs link to themselves', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    expect(appBaseUrl()).toBe(window.location.origin);
  });

  // In the iOS app the origin is capacitor://localhost, which a renter's
  // browser or a second screen cannot open.
  it('is the public site in the iOS app', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    expect(appBaseUrl()).toBe(SITE_URL);
    expect(appBaseUrl()).toMatch(/^https:\/\//);
  });
});
