import { Heart } from 'lucide-react';
import { SEO } from '@/components/SEO';

const SPONSORS = [
  { name: 'Idaho Central Credit Union', short: 'ICCU' },
  { name: 'Northwest River Supplies', short: 'NRS' },
  { name: 'Innovia Foundation', short: 'Innovia' },
  { name: 'Allstate', short: 'Allstate' },
  { name: 'LSI', short: 'LSI' },
  { name: 'Moscow-Pullman Daily News', short: 'Print' },
];

export default function Sponsors() {
  return (
    <div className="container py-16 max-w-5xl">
      <SEO
        title="Our Sponsors — The Kenworthy Performing Arts Centre"
        description="Meet the foundations, businesses, and friends whose support sustains The Kenworthy, Moscow Idaho's historic non-profit cinema and performing arts centre."
      />
      <header className="text-center mb-14">
        <p className="text-xs uppercase tracking-[0.3em] text-accent font-display mb-3">
          Our Supporters
        </p>
        <h1 className="font-display text-5xl md:text-6xl uppercase tracking-wide text-foreground mb-6">
          Thank You
        </h1>
        <p className="font-serif italic text-lg text-muted-foreground max-w-2xl mx-auto leading-relaxed">
          To the foundations and businesses who have played a vital role in
          providing an investment in our community's non-profit cinematic
          art-house theatre. Your support helps sustain and expand our
          programming, education, and operations.
        </p>
      </header>

      <section className="mb-16">
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {SPONSORS.map((s) => (
            <div
              key={s.name}
              className="aspect-[3/2] border border-accent/20 bg-card/40 rounded-sm flex flex-col items-center justify-center p-6 text-center hover:border-accent/50 transition-colors"
            >
              <p className="font-display text-xl uppercase tracking-wide text-foreground">
                {s.short}
              </p>
              <p className="font-serif text-xs italic text-muted-foreground mt-1">
                {s.name}
              </p>
            </div>
          ))}
        </div>
        <p className="font-serif italic text-xs text-muted-foreground text-center mt-6">
          Logo placeholders — replace with sponsor artwork as it's provided.
        </p>
      </section>

      <section className="border-t border-accent/20 pt-12 max-w-3xl mx-auto text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-accent font-display mb-3">
          Making a Difference
        </p>
        <h2 className="font-display text-3xl uppercase tracking-wide text-foreground mb-6">
          Become an Investor
        </h2>
        <p className="font-serif text-muted-foreground leading-relaxed mb-4">
          Our business investors and friends are dedicated to the historical,
          cultural, and economic vitality of Moscow's Main Street. The Kenworthy
          presents an array of innovative programs — film, theatre, opera and
          more — that bring recognition and exposure to the businesses,
          foundations, and agencies whose financial support keeps it all
          running.
        </p>
        <p className="font-serif text-muted-foreground leading-relaxed mb-8">
          For your annual investment in the historic cinema in downtown Moscow,
          your business will receive a valuable ROI that maintains the same
          creative and collaborative spirit the Kenworthy has been known to
          provide for nearly a century.
        </p>
        <a
          href="mailto:events@kenworthy.org?subject=Becoming%20a%20Kenworthy%20Investor"
          className="inline-flex items-center gap-2 bg-primary text-primary-foreground font-display uppercase tracking-wider text-sm px-8 py-3 hover:bg-primary/90 transition-colors"
        >
          <Heart className="h-4 w-4" />
          Get the Investor Packet
        </a>
      </section>
    </div>
  );
}
