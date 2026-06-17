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

  return (
    <div className="w-full">
      {/* Legend */}
      <div className="flex flex-wrap gap-4 text-xs text-muted-foreground mb-4 justify-center">
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

      {/* Seating banks — back of house (M) at top, stage (A) at bottom */}
      <div className="overflow-x-auto">
        <div className="mx-auto w-fit space-y-1.5 py-2">
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
  );
}
