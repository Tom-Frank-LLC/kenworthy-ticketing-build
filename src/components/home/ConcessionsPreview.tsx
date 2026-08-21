import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { fetchAllRows } from '@/lib/fetchAllRows';

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
 * A printed-program-style preview of what's at the concessions stand.
 * Pulls live from `concession_items` so admins can edit prices, names,
 * and categories from the back-end Concessions tab and see changes here.
 *
 * Sits between the editorial calendar and the Backstage teaser — a
 * small, warm reminder that there's popcorn waiting.
 */
export function ConcessionsPreview() {
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

  if (loading || items.length === 0) return null;

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
    <section
      aria-label="Concessions menu"
      className="relative border-t border-accent/20 bg-[hsl(var(--background))]"
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          background:
            'radial-gradient(ellipse at 30% 0%, hsl(var(--primary) / 0.10), transparent 60%)',
        }}
      />
      <div className="relative mx-auto max-w-6xl px-6 py-20 md:py-24">
        <div className="text-center mb-10">
          <p className="font-serif text-xs uppercase tracking-[0.3em] text-accent mb-3">
            At the stand
          </p>
          <h2 className="font-display text-4xl md:text-5xl text-foreground mb-3">
            Concessions
          </h2>
          <p className="font-serif italic text-muted-foreground max-w-md mx-auto">
            Popcorn popped fresh, candy by the handful, a cold drink to carry in.
          </p>
        </div>

        <div className="grid gap-x-12 gap-y-10 md:grid-cols-2">
          {regularCategories.map((cat) => (
            <div key={cat}>
              <h3 className="font-display text-xl tracking-wide text-primary border-b border-accent/30 pb-2 mb-4">
                {cat}
              </h3>
              <ul className="space-y-2.5">
                {grouped[cat].map((it) => (
                  <li
                    key={it.id}
                    className="flex items-baseline gap-3 font-serif text-foreground"
                  >
                    <span className="flex-1">{it.name}</span>
                    <span
                      aria-hidden
                      className="flex-1 border-b border-dotted border-muted-foreground/40 translate-y-[-4px]"
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
            <h3 className="font-display text-xl tracking-wide text-accent mb-4">
              Combos
            </h3>
            <ul className="space-y-5">
              {combos.map((it) => {
                const kids = childrenFor(it.id);
                return (
                  <li key={it.id} className="font-serif text-foreground">
                    <div className="flex items-baseline gap-3">
                      <span className="flex-1 font-medium">{it.name}</span>
                      <span
                        aria-hidden
                        className="flex-[0.4] border-b border-dotted border-muted-foreground/40 translate-y-[-4px]"
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
        <p className="mt-6 text-center font-serif italic text-sm text-muted-foreground/70">
          Prices subject to change. Idaho sales tax added at the register.
        </p>
      </div>
    </section>
  );
}