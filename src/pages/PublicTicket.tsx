import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, CalendarPlus, MapPin, Ticket as TicketIcon, AlertCircle } from 'lucide-react';
import { SEO } from '@/components/SEO';
import { RedeemedQr } from '@/components/RedeemedQr';
import { GoogleLogo } from '@/components/GoogleLogo';
import { fetchPublicOrder, ticketCalendarUrl, type PublicOrder } from '@/lib/tickets';
import { googleCalendarUrl } from '@/lib/calendar';
import { MEMBER_ACCOUNTS_ENABLED } from '@/lib/flags';

/**
 * Public ticket page — `/t/:token`.
 *
 * The destination of the link in a confirmation SMS, and the "view on your
 * phone" button in the confirmation email. Deliberately unauthenticated: a
 * phone-only purchaser has no session and may never create one, so requiring
 * a sign-in here would recreate the very gap this page exists to close.
 *
 * Designed for one job: being held up at the door. The QR is the largest thing
 * on screen, dark-on-white regardless of theme so a scanner reads it, and the
 * page renders every ticket in the order on one scroll so a group does not
 * need four separate links.
 */
export default function PublicTicket() {
  const { token } = useParams<{ token: string }>();
  const [order, setOrder] = useState<PublicOrder | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!token) {
        setError('This ticket link is incomplete.');
        setLoading(false);
        return;
      }
      const result = await fetchPublicOrder(token);
      if (cancelled) return;
      if (result.ok && result.order) setOrder(result.order);
      else setError(result.error || 'We could not load your tickets just now.');
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [token]);

  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading your tickets…</div>;
  }

  if (error || !order) {
    return (
      <div className="container py-16 px-4 max-w-md">
        <SEO title="Ticket not found" description="This ticket link could not be opened." />
        <Card className="glass p-8 text-center">
          <AlertCircle className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <p className="text-lg font-medium mb-2">{error}</p>
          <p className="text-sm text-muted-foreground mb-6">
            If you bought tickets and cannot open them, contact the box office at{' '}
            <a className="text-primary underline" href="mailto:events@kenworthy.org">
              events@kenworthy.org
            </a>{' '}
            and we will sort it out.
          </p>
          <Button asChild variant="outline">
            <a href="/">Back to The Kenworthy</a>
          </Button>
        </Card>
      </div>
    );
  }

  const count = order.tickets.length;

  return (
    <div className="container py-8 px-4 max-w-md">
      <SEO
        title={`Your tickets — ${order.title}`}
        description={`${count} ticket${count === 1 ? '' : 's'} for ${order.title}.`}
      />

      <div className="text-center mb-6">
        <p className="text-xs uppercase tracking-widest text-muted-foreground mb-2">
          {count === 1 ? 'Your ticket' : `Your ${count} tickets`}
        </p>
        <h1 className="font-display text-2xl font-bold leading-tight">{order.title}</h1>
        <div className="flex flex-col items-center gap-1 mt-3 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <Calendar className="h-3.5 w-3.5" />
            {order.start_time_display}
          </span>
          <span className="flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5" />
            {order.venue || 'The Kenworthy Performing Arts Centre'}
          </span>
        </div>
        {/*
          Stacked and full-width on phones, which is how this page is almost
          always opened (the link comes by SMS). Side by side only once there is
          room, so neither label wraps.
        */}
        <div className="flex flex-col sm:flex-row gap-2 mt-5">
          <Button asChild size="lg" className="w-full sm:flex-1 px-4">
            <a href={ticketCalendarUrl(order.order_token)}>
              <CalendarPlus className="h-4 w-4 mr-2 shrink-0" /> Add to calendar
            </a>
          </Button>
          {/* The .ics above already covers Apple/Outlook; this is the one-tap
              path for the Google users it does not serve as cleanly. */}
          <Button asChild variant="outline" size="lg" className="w-full sm:flex-1 px-4">
            <a href={googleCalendarUrl(order)} target="_blank" rel="noreferrer">
              <GoogleLogo className="mr-2" /> Google Calendar
            </a>
          </Button>
        </div>
      </div>

      <p className="text-center text-sm text-muted-foreground mb-6">
        Show {count === 1 ? 'this code' : 'these codes'} at the door. Turn your screen brightness up.
      </p>

      <div className="space-y-4">
        {order.tickets.map((ticket, i) => (
          <Card key={ticket.id} className="glass overflow-hidden">
            <CardContent className="p-5 text-center">
              <div className="flex items-center justify-between mb-4">
                <span className="text-xs uppercase tracking-wider text-muted-foreground">
                  Ticket {i + 1} of {count}
                </span>
                <Badge variant={ticket.scanned_at ? 'secondary' : ticket.status === 'confirmed' ? 'default' : 'secondary'}>
                  {ticket.scanned_at ? 'Used' : ticket.status}
                </Badge>
              </div>

              {/* Rendered client-side from the code the door scanner matches
                  on, so it draws instantly and survives a flaky lobby
                  connection once the page has loaded. The server-rendered PNG
                  (ticket-access?qr=) exists for email, where no JS can run.
                  Always on white: a theme-tinted QR does not scan. */}
              <RedeemedQr
                value={ticket.qr_code}
                scannedAt={ticket.scanned_at}
                className="w-full max-w-[260px] rounded-xl p-4"
              />

              <div className="mt-4 space-y-1">
                <p className="font-medium">
                  {ticket.seat ? `Row ${ticket.seat.row}, Seat ${ticket.seat.number}` : 'General Admission'}
                </p>
                {ticket.tier_name && (
                  <p className="text-sm text-muted-foreground">{ticket.tier_name}</p>
                )}
                <p className="text-sm text-primary font-medium">${Number(ticket.total_price).toFixed(2)}</p>
                <p className="text-sm font-mono text-muted-foreground break-all pt-1">{ticket.qr_code}</p>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card className="glass mt-6">
        <CardContent className="p-5">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Total paid</span>
            <span className="font-semibold">${Number(order.total).toFixed(2)}</span>
          </div>
        </CardContent>
      </Card>

      <div className="text-center mt-8 space-y-3">
        <p className="text-sm text-muted-foreground">
          Bookmark this page — it opens your tickets without signing in.
        </p>
        {/* This page is where the confirmation email lands, so it is the one
            page a patron reliably reaches — which makes a button to a page
            they cannot sign in to the most expensive dead end on the site.
            Bookmarking, per the line above, is the whole mechanism now. */}
        {MEMBER_ACCOUNTS_ENABLED && (
          <Button asChild variant="outline" size="sm">
            <a href="/my-tickets">
              <TicketIcon className="h-4 w-4 mr-1.5" />
              See all your tickets
            </a>
          </Button>
        )}
      </div>
    </div>
  );
}
