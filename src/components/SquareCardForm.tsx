import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import {
  SANDBOX_CARD_HINT,
  fetchSquareConfig,
  loadSquareSdk,
  mountSquareCard,
  tokenizeCard,
  type SquareCard,
  type SquareConfig,
  type SquareConfigSource,
} from '@/lib/square';

export interface SquareCardFormHandle {
  /** Single-use token for the entered card. Throws with a message to show. */
  tokenize: () => Promise<string>;
  ready: boolean;
}

interface SquareCardFormProps {
  /** Which edge function to ask for the publishable config. */
  source: SquareConfigSource;
  /** Told when the form becomes usable, so the parent can gate its buttons. */
  onReadyChange?: (ready: boolean) => void;
  className?: string;
}

/**
 * The Square card input — one implementation, used by every payment surface.
 *
 * Donations had a working copy of this logic inline; tickets and film passes
 * had none at all. Three copies of an SDK lifecycle is three places to get the
 * teardown wrong, so it lives here and the pages just hold a ref.
 *
 * The iframe rendered inside belongs to Square. The card number is typed into
 * their origin, not ours, and `tokenize()` is the only way anything leaves it.
 */
export const SquareCardForm = forwardRef<SquareCardFormHandle, SquareCardFormProps>(
  function SquareCardForm({ source, onReadyChange, className }, ref) {
    // A stable, selector-safe container id per instance: two card forms can be
    // mounted at once (e.g. a page that offers both), and attach() takes a
    // CSS selector, so useId's colons are unusable here.
    const containerId = useRef(`square-card-${Math.random().toString(36).slice(2, 10)}`);
    const cardRef = useRef<SquareCard | null>(null);

    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [config, setConfig] = useState<SquareConfig | null>(null);

    useEffect(() => {
      let cancelled = false;

      const init = async () => {
        try {
          // Config first: the server decides sandbox vs production, and the
          // SDK bundle must match the credentials it will be used with.
          const cfg = await fetchSquareConfig(source);
          if (cancelled) return;
          setConfig(cfg);

          await loadSquareSdk(cfg.environment);
          if (cancelled) return;

          const card = await mountSquareCard(cfg, `#${containerId.current}`);
          if (cancelled) {
            void card.destroy().catch(() => {});
            return;
          }
          cardRef.current = card;
          setLoading(false);
          onReadyChange?.(true);
        } catch (err) {
          console.error('[SquareCardForm] init failed', err);
          if (cancelled) return;
          setError(err instanceof Error ? err.message : 'Could not load the card form');
          setLoading(false);
          onReadyChange?.(false);
        }
      };

      void init();

      return () => {
        cancelled = true;
        onReadyChange?.(false);
        cardRef.current?.destroy().catch(() => {});
        cardRef.current = null;
      };
      // onReadyChange is intentionally excluded: parents pass inline callbacks,
      // and re-running this effect would tear down and re-mount the iframe,
      // wiping whatever the customer has typed.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [source]);

    useImperativeHandle(
      ref,
      () => ({
        ready: !loading && !error && !!cardRef.current,
        tokenize: async () => {
          if (!cardRef.current) throw new Error('The card form is not ready yet.');
          return await tokenizeCard(cardRef.current);
        },
      }),
      [loading, error],
    );

    if (error) {
      return (
        <p className={`text-sm text-destructive ${className ?? ''}`}>
          {error}. Please refresh and try again, or call the box office.
        </p>
      );
    }

    return (
      <div className={className}>
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading secure card form…
          </div>
        )}
        <div
          id={containerId.current}
          className="min-h-[90px] bg-background border border-input rounded-md p-2"
        />
        {config?.environment === 'sandbox' && (
          <p className="text-sm text-muted-foreground mt-2">{SANDBOX_CARD_HINT}</p>
        )}
      </div>
    );
  },
);
