import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, Volume2, VolumeX, Film, Sparkles, Music, Ticket } from 'lucide-react';
import { format } from 'date-fns';
import { resolveTrailer } from '@/lib/trailer';

export interface FeedItem {
  id: string;
  title: string;
  posterUrl: string | null;
  trailerUrl: string | null;
  startTime: string;          // ISO
  showingId: string | null;   // null when no purchasable showing yet
  type: 'movie' | 'event' | 'concert';
  ticketType?: string;        // for events
  rsvpUrl?: string | null;
  curatorNote?: string | null;
  isFeatured?: boolean;
}

const TYPE_ICON = {
  movie: Film,
  event: Sparkles,
  concert: Music,
} as const;

const TYPE_LABEL = {
  movie: 'Now Showing',
  event: 'Event',
  concert: 'Live on Stage',
} as const;

export function TrailerFeed({ items, onSelect }: { items: FeedItem[]; onSelect?: (item: FeedItem) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const slideRefs = useRef<Map<string, HTMLDivElement>>(new Map());
  const [activeId, setActiveId] = useState<string | null>(items[0]?.id ?? null);
  const [muted, setMuted] = useState(true);
  const [reduceMotion, setReduceMotion] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduceMotion(mq.matches);
    const handler = (e: MediaQueryListEvent) => setReduceMotion(e.matches);
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, []);

  // Track which slide is most-visible — only that one autoplays.
  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    const observer = new IntersectionObserver(
      (entries) => {
        // Pick the entry with the highest intersection ratio.
        let best: IntersectionObserverEntry | null = null;
        for (const e of entries) {
          if (!best || e.intersectionRatio > best.intersectionRatio) best = e;
        }
        if (best && best.intersectionRatio > 0.55) {
          const id = (best.target as HTMLElement).dataset.itemId;
          if (id) setActiveId(id);
        }
      },
      { root, threshold: [0.4, 0.55, 0.7, 0.9] },
    );
    slideRefs.current.forEach((el) => observer.observe(el));
    return () => observer.disconnect();
  }, [items]);

  if (items.length === 0) {
    return (
      <div className="h-full flex items-center justify-center p-8 text-center">
        <div>
          <Film className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
          <p className="font-serif text-muted-foreground">
            The marquee is dark for the moment. Check back soon for what's coming next.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative h-full">
      {/* Mute toggle, fixed within the rail */}
      <button
        type="button"
        onClick={() => setMuted((m) => !m)}
        className="absolute top-4 right-4 z-20 inline-flex h-11 w-11 items-center justify-center rounded-full bg-background/70 backdrop-blur-md ring-1 ring-border hover:ring-primary transition-colors"
        aria-label={muted ? 'Unmute trailer' : 'Mute trailer'}
      >
        {muted ? <VolumeX className="h-5 w-5" /> : <Volume2 className="h-5 w-5 text-primary" />}
      </button>

      <div
        ref={containerRef}
        className="snap-feed h-full overflow-y-auto"
      >
        {items.map((item) => {
          const Icon = TYPE_ICON[item.type];
          const isActive = item.id === activeId;
          const trailer = resolveTrailer(item.trailerUrl, {
            autoplay: !reduceMotion && isActive,
            muted,
          });

          return (
            <div
              key={item.id}
              data-item-id={item.id}
              ref={(el) => {
                if (el) slideRefs.current.set(item.id, el);
                else slideRefs.current.delete(item.id);
              }}
              className="relative w-full overflow-hidden bg-black flex items-center justify-center min-h-[560px] lg:min-h-full lg:h-full"
            >
              {/* Media layer */}
              {/* Blurred backdrop fills the rail edge-to-edge so the
                  contained poster has something to sit against without
                  being stretched. */}
              {item.posterUrl && !(trailer && !reduceMotion) && (
                <img
                  src={item.posterUrl}
                  alt=""
                  aria-hidden="true"
                  className="absolute inset-0 h-full w-full object-cover scale-110 blur-2xl opacity-40"
                />
              )}

              <div className="relative w-full">
                {trailer && !reduceMotion ? (
                  trailer.kind === 'file' ? (
                    <video
                      key={`${item.id}-${isActive}-${muted}`}
                      src={trailer.src}
                      autoPlay={isActive}
                      muted={muted}
                      loop
                      playsInline
                      poster={item.posterUrl ?? undefined}
                      className="w-full h-auto max-h-[80vh] object-contain bg-black"
                    />
                  ) : (
                    <div className="w-full aspect-video bg-black">
                      <iframe
                        key={`${item.id}-${isActive}-${muted}`}
                        src={trailer.src}
                        title={`${item.title} trailer`}
                        allow="autoplay; encrypted-media; picture-in-picture"
                        allowFullScreen
                        className="h-full w-full pointer-events-none"
                      />
                    </div>
                  )
                ) : item.posterUrl ? (
                  <img
                    src={item.posterUrl}
                    alt={item.title}
                    className="relative block w-full h-auto max-h-[85vh] object-contain mx-auto"
                  />
                ) : (
                  <div className="h-[60vh] w-full flex items-center justify-center bg-secondary">
                    <Icon className="h-20 w-20 text-muted-foreground" />
                  </div>
                )}
              </div>

              {/* Gradient scrim for legibility */}
              <div className="absolute inset-0 bg-gradient-to-t from-black via-black/60 to-black/10 pointer-events-none" />
              <div className="absolute inset-x-0 top-0 h-32 bg-gradient-to-b from-black/70 to-transparent pointer-events-none" />

              {/* Top label */}
              <div className="absolute top-4 left-4 z-10 flex items-center gap-2">
                <Badge variant="outline" className="border-accent/60 text-accent bg-black/40 backdrop-blur-sm uppercase tracking-widest text-[10px]">
                  <Icon className="h-3 w-3 mr-1" /> {TYPE_LABEL[item.type]}
                </Badge>
              </div>

              {/* Content overlay */}
              <div className="absolute inset-x-0 bottom-0 z-10 p-6 md:p-8 text-white">
                <div className="font-serif text-xs uppercase tracking-[0.25em] text-accent mb-2">
                  {format(new Date(item.startTime), 'EEEE, MMMM d · h:mm a')}
                </div>
                <h2 className="font-display text-4xl md:text-5xl leading-[0.95] mb-3 drop-shadow-lg">
                  {item.title}
                </h2>
                {item.curatorNote && (
                  <p className="font-serif italic text-white/80 mb-4 max-w-md line-clamp-2">
                    "{item.curatorNote}"
                  </p>
                )}
                <div className="flex flex-wrap items-center gap-2">
                  {item.ticketType === 'rsvp' && item.rsvpUrl ? (
                    <Button asChild size="lg" className="h-12">
                      <a href={item.rsvpUrl} target="_blank" rel="noopener noreferrer">
                        <Calendar className="h-4 w-4 mr-1" /> RSVP
                      </a>
                    </Button>
                  ) : item.ticketType === 'info_only' ? (
                    <Button
                      size="lg"
                      variant="outline"
                      className="h-12 bg-black/40 border-white/40 text-white hover:bg-white hover:text-black"
                      onClick={() => onSelect?.(item)}
                    >
                      Learn More
                    </Button>
                  ) : item.showingId ? (
                    <Button asChild size="lg" className="h-12">
                      <Link to={`/showing/${item.showingId}`}>
                        <Ticket className="h-4 w-4 mr-1" /> Get Tickets
                      </Link>
                    </Button>
                  ) : null}
                  <Button
                    size="lg"
                    variant="outline"
                    className="h-12 bg-black/40 border-white/40 text-white hover:bg-white hover:text-black"
                    onClick={() => onSelect?.(item)}
                  >
                    Details
                  </Button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}