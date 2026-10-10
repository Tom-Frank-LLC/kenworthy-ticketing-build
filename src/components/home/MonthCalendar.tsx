import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { format, isSameDay, isSameMonth, isToday } from 'date-fns';
import { ChevronLeft, ChevronRight, Film, Sparkles, Music, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatShowtime, venueDayKey } from '@/lib/datetime';
import {
  type CalendarView,
  anchorView,
  calendarStart,
  canStepBack,
  isShadedMonth,
  monthDividers,
  monthFloor,
  monthsCovered,
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

/**
 * What plays on one day.
 *
 * Shared by the desktop side panel and the mobile inline accordion so the two
 * cannot drift — they are the same list read at two widths. The `lg:` variants
 * below are the desktop column's poster-on-top layout; the inline panel is
 * `lg:hidden`, so they never apply there.
 */
function DayShowings({
  items,
  onSelect,
}: {
  items: FeedItem[];
  onSelect?: (item: FeedItem) => void;
}) {
  if (items.length === 0) {
    return (
      <p className="font-serif text-sm text-muted-foreground italic">
        Nothing on the marquee this day.
      </p>
    );
  }

  return (
    <ul className="space-y-2">
      {items
        .slice()
        .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .map((it) => {
          const Icon = TYPE_ICON[it.type];
          // An ended showing is a record of what played, so it is drawn as
          // text, not as a button: there is nothing to open, and the drawer
          // behind the button is a way into checkout. The dashed border and
          // the "Ended" line carry the difference, not colour.
          const Row = it.ended ? 'div' : 'button';
          return (
            <li key={it.id}>
              <Row
                {...(it.ended ? {} : { type: 'button' as const, onClick: () => onSelect?.(it) })}
                className={cn(
                  'w-full text-left rounded-md border bg-card p-3 flex items-start gap-3 group lg:flex-col lg:items-stretch',
                  it.ended
                    ? 'border-dashed border-accent/40'
                    : 'border-accent/20 hover:border-primary hover:bg-primary/5 transition-colors',
                )}
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
                    {it.ended && (
                      <span className="ml-2 font-sans text-xs uppercase tracking-widest text-muted-foreground align-middle">
                        Ended
                      </span>
                    )}
                  </div>
                  <div
                    className={cn(
                      'font-serif text-base leading-snug mt-1',
                      !it.ended && 'group-hover:text-primary transition-colors',
                    )}
                  >
                    {it.title}
                  </div>
                  {!it.ended && typeof it.ticketPrice === 'number' && it.ticketPrice > 0 && (
                    <div className="text-sm text-muted-foreground mt-1">
                      ${it.ticketPrice.toFixed(2)}
                    </div>
                  )}
                </div>
              </Row>
            </li>
          );
        })}
    </ul>
  );
}

/** "March 4", or "March 4, 2023" once the reader has paged out of this year. */
function dayHeading(day: Date): string {
  return format(day, day.getFullYear() === new Date().getFullYear() ? 'MMMM d' : 'MMMM d, yyyy');
}

export function MonthCalendar({
  items,
  onSelect,
  // The home page's Upcoming section renders its own view-aware helper line
  // above this grid, so it opts out rather than stacking a second one. The
  // /calendar page has no such line and keeps this on.
  showHint = true,
  historyFrom,
  historyLoading = false,
  historyFailed = false,
  onMonthsInView,
}: {
  items: FeedItem[];
  onSelect?: (item: FeedItem) => void;
  showHint?: boolean;
  /**
   * How far back history goes, when the caller loads it (/calendar does,
   * through `useCalendarHistory`, twelve months; the home page does not). The
   * back arrow reaches its month instead of stopping at this one.
   */
  historyFrom?: Date | null;
  /** History for a month on screen is still on its way. */
  historyLoading?: boolean;
  /** History for a month on screen could not be loaded. */
  historyFailed?: boolean;
  /** Told the months the grid touches, whenever they change, so the caller
   *  can load their history. */
  onMonthsInView?: (months: Date[]) => void;
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

  const dayKeys = useMemo(() => [...byDay.keys()].sort(), [byDay]);

  // The venue's today, as a day key. Days before it are history: drawn with a
  // dashed edge and read-only showings.
  const todayKey = venueDayKey(new Date());

  // "Today" for the grid: today, or the day of a showing still playing from
  // before midnight. Asked of the live showings only — with history loaded the
  // earliest populated day is years back, and the grid opens on this week, not
  // on that one.
  const liveDayKeys = useMemo(
    () =>
      [...byDay.entries()]
        .filter(([, dayItems]) => dayItems.some((it) => !it.ended))
        .map(([key]) => key)
        .sort(),
    [byDay],
  );
  const start = useMemo(() => calendarStart(liveDayKeys), [liveDayKeys]);
  // The arrows go back as far as history does when the caller loads
  // history, and otherwise stop at the month of `start`: without history,
  // nothing earlier holds anything.
  const floor = useMemo(() => monthFloor(start, historyFrom), [start, historyFrom]);

  // Opens week-anchored on the current week, then switches to month navigation
  // the moment the reader pages. `anchorView` only moves off the current week
  // if the next six weeks are completely empty, which for a venue that
  // programmes weekly means it opens on the current week in every real case.
  const [view, setView] = useState<CalendarView>(() =>
    anchorView({ mode: 'week', start: weekStart(start) }, dayKeys, floor, start),
  );

  // Opens on today so the panel beside the grid is populated on a night we
  // have something on; otherwise on the first upcoming day, which is the
  // nearest day that has anything to show.
  const [selectedDay, setSelectedDay] = useState<Date>(() => {
    const today = new Date();
    if (byDay.has(format(today, 'yyyy-MM-dd'))) return today;
    const firstKey = liveDayKeys[0];
    if (!firstKey) return today;
    const [y, m, d] = firstKey.split('-').map(Number);
    return new Date(y, m - 1, d);
  });

  // Mobile only: which day's inline panel is open. `null` is a real state and
  // the one we open in — a day is always *selected* (the desktop column has to
  // say something), but on a phone the month should be scannable before any of
  // it is pushed down. Kept as a key rather than a boolean so it self-clears
  // whenever the selection moves for a reason other than a tap.
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  // Follow the results when a search leaves nothing in view. Keyed on the set
  // of populated days rather than on `items` identity, so this fires when the
  // filter actually changes something and not when the caller re-renders — and
  // it never yanks a view the reader paged to themselves, because `anchorView`
  // stays put whenever the current grid holds anything.
  //
  // Only when a populated day has *dropped out*, which is what a search does.
  // History arriving only ever adds days, and re-anchoring on it would yank a
  // reader who paged into a month the venue was dark straight back to the
  // present the moment the month before it finished loading.
  const lastDayKeys = useRef(dayKeys);
  useEffect(() => {
    const previous = lastDayKeys.current;
    if (previous === dayKeys) return;
    lastDayKeys.current = dayKeys;
    const now = new Set(dayKeys);
    if (previous.every((key) => now.has(key))) return;
    setView((current) => {
      const next = anchorView(current, dayKeys, floor, start);
      return isSameDay(next.start, current.start) && next.mode === current.mode ? current : next;
    });
  }, [dayKeys, floor, start]);

  const days = useMemo(() => viewDays(view), [view]);

  // Keyed on the months themselves, not on the array, so the caller hears
  // about a change of month and not about every render.
  const monthsInView = useMemo(() => monthsCovered(days), [days]);
  const monthsSignature = monthsInView.map((m) => format(m, 'yyyy-MM')).join(',');
  useEffect(() => {
    onMonthsInView?.(monthsInView);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthsSignature]);
  const dividers = useMemo(() => monthDividers(days, view), [days, view]);
  const canGoBack = canStepBack(view, floor);

  // One row per week. The flat grid could not hold the mobile day panel: a
  // panel between two weeks has to be a sibling of the rows, not a cell inside
  // one. Every window is a whole number of weeks, so this never leaves a stub.
  const weeks = useMemo(() => {
    const out: Date[][] = [];
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7));
    return out;
  }, [days]);

  // Keep the panel on a day the grid is actually showing. Paging to another
  // month otherwise leaves it describing a day that scrolled out of view — and
  // a search that re-anchored would show "Nothing on the marquee" beside a grid
  // full of matches. Whether the old day still has showings is not the
  // question; whether it is on screen is.
  //
  // The same goes for a day the grid chose on paging, while that month's
  // history is still loading: it picked the 1st for want of anything better,
  // and once the month arrives it should say what played rather than
  // "Nothing on the marquee". A day the reader picked stays picked.
  const readerPicked = useRef(false);
  useEffect(() => {
    const onScreen = days.some((d) => isSameDay(d, selectedDay));
    if (onScreen && (readerPicked.current || byDay.has(format(selectedDay, 'yyyy-MM-dd')))) return;
    // A month view is about its own month, so the padding days of the month
    // before are the last choice, not the first.
    const withItems = days.filter((d) => byDay.has(format(d, 'yyyy-MM-dd')));
    const inMonth = view.mode === 'month' ? withItems.find((d) => isSameMonth(d, view.start)) : undefined;
    const next = inMonth ?? withItems[0] ?? days[0];
    if (onScreen && isSameDay(next, selectedDay)) return;
    readerPicked.current = false;
    setSelectedDay(next);
    // Paging is not a request to read a day, so the phone gets its scannable
    // month back rather than a panel it never asked to open.
    setExpandedKey(null);
  }, [days, byDay, selectedDay, view]);

  const selectedKey = format(selectedDay, 'yyyy-MM-dd');
  const selectedItems = byDay.get(selectedKey) ?? [];
  const expanded = expandedKey === selectedKey;

  const instanceId = useId();
  const panelId = `${instanceId}-day-panel`;
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The day cells are the disclosure controls, so closing has to hand focus
  // back to the one that opened the panel.
  const cellRefs = useRef(new Map<string, HTMLButtonElement>());

  // Announce the panel when it opens. On `lg` the panel is `display: none`, so
  // this is a no-op there and desktop focus stays where the reader put it.
  useEffect(() => {
    if (!expandedKey) return;
    panelRef.current?.focus({ preventScroll: true });
  }, [expandedKey]);

  // Selecting a day and expanding it are the same gesture; tapping the open day
  // again closes it.
  const toggleDay = (day: Date) => {
    const key = format(day, 'yyyy-MM-dd');
    readerPicked.current = true;
    setSelectedDay(day);
    setExpandedKey((current) => (current === key ? null : key));
  };

  const closePanel = () => {
    setExpandedKey(null);
    cellRefs.current.get(selectedKey)?.focus();
  };

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
              {/* Polite and always mounted, so a screen reader hears the
                  change rather than a region appearing. */}
              <p className="font-serif text-sm italic text-muted-foreground min-h-[1.25rem]" aria-live="polite">
                {historyLoading
                  ? 'Loading what played…'
                  : historyFailed
                    ? 'Could not load what played this month. Try again in a moment.'
                    : ''}
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
            {/* The row gap that used to be the grid's own is now this column's,
                at the same value, so the weeks sit exactly where they did. */}
            <div className="flex flex-col gap-1 md:gap-2">
              {weeks.map((week, weekIndex) => {
                const heading = dividers.get(weekIndex * 7);
                const holdsSelected = week.some((d) => isSameDay(d, selectedDay));

                return (
                  <div key={format(week[0], 'yyyy-MM-dd')}>
                    {/* Full-width month heading, above the week it announces. */}
                    {heading && (
                      <div
                        className={cn(
                          'flex items-center gap-3 mb-1 md:mb-2',
                          weekIndex > 0 && 'mt-2',
                        )}
                      >
                        <span className="font-display text-sm uppercase tracking-[0.2em] text-accent whitespace-nowrap">
                          {heading}
                        </span>
                        <span className="h-px flex-1 bg-accent/20" />
                      </div>
                    )}

                    <div className="grid grid-cols-7 md:grid-cols-[repeat(7,minmax(0,132px))] justify-start gap-1 md:gap-2">
                      {week.map((day) => {
                        const key = format(day, 'yyyy-MM-dd');
                        const dayItems = byDay.get(key) ?? [];
                        // No single "current month" any more, so the old in/out-of-month
                        // dimming has nothing to mean. Alternate months get a light band
                        // instead, which keeps the boundary legible without pushing any
                        // day's text to a fainter colour.
                        const shaded = isShadedMonth(day);
                        const selected = isSameDay(day, selectedDay);
                        const today = isToday(day);
                        const hasItems = dayItems.length > 0;
                        const dayExpanded = expandedKey === key;
                        // Before the venue's today: everything in it has
                        // played. Tonight's finished early show is marked per
                        // item instead, by `ended`.
                        const past = key < todayKey;

                        // A floor, not a fixed height. Every day used to be the same
                        // box, which meant a third showing could not be drawn and became
                        // "+1 more" — a line that spent the cell's scarcest row saying
                        // there was something it would not show. The cells are grid
                        // children and grid stretches them, so giving the box a minimum
                        // and letting the content set the rest makes the whole week row
                        // grow to its busiest day and keeps every cell in that row the
                        // same height.
                        //
                        // The minimum is rem, not px, so the box tracks the type inside
                        // it. As px it did not: raising the root font size grew the event
                        // chips and left the cell the same size, which cut the last one
                        // off mid-line. 6.25/9.375rem are the old 112/168px at the root
                        // this was drawn against, so a quiet week looks exactly as it
                        // did and now scales with browser zoom and OS large-text too.
                        const sorted = dayItems
                          .slice()
                          .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

                        return (
                          // The disclosure moved off this div and onto the
                          // day-number button below. It was role="button"
                          // tabIndex={0} with focusable event buttons inside
                          // it, which is axe's `nested-interactive`: a control
                          // inside a control has no defined behaviour, and it
                          // put forty-odd cells in the tab order ahead of
                          // anything worth reaching.
                          //
                          // The click stays here so the whole cell is still a
                          // mouse target. Everything the keyboard and a screen
                          // reader need is on the button, which is where the
                          // name and aria-expanded belong anyway.
                          <div
                            key={key}
                            // A stable hook for the tests, which need to assert
                            // on the cell box (its height floor, the showings
                            // it draws) separately from the disclosure button
                            // inside it.
                            data-day-cell={key}
                            onClick={() => toggleDay(day)}
                            className={cn(
                              'relative min-h-[6.25rem] md:min-h-[9.375rem] rounded-md border text-left p-1 md:p-2 transition-colors flex flex-col overflow-hidden cursor-pointer',
                              'hover:border-primary/60',
                              'border-accent/20',
                              shaded ? 'bg-muted' : 'bg-card',
                              // Shape, not colour, says "this has happened":
                              // a dashed edge survives every kind of colour
                              // blindness and greyscale print alike.
                              past && 'border-dashed',
                              selected && 'border-primary bg-primary/10 ring-1 ring-primary',
                              today && !selected && 'border-accent/60',
                            )}
                          >
                            <div className="flex items-center justify-between shrink-0">
                              <button
                                type="button"
                                ref={(el) => {
                                  if (el) cellRefs.current.set(key, el);
                                  else cellRefs.current.delete(key);
                                }}
                                // Named outright: the accessible name of a bare
                                // day number is "4", which tells a screen-reader
                                // user nothing about what they are opening.
                                aria-label={
                                  hasItems
                                    ? `${format(day, 'EEEE, MMMM d')}, ${dayItems.length} ${dayItems.length === 1 ? 'showing' : 'showings'}${past ? ', past' : ''}`
                                    : `${format(day, 'EEEE, MMMM d')}, nothing on`
                                }
                                aria-expanded={dayExpanded}
                                aria-controls={dayExpanded ? panelId : undefined}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleDay(day);
                                }}
                                className={cn(
                                  'font-display text-sm md:text-base min-h-6 min-w-6 -m-0.5 rounded p-0.5 text-left',
                                  'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                  today && 'text-accent',
                                )}
                              >
                                {format(day, 'd')}
                              </button>
                              {hasItems && (
                                <span
                                  className={cn(
                                    'hidden md:inline-block text-xs font-semibold px-1.5 rounded-full',
                                    past
                                      ? 'border border-dashed border-accent/60 text-muted-foreground'
                                      : 'bg-primary text-primary-foreground',
                                  )}
                                >
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
                                      // Ended: a ring, not a filled dot.
                                      it.ended
                                        ? cn(
                                            'border',
                                            it.type === 'movie' && 'border-primary',
                                            it.type === 'event' && 'border-accent',
                                            it.type === 'concert' && 'border-foreground',
                                          )
                                        : cn(
                                            it.type === 'movie' && 'bg-primary',
                                            it.type === 'event' && 'bg-accent',
                                            it.type === 'concert' && 'bg-foreground',
                                          ),
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
                              <div className="mt-1 hidden md:flex flex-col gap-1">
                                {sorted.map((it) => it.ended ? (
                                  // History: the title as text, in the
                                  // solid muted token (never faded), with a
                                  // dashed rule. A click falls through to the
                                  // cell and opens the day, which is the
                                  // read-only record of what played.
                                  <div
                                    key={it.id}
                                    className={cn(
                                      'pl-1.5 border-l-2 border-dashed min-h-6',
                                      it.type === 'movie' && 'border-primary',
                                      it.type === 'event' && 'border-accent',
                                      it.type === 'concert' && 'border-foreground',
                                    )}
                                  >
                                    <div className="font-serif text-sm leading-tight line-clamp-2 lg:line-clamp-3 text-muted-foreground">
                                      {it.title}
                                    </div>
                                  </div>
                                ) : (
                                  <button
                                    key={it.id}
                                    type="button"
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      onSelect?.(it);
                                    }}
                                    className={cn(
                                      // min-h-6 is WCAG 2.5.8: these measured
                                      // under 20px tall with 4px between them.
                                      'text-left pl-1.5 border-l-2 group/ev min-h-6 rounded-sm',
                                      'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                                      it.type === 'movie' && 'border-primary',
                                      it.type === 'event' && 'border-accent',
                                      it.type === 'concert' && 'border-foreground',
                                    )}
                                  >
                                    {/* Two lines at `md`, three from `lg`. This clamps the
                                        individual title, which is a different question from
                                        how many showings the cell draws — every one of them
                                        is drawn now, and the row grows to suit. The clamp
                                        follows the column width because at 768 these cells
                                        are only ~66px wide, where a long title would
                                        otherwise run to a paragraph and bury the day's other
                                        showings under it. The full title is one tap away in
                                        the day panel. */}
                                    <div className="font-serif text-sm leading-tight line-clamp-2 lg:line-clamp-3 group-hover/ev:text-primary transition-colors">
                                      {it.title}
                                    </div>
                                  </button>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>

                    {/* The selected day, inline under its own week. Mounted
                        collapsed rather than conditionally rendered: a panel
                        that appears at full height has nothing to animate from,
                        and this way the weeks below accordion down instead of
                        jumping.

                        `0fr -> 1fr` on a one-row grid is the height transition
                        that does not need the height measured. `invisible`
                        takes the collapsed panel out of the tab order and the
                        accessibility tree, and because CSS holds `visibility`
                        at `visible` for the whole of an outgoing transition,
                        the content stays on screen while it slides shut. */}
                    {holdsSelected && (
                      <div
                        className={cn(
                          'lg:hidden grid transition-[grid-template-rows,visibility] duration-200 ease-out motion-reduce:transition-none',
                          expanded ? 'grid-rows-[1fr] visible' : 'grid-rows-[0fr] invisible',
                        )}
                      >
                        <div className="overflow-hidden min-h-0">
                          <div
                            id={panelId}
                            ref={panelRef}
                            role="region"
                            tabIndex={-1}
                            aria-label={`${format(selectedDay, 'EEEE, MMMM d')} — what's on`}
                            className="mt-1 md:mt-2 rounded-md border border-primary/40 bg-primary/5 p-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary"
                          >
                            <div className="flex items-start justify-between gap-4 mb-3">
                              <div>
                                <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-1">
                                  {isToday(selectedDay) ? 'Tonight' : format(selectedDay, 'EEEE')}
                                </p>
                                <h3 className="font-display text-xl uppercase tracking-wide">
                                  {dayHeading(selectedDay)}
                                </h3>
                              </div>
                              <Button
                                variant="ghost"
                                size="icon"
                                className="shrink-0 -mt-1 -mr-1"
                                onClick={closePanel}
                                aria-label={`Close ${format(selectedDay, 'MMMM d')}`}
                              >
                                <X className="h-4 w-4" />
                              </Button>
                            </div>
                            <DayShowings items={selectedItems} onSelect={onSelect} />
                          </div>
                        </div>
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

          {/* Selected day list. Desktop only now — below `lg` the same content
              opens inline under the tapped day's week, where it does not make
              the reader scroll past the whole grid to find out what they just
              tapped. */}
          <div className="hidden lg:block lg:flex-1 lg:min-w-[16rem] lg:border-l lg:border-accent/20 lg:pl-8">
            <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2">
              {isToday(selectedDay) ? 'Tonight' : format(selectedDay, 'EEEE')}
            </p>
            <h2 className="font-display text-2xl uppercase tracking-wide mb-4">
              {dayHeading(selectedDay)}
            </h2>
            <DayShowings items={selectedItems} onSelect={onSelect} />
          </div>
        </div>
      </div>
    </section>
  );
}
