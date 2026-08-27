import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Calendar, Check, Mail, Store, Ticket } from 'lucide-react';
import { SEO } from '@/components/SEO';
import { FilmPassPurchase, type Placed } from '@/components/FilmPassPurchase';
import { passImageUrl } from '@/lib/passImage';
import { formatShowtime } from '@/lib/datetime';
import { htmlToPlainText } from '@/lib/richText';
import { FESTIVAL_SLUG } from '@/lib/festival';
import {
  PASS_TYPE_COLUMNS,
  money,
  passWorthLine,
  type PassType,
} from '@/lib/filmPass';

/**
 * One film pass, on its own page.
 *
 * The page a "buy this pass" link should have gone to all along. /film-passes
 * sold every pass from a single chooser, so clicking Buy on the festival pass
 * landed the buyer in a list of every other pass with theirs merely
 * preselected — a page that answers "which one?" put in front of somebody who
 * had already answered it. Here the pass is the product: its artwork, what it
 * covers, how long it lasts, and its own fine print, with the purchase panel
 * beneath.
 *
 * What it must not do is imply the buyer now holds something. A film pass is a
 * physical card, and paying for one buys a *promise* of one — collected at the
 * box office or posted out. So there is no QR anywhere on this page or in the
 * email that follows it, and the wording after payment says where the pass will
 * be rather than "here is your pass".
 */

interface Production {
  title: string;
}

interface Screening {
  id: string;
  start_time: string;
  movies: Production | null;
  events: Production | null;
  live_performances: Production | null;
}

/**
 * How many screenings the page will name before it stops counting.
 *
 * A festival pass is tagged to a handful and the list *is* the offer. The
 * standard pass is tagged to every ordinary movie — 1,108 rows in production,
 * past ones included — and enumerating those would be a wall of text that also
 * runs into PostgREST's silent 1000-row cap. So the query asks only for what is
 * still to come, in date order, and one more than it will draw: the extra row
 * is how the page knows to say there are others rather than implying these are
 * all of them.
 */
const SCREENING_LIMIT = 8;

function screeningTitle(s: Screening): string {
  return s.movies?.title ?? s.events?.title ?? s.live_performances?.title ?? 'Screening';
}

