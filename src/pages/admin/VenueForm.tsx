import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/lib/auth';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RichTextEditor } from '@/components/ui/rich-text-editor';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { toast } from 'sonner';
import { Plus, Trash2 } from 'lucide-react';
import { isPlainRowLayout, type VenueSeat } from '@/lib/venueSeatLayout';

interface SeatRow {
  rowLabel: string;
  count: number;
  seatType: string;
}

export default function VenueForm() {
  const { id } = useParams();
  const isEdit = !!id && id !== 'new';
  const navigate = useNavigate();
  const { isAdmin, loading: authLoading } = useAuth();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [totalSeats, setTotalSeats] = useState(100);
  const [hasAssignedSeating, setHasAssignedSeating] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [seatRows, setSeatRows] = useState<SeatRow[]>([]);
  const [existingSeats, setExistingSeats] = useState<VenueSeat[]>([]);
  // False when the stored map is richer than the row editor can express. The
  // map is then shown read-only and left untouched on save.
  const [seatMapEditable, setSeatMapEditable] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (!isAdmin) { navigate('/'); return; }
    if (isEdit) {
      loadVenue();
    }
  }, [id, isEdit, isAdmin, authLoading, navigate]);

  async function loadVenue() {
    const { data: venue } = await supabase.from('venues').select('*').eq('id', id).single();
    if (venue) {
      setName(venue.name);
      setDescription(venue.description || '');
      setTotalSeats(venue.total_seats);
      setHasAssignedSeating(venue.has_assigned_seating);
      setIsActive(venue.is_active);
    }
    // Load existing seat layout
    const { data: seats } = await supabase
      .from('venue_seats')
      .select('seat_row, seat_number, seat_type, section')
      .eq('venue_id', id!)
      .order('seat_row')
      .order('seat_number');
    const rows = (seats ?? []) as VenueSeat[];
    setExistingSeats(rows);

    const editable = isPlainRowLayout(rows);
    setSeatMapEditable(editable);
    if (editable && rows.length > 0) {
      const rowMap = new Map<string, { count: number; seatType: string }>();
      rows.forEach(s => {
        const existing = rowMap.get(s.seat_row);
        if (!existing || s.seat_number > existing.count) {
          rowMap.set(s.seat_row, { count: s.seat_number, seatType: s.seat_type });
        }
      });
      setSeatRows(Array.from(rowMap.entries()).map(([rowLabel, v]) => ({
        rowLabel, count: v.count, seatType: v.seatType,
      })));
    }
  }

  // Rows of the stored map, for the read-only view: "K — 18 seats · left, center, right".
  const seatSummary = (() => {
    const byRow = new Map<string, VenueSeat[]>();
    for (const s of existingSeats) {
      const list = byRow.get(s.seat_row);
      if (list) list.push(s);
      else byRow.set(s.seat_row, [s]);
    }
    return Array.from(byRow.entries())
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([rowLabel, seats]) => ({
        rowLabel,
        count: seats.length,
        sections: [...new Set(seats.map(s => (s.section || 'center').toLowerCase()))].sort(),
      }));
  })();

  const addSeatRow = () => {
    const nextLabel = String.fromCharCode(65 + seatRows.length); // A, B, C...
    setSeatRows([...seatRows, { rowLabel: nextLabel, count: 20, seatType: 'standard' }]);
  };

  const removeSeatRow = (index: number) => {
    setSeatRows(seatRows.filter((_, i) => i !== index));
  };

  const updateSeatRow = (index: number, field: keyof SeatRow, value: string | number) => {
    setSeatRows(seatRows.map((r, i) => i === index ? { ...r, [field]: value } : r));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);

    const computedTotal = hasAssignedSeating
      ? (seatMapEditable ? seatRows.reduce((sum, r) => sum + r.count, 0) : existingSeats.length)
      : totalSeats;

    const venueData = {
      name,
      description: description || null,
      total_seats: computedTotal,
      has_assigned_seating: hasAssignedSeating,
      is_active: isActive,
    };

    let venueId = id;
    if (isEdit) {
      const { error } = await supabase.from('venues').update(venueData).eq('id', id);
      if (error) { toast.error(error.message); setSaving(false); return; }
    } else {
      const { data, error } = await supabase.from('venues').insert(venueData).select('id').single();
      if (error) { toast.error(error.message); setSaving(false); return; }
      venueId = data.id;
    }

    // Save seat layout if assigned seating. Skipped when the stored map is one
    // the row editor cannot express — see isPlainRowLayout. There is nothing
    // to write in that case (the editor never loaded it), and writing anyway
    // would replace a real seat chart with a regenerated approximation.
    if (hasAssignedSeating && venueId && seatMapEditable) {
      // Delete existing seats
      await supabase.from('venue_seats').delete().eq('venue_id', venueId);
      // Insert new seats
      const seatsToInsert = seatRows.flatMap(row =>
        Array.from({ length: row.count }, (_, i) => ({
          venue_id: venueId!,
          seat_row: row.rowLabel,
          seat_number: i + 1,
          seat_type: row.seatType,
        }))
      );
      if (seatsToInsert.length > 0) {
        const { error } = await supabase.from('venue_seats').insert(seatsToInsert);
        if (error) { toast.error('Seats: ' + error.message); setSaving(false); return; }
      }
    }

    toast.success(isEdit ? 'Venue updated!' : 'Venue created!');
    navigate('/admin');
    setSaving(false);
  };

  if (authLoading) return null;

  return (
    <div className="container py-8 px-4 max-w-lg">
      <Button variant="ghost" size="sm" onClick={() => navigate('/admin')} className="mb-4">← Back</Button>
      <Card className="glass">
        <CardHeader>
          <CardTitle className="font-display">{isEdit ? 'Edit Venue' : 'Add Venue'}</CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>Name *</Label>
              <Input required value={name} onChange={e => setName(e.target.value)} placeholder="Main Theater" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="venue-description">Description</Label>
              <RichTextEditor
                id="venue-description"
                value={description}
                onChange={setDescription}
                rows={4}
              />
            </div>
            <div className="flex items-center gap-3 py-2">
              <Checkbox
                id="assigned-seating"
                checked={hasAssignedSeating}
                onCheckedChange={(checked) => setHasAssignedSeating(checked === true)}
              />
              <div>
                <Label htmlFor="assigned-seating" className="cursor-pointer">Has a seat map</Label>
                <p className="text-xs text-muted-foreground">
                  This room has numbered seats, so a showing here <em>may</em> be sold as assigned
                  seating. Whether it is, is set per showing.
                </p>
              </div>
            </div>

            {!hasAssignedSeating && (
              <div className="space-y-2">
                <Label>Total Seats (GA capacity)</Label>
                <Input type="number" value={totalSeats} onChange={e => setTotalSeats(Number(e.target.value))} />
              </div>
            )}

            {hasAssignedSeating && !seatMapEditable && (
              <div className="space-y-3">
                <Label>Seat Map</Label>
                <p className="text-xs text-muted-foreground">
                  {existingSeats.length} seats across {seatSummary.length} rows and separate banks,
                  with gaps where there is no seat. The simple row editor cannot describe this
                  layout, so it is shown read-only and is left untouched when you save. Seat
                  prices are set per showing, under Seat Pricing on the showing.
                </p>
                <div className="rounded-md border border-border bg-secondary/30 p-3 max-h-56 overflow-y-auto space-y-1">
                  {seatSummary.map(r => (
                    <div key={r.rowLabel} className="flex items-baseline gap-2 text-xs">
                      <span className="font-display w-6 shrink-0 tracking-wider">{r.rowLabel}</span>
                      <span className="tabular-nums w-16 shrink-0">{r.count} seats</span>
                      <span className="text-muted-foreground">{r.sections.join(' · ')}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {hasAssignedSeating && seatMapEditable && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Seat Rows</Label>
                  <Button type="button" variant="outline" size="sm" onClick={addSeatRow}>
                    <Plus className="h-3 w-3 mr-1" /> Add Row
                  </Button>
                </div>
                {seatRows.map((row, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input
                      className="w-16"
                      value={row.rowLabel}
                      onChange={e => updateSeatRow(i, 'rowLabel', e.target.value)}
                      placeholder="A"
                    />
                    <Input
                      type="number"
                      className="w-20"
                      value={row.count}
                      onChange={e => updateSeatRow(i, 'count', Number(e.target.value))}
                    />
                    <span className="text-xs text-muted-foreground">seats</span>
                    <select
                      className="flex h-9 rounded-md border border-input bg-background px-2 py-1 text-sm"
                      value={row.seatType}
                      onChange={e => updateSeatRow(i, 'seatType', e.target.value)}
                    >
                      <option value="standard">Standard</option>
                      <option value="premium">Premium</option>
                      <option value="accessible">Accessible</option>
                    </select>
                    <Button type="button" variant="ghost" size="sm" onClick={() => removeSeatRow(i)}>
                      <Trash2 className="h-3 w-3 text-destructive" />
                    </Button>
                  </div>
                ))}
                {seatRows.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Total: {seatRows.reduce((s, r) => s + r.count, 0)} seats
                  </p>
                )}
              </div>
            )}

            <div className="flex items-center gap-2">
              <Switch checked={isActive} onCheckedChange={setIsActive} />
              <Label>Active</Label>
            </div>
            <Button type="submit" className="w-full" disabled={saving}>
              {saving ? 'Saving...' : isEdit ? 'Update Venue' : 'Create Venue'}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
