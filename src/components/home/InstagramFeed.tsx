import { useEffect, useRef } from 'react';
import { Instagram } from 'lucide-react';

/**
 * Instagram feed embed.
 *
 * We use a third-party widget service (Behold / SnapWidget / EmbedSocial)
 * to render the @kenworthypac feed without needing Meta Graph API
 * credentials or per-user OAuth.
 *
 * Configure ONE of the following:
 *
 *   1. Behold:   set BEHOLD_FEED_ID below to your widget ID.
 *                Find it in your Behold dashboard URL after /widgets/.
 *
 *   2. SnapWidget / other: paste the full <iframe ...> snippet from the
 *      provider into RAW_EMBED_HTML below.
 *
 * Until one is configured, the component renders a tasteful placeholder
 * so the layout still reads correctly.
 */

// --- Configure here ---------------------------------------------------------
const BEHOLD_FEED_ID = '';   // e.g. 'aBcDeF12345'
const RAW_EMBED_HTML = '';   // e.g. '<iframe src="https://snapwidget.com/embed/..." ...></iframe>'
// ---------------------------------------------------------------------------

const INSTAGRAM_HANDLE = 'kenworthypac';

function BeholdEmbed({ feedId }: { feedId: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Behold loads its own widget script which scans the page for
    // <behold-widget> elements. We inject the script tag once.
    const existing = document.querySelector(
      'script[src^="https://w.behold.so/widget.js"]',
    );
    if (!existing) {
      const s = document.createElement('script');
      s.src = 'https://w.behold.so/widget.js';
      s.type = 'module';
      document.head.appendChild(s);
    }
  }, []);

  return (
    <div ref={containerRef} className="w-full">
      {/* @ts-expect-error — custom element from Behold script */}
      <behold-widget feed-id={feedId} />
    </div>
  );
}

function RawEmbed({ html }: { html: string }) {
  return (
    <div
      className="w-full [&_iframe]:w-full [&_iframe]:max-w-full"
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}

function PlaceholderFeed() {
  // 6 quiet tiles — enough to suggest a feed without pretending to be one.
  return (
    <div className="grid grid-cols-3 gap-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="aspect-square bg-accent/5 border border-accent/10 flex items-center justify-center"
        >
          <Instagram className="h-5 w-5 text-accent/30" />
        </div>
      ))}
    </div>
  );
}

export function InstagramFeed({ className = '' }: { className?: string }) {
  const hasEmbed = Boolean(BEHOLD_FEED_ID || RAW_EMBED_HTML);

  return (
    <aside className={`flex flex-col ${className}`}>
      <header className="px-4 pt-6 pb-3 border-b border-accent/15">
        <p className="text-[10px] uppercase tracking-[0.2em] text-accent/70 font-display">
          From the lobby
        </p>
        <a
          href={`https://instagram.com/${INSTAGRAM_HANDLE}`}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 flex items-center gap-2 text-foreground hover:text-primary transition-colors"
        >
          <Instagram className="h-4 w-4" />
          <span className="font-display text-lg tracking-wide">
            @{INSTAGRAM_HANDLE}
          </span>
        </a>
      </header>

      <div className="flex-1 overflow-y-auto p-4">
        {BEHOLD_FEED_ID ? (
          <BeholdEmbed feedId={BEHOLD_FEED_ID} />
        ) : RAW_EMBED_HTML ? (
          <RawEmbed html={RAW_EMBED_HTML} />
        ) : (
          <>
            <PlaceholderFeed />
            <p className="mt-4 font-serif text-xs italic text-muted-foreground leading-relaxed">
              Instagram feed loading soon. Until then, visit us on Instagram
              for marquee shots, trailers, and lobby photos.
            </p>
          </>
        )}
      </div>

      {hasEmbed && (
        <footer className="px-4 py-3 border-t border-accent/15">
          <a
            href={`https://instagram.com/${INSTAGRAM_HANDLE}`}
            target="_blank"
            rel="noopener noreferrer"
            className="font-serif text-xs italic text-muted-foreground hover:text-primary transition-colors"
          >
            Follow on Instagram →
          </a>
        </footer>
      )}
    </aside>
  );
}
