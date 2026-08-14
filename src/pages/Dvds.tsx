import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Disc, Search, X } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { toast } from 'sonner';
import { SEO } from '@/components/SEO';
import { syncMailchimpProfile } from '@/lib/mailchimp';
import { MEMBER_ACCOUNTS_ENABLED } from '@/lib/flags';

type Dvd = any;

/**
 * The lending library.
 *
 * Logged-in only — `RequireAuth` wraps the route in App.tsx, and both nav
 * entries are gated to match. With member accounts off, signing in means staff,
 * so this is the box-office catalogue: what is on the shelf, searchable, for
 * whoever is standing at the counter. The public does not see DVDs.
 *
 * Reserving still needs a *patron* account: the reservation is a row keyed to a
 * `user_id`, and there is nothing like the ticket world's `/t/:token` to stand
 * in for a session. So while `MEMBER_ACCOUNTS_ENABLED` is off the card action
 * stays "Ask at the box office" — staff check titles in and out from
 * Admin → DVD Library, not from here.
 *
 * Nothing is deleted. `reserve`, `cancel` and the active-rentals section are all
 * still here behind the flag, and come back with it.
 */

export default function Dvds() {
  const { user } = useAuth();
  const [dvds, setDvds] = useState<Dvd[]>([]);
  const [settings, setSettings] = useState<any>(null);
  const [myRentals, setMyRentals] = useState<any[]>([]);
  const [q, setQ] = useState('');
  const [yearFilter, setYearFilter] = useState('all');
  const [genreFilter, setGenreFilter] = useState('all');
  const [formatFilter, setFormatFilter] = useState('all');
  const [keywordFilter, setKeywordFilter] = useState('all');
  const [loading, setLoading] = useState(true);

  async function load() {
    setLoading(true);
    const [{ data: d }, { data: s }] = await Promise.all([
      fetchAllRows<Dvd>((from, to) =>
        (supabase as any).from('dvds').select('*').eq('is_active', true).order('title').range(from, to)),
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
    // The route is behind RequireAuth, so there is always a session here. This
    // narrows the type for `user.id`; it is not a branch anyone reaches.
    if (!user) return;
    const { error } = await (supabase as any).from('dvd_rentals').insert({
      dvd_id: dvd.id, user_id: user.id, status: 'reserved',
    });
    if (error) toast.error(error.message);
    else {
      toast.success('Reserved. Pick up at the box office.');
      void syncMailchimpProfile({ extraTags: ['dvd-renter'], source: 'dvd-reservation' });
      load();
    }
  }

  async function cancel(rentalId: string) {
    const { error } = await (supabase as any).from('dvd_rentals').update({ status: 'cancelled' }).eq('id', rentalId);
    if (error) toast.error(error.message); else { toast.success('Reservation cancelled'); load(); }
  }

  const parseNote = (notes: string | null | undefined, label: 'Format' | 'Keywords') => {
    if (!notes) return '';
    const m = notes.match(new RegExp(`${label}:\\s*([^|]+)`));
    return m ? m[1].trim() : '';
  };

  const { years, genres, formats, keywords } = useMemo(() => {
    const y = new Set<string>();
    const g = new Set<string>();
    const f = new Set<string>();
    const k = new Set<string>();
    for (const d of dvds) {
      if (d.year) y.add(String(d.year));
      if (d.genre) String(d.genre).split(',').forEach((s: string) => { const t = s.trim(); if (t) g.add(t); });
      const fmt = parseNote(d.notes, 'Format'); if (fmt) f.add(fmt);
      const kw = parseNote(d.notes, 'Keywords');
      if (kw) kw.split(',').forEach(s => { const t = s.trim(); if (t) k.add(t); });
    }
    return {
      years: Array.from(y).sort((a, b) => Number(b) - Number(a)),
      genres: Array.from(g).sort(),
      formats: Array.from(f).sort(),
      keywords: Array.from(k).sort(),
    };
  }, [dvds]);

  const filtered = dvds.filter(d => {
    if (q && !`${d.title} ${d.director || ''} ${d.genre || ''} ${d.notes || ''}`.toLowerCase().includes(q.toLowerCase())) return false;
    if (yearFilter !== 'all' && String(d.year || '') !== yearFilter) return false;
    if (genreFilter !== 'all' && !(d.genre || '').toLowerCase().split(',').map((s: string) => s.trim()).includes(genreFilter.toLowerCase())) return false;
    if (formatFilter !== 'all' && parseNote(d.notes, 'Format').toLowerCase() !== formatFilter.toLowerCase()) return false;
    if (keywordFilter !== 'all' && !parseNote(d.notes, 'Keywords').toLowerCase().split(',').map(s => s.trim()).includes(keywordFilter.toLowerCase())) return false;
    return true;
  });

  const hasFilters = q || yearFilter !== 'all' || genreFilter !== 'all' || formatFilter !== 'all' || keywordFilter !== 'all';
  const resetFilters = () => {
    setQ(''); setYearFilter('all'); setGenreFilter('all'); setFormatFilter('all'); setKeywordFilter('all');
  };
  const active = myRentals.filter(r => ['reserved','checked_out','overdue'].includes(r.status));

  const reserveControl = (d: Dvd) => {
    const out = d.copies_available <= 0;
    // Availability still matters to someone deciding whether to walk down —
    // it is the reservation, not the stock count, that needs an account.
    if (!MEMBER_ACCOUNTS_ENABLED) {
      return (
        <span className="text-xs font-serif text-muted-foreground">
          {out ? 'All copies out' : 'Ask at the box office'}
        </span>
      );
    }
    if (active.some(r => r.dvd_id === d.id)) return <Badge variant="outline" className="text-xs">Reserved</Badge>;
    return <Button size="sm" disabled={out} onClick={() => reserve(d)}>{out ? 'Unavailable' : 'Reserve'}</Button>;
  };

  return (
    <>
      <SEO
        title="DVD Rentals — Kenworthy"
        description={
          MEMBER_ACCOUNTS_ENABLED
            ? "Browse and reserve DVDs from the Kenworthy's lending library. Pick up at the box office on Main Street, Moscow."
            : "Browse the Kenworthy's DVD lending library. Ask at the box office on Main Street, Moscow, to borrow a title."
        }
      />
      <div className="container mx-auto px-4 py-10 space-y-8 max-w-6xl">
        <header className="space-y-2">
          <p className="font-display uppercase tracking-[0.3em] text-xs text-accent">Lending library</p>
          <h1 className="font-display uppercase text-4xl md:text-5xl">DVD Rentals</h1>
          <p className="font-serif text-muted-foreground max-w-2xl">
            {MEMBER_ACCOUNTS_ENABLED
              ? 'Reserve a title online and pick it up at the box office.'
              : 'Browse what is on the shelf, then ask for it at the box office on Main Street.'}{' '}
            {settings && (
              <>${Number(settings.default_rental_price).toFixed(2)} per rental, {settings.loan_days}-day loan,
              ${Number(settings.late_fee_per_day).toFixed(2)}/day late fee. Up to {settings.max_active_per_user} at a time.</>
            )}
          </p>
        </header>

        {MEMBER_ACCOUNTS_ENABLED && user && active.length > 0 && (
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

        <div className="space-y-3">
          <div className="relative max-w-md">
            <Search className="h-4 w-4 text-muted-foreground absolute left-3 top-1/2 -translate-y-1/2" />
            <Input placeholder="Search title, director, genre…" value={q} onChange={e => setQ(e.target.value)} className="pl-9" />
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <Select value={yearFilter} onValueChange={setYearFilter}>
              <SelectTrigger className="w-[130px] h-9"><SelectValue placeholder="Year" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All years</SelectItem>
                {years.map(y => <SelectItem key={y} value={y}>{y}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={genreFilter} onValueChange={setGenreFilter}>
              <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Genre" /></SelectTrigger>
              <SelectContent className="max-h-72">
                <SelectItem value="all">All genres</SelectItem>
                {genres.map(g => <SelectItem key={g} value={g}>{g}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={formatFilter} onValueChange={setFormatFilter}>
              <SelectTrigger className="w-[140px] h-9"><SelectValue placeholder="Format" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All formats</SelectItem>
                {formats.map(f => <SelectItem key={f} value={f}>{f}</SelectItem>)}
              </SelectContent>
            </Select>
            {keywords.length > 0 && (
              <Select value={keywordFilter} onValueChange={setKeywordFilter}>
                <SelectTrigger className="w-[170px] h-9"><SelectValue placeholder="Keyword" /></SelectTrigger>
                <SelectContent className="max-h-72">
                  <SelectItem value="all">All keywords</SelectItem>
                  {keywords.map(k => <SelectItem key={k} value={k}>{k}</SelectItem>)}
                </SelectContent>
              </Select>
            )}
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={resetFilters} className="h-9 px-2 text-muted-foreground">
                <X className="h-4 w-4 mr-1" /> Clear
              </Button>
            )}
            <span className="text-xs font-serif text-muted-foreground ml-auto">{filtered.length} of {dvds.length}</span>
          </div>
        </div>

        {loading ? (
          <p className="text-muted-foreground font-serif">Loading…</p>
        ) : filtered.length === 0 ? (
          <p className="text-muted-foreground font-serif text-center py-12">No DVDs match your search.</p>
        ) : (
          <Card className="glass overflow-hidden">
            <ul className="divide-y divide-border/60">
              {filtered.map(d => {
                const out = d.copies_available <= 0;
                const fmt = parseNote(d.notes, 'Format');
                return (
                  <li key={d.id} className="flex items-center gap-3 p-3">
                    {/* Nothing has cover art yet, but admins can set one per title, so keep the slot. */}
                    <div className="h-16 w-11 shrink-0 bg-muted rounded overflow-hidden">
                      {d.cover_url
                        ? <img src={d.cover_url} alt={d.title} className="w-full h-full object-cover" loading="lazy" />
                        : <div className="w-full h-full flex items-center justify-center"><Disc className="h-5 w-5 text-muted-foreground/40" /></div>}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-display uppercase text-sm leading-tight truncate">{d.title}</p>
                      <p className="text-xs text-muted-foreground font-serif truncate">
                        {[d.year, d.director].filter(Boolean).join(' • ')}
                      </p>
                      {d.genre && <p className="text-xs text-accent font-serif italic truncate">{d.genre}</p>}
                    </div>
                    <div className="hidden sm:flex items-center gap-2 shrink-0">
                      {fmt && <Badge variant="outline" className="text-[10px] font-serif">{fmt}</Badge>}
                      {out && <Badge variant="outline" className="text-[10px] bg-background/90">Checked out</Badge>}
                    </div>
                    <span className="font-display text-primary shrink-0 w-14 text-right">
                      ${Number(d.rental_price).toFixed(2)}
                    </span>
                    <div className="shrink-0">{reserveControl(d)}</div>
                  </li>
                );
              })}
            </ul>
          </Card>
        )}
      </div>
    </>
  );
}