/**
 * schema.org blobs, built from the same rows the page renders.
 *
 * `Event` here is richer than the client-side one in Showing.tsx on purpose:
 * this is the copy crawlers see (Phase 3 of BRIEF-seo-crawlability.md), so it
 * carries `offers`, `endDate`, `location.geo` and `organizer`. Sold-out and
 * free showings are read from the showing row through the same helpers the
 * buy button uses, so the card and the page cannot disagree.
 */
import { htmlToPlainText } from '../src/lib/plainText';
import {
  isManuallySoldOut,
  isPast,
  needsNoTicket,
  showingEndsAt,
} from '../src/lib/purchasable';
import { DEFAULT_OG_IMAGE_PATH, VENUE } from './site';
import type { ShowingRow } from './data';

export function venueJsonLd(siteUrl: string): Record<string, unknown> {
  return {
    '@context': 'https://schema.org',
    '@type': ['PerformingArtsTheater', 'MovieTheater'],
    '@id': `${siteUrl}/#venue`,
    name: VENUE.name,
    url: `${siteUrl}/`,
    logo: `${siteUrl}/apple-touch-icon.png`,
    image: `${siteUrl}${DEFAULT_OG_IMAGE_PATH}`,
    telephone: VENUE.telephone,
    email: VENUE.email,
    foundingDate: VENUE.foundingDate,
    address: VENUE.address,
    geo: VENUE.geo,
    sameAs: VENUE.sameAs,
  };
}

export type ProductionKind = 'movie' | 'event' | 'concert';

export function productionOf(showing: ShowingRow): { kind: ProductionKind; title: string; description: string | null; poster: string | null; duration: number | null } | null {
  if (showing.events) {
    return { kind: 'event', title: showing.events.title, description: showing.events.description, poster: showing.events.poster_url, duration: null };
  }
  if (showing.live_performances) {
    return { kind: 'concert', title: showing.live_performances.title, description: showing.live_performances.description, poster: showing.live_performances.poster_url, duration: null };
  }
  if (showing.movies) {
    return { kind: 'movie', title: showing.movies.title, description: showing.movies.description, poster: showing.movies.poster_url, duration: showing.movies.duration_minutes };
  }
  return null;
}

/** The lowest price a patron can pay, from the active tiers or the flat price. */
export function lowestPrice(showing: ShowingRow): number {
  const tiers = (showing.showing_price_tiers ?? []).filter((t) => t.is_active !== false).map((t) => Number(t.price)).filter((n) => Number.isFinite(n));
  if (tiers.length > 0) return Math.min(...tiers);
  const flat = Number(showing.ticket_price);
  return Number.isFinite(flat) ? flat : 0;
}

export function showingJsonLd(showing: ShowingRow, siteUrl: string, now: number = Date.now()): Record<string, unknown> | null {
  const production = productionOf(showing);
  if (!production) return null;
  const url = `${siteUrl}/showing/${showing.id}`;
  const runtime = { duration_minutes: production.duration };
  const past = isPast(showing, runtime, now);
  const soldOut = isManuallySoldOut(showing);
  const free = needsNoTicket(showing) || lowestPrice(showing) === 0;

  const availability = soldOut
    ? 'https://schema.org/SoldOut'
    : past
      ? 'https://schema.org/Discontinued'
      : 'https://schema.org/InStock';

  const endMs = showingEndsAt(showing, runtime).getTime();
  const endDate = Number.isFinite(endMs) ? new Date(endMs).toISOString() : undefined;

  const blob: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': production.kind === 'movie' ? 'ScreeningEvent' : production.kind === 'concert' ? 'MusicEvent' : 'Event',
    '@id': `${url}#event`,
    name: production.title,
    description: htmlToPlainText(production.description) || undefined,
    image: production.poster || `${siteUrl}${DEFAULT_OG_IMAGE_PATH}`,
    url,
    startDate: showing.start_time,
    endDate,
    eventStatus: 'https://schema.org/EventScheduled',
    eventAttendanceMode: 'https://schema.org/OfflineEventAttendanceMode',
    isAccessibleForFree: free,
    location: {
      '@type': 'Place',
      '@id': `${siteUrl}/#venue`,
      name: showing.venues?.name && showing.venues.name !== 'Main Theater' ? `${VENUE.name} — ${showing.venues.name}` : VENUE.name,
      address: VENUE.address,
      geo: VENUE.geo,
    },
    organizer: {
      '@type': 'Organization',
      name: VENUE.name,
      url: `${siteUrl}/`,
    },
    performer: {
      '@type': 'Organization',
      name: VENUE.name,
    },
    offers: {
      '@type': 'Offer',
      url,
      price: lowestPrice(showing).toFixed(2),
      priceCurrency: 'USD',
      availability,
      validFrom: showing.created_at ?? undefined,
    },
  };
  if (production.kind === 'movie') {
    blob.workPresented = { '@type': 'Movie', name: production.title, image: production.poster || undefined };
  }
  return blob;
}
