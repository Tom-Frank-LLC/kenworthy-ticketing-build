import { describe, expect, it } from 'vitest';
import { rsvpUrlError } from './liveEventTypes';

/**
 * An RSVP production with no link renders as if it were ticketed here — every
 * reader checks `rsvp && rsvp_url` before offering the outside link and falls
 * through otherwise. So the link is required, and it is https because the
 * patron is sent to it from a page that is.
 */
describe('rsvpUrlError', () => {
  it('accepts an https link for RSVP', () => {
    expect(rsvpUrlError('rsvp', 'https://festival.example/tickets')).toBeNull();
    expect(rsvpUrlError('rsvp', '  https://festival.example/tickets  ')).toBeNull();
  });

  it('refuses a blank link for RSVP', () => {
    expect(rsvpUrlError('rsvp', '')).toMatch(/link is needed/);
    expect(rsvpUrlError('rsvp', '   ')).toMatch(/link is needed/);
  });

  it('refuses http and things that are not URLs', () => {
    expect(rsvpUrlError('rsvp', 'http://festival.example')).toMatch(/https:\/\//);
    expect(rsvpUrlError('rsvp', 'festival.example/tickets')).toMatch(/not a valid URL/);
  });

  it('ignores the field for every other mode', () => {
    expect(rsvpUrlError('ticketed', '')).toBeNull();
    expect(rsvpUrlError('ticketed', 'nonsense')).toBeNull();
    expect(rsvpUrlError('info_only', '')).toBeNull();
  });
});
