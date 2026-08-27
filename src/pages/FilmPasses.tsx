import { useEffect, useState } from 'react';
import { Link, Navigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Ticket } from 'lucide-react';
import { SEO } from '@/components/SEO';
import { passImageUrl } from '@/lib/passImage';
import {
  PASS_TYPE_COLUMNS,
  money,
  passWorthLine,
  type PassType,
} from '@/lib/filmPass';

/**
 * The film passes we sell, as a gallery.
 *
 * This page used to be the whole shop: a chooser, a quantity, an address, a
 * card form. Every "buy this pass" link in the site pointed at it with `?pass=`
 * merely preselecting a card, so a buyer who had already picked a pass arrived
 * at a page asking them to pick one. The purchase moved to /film-pass/:id and
 * what is left here is the browse surface — for people who arrive without a
 * pass in mind, which is the only question this page was ever answering.
 *
 * There is deliberately no payment form on this route now. One place takes
 * money for a pass, and it is the page that names the pass.
 */
export default function FilmPasses() {
  const [passTypes, setPassTypes] = useState<PassType[]>([]);
  const [loading, setLoading] = useState(true);

  // Old links keep working. Printed flyers, past emails and the festival page
  // before it was updated all say /film-passes?pass=<id>; that is now simply
  // the pass's own page, and the redirect happens before any fetch so it does
  // not flash a gallery on the way. An id that names a retired pass lands on
  // the not-on-sale state over there, which is the same answer this page would
  // have given and a clearer one.
  const [searchParams] = useSearchParams();
  const requestedPassId = searchParams.get('pass');

  useEffect(() => {
    if (requestedPassId) return;
    let cancelled = false;

    supabase
      .from('film_pass_types')
      .select(PASS_TYPE_COLUMNS)
      .eq('is_active', true)
      .order('price')
      .then(({ data }) => {
        if (cancelled) return;
        setPassTypes((data || []) as unknown as PassType[]);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, [requestedPassId]);

  if (requestedPassId) {
    return <Navigate to={`/film-pass/${requestedPassId}`} replace />;
  }

  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  if (passTypes.length === 0) {
    return (
      <div className="container py-16 px-4 max-w-xl text-center">
        <SEO
          title="Film Passes — Kenworthy"
          description="Prepaid film passes for Kenworthy Performing Arts Centre in Moscow, Idaho."
        />
        <Ticket className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">Film Passes</h1>
        <p className="text-muted-foreground">
          No film passes are on sale right now. Ask at the box office next time you visit.
        </p>
      </div>
    );
  }

  return (
    <div className="container py-8 px-4 max-w-3xl">
      <SEO
        title="Film Passes — Kenworthy"
        description="Prepaid film passes for KPAC in Moscow, Idaho. Collect one at the box office or have it posted, then hand it over at the door."
      />

      <h1 className="font-display text-3xl font-bold mb-2">Film Passes</h1>
      <p className="text-muted-foreground mb-8">
        Our film passes are printed, activated, and either handed to you at the box office
        or mailed to you, depending on your preference.
      </p>

      {/* One per row rather than two. The artwork needs about 64px, and at two
          columns each card was ~190px wide — the name wrapped mid-word and the
          price clipped off the edge, on the page where the price matters most.
          There are only ever a handful of passes. */}
      <ul className="grid gap-3">
        {passTypes.map(pt => (
          <li key={pt.id}>
            {/* A link, not a click handler on a card. This row navigates, so it
                should open in a new tab, show its target in the status bar and
                reach the keyboard on its own — all of which a div with an
                onClick has to reimplement and usually only half does. */}
            <Link
              to={`/film-pass/${pt.id}`}
              className="block rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            >
              <Card className="glass h-full transition-shadow hover:glow-primary">
                <CardContent className="p-5 flex gap-4">
                  {/* Artwork where there is any. A pass without it keeps the
                      layout rather than reserving a gap for a picture that is
                      not coming. */}
                  {pt.image_path ? (
                    <img
                      src={passImageUrl(pt.image_path)}
                      alt=""
                      loading="lazy"
                      decoding="async"
                      className="w-16 h-20 shrink-0 rounded object-cover border border-border bg-background"
                    />
                  ) : (
                    <span className="w-16 h-20 shrink-0 rounded border border-border flex items-center justify-center text-muted-foreground bg-background">
                      <Ticket className="h-6 w-6" aria-hidden="true" />
                    </span>
                  )}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <h2 className="font-display text-lg font-bold">{pt.name}</h2>
                      <span className="text-xl font-bold text-primary shrink-0">
                        {money(Number(pt.price))}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{passWorthLine(pt)}</p>
                    {pt.expiration_days && (
                      <Badge variant="secondary" className="mt-2 text-xs">
                        Valid {pt.expiration_days} days from activation
                      </Badge>
                    )}
                  </div>
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
