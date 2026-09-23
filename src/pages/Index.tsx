import { useMemo, useState } from 'react';
import { ProductionDetailDrawer } from '@/components/ProductionDetailDrawer';
import { TrailerFeed, type FeedItem } from '@/components/home/TrailerFeed';
import { BoothNote } from '@/components/home/BoothNote';
import { UpcomingList } from '@/components/home/UpcomingList';
import { BackstageTeaser } from '@/components/home/BackstageTeaser';
import { InstagramFeed } from '@/components/home/InstagramFeed';
import { RenovationCard } from '@/components/home/RenovationCard';
import { HomeMarquee } from '@/components/home/HomeMarquee';
import { SEO } from '@/components/SEO';
import { useFeed, filterFeed } from '@/hooks/useFeed';
import { useFeaturedSlides } from '@/hooks/useFeaturedSlides';
import { filterSlides } from '@/lib/featuredSlides';

export default function Index() {
    // The same hook the calendar uses, and the same cache entry. This page
    // carried its own copy of the four-query fetch and the feed builder, so
    // home and calendar each re-downloaded the catalogue on every visit and
    // the two builders had already drifted once. See useFeed for the cache.
    const { feed, productionsById, loading } = useFeed();
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [selectedProduction, setSelectedProduction] = useState<any>(null);
    const [query, setQuery] = useState('');
    const filteredFeed = useMemo(() => filterFeed(feed, query), [feed, query]);
    // The second source of curator's picks — slides written by hand, for pages
    // that have nothing to sell. Filtered by the same query as the feed, so a
    // search narrows the whole band rather than leaving a promo sitting beside
    // a one-item result as an advertisement.
    const { slides } = useFeaturedSlides();
    const filteredSlides = useMemo(() => filterSlides(slides, query), [slides, query]);

    const handleSelect = (item: FeedItem) => {
        // Production ids are UUIDs (contain hyphens), so we can't parse them
        // out of the composite item.id. Use the explicit productionId.
        const fullProd = productionsById.get(`${item.type}:${item.productionId}`);
        if (fullProd) {
            const showings = feed
            .filter(f => f.type === item.type && f.productionId === item.productionId)
            .map(f => ({ id: f.showingId, start_time: f.startTime, ticket_price: f.ticketPrice ?? 0 }));
            setSelectedProduction({ ...fullProd, type: item.type, showings });
            setDrawerOpen(true);
        }
    };
    
    const empty = !loading && feed.length === 0;
    
    return (
            <>
            <SEO
            title="Kenworthy — Films, Performances & Events in Moscow, ID"
            description="A century of stories on Main Street. Browse upcoming films, live performances, and events at Kenworthy Performing Arts Centre in Moscow, Idaho."
            path="/"
            />
            <HomeMarquee />
            
            {/* Clean upcoming list with a live preview pane. The full month
              calendar is tucked behind a "Calendar" button so the default view
              stays scannable. */}
            {/* Gated on the unfiltered feed, not the filtered one: this
                section owns the search box now, so a zero-match query must
                still render it. UpcomingList shows its own empty state. */}
            {!loading && feed.length > 0 && (
                                             <UpcomingList
                                             items={filteredFeed}
                                             onSelect={handleSelect}
                                             query={query}
                                             onQueryChange={setQuery}
                                             matchCount={filteredFeed.length}
                                             />
                                             )}

            {/* The booth's note and the curator's pick, directly under the
                listing they comment on. This block used to render on
                /calendar, where it buried the calendar under a featured
                poster and gave that page a second <h1>. */}
            {/* Gated on either source. A manual slide is the only thing on
                the page that can be a pick without a showing behind it, so a
                week with nothing flagged — or nothing on at all — is exactly
                when it has to still render. */}
            {!loading && (filteredFeed.length > 0 || filteredSlides.length > 0) && (
                                                     <BoothNote
                                                     items={filteredFeed}
                                                     slides={filteredSlides}
                                                     onSelect={handleSelect}
                                                     />
                                                     )}
            {/*

            <section className="border-b border-accent/20">
            <div className="h-[80vh] lg:h-[70vh]">
            {loading ? (
                        <div className="h-full flex items-center justify-center">
                        <div className="font-serif italic text-muted-foreground">
                        Warming up the projector…
                        </div>
                        </div>
                        ) : empty ? (
                                     <div className="h-full flex items-center justify-center p-8 text-center">
                                     <p className="font-serif text-muted-foreground max-w-sm">
                                     The marquee is dark for the moment. Check back soon for what's
                                     coming next on Main Street.
                                     </p>
                                     </div>
                                     ) : (
                                          <TrailerFeed items={filteredFeed.length > 0 ? filteredFeed : feed} onSelect={handleSelect} />
                                          )}
            </div>
            </section>
            

            <section className="border-b border-accent/20">
            <InstagramFeed />
            <RenovationCard />
            </section>
            */}
      {/* A quiet whisper at the bottom of the page — the speakeasy room
          tucked inside the Kenworthy. On desktop the split-scroll fills the
          viewport, so this section is the natural reward for scrolling past
          either rail. */}
      <BackstageTeaser />

      <ProductionDetailDrawer
        production={selectedProduction}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
