import { useMemo, useState } from 'react';
import { format, parseISO, isToday, isTomorrow } from 'date-fns';
import { List as ListIcon, Calendar as CalendarIcon, Film, Sparkles, Music, Ticket, PlayCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { MonthCalendar } from './MonthCalendar';
import type { FeedItem } from './TrailerFeed';

const TYPE_ICON = { movie: Film, event: Sparkles, concert: Music } as const;
const TYPE_LABEL = { movie: 'Film', event: 'Event', concert: 'Live' } as const;

function formatWhen(iso: string) {
  const d = parseISO(iso);
  if (isToday(d)) return `Tonight · ${format(d, 'h:mm a')}`;
  if (isTomorrow(d)) return `Tomorrow · ${format(d, 'h:mm a')}`;
  return format(d, 'EEE, MMM d · h:mm a');
}

export function UpcomingList({
  items,
  onSelect,
}: {
  items: FeedItem[];
  onSelect?: (item: FeedItem) => void;
}) {
  // Only dated upcoming items in the list; cap to keep it scannable.
  const dated = useMemo(
    () => items.filter((i) => i.showingId).slice(0, 20),
    [items],
  );
  const [activeId, setActiveId] = useState<string | null>(dated[0]?.id ?? null);
  const [view, setView] = useState<'list' | 'calendar'>('list');

  const active = dated.find((i) => i.id === activeId) ?? dated[0] ?? null;

  const handleCalendarPick = (item: FeedItem) => {
    // From the calendar view, picking a title opens its detail drawer.
    onSelect?.(item);
  };

  if (dated.length === 0) return null;

  return (
    <section className="border-t border-b border-accent/20 bg-background">
      <div className="container py-10 md:py-14">
        <div className="flex items-end justify-between mb-6 gap-4 flex-wrap">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2">
              What's Playing
            </p>
            <h2 className="font-display text-3xl md:text-4xl uppercase tracking-wide">
              Upcoming
            </h2>
            <p className="font-serif text-sm text-muted-foreground mt-1">
              Pick a showing on the left to preview it.
            </p>
          </div>
          <div
            role="tablist"
            aria-label="Choose view"
            className="inline-flex items-center rounded-md border border-accent/30 bg-card p-1"
          >
            <Button
              type="button"
              role="tab"
              aria-selected={view === 'list'}
              variant={view === 'list' ? 'default' : 'ghost'}
              size="sm"
              className="gap-2 h-8"
              onClick={() => setView('list')}
            >
              <ListIcon className="h-4 w-4" />
              List
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={view === 'calendar'}
              variant={view === 'calendar' ? 'default' : 'ghost'}
              size="sm"
              className="gap-2 h-8"
              onClick={() => setView('calendar')}
            >
              <CalendarIcon className="h-4 w-4" />
              Calendar
            </Button>
          </div>
        </div>

        {view === 'calendar' ? (
          <MonthCalendar items={items} onSelect={handleCalendarPick} />
        ) : (
        <div className="grid lg:grid-cols-[1fr_1.2fr] gap-6 lg:gap-10">
          {/* List */}
          <ul className="space-y-2 lg:max-h-[560px] lg:overflow-y-auto lg:pr-2">
            {dated.map((it) => {
              const Icon = TYPE_ICON[it.type];
              const selected = active?.id === it.id;
              return (
                <li key={it.id} id={`upcoming-${it.id}`}>
                  <button
                    type="button"
                    onClick={() => setActiveId(it.id)}
                    onMouseEnter={() => setActiveId(it.id)}
                    className={cn(
                      'w-full text-left rounded-md border p-3 md:p-4 transition-colors flex items-start gap-3 group',
                      selected
                        ? 'border-primary bg-primary/10'
                        : 'border-accent/20 bg-card hover:border-primary/60 hover:bg-primary/5',
                    )}
                  >
                    <div className="font-display text-base md:text-lg text-accent w-20 shrink-0 tabular-nums leading-tight">
                      <div>{format(parseISO(it.startTime), 'MMM d')}</div>
                      <div className="text-xs text-muted-foreground">
                        {format(parseISO(it.startTime), 'h:mm a')}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-muted-foreground mb-1">
                        <Icon className="w-3 h-3" />
                        {TYPE_LABEL[it.type]}
                      </div>
                      <div
                        className={cn(
                          'font-serif text-base md:text-lg leading-snug truncate',
                          selected ? 'text-primary' : 'group-hover:text-primary',
                        )}
                      >
                        {it.title}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Preview */}
          {active && (
            <div className="lg:sticky lg:top-4 lg:self-start">
              <div className="rounded-lg border border-accent/20 bg-card overflow-hidden">
                <div className="relative aspect-[16/10] bg-muted">
                  {active.posterUrl ? (
                    <img
                      src={active.posterUrl}
                      alt={active.title}
                      className="w-full h-full object-cover"
                      loading="lazy"
                    />
                  ) : (
                    <div className="w-full h-full flex items-center justify-center text-muted-foreground font-serif italic">
                      No artwork yet
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent pointer-events-none" />
                  {active.isFeatured && (
                    <Badge className="absolute top-3 left-3 bg-primary text-primary-foreground">
                      Featured
                    </Badge>
                  )}
                </div>
                <div className="p-5 md:p-6">
                  <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2">
                    {formatWhen(active.startTime)}
                  </p>
                  <h3 className="font-display text-2xl md:text-3xl uppercase tracking-wide leading-tight mb-3">
                    {active.title}
                  </h3>
                  {active.curatorNote && (
                    <p className="font-serif text-sm md:text-base text-muted-foreground line-clamp-5 mb-5">
                      {active.curatorNote}
                    </p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => onSelect?.(active)} className="gap-2">
                      <Ticket className="h-4 w-4" />
                      View details
                    </Button>
                    {active.trailerUrl && (
                      <Button
                        variant="outline"
                        onClick={() => onSelect?.(active)}
                        className="gap-2"
                      >
                        <PlayCircle className="h-4 w-4" />
                        Watch trailer
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
        )}
      </div>
    </section>
  );
}