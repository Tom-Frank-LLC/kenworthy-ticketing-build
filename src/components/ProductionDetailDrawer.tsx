import { Link } from 'react-router-dom';
import { Sheet, SheetClose, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, X } from 'lucide-react';
import { format } from 'date-fns';
import { ProductionMedia, ProductionMetaBadges } from '@/components/ProductionMedia';
import { formatShowtime } from '@/lib/datetime';
import { isPast } from '@/lib/purchasable';

interface ShowingInfo {
  id: string;
  start_time: string;
  ticket_price: number;
}

interface ProductionDetail {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  trailer_url: string | null;
  rating: string | null;
  genre: string | null;
  duration_minutes?: number;
  ticket_type?: string;
  rsvp_url?: string | null;
  showings: ShowingInfo[];
  type: 'movie' | 'event' | 'concert';
}

interface ProductionDetailDrawerProps {
  production: ProductionDetail | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProductionDetailDrawer({ production, open, onOpenChange }: ProductionDetailDrawerProps) {
  if (!production) return null;

  // The heading below has always said "Upcoming Showings"; this is what makes
  // that true. The feed these rows come from filters on start_time at query
  // time, so a past showing only reaches here in a tab left open across one —
  // but that is exactly the tab that would otherwise offer a ticket to a film
  // that has finished. The rule is src/lib/purchasable.ts.
  const upcoming = production.showings.filter(
    (s) => !isPast(s, { duration_minutes: production.duration_minutes }),
  );

  // An RSVP event with dates, all of them behind us, has nothing left to RSVP
  // to. One with no showings at all is the standalone kind the feed carries
  // without a date, and there is nothing to judge it against.
  const rsvpClosed = production.showings.length > 0 && upcoming.length === 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" hideClose className="w-full sm:max-w-lg overflow-y-auto p-0">
        {/* Close sits in its own solid bar above the artwork rather than on
            top of it: a one-sheet is unpredictable behind a small glyph, and
            the default corner button scrolled out of reach on a phone. Sticky
            against this sheet's own scroll box, so it stays put all the way
            down. */}
        <div className="sticky top-0 z-20 flex items-center justify-end border-b border-border bg-background px-2 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
          <SheetClose className="flex h-11 w-11 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring">
            <X className="h-5 w-5" />
            <span className="sr-only">Close</span>
          </SheetClose>
        </div>

        {/* Poster / Trailer */}
        <div className="relative">
          <ProductionMedia
            title={production.title}
            type={production.type}
            posterUrl={production.poster_url}
            trailerUrl={production.trailer_url}
          />
        </div>

        <div className="p-6 space-y-5">
          <SheetHeader className="p-0 space-y-2">
            <ProductionMetaBadges
              rating={production.rating}
              genre={production.genre}
              durationMinutes={production.duration_minutes}
            />
            <SheetTitle className="font-display text-2xl">{production.title}</SheetTitle>
          </SheetHeader>

          {/* Showings come before the synopsis: buying a ticket is the point
              of this drawer, and on a phone a long description pushed every
              showtime below the fold. */}
          {production.ticket_type === 'rsvp' && production.rsvp_url ? (
            rsvpClosed ? (
              <p className="text-sm text-muted-foreground">This event has passed.</p>
            ) : (
              <div>
                <Button size="lg" className="w-full" asChild>
                  <a href={production.rsvp_url} target="_blank" rel="noopener noreferrer">RSVP Now</a>
                </Button>
              </div>
            )
          ) : production.ticket_type === 'info_only' ? null : upcoming.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Upcoming Showings</h3>
              <div className="space-y-2">
                {upcoming.map(showing => (
                  <Button
                    key={showing.id}
                    variant="outline"
                    className="w-full justify-between h-auto py-3"
                    asChild
                  >
                    <Link to={`/showing/${showing.id}`} onClick={() => onOpenChange(false)}>
                      <span className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary" />
                        {formatShowtime(showing.start_time, 'EEEE, MMMM d, yyyy')}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">{formatShowtime(showing.start_time, 'h:mm a')}</span>
                        <Badge variant="secondary">${showing.ticket_price.toFixed(2)}</Badge>
                      </span>
                    </Link>
                  </Button>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No upcoming showings scheduled.</p>
          )}

          {production.description && (
            <p className="text-muted-foreground leading-relaxed">{production.description}</p>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
