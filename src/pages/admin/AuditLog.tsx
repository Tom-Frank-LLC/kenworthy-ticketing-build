import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { ArrowLeft, ChevronDown, ChevronRight, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';

type Entry = {
  id: string;
  actor_id: string | null;
  actor_email: string | null;
  action: string;
  entity_type: string;
  entity_id: string | null;
  details: any;
  created_at: string;
};

const ENTITY_LABEL: Record<string, string> = {
  sponsorship_opportunities: 'Sponsorship',
  showings: 'Showing',
  movies: 'Film',
  events: 'Event',
  live_performances: 'Performance',
  tickets: 'Ticket',
  profiles: 'Profile',
  user_roles: 'User role',
  concession_items: 'Concession item',
  film_pass_types: 'Film pass',
};

export default function AuditLog() {
  const { isAdmin, isStaff, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [actor, setActor] = useState<string>('all');
  const [entity, setEntity] = useState<string>('all');
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin && !isStaff) { navigate('/'); return; }
    load();
  }, [authLoading, isAdmin, isStaff]);

  async function load() {
    setLoading(true);
    let q = (supabase as any)
      .from('admin_audit_log')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(500);
    if (actor !== 'all') q = actor === 'system' ? q.is('actor_id', null) : q.eq('actor_id', actor);
    if (entity !== 'all') q = q.eq('entity_type', entity);
    if (from) q = q.gte('created_at', new Date(from).toISOString());
    if (to) {
      const end = new Date(to); end.setHours(23, 59, 59, 999);
      q = q.lte('created_at', end.toISOString());
    }
    const { data } = await q;
    setEntries(data || []);
    setLoading(false);
  }

  const actors = useMemo(() => {
    const map = new Map<string, string>();
    entries.forEach((e) => {
      if (e.actor_id) map.set(e.actor_id, e.actor_email || e.actor_id.slice(0, 8));
    });
    return Array.from(map.entries());
  }, [entries]);

  if (authLoading) return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;

  return (
    <div className="container py-8 max-w-6xl">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="mb-4">
        <ArrowLeft className="h-4 w-4 mr-1" /> Back to Admin
      </Button>

      <div className="flex items-center justify-between mb-6 flex-wrap gap-3">
        <div>
          <h1 className="font-display text-3xl font-bold">Activity Log</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Recent actions taken across the site by admins, staff, and members.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={load}>
          <RefreshCw className="h-4 w-4 mr-1" /> Refresh
        </Button>
      </div>

      <Card className="glass mb-4">
        <CardContent className="p-4 grid grid-cols-1 md:grid-cols-5 gap-3">
          <div>
            <Label className="text-xs">User</Label>
            <Select value={actor} onValueChange={setActor}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All users</SelectItem>
                <SelectItem value="system">System / guest</SelectItem>
                {actors.map(([id, email]) => (
                  <SelectItem key={id} value={id}>{email}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Entity type</Label>
            <Select value={entity} onValueChange={setEntity}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All entities</SelectItem>
                {Object.entries(ENTITY_LABEL).map(([k, v]) => (
                  <SelectItem key={k} value={k}>{v}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">From</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">To</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="flex items-end">
            <Button onClick={load} className="w-full">Apply filters</Button>
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : entries.length === 0 ? (
        <Card className="glass">
          <CardContent className="p-8 text-center text-muted-foreground">
            No activity matches these filters.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {entries.map((e) => {
            const open = !!expanded[e.id];
            return (
              <Card key={e.id} className="glass">
                <CardContent className="p-3">
                  <button
                    className="w-full flex items-start gap-3 text-left"
                    onClick={() => setExpanded((x) => ({ ...x, [e.id]: !open }))}
                  >
                    {open ? <ChevronDown className="h-4 w-4 mt-1 shrink-0" /> : <ChevronRight className="h-4 w-4 mt-1 shrink-0" />}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="outline" className="text-xs">
                          {ENTITY_LABEL[e.entity_type] || e.entity_type}
                        </Badge>
                        <span className="font-mono text-xs text-foreground">{e.action}</span>
                        <span className="text-xs text-muted-foreground">·</span>
                        <span className="text-xs text-muted-foreground">
                          {format(new Date(e.created_at), 'MMM d, yyyy h:mm a')}
                        </span>
                      </div>
                      <p className="text-sm mt-1 truncate">
                        <span className="text-muted-foreground">by </span>
                        {e.actor_email || <span className="italic text-muted-foreground">system / guest</span>}
                        {e.entity_id && (
                          <span className="text-muted-foreground"> · {e.entity_id.slice(0, 8)}</span>
                        )}
                      </p>
                    </div>
                  </button>
                  {open && (
                    <pre className="mt-3 p-3 rounded bg-muted/40 text-xs overflow-auto max-h-80">
                      {JSON.stringify(e.details, null, 2)}
                    </pre>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
