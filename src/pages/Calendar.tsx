import { useMemo, useState } from 'react';
import { SEO } from '@/components/SEO';
import { SearchBar } from '@/components/SearchBar';
import { EditorialCalendar } from '@/components/home/EditorialCalendar';
import { MonthCalendar } from '@/components/home/MonthCalendar';
import { ShowingPreview } from '@/components/home/ShowingPreview';
import { ProductionDetailDrawer } from '@/components/ProductionDetailDrawer';
import { useFeed, filterFeed } from '@/hooks/useFeed';
import { useIsSplitLayout } from '@/hooks/use-mobile';
import type { FeedItem } from '@/components/home/TrailerFeed';
import { Button } from '@/components/ui/button';
import { List as ListIcon, Calendar as CalendarIcon } from 'lucide-react';

export default function CalendarPage() {
  const { feed, productionsById, loading } = useFeed();
  const [query, setQuery] = useState('');
  const [view, setView] = useState<'list' | 'month'>('month');
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [selected, setSelected] = useState<any>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const filtered = useMemo(() => filterFeed(feed, query), [feed, query]);

  // The List view at `lg` and up has a whole empty column next to it, so the
  // picked showing is shown there instead of behind a slide-out sheet. The
  // month grid has no such column — it already spans the width — and below
  // `lg` a side pane would stack under the entire list, out of reach. Both of
  // those keep the drawer.
  const splitLayout = useIsSplitLayout();
  const inlinePreview = view === 'list' && splitLayout;

  // Mirrors EditorialCalendar's own featured rule so the panel opens showing
  // the same production the reader's eye lands on at the top of the list.
  const previewItem =
    filtered.find(i => i.id === previewId) ??
    filtered.find(i => i.isFeatured) ??
    filtered[0] ??
    null;

  const openDrawer = (item: FeedItem) => {
    const prod = productionsById.get(`${item.type}:${item.productionId}`);
    if (!prod) return;
    const showings = feed
      .filter(f => f.type === item.type && f.productionId === item.productionId)
      .map(f => ({ id: f.showingId, start_time: f.startTime, ticket_price: f.ticketPrice ?? 0 }));
    setSelected({ ...prod, type: item.type, showings });
    setDrawerOpen(true);
  };

  const handleSelect = (item: FeedItem) => {
    if (inlinePreview) {
      setPreviewId(item.id);
      return;
    }
    openDrawer(item);
  };

  return (
    <>
      <SEO
        title="Calendar — Kenworthy"
        description="Browse every upcoming film, live performance, and event at the Kenworthy Performing Arts Centre on Main Street in Moscow, Idaho."
        path="/calendar"
      />
      <div className="container py-10 md:py-14">
        <div className="mb-6">
          <p className="text-xs uppercase tracking-[0.2em] text-accent font-semibold mb-2">
            What's on
          </p>
          <h1 className="font-display text-4xl md:text-5xl uppercase tracking-wide">
            Calendar
          </h1>
          <p className="font-serif text-muted-foreground mt-2 max-w-2xl">
            Every showing, in order. Search for a title or use the month view to plan your visit.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 mb-8">
          <SearchBar value={query} onChange={setQuery} />
          <div
            role="tablist"
            aria-label="Choose view"
            className="inline-flex items-center rounded-md border border-accent/30 bg-card p-1 ml-auto"
          >
            <Button
              type="button"
              role="tab"
              aria-selected={view === 'list'}
              variant={view === 'list' ? 'default' : 'ghost'}
              size="sm"
              className="gap-2 h-8"
              onClick={() => setView('list')}
            >
              <ListIcon className="h-4 w-4" /> List
            </Button>
            <Button
              type="button"
              role="tab"
              aria-selected={view === 'month'}
              variant={view === 'month' ? 'default' : 'ghost'}
              size="sm"
              className="gap-2 h-8"
              onClick={() => setView('month')}
            >
              <CalendarIcon className="h-4 w-4" /> Month
            </Button>
          </div>
        </div>

        {loading ? (
          <p className="font-serif italic text-muted-foreground">Loading the calendar…</p>
        ) : filtered.length === 0 ? (
          <p className="font-serif italic text-muted-foreground">
            {query ? `No showings match "${query}".` : 'Nothing on the books just yet.'}
          </p>
        ) : view === 'month' ? (
          <MonthCalendar items={filtered} onSelect={handleSelect} />
        ) : inlinePreview ? (
          <div className="grid grid-cols-[1fr_1.1fr] gap-10 items-start">
            <EditorialCalendar
              items={filtered}
              onSelect={handleSelect}
              selectedId={previewItem?.id ?? null}
              compact
            />
            {previewItem && (
              // No onViewDetails: in this mode the preview *is* the detail
              // view, and the drawer it would open is exactly what this
              // column replaces.
              <ShowingPreview
                item={previewItem}
                className="min-w-0 sticky top-4 self-start"
              />
            )}
          </div>
        ) : (
          <EditorialCalendar items={filtered} onSelect={handleSelect} />
        )}
      </div>

      <ProductionDetailDrawer
        production={selected}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
      />
    </>
  );
}
