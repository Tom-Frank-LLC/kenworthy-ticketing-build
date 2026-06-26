import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Disc, Search } from 'lucide-react';
import { toast } from 'sonner';
import { SEO } from '@/components/SEO';

type Dvd = any;

export default function Dvds() {
  const { user } = useAuth();
  const [dvds, setDvds] = useState<Dvd[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [myRentals, setMyRentals] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [{ data: d }, { data: s }] = await Promise.all([
      (supabase as any).from('dvds').select('*').eq('is_active', true).order('title'),
      (supabase as any).from('dvd_settings').select('*').limit(1).maybeSingle(),
    ]);
    setDvds(d || []);
    setSettings(s);
    if (user) {
      const { data: r } = await (supabase as any).from('dvd_rentals')
        .select('*, dvds(title)')
        .eq('user_id', user.id)
        .order('reserved_at', { ascending: false });
      setMyRentals(r || []);
    }
    setLoading(false);
  }
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [user?.id]);

  async function reserve(dvd: Dvd) {
    if (!user) { toast.error('Sign in to reserve a DVD.'); return; }
    const { error } = await (supabase as any).from('dvd_rentals').insert({
      dvd_id: dvd.id, user_id: user.id, status: 'reserved',
    });
    if (error) toast.error(error.message);
    else { toast.success('Reserved. Pick up at the box office.'); load(); }
  }

  async function cancel(rentalId: string) {
    const { error } = await (supabase as any).from('dvd_rentals').update({ status: 'cancelled' }).eq('id', rentalId);
    if (error) toast.error(error.message); else { toast.success('Reservation cancelled'); load(); }
  }

  const filtered = dvds.filter(d => !q || `${d.title} ${d.director||''} ${d.genre||''}`.toLowerCase().includes(q.toLowerCase()));
  const active = myRentals.filter(r => ['reserved','checked_out','overdue'].includes(r.status));

  return (
    <>
      <SEO title="DVD Rentals — The Kenworthy" description="Browse and reserve DVDs from the Kenworthy's lending library. Pick up at the box office on Main Street, Moscow." />
      <div className="container mx-auto px-4 py-10 space-y-8 max-w-6xl">
        <header className="space-y-2">
          <p className="font-display uppercase tracking-[0.3em] text-xs text-accent">Lending library</p>
          <h1 className="font-display uppercase text-4xl md:text-5xl">DVD Rentals</h1>
          <p className="font-serif text-muted-foreground max-w-2xl">
            Reserve a title online and pick it up at the box office. {settings && (
              <>${Number(settings.default_rental_price).toFixed(2)} per rental, {settings.loan_days}-day loan,
              ${Number(settings.late_fee_per_day).toFixed(2)}/day late fee. Up to {settings.max_active_per_user} at a time.</>
            )}
          </p>
        </header>

        {user && active.length > 0 && (
          <section className="space-y-2">
            <h2 className="font-display uppercase text-sm tracking-wider text-accent">Your active rentals</h2>
            <div className="grid gap-2">
              {active.map(r => (
                <Card key={r.id} className="glass">
                  <CardContent className="p-3 flex items-center gap-3">
                    <Disc className="h-5 w-5 text-primary" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium truncate">{r.dvds?.title}</p>
                      <p className="text-xs font-serif text-muted-foreground capitalize">
                        {r.status.replace('_', ' ')}
                        {r.due_at && ` • due ${new Date(r.due_at).toLocaleDateString()}`}
                      </p>
                    </div>
                    {r.status === 'reserved' && (
                      <Button size="sm" variant="ghost" className="text-destructive" onClick={() => cancel(r.id)}>Cancel</Button>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </section>
        )}

        <div className="flex items-center gap-2">
          <Search className="h-4 w-4 text-muted-foreground" />
          <Input placeholder="Search title, director, genre…" value={q} onChange={e => setQ(e.target.value)} className="max-w-md" />
        </div>

        {loading ? (
          <p className="text-muted-foreground font-serif">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground font-serif text-center py-12">No DVDs match your search.</p>
        ) : (
          <div className="grid gap-4 grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
            {filtered.map(d => {
              const out = d.copies_available <= 0;
              const alreadyHas = active.some(r => r.dvd_id === d.id);
              return (
                <Card key={d.id} className="glass overflow-hidden flex flex-col">
                  <div className="aspect-[2/3] bg-muted relative">
                    {d.cover_url
                      ? <img src={d.cover_url} alt={d.title} className="w-full h-full object-cover" loading="lazy" />
                      : <div className="w-full h-full flex items-center justify-center"><Disc className="h-12 w-12 text-muted-foreground/40" /></div>}
                    {out && <Badge variant="outline" className="absolute top-2 right-2 bg-background/90">Checked out</Badge>}
                  </div>
                  <CardContent className="p-3 flex-1 flex flex-col gap-2">
                    <div className="flex-1">
                      <p className="font-display uppercase text-sm leading-tight">{d.title}</p>
                      <p className="text-xs text-muted-foreground font-serif">
                        {[d.year, d.director].filter(Boolean).join(' • ')}
                      </p>
                      {d.genre && <p className="text-xs text-accent font-serif italic">{d.genre}</p>}
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="font-display text-primary">${Number(d.rental_price).toFixed(2)}</span>
                      {!user ? (
                        <Button size="sm" variant="outline" asChild><Link to="/auth">Sign in</Link></Button>
                      ) : alreadyHas ? (
                        <Badge variant="outline" className="text-xs">Reserved</Badge>
                      ) : (
                        <Button size="sm" disabled={out} onClick={() => reserve(d)}>
                          {out ? 'Unavailable' : 'Reserve'}
                        </Button>
                      )}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </>
  );
}