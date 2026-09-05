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

/*
 * `AccessibilityPage` used to live here and is gone: /accessibility is a real
 * statement now, at `src/pages/Accessibility.tsx`. KPAC's facility list — the
 * copy added to this stub's blurb in #237 — moved there verbatim and is the
 * authority for those facts.
 *
 * `ComingSoon` itself is kept: it is the shape a placeholder page should take
 * if one is ever needed again.
 */
