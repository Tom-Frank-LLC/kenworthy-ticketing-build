import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const calls = vi.hoisted(() => ({ list: { devices: [] as any[], default_id: null as string | null } }));
vi.mock('@/lib/functions', () => ({ invokeFunction: vi.fn(async () => calls.list) }));

import { readChosenReaderId, storeChosenReaderId, useTerminalReader } from './terminalReader';

const box = { id: 'device:box', name: 'Box office', status: 'AVAILABLE' };
const conc = { id: 'device:conc', name: 'Concessions', status: 'AVAILABLE' };

beforeEach(() => { localStorage.clear(); calls.list = { devices: [box, conc], default_id: null }; });

describe('useTerminalReader', () => {
  it('starts unchosen when nothing is remembered and no default is configured', async () => {
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readers.map((r) => r.name)).toEqual(['Box office', 'Concessions']);
    expect(result.current.chosenId).toBeNull();
  });

  it('remembers the choice for this station across reloads', async () => {
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.loading).toBe(false));
    result.current.choose('device:conc');
    expect(readChosenReaderId()).toBe('device:conc');
    const again = renderHook(() => useTerminalReader());
    await waitFor(() => expect(again.result.current.loading).toBe(false));
    expect(again.result.current.chosen?.name).toBe('Concessions');
  });

  it('takes the configured default on a fresh station, but not one it cannot see', async () => {
    calls.list = { devices: [box, conc], default_id: 'device:box' };
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.chosenId).toBe('device:box'));
    localStorage.clear();
    calls.list = { devices: [box], default_id: 'device:gone' };
    const other = renderHook(() => useTerminalReader());
    await waitFor(() => expect(other.result.current.loading).toBe(false));
    expect(other.result.current.chosenId).toBeNull();
  });

  it('forgets a remembered reader that is no longer paired', async () => {
    storeChosenReaderId('device:old');
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chosenId).toBeNull();
    expect(readChosenReaderId()).toBeNull();
  });
});
