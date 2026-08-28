import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';
import { SEO } from '@/components/SEO';
import { MarqueeFrame } from '@/components/MarqueeFrame';

interface ConcessionItem {
  id: string;
  name: string;
  price: number;
  category: string;
  is_combo: boolean;
}

interface ComboChildRow {
  combo_id: string;
  quantity: number;
  child: { id: string; name: string; price: number } | null;
}

/**
 * Binds a short trailing token to the word before it with a non-breaking
 * space, so it can never wrap alone.
 *
 * Combo names end in a size code — "Classic Combo (Medium) — Candy, Soda M,
 * Popcorn M" — and a lone "M" dropping to its own line reads as a typo rather
 * than a wrap. Giving the row's leader less of the width fixes it wherever the
 * name fits at all, but on a narrow screen the name genuinely has to break
 * somewhere, and this decides where: never immediately before a one- or
 * two-character last word.
 *
 * A no-op for names that do not end in a short token.
 */
function bindTrailingToken(text: string) {
  return text.replace(/\s+(\S{1,2})$/u, '\u00A0$1');
}

// Doubles as the page's meta description — see the SEO block below — so it has
// to read as a standalone sentence, not just as a line under a heading.
const BLURB =
  'Freshly-popped popcorn, your favorite candies, and an ice-cold beverage — in combo form or à la carte.';

/**
 * The concessions menu, on its own page under Info.
 *
 * It used to be a section near the bottom of the home page, where it was
 * competing with the calendar for a scroll nobody finished. The data path is
 * unchanged and deliberately so: it reads `concession_items` live, so the
 * admin Concessions tab stays the single source of truth for prices.
 *
 * One thing did have to change in the move. As a home-page section this
 * rendered `null` while loading or when the table came back empty — correct
 * there, because a section that isn't ready should simply not appear. A page
 * cannot do that: the same `return null` would answer a patron who navigated
 * here on purpose with a blank screen. So loading and empty are states the
 * page actually renders.
 */
