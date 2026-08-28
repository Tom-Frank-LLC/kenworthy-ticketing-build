import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import {
  SLIDE_BUCKET,
  SLIDE_COLUMNS,
  isSlideLive,
  orderSlides,
  type FeaturedSlide,
  type FeaturedSlideView,
} from '@/lib/featuredSlides';

/**
 * The hand-written slides the home-page carousel shows, ready to render.
 *
 * Three things happen here that the component must not have to do:
 *
 * **The window is applied twice.** RLS already hides an inactive or
 * out-of-window slide from `anon` — that is the check that holds, and it is
 * why a draft is unreadable rather than merely unrequested. It does not hold
 * for an admin, who is allowed to read every row so the admin list can show
 * drafts; without the second pass an admin browsing the public home page would
 * be the one person seeing next month's promo on it today. `is_active` goes in
 * the query so the common case is not fetched at all, and `isSlideLive` runs
 * over what comes back so the dates are applied to both audiences by the same
 * rule the admin list reports with.
 *
 * **The image is resized.** These are full-band images uploaded at whatever
 * size the poster came in at, and the storage render endpoint costs nothing to
 * ask for. 640px wide covers the 16rem column at 2× on a retina display.
 *
 * **A failure is silence.** The carousel has a second source — the picks
 * derived from the feed — so a broken read of this table means one source
 * missing, not a broken page. It is logged and dropped rather than thrown.
 */
export function useFeaturedSlides() {
  const [slides, setSlides] = useState<FeaturedSlideView[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      // `featured_slides` is not in the generated Supabase types yet, the same
      // as backstage_photos and press_page_content.
      const { data, error } = await (supabase as any)
        .from('featured_slides')
        .select(SLIDE_COLUMNS)
        .eq('is_active', true);

      if (cancelled) return;

      if (error) {
        console.warn('[featured_slides] could not load manual slides', error.message);
        setSlides([]);
        setLoading(false);
        return;
      }

      const now = new Date();
      const live = orderSlides(((data ?? []) as FeaturedSlide[]).filter((s) => isSlideLive(s, now)));

      setSlides(
        live.map((slide) => ({
          ...slide,
          imageUrl: slide.image_path ? slideImageUrl(slide.image_path) : null,
        })),
      );
      setLoading(false);
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  return { slides, loading };
}

/**
 * A slide image at the size the band actually draws it.
 *
 * `contain`, not the default `cover`: cover given only a width squashes the
 * image rather than scaling it. Same fix as the festival archive and the
 * Backstage thumbnails.
 */
export function slideImageUrl(path: string, width = 640): string {
  return supabase.storage.from(SLIDE_BUCKET).getPublicUrl(path, {
    transform: { width, resize: 'contain', quality: 75 },
  }).data.publicUrl;
}
