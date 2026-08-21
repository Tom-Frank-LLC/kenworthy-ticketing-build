import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Trash2, UserPlus, Search, Users } from 'lucide-react';
import { toast } from 'sonner';
import { fetchAllRows } from '@/lib/fetchAllRows';

interface Assignment {
  id: string;
  user_id: string;
  event_id: string | null;
  live_performance_id: string | null;
  movie_id: string | null;
  created_at: string;
  profile?: { display_name: string | null };
  event?: { title: string } | null;
  live_performance?: { title: string } | null;
  movie?: { title: string } | null;
}

interface Production {
  id: string;
  title: string;
  type: 'event' | 'live_performance' | 'movie';
}

export default function HostManagementTab() {
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [productions, setProductions] = useState<Production[]>([]);
  const [profiles, setProfiles] = useState<{ id: string; display_name: string | null }[]>([]);
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedProductionKey, setSelectedProductionKey] = useState('');
  const [loading, setLoading] = useState(true);

  /*
   * One flat, searchable list rather than three scrollable groups.
   *
   * There are ~1,290 productions here — the movies alone are 1,088, and they
   * are paged in with `fetchAllRows` precisely so none are missing. Every one
   * of them was a row in a dropdown, which is the case `SearchableSelect` was
   * built for: finding "Casablanca" meant scrolling past a thousand titles.
   *
   * The Events / Live Performances / Movies headings are gone, but the kind is
   * not: it moves into `hint`, which the picker searches alongside the title.
   * So typing "movie" still narrows to films, and unlike a heading it composes
   * — "movie dune" gets there in one go.
   */
  const productionOptions = useMemo(
    () =>
      productions.map(p => ({
        value: `${p.type}::${p.id}`,
        label: p.title,
        hint:
          p.type === 'movie' ? 'Movie' : p.type === 'event' ? 'Event' : 'Live performance',
      })),
    [productions],
  );

  useEffect(() => {
    loadData();
  }, []);

  async function loadData() {
    const [assignmentsRes, eventsRes, performancesRes, moviesRes, profilesRes] = await Promise.all([
      supabase.from('host_event_assignments').select('*'),
      supabase.from('events').select('id, title'),
      supabase.from('live_performances').select('id, title'),
      // Paged, and ordered so the paging is deterministic: unordered and
      // unpaged this returned an arbitrary 1,000 of the 1,088 titles, so the
      // films a host could be assigned to were a silently truncated set.
      fetchAllRows<{ id: string; title: string }>((from, to) =>
        supabase.from('movies').select('id, title').order('title').order('id').range(from, to)
      ),
      supabase.from('profiles').select('id, display_name'),
    ]);

    // Build productions list
    const prods: Production[] = [
      ...(eventsRes.data || []).map(e => ({ id: e.id, title: e.title, type: 'event' as const })),
      ...(performancesRes.data || []).map(p => ({ id: p.id, title: p.title, type: 'live_performance' as const })),
      ...(moviesRes.data || []).map(m => ({ id: m.id, title: m.title, type: 'movie' as const })),
    ];
    setProductions(prods);
    setProfiles(profilesRes.data || []);

    // Enrich assignments with names
    const rawAssignments = assignmentsRes.data || [];
    const enriched = rawAssignments.map(a => {
      const profile = (profilesRes.data || []).find(p => p.id === a.user_id);
      const event = a.event_id ? (eventsRes.data || []).find(e => e.id === a.event_id) : null;
      const lp = a.live_performance_id ? (performancesRes.data || []).find(p => p.id === a.live_performance_id) : null;
      const movie = a.movie_id ? (moviesRes.data || []).find(m => m.id === a.movie_id) : null;
      return {
        ...a,
        profile: profile || { display_name: 'Unknown User' },
        event: event ? { title: event.title } : null,
        live_performance: lp ? { title: lp.title } : null,
        movie: movie ? { title: movie.title } : null,
      };
    });
    setAssignments(enriched);
    setLoading(false);
  }

  const filteredProfiles = profiles.filter(p =>
    (p.display_name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    p.id.toLowerCase().includes(searchTerm.toLowerCase())
  );

  async function assignHost() {
    if (!selectedUserId || !selectedProductionKey) {
      toast.error('Select a user and a production');
      return;
    }

    const [type, prodId] = selectedProductionKey.split('::');
    const insertData: any = { user_id: selectedUserId };
    if (type === 'event') insertData.event_id = prodId;
    else if (type === 'live_performance') insertData.live_performance_id = prodId;
    else if (type === 'movie') insertData.movie_id = prodId;

    // Also ensure user has the host role
    const { error: roleError } = await supabase
      .from('user_roles')
      .upsert({ user_id: selectedUserId, role: 'host' as any }, { onConflict: 'user_id,role' });

    if (roleError) {
      toast.error('Failed to assign host role: ' + roleError.message);
      return;
    }

    const { error } = await supabase.from('host_event_assignments').insert(insertData);
    if (error) {
      if (error.message.includes('duplicate')) toast.error('This assignment already exists');
      else toast.error(error.message);
      return;
    }

    toast.success('Host assigned!');
    setSelectedUserId('');
    setSelectedProductionKey('');
    setSearchTerm('');
    loadData();
  }

  async function removeAssignment(id: string) {
    if (!confirm('Remove this host assignment?')) return;
    const { error } = await supabase.from('host_event_assignments').delete().eq('id', id);
    if (error) toast.error(error.message);
    else { toast.success('Assignment removed'); loadData(); }
  }

  const getAssignmentLabel = (a: Assignment) => {
    if (a.event) return { name: a.event.title, type: 'Event' };
    if (a.live_performance) return { name: a.live_performance.title, type: 'Live Performance' };
    if (a.movie) return { name: a.movie.title, type: 'Movie' };
    return { name: 'Unknown', type: '' };
  };

  if (loading) return <div className="text-center text-muted-foreground py-8">Loading...</div>;

  return (
    <div className="space-y-6">
      {/* Assign new host */}
      <CollapsibleSection id="rentals.hosts.assign" title="Assign a Host" icon={UserPlus}>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* User search */}
          <div className="space-y-2">
            <label className="text-sm font-medium">User</label>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search users..."
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setSelectedUserId(''); }}
                className="pl-9"
              />
            </div>
            {searchTerm && !selectedUserId && (
              <div className="border rounded-md max-h-40 overflow-y-auto bg-popover">
                {filteredProfiles.length === 0 ? (
                  <p className="p-2 text-sm text-muted-foreground">No users found</p>
                ) : (
                  filteredProfiles.slice(0, 10).map(p => (
                    <button
                      key={p.id}
                      className="w-full text-left px-3 py-2 hover:bg-accent text-sm"
                      onClick={() => { setSelectedUserId(p.id); setSearchTerm(p.display_name || p.id); }}
                    >
                      {p.display_name || p.id.slice(0, 8)}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>

          {/* Production select */}
          <div className="space-y-2">
            <label htmlFor="host-production" className="text-sm font-medium">Production</label>
            <SearchableSelect
              id="host-production"
              options={productionOptions}
              value={selectedProductionKey}
              onChange={setSelectedProductionKey}
              placeholder="Select production…"
              searchPlaceholder="Search films, events, performances…"
              emptyText="No production matches that search."
            />
          </div>

          <div className="flex items-end">
            <Button onClick={assignHost} className="w-full">
              <UserPlus className="h-4 w-4 mr-1" /> Assign Host
            </Button>
          </div>
        </div>
      </CollapsibleSection>

      <CollapsibleSection
        id="rentals.hosts.assignments"
        title="Current Host Assignments"
        icon={Users}
        count={assignments.length}
        defaultOpen
      >
          {assignments.length === 0 ? (
            <Card className="glass p-8 text-center">
              <p className="text-muted-foreground">No host assignments yet.</p>
            </Card>
          ) : (
            <div className="space-y-3">
              {assignments.map(a => {
                const { name, type } = getAssignmentLabel(a);
                return (
                  <Card key={a.id} className="glass">
                    <CardContent className="p-4 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <Users className="h-5 w-5 text-primary" />
                        <div>
                          <p className="font-medium">{a.profile?.display_name || 'Unknown'}</p>
                          <div className="flex gap-2 mt-1">
                            <Badge variant="outline" className="text-xs">{type}</Badge>
                            <Badge variant="secondary" className="text-xs">{name}</Badge>
                          </div>
                        </div>
                      </div>
                      <Button variant="ghost" size="sm" onClick={() => removeAssignment(a.id)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
      </CollapsibleSection>
    </div>
  );
}
