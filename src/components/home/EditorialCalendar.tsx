import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Film, Sparkles, Music, Calendar as CalendarIcon, ArrowRight } from 'lucide-react';
import { addDays, isThisWeek } from 'date-fns';
import { cn } from '@/lib/utils';
import { GREEN_CTA } from '@/lib/greenCta';
import { formatShowtime, toVenueWallClock, venueDayKey } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';
import type { FeedItem } from './TrailerFeed';
import { htmlToPlainText } from '@/lib/richText';

const TYPE_ICON = {
  movie: Film,
  event: Sparkles,
  concert: Music,
} as const;

function dayLabel(iso: string) {
  // Relative labels are relative to the venue's day, not the reader's — see
  // the note in formatWhen in ShowingPreview.tsx.
  const day = venueDayKey(iso);
  const now = new Date();
  if (day === venueDayKey(now)) return 'Tonight';
  if (day === venueDayKey(addDays(now, 1))) return 'Tomorrow';
  if (isThisWeek(toVenueWallClock(iso), { weekStartsOn: 0 })) return formatShowtime(iso, 'EEEE');
  return formatShowtime(iso, 'EEEE, MMMM d');
}

function dayKey(iso: string) {
  return venueDayKey(iso);
}

export function EditorialCalendar({
  items,
  onSelect,
  selectedId = null,
  compact = false,
}: {
  items: FeedItem[];
  onSelect?: (item: FeedItem) => void;
  /**
   * Row to mark as chosen. Only meaningful where the click feeds a preview
   * pane that stays on screen — a drawer is its own feedback.
   */
  selectedId?: string | null;
  /**
   * Drop the page-width chrome (outer padding, the closing address block) for
   * use inside a narrow split column, where they only steal width.
   */
  compact?: boolean;
}) {
  // Curator-controlled featured pick: prefer the earliest item flagged
  // is_featured. If nothing is flagged, fall back to the first chronological
  // item so the page never feels empty up top. The chronological calendar
  // below always shows every item in order, including the featured one.
  const featured =
    items.find((i) => i.isFeatured) ?? items[0];
  const rest = items.filter(
    (i) => !(featured && i.id === featured.id),
  );

  // Group rest by day
  const groups = new Map<string, FeedItem[]>();
  for (const item of rest) {
    const key = dayKey(item.startTime);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('max-w-[640px] mx-auto', compact ? 'py-2' : 'px-6 md:px-10 py-10')}>
        {/* Curator header */}
        <div className="mb-10">
          <p className="font-serif text-xs uppercase tracking-[0.3em] text-accent mb-3">
            A note from the booth
          </p>
          <h1 className="font-display text-4xl md:text-5xl leading-[0.95] mb-4">
            What we're watching this week
          </h1>
          <p className="font-serif text-muted-foreground">
            One screen, a hundred years of stories. Here's what's lighting up
            the marquee on Main Street.
          </p>
          <div className="marquee-rule mt-8" />
        </div>

        {/* Featured */}
        {featured && (
          <article className="mb-12">
            <p className="font-serif text-xs uppercase tracking-[0.25em] text-accent mb-3">
              {featured.isFeatured ? "Curator's pick" : 'Featured'} · {dayLabel(featured.startTime)}
            </p>
            <button
              type="button"
              onClick={() => onSelect?.(featured)}
              className="text-left w-full group"
            >
              {featured.posterUrl && (
                <div className="relative aspect-[16/10] overflow-hidden rounded-sm mb-4 bg-secondary">
                  <img
                    src={featured.posterUrl}
                    alt={featured.title}
                    className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-[1.02]"
                  />
                  <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
                </div>
              )}
              <h2 className="font-display text-3xl md:text-4xl leading-tight mb-2 group-hover:text-primary transition-colors">
                {featured.title}
              </h2>
              <p className="font-serif text-sm text-muted-foreground mb-2">
                {formatShowtime(featured.startTime, "EEEE, MMMM d 'at' h:mm a")}
              </p>
              {featured.curatorNote && (
                <p className="font-serif italic text-foreground/80 leading-relaxed">
                  {htmlToPlainText(featured.curatorNote)}
                </p>
              )}
            </button>
            {/* useFeed filters past showings out at query time, so this only
                bites in a tab left open across a start time — which is the one
                case where the page would otherwise sell a finished screening.
                The rule is src/lib/purchasable.ts. */}
            {featured.showingId && !isPast({ start_time: featured.startTime }) && (
              <div className="mt-4">
                <Button asChild className={cn('h-11', GREEN_CTA)}>
                  <Link to={`/showing/${featured.showingId}`}>
                    Get Tickets <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            )}
          </article>
        )}

        <div className="marquee-rule mb-10" />

        {/* Calendar listing */}
        <p className="font-serif text-xs uppercase tracking-[0.3em] text-accent mb-6">
          The calendar
        </p>

        {groups.size === 0 ? (
          <p className="font-serif italic text-muted-foreground">
            Nothing else on the books just yet.
          </p>
        ) : (
          <div className="space-y-8">
            {Array.from(groups.entries()).map(([key, dayItems]) => (
              <section key={key}>
                <h3 className="font-display text-xl tracking-wide text-foreground mb-3 pb-2 border-b border-border">
                  {dayLabel(dayItems[0].startTime)}
                  <span className="font-serif normal-case text-sm tracking-normal text-muted-foreground ml-2 lowercase">
                    {formatShowtime(dayItems[0].startTime, 'MMMM d')}
                  </span>
                </h3>
                <ul className="divide-y divide-border/60">
                  {dayItems.map((item) => {
                    const Icon = TYPE_ICON[item.type];
                    return (
                      <li key={`${item.id}-${item.showingId ?? 'no-show'}`}>
                        <button
                          type="button"
                          onClick={() => onSelect?.(item)}
                          aria-current={selectedId === item.id ? 'true' : undefined}
                          className={cn(
                            'w-full text-left py-4 flex items-start gap-4 group -mx-2 px-2 rounded-sm transition-colors min-h-[64px]',
                            // Hover stays styling only — picking a showing is a
                            // click, so a moused-over row must not read the
                            // same as the one actually chosen.
                            selectedId === item.id
                              ? 'bg-primary/10 ring-1 ring-primary/40'
                              : 'hover:bg-card/40',
                          )}
                        >
                          <div className="font-display text-2xl tabular-nums text-accent shrink-0 w-20">
                            {formatShowtime(item.startTime, 'h:mm')}
                            <span className="font-serif text-sm lowercase ml-0.5">
                              {formatShowtime(item.startTime, 'a')}
                            </span>
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <Icon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                              <span className="font-serif text-xs uppercase tracking-[0.2em] text-muted-foreground">
                                {item.type === 'movie' ? 'Film' : item.type === 'concert' ? 'Live' : 'Event'}
                              </span>
                              {item.ticketType === 'rsvp' && (
                                <Badge variant="outline" className="text-xs py-0">RSVP</Badge>
                              )}
                            </div>
                            <div className="font-display text-lg tracking-wide leading-snug group-hover:text-primary transition-colors">
                              {item.title}
                            </div>
                            {item.curatorNote && (
                              <p className="font-serif text-sm italic text-muted-foreground line-clamp-2 mt-1">
                                {htmlToPlainText(item.curatorNote)}
                              </p>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )}

        {!compact && (
          <>
            <div className="marquee-rule my-12" />

            <div className="text-center">
              <p className="font-serif text-xs uppercase tracking-[0.3em] text-muted-foreground mb-2">
                Visit the marquee
              </p>
              <p className="font-serif text-muted-foreground">
                508 S Main Street · Moscow, Idaho
              </p>
              <p className="font-serif text-sm text-muted-foreground/70 mt-2 italic">
                A century of stories, told one screening at a time.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}