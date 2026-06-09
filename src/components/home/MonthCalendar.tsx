import { useMemo, useState } from 'react';
import {
  addMonths,
  endOfMonth,
  endOfWeek,
  format,
  isSameDay,
  isSameMonth,
  isToday,
  parseISO,
  startOfMonth,
  startOfWeek,
  subMonths,
} from 'date-fns';
import { ChevronLeft, ChevronRight, Film, Sparkles, Music } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
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
}: {
  items: FeedItem[];
  onSelect?: (item: FeedItem) => void;
}) {
  // Anchor the visible month to the first upcoming dated item, falling back
  // to today so the calendar never opens on an empty month.
  const firstDated = items.find((i) => i.showingId);
  const initial = firstDated ? parseISO(firstDated.startTime) : new Date();

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
      const key = format(parseISO(item.startTime), 'yyyy-MM-dd');
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
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2">
              What's Playing
            </p>
            <h2 className="font-display text-3xl md:text-4xl uppercase tracking-wide">
              Calendar
            </h2>
            <p className="font-serif text-sm text-muted-foreground mt-1">
              Tap a day to see what's on. Tap a title for tickets and details.
            </p>
          </div>
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

        <div className="grid lg:grid-cols-[2fr_1fr] gap-8">
          {/* Month grid */}
          <div>
            <div className="grid grid-cols-7 text-xs uppercase tracking-widest text-muted-foreground mb-2">
              {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
                <div key={d} className="px-2 py-1 text-center">{d}</div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1 md:gap-2">
              {days.map((day) => {
                const key = format(day, 'yyyy-MM-dd');
                const dayItems = byDay.get(key) ?? [];
                const inMonth = isSameMonth(day, cursor);
                const selected = isSameDay(day, selectedDay);
                const today = isToday(day);
                const hasItems = dayItems.length > 0;

                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setSelectedDay(day)}
                    className={cn(
                      'relative aspect-square md:aspect-[4/3] rounded-md border text-left p-1.5 md:p-2 transition-colors flex flex-col',
                      'hover:border-primary/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                      inMonth ? 'border-accent/20 bg-card' : 'border-transparent bg-muted/20 text-muted-foreground/60',
                      selected && 'border-primary bg-primary/10 ring-1 ring-primary',
                      today && !selected && 'border-accent/60',
                    )}
                  >
                    <div className="flex items-center justify-between">
                      <span className={cn(
                        'font-display text-sm md:text-base',
                        today && 'text-accent',
                      )}>
                        {format(day, 'd')}
                      </span>
                      {hasItems && (
                        <span className="text-[10px] font-semibold px-1.5 rounded-full bg-primary text-primary-foreground hidden md:inline-block">
                          {dayItems.length}
                        </span>
                      )}
                    </div>
                    {hasItems && (
                      <div className="mt-auto flex flex-wrap gap-0.5 md:gap-1">
                        {dayItems.slice(0, 3).map((it) => {
                          const Icon = TYPE_ICON[it.type];
                          return (
                            <span
                              key={it.id}
                              className={cn(
                                'inline-flex items-center justify-center rounded-full w-1.5 h-1.5 md:w-2 md:h-2',
                                it.type === 'movie' && 'bg-primary',
                                it.type === 'event' && 'bg-accent',
                                it.type === 'concert' && 'bg-foreground',
                              )}
                            >
                              <Icon className="hidden" />
                            </span>
                          );
                        })}
                        {dayItems.length > 3 && (
                          <span className="text-[10px] text-muted-foreground">+{dayItems.length - 3}</span>
                        )}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-primary" /> Film
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-accent" /> Event
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-foreground" /> Live
              </span>
            </div>
          </div>

          {/* Selected day list */}
          <div className="lg:border-l lg:border-accent/20 lg:pl-8">
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
                          className="w-full text-left rounded-md border border-accent/20 bg-card hover:border-primary hover:bg-primary/5 transition-colors p-3 flex items-start gap-3 group"
                        >
                          <div className="font-display text-lg text-accent w-16 shrink-0 tabular-nums">
                            {format(parseISO(it.startTime), 'h:mm a')}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground mb-0.5">
                              <Icon className="w-3 h-3" />
                              {TYPE_LABEL[it.type]}
                            </div>
                            <div className="font-serif text-base leading-snug group-hover:text-primary transition-colors">
                              {it.title}
                            </div>
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