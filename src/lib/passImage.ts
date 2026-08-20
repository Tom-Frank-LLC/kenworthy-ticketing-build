import { supabase } from '@/integrations/supabase/client';

/**
 * Artwork for a film pass, scaled on the way out.
 *
 * Its own module rather than an export from FilmPasses, because the festival
 * page needs it too and importing it from there would drag that page's whole
 * chunk — the Square Web Payments SDK included — into a page that sells
 * nothing.
 *
 * `resize: 'contain'` is load-bearing. Supabase defaults to 'cover', and cover
 * given only a width does not scale the image: it squashes it to that width and
 * keeps the original height. That shipped once already, on the festival
 * archive, and every scanned page rendered compressed until it was caught.
 */
export const PASS_IMAGE_BUCKET = 'pass-images';

export const passImageUrl = (path: string, width = 200) =>
  supabase.storage.from(PASS_IMAGE_BUCKET).getPublicUrl(path, {
    transform: { width, resize: 'contain', quality: 70 },
  }).data.publicUrl;
