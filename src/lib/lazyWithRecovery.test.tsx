import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { Component, Suspense, type ReactNode } from 'react';
import { lazyWithRecovery, CHUNK_RELOAD_KEY } from './lazyWithRecovery';

/** Catches the rethrow in the no-loop case so it doesn't escape the run. */
class Boundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? <div>boundary caught</div> : this.props.children;
  }
}

/**
 * The failure being modelled: a deploy replaced the hashed chunks, so the
 * dynamic import for a route rejects. Before this module existed, that
 * unmounted React and left a blank page until a hard refresh.
 */
const chunkGone = () =>
  Promise.reject(new TypeError('Failed to fetch dynamically imported module: /assets/Calendar-OLD.js'));

function Ok() {
  return <div>route loaded</div>;
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  reload = vi.fn();
  Object.defineProperty(window, 'location', {
    configurable: true,
    value: { ...window.location, reload },
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('lazyWithRecovery', () => {
  it('reloads once when a route chunk has been deleted by a deploy', async () => {
    const Route = lazyWithRecovery(() => chunkGone() as Promise<{ default: typeof Ok }>);

    render(
      <Suspense fallback={<div>loading</div>}>
        <Route />
      </Suspense>,
    );

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    // It must not settle: Suspense keeps showing the fallback rather than
    // flashing an error in the instant before the reload lands.
    expect(screen.getByText('loading')).toBeInTheDocument();
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).not.toBeNull();
  });

  it('does not reload a second time, so a genuinely broken chunk cannot loop', async () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    const factory = vi.fn(() => chunkGone() as Promise<{ default: typeof Ok }>);
    const Route = lazyWithRecovery(factory);

    // The rejection is allowed through this time; React surfaces it to an
    // error boundary rather than us reloading forever.
    render(
      <Boundary>
        <Suspense fallback={<div>loading</div>}>
          <Route />
        </Suspense>
      </Boundary>,
    );

    await waitFor(() => expect(screen.getByText('boundary caught')).toBeInTheDocument());
    expect(factory).toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('releases the budget on success, so a tab open across two deploys recovers from both', async () => {
    sessionStorage.setItem(CHUNK_RELOAD_KEY, '1');
    const Route = lazyWithRecovery(async () => ({ default: Ok }));

    render(
      <Suspense fallback={<div>loading</div>}>
        <Route />
      </Suspense>,
    );

    await waitFor(() => expect(screen.getByText('route loaded')).toBeInTheDocument());
    expect(sessionStorage.getItem(CHUNK_RELOAD_KEY)).toBeNull();
    expect(reload).not.toHaveBeenCalled();
  });

  // Regression: a `vite:preloadError` listener calling preventDefault() makes
  // Vite's helper swallow the error, so the import RESOLVES with undefined
  // rather than rejecting. React then reads `undefined.default` and the page
  // goes blank with nothing to catch. Treat that as a stale chunk too.
  it('recovers when the import resolves as undefined instead of rejecting', async () => {
    const Route = lazyWithRecovery(
      () => Promise.resolve(undefined) as unknown as Promise<{ default: typeof Ok }>,
    );

    render(
      <Suspense fallback={<div>loading</div>}>
        <Route />
      </Suspense>,
    );

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(screen.getByText('loading')).toBeInTheDocument();
  });

  it('renders normally when nothing is wrong', async () => {
    const Route = lazyWithRecovery(async () => ({ default: Ok }));

    render(
      <Suspense fallback={<div>loading</div>}>
        <Route />
      </Suspense>,
    );

    await waitFor(() => expect(screen.getByText('route loaded')).toBeInTheDocument());
    expect(reload).not.toHaveBeenCalled();
  });
});
