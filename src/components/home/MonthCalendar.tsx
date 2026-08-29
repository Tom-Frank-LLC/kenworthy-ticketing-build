import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { format, isSameDay, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight, Film, Sparkles, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatShowtime, venueDayKey } from '@/lib/datetime';
import {
  type CalendarView,
  anchorView,
  canStepBack,
  isShadedMonth,
  monthDividers,
  monthFloor,
  stepView,
  viewDays,
  viewLabel,
  weekStart,
} from '@/lib/calendarWindow';
import type { FeedItem } from './TrailerFeed';

const TYPE_ICON = {
  movie: Film,
  event: Sparkles,
  concert: Music,
} as const;

const TYPE_LABEL = {
  movie: 'Film',
  event: 'Event',
  concert: 'Live',
} as const;

export function MonthCalendar({
  items,
  onSelect,
  // The home page's Upcoming section renders its own view-aware helper line
  // above this grid, so it opts out rather than stacking a second one. The
  // /calendar page has no such line and keeps this on.
  showHint = true,
}: {
  items: FeedItem[];
  onSelect?: (item: FeedItem) => void;
  showHint?: boolean;
}) {
  // Group dated items by yyyy-MM-dd for instant per-day lookups.
  const byDay = useMemo(() => {
    const map = new Map<string, FeedItem[]>();
    for (const item of items) {
      if (!item.showingId) continue; // skip standalone RSVPs in the grid
      // Keyed on the venue's calendar day: a 9 PM show is still tonight, even
      // for a viewer whose own clock has already rolled past midnight.
      const key = venueDayKey(item.startTime);
      const bucket = map.get(key) ?? [];
      bucket.push(item);
      map.set(key, bucket);
    }
    return map;
  }, [items]);

  // The earliest month the arrows reach. `useFeed` fetches showings with
  // `.gte('start_time', now)`, so everything before the current month is
  // guaranteed empty and there is nothing back there to page to.
  const floor = useMemo(() => monthFloor(new Date()), []);

  const dayKeys = useMemo(() => [...byDay.keys()].sort(), [byDay]);

  // Opens week-anchored on the current week, then switches to month navigation
  // the moment the reader pages. `anchorView` only moves off the current week
  // if the next six weeks are completely empty, which for a venue that
  // programmes weekly means it opens on the current week in every real case.
  const [view, setView] = useState<CalendarView>(() =>
    anchorView({ mode: 'week', start: weekStart(new Date()) }, dayKeys, floor),
  );

  // Opens on today so the panel beside the grid is populated on a night we
  // have something on; otherwise on the first upcoming day, which is the
  // nearest day that has anything to show.
  const [selectedDay, setSelectedDay] = useState<Date>(() => {
    const today = new Date();
    if (byDay.has(format(today, 'yyyy-MM-dd'))) return today;
    const firstKey = [...byDay.keys()].sort()[0];
    if (!firstKey) return today;
    const [y, m, d] = firstKey.split('-').map(Number);
    return new Date(y, m - 1, d);
  });

  // Follow the results when a search leaves nothing in view. Keyed on the set
  // of populated days rather than on `items` identity, so this fires when the
  // filter actually changes something and not when the caller re-renders — and
  // it never yanks a view the reader paged to themselves, because `anchorView`
  // stays put whenever the current grid holds anything.
  const dayKeySignature = dayKeys.join(',');
  const lastSignature = useRef(dayKeySignature);
  useEffect(() => {
    if (lastSignature.current === dayKeySignature) return;
    lastSignature.current = dayKeySignature;
    setView((current) => {
      const next = anchorView(current, dayKeys, floor);
      return isSameDay(next.start, current.start) && next.mode === current.mode ? current : next;
    });
  }, [dayKeySignature, dayKeys, floor]);

  const days = useMemo(() => viewDays(view), [view]);
  const dividers = useMemo(() => monthDividers(days, view), [days, view]);
  const canGoBack = canStepBack(view, floor);

  // Keep the panel on a day the grid is actually showing. Paging to another
  // month otherwise leaves it describing a day that scrolled out of view — and
  // a search that re-anchored would show "Nothing on the marquee" beside a grid
  // full of matches. Whether the old day still has showings is not the
  // question; whether it is on screen is.
  useEffect(() => {
    if (days.some((d) => isSameDay(d, selectedDay))) return;
    const firstWithItems = days.find((d) => byDay.has(format(d, 'yyyy-MM-dd')));
    setSelectedDay(firstWithItems ?? days[0]);
  }, [days, byDay, selectedDay]);

  const selectedKey = format(selectedDay, 'yyyy-MM-dd');
  const selectedItems = byDay.get(selectedKey) ?? [];

  return (
    <section className="border-t border-b border-accent/20 bg-background">
      <div className="container py-10 md:py-14">
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          {/* No heading here: both callers (the /calendar page and the home
              page's Upcoming section) already render their own title above
              this grid, so one of our own stacked a second "Calendar" under
              it. Only the helper line stays. */}
          {showHint ? (
            <div>
              <p className="font-serif text-sm text-muted-foreground">
                Click on a day to see what's playing
              </p>
            </div>
          ) : (
            <div />
          )}
          <div className="flex items-center gap-2">
            {/* Labelled by destination rather than "previous/next month": from
                the opening week view, back goes to the current month and
                forward to the next one, and "previous month" would name
                neither. */}
            <Button
              variant="outline"
              size="icon"
              disabled={!canGoBack}
              onClick={() => setView((v) => stepView(v, -1, floor))}
              aria-label={`Go to ${viewLabel(stepView(view, -1, floor))}`}
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            {/* Wide enough for the longest label either mode produces without
                the arrows shifting as the reader pages. */}
            <div className="font-display text-xl uppercase tracking-wider min-w-[16ch] text-center">
              {viewLabel(view)}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setView((v) => stepView(v, 1, floor))}
              aria-label={`Go to ${viewLabel(stepView(view, 1, floor))}`}
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="flex flex-col lg:flex-row gap-8 lg:items-start">
          {/* Month grid. Not shrink-0: the cells are minmax(0,132px) and can
              give up width, and the preview panel beside them needs a usable
              minimum more than the grid needs its full 132px. */}
          <div className="lg:min-w-0">
            <div className="grid grid-cols-7 md:grid-cols-[repeat(7,minmax(0,132px))] justify-start gap-1 md:gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="px-2 py-1 text-center">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 md:grid-cols-[repeat(7,minmax(0,132px))] justify-start gap-1 md:gap-2">
              {days.map((day, index) => {
                const key = format(day, 'yyyy-MM-dd');
                const heading = dividers.get(index);
                const dayItems = byDay.get(key) ?? [];
                // No single "current month" any more, so the old in/out-of-month
                // dimming has nothing to mean. Alternate months get a light band
                // instead, which keeps the boundary legible without pushing any
                // day's text to a fainter colour.
                const shaded = isShadedMonth(day);
                const selected = isSameDay(day, selectedDay);
                const today = isToday(day);
                const hasItems = dayItems.length > 0;

                // Fixed, uniform cells: empty or full, every day is the same box.
                // The height is rem, not px, so the box tracks the type inside it.
                // As px it did not: raising the root font size grew the event
                // chips and left the cell the same size, which cut the last one
                // off mid-line. 6.25/9.375rem are the old 112/168px at the root
                // this was drawn against, so the grid looks unchanged and now
                // scales with browser zoom and OS large-text too.
                const sorted = dayItems
                  .slice()
                  .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

                return (
                  <Fragment key={key}>
                  {/* Full-width month heading. Every row here is exactly seven
                      cells, so a col-span-7 child always lands cleanly on its
                      own row. */}
                  {heading && (
                    <div className="col-span-7 flex items-center gap-3 mt-2 first:mt-0">
                      <span className="font-display text-sm uppercase tracking-[0.2em] text-accent whitespace-nowrap">
                        {heading}
                      </span>
                      <span className="h-px flex-1 bg-accent/20" />
                    </div>
                  )}
                  <div
                    role="button"
                    tabIndex={0}
                    onClick={() => setSelectedDay(day)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedDay(day);
                      }
                    }}
                    className={cn(
                      'relative h-[6.25rem] md:h-[9.375rem] rounded-md border text-left p-1 md:p-2 transition-colors flex flex-col overflow-hidden cursor-pointer',
                      'hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      'border-accent/20',
                      shaded ? 'bg-muted' : 'bg-card',
                      selected && 'border-primary bg-primary/10 ring-1 ring-primary',
                      today && !selected && 'border-accent/60',
                    )}
                  >
                    <div className="flex items-center justify-between shrink-0">
                      <span className={cn(
                        'font-display text-sm md:text-base',
                        today && 'text-accent',
                      )}>
                        {format(day, 'd')}
                      </span>
                      {hasItems && (
                        <span className="hidden md:inline-block text-xs font-semibold px-1.5 rounded-full bg-primary text-primary-foreground">
                          {dayItems.length}
                        </span>
                      )}
                    </div>

                    {/* Mobile: compact dots (grid is too narrow for text). */}
                    {hasItems && (
                      <div className="mt-auto flex flex-wrap gap-0.5 md:hidden">
                        {sorted.slice(0, 4).map((it) => (
                          <span
                            key={it.id}
                            className={cn(
                              'rounded-full w-1.5 h-1.5',
                              it.type === 'movie' && 'bg-primary',
                              it.type === 'event' && 'bg-accent',
                              it.type === 'concert' && 'bg-foreground',
                            )}
                          />
                        ))}
                        {dayItems.length > 4 && (
                          <span className="text-xs text-muted-foreground leading-none">+{dayItems.length - 4}</span>
                        )}
                      </div>
                    )}

                    {/* md+: title only. The cell already says which day this is,
                        so both of the lines that used to sit here just restated
                        it — the showtime, and the description, which is written
                        starting "Tuesday, August 18 at 1 PM..." and so spent the
                        grid's two scarcest lines repeating the day number above
                        it. Titles get that room instead. Time and description
                        both still show in the selected-day panel and the detail
                        drawer, one tap away. */}
                    {hasItems && (
                      <div className="mt-1 hidden md:flex flex-col gap-1 overflow-hidden">
                        {sorted.slice(0, 2).map((it) => (
                          <button
                            key={it.id}
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              onSelect?.(it);
                            }}
                            className={cn(
                              'text-left pl-1.5 border-l-2 group/ev',
                              it.type === 'movie' && 'border-primary',
                              it.type === 'event' && 'border-accent',
                              it.type === 'concert' && 'border-foreground',
                            )}
                          >
                            {/* Two lines at `md`, three from `lg`. The clamp has to
                                follow the column width: at 768 these cells are only
                                ~66px wide, so a title runs to three lines and two of
                                them plus the "+N more" line overflow the cell and get
                                cut mid-word. From `lg` the column is wide enough that
                                three lines still fit. */}
                            <div className="font-serif text-sm leading-tight line-clamp-2 lg:line-clamp-3 group-hover/ev:text-primary transition-colors">
                              {it.title}
                            </div>
                          </button>
                        ))}
                        {dayItems.length > 2 && (
                          <span className="text-sm italic text-muted-foreground pl-1.5">
                            +{dayItems.length - 2} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                  </Fragment>
                );
              })}
            </div>
            {/* Legend shows only the types actually on the calendar. */}
            <div className="flex items-center gap-4 mt-4 text-sm text-muted-foreground">
              {([
                ['movie', 'Film', 'bg-primary'],
                ['event', 'Event', 'bg-accent'],
                ['concert', 'Live', 'bg-foreground'],
              ] as const)
                .filter(([type]) => items.some((i) => i.showingId && i.type === type))
                .map(([type, label, dot]) => (
                  <span key={type} className="inline-flex items-center gap-1.5">
                    <span className={cn('w-2 h-2 rounded-full', dot)} /> {label}
                  </span>
                ))}
            </div>
          </div>

          {/* Selected day list */}
          <div className="lg:flex-1 lg:min-w-[16rem] lg:border-l lg:border-accent/20 lg:pl-8">
            <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2">
              {isToday(selectedDay) ? 'Tonight' : format(selectedDay, 'EEEE')}
            </p>
            <h3 className="font-display text-2xl uppercase tracking-wide mb-4">
              {format(selectedDay, 'MMMM d')}
            </h3>
            {selectedItems.length === 0 ? (
              <p className="font-serif text-sm text-muted-foreground italic">
                Nothing on the marquee this day.
              </p>
            ) : (
              <ul className="space-y-2">
                {selectedItems
                  .slice()
                  .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
                  .map((it) => {
                    const Icon = TYPE_ICON[it.type];
                    return (
                      <li key={it.id}>
                        <button
                          type="button"
                          onClick={() => onSelect?.(it)}
                          className="w-full text-left rounded-md border border-accent/20 bg-card hover:border-primary hover:bg-primary/5 transition-colors p-3 flex items-start gap-3 group lg:flex-col lg:items-stretch"
                        >
                          {it.posterUrl ? (
                            <img
                              src={it.posterUrl}
                              alt=""
                              loading="lazy"
                              className="w-14 h-20 shrink-0 object-cover rounded bg-muted lg:w-full lg:h-auto lg:aspect-[2/3]"
                            />
                          ) : (
                            <div className="w-14 h-20 shrink-0 rounded bg-muted flex items-center justify-center lg:w-full lg:h-auto lg:aspect-[2/3]">
                              <Icon className="w-5 h-5 text-muted-foreground lg:w-8 lg:h-8" />
                            </div>
                          )}
                          <div className="flex-1 min-w-0 lg:flex-none lg:w-full">
                            <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-0.5">
                              <Icon className="w-3 h-3" />
                              {TYPE_LABEL[it.type]}
                            </div>
                            <div className="font-display text-lg text-accent tabular-nums leading-none">
                              {formatShowtime(it.startTime, 'h:mm a')}
                            </div>
                            <div className="font-serif text-base leading-snug mt-1 group-hover:text-primary transition-colors">
                              {it.title}
                            </div>
                            {typeof it.ticketPrice === 'number' && it.ticketPrice > 0 && (
                              <div className="text-sm text-muted-foreground mt-1">
                                ${it.ticketPrice.toFixed(2)}
                              </div>
                            )}
                          </div>
                        </button>
                      </li>
                    );
                  })}
              </ul>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}