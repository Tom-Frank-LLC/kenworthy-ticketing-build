/**
 * A poster-shaped title card for an archive film with no poster.
 *
 * 8,573 of the 8,721 films in the screening archive have no poster, so without
 * this nearly every archive page would open on an empty space. Built from the
 * film's own facts (title, release year, the date it played here) in the
 * archive's vintage-print palette, so it reads as a period handbill rather
 * than a missing image. Pure markup: no generated or borrowed artwork.
 *
 * Colours are the --archive-* tokens in src/index.css; their contrast is
 * computed there. Gold --accent is never used as text on the paper (1.58:1).
 */
export function ArchiveTitleCard({
  title,
  releaseYear,
  playedOn,
  venueName,
  className,
}: {
  title: string;
  releaseYear?: number | null;
  /** When it played here, already formatted ("March 14, 1943"). */
  playedOn: string;
  /** The building's name that night: see kenworthyNameOn(). */
  venueName: string;
  className?: string;
}) {
  // Long titles step down a size so they wrap to a few lines, not a column of
  // single words. rem-based sizes, so browser zoom still scales them.
  const n = title.length;
  const titleSize = n <= 12 ? 'text-4xl' : n <= 24 ? 'text-3xl' : n <= 44 ? 'text-2xl' : 'text-xl';

  return (
    <div
      role="img"
      aria-label={`Title card: ${title}${releaseYear ? ` (${releaseYear})` : ''}, shown at the ${venueName} on ${playedOn}`}
      className={`aspect-[2/3] w-full rounded-lg bg-archive-paper p-2 text-archive-ink shadow-lg ${className ?? ''}`}
      style={{
        // Aged edges: a faint brass vignette, strongest at the corners and clear
        // of the middle where the text sits.
        backgroundImage:
          'radial-gradient(ellipse at center, transparent 55%, hsl(var(--archive-rule) / 0.22) 100%)',
      }}
    >
      <div className="flex h-full flex-col items-center justify-between rounded-md border-4 border-double border-archive-rule px-4 py-6 text-center">
        <div>
          <p aria-hidden="true" className="tracking-[0.5em] text-archive-rule">✦ ✦ ✦</p>
          <p className="mt-2 font-display text-xs uppercase tracking-[0.3em] text-archive-rule">
            Kenworthy presents
          </p>
        </div>

        <div className="w-full">
          <p className={`font-display uppercase leading-tight break-words hyphens-auto ${titleSize}`}>{title}</p>
          {releaseYear ? <p className="mt-2 italic text-archive-ink-muted">{releaseYear}</p> : null}
        </div>

        <div className="w-full">
          <div aria-hidden="true" className="mx-auto mb-3 h-px w-2/3 bg-archive-rule" />
          {/* Balanced, so "Kenworthy Performing Arts Centre" breaks into even lines
              on a phone instead of leaving "Centre" alone on the last one. */}
          <p className="text-balance font-display text-sm uppercase tracking-[0.2em]">{venueName}</p>
          <p className="text-xs text-archive-ink-muted">Moscow, Idaho</p>
          <p className="mt-2 font-display text-base uppercase tracking-wide text-archive-rule">{playedOn}</p>
        </div>
      </div>
    </div>
  );
}
