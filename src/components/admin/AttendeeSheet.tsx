/**
 * AttendeeSheet
 *
 * Staff-only drawer listing who is attending a showing (or every showing of a
 * production). Opened by clicking the `sold / capacity` badge in the admin
 * Listings panel, so staff can go from "12 sold" to "which twelve" without
 * leaving the dashboard, and by the Ticket holders button on the POS Presales
 * panel.
 *
 * The UI says **ticket holders**, not "attendees" — someone who has bought a
 * seat has not necessarily turned up, and the Checked In column is the thing
 * that says whether they did. The component and the `showing_attendees` RPC
 * keep their original names, so search for either.
 *
 * Contact details come from the `showing_attendees` RPC, not from embedding
 * `profiles` in the tickets select. RLS on `profiles` restricts every row to its
 * own owner or an admin, and PostgREST applies RLS to embedded resources too —
 * so for a staff-only account the embed silently returned NULL and this drawer
 * listed a roster of "Unknown" with no email or phone. The RPC returns three
 * contact columns for tickets the caller is entitled to see, and deliberately
 * not the marketing or Mailchimp lifetime-value columns that also live on that
 * table. `exportContactsCsv` walks the same RPC.
 *
 * How a seat was paid for is the third fetch, for a related reason. A ticket
 * records `payment_method`, but *which film pass* bought it is not a column on
 * tickets and deliberately is not one: `film_pass_redemptions` already ties a
 * pass to the ticket it minted, and copying that onto the ticket would be a
 * second place for the same fact to live and a second place for it to be
 * wrong. So the pass is read from the redemption row and merged in here by
 * ticket id, exactly as contacts are.
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
import { fetchAllRows } from '@/lib/fetchAllRows';

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
  /** Null until the QR is scanned at the door. The whole point of the column. */
  scanned_at: string | null;
  total_price: number | null;
  payment_method: string | null;
  comp_recipient_name: string | null;
  comp_recipient_email: string | null;
  /** Merged in from `showing_attendees`; not an embedded relation. */
  contact: { display_name: string | null; email: string | null; phone: string | null } | null;
  /** The sticker that bought this seat, merged in from `film_pass_redemptions`. */
  passCode: string | null;
  seats: { seat_row: string | null; seat_number: number | null; section: string | null } | null;
  showings: { start_time: string } | null;
}

const seatLabel = (s: AttendeeRow['seats']) => {
  if (!s) return '—';
  const parts = [s.section, s.seat_row, s.seat_number].filter(v => v !== null && v !== undefined && v !== '');
  return parts.length ? parts.join('-') : '—';
};

/**
 * How the seat was paid for, in the words the box office uses.
 *
 * Unmapped values fall through to a de-underscored version of whatever is on
 * the row rather than to a placeholder: a payment method this list has not
 * caught up with is still more useful shown than hidden, and showing it is what
 * makes the omission visible.
 */
const PURCHASE_TYPES: Record<string, string> = {
  card: 'Card',
  cash: 'Cash',
  online: 'Online',
  comp: 'Comp',
  free: 'Free',
  film_pass: 'Film pass',
};

const purchaseType = (method: string | null) =>
  method ? (PURCHASE_TYPES[method] ?? method.replace(/_/g, ' ')) : '—';

/**
 * Which pass, short enough to read off a screen.
 *
 * A sticker's identity is its `qr_code`, minted as `PASS:<uuid>` — unguessable
 * by design and unreadable as a consequence. The tail is what staff can
 * actually compare against the paper in front of them, and it is only ever used
 * to tell two passes apart in one list, never to look one up: the box office
 * searches by scanning the code or by the patron, both of which take the whole
 * thing.
 */
const passLabel = (qrCode: string | null) =>
  qrCode ? `…${qrCode.slice(-6).toUpperCase()}` : null;

// Comp tickets are issued to a recipient who may not be the account holder, so
// fall back to the comp fields before giving up on a name.
const attendeeName = (r: AttendeeRow) =>
  r.contact?.display_name || r.comp_recipient_name || 'Unknown';