export default function FilmPassDetail() {
  const { id } = useParams<{ id: string }>();

  const [pass, setPass] = useState<PassType | null>(null);
  const [screenings, setScreenings] = useState<Screening[]>([]);
  const [moreScreenings, setMoreScreenings] = useState(false);
  const [loading, setLoading] = useState(true);
  const [placed, setPlaced] = useState<Placed | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setPass(null);
    setScreenings([]);
    setMoreScreenings(false);

    (async () => {
      // A retired pass and a nonexistent one are the same answer here: not on
      // sale. `maybeSingle` covers the miss, and the error branch covers an id
      // that is not a UUID at all — an old flyer, or a hand-typed URL — which
      // PostgREST rejects outright rather than returning empty.
      const { data, error } = await supabase
        .from('film_pass_types')
        .select(PASS_TYPE_COLUMNS)
        .eq('id', id ?? '')
        .eq('is_active', true)
        .maybeSingle();

      if (cancelled) return;
      const found = (error ? null : data) as unknown as PassType | null;
      setPass(found);

      if (found) {
        // Filtered from the showings side with an inner join, so the cutoff and
        // the limit apply to the screenings themselves. Filtering the embedded
        // pass_type_showings instead would null the embed on non-matching rows
        // rather than dropping them, and the limit would then count rows that
        // were never going to be shown.
        const { data: rows } = await supabase
          .from('showings')
          .select(
            'id, start_time, movies(title), events(title), live_performances(title), ' +
              'pass_type_showings!inner(pass_type_id)',
          )
          .eq('pass_type_showings.pass_type_id', found.id)
          .eq('is_active', true)
          .gte('start_time', new Date().toISOString())
          .order('start_time')
          .limit(SCREENING_LIMIT + 1);

        if (!cancelled) {
          const list = (rows ?? []) as unknown as Screening[];
          setMoreScreenings(list.length > SCREENING_LIMIT);
          setScreenings(list.slice(0, SCREENING_LIMIT));
        }
      }

      if (!cancelled) setLoading(false);
    })();

    return () => { cancelled = true; };
  }, [id]);

  if (loading) {
    return <div className="container py-16 text-center text-muted-foreground">Loading...</div>;
  }

  // ---- After payment ------------------------------------------------------
  // Says where the pass will be, not "here is your pass". There is deliberately
  // nothing to screenshot: a buyer who thinks this screen is the pass turns up
  // at the door with a phone and no card.
  if (placed) {
    return (
      <div className="container py-12 px-4 max-w-xl">
        <SEO
          title="Film pass ordered — Kenworthy"
          description="Your Kenworthy film pass order is confirmed."
        />
        <Card className="glass">
          <CardContent className="p-8 text-center space-y-4">
            <Check className="h-14 w-14 mx-auto text-[hsl(var(--success))]" />
            <h1 className="font-display text-2xl font-bold">Thank you — your order is in</h1>
            <p className="text-muted-foreground">
              {placed.quantity} × {placed.passName} · {money(placed.total)}
            </p>
            <div className="p-4 rounded-lg bg-secondary/50 text-left space-y-2">
              <p className="font-medium flex items-center gap-2">
                {placed.fulfillment === 'pickup' ? (
                  <><Store className="h-4 w-4" /> Collect it at the box office</>
                ) : (
                  <><Mail className="h-4 w-4" /> On its way to you</>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {placed.fulfillment === 'pickup'
                  ? 'Ask for it by name when you next visit. We activate it and hand it over then.'
                  : 'We activate it before it goes in the envelope, so it is ready to use the moment it arrives.'}
              </p>
            </div>
            <p className="text-sm text-muted-foreground">
              A film pass is a physical card — there is no QR code to print and nothing on this
              screen you need to keep. A confirmation is on its way to {placed.email}.
            </p>
            <Button variant="outline" asChild>
              <Link to="/film-passes">Browse the other passes</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  // ---- Not on sale --------------------------------------------------------
  // Where an old link lands once a pass is retired. It says so and points at
  // the ones that are, rather than dropping the reader on a 404 or, worse, on
  // a chooser that looks like the link simply forgot which pass it meant.
  if (!pass) {
    return (
      <div className="container py-16 px-4 max-w-xl text-center">
        <SEO
          title="This film pass isn't on sale — Kenworthy"
          description="This Kenworthy film pass is no longer available."
          noindex
        />
        <Ticket className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <h1 className="font-display text-2xl font-bold mb-2">This pass isn't on sale</h1>
        <p className="text-muted-foreground mb-6">
          It may have been retired, or the link may be out of date. Here is what we are
          selling now.
        </p>
        <Button asChild>
          <Link to="/film-passes">See our film passes</Link>
        </Button>
      </div>
    );
  }

  const isFestivalPass = pass.festival_slug === FESTIVAL_SLUG;

  return (
    <div className="container py-8 px-4 max-w-3xl">
      <SEO
        title={`${pass.name} — Kenworthy`}
        description={
          // Plain text only. A meta description carrying markup is what a
          // search result and a shared link preview print verbatim.
          `${passWorthLine(pass)} ${htmlToPlainText(pass.fine_print)}`.trim() ||
          `Buy the ${pass.name} for Kenworthy Performing Arts Centre in Moscow, Idaho.`
        }
        ogType="product"
        image={pass.image_path ? passImageUrl(pass.image_path, 1200) : undefined}
      />

      <FilmPassPurchase pass={pass} onPlaced={setPlaced}>
        {/* ---- The pass itself ---- */}
        <div className="flex flex-col sm:flex-row gap-6">
          {pass.image_path ? (
            <img
              src={passImageUrl(pass.image_path, 600)}
              alt={`${pass.name} card`}
              decoding="async"
              className="w-full sm:w-48 sm:shrink-0 rounded-lg object-cover border border-border bg-background"
            />
          ) : (
            <span className="w-full h-40 sm:w-48 sm:h-60 sm:shrink-0 rounded-lg border border-border flex items-center justify-center text-muted-foreground bg-background">
              <Ticket className="h-12 w-12" aria-hidden="true" />
            </span>
          )}

          <div className="min-w-0 space-y-3">
            <h1 className="font-display text-3xl font-bold">{pass.name}</h1>
            <p className="text-3xl font-bold text-primary">{money(Number(pass.price))}</p>
            <p className="text-muted-foreground">{passWorthLine(pass)}</p>
            {pass.expiration_days && (
              <Badge variant="secondary" className="text-xs">
                Valid {pass.expiration_days} days from activation
              </Badge>
            )}
            <p className="text-sm text-muted-foreground">
              A film pass is a physical card you hand to our staff at the door. Collect it at
              the box office, or have it posted to you.
            </p>
            {isFestivalPass && (
              <p className="text-sm">
                <Link to="/silent-film-festival" className="text-primary underline">
                  See the full festival programme
                </Link>
              </p>
            )}
          </div>
        </div>

        {/* ---- What it admits to ----
            Derived from pass_type_showings, the same table the door enforces
            at, so what this page advertises and what the pass actually admits
            to are the same rows by construction. */}
        {screenings.length > 0 && (
          <div className="space-y-3">
            <h2 className="font-display text-lg font-bold">
              {isFestivalPass ? 'What it admits you to' : 'Coming up — good at these'}
            </h2>
            <ul className="space-y-2">
              {screenings.map(s => (
                <li key={s.id}>
                  <Link
                    to={`/showing/${s.id}`}
                    className="flex items-baseline justify-between gap-3 rounded-lg border border-border p-3 hover:glow-primary transition-shadow"
                  >
                    <span className="font-medium min-w-0">{screeningTitle(s)}</span>
                    <span className="text-sm text-muted-foreground shrink-0 flex items-center gap-1">
                      <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
                      {formatShowtime(s.start_time, 'EEE, MMM d · h:mm a')}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
            {moreScreenings && (
              <p className="text-sm text-muted-foreground">
                And more —{' '}
                <Link to="/calendar" className="text-primary underline">
                  see the full calendar
                </Link>
                .
              </p>
            )}
          </div>
        )}
      </FilmPassPurchase>
    </div>
  );
}
