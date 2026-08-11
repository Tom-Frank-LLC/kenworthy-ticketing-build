import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { FeedItem } from '@/components/home/TrailerFeed';

type ProductionType = 'movie' | 'event' | 'concert';

export interface FullProduction {
  id: string;
  title: string;
  description: string | null;
  poster_url: string | null;
  trailer_url: string | null;
  rating?: string | null;
  genre?: string | null;
  is_featured?: boolean;
  ticket_type?: string;
  rsvp_url?: string | null;
  type: ProductionType;
}

export function useFeed() {
  const [feed, setFeed] = useState<FeedItem[]>([]);
  const [productionsById, setProductionsById] = useState<Map<string, FullProduction>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const now = new Date().toISOString();
      const [moviesRes, eventsRes, concertsRes, showingsRes] = await Promise.all([
        supabase
          .from('movies')
          .select('id,title,description,poster_url,duration_minutes,rating,genre,is_active,created_at,updated_at,trailer_url,is_featured,release_year,release_label,pass_processing_fee')
          .eq('is_active', true),
        supabase.from('events').select('*').eq('is_active', true),
        supabase.from('live_performances').select('*').eq('is_active', true),
        supabase
          .from('showings')
          .select('*')
          .eq('is_active', true)
          .gte('start_time', now)
          .order('start_time'),
      ]);

      const byId = new Map<string, FullProduction>();
      const push = (row: any, type: ProductionType) => byId.set(`${type}:${row.id}`, { ...row, type });
      (moviesRes.data || []).forEach((r) => push(r, 'movie'));
      (eventsRes.data || []).forEach((r) => push(r, 'event'));
      (concertsRes.data || []).forEach((r) => push(r, 'concert'));

      const items: FeedItem[] = [];
      for (const s of (showingsRes.data || []) as any[]) {
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
          productionId: prodId,
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
          ticketPrice: s.ticket_price,
        });
      }

      for (const prod of byId.values()) {
        if (prod.type !== 'event') continue;
        const hasShowings = items.some((i) => i.type === 'event' && i.productionId === prod.id);
        if (hasShowings) continue;
        if (prod.ticket_type === 'rsvp' || prod.ticket_type === 'info_only') {
          const farFuture = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
          items.push({
            id: `event-${prod.id}-standalone`,
            productionId: prod.id,
            title: prod.title,
            posterUrl: prod.poster_url,
            trailerUrl: prod.trailer_url,
            startTime: farFuture,
            showingId: null,
            type: 'event',
            ticketType: prod.ticket_type,
            rsvpUrl: prod.rsvp_url,
            curatorNote: prod.description,
            isFeatured: prod.is_featured ?? false,
            ticketPrice: s.ticket_price,
          });
        }
      }

      items.sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
      setFeed(items);
      setProductionsById(byId);
      setLoading(false);
    })();
  }, []);

  return { feed, productionsById, loading };
}

export function filterFeed(items: FeedItem[], query: string): FeedItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return items;
  return items.filter(
    (i) =>
      i.title.toLowerCase().includes(q) ||
      (i.curatorNote || '').toLowerCase().includes(q) ||
      i.type.toLowerCase().includes(q),
  );
}
