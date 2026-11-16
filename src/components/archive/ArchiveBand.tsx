/** The strip across the top of a page from the screening archive. */
export function ArchiveBand() {
  return (
    <div className="mb-6 rounded-lg border border-accent/40 bg-archive-band px-4 py-2.5 text-center">
      <p className="font-display text-sm uppercase tracking-[0.25em] text-accent">
        <span aria-hidden="true">✦ </span>
        From the Kenworthy archive
        <span aria-hidden="true"> ✦</span>
      </p>
    </div>
  );
}
