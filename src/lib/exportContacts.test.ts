import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Contacts come from the `showing_attendees` RPC rather than from reading
 * `profiles`. `from` is allowed here (the export legitimately reads showings and
 * tickets) but a `profiles` read is not: RLS restricts that table to its own
 * owner or an admin, which is what made this export come back empty for staff.
 */
const responses: Record<string, any> = {};
const tablesTouched: string[] = [];

function builder(table: string) {
  tablesTouched.push(table);
  const b: any = {
    select: () => b,
    eq: () => b,
    in: () => b,
    order: () => b,
    then: (res: any, rej: any) => Promise.resolve(responses[table]).then(res, rej),
  };
  return b;
}

const rpc = vi.fn((_fn?: string, _args?: unknown) => Promise.resolve(responses.rpc));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => builder(table),
    rpc: (fn: string, args: unknown) => rpc(fn, args),
  },
}));

let captured = '';

beforeEach(() => {
  captured = '';
  tablesTouched.length = 0;
  rpc.mockClear();
  responses.showings = { data: [{ id: 'sh-1' }], error: null };
  responses.tickets = { data: [], error: null };
  responses.rpc = { data: [], error: null };
  (globalThis as any).Blob = class {
    constructor(parts: any[]) {
      captured = parts.join('');
    }
  };
  (globalThis as any).URL.createObjectURL = vi.fn(() => 'blob:test');
  (globalThis as any).URL.revokeObjectURL = vi.fn();
  // Clicking a real anchor makes jsdom attempt navigation and log
  // "Not implemented: navigation" for every test. Only the download link needs
  // stubbing; everything else keeps the real implementation.
  const realCreate = document.createElement.bind(document);
  vi.spyOn(document, 'createElement').mockImplementation(((tag: string, ...rest: any[]) =>
    tag === 'a'
      ? ({ href: '', download: '', click: vi.fn() } as unknown as HTMLElement)
      : realCreate(tag as any, ...rest)) as typeof document.createElement);
});

import { exportContactsCsv } from './exportContacts';

describe('exportContactsCsv', () => {
  it('exports name, email and phone — not opaque user ids', async () => {
    responses.tickets = {
      data: [{ id: 't1', comp_recipient_name: null, comp_recipient_email: null }],
      error: null,
    };
    responses.rpc = {
      data: [
        { ticket_id: 't1', display_name: 'Jane Patron', email: 'jane@example.com', phone: '208-555-0101' },
      ],
      error: null,
    };

    const n = await exportContactsCsv('movie', 'm-1', 'Casablanca');

    expect(n).toBe(1);
    expect(captured.split('\n')[0]).toBe('Name,Email,Phone');
    expect(captured).toContain('"Jane Patron","jane@example.com","208-555-0101"');
    expect(captured).not.toContain('User ID');
    expect(rpc).toHaveBeenCalledWith('showing_attendees', { p_showing_ids: ['sh-1'] });
    // The whole point: no direct read of profiles.
    expect(tablesTouched).not.toContain('profiles');
  });

  it('lists a person once even when they bought several seats', async () => {
    responses.tickets = {
      data: [
        { id: 't1', comp_recipient_name: null, comp_recipient_email: null },
        { id: 't2', comp_recipient_name: null, comp_recipient_email: null },
        { id: 't3', comp_recipient_name: null, comp_recipient_email: null },
      ],
      error: null,
    };
    const jane = { display_name: 'Jane Patron', email: 'jane@example.com', phone: '' };
    responses.rpc = {
      data: [
        { ticket_id: 't1', ...jane },
        { ticket_id: 't2', ...jane },
        { ticket_id: 't3', display_name: 'Sam Other', email: 'sam@example.com', phone: '' },
      ],
      error: null,
    };

    const n = await exportContactsCsv('event', 'e-1', 'Gala');

    expect(n).toBe(2);
    expect(captured.match(/jane@example\.com/g)?.length).toBe(1);
    expect(captured).toContain('sam@example.com');
  });

  it('falls back to the comp recipient when a ticket has no account holder', async () => {
    responses.tickets = {
      data: [{ id: 't1', comp_recipient_name: 'Press Guest', comp_recipient_email: 'press@example.com' }],
      error: null,
    };
    // A comp ticket has no user_id, so the RPC returns the row with null contact.
    responses.rpc = {
      data: [{ ticket_id: 't1', display_name: null, email: null, phone: null }],
      error: null,
    };

    const n = await exportContactsCsv('concert', 'c-1', 'Jazz Night');

    expect(n).toBe(1);
    expect(captured).toContain('"Press Guest","press@example.com",""');
  });

  it('returns null rather than a misleading empty file when contacts fail', async () => {
    responses.tickets = {
      data: [{ id: 't1', comp_recipient_name: null, comp_recipient_email: null }],
      error: null,
    };
    responses.rpc = { data: null, error: { message: 'permission denied' } };

    expect(await exportContactsCsv('movie', 'm-1', 'Casablanca')).toBeNull();
    expect(captured).toBe('');
  });

  it('returns null when the production has no confirmed tickets', async () => {
    responses.tickets = { data: [], error: null };
    expect(await exportContactsCsv('movie', 'm-1', 'Casablanca')).toBeNull();
    expect(captured).toBe('');
  });

  it('returns null when the production has no showings', async () => {
    responses.showings = { data: [], error: null };
    expect(await exportContactsCsv('movie', 'm-1', 'Casablanca')).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
