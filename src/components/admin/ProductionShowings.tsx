import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Calendar, Edit, Lock, LockOpen, Trash2 } from 'lucide-react';
import { formatShowtime } from '@/lib/datetime';

/**
 * `sold / capacity`, plus how many of those have been checked in, clickable to
 * open the attendee list for that showing.
 *
 * The check-in figure is only meaningful once someone has actually scanned, so
 * it stays hidden at zero rather than showing "· 0 in" against every future
 * showing on the schedule.
 */
export function TicketCountBadge({
  sold,
  scanned,
  capacity,
  onClick,
}: {
  sold: number;
  scanned: number;
  capacity: number;
  onClick: () => void;
}) {
  const soldOut = capacity > 0 && sold >= capacity;
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        `${sold} of ${capacity} tickets sold${soldOut ? ' (sold out)' : ''}` +
        `${scanned > 0 ? `, ${scanned} checked in` : ''} — click to see attendees`
      }
      aria-label={`View ${sold} attendees`}
      className="rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <Badge
        variant={soldOut ? 'default' : 'secondary'}
        className="text-xs whitespace-nowrap cursor-pointer hover:bg-secondary/70 transition-colors"
      >
        {sold} / {capacity}
        {scanned > 0 && ` · ${scanned} in`}
      </Badge>
    </button>
  );
}

/**
 * The showings hanging off one production, rendered under its card.
 *
 * Extracted from the Movies listing rather than copied into Live Events. The
 * two tabs list the same thing — a title and the nights it plays — and had
 * drifted into two different screens: Movies showed its showings inline while
 * Live Events showed only an aggregate count, so the only way to date a
 * concert was to open the Movies tab and pick it out of a category selector.
 * One component means a fix to the row (a new badge, a new control) lands on
 * both listings instead of one.
 */
export function ProductionShowings({
  showings,
  productionTitle,
  heading = 'Showings',
  getSold,
  getScanned,
  onOpenAttendees,
  onToggleSoldOut,
  onDeleteShowing,
}: {
  showings: any[];
  productionTitle: string;
  /** "Showings" under a film, "Shows" under a live event. */
  heading?: string;
  getSold: (showingId: string) => number;
  getScanned: (showingId: string) => number;
  onOpenAttendees: (title: string, showingIds: string[], capacity: number) => void;
  onToggleSoldOut: (showing: any) => void;
  onDeleteShowing: (showingId: string) => void;
}) {
  if (showings.length === 0) return null;

  return (
    <div className="mt-3 pl-8 space-y-2">
      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">{heading}</p>
      {showings.map(showing => (
        <div key={showing.id} className="flex items-center justify-between rounded-md bg-secondary/50 px-3 py-2">
          <div className="flex gap-2 items-center flex-wrap">
            <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="text-sm">
              {formatShowtime(showing.start_time, 'MMM d, yyyy h:mm a')}
            </span>
            <span className="text-sm text-muted-foreground">• ${Number(showing.ticket_price).toFixed(2)}</span>
            {showing.venues?.name && (
              <Badge variant="secondary" className="text-xs">{showing.venues.name}</Badge>
            )}
            {/* Said on the row as well as in the toggle's tooltip. A closed
                showing looks identical to an open one otherwise, and the
                difference matters most when scanning the list. */}
            {showing.manually_sold_out && (
              <Badge variant="destructive" className="text-xs">Sold Out</Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <TicketCountBadge
              sold={getSold(showing.id)}
              scanned={getScanned(showing.id)}
              capacity={showing.total_seats || 0}
              onClick={() =>
                onOpenAttendees(
                  `${productionTitle} — ${formatShowtime(showing.start_time, 'MMM d, yyyy h:mm a')}`,
                  [showing.id],
                  showing.total_seats || 0
                )
              }
            />
            {/* Not offered on a walk-in night: nothing is issued, so there is
                nothing to sell out. */}
            {!showing.no_ticket_required && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={showing.manually_sold_out ? 'Reopen online sales' : 'Mark sold out'}
                    onClick={() => onToggleSoldOut(showing)}
                  >
                    {showing.manually_sold_out
                      ? <LockOpen className="h-3.5 w-3.5 text-success" />
                      : <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {showing.manually_sold_out
                    ? 'Reopen online sales. The showing starts selling again if seats and timing allow.'
                    : 'Mark sold out. Closes online sales only — the box office can still sell and comp.'}
                </TooltipContent>
              </Tooltip>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link to={`/admin/showings/${showing.id}`}><Edit className="h-3.5 w-3.5" /></Link>
            </Button>
            <Button variant="ghost" size="sm" onClick={() => onDeleteShowing(showing.id)}>
              <Trash2 className="h-3.5 w-3.5 text-destructive" />
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}
