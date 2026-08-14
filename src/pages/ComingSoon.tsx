import { SEO } from '@/components/SEO';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Mail } from 'lucide-react';

export function ComingSoon({
  title,
  blurb,
  path,
}: {
  title: string;
  blurb?: string;
  path: string;
}) {
  return (
    <>
      <SEO title={`${title} — The Kenworthy`} description={blurb || `${title} at The Kenworthy Performing Arts Centre.`} path={path} />
      <div className="container py-20 md:py-28 max-w-2xl">
        <p className="text-xs uppercase tracking-[0.3em] text-accent font-serif mb-3">
          The Kenworthy
        </p>
        <h1 className="font-display text-4xl md:text-5xl uppercase tracking-wide mb-5">
          {title}
        </h1>
        <div className="marquee-rule mb-8" />
        <p className="font-serif text-lg text-muted-foreground leading-relaxed mb-6">
          {blurb ||
            "We're still writing this page. Check back soon, or reach us in the meantime — we'd love to hear from you."}
        </p>
        <div className="flex flex-wrap gap-3">
          <Button asChild variant="outline">
            <Link to="/"><ArrowLeft className="h-4 w-4 mr-1" /> Back to the marquee</Link>
          </Button>
          <Button asChild>
            <a href="mailto:events@kenworthy.org"><Mail className="h-4 w-4 mr-1" /> Email the box office</a>
          </Button>
        </div>
      </div>
    </>
  );
}

export const SilentFilmFestivalPage = () => (
  <ComingSoon
    title="Silent Film Festival"
    path="/silent-film-festival"
    blurb="Live scores, silent classics, and a full weekend on Main Street. Dates and lineup will land here soon."
  />
);

export const AccessibilityPage = () => (
  <ComingSoon
    title="Accessibility"
    path="/accessibility"
    blurb="A full accessibility guide — seating, entry, hearing assist, and quiet screenings — is being drafted. Reach out with any questions."
  />
);
