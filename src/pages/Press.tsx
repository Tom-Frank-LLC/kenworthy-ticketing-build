import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { SEO } from '@/components/SEO';
import { Button } from '@/components/ui/button';
import { ExternalLink, Mail, Newspaper } from 'lucide-react';
import { formatPlainDate } from '@/lib/datetime';
import { safeHttpUrl, splitPressArticles, type PressArticle } from '@/lib/press';
import { RichText } from '@/components/RichText';

// Press coverage, edited from the Press tab of the admin dashboard.
//
// Every card on this page is a *link*. The articles belong to the outlets that
// published them, so what is stored and shown here is preview metadata only —
// a headline, the outlet, a date, a blurb the Kenworthy wrote itself, and a
// thumbnail — and the card sends the reader to the outlet to read the piece.
// Nothing on this page reproduces anyone else's article, and nothing added to
// it later should.
//
// The banner photo and the intro paragraph are a separate row
// (press_page_content) and are both optional; the page has to look finished
// with neither of them, because on the day it ships it has neither.

interface PageContent {
  photo_url: string | null;
  intro_text: string | null;
}

/** The shared bits of a card: a headline that links out, credited to the outlet. */
function CardBody({ article, large }: { article: PressArticle; large?: boolean }) {
  return (
    <>
      <p className="font-display uppercase tracking-[0.2em] text-xs text-primary">
        {article.outlet}
      </p>
      <h3
        className={`font-display uppercase text-foreground mt-2 ${
          large ? 'text-xl md:text-2xl' : 'text-lg'
        }`}
      >
        {article.title}
      </h3>
      {article.published_date && (
        <p className="font-serif text-sm text-muted-foreground mt-1">
          {formatPlainDate(article.published_date)}
        </p>
      )}
      {article.excerpt && (
        <p className="font-serif text-muted-foreground mt-3 leading-relaxed">
          {article.excerpt}
        </p>
      )}
      <p className="font-display uppercase tracking-[0.15em] text-xs text-accent mt-4 inline-flex items-center gap-1">
        Read at {article.outlet} <ExternalLink className="h-3 w-3" />
      </p>
    </>
  );
}

function ArticleCard({ article, large }: { article: PressArticle; large?: boolean }) {
  const href = safeHttpUrl(article.url);
  const shell =
    'block rounded-lg border border-accent/20 bg-card/40 overflow-hidden transition-colors hover:border-accent/50';

  // A row whose link cannot be trusted (not http(s), or malformed) still shows
  // its headline — the coverage happened either way — but it is not turned
  // into an anchor. Rendering the href regardless is how a `javascript:` URL
  // becomes a click target.
  const inner = large ? (
    <>
      {article.image_url && (
        <img
          src={article.image_url}
          alt=""
          className="w-full aspect-[16/9] object-cover"
          loading="lazy"
        />
      )}
      <div className="p-6 md:p-8">
        <CardBody article={article} large />
      </div>
    </>
  ) : (
    <div className="flex gap-4 p-5">
      {article.image_url && (
        <img
          src={article.image_url}
          alt=""
          className="hidden sm:block w-32 md:w-40 aspect-[16/9] object-cover rounded shrink-0"
          loading="lazy"
        />
      )}
      <div className="min-w-0">
        <CardBody article={article} />
      </div>
    </div>
  );

  if (!href) return <div className={shell}>{inner}</div>;

  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className={shell}
      aria-label={`${article.title} — read at ${article.outlet} (opens in a new tab)`}
    >
      {inner}
    </a>
  );
}

export default function Press() {
  const [articles, setArticles] = useState<PressArticle[]>([]);
  const [page, setPage] = useState<PageContent | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const [artRes, pageRes] = await Promise.all([
        (supabase as any)
          .from('press_articles')
          .select('id, title, outlet, url, published_date, excerpt, image_url, is_featured, feature_order, is_active')
          .eq('is_active', true)
          .order('published_date', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false }),
        (supabase as any)
          .from('press_page_content')
          .select('photo_url, intro_text')
          .maybeSingle(),
      ]);
      if (!alive) return;
      setArticles(artRes.data ?? []);
      setPage(pageRes.data ?? null);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, []);

  const { featured, rest } = splitPressArticles(articles);

  return (
    <div className="min-h-screen bg-background">
      <SEO
        title="Press — The Kenworthy"
        description="Press coverage of Kenworthy Performing Arts Centre in Moscow, Idaho, and how to reach us for media enquiries."
        path="/press"
        image={page?.photo_url ?? undefined}
      />

      {/* Hero — the one staff-managed photo and paragraph */}
      <section className="border-b border-accent/20 bg-card/40">
        <div className="container py-16 md:py-24 max-w-4xl">
          <p className="font-display uppercase tracking-[0.3em] text-sm text-primary mb-4">
            The Kenworthy
          </p>
          <h1 className="font-display uppercase text-4xl md:text-6xl leading-tight text-foreground">
            Press
          </h1>
          {page?.photo_url && (
            <img
              src={page.photo_url}
              alt=""
              className="w-full aspect-[16/9] object-cover rounded-lg mt-8 border border-accent/20"
            />
          )}
          <RichText
            html={page?.intro_text}
            className="font-serif text-lg md:text-xl text-muted-foreground mt-8 leading-relaxed"
          />
        </div>
      </section>

      {loading ? (
        <div className="container py-16 max-w-4xl" aria-busy="true">
          <p className="font-serif text-muted-foreground">Loading…</p>
        </div>
      ) : articles.length === 0 ? (
        // No coverage listed yet. The page is linked from the header, so it
        // has to answer a journalist who arrives here regardless.
        <section className="container py-16 max-w-4xl">
          <p className="font-serif text-lg text-muted-foreground leading-relaxed">
            We haven’t listed any coverage here yet. For interviews, images, or anything else the
            press might need, the box office will put you in touch with the right person.
          </p>
          <Button asChild className="mt-6">
            <a href="mailto:events@kenworthy.org">
              <Mail className="h-4 w-4 mr-2" /> Email the box office
            </a>
          </Button>
        </section>
      ) : (
        <>
          {featured.length > 0 && (
            <section className="container py-16 max-w-4xl">
              <h2 className="font-display uppercase text-2xl md:text-3xl mb-8 flex items-center gap-2">
                <Newspaper className="h-6 w-6 text-primary" /> Featured
              </h2>
              <div className={`grid gap-6 ${featured.length > 1 ? 'md:grid-cols-2' : ''}`}>
                {featured.map(a => (
                  <ArticleCard key={a.id} article={a} large />
                ))}
              </div>
            </section>
          )}

          {rest.length > 0 && (
            <section className="container pb-16 max-w-4xl">
              <h2 className="font-display uppercase text-2xl md:text-3xl mb-8">
                {featured.length > 0 ? 'More coverage' : 'In the press'}
              </h2>
              <div className="space-y-4">
                {rest.map(a => (
                  <ArticleCard key={a.id} article={a} />
                ))}
              </div>
            </section>
          )}

          <section className="border-t border-accent/20 bg-card/40">
            <div className="container py-12 max-w-4xl">
              <p className="font-serif text-muted-foreground">
                Writing about Kenworthy? We’re glad to help with images, history, and interviews.
              </p>
              <Button asChild variant="outline" className="mt-4">
                <a href="mailto:events@kenworthy.org">
                  <Mail className="h-4 w-4 mr-2" /> Email the box office
                </a>
              </Button>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