export default function Concessions() {
  const [items, setItems] = useState<ConcessionItem[]>([]);
  const [comboChildren, setComboChildren] = useState<ComboChildRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeMenuUrl, setActiveMenuUrl] = useState<string | null>(null);
  const [activeMenuLabel, setActiveMenuLabel] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ data: itemData }, { data: childData }, { data: menuData }] = await Promise.all([
        // Paged: PostgREST truncates at 1,000 rows without erroring, so an
        // unpaged select here would quietly drop the tail of the menu.
        fetchAllRows<ConcessionItem>((from, to) =>
          supabase
            .from('concession_items')
            .select('id, name, price, category, is_combo')
            .eq('is_active', true)
            .order('category')
            .order('price')
            .range(from, to) as never,
        ),
        supabase
          .from('concession_combo_items')
          .select('combo_id, quantity, child:concession_items!concession_combo_items_child_item_id_fkey(id, name, price)')
          .order('display_order'),
        supabase
          .from('concession_menus')
          .select('label, file_path')
          .eq('is_active', true)
          .maybeSingle(),
      ]);
      if (cancelled) return;
      setItems((itemData as ConcessionItem[]) || []);
      setComboChildren((childData as ComboChildRow[]) || []);
      if (menuData?.file_path) {
        // getPublicUrl, not createSignedUrl. Signing needs SELECT on the
        // storage object, and the only policy on this bucket was staff-or-
        // admin — so for an actual patron the sign failed, the error was
        // dropped on the floor, and this link silently never rendered. It
        // looked correct to everyone who checked it, because they were signed
        // in. The bucket is public now; see 20260820234512.
        //
        // Synchronous and cannot fail, which is the other half of the fix:
        // there is no longer a network round trip between having the path and
        // having the URL, and therefore no error left to discard.
        const { data } = supabase.storage
          .from('concession-menus')
          .getPublicUrl(menuData.file_path);
        if (!cancelled && data.publicUrl) {
          setActiveMenuUrl(data.publicUrl);
          setActiveMenuLabel(menuData.label);
        }
      }
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  // Split combos out by the flag (not by category name) so admins can
  // categorize combos however they like and they still get the special block.
  const combos = items.filter((i) => i.is_combo);
  const regulars = items.filter((i) => !i.is_combo);

  // Group regular items by category, preserving order of first appearance.
  const grouped = regulars.reduce<Record<string, ConcessionItem[]>>((acc, it) => {
    (acc[it.category] ||= []).push(it);
    return acc;
  }, {});
  const regularCategories = Object.keys(grouped).filter((c) => c !== 'Combos');

  const childrenFor = (comboId: string) =>
    comboChildren.filter((c) => c.combo_id === comboId && c.child);

  return (
    <>
      <SEO
        title="Concessions | Kenworthy Performing Arts Centre"
        description={BLURB}
        path="/concessions"
      />

      <div className="container mx-auto px-4 py-10 md:py-16 max-w-4xl">
        <header className="mb-10 md:mb-14 text-center">
          <p className="font-serif text-xs uppercase tracking-[0.3em] text-accent mb-3">
            At the stand
          </p>
          <h1 className="font-display uppercase text-3xl md:text-5xl tracking-[0.1em] text-foreground">
            Concessions
          </h1>
          <p className="font-serif italic text-lg text-muted-foreground max-w-md mx-auto mt-4">
            {BLURB}
          </p>
        </header>

        <MarqueeFrame className="bg-card/30 rounded-sm">
          {loading ? (
            <p className="font-serif italic text-center text-muted-foreground py-8">
              Bringing out the menu…
            </p>
          ) : items.length === 0 ? (
            <p className="font-serif italic text-center text-muted-foreground py-8">
              The menu is being reprinted. Ask at the stand — the popcorn is
              still popping.
            </p>
          ) : (
            <>
              {/* Columns, not a two-column grid. A grid couples the two cells
                  of a row to the same height, so a short category sitting
                  beside a tall one carried the taller one's trailing space —
                  Beverages (2 items) opened a gap below itself because Beer &
                  Wine (3) set the row height, while the left column's own
                  categories sat tight. Columns let each side flow and the
                  browser balance them, so both sides get the same rhythm.
                  `break-inside-avoid` keeps a category from splitting across
                  the fold.

                  Two columns from `lg`, not `md`. Measured at 768: a column is
                  241.5px and a row of "Popcorn (Medium)" + leader + price needs
                  268.9px, so the name wrapped beside half a row of dots. The
                  tablet band does not have the width for two menu columns —
                  it never did, which is why names were wrapping there before
                  this change too — so it gets one full-width column instead. */}
              <div className="lg:columns-2 lg:gap-x-12">
                {regularCategories.map((cat) => (
                  <div key={cat} className="break-inside-avoid mb-10">
                    <h2 className="font-display text-xl tracking-wide text-primary border-b border-accent/30 pb-2 mb-4">
                      {cat}
                    </h2>
                    <ul className="space-y-2.5">
                      {grouped[cat].map((it) => (
                        <li
                          key={it.id}
                          className="flex items-baseline gap-2 md:gap-3 font-serif text-foreground"
                        >
                          {/* The name takes the width it needs and the leader
                              absorbs what is left. Both were `flex-1`, which
                              split every row 50/50 and wrapped names that had
                              room to spare — "Popcorn (Medium)" broke onto a
                              second line beside half a row of empty dots. The
                              name can still shrink and wrap when a row genuinely
                              is too narrow; the leader keeps a floor so the dots
                              never disappear entirely. */}
                          <span className="min-w-0">{bindTrailingToken(it.name)}</span>
                          <span
                            aria-hidden
                            className="flex-1 min-w-4 md:min-w-6 border-b border-dotted border-muted-foreground/40 translate-y-[-4px]"
                          />
                          <span className="tabular-nums text-accent font-medium">
                            ${Number(it.price).toFixed(2)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>

              {combos.length > 0 && (
                <div className="mt-12 rounded-lg border border-accent/30 bg-card/40 p-6 md:p-8">
                  <h2 className="font-display text-xl tracking-wide text-accent mb-4">
                    Combos
                  </h2>
                  <ul className="space-y-5">
                    {combos.map((it) => {
                      const kids = childrenFor(it.id);
                      return (
                        <li key={it.id} className="font-serif text-foreground">
                          <div className="flex items-baseline gap-3">
                            {/* Same distribution as the item rows above, which
                                this block had not been given: the name was
                                `flex-1` against a `flex-[0.4]` leader, so on a
                                718px row the leader took 180.5px and squeezed
                                the name to 451.3px when it needed 462.6 —
                                orphaning the final "M" by 11.3px. */}
                            <span className="min-w-0 font-medium">
                              {bindTrailingToken(it.name)}
                            </span>
                            <span
                              aria-hidden
                              className="flex-1 min-w-4 md:min-w-6 border-b border-dotted border-muted-foreground/40 translate-y-[-4px]"
                            />
                            <span className="tabular-nums text-accent font-medium">
                              ${Number(it.price).toFixed(2)}
                            </span>
                          </div>
                          {kids.length > 0 && (
                            <p className="mt-1 text-sm italic text-muted-foreground">
                              Includes{' '}
                              {kids
                                .map((k) =>
                                  k.quantity > 1
                                    ? `${k.quantity} ${k.child!.name}`
                                    : k.child!.name,
                                )
                                .join(', ')}
                            </p>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
              )}

              {activeMenuUrl && (
                <div className="mt-10 text-center">
                  <a
                    href={activeMenuUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block font-serif text-sm text-accent underline underline-offset-4 hover:text-primary transition-colors"
                  >
                    View full printed menu{activeMenuLabel ? ` — ${activeMenuLabel}` : ''} (PDF)
                  </a>
                </div>
              )}
            </>
          )}
        </MarqueeFrame>

        {/* Outside the frame: the ring is for the menu, and this is a footnote
            about it. The solid muted token, not a faded variant — the faded
            ones fail AA on this background at this size. */}
        <p className="mt-6 text-center font-serif italic text-sm text-muted-foreground">
          Prices subject to change. Idaho sales tax added at the register.
        </p>
      </div>
    </>
  );
}
