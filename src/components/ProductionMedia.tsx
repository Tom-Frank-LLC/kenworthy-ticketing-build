import { Badge } from '@/components/ui/badge';
import { Clock, Film, Music, Sparkles } from 'lucide-react';
import { formatRuntime, runtimeLabel } from '@/lib/datetime';
import { parseGenres } from '@/lib/genres';
import { resolveTrailer } from '@/lib/trailer';

export type ProductionMediaType = 'movie' | 'event' | 'concert';

const typeIcons = {
  movie: Film,
  event: Sparkles,
  concert: Music,
};

interface ProductionMediaProps {
  title: string;
  type: ProductionMediaType;
  posterUrl?: string | null;
  trailerUrl?: string | null;
  /**
   * 'video' locks the block to 16:9 and crops the poster to fill it (the
   * drawer's look). 'auto' lets a poster keep its own proportions — full-res
   * posters are portrait, so cropping them to 16:9 throws most of the art away.
   * Trailers are always 16:9 either way.
   */
  aspect?: 'video' | 'auto';
  /** 'icon' renders a placeholder tile when there is no trailer or poster. */
  fallback?: 'icon' | 'none';
  className?: string;
}

/**
 * Trailer-or-poster block shared by the production drawer and the ticketing
 * page, so the two can't drift apart. Trailer wins when both are present.
 */
export function ProductionMedia({
  title,
  type,
  posterUrl,
  trailerUrl,
  aspect = 'video',
  fallback = 'icon',
  className,
}: ProductionMediaProps) {
  const Icon = typeIcons[type];
  // resolveTrailer is the app's one trailer parser (also behind the home
  // marquee). It understands more of what an admin actually pastes than the
  // drawer's old inline regexes did — youtu.be, /shorts/, .mov, .m4v.
  const trailer = resolveTrailer(trailerUrl, { controls: true, loop: false });

  if (trailerUrl) {
    return (
      <div className={`aspect-video w-full bg-black ${className ?? ''}`}>
        {trailer?.kind === 'file' ? (
          <video src={trailer.src} controls className="w-full h-full object-contain" />
        ) : (
          // An unrecognised URL still gets an iframe attempt — same as before.
          <iframe
            src={trailer?.src ?? trailerUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={`${title} trailer`}
          />
        )}
      </div>
    );
  }

  if (posterUrl) {
    return aspect === 'video' ? (
      <div className={`aspect-video w-full bg-secondary flex items-center justify-center overflow-hidden ${className ?? ''}`}>
        <img src={posterUrl} alt={title} className="w-full h-full object-cover" />
      </div>
    ) : (
      <div className={`w-full bg-secondary overflow-hidden ${className ?? ''}`}>
        <img src={posterUrl} alt={title} className="w-full h-auto object-contain" />
      </div>
    );
  }

  if (fallback === 'none') return null;

  return (
    <div className={`aspect-video w-full bg-secondary flex items-center justify-center ${className ?? ''}`}>
      <Icon className="h-16 w-16 text-muted-foreground" />
    </div>
  );
}

interface ProductionMetaBadgesProps {
  rating?: string | null;
  genre?: string | null;
  durationMinutes?: number | null;
  className?: string;
}

/**
 * Rating / genre / runtime row. Renders nothing when all three are missing.
 *
 * A production can carry several genres in that one string, and each gets its
 * own badge — "Drama, Comedy" as a single badge reads as a genre called
 * "Drama, Comedy". The row already wraps, so a film with four of them pushes
 * the badges onto a second line instead of overflowing the card it sits in.
 */
export function ProductionMetaBadges({ rating, genre, durationMinutes, className }: ProductionMetaBadgesProps) {
  const runtime = formatRuntime(durationMinutes);
  const genres = parseGenres(genre);
  if (!rating && !genres.length && !runtime) return null;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className ?? ''}`}>
      {rating && <Badge>{rating}</Badge>}
      {genres.map(g => <Badge key={g} variant="secondary">{g}</Badge>)}
      {runtime ? (
        <span className="text-sm text-muted-foreground flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" aria-hidden="true" />
          {/* "1h 30m" is announced as letters ("one-h thirty-m"), so the
              spoken version is the spelled-out twin. An aria-label would not
              do it: this is a bare span, with no role to hang a name on. */}
          <span className="sr-only">{runtimeLabel(durationMinutes)}</span>
          <span aria-hidden="true">{runtime}</span>
        </span>
      ) : null}
    </div>
  );
}
