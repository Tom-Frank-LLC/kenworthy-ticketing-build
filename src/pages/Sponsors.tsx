import { Heart } from 'lucide-react';
import { SEO } from '@/components/SEO';
import iccu from '@/assets/sponsors/iccu.jpg.asset.json';
import ihc from '@/assets/sponsors/ihc.jpeg.asset.json';
import lsi from '@/assets/sponsors/lsi.jpg.asset.json';
import allstate from '@/assets/sponsors/allstate.png.asset.json';
import nrs from '@/assets/sponsors/nrs.png.asset.json';
import innovia from '@/assets/sponsors/innovia.png.asset.json';
import mt from '@/assets/sponsors/mt.png.asset.json';
import gritman from '@/assets/sponsors/gritman.png.asset.json';
import avista from '@/assets/sponsors/avista.png.asset.json';
import lmcf from '@/assets/sponsors/lmcf.jpg.asset.json';
import artsIdaho from '@/assets/sponsors/arts-idaho.jpg.asset.json';
import logo2018 from '@/assets/sponsors/logo-2018.png.asset.json';
import logo1 from '@/assets/sponsors/logo-1.png.asset.json';
import usbank from '@/assets/sponsors/usbank.png.asset.json';
import mwgc from '@/assets/sponsors/mwgc.jpg.asset.json';
import steppingstones from '@/assets/sponsors/steppingstones.jpg.asset.json';
import inb from '@/assets/sponsors/inb.png.asset.json';
import sponsorFb from '@/assets/sponsors/sponsor-fb.png.asset.json';
import dac from '@/assets/sponsors/dac.png.asset.json';

const SPONSORS: { name: string; src: string }[] = [
  { name: 'Idaho Humanities Council', src: ihc.url },
  { name: 'Idaho Central Credit Union', src: iccu.url },
  { name: 'Northwest River Supplies', src: nrs.url },
  { name: 'Innovia Foundation', src: innovia.url },
  { name: 'Avista', src: avista.url },
  { name: 'Gritman Medical Center', src: gritman.url },
  { name: 'U.S. Bank', src: usbank.url },
  { name: 'Inland Northwest Bank', src: inb.url },
  { name: 'Allstate', src: allstate.url },
  { name: 'LSI', src: lsi.url },
  { name: 'Moscow Title', src: mt.url },
  { name: 'Latah Moscow Community Foundation', src: lmcf.url },
  { name: 'Arts Idaho', src: artsIdaho.url },
  { name: 'MWGC', src: mwgc.url },
  { name: 'Stepping Stones', src: steppingstones.url },
  { name: 'DAC', src: dac.url },
  { name: 'Community supporter', src: logo1.url },
  { name: 'Community supporter', src: logo2018.url },
  { name: 'Community supporter', src: sponsorFb.url },
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
          providing an investment to the community's non-profit cinematic
          art-house theatre. This financial support has helped sustain and
          expand our renowned programming, education activities, and
          operations.
        </p>
      </header>

      <section className="mb-16">
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
          {SPONSORS.map((s, i) => (
            <div
              key={`${s.name}-${i}`}
              className="aspect-[3/2] bg-cream rounded-sm flex items-center justify-center p-5 hover:scale-[1.02] transition-transform"
            >
              <img
                src={s.src}
                alt={s.name}
                loading="lazy"
                className="max-h-full max-w-full object-contain"
              />
            </div>
          ))}
        </div>
      </section>

      <figure className="border-l-2 border-accent/40 pl-6 max-w-2xl mx-auto mb-16">
        <blockquote className="font-serif italic text-lg text-foreground/90 leading-relaxed">
          "This is such a cool opportunity! Thanks for letting us be a part of
          this!"
        </blockquote>
        <figcaption className="font-display uppercase tracking-wider text-xs text-muted-foreground mt-3">
          Clark Rasmussen · Idaho Central Credit Union
        </figcaption>
      </figure>

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
