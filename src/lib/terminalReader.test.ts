import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, waitFor } from '@testing-library/react';

const calls = vi.hoisted(() => ({ list: { devices: [] as any[], default_id: null as string | null } }));
vi.mock('@/lib/functions', () => ({ invokeFunction: vi.fn(async () => calls.list) }));
const native = vi.hoisted(() => ({ app: false }));
vi.mock('@/lib/standReader', () => ({ STAND_READER_ID: 'stand', DISPLAY_STAND_READER_ID: 'display-stand', standAvailable: () => native.app }));

import { readChosenReaderId, storeChosenReaderId, useTerminalReader } from './terminalReader';

const box = { id: 'device:box', name: 'Box office', status: 'AVAILABLE' };
const conc = { id: 'device:conc', name: 'Concessions', status: 'AVAILABLE' };

beforeEach(() => { localStorage.clear(); native.app = false; calls.list = { devices: [box, conc], default_id: null }; });

describe('useTerminalReader', () => {
  it('offers the Stand at the patron-facing display first, and takes it on a fresh station', async () => {
    calls.list = { devices: [box, conc], default_id: 'device:box' };
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readers.map((r) => r.id)).toEqual(['display-stand', 'device:box', 'device:conc']);
    expect(result.current.chosenId).toBe('display-stand');
  });

  it('in the iOS app, also offers the Stand under this iPad — but not as the default', async () => {
    native.app = true;
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readers.map((r) => r.id)).toEqual(['display-stand', 'stand', 'device:box', 'device:conc']);
    expect(result.current.chosenId).toBe('display-stand');
  });

  it('keeps the Stand under this iPad when a station chose it (a special event with no display)', async () => {
    native.app = true;
    storeChosenReaderId('stand');
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chosenId).toBe('stand');
  });

  it('keeps a Terminal a station already chose', async () => {
    storeChosenReaderId('device:conc');
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chosenId).toBe('device:conc');
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

  it('replaces a remembered reader that is no longer paired with the usual setup', async () => {
    storeChosenReaderId('device:old');
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.chosenId).toBe('display-stand');
    expect(readChosenReaderId()).toBe('display-stand');
  });

  it('still offers both Stands when the Terminals cannot be listed', async () => {
    native.app = true;
    calls.list = Promise.reject(new Error('Square down')) as any;
    const { result } = renderHook(() => useTerminalReader());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.readers.map((r) => r.id)).toEqual(['display-stand', 'stand']);
  });
});