const attendeeEmail = (r: AttendeeRow) => r.contact?.email || r.comp_recipient_email || '';

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
    // Three calls, in parallel: the ticket rows, the contact details for them,
    // and the pass that bought each film-pass seat. They are separate because
    // neither of the last two can come from a join — see the note at the top of
    // this file.
    Promise.all([
      supabase
        .from('tickets')
        .select(
          'id, status, purchased_at, scanned_at, total_price, payment_method, comp_recipient_name, comp_recipient_email, ' +
            'seats(seat_row, seat_number, section), showings(start_time)'
        )
        .in('showing_id', showingIds)
        .order('purchased_at', { ascending: false }),
      supabase.rpc('showing_attendees', { p_showing_ids: showingIds }),
      // Paged, unlike the two above. A pass may now admit several people to one
      // screening, so redemptions are no longer bounded by "one per pass per
      // showing" — and PostgREST truncates at 1,000 rows without saying so,
      // which here would read as a handful of pass admissions mysteriously
      // showing no pass at all.
      fetchAllRows((from, to) =>
        supabase
          .from('film_pass_redemptions')
          .select('ticket_id, user_film_passes!film_pass_redemptions_pass_id_fkey(qr_code)')
          .in('showing_id', showingIds)
          // Ordered by the primary key, not by redeemed_at: paging needs a
          // total order, and two admissions on one pass now routinely share a
          // timestamp to the second — which is exactly when a non-unique sort
          // starts dropping and repeating rows across page boundaries.
          .order('id')
          .range(from, to)
      ),
    ])
      .then(([ticketsRes, contactsRes, passesRes]) => {
        if (cancelled) return;
        if (ticketsRes.error) {
          console.error('AttendeeSheet tickets:', ticketsRes.error);
          toast.error('Could not load ticket holders');
          setRows([]);
          setLoading(false);
          return;
        }
        // A contact lookup that fails degrades to names-only rather than an
        // empty drawer: the seats and totals are still worth showing.
        if (contactsRes.error) {
          console.error('AttendeeSheet contacts:', contactsRes.error);
          toast.error('Could not load ticket holder contact details');
        }
        // A pass lookup that fails degrades further still, and silently: the
        // Purchase Type column already says "Film pass" from the ticket itself,
        // so all that is lost is which one. Not worth a second red toast over
        // the contacts one.
        if (passesRes.error) {
          console.error('AttendeeSheet pass redemptions:', passesRes.error);
        }
        const byTicket = new Map<string, AttendeeRow['contact']>(
          ((contactsRes.data ?? []) as any[]).map(c => [
            c.ticket_id as string,
            { display_name: c.display_name, email: c.email, phone: c.phone },
          ])
        );
        const passByTicket = new Map<string, string | null>(
          (passesRes.data ?? [])
            .filter(r => r.ticket_id)
            .map(r => [r.ticket_id, r.user_film_passes?.qr_code ?? null])
        );
        setRows(
          ((ticketsRes.data ?? []) as any[]).map(
            t =>
              ({
                ...t,
                contact: byTicket.get(t.id) ?? null,
                passCode: passByTicket.get(t.id) ?? null,
              }) as AttendeeRow
          )
        );
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
    const header = [
      'Name', 'Email', 'Phone', 'Seat', 'Showing', 'Purchased',
      'Checked In', 'Status', 'Purchase Type', 'Pass', 'Paid',
    ];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const body = rows.map(r =>
      [
        attendeeName(r),
        attendeeEmail(r),
        r.contact?.phone ?? '',
        seatLabel(r.seats),
        r.showings?.start_time ? formatShowtime(r.showings.start_time, 'yyyy-MM-dd HH:mm') : '',
        r.purchased_at ? format(new Date(r.purchased_at), 'yyyy-MM-dd HH:mm') : '',
        r.scanned_at ? formatShowtime(r.scanned_at, 'yyyy-MM-dd HH:mm') : '',
        r.status,
        purchaseType(r.payment_method),
        // The whole code in an export, not the six-character tail. A
        // spreadsheet is where someone reconciles against the pass records,
        // and the tail is an abbreviation for reading, not an identifier.
        r.passCode ?? '',
        r.total_price ?? '',
      ]
        .map(esc)
        .join(',')
    );
    const blob = new Blob([[header.map(esc).join(','), ...body].join('\n')], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${title.replace(/[^a-zA-Z0-9]/g, '_')}_ticket_holders.csv`;
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
            <p className="text-sm text-muted-foreground py-8 text-center">Loading ticket holders…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">No tickets sold yet.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ticket holder</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Seat</TableHead>
                  {multiShowing && <TableHead>Showing</TableHead>}
                  <TableHead>Purchased</TableHead>
                  <TableHead>Checked In</TableHead>
                  <TableHead>Purchase Type</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(r => (
                  <TableRow key={r.id}>
                    <TableCell className="font-medium">{attendeeName(r)}</TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      <div>{attendeeEmail(r) || '—'}</div>
                      {r.contact?.phone && <div>{r.contact.phone}</div>}
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
                    {/* The door's own answer to "has this person come in yet".
                        Rendered in the venue's zone, not the viewer's: a staff
                        laptop set to Mountain would otherwise report every
                        admission an hour late, and late shows on the wrong day. */}
                    <TableCell className="whitespace-nowrap">
                      {r.scanned_at ? (
                        <Badge variant="default" className="text-xs">
                          {formatShowtime(r.scanned_at, 'h:mm a')}
                        </Badge>
                      ) : (
                        <span className="text-xs text-muted-foreground">Not yet</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span className="text-sm">{purchaseType(r.payment_method)}</span>
                      {/* Which sticker, for pass admissions only. A pass may
                          admit several people to one screening now, so this is
                          what tells four separate seats apart as one party on
                          one pass rather than four unrelated pass holders. */}
                      {r.payment_method === 'film_pass' && (
                        <div className="text-xs text-muted-foreground font-mono">
                          {passLabel(r.passCode) ?? 'pass not recorded'}
                        </div>
                      )}
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
