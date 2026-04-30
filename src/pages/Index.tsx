import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { ProductionDetailDrawer } from '@/components/ProductionDetailDrawer';
import { TrailerFeed, type FeedItem } from '@/components/home/TrailerFeed';
import { EditorialCalendar } from '@/components/home/EditorialCalendar';
import { BackstageTeaser } from '@/components/home/BackstageTeaser';
import { ConcessionsPreview } from '@/components/home/ConcessionsPreview';
import { InstagramFeed } from '@/components/home/InstagramFeed';

type ProductionType = 'movie' | 'event' | 'concert';

interface RawShowing {
  id: string;
  start_time: string;
  ticket_price: number;
  movie_id: string | null;
  event_id: string | null;
  live_performance_id: string | null;
}

interface RawProduction {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  trailer_url: string | null;
  rating?: string | null;
  genre?: string | null;
  is_featured?: boolean;
  // event-only
  ticket_type?: string;
  rsvp_url?: string | null;
}

function buildFeed(
  productions: Array<{ row: RawProduction; type: ProductionType }>,
  showings: RawShowing[],
): { feed: FeedItem[]; productionsById: Map<string, RawProduction & { type: ProductionType }> } {
  const byId = new Map<string, RawProduction & { type: ProductionType }>();
  for (const { row, type } of productions) {
    byId.set(`${type}:${row.id}`, { ...row, type });
  }

  const items: FeedItem[] = [];
  for (const s of showings) {
    let type: ProductionType | null = null;
    let prodId: string | null = null;
    if (s.movie_id) { type = 'movie'; prodId = s.movie_id; }
    else if (s.event_id) { type = 'event'; prodId = s.event_id; }
    else if (s.live_performance_id) { type = 'concert'; prodId = s.live_performance_id; }
    if (!type || !prodId) continue;

    const prod = byId.get(`${type}:${prodId}`);
    if (!prod) continue;

    items.push({
      id: `${type}-${prodId}-${s.id}`,
      title: prod.title,
      posterUrl: prod.poster_url,
      trailerUrl: prod.trailer_url,
      startTime: s.start_time,
      showingId: s.id,
      type,
      ticketType: prod.ticket_type,
      rsvpUrl: prod.rsvp_url,
      curatorNote: prod.description,
      isFeatured: prod.is_featured ?? false,
    });
  }

  // Also include RSVP / info-only events that have no showings,
  // so the artistic team's curated work doesn't disappear from the page.
  const showingProdIds = new Set(items.map((i) => `${i.type}:${i.title}`));
  for (const { row, type } of productions) {
    if (type !== 'event') continue;
    const hasShowings = showings.some((s) => s.event_id === row.id);
    if (hasShowings) continue;
    if (row.ticket_type === 'rsvp' || row.ticket_type === 'info_only') {
      // Place these at the very end with a far-future sort key,
      // but still surface them below the dated calendar.
      const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
      items.push({
        id: `${type}-${row.id}-standalone`,
        title: row.title,
        posterUrl: row.poster_url,
        trailerUrl: row.trailer_url,
        startTime: farFuture,
        showingId: null,
        type,
        ticketType: row.ticket_type,
        rsvpUrl: row.rsvp_url,
        curatorNote: row.description,
        isFeatured: row.is_featured ?? false,
      });
    }
  }

  items.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return { feed: items, productionsById: byId };
}

