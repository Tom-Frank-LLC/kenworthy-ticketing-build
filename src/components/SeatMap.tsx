import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Maximize2, Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Seat } from '@/lib/booking';

interface SeatMapProps {
  seats: Seat[];
  takenSeatIds: Set<string>;
  selectedSeats: Set<string>;
  onToggleSeat: (seatId: string) => void;
  loading?: boolean;
  /**
   * Optional per-seat tier overlay. Keyed by seat id. When provided,
   * unselected/available seats are tinted with the tier color so the
   * customer can see what each seat costs at a glance.
   */
  seatTierMeta?: Record<string, { color: string; tierName: string; price: number }>;
}

// Canonical column positions for the Kenworthy auditorium.
// Rendering all columns (including missing ones as spacers) keeps the curved
// banks visually aligned, matching the printed seating chart exactly.
const LEFT_COLS = [1, 2, 3, 4, 5, 6, 7];
const CENTER_COLS = [8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
const RIGHT_COLS = [20, 21, 22, 23, 24, 25, 26];
// Back row (M) → front row (A). Row A is closest to the stage.
const ROW_ORDER = ['M', 'L', 'K', 'J', 'I', 'H', 'G', 'F', 'E', 'D', 'C', 'B', 'A'];

// The chart is ~900px wide at 1:1, so it never fits a phone. Rather than
// shrink the seats (they are already at the 28px touch floor) the map is a
// zoom/pan surface: it opens fitted to the width so the buyer can see the
// whole house, then zooms in to tap. At 1.6× a seat is ~45px — above the
// ~44px touch-target minimum.
const MAX_SCALE = 2.5;
const MIN_FIT_SCALE = 0.4;
/** Zoom step for the +/− buttons. */
const ZOOM_STEP = 1.35;

function SeatButton({
  seat,
  taken,
  selected,
  onToggleSeat,
  tierMeta,
}: {
  seat: Seat;
  taken: boolean;
  selected: boolean;
  onToggleSeat: (id: string) => void;
  tierMeta?: { color: string; tierName: string; price: number };
}) {
  const tinted = !!tierMeta && !taken && !selected;
  return (
    <button
      onClick={() => onToggleSeat(seat.id)}
      disabled={taken}
      className={cn(
        'h-7 w-7 shrink-0 rounded-t-md text-[10px] font-medium transition-all',
        taken && 'bg-muted-foreground/30 cursor-not-allowed text-muted-foreground',
        !taken && !selected && !tinted && 'bg-secondary hover:bg-primary/20 border border-border hover:border-primary/60 text-foreground',
        tinted && 'border border-transparent text-white hover:brightness-110',
        selected && 'bg-primary text-primary-foreground border border-primary glow-primary',
      )}
      style={tinted ? { backgroundColor: tierMeta!.color } : undefined}
      title={`Row ${seat.seat_row} · Seat ${seat.seat_number}${tierMeta ? ` · ${tierMeta.tierName} ($${tierMeta.price.toFixed(2)})` : ''}`}
      aria-label={`Row ${seat.seat_row} seat ${seat.seat_number}${tierMeta ? `, ${tierMeta.tierName}, $${tierMeta.price.toFixed(2)}` : ''}${taken ? ' (taken)' : ''}`}
    >
      {seat.seat_number}
    </button>
  );
}

export function SeatMap({ seats, takenSeatIds, selectedSeats, onToggleSeat, loading, seatTierMeta }: SeatMapProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  const [contentSize, setContentSize] = useState({ w: 0, h: 0 });
  const [viewportW, setViewportW] = useState(0);
  const [fitScale, setFitScale] = useState(1);
  const [scale, setScale] = useState(1);

  // Once the user zooms deliberately we stop re-fitting on every resize.
  const userZoomed = useRef(false);
  // Point to keep anchored under the cursor/fingers across a scale change.
  const pendingAnchor = useRef<{ contentX: number; contentY: number; clientX: number; clientY: number } | null>(null);
  const scaleRef = useRef(scale);
  scaleRef.current = scale;

  const measured = contentSize.w > 0 && contentSize.h > 0;

  // Measure the unscaled chart and the visible box. offsetWidth/contentRect
  // both report layout size, which CSS transforms do not affect — so these
  // stay the true 1:1 dimensions no matter the current zoom.
  useLayoutEffect(() => {
    const content = contentRef.current;
    const viewport = viewportRef.current;
    if (!content || !viewport) return;

    const contentObserver = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0) setContentSize({ w: box.width, h: box.height });
    });
    const viewportObserver = new ResizeObserver(entries => {
      const box = entries[0]?.contentRect;
      if (box && box.width > 0) setViewportW(box.width);
    });
    contentObserver.observe(content);
    viewportObserver.observe(viewport);
    return () => {
      contentObserver.disconnect();
      viewportObserver.disconnect();
    };
  }, [seats.length]);

  // Fit-to-width is both the opening view and the floor for zooming out —
  // there is no reason to shrink the chart smaller than the box holding it.
  useEffect(() => {
    if (!measured || viewportW === 0) return;
    const fit = Math.min(1, Math.max(MIN_FIT_SCALE, viewportW / contentSize.w));
    // Snap to the previous value for sub-half-percent changes: zooming can
    // toggle a scrollbar, which nudges viewportW and would otherwise let
    // fit → scale → scrollbar → fit oscillate.
    const settle = (prev: number) => (Math.abs(prev - fit) < 0.005 ? prev : fit);
    setFitScale(settle);
    if (!userZoomed.current) setScale(settle);
  }, [measured, viewportW, contentSize.w]);

  /** Re-anchor the scroll offsets so the zoom focal point stays put. */
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const anchor = pendingAnchor.current;
    if (!viewport || !anchor) return;
    pendingAnchor.current = null;
    const rect = viewport.getBoundingClientRect();
    viewport.scrollLeft = anchor.contentX * scale - (anchor.clientX - rect.left);
    viewport.scrollTop = anchor.contentY * scale - (anchor.clientY - rect.top);
  }, [scale]);

  const zoomTo = useCallback(
    (next: number, clientX?: number, clientY?: number) => {
      const viewport = viewportRef.current;
      if (!viewport) return;
      const current = scaleRef.current;
      const clamped = Math.min(MAX_SCALE, Math.max(fitScale, next));
      if (Math.abs(clamped - current) < 0.001) return;

      const rect = viewport.getBoundingClientRect();
      const focalX = clientX ?? rect.left + rect.width / 2;
      const focalY = clientY ?? rect.top + rect.height / 2;
      pendingAnchor.current = {
        contentX: (focalX - rect.left + viewport.scrollLeft) / current,
        contentY: (focalY - rect.top + viewport.scrollTop) / current,
        clientX: focalX,
        clientY: focalY,
      };
      userZoomed.current = true;
      setScale(clamped);
    },
    [fitScale],
  );

  const resetFit = useCallback(() => {
    userZoomed.current = false;
    pendingAnchor.current = null;
    setScale(fitScale);
    const viewport = viewportRef.current;
    if (viewport) {
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    }
  }, [fitScale]);

  // Pinch-to-zoom (two fingers) and trackpad pinch (wheel + ctrlKey). Both
  // need non-passive listeners to preventDefault, which React's synthetic
  // wheel/touch handlers do not allow.
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;

    let pinchStartDist = 0;
    let pinchStartScale = 1;
    const distance = (touches: TouchList) =>
      Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY);

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        pinchStartDist = distance(e.touches);
        pinchStartScale = scaleRef.current;
      }
    };
    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || pinchStartDist === 0) return;
      e.preventDefault();
      const ratio = distance(e.touches) / pinchStartDist;
      zoomTo(
        pinchStartScale * ratio,
        (e.touches[0].clientX + e.touches[1].clientX) / 2,
        (e.touches[0].clientY + e.touches[1].clientY) / 2,
      );
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) pinchStartDist = 0;
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return; // plain wheel keeps scrolling the map
      e.preventDefault();
      zoomTo(scaleRef.current * (e.deltaY < 0 ? 1.08 : 1 / 1.08), e.clientX, e.clientY);
    };

    viewport.addEventListener('touchstart', onTouchStart, { passive: true });
    viewport.addEventListener('touchmove', onTouchMove, { passive: false });
    viewport.addEventListener('touchend', onTouchEnd, { passive: true });
    viewport.addEventListener('touchcancel', onTouchEnd, { passive: true });
    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('touchstart', onTouchStart);
      viewport.removeEventListener('touchmove', onTouchMove);
      viewport.removeEventListener('touchend', onTouchEnd);
      viewport.removeEventListener('touchcancel', onTouchEnd);
      viewport.removeEventListener('wheel', onWheel);
    };
  }, [zoomTo]);

  if (loading) {
    return <p className="text-center text-muted-foreground py-8">Loading seats...</p>;
  }

  // Index seats by row + section + number → quick O(1) lookup per cell.
  const lookup = new Map<string, Seat>();
  for (const seat of seats) {
    const section = (seat.section || 'center').toLowerCase();
    lookup.set(`${seat.seat_row}|${section}|${seat.seat_number}`, seat);
  }

  const renderCell = (row: string, section: 'left' | 'center' | 'right', col: number) => {
    const seat = lookup.get(`${row}|${section}|${col}`);
    if (!seat) {
      // Empty spacer keeps columns aligned across rows where this seat doesn't exist
      return <div key={`${row}-${section}-${col}`} className="h-7 w-7 shrink-0" aria-hidden />;
    }
    return (
      <SeatButton
        key={seat.id}
        seat={seat}
        taken={takenSeatIds.has(seat.id)}
        selected={selectedSeats.has(seat.id)}
        onToggleSeat={onToggleSeat}
        tierMeta={seatTierMeta?.[seat.id]}
      />
    );
  };

  const rowsWithAnySeats = ROW_ORDER.filter(row =>
    [...LEFT_COLS, ...CENTER_COLS, ...RIGHT_COLS].some(col =>
      lookup.has(`${row}|left|${col}`) ||
      lookup.has(`${row}|center|${col}`) ||
      lookup.has(`${row}|right|${col}`),
    ),
  );

  const canZoomOut = scale > fitScale + 0.001;
  const canZoomIn = scale < MAX_SCALE - 0.001;

  return (
    <div className="w-full">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-3 justify-center">
        <span className="flex items-center gap-1.5">
          <div className="h-4 w-4 rounded-t bg-secondary border border-border" /> Available
        </span>
        <span className="flex items-center gap-1.5">
          <div className="h-4 w-4 rounded-t bg-primary" /> Selected
        </span>
        <span className="flex items-center gap-1.5">
          <div className="h-4 w-4 rounded-t bg-muted-foreground/30" /> Taken
        </span>
      </div>

      {/* Zoom controls */}
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          <span className="sm:hidden">Pinch or use + to zoom, drag to pan.</span>
          <span className="hidden sm:inline">Drag to pan · ⌘/Ctrl + scroll to zoom.</span>
        </p>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => zoomTo(scaleRef.current / ZOOM_STEP)}
            disabled={!canZoomOut}
            aria-label="Zoom out"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-secondary/60 text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <Minus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => zoomTo(scaleRef.current * ZOOM_STEP)}
            disabled={!canZoomIn}
            aria-label="Zoom in"
            className="flex h-11 w-11 items-center justify-center rounded-md border border-border bg-secondary/60 text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <Plus className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={resetFit}
            disabled={!canZoomOut}
            aria-label="Fit the whole auditorium to the screen"
            className="flex h-11 items-center justify-center gap-1.5 rounded-md border border-border bg-secondary/60 px-3 text-sm text-foreground transition-colors hover:bg-secondary disabled:opacity-40"
          >
            <Maximize2 className="h-4 w-4" /> Fit
          </button>
        </div>
      </div>

      {/* Seating banks — back of house (M) at top, stage (A) at bottom.
          One finger pans via native scrolling (which keeps taps on seats
          unambiguous); two fingers pinch-zoom. */}
      <div
        ref={viewportRef}
        className="relative overflow-auto overscroll-contain rounded-lg border border-border/60 bg-background/30"
        style={{
          touchAction: 'pan-x pan-y',
          height: measured ? contentSize.h * scale + 8 : undefined,
          maxHeight: 'min(640px, 62vh)',
        }}
      >
        <div
          className="relative"
          style={measured ? { width: contentSize.w * scale, height: contentSize.h * scale } : undefined}
        >
          <div
            ref={contentRef}
            className={cn('w-max origin-top-left', measured && 'absolute left-0 top-0')}
            style={{ transform: `scale(${scale})` }}
          >
            <div className="mx-auto w-fit space-y-1.5 px-2 py-2">
              {rowsWithAnySeats.map(row => (
                <div key={row} className="flex items-center gap-3">
                  {/* Left bank */}
                  <div className="flex items-center gap-1">
                    {LEFT_COLS.map(col => renderCell(row, 'left', col))}
                  </div>
                  {/* Row label */}
                  <span className="w-5 text-xs font-display tracking-wider text-muted-foreground text-center">
                    {row}
                  </span>
                  {/* Center bank */}
                  <div className="flex items-center gap-1">
                    {CENTER_COLS.map(col => renderCell(row, 'center', col))}
                  </div>
                  {/* Row label */}
                  <span className="w-5 text-xs font-display tracking-wider text-muted-foreground text-center">
                    {row}
                  </span>
                  {/* Right bank */}
                  <div className="flex items-center gap-1">
                    {RIGHT_COLS.map(col => renderCell(row, 'right', col))}
                  </div>
                </div>
              ))}

              {/* Stage + screen */}
              <div className="pt-6 flex flex-col items-center">
                <div className="w-2/3 rounded-t-[3rem] border-2 border-foreground/40 bg-foreground/5 px-12 py-3 text-center">
                  <p className="font-display uppercase tracking-[0.3em] text-foreground/70 text-sm">Stage</p>
                </div>
                <div className="w-2/3 border-x-2 border-b-2 border-foreground/40 bg-foreground/5 py-1 text-center">
                  <p className="font-display uppercase tracking-[0.3em] text-foreground/50 text-[10px]">Screen</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
