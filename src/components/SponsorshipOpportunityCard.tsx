import { Download, Mail } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  downloadSponsorshipPdf,
  type SponsorshipOpportunity,
} from '@/lib/sponsorshipPdf';

interface Props {
  opportunity: SponsorshipOpportunity & { id?: string };
}

export function SponsorshipOpportunityCard({ opportunity: o }: Props) {
  const benefits = o.benefits || [];
  return (
    <article className="border border-accent/30 bg-card/40 rounded-sm overflow-hidden">
      <div className="bg-background/60 px-6 py-8 md:px-10 md:py-10 border-b border-accent/20">
        <p className="font-display uppercase tracking-[0.3em] text-xs text-accent mb-3">
          Sponsorship Opportunity
        </p>
        <h3 className="font-display text-3xl md:text-4xl uppercase tracking-wide text-foreground mb-2">
          {o.title}
        </h3>
        {o.tagline && (
          <p className="font-serif italic text-base text-muted-foreground">
            {o.tagline}
          </p>
        )}
      </div>

      <div className="px-6 py-8 md:px-10 md:py-10 space-y-6">
        {o.intro_text && (
          <p className="font-serif text-foreground/90 leading-relaxed">
            {o.intro_text}
          </p>
        )}
        {o.hook_text && (
          <p className="font-display uppercase tracking-wider text-primary text-sm md:text-base">
            {o.hook_text}
          </p>
        )}

        {benefits.length > 0 && (
          <div className="grid sm:grid-cols-3 gap-5 pt-4">
            {benefits.map((b, i) => (
              <div key={i} className="border-t border-accent/30 pt-3">
                <p className="font-display uppercase tracking-wider text-xs text-accent mb-2">
                  {b.title}
                </p>
                <p className="font-serif text-sm text-foreground/80 leading-relaxed">
                  {b.description}
                </p>
              </div>
            ))}
          </div>
        )}

        {o.stats_text && (
          <blockquote className="border-l-2 border-accent pl-4 font-serif italic text-sm text-muted-foreground">
            {o.stats_text}
          </blockquote>
        )}

        {(o.price_text || o.availability_text) && (
          <div className="pt-4 border-t border-accent/20 space-y-2">
            {o.price_text && (
              <p className="font-display uppercase tracking-wide text-primary text-lg">
                {o.price_text}
              </p>
            )}
            {o.availability_text && (
              <p className="font-serif text-sm text-foreground/80 leading-relaxed">
                {o.availability_text}
              </p>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-3 pt-4">
          {o.contact_email && (
            <Button asChild>
              <a
                href={`mailto:${o.contact_email}?subject=${encodeURIComponent(`${o.title} sponsorship`)}`}
              >
                <Mail className="h-4 w-4 mr-2" /> Email {o.contact_name?.split(' ')[0] || 'us'}
              </a>
            </Button>
          )}
          <Button variant="outline" onClick={() => downloadSponsorshipPdf(o)}>
            <Download className="h-4 w-4 mr-2" /> Download proposal PDF
          </Button>
        </div>
      </div>
    </article>
  );
}