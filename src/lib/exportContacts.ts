import { supabase } from '@/integrations/supabase/client';

export async function exportContactsCsv(productionType: 'event' | 'concert' | 'movie', productionId: string, productionTitle: string) {
  // Get all showings for this production
  const col = productionType === 'event' ? 'event_id' : productionType === 'concert' ? 'live_performance_id' : 'movie_id';
  const { data: showings } = await supabase
    .from('showings')
    .select('id')
    .eq(col, productionId);

  if (!showings || showings.length === 0) {
    return null;
  }

  const showingIds = showings.map(s => s.id);

  // Get tickets for those showings
  const { data: tickets } = await supabase
    .from('tickets')
    .select('user_id')
    .in('showing_id', showingIds)
    // Someone whose card was declined is not an attendee.
    .eq('status', 'confirmed');

  if (!tickets || tickets.length === 0) {
    return null;
  }

  const userIds = [...new Set(tickets.map(t => t.user_id))];

  // Get profiles
  const { data: profiles } = await supabase
    .from('profiles')
    .select('id, display_name')
    .in('id', userIds);

  // Get emails from auth - we'll use display_name + user_id
  // Since we can't query auth.users, we'll get emails from the profiles + auth session
  // Actually, profiles don't have emails. We need to get user emails differently.
  // For now, we'll export display_name. Admin can cross-reference with auth users.
  
  // Build CSV
  const rows = (profiles || []).map(p => ({
    name: p.display_name || 'Unknown',
    user_id: p.id,
  }));

  const csvContent = 'Name,User ID\n' + rows.map(r => 
    `"${(r.name || '').replace(/"/g, '""')}","${r.user_id}"`
  ).join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${productionTitle.replace(/[^a-zA-Z0-9]/g, '_')}_contacts.csv`;
  a.click();
  URL.revokeObjectURL(url);
  return rows.length;
}
