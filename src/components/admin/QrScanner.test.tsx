import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

/**
 * A fake html5-qrcode that records how it was driven.
 *
 * The two things worth asserting here both fail *silently* in a browser: a
 * camera that is never released (the torch stays on and the next reader cannot
 * open) and a decode callback frozen against stale props (scans keep arriving
 * but act on whatever the parent's state was when the camera started).
 */
const instances: FakeScanner[] = [];
/** Set by the "camera refuses to open" test; reset in beforeEach. */
let cameraUnavailable = false;

class FakeScanner {
  elementId: string;
  started = false;
  stopped = false;
  cleared = false;
  onDecode: ((text: string) => void) | null = null;

  constructor(elementId: string) {
    this.elementId = elementId;
    instances.push(this);
  }

  async start(_cfg: unknown, _opts: unknown, onDecode: (text: string) => void) {
    if (cameraUnavailable) throw new Error('no camera');
    this.started = true;
    this.onDecode = onDecode;
  }
  async stop() { this.stopped = true; }
  clear() { this.cleared = true; }
}

vi.mock('html5-qrcode', () => ({
  Html5Qrcode: class {
    constructor(id: string) { return new FakeScanner(id) as unknown as object; }
  },
}));

const toastError = vi.fn();
vi.mock('sonner', () => ({ toast: { error: (m: string) => toastError(m) } }));

import { QrScanner } from './QrScanner';

beforeEach(() => {
  instances.length = 0;
  toastError.mockClear();
  cameraUnavailable = false;
});

async function startCamera() {
  fireEvent.click(screen.getByRole('button', { name: /scan|camera/i }));
  await waitFor(() => expect(instances[0]?.started).toBe(true));
  return instances[0];
}

describe('QrScanner', () => {
  it('hands decoded text to the caller', async () => {
    const onScan = vi.fn();
    render(<QrScanner onScan={onScan} />);
    const scanner = await startCamera();

    scanner.onDecode!('PASS:abc-123');
    expect(onScan).toHaveBeenCalledWith('PASS:abc-123');
  });

  it('calls the latest onScan, not the one captured when the camera started', async () => {
    // html5-qrcode keeps the callback it was given for the whole session. Read
    // from props it would freeze the parent's state at start-of-session — the
    // door scanner would admit passes against whichever screening was selected
    // when someone first tapped Start, for the rest of the night.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<QrScanner onScan={first} />);
    const scanner = await startCamera();

    rerender(<QrScanner onScan={second} />);
    scanner.onDecode!('PASS:later');

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('PASS:later');
  });

  it('releases the camera when stopped', async () => {
    render(<QrScanner onScan={() => {}} />);
    const scanner = await startCamera();

    fireEvent.click(screen.getByRole('button', { name: /stop/i }));
    await waitFor(() => expect(scanner.stopped).toBe(true));
    expect(scanner.cleared).toBe(true);
  });

  it('releases the camera if the surface unmounts mid-scan', async () => {
    const { unmount } = render(<QrScanner onScan={() => {}} />);
    const scanner = await startCamera();

    unmount();
    await waitFor(() => expect(scanner.stopped).toBe(true));
  });

  it('gives each instance its own container, so two can coexist', () => {
    render(
      <>
        <QrScanner onScan={() => {}} />
        <QrScanner onScan={() => {}} />
      </>,
    );
    const ids = Array.from(document.querySelectorAll('[id^="qr-reader-"]')).map(el => el.id);
    expect(ids).toHaveLength(2);
    // html5-qrcode attaches by element id; a shared id would make two mounted
    // readers race for the same node.
    expect(new Set(ids).size).toBe(2);
  });

  it('reports a camera it cannot open instead of looking idle', async () => {
    // A Start button that silently does nothing is unreportable at a counter —
    // staff cannot tell a denied permission from a broken build.
    cameraUnavailable = true;
    render(<QrScanner onScan={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: /scan|camera/i }));

    await waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError.mock.calls[0][0]).toMatch(/camera/i);
    // And it stays offering to start, rather than pretending it is running.
    expect(screen.getByRole('button', { name: /scan|camera/i })).toBeInTheDocument();
  });
});
