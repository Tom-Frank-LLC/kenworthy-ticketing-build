import { describe, expect, it } from 'vitest';
import {
  parseRecipientList,
  parseStaffNotificationSettings,
  validateSetting,
} from './staffNotifications';

describe('parseStaffNotificationSettings', () => {
  it('fills every registered kind with the defaults when nothing is stored', () => {
    const s = parseStaffNotificationSettings(null);
    expect(s.rental_request).toEqual({ enabled: true, recipients: ['events@kenworthy.org'] });
  });

  it('reads a stored list, drops junk, dedupes case-insensitively', () => {
    const s = parseStaffNotificationSettings({
      rental_request: {
        enabled: true,
        recipients: [' gm@kenworthy.org', 'nope', 'GM@kenworthy.org', 7, 'events@kenworthy.org'],
      },
    });
    expect(s.rental_request.recipients).toEqual(['gm@kenworthy.org', 'events@kenworthy.org']);
  });

  it('falls back to the default when the stored list is empty, and only false disables', () => {
    expect(parseStaffNotificationSettings({ rental_request: { recipients: [] } }).rental_request.recipients)
      .toEqual(['events@kenworthy.org']);
    expect(parseStaffNotificationSettings({ rental_request: { enabled: false } }).rental_request.enabled).toBe(false);
    expect(parseStaffNotificationSettings({ rental_request: { enabled: 0 } }).rental_request.enabled).toBe(true);
  });
});

describe('parseRecipientList', () => {
  it('accepts commas, semicolons, spaces and newlines as separators', () => {
    const { recipients, invalid } = parseRecipientList('a@x.org, b@x.org;c@x.org\nd@x.org e@x.org');
    expect(recipients).toEqual(['a@x.org', 'b@x.org', 'c@x.org', 'd@x.org', 'e@x.org']);
    expect(invalid).toEqual([]);
  });

  it('names what it could not read instead of dropping it', () => {
    const { recipients, invalid } = parseRecipientList('events@kenworthy.org, front desk, gm@kenworthy');
    expect(recipients).toEqual(['events@kenworthy.org']);
    expect(invalid).toEqual(['front', 'desk', 'gm@kenworthy']);
  });

  it('dedupes', () => {
    expect(parseRecipientList('A@x.org a@x.org').recipients).toEqual(['A@x.org']);
  });
});

describe('validateSetting', () => {
  it('refuses an enabled notification with nobody to send to', () => {
    expect(validateSetting({ enabled: true, recipients: [] }, [])).toMatch(/at least one address/);
    expect(validateSetting({ enabled: false, recipients: [] }, [])).toBeNull();
  });

  it('refuses unreadable addresses by name', () => {
    expect(validateSetting({ enabled: true, recipients: ['a@x.org'] }, ['bogus'])).toContain('"bogus"');
  });
});
