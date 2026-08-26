import { useMemo, useState } from 'react';
import { List as ListIcon, Calendar as CalendarIcon, Film, Sparkles, Music, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { MonthCalendar } from './MonthCalendar';
import { ShowingPreview } from './ShowingPreview';
import { useIsSplitLayout } from '@/hooks/use-mobile';
import { formatShowtime } from '@/lib/datetime';
import type { FeedItem } from './TrailerFeed';

const TYPE_ICON = { movie: Film, event: Sparkles, concert: Music } as const;
const TYPE_LABEL = { movie: 'Film', event: 'Event', concert: 'Live' } as const;

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
  // Below `lg` the preview column stacks under the entire list, so its
  // "View details" button — the only route to tickets — sits a full screen of
  // scrolling below the row that was just tapped. There, open the detail
  // drawer directly instead.
  const splitLayout = useIsSplitLayout();

  const active = dated.find((i) => i.id === activeId) ?? dated[0] ?? null;

  const handleRowActivate = (item: FeedItem) => {
    if (splitLayout) {
      setActiveId(item.id);
      return;
    }
    onSelect?.(item);
  };

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
            {/* The helper line follows the view. In calendar view the old
                "on the left" wording pointed at a preview pane that is not
                rendered, and MonthCalendar stacked a second hint under it. */}
            <p className="font-serif text-sm text-muted-foreground mt-1">
              {view === 'calendar' ? (
                "Click on a day to see what's playing"
              ) : (
                <>
                  <span className="lg:hidden">Tap a showing for details and tickets.</span>
                  <span className="hidden lg:inline">Click a listing on the left for a preview.</span>
                </>
              )}
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
          <MonthCalendar items={items} onSelect={handleCalendarPick} showHint={false} />
        ) : (
        // The preview is itself two columns now (portrait poster + info), so it
        // needs more room than 1.2fr left it — at the old ratio the poster
        // squeezed the synopsis into a gutter.
        <div className="grid lg:grid-cols-[1fr_1.8fr] gap-6 lg:gap-10">
          {/* List */}
          {/* min-w-0: grid items default to min-width:auto, which let a long
              title push this column past the viewport (112px of horizontal
              scroll at 375px) and stopped the `truncate` below from ever
              engaging. */}
          <ul className="min-w-0 space-y-2 lg:max-h-[560px] lg:overflow-y-auto lg:pr-2">
            {dated.map((it) => {
              const Icon = TYPE_ICON[it.type];
              const selected = active?.id === it.id;
              return (
                <li key={it.id} id={`upcoming-${it.id}`}>
                  <button
                    type="button"
                    onClick={() => handleRowActivate(it)}
                    className={cn(
                      'w-full text-left rounded-md border p-3 md:p-4 transition-colors flex items-start gap-3 group',
                      selected
                        ? 'border-primary bg-primary/10'
                        : 'border-accent/20 bg-card hover:border-primary/60 hover:bg-primary/5',
                    )}
                  >
                    <div className="font-display text-base md:text-lg text-accent w-20 shrink-0 tabular-nums leading-tight">
                      <div>{formatShowtime(it.startTime, 'MMM d')}</div>
                      <div className="text-sm text-muted-foreground">
                        {formatShowtime(it.startTime, 'h:mm a')}
                      </div>
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground mb-1">
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
                    {/* Below lg the row opens a drawer, so it needs to read as
                        a way in rather than a selection. */}
                    <ChevronRight
                      className="h-5 w-5 shrink-0 self-center text-muted-foreground lg:hidden"
                      aria-hidden
                    />
                  </button>
                </li>
              );
            })}
          </ul>

          {/* Preview. The drawer replaces this pane below lg, where it was
              stranded underneath the full list — which is why `onSelect` is
              still threaded through this component even though the preview no
              longer takes it: the mobile row tap and the calendar pick are the
              two remaining callers. */}
          {active && (
            <ShowingPreview
              item={active}
              className="hidden min-w-0 lg:block lg:sticky lg:top-4 lg:self-start"
            />
          )}
        </div>
        )}
      </div>
    </section>
  );
}