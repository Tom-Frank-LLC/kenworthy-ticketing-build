import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  rsvpUrlFieldLabel,
  ticketingModesFor,
  type TicketingKind,
  type TicketingMode,
} from '@/lib/liveEventTypes';

/**
 * How people get in: sold here, booked through an outside link, or nothing to
 * book. One control for every production form.
 *
 * It began in EventForm and moved here the day movies gained the same two
 * columns. Two copies of a select and a conditional URL field are not much to
 * duplicate, but the thing they encode — "the link is only meaningful for
 * RSVP, and is cleared otherwise" — is a rule the forms have to agree on, and
 * `rsvpUrlError` beside it is what both forms check before saving.
 *
 * `idPrefix` keeps each form's ids and labels distinct, which is what the
 * tests and screen readers find them by. `kind` picks the words: the stored
 * `rsvp` mode is "RSVP" on an event and "External" on a film — see
 * TicketingKind.
 */
export function TicketingModeFields({
  idPrefix,
  kind,
  ticketType,
  onTicketTypeChange,
  rsvpUrl,
  onRsvpUrlChange,
}: {
  idPrefix: string;
  kind: TicketingKind;
  ticketType: TicketingMode;
  onTicketTypeChange: (mode: TicketingMode) => void;
  rsvpUrl: string;
  onRsvpUrlChange: (url: string) => void;
}) {
  const modes = ticketingModesFor(kind);
  return (
    <>
      <div className="space-y-2">
        <Label htmlFor={`${idPrefix}-ticketing`}>Ticketing *</Label>
        <Select value={ticketType} onValueChange={v => onTicketTypeChange(v as TicketingMode)}>
          <SelectTrigger id={`${idPrefix}-ticketing`}><SelectValue /></SelectTrigger>
          <SelectContent>
            {modes.map(m => (
              <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="font-serif text-xs text-muted-foreground">
          {modes.find(m => m.value === ticketType)?.help}
        </p>
      </div>

      {ticketType === 'rsvp' && (
        <div className="space-y-2">
          <Label htmlFor={`${idPrefix}-rsvp-url`}>{rsvpUrlFieldLabel(kind)}</Label>
          <Input
            id={`${idPrefix}-rsvp-url`}
            type="url"
            inputMode="url"
            value={rsvpUrl}
            onChange={e => onRsvpUrlChange(e.target.value)}
            placeholder="https://..."
          />
        </div>
      )}
    </>
  );
}
