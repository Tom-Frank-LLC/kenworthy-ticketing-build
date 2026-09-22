import { describe, expect, it } from 'vitest';
import { rsvpUrlError, rsvpUrlFieldLabel, ticketingLabel, ticketingModesFor } from './liveEventTypes';

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

// One stored value, two words. A concert is RSVP'd to; a film is ticketed by
// somebody else, and calling that RSVP confused the people filling in the form.
describe('the rsvp mode is called External on a film and RSVP on a live event', () => {
  it('labels the mode by kind', () => {
    expect(ticketingLabel('rsvp', 'film')).toBe('External');
    expect(ticketingLabel('rsvp', 'live')).toBe('RSVP');
    expect(ticketingLabel('rsvp')).toBe('RSVP');
    expect(ticketingLabel('ticketed', 'film')).toBe('Ticketed');
  });

  it('offers the same three values to both kinds', () => {
    expect(ticketingModesFor('film').map(m => m.value)).toEqual(ticketingModesFor('live').map(m => m.value));
    expect(ticketingModesFor('film').map(m => m.label)).toEqual(['Ticketed', 'External', 'Info only']);
  });

  it('names the link field and the refusal in the kind\'s words', () => {
    expect(rsvpUrlFieldLabel('film')).toBe('External ticket URL');
    expect(rsvpUrlFieldLabel('live')).toBe('RSVP URL');
    expect(rsvpUrlError('rsvp', '', 'film')).toMatch(/external ticket link is needed/);
    expect(rsvpUrlError('rsvp', '', 'live')).toMatch(/RSVP link is needed/);
  });
});
