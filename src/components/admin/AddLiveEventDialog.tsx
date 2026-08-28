import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { Label } from '@/components/ui/label';
import { Music, PartyPopper, Plus } from 'lucide-react';

type LiveEventKind = 'concert' | 'event';

/**
 * The two kinds a live event can be, and the sentence that tells them apart.
 *
 * `live_performances` and `events` are separate tables with near-identical
 * forms, which surfaced in admin as two buttons — "Add Performance" and "Add
 * Event" — sitting side by side with nothing on screen saying which to press.
 * The difference is real but narrow: a performance carries a subcategory and is
 * always ticketed, an event carries a ticketing mode and may be RSVP or
 * info-only. That is a sentence, not a second button, so it is written here at
 * the point where the choice is actually made.
 *
 * This does not merge the tables. It puts one door in front of them; the two
 * forms behind it are unchanged.
 */
const KINDS: {
  value: LiveEventKind;
  label: string;
  help: string;
  route: string;
  icon: typeof Music;
}[] = [
  {
    value: 'concert',
    label: 'Live performance',
    help: 'A ticketed live show — concert, theatre, stand-up comedy, dance.',
    route: '/admin/concerts/new',
    icon: Music,
  },
  {
    value: 'event',
    label: 'Community event',
    help: 'Ticketed, RSVP, or info-only — community nights, guest screenings, anything that may not sell a ticket here.',
    route: '/admin/events/new',
    icon: PartyPopper,
  },
];

export function AddLiveEventDialog() {
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  // Defaulted rather than left empty: pressing Continue straight away is the
  // common case, and a performance is the more common of the two.
  const [kind, setKind] = useState<LiveEventKind>('concert');

  const chosen = KINDS.find(k => k.value === kind)!;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="h-4 w-4 mr-1" /> Add Live Event
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-display">What are you adding?</DialogTitle>
          <DialogDescription className="font-serif">
            Both appear on the calendar the same way. The difference is how people get in.
          </DialogDescription>
        </DialogHeader>
        <RadioGroup value={kind} onValueChange={v => setKind(v as LiveEventKind)} className="gap-3">
          {KINDS.map(k => {
            const Icon = k.icon;
            return (
              <Label
                key={k.value}
                htmlFor={`live-event-kind-${k.value}`}
                className="flex cursor-pointer items-start gap-3 rounded-md border border-border p-3 transition-colors hover:bg-secondary/40 has-[[data-state=checked]]:border-primary has-[[data-state=checked]]:bg-primary/5"
              >
                <RadioGroupItem value={k.value} id={`live-event-kind-${k.value}`} className="mt-1" />
                <div className="space-y-1">
                  <span className="flex items-center gap-2 font-medium">
                    <Icon className="h-4 w-4 text-primary" />
                    {k.label}
                  </span>
                  <p className="font-serif text-xs text-muted-foreground">{k.help}</p>
                </div>
              </Label>
            );
          })}
        </RadioGroup>
        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => { setOpen(false); navigate(chosen.route); }}>Continue</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
