import * as React from 'react';
import { ChevronDown } from 'lucide-react';

import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { readSectionOpen, writeSectionOpen } from '@/lib/adminSectionState';

export interface CollapsibleSectionProps {
  /**
   * Stable key for the remembered open/closed state.
   *
   * Stable is the operative word: it is written to `localStorage`, so renaming
   * it silently resets everyone's preference. Namespace it by tab —
   * `passes.orders`, `bor.receipts` — so two tabs can both have a "Summary"
   * without sharing one switch.
   */
  id: string;
  title: string;
  /** Optional lucide icon, so a section keeps the glyph it had as a heading. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Row count or similar, shown as a badge so a closed section still reports its size. */
  count?: number;
  description?: React.ReactNode;
  /**
   * Header-right controls ("Add", "Refresh").
   *
   * A sibling of the trigger, never a child of it: a button inside a button is
   * invalid HTML, and browsers resolve it by making the inner one unreachable
   * from the keyboard. Clicks here are stopped from reaching the header so an
   * "Add" press cannot also toggle the section shut underneath the dialog it
   * just opened.
   *
   * Pass a function to get an `open()` helper. Any action that reveals
   * something *inside* the section — "Add", which flips an inline form on —
   * has to call it, or a click from the collapsed state silently mutates
   * hidden state and looks like a dead button.
   */
  actions?: React.ReactNode | ((ctx: { open: () => void }) => React.ReactNode);
  /** Where the section sits before anyone has expressed a preference. */
  defaultOpen?: boolean;
  className?: string;
  children: React.ReactNode;
}

/**
 * One collapsible block of the admin dashboard.
 *
 * The dashboard's problem was never that any single table was bad, it was that
 * every table was on screen at once and nothing was scannable. Collapsed, this
 * leaves a row of headers with counts — a table of contents for the tab — and
 * the header stays put when the body goes away, which is what makes the page
 * navigable rather than merely shorter.
 *
 * Two behaviours are worth knowing about before using it:
 *
 * **Contents do not mount until the section is first opened.** Several of these
 * sections front heavy queries, and a tab that fires six of them on mount is
 * slow for the five nobody looked at. Mounting on first open moves that cost to
 * the moment it buys something.
 *
 * **Once opened, contents stay mounted.** Radix unmounts closed content by
 * default, which would re-run the query on every toggle and make an expensive
 * section *more* expensive to work with than it was before. `forceMount` plus
 * `display: none` keeps the fetch at exactly one, preserves scroll and
 * in-progress form state across a collapse, and — because it is `display:none`
 * and not `visibility` or opacity — still takes the content out of the tab
 * order and the accessibility tree, so a collapsed section cannot trap focus.
 */
export function CollapsibleSection({
  id,
  title,
  icon: Icon,
  count,
  description,
  actions,
  defaultOpen = false,
  className,
  children,
}: CollapsibleSectionProps) {
  // Read storage once, during the initialiser, rather than in an effect: an
  // effect would render the default first and visibly snap sections open on
  // every page load.
  const [open, setOpen] = React.useState(() => readSectionOpen(id, defaultOpen));
  const [hasOpened, setHasOpened] = React.useState(open);

  const handleOpenChange = React.useCallback(
    (next: boolean) => {
      setOpen(next);
      if (next) setHasOpened(true);
      writeSectionOpen(id, next);
    },
    [id],
  );

  const openSection = React.useCallback(() => {
    setHasOpened(true);
    setOpen(prev => {
      if (!prev) writeSectionOpen(id, true);
      return true;
    });
  }, [id]);

  const contentId = `section-${id.replace(/[^a-zA-Z0-9]+/g, '-')}`;
  const renderedActions = typeof actions === 'function' ? actions({ open: openSection }) : actions;

  return (
    <Collapsible
      open={open}
      onOpenChange={handleOpenChange}
      className={cn('glass rounded-lg border bg-card text-card-foreground shadow-sm', className)}
    >
      <div className="flex items-center gap-2 pr-3">
        <CollapsibleTrigger
          id={`${contentId}-trigger`}
          // Only once the content exists. `aria-controls` naming an element that
          // is not in the DOM is worse than omitting it: a screen reader offers
          // to jump to a target that isn't there. Radix still wires the state.
          aria-controls={hasOpened ? contentId : undefined}
          className={cn(
            // min-h rather than a fixed height: the title wraps at 375px, and a
            // header that clips its own text is not a tap target you can trust.
            'group flex min-h-[3.25rem] flex-1 items-center gap-3 rounded-lg px-4 py-3 text-left',
            'transition-colors hover:bg-muted/50',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background',
          )}
        >
          <ChevronDown
            aria-hidden="true"
            className="h-5 w-5 shrink-0 text-muted-foreground transition-transform duration-200 group-data-[state=open]:rotate-180"
          />
          {Icon && <Icon className="h-5 w-5 shrink-0 text-primary" />}
          <span className="min-w-0 flex-1">
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-display text-lg font-bold uppercase tracking-wide">{title}</span>
              {count !== undefined && (
                <Badge variant="secondary" className="shrink-0">
                  {count}
                </Badge>
              )}
            </span>
            {description && (
              <span className="mt-0.5 block text-sm font-normal text-muted-foreground">{description}</span>
            )}
          </span>
        </CollapsibleTrigger>
        {renderedActions && (
          <div
            className="flex shrink-0 items-center gap-2"
            onClick={e => e.stopPropagation()}
          >
            {renderedActions}
          </div>
        )}
      </div>

      {hasOpened && (
        <CollapsibleContent
          id={contentId}
          aria-labelledby={`${contentId}-trigger`}
          forceMount
          className="data-[state=closed]:hidden"
        >
          <div className="space-y-4 border-t px-4 py-4">{children}</div>
        </CollapsibleContent>
      )}
    </Collapsible>
  );
}

export default CollapsibleSection;
