/**
 * Resolve a user-supplied trailer URL into something we can embed.
 * Supports: YouTube (watch, youtu.be, shorts), Vimeo, and direct mp4/webm files.
 * Returns null when the URL isn't recognized.
 */
export type TrailerEmbed =
  | { kind: 'youtube'; id: string; src: string }
  | { kind: 'vimeo'; id: string; src: string }
  | { kind: 'file'; src: string };

export function resolveTrailer(
  url: string | null | undefined,
  opts?: {
    autoplay?: boolean;
    muted?: boolean;
    /** Show the player's own controls. Off by default — the home marquee is ambient. */
    controls?: boolean;
    /** Loop the clip. On by default, again for the marquee. */
    loop?: boolean;
  },
): TrailerEmbed | null {
  if (!url) return null;
  const autoplay = opts?.autoplay ? 1 : 0;
  const muted = opts?.muted ? 1 : 0;
  const controls = opts?.controls ? 1 : 0;
  const loop = opts?.loop === false ? 0 : 1;
  let trimmed = url.trim();
  if (!trimmed) return null;

  // YouTube
  const yt =
    trimmed.match(/(?:youtube\.com\/(?:watch\?v=|shorts\/|embed\/)|youtu\.be\/)([\w-]{6,})/i);
  if (yt) {
    const id = yt[1];
    const params = new URLSearchParams({
      autoplay: String(autoplay),
      mute: String(muted),
      controls: String(controls),
      modestbranding: '1',
      rel: '0',
      playsinline: '1',
      loop: String(loop),
    });
    if (loop) params.set('playlist', id); // required for loop on YouTube
    return { kind: 'youtube', id, src: `https://www.youtube.com/embed/${id}?${params.toString()}` };
  }

  // Vimeo
  const vm = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/i);
  if (vm) {
    const id = vm[1];
    const params = new URLSearchParams({
      autoplay: String(autoplay),
      muted: String(muted),
      loop: String(loop),
      // background=1 is Vimeo's chromeless ambient mode; it also suppresses controls.
      background: controls ? '0' : '1',
      controls: String(controls),
    });
    return { kind: 'vimeo', id, src: `https://player.vimeo.com/video/${id}?${params.toString()}` };
  }

  // Direct file
  if (/\.(mp4|webm|mov|m4v)(\?.*)?$/i.test(trimmed)) {
    return { kind: 'file', src: trimmed };
  }

  return null;
}