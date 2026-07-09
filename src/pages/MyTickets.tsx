import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { format } from 'date-fns';
import { Ticket, QrCode, Calendar, MapPin } from 'lucide-react';

interface TicketWithDetails {
  id: string;
  price: number;
  tax_amount: number;
  total_price: number;
  qr_code: string | null;
  status: string;
  purchased_at: string;
  seat: { seat_row: string; seat_number: number } | null;
  showing: { start_time: string; title: string } | null;
}

export default function MyTickets() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [tickets, setTickets] = useState<TicketWithDetails[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (authLoading) return;
    if (!user) { navigate('/auth?redirect=' + encodeURIComponent(window.location.pathname + window.location.search)); return; }

    async function load() {
      const { data } = await supabase
        .from('tickets')
        .select(`
          id, price, tax_amount, total_price, qr_code, status, purchased_at,
          seats(seat_row, seat_number),
          showings(start_time, movies(title), events(title), live_performances(title))
        `)
        .eq('user_id', user!.id)
        .order('purchased_at', { ascending: false });

      const mapped = (data || []).map((t: any) => ({
        ...t,
        seat: t.seats || null,
        showing: t.showings
          ? {
              start_time: t.showings.start_time,
              title:
                t.showings.movies?.title ||
                t.showings.events?.title ||
                t.showings.live_performances?.title ||
                'Showing',
            }
          : null,
      }));

      setTickets(mapped);
      setLoading(false);
    }
    load();
  }, [user, authLoading, navigate]);

  if (loading || authLoading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  return (
    <div className="container py-8 px-4 max-w-3xl">
      <h1 className="font-display text-3xl font-bold mb-2">My Tickets</h1>
      <p className="text-muted-foreground mb-8">Your purchase history and digital tickets</p>

      {tickets.length === 0 ? (
        <Card className="glass p-12 text-center">
          <Ticket className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <p className="text-muted-foreground text-lg mb-4">No tickets yet</p>
          <Button asChild>
            <a href="/#now-showing">Browse Movies</a>
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          {tickets.map((ticket, i) => (
            <Card
              key={ticket.id}
              className="glass hover:glow-primary transition-shadow duration-300 opacity-0 animate-fade-in"
              style={{ animationDelay: `${i * 50}ms` }}
            >
              <CardContent className="p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="space-y-1">
                    <h3 className="font-display text-lg font-bold">{ticket.showing?.title}</h3>
                    <div className="flex flex-wrap gap-3 text-sm text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <Calendar className="h-3.5 w-3.5" />
                        {ticket.showing ? format(new Date(ticket.showing.start_time), 'MMM d, yyyy h:mm a') : ''}
                      </span>
                      {ticket.seat && (
                        <span className="flex items-center gap-1">
                          <MapPin className="h-3.5 w-3.5" />
                          Row {ticket.seat.seat_row}, Seat {ticket.seat.seat_number}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant={ticket.status === 'confirmed' ? 'default' : 'secondary'}>
                        {ticket.status}
                      </Badge>
                      <span className="text-sm font-medium text-primary">${Number(ticket.total_price).toFixed(2)}</span>
                    </div>
                  </div>

                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="outline" size="sm">
                        <QrCode className="h-4 w-4 mr-1" /> QR Code
                      </Button>
                    </DialogTrigger>
                    <DialogContent className="max-w-sm text-center">
                      <DialogHeader>
                        <DialogTitle className="font-display">Digital Ticket</DialogTitle>
                      </DialogHeader>
                      <div className="space-y-4 py-4">
                        <div className="mx-auto w-48 h-48 bg-foreground rounded-lg flex items-center justify-center p-4">
                          {/* Simple QR code visualization using the UUID */}
                          <div className="grid grid-cols-8 gap-0.5 w-full h-full">
                            {Array.from({ length: 64 }, (_, i) => {
                              const code = ticket.qr_code || ticket.id;
                              const hash = code.charCodeAt(i % code.length) + i;
                              return (
                                <div
                                  key={i}
                                  className={hash % 3 === 0 ? 'bg-background' : 'bg-foreground'}
                                />
                              );
                            })}
                          </div>
                        </div>
                        <div className="text-sm space-y-1">
                          <p className="font-bold">{ticket.showing?.title}</p>
                          <p className="text-muted-foreground">
                            {ticket.showing && format(new Date(ticket.showing.start_time), 'MMM d, yyyy h:mm a')}
                          </p>
                          {ticket.seat ? (
                            <p className="text-muted-foreground">
                              Row {ticket.seat.seat_row}, Seat {ticket.seat.seat_number}
                            </p>
                          ) : (
                            <p className="text-muted-foreground">General Admission</p>
                          )}
                          <p className="text-xs text-muted-foreground font-mono mt-2 break-all">
                            {ticket.qr_code}
                          </p>
                        </div>
                      </div>
                    </DialogContent>
                  </Dialog>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