export default function Index() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [productionsById, setProductionsById] = useState<
    Map<string, RawProduction & { type: ProductionType }>
  >(new Map());
  const [loading, setLoading] = useState(true);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selectedProduction, setSelectedProduction] = useState<any>(null);

  useEffect(() => {
    async function fetchAll() {
      const now = new Date().toISOString();
      const [moviesRes, eventsRes, concertsRes, showingsRes] = await Promise.all([
        supabase.from('movies').select('*').eq('is_active', true),
        supabase.from('events').select('*').eq('is_active', true),
        supabase.from('live_performances').select('*').eq('is_active', true),
        supabase
          .from('showings')
          .select('*')
          .eq('is_active', true)
          .gte('start_time', now)
          .order('start_time'),
      ]);

      const productions: Array<{ row: RawProduction; type: ProductionType }> = [
        ...(moviesRes.data || []).map((row) => ({ row: row as RawProduction, type: 'movie' as const })),
        ...(eventsRes.data || []).map((row) => ({ row: row as RawProduction, type: 'event' as const })),
        ...(concertsRes.data || []).map((row) => ({ row: row as RawProduction, type: 'concert' as const })),
      ];

      const { feed, productionsById } = buildFeed(productions, (showingsRes.data || []) as RawShowing[]);
      setFeed(feed);
      setProductionsById(productionsById);
      setLoading(false);
    }
    fetchAll();
  }, []);

  const handleSelect = (item: FeedItem) => {
    const prod = productionsById.get(`${item.type}:${item.id.split('-')[1]}`);
    // The id format is `${type}-${prodId}-${showingId|standalone}`.
    // Pull the production by reconstructing the key from the type and the
    // production id segment (the second hyphen-separated chunk).
    const segs = item.id.split('-');
    const key = `${item.type}:${segs[1]}`;
    const fullProd = productionsById.get(key) ?? prod;
    if (fullProd) {
      setSelectedProduction({ ...fullProd, type: item.type });
      setDrawerOpen(true);
    }
  };

  const empty = !loading && feed.length === 0;

  return (
    <>
      {/* Mobile: stacked. Desktop (lg+): split-scroll, two independently scrolling rails. */}
      <div className="lg:h-[calc(100vh-68px-1px)] lg:overflow-hidden">
        <div className="lg:grid lg:grid-cols-[45fr_35fr_20fr] lg:h-full">
          {/* LEFT — Trailer feed */}
          <div className="lg:h-full lg:border-r lg:border-accent/20 lg:relative">
            <div className="h-[80vh] lg:h-full">
              {loading ? (
                <div className="h-full flex items-center justify-center">
                  <div className="font-serif italic text-muted-foreground">
                    Warming up the projector…
                  </div>
                </div>
              ) : empty ? (
                <div className="h-full flex items-center justify-center p-8 text-center">
                  <p className="font-serif text-muted-foreground max-w-sm">
                    The marquee is dark for the moment. Check back soon for what's
                    coming next on Main Street.
                  </p>
                </div>
              ) : (
                <TrailerFeed items={feed} onSelect={handleSelect} />
              )}
            </div>
          </div>

          {/* MIDDLE — Editorial calendar */}
          <div className="lg:h-full lg:border-r lg:border-accent/20 lg:overflow-hidden">
            {loading ? (
              <div className="p-10 space-y-6">
                <div className="h-4 w-40 bg-muted rounded animate-pulse" />
                <div className="h-12 w-3/4 bg-muted rounded animate-pulse" />
                <div className="h-4 w-2/3 bg-muted rounded animate-pulse" />
                <div className="h-64 bg-muted rounded animate-pulse" />
              </div>
            ) : (
              <EditorialCalendar items={feed} onSelect={handleSelect} />
            )}
          </div>

          {/* RIGHT — Instagram feed (sidebar on desktop, stacked below on mobile) */}
          <div className="lg:h-full lg:overflow-hidden">
            <InstagramFeed className="h-full" />
          </div>
        </div>
      </div>

      {/* Concessions menu — pulled live from the editable concession_items
          table, so the admin Concessions tab is the single source of truth. */}
      <ConcessionsPreview />

      {/* A quiet whisper at the bottom of the page — the speakeasy room
          tucked inside the Kenworthy. On desktop the split-scroll fills the
          viewport, so this section is the natural reward for scrolling past
          either rail. */}
      <BackstageTeaser />

      <ProductionDetailDrawer
        production={selectedProduction}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
