/**
 * Facts about the theatre that the Worker prints into every page's head.
 *
 * Kept in one place so the venue JSON-LD, the Event JSON-LD's `location`,
 * and the default share card all agree. The address and phone match the
 * kenworthy.org footer and the Google Business Profile; the coordinates are
 * OpenStreetMap's for the building itself (way 265368863, tagged
 * amenity=cinema), fetched 2026-09-05.
 */
export const VENUE = {
  name: 'Kenworthy Performing Arts Centre',
  telephone: '+1-208-882-4127',
  email: 'events@kenworthy.org',
  foundingDate: '1926',
  address: {
    '@type': 'PostalAddress',
    streetAddress: '508 S Main St',
    addressLocality: 'Moscow',
    addressRegion: 'ID',
    postalCode: '83843',
    addressCountry: 'US',
  },
  geo: {
    '@type': 'GeoCoordinates',
    latitude: 46.7307309,
    longitude: -117.0009679,
  },
  sameAs: ['https://www.instagram.com/kenworthypac/'],
} as const;

/** The branded 1200×630 share card in public/. */
export const DEFAULT_OG_IMAGE_PATH = '/og-default.jpg';

export const DEFAULT_TITLE = 'Kenworthy Performing Arts Centre — Moscow, Idaho · Since 1926';
export const DEFAULT_DESCRIPTION =
  'A century of stories on Main Street. Films, live performances, and events at the Kenworthy Performing Arts Centre in Moscow, Idaho.';
