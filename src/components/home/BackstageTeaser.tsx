import { Link } from 'react-router-dom';
import backstageLogo from '@/assets/backstage-logo.svg';

/**
 * A quiet, speakeasy-styled teaser for the Backstage venue — the
 * after-hours room tucked inside the Kenworthy. Intentionally
 * understated: dim lighting, a hand-lettered sign, and a whispered
 * line of copy.
 *
 * The sign is the door. It links to /backstage and nothing else on the
 * site does — the page is deliberately absent from the header and footer
 * nav, so scrolling to the bottom of the home page is how it gets found.
 * There is no "click here" beside it on purpose; a speakeasy with a
 * button on the front is not one.
 *
 * That puts the whole accessible name on the link itself. A sighted
 * reader gets the hover glow and the cursor; everyone else gets
 * "Backstage — a speakeasy room inside the Kenworthy" read out as a
 * link, and a focus ring bright enough to find with a keyboard.
 */
export function BackstageTeaser() {
  return (
    <section
      aria-label="Backstage at the Kenworthy"
      className="relative overflow-hidden border-t border-accent/20 bg-[hsl(var(--background))]"
    >
      {/* Soft vignette + warm lamp glow to evoke a back-room speakeasy */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-70"
        style={{
          background:
            'radial-gradient(ellipse at 78% 30%, hsl(var(--accent) / 0.18), transparent 55%), radial-gradient(ellipse at 20% 80%, hsl(var(--primary) / 0.10), transparent 60%)',
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 40%, hsl(var(--background) / 0.85) 100%)',
        }}
      />

      <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-28">
        <div className="grid items-center gap-12 md:grid-cols-2">
          {/* Sign */}
          <div className="flex justify-center md:justify-start">
            <div className="relative">
              <div
                aria-hidden
                className="absolute -inset-8 rounded-full blur-3xl"
                style={{
                  background:
                    'radial-gradient(circle, hsl(var(--accent) / 0.25), transparent 70%)',
                }}
              />
              <Link
                to="/backstage"
                /* Explicit, rather than inherited from the image's alt text.
                   The alt describes what the sign *is*; the label says what
                   the link *does*, which is the thing a reader deciding
                   whether to follow it needs. */
                aria-label="Enter Backstage"
                className="group relative block w-[280px] cursor-pointer rounded-lg [transform:rotate(-2deg)] transition-transform duration-500 motion-safe:hover:scale-[1.02] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-4 focus-visible:ring-offset-background md:w-[360px]"
                style={{ aspectRatio: '3011.952 / 1387.634' }}
              >
                {/* The sign already glows; hovering turns it up rather than
                    adding an underline or a border the styling would fight. */}
                <img
                  src={backstageLogo}
                  alt="Backstage — a speakeasy room inside the Kenworthy"
                  width={3012}
                  height={1388}
                  className="absolute inset-0 h-full w-full object-contain transition-[filter] duration-500 [filter:drop-shadow(0_0_6px_hsl(333_90%_60%/0.85))_drop-shadow(0_0_18px_hsl(333_85%_55%/0.6))_drop-shadow(0_0_38px_hsl(333_80%_50%/0.45))_drop-shadow(0_8px_30px_rgba(0,0,0,0.6))] group-hover:[filter:drop-shadow(0_0_8px_hsl(333_90%_62%/1))_drop-shadow(0_0_26px_hsl(333_85%_58%/0.8))_drop-shadow(0_0_54px_hsl(333_80%_52%/0.6))_drop-shadow(0_8px_30px_rgba(0,0,0,0.6))] group-focus-visible:[filter:drop-shadow(0_0_8px_hsl(333_90%_62%/1))_drop-shadow(0_0_26px_hsl(333_85%_58%/0.8))_drop-shadow(0_0_54px_hsl(333_80%_52%/0.6))_drop-shadow(0_8px_30px_rgba(0,0,0,0.6))]"
                  loading="lazy"
                  decoding="async"
                />
              </Link>
            </div>
          </div>

          {/* Whisper */}
          <div className="space-y-5 text-center md:text-left">
            <p className="font-serif text-xs uppercase tracking-[0.3em] text-accent">
              After the credits roll
            </p>
            <h2 className="font-display text-4xl md:text-5xl text-foreground">
              There's a room behind the room.
            </h2>
            <p className="font-serif text-lg leading-relaxed text-muted-foreground max-w-md mx-auto md:mx-0">
              Backstage is the Kenworthy's after-hours speakeasy — low light,
              live music, a proper drink. Look for the unmarked door on the
              nights it's open. We'll be sharing what's on the chalkboard here
              soon.
            </p>
            <p className="font-serif italic text-sm text-muted-foreground/80">
              508 S Main St · Moscow, Idaho
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
