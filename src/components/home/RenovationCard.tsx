/**
 * Quiet card surfacing the recently completed Kenworthy renovation —
 * sits below the Instagram feed in the right rail so the editorial
 * page also tells a brief preservation story.
 */
export function RenovationCard() {
  return (
    <section className="border-t border-accent/15 px-4 py-6">
      <p className="text-[10px] uppercase tracking-[0.2em] text-accent/70 font-display mb-2">
        On Main Street
      </p>
      <h3 className="font-display text-lg uppercase tracking-wide text-foreground leading-snug">
        The Renovation Is Complete
      </h3>
      <p className="font-serif text-sm italic text-muted-foreground leading-relaxed mt-3">
        Through the generous support of our community and foundational grants,
        the Kenworthy Chair Campaign was a huge success.
      </p>
      <ul className="mt-4 space-y-3 font-serif text-sm text-foreground/85">
        <li>
          <span className="font-display uppercase text-xs tracking-wider text-accent block mb-0.5">
            Art-Deco Chairs
          </span>
          270 ergonomic, historically representative theatre chairs.
        </li>
        <li>
          <span className="font-display uppercase text-xs tracking-wider text-accent block mb-0.5">
            Custom Carpet & Aisle Lighting
          </span>
          Art-Deco inspired carpet, illuminated by dimmable aisle lights that
          guide your way to and from your seat.
        </li>
      </ul>
    </section>
  );
}
