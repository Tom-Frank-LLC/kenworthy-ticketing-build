import { supabase } from '@/integrations/supabase/client';

/**
 * Export the contact list for everyone holding a confirmed ticket to a
 * production.
 *
 * Two things were wrong with the previous version.
 *
 * It read `profiles` directly, and RLS there restricts every row to its own
 * owner or an admin — so a staff-only account got back just its own row and
 * exported a file with no attendees in it at all. Contacts now come from the
 * `showing_attendees` RPC, which returns the three contact columns for tickets
 * the caller is entitled to see and nothing else from that table.
 *
 * And it shipped only `Name,User ID`, on the stated belief that "profiles don't
 * have emails" — they do, and have for some time. A contact export whose point
 * is to reach the audience was emitting opaque uuids and asking the reader to
 * "cross-reference with auth users". It now exports name, email and phone.
 *
 * Returns the number of contacts written, or null when there is nothing to
 * export.
 */
export async function exportContactsCsv(
  productionType: 'event' | 'concert' | 'movie',
  productionId: string,
  productionTitle: string,
): Promise<number | null> {
  const col =
    productionType === 'event'
      ? 'event_id'
      : productionType === 'concert'
        ? 'live_performance_id'
        : 'movie_id';

  const { data: showings, error: showingsErr } = await supabase
    .from('showings')
    .select('id')
    .eq(col, productionId);

  if (showingsErr) {
    console.error('exportContactsCsv showings:', showingsErr);
    return null;
  }
  if (!showings?.length) return null;

  const showingIds = showings.map(s => s.id);

  // Confirmed only: someone whose card was declined is not an attendee. The
  // status lives on `tickets`, so the two sets are fetched together and joined
  // on ticket id.
  const [ticketsRes, contactsRes] = await Promise.all([
    supabase
      .from('tickets')
      .select('id, comp_recipient_name, comp_recipient_email')
      .in('showing_id', showingIds)
      .eq('status', 'confirmed'),
    supabase.rpc('showing_attendees', { p_showing_ids: showingIds }),
  ]);

  if (ticketsRes.error) {
    console.error('exportContactsCsv tickets:', ticketsRes.error);
    return null;
  }
  if (contactsRes.error) {
    console.error('exportContactsCsv contacts:', contactsRes.error);
    return null;
  }
  if (!ticketsRes.data?.length) return null;

  const byTicket = new Map(
    ((contactsRes.data ?? []) as any[]).map(c => [c.ticket_id as string, c]),
  );

  // One row per person, not per ticket: someone who bought four seats belongs in
  // a contact list once. Keyed on email where there is one, since that is what
  // makes two tickets the same human for mailing purposes.
  const seen = new Set<string>();
  const rows: { name: string; email: string; phone: string }[] = [];

  for (const t of ticketsRes.data as any[]) {
    const c = byTicket.get(t.id);
    // Comp tickets are issued to a recipient who may not hold the account, so
    // fall back to the comp fields before giving up on a name.
    const name = c?.display_name || t.comp_recipient_name || 'Unknown';
    const email = c?.email || t.comp_recipient_email || '';
    const phone = c?.phone || '';

    const key = (email || `${name}|${phone}`).toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ name, email, phone });
  }

  if (rows.length === 0) return null;

  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const csv =
    'Name,Email,Phone\n' +
    rows.map(r => [r.name, r.email, r.phone].map(esc).join(',')).join('\n');

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${productionTitle.replace(/[^a-zA-Z0-9]/g, '_')}_contacts.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}
