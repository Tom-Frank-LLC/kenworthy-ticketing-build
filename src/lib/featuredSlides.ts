/**
 * Featured slides: the shared vocabulary of the home-page curator carousel and
 * the admin tab that fills it.
 *
 * A slide is the second source of picks in that carousel. The first is the
 * feed — a movie, event or live performance flagged `is_featured`, or one
 * flagged showing — and everything there is a thing you can buy a ticket to.
 * A slide is not. It is a picture, a headline, a sentence and a link, and it
 * exists so that a page with nothing to sell (`/silent-film-festival`,
 * `/backstage`, `/rentals`) can be the thing the curator points at.
 *
 * Three rules live here rather than in either component, because both sides
 * need to agree on them and getting them from the same place is what stops
 * the admin list and the public band from describing different worlds:
 * what order slides go in, whether a slide is live right now, and what
 * counts as a link.
 */

import { htmlToPlainText } from '@/lib/richText';

/** The bucket slide images live in. Public read, admin write. */
export const SLIDE_BUCKET = 'featured-slides';

/**
 * MIME types a slide image may be. Matches the bucket's allowed_mime_types,
 * which is the check that actually holds — this one only spares the admin an
 * upload that storage would refuse.
 */
export const SLIDE_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

/** A row of `public.featured_slides`, as both sides read it. */
export interface FeaturedSlide {
  id: string;
  title: string;
  /** Editor HTML, rendered through <RichText> exactly as a curator's note is. */
  blurb: string | null;
  image_path: string | null;
  image_alt: string | null;
  link_url: string;
  cta_label: string;
  is_active: boolean;
  display_order: number;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
}

/**
 * A slide as the carousel renders it: the row, plus the URL its image resolves
 * to.
 *
 * The URL is not in the row. `image_path` is an object path, and turning one
 * into a URL means the Supabase client and a transform parameter — which would
 * drag the client into a component whose whole job is markup, and into every
 * test that renders it. Resolved once where the fetch happens
 * (`useFeaturedSlides`), so the component stays a function of its props.
 */
export interface FeaturedSlideView extends FeaturedSlide {
  /** Resolved public URL, already sized. Null when the slide has no image. */
  imageUrl: string | null;
}

/** The columns every read of the table asks for. One list, so they cannot drift. */
export const SLIDE_COLUMNS =
  'id, title, blurb, image_path, image_alt, link_url, cta_label, is_active, display_order, starts_at, ends_at, created_at';

/**
 * Carousel order: the admin's display_order first, oldest first within a tie.
 *
 * display_order defaults to 0, so "everything at 0" is the common case rather
 * than the edge case — which makes the tiebreak the rule that actually runs.
 * created_at *ascending* here, unlike the Backstage gallery: that grid is a
 * scrapbook where the newest event is the most interesting, while this is a
 * running order an admin builds one slide at a time, and a new slide silently
 * jumping the queue in front of the one already there is a surprise. Id last,
 * so the sort is total and two slides written in the same millisecond cannot
 * swap between renders.
 */
export function orderSlides<T extends Pick<FeaturedSlide, 'display_order' | 'created_at' | 'id'>>(
  slides: T[],
): T[] {
  return [...slides].sort(
    (a, b) =>
      a.display_order - b.display_order ||
      a.created_at.localeCompare(b.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * Whether a slide is on the page at this instant.
 *
 * The same rule as the RLS policy behind the table, deliberately duplicated.
 * RLS is what makes a hidden slide *unreadable*, and it is the one that has to
 * hold; this one exists because the admin can read every row and its list has
 * to be able to say which of them the public is actually seeing. Two copies of
 * one rule is a cost, and it is why the rule is one function rather than three
 * inline date comparisons.
 *
 * `now` is a parameter so a test can state the instant rather than schedule
 * itself around the wall clock.
 */
export function isSlideLive(
  slide: Pick<FeaturedSlide, 'is_active' | 'starts_at' | 'ends_at'>,
  now: Date = new Date(),
): boolean {
  if (!slide.is_active) return false;
  const t = now.getTime();
  if (slide.starts_at && new Date(slide.starts_at).getTime() > t) return false;
  if (slide.ends_at && new Date(slide.ends_at).getTime() <= t) return false;
  return true;
}

/**
 * Is this link somewhere on this site?
 *
 * A rooted path is followed by the router, so the reader keeps the app; an
 * absolute URL is a real navigation off it. The leading-slash test has to
 * refuse `//evil.com`, which looks like a path and is not one — it is a
 * protocol-relative URL, and treating it as internal would hand an off-site
 * destination to `<Link>`, which would then render it as a same-tab link with
 * no `rel="noopener"` on it.
 */
export function isInternalLink(url: string): boolean {
  return /^\/[^/\s]/.test(url.trim());
}

/**
 * What the admin form accepts, mirroring `featured_slides_link_shape`.
 *
 * Returns the problem, or null when the link is fine. The database constraint
 * is the check that holds — this one exists so the admin is told what is wrong
 * before the round trip, in words rather than as a constraint-violation
 * message naming a regex.
 */
export function linkUrlProblem(raw: string): string | null {
  const url = raw.trim();
  if (!url) return 'A slide needs somewhere to go.';
  if (isInternalLink(url)) return null;
  if (/^https:\/\/\S+$/.test(url)) return null;
  if (/^http:\/\//i.test(url)) {
    return 'Use https:// — an http link from the home page warns the reader before it loads.';
  }
  if (/^\/\//.test(url)) {
    return 'A link starting // goes to another site. Write the full https:// address, or a path like /rentals.';
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
    return 'Only https:// links and paths on this site are allowed.';
  }
  return 'Write a path on this site (/silent-film-festival) or a full https:// address.';
}

/**
 * What a screen reader is told about a slide image.
 *
 * `image_alt` first, because the title says what the slide is *for* and alt
 * text has to say what the picture *shows* — "Kenworthy Silent Film Festival"
 * describes the promotion, not the photograph of an organist at a Wurlitzer.
 * The title is the fallback rather than `alt=""`, because these images are the
 * content of the slide and calling them decorative would be a lie.
 */
export function slideAltText(slide: Pick<FeaturedSlide, 'title' | 'image_alt'>): string {
  return slide.image_alt?.trim() || slide.title;
}

/**
 * Search, the same shape the feed's own filter has.
 *
 * The carousel is handed the *filtered* feed, so a query narrows the picks
 * along with the listing above them. A manual slide has to narrow with them:
 * left unfiltered it would sit next to a one-item result as an unrelated
 * advertisement, and filtered out entirely it would vanish the moment anyone
 * typed. Title and blurb, which is everything a slide says — the blurb
 * stripped first, or a search for "li" hits every slide with a list in it.
 */
export function filterSlides<T extends Pick<FeaturedSlide, 'title' | 'blurb'>>(
  slides: T[],
  query: string,
): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return slides;
  return slides.filter(
    (s) =>
      s.title.toLowerCase().includes(q) ||
      htmlToPlainText(s.blurb).toLowerCase().includes(q),
  );
}
