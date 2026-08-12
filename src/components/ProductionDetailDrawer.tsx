import { Link } from 'react-router-dom';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar } from 'lucide-react';
import { format } from 'date-fns';
import { ProductionMedia, ProductionMetaBadges } from '@/components/ProductionMedia';

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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto p-0">
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
            <div>
              <Button size="lg" className="w-full" asChild>
                <a href={production.rsvp_url} target="_blank" rel="noopener noreferrer">RSVP Now</a>
              </Button>
            </div>
          ) : production.ticket_type === 'info_only' ? null : production.showings.length > 0 ? (
            <div className="space-y-3">
              <h3 className="text-sm font-medium uppercase tracking-wider text-muted-foreground">Upcoming Showings</h3>
              <div className="space-y-2">
                {production.showings.map(showing => (
                  <Button
                    key={showing.id}
                    variant="outline"
                    className="w-full justify-between h-auto py-3"
                    asChild
                  >
                    <Link to={`/showing/${showing.id}`} onClick={() => onOpenChange(false)}>
                      <span className="flex items-center gap-2">
                        <Calendar className="h-4 w-4 text-primary" />
                        {format(new Date(showing.start_time), 'EEEE, MMMM d, yyyy')}
                      </span>
                      <span className="flex items-center gap-2">
                        <span className="text-muted-foreground">{format(new Date(showing.start_time), 'h:mm a')}</span>
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
