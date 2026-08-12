/**
 * AttendeeSheet
 *
 * Staff-only drawer listing who is attending a showing (or every showing of a
 * production). Opened by clicking the `sold / capacity` badge in the admin
 * Listings panel, so staff can go from "12 sold" to "which twelve" without
 * leaving the dashboard.
 *
 * Reads the same tickets → profiles path that `exportContactsCsv` walks, but
 * pulls the columns that path throws away: email, phone, seat, purchase time
 * and status. The CSV button here exports what is on screen.
 */

import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Download } from 'lucide-react';
import { format } from 'date-fns';
import { toast } from 'sonner';
import { formatShowtime } from '@/lib/datetime';

interface AttendeeSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Heading shown in the drawer — the movie/event title, plus showtime when scoped to one showing. */
  title: string;
  /** Showings whose tickets to list. One id for a single showing, many for a whole production. */
  showingIds: string[];
  /** Total seats across those showings, for the count-to-capacity header. */
  capacity: number;
}

interface AttendeeRow {
  id: string;
  status: string;
  purchased_at: string;
  total_price: number | null;
  payment_method: string | null;
  comp_recipient_name: string | null;
  comp_recipient_email: string | null;
  profiles: { display_name: string | null; email: string | null; phone: string | null } | null;
  seats: { seat_row: string | null; seat_number: number | null; section: string | null } | null;
  showings: { start_time: string } | null;
}

const seatLabel = (s: AttendeeRow['seats']) => {
  if (!s) return '—';
  const parts = [s.section, s.seat_row, s.seat_number].filter(v => v !== null && v !== undefined && v !== '');
  return parts.length ? parts.join('-') : '—';
};

// Comp tickets are issued to a recipient who may not be the account holder, so
// fall back to the comp fields before giving up on a name.
const attendeeName = (r: AttendeeRow) =>
  r.profiles?.display_name || r.comp_recipient_name || 'Unknown';
const attendeeEmail = (r: AttendeeRow) => r.profiles?.email || r.comp_recipient_email || '';

export function AttendeeSheet({ open, onOpenChange, title, showingIds, capacity }: AttendeeSheetProps) {
  const [rows, setRows] = useState<AttendeeRow[]>([]);
  const [loading, setLoading] = useState(false);

  const key = showingIds.join(',');

  useEffect(() => {
    if (!open || showingIds.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    supabase
      .from('tickets')
      .select(
        'id, status, purchased_at, total_price, payment_method, comp_recipient_name, comp_recipient_email, ' +
          'profiles(display_name, email, phone), seats(seat_row, seat_number, section), showings(start_time)'
      )
      .in('showing_id', showingIds)
      .order('purchased_at', { ascending: false })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error) {
          console.error('AttendeeSheet:', error);
          toast.error('Could not load attendees');
          setRows([]);
        } else {
          setRows((data ?? []) as unknown as AttendeeRow[]);
        }
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Keyed on the joined id string, not the array: callers build showingIds
    // inline, so a new array identity arrives on every parent render and
    // depending on it directly would refetch in a loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, key]);

  const multiShowing = showingIds.length > 1;

  const exportCsv = () => {
    const header = ['Name', 'Email', 'Phone', 'Seat', 'Showing', 'Purchased', 'Status', 'Paid'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map(r =>
      [
        attendeeName(r),
        attendeeEmail(r),
        r.profiles?.phone ?? '',
        seatLabel(r.seats),
        r.showings?.start_time ? formatShowtime(r.showings.start_time, 'yyyy-MM-dd HH:mm') : '',
        r.purchased_at ? format(new Date(r.purchased_at), 'yyyy-MM-dd HH:mm') : '',
        r.status,
        r.total_price ?? '',
      ]
        .map(esc)
        .join(',')
    );
    const blob = new Blob([[header.map(esc).join(','), ...body].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_attendees.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader className="space-y-2">
          <SheetTitle className="font-display text-xl pr-8">{title}</SheetTitle>
          <div className="flex items-center gap-2 flex-wrap">
            <Badge variant="secondary">
              {rows.length} of {capacity} seats sold
            </Badge>
            {multiShowing && (
              <Badge variant="outline">across {showingIds.length} showings</Badge>
            )}
            {rows.length > 0 && (
              <Button variant="outline" size="sm" className="h-7" onClick={exportCsv}>
                <Download className="h-3.5 w-3.5 mr-1" /> Export CSV
              </Button>
            )}
          </div>
        </SheetHeader>

        <div className="mt-6">
          {loading ? (
            <p className="text-sm text-muted-foreground py-8 text-center">Loading attendees…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No tickets sold yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Attendee</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Seat</TableHead>
                  {multiShowing && <TableHead>Showing</TableHead>}
                  <TableHead>Purchased</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{attendeeName(r)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{attendeeEmail(r) || '—'}</div>
                      {r.profiles?.phone && <div>{r.profiles.phone}</div>}
                    </TableCell>
                    <TableCell className="text-sm">{seatLabel(r.seats)}</TableCell>
                    {multiShowing && (
                      <TableCell className="text-xs whitespace-nowrap">
                        {r.showings?.start_time
                          ? formatShowtime(r.showings.start_time, 'MMM d, yyyy h:mm a')
                          : '—'}
                      </TableCell>
                    )}
                    <TableCell className="text-xs whitespace-nowrap">
                      {r.purchased_at ? format(new Date(r.purchased_at), 'MMM d, yyyy h:mm a') : '—'}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={r.status === 'valid' || r.status === 'active' ? 'default' : 'secondary'}
                        className="text-xs capitalize"
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
