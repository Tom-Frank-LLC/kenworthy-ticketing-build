import { Badge } from '@/components/ui/badge';
import { Film, Sparkles, Music } from 'lucide-react';
import { addDays, isThisWeek } from 'date-fns';
import { cn } from '@/lib/utils';
import { formatShowtime, toVenueWallClock, venueDayKey } from '@/lib/datetime';
import type { FeedItem } from './TrailerFeed';
import { isRichTextEmpty } from '@/lib/richText';
import { RichText } from '@/components/RichText';

const TYPE_ICON = {
  movie: Film,
  event: Sparkles,
  concert: Music,
} as const;

export function dayLabel(iso: string) {
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
  // Every showing, grouped by day. The curator's pick used to be lifted out of
  // this list and rendered above it, which meant the featured film was the one
  // film missing from the page whose job is to list them all. That block moved
  // to the home page (BoothNote), so nothing is held back here.
  const groups = new Map<string, FeedItem[]>();
  for (const item of items) {
    const key = dayKey(item.startTime);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(item);
  }

  return (
    <div className="h-full overflow-y-auto">
      <div className={cn('max-w-[640px] mx-auto', compact ? 'py-2' : 'px-6 md:px-10 py-10')}>
        {/* Calendar listing */}
        <p className="font-serif text-xs uppercase tracking-[0.3em] text-accent mb-6">
          Upcoming
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
                        {/* The row is a container with the control laid over
                            it, not a `<button>` wrapping its own contents.

                            The note below is a description written in the
                            admin editor, so it can carry `<a>` and block
                            elements, and an `<a>` inside a `<button>` is
                            invalid HTML that browsers recover from
                            unpredictably. Lifting the button out to an overlay
                            keeps the whole row clickable and keyboard
                            reachable while leaving the copy as ordinary
                            markup — which is what lets it render formatted
                            here rather than flattened.

                            `relative` anchors the overlay; `group` still lives
                            on this element, so the title's hover colour works
                            off a pointer anywhere in the row. */}
                        <div
                          className={cn(
                            'relative text-left py-4 flex items-start gap-4 group -mx-2 px-2 rounded-sm transition-colors min-h-[64px]',
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
                              {/* This row opens a drawer rather than offering
                                  a ticket, so there is no CTA here to reword —
                                  the badge is the only place the calendar can
                                  say that a night costs nothing and needs no
                                  booking. Same slot as RSVP, which answers the
                                  neighbouring question. */}
                              {item.noTicketRequired && (
                                <Badge
                                  variant="outline"
                                  className="text-xs py-0 border-success/60 text-success"
                                >
                                  Free · no ticket
                                </Badge>
                              )}
                            </div>
                            <div className="font-display text-lg tracking-wide leading-snug group-hover:text-primary transition-colors">
                              {item.title}
                            </div>
                            {/* Two lines of the real thing. `rich-text-teaser`
                                strips the block margins so `line-clamp` can
                                still count line boxes — see the note on the
                                variant in index.css — which is what keeps the
                                row at the height it has always had while bold,
                                emphasis and bullets survive. */}
                            {!isRichTextEmpty(item.curatorNote) && (
                              <RichText
                                html={item.curatorNote}
                                className="rich-text-teaser font-serif text-sm italic text-muted-foreground line-clamp-2 mt-1"
                              />
                            )}
                          </div>

                          {/* Last in the row so it stacks above the copy, and
                              so the reading order is still time, title, note.
                              `inset-0` makes the whole row the hit area the
                              wrapping button used to be. Its label is the
                              title alone: as a wrapper its accessible name was
                              the entire row read out as one run-on string. */}
                          <button
                            type="button"
                            onClick={() => onSelect?.(item)}
                            aria-current={selectedId === item.id ? 'true' : undefined}
                            aria-label={`Details for ${item.title}`}
                            className="absolute inset-0 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background"
                          />
                        </div>
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
                A century of stories, shared one showing at a time.
              </p>
            </div>
          </>
        )}
      </div>
    </div>
  );
}