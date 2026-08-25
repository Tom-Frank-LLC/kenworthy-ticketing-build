/**
 * Backstage: the shared vocabulary of the unlisted /backstage page and the
 * admin tab that fills it.
 *
 * Both sides need the same two rules — what order photographs go in, and what
 * a screen reader is told about one — and neither rule is a fetch. Putting
 * them here keeps the grid and the admin list from disagreeing about order,
 * which is the sort of drift nobody notices until a photograph is in the wrong
 * place on a page nobody has bookmarked.
 */

/** The bucket the photographs live in. Public read, admin write. */
export const BACKSTAGE_BUCKET = 'backstage-photos';

/**
 * MIME types the gallery can draw. Matches the bucket's allowed_mime_types,
 * which is the check that actually holds — this one only spares the admin an
 * upload that storage would refuse.
 */
export const BACKSTAGE_ACCEPTED_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/avif',
] as const;

export interface BackstagePhoto {
  id: string;
  caption: string | null;
  file_path: string;
  display_order: number;
  created_at: string;
}

/**
 * Grid order: the admin's display_order first, newest first within a tie.
 *
 * display_order defaults to 0, so "everything at 0" is the common case rather
 * than the edge case — which makes the tiebreak the rule that actually runs.
 * created_at descending puts the most recent event at the front of a gallery
 * nobody has ordered by hand, and id last so the sort is total and two
 * photographs uploaded in the same millisecond cannot swap between renders.
 */
export function orderBackstagePhotos<T extends BackstagePhoto>(photos: T[]): T[] {
  return [...photos].sort(
    (a, b) =>
      a.display_order - b.display_order ||
      b.created_at.localeCompare(a.created_at) ||
      a.id.localeCompare(b.id),
  );
}

/**
 * What a screen reader is told about a photograph.
 *
 * The caption is the alt text — it is the only description of the image that
 * exists, and writing it twice would mean the sighted and unsighted readings
 * could drift. An uncaptioned photograph still needs *something*: `alt=""`
 * would be a claim that the image is decorative, and these images are the
 * content of the page.
 */
export function backstageAltText(photo: Pick<BackstagePhoto, 'caption'>): string {
  const caption = photo.caption?.trim();
  return caption || 'An event in the Backstage speakeasy at Kenworthy';
}

/*
 * `backstageParagraphs()` used to live here, splitting the stored copy on blank
 * lines. The body is written in the admin rich-text editor now and stored as
 * HTML, which has no blank lines to split on — it would have returned the whole
 * document as a single paragraph and printed the tags. `<RichText>` renders it
 * instead, and handles the rows written before the editor shipped by way of
 * `toRichHtml`, which reproduces exactly the blank-line split this did.
 *
 * Its docstring also claimed "never as HTML, because an admin textarea is not a
 * safe place to accept markup from". That was true of a raw textarea. What
 * makes it safe now is not that the writers became trustworthy — /host lets an
 * external organiser write to these columns — but that every value is put
 * through the allowlist in src/lib/richText.ts on the way to the screen.
 */
