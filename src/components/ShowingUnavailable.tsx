import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { SEO } from '@/components/SEO';

/**
 * The page for a showing that cannot be read: a deleted row, a mistyped id,
 * or a title the theatre has taken down.
 *
 * It replaces a silent `navigate('/')`. That redirect was what the team was
 * reporting as "the link 404s" — a patron tapped a shared link and landed on
 * the home page with no sentence to say why. A crawler read the same thing as
 * a soft 404. This is a real page instead: it says what happened and points
 * forward, and the Worker (worker/index.ts) serves it with a 404 status so
 * search engines retire the URL rather than index a "not found" as content.
 *
 * Past showings do not come here. Since the 2026-09-09 read policy a showing
 * that has already happened stays readable, and Showing.tsx renders it in its
 * "This showing has passed" state with the rest of the run beneath — see
 * docs/briefs/BRIEF-past-event-graceful.md.
 */
export function ShowingUnavailable() {
  return (
    <div className="container py-16 px-4 max-w-2xl">
      <SEO title="Showing not found — Kenworthy" description="We couldn't find that showing." noindex />
      <div role="status" className="rounded-lg border border-border bg-secondary/40 p-8 text-center">
        <h1 className="font-display text-2xl font-bold">We couldn&rsquo;t find that showing.</h1>
        <p className="mt-2 text-muted-foreground">
          It may have been removed, or the link may be incomplete. What&rsquo;s on now is one tap away.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-3">
          <Button asChild>
            <Link to="/">See what&rsquo;s playing now</Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/calendar">Browse the calendar</Link>
          </Button>
        </div>
      </div>
    </div>
  );
}
