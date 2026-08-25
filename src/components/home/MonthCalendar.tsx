import { useMemo, useState } from 'react';
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Film, Sparkles, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatShowtime, toVenueWallClock, venueDayKey } from '@/lib/datetime';
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
  // Anchor the visible month to the first upcoming dated item, falling back
  // to today so the calendar never opens on an empty month.
  const firstDated = items.find((i) => i.showingId);
  // Shifted to the venue's wall clock so the grid below — which reads local
  // date fields off this Date — anchors on the day the show actually plays.
  const initial = firstDated ? toVenueWallClock(firstDated.startTime) : new Date();

  const [cursor, setCursor] = useState<Date>(startOfMonth(initial));
  const [selectedDay, setSelectedDay] = useState<Date>(initial);

  const monthStart = startOfMonth(cursor);
  const monthEnd = endOfMonth(cursor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 0 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 0 });

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

  const days: Date[] = [];
  for (let d = gridStart; d <= gridEnd; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    days.push(d);
  }

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
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCursor((c) => subMonths(c, 1))}
              aria-label="Previous month"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <div className="font-display text-xl uppercase tracking-wider min-w-[10ch] text-center">
              {format(cursor, 'MMMM yyyy')}
            </div>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setCursor((c) => addMonths(c, 1))}
              aria-label="Next month"
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
              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const dayItems = byDay.get(key) ?? [];
                const inMonth = isSameMonth(day, cursor);
                const selected = isSameDay(day, selectedDay);
                const today = isToday(day);
                const hasItems = dayItems.length > 0;

                // Fixed, uniform cells: empty or full, every day is the same box.
                const sorted = dayItems
                  .slice()
                  .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

                return (
                  <div
                    key={key}
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
                      'relative h-[112px] md:h-[168px] rounded-md border text-left p-1 md:p-2 transition-colors flex flex-col overflow-hidden cursor-pointer',
                      'hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      inMonth ? 'border-accent/20 bg-card' : 'border-transparent bg-muted/20 text-muted-foreground/75',
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
                            <div className="font-serif text-sm leading-tight line-clamp-3 group-hover/ev:text-primary transition-colors">
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