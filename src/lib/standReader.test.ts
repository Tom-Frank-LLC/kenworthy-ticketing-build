import { afterEach, describe, expect, it, vi } from 'vitest';
import { Capacitor } from '@capacitor/core';

vi.mock('@/lib/functions', () => ({ invokeFunction: vi.fn() }));
import { describeStand, standAvailable, standFailureMessage, standOf, type StandReaderInfo, type StandStatus } from './standReader';

const stand: StandReaderInfo = { id: 1, name: 'Square Stand', serialNumber: 'S1', model: 'stand', status: 'ready', embedded: true };
const base: StandStatus = { available: true, environment: 'production', authorized: true, location: 'granted', readers: [stand] };

describe('standAvailable', () => {
  afterEach(() => vi.restoreAllMocks());

  it('is false on the website, where there is no Stand plugin', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(false);
    expect(standAvailable()).toBe(false);
  });

  it('needs the plugin compiled into the app, not just the app', () => {
    vi.spyOn(Capacitor, 'isNativePlatform').mockReturnValue(true);
    vi.spyOn(Capacitor, 'isPluginAvailable').mockReturnValue(false);
    expect(standAvailable()).toBe(false);
  });
});

describe('describeStand', () => {
  it('says ready only when the Stand itself is', () => {
    expect(describeStand(base)).toBe('ready');
    expect(describeStand({ ...base, readers: [{ ...stand, status: 'connecting_to_square' }] })).toBe('connecting…');
  });

  // The order matters: each line names the first thing to fix.
  it('names what is missing before anything else', () => {
    expect(describeStand(null)).toBe('checking…');
    expect(describeStand({ available: false })).toBe('not set up in this build');
    expect(describeStand({ ...base, authorized: false })).toBe('not signed in to Square');
    expect(describeStand({ ...base, location: 'denied' })).toMatch(/Location permission/);
    expect(describeStand({ ...base, readers: [] })).toMatch(/not detected/);
  });

  it('finds the Stand among other readers', () => {
    const chip: StandReaderInfo = { ...stand, id: 2, model: 'contactless_and_chip', embedded: false, status: 'unavailable' };
    expect(standOf({ ...base, readers: [chip, stand] })?.id).toBe(1);
    expect(standOf({ ...base, readers: [chip] })).toBeNull();
  });
});

describe('standFailureMessage', () => {
  // Measured in the sandbox, 21 Oct 2026: Square's text for an idle prompt.
  it('says a timeout plainly instead of Square\'s developer message', () => {
    const msg = standFailureMessage({ errorMessage: 'Something went wrong. Please contact the developer of this application and provide them with this error code: payment_timed_out' });
    expect(msg).toMatch(/timed out waiting for a card/);
    expect(msg).not.toMatch(/developer/);
  });

  it('keeps Square\'s code for anything it does not recognise', () => {
    expect(standFailureMessage({ errorMessage: 'Something went wrong ... error code: card_tapped_too_fast' })).toBe('The Stand did not take the payment (Square: card_tapped_too_fast).');
    expect(standFailureMessage({})).toBe('The Stand did not take the payment.');
  });
});
