import { Play } from 'lucide-react';
import { youtubeThumbnailUrl, youtubeWatchUrl } from '@/lib/trailer';

/**
 * A YouTube trailer where it cannot be embedded: the iOS app, where YouTube
 * refuses the player (see canEmbed in src/lib/trailer.ts). The video's own
 * still, and one tap opens it in YouTube or Safari — Capacitor hands any link
 * off the app's origin to the system.
 *
 * Fills its parent; callers keep their own 16:9 box.
 */
export function YouTubeLinkOut({ id, title }: { id: string; title: string }) {
  return (
    <a
      href={youtubeWatchUrl(id)}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Watch the ${title} trailer on YouTube`}
      className="group relative block h-full w-full overflow-hidden bg-black focus:outline-none focus-visible:ring-2 focus-visible:ring-white"
    >
      <img src={youtubeThumbnailUrl(id)} alt="" className="h-full w-full object-cover opacity-80" />
      <span className="absolute inset-0 flex flex-col items-center justify-center gap-3">
        <span className="flex h-16 w-16 items-center justify-center rounded-full bg-black/80 text-white ring-2 ring-white/80 transition-transform group-active:scale-95">
          <Play className="ml-1 h-8 w-8" fill="currentColor" aria-hidden="true" />
        </span>
        <span className="rounded bg-black/80 px-3 py-1 text-sm font-medium text-white">
          Watch the trailer on YouTube
        </span>
      </span>
    </a>
  );
}
