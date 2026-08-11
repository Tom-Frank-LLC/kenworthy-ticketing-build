import { Badge } from '@/components/ui/badge';
import { Clock, Film, Music, Sparkles } from 'lucide-react';

export type ProductionMediaType = 'movie' | 'event' | 'concert';

export function getEmbedUrl(url: string): string | null {
  // YouTube
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return `https://www.youtube.com/embed/${ytMatch[1]}`;
  // Vimeo
  const vimeoMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vimeoMatch) return `https://player.vimeo.com/video/${vimeoMatch[1]}`;
  return null;
}

export function isDirectVideo(url: string): boolean {
  return /\.(mp4|webm|ogg)(\?|$)/i.test(url);
}

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
  const embedUrl = trailerUrl ? getEmbedUrl(trailerUrl) : null;
  const directVideo = !!trailerUrl && isDirectVideo(trailerUrl);

  if (trailerUrl) {
    return (
      <div className={`aspect-video w-full bg-black ${className ?? ''}`}>
        {embedUrl ? (
          <iframe
            src={embedUrl}
            className="w-full h-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title={`${title} trailer`}
          />
        ) : directVideo ? (
          <video src={trailerUrl} controls className="w-full h-full object-contain" />
        ) : (
          // Fallback: try as iframe
          <iframe src={trailerUrl} className="w-full h-full" allowFullScreen title={`${title} trailer`} />
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

/** Rating / genre / runtime row. Renders nothing when all three are missing. */
export function ProductionMetaBadges({ rating, genre, durationMinutes, className }: ProductionMetaBadgesProps) {
  if (!rating && !genre && !durationMinutes) return null;

  return (
    <div className={`flex items-center gap-2 flex-wrap ${className ?? ''}`}>
      {rating && <Badge>{rating}</Badge>}
      {genre && <Badge variant="secondary">{genre}</Badge>}
      {durationMinutes ? (
        <span className="text-sm text-muted-foreground flex items-center gap-1">
          <Clock className="h-3.5 w-3.5" /> {durationMinutes} min
        </span>
      ) : null}
    </div>
  );
}
