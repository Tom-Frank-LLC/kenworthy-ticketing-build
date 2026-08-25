import { Heart } from 'lucide-react';
import { SEO } from '@/components/SEO';
import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SponsorshipOpportunityCard } from '@/components/SponsorshipOpportunityCard';
import type { SponsorshipOpportunity } from '@/lib/sponsorshipPdf';


export default function Sponsors() {
  const [opportunities, setOpportunities] = useState<(SponsorshipOpportunity & { id: string })[]>([]);

  useEffect(() => {
    (supabase as any)
      .from('sponsorship_opportunities')
      .select('id,slug,title,tagline,intro_text,hook_text,cta_label,section_heading,section_body,benefits,stats_text,price_text,availability_text,hero_image_url,display_order,is_active,created_by,created_at,updated_at')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .then(({ data }: any) => setOpportunities(data || []));
  }, []);

  return (
    <div className="container py-16 max-w-5xl">
      <SEO
        title="Our Sponsors — Kenworthy Performing Arts Centre"
        description="Meet the foundations, businesses, and friends whose support sustains Kenworthy, Moscow Idaho's historic non-profit cinema and performing arts centre."
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

      {opportunities.length > 0 && (
        <section className="mb-20">
          <div className="text-center mb-8">
            <p className="text-xs uppercase tracking-[0.3em] text-accent font-display mb-3">
              Now Accepting
            </p>
            <h2 className="font-display text-3xl md:text-4xl uppercase tracking-wide text-foreground">
              Current Sponsorship Opportunities
            </h2>
          </div>
          <div className="space-y-8">
            {opportunities.map((o) => (
              <SponsorshipOpportunityCard key={o.id} opportunity={o} />
            ))}
          </div>
        </section>
      )}

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
          cultural, and economic vitality of Moscow's Main Street. Kenworthy
          presents an array of innovative programs — film, theatre, opera and
          more — that bring recognition and exposure to the businesses,
          foundations, and agencies whose financial support keeps it all
          running.
        </p>
        <p className="font-serif text-muted-foreground leading-relaxed mb-8">
          For your annual investment in the historic cinema in downtown Moscow,
          your business will receive a valuable ROI that maintains the same
          creative and collaborative spirit Kenworthy has been known to
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
