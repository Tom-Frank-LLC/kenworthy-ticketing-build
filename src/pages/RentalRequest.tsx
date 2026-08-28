import { cloneElement, isValidElement, useId, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { toast } from 'sonner';
import { rentalRequestSchema } from '@/lib/rentalRequest';
import { invokeFunction } from '@/lib/functions';
import { Turnstile, turnstileConfigured } from '@/components/Turnstile';
import { SEO } from '@/components/SEO';

const EQUIPMENT = [
  { key: 'podium_mic', label: 'Podium with mic' },
  { key: 'music_stands', label: 'Music stands' },
  { key: 'microphone_stand', label: 'Microphone — on stand' },
  { key: 'banquet_tables', label: "8' banquet tables" },
  { key: 'folding_chairs', label: 'Folding chairs' },
  { key: 'laptop', label: 'Laptop for presentations' },
  { key: 'projector_screen', label: 'Digital projector & screen' },
  { key: 'bluray_dvd', label: 'Blu-ray / DVD player' },
];

const VENUE_OPTIONS = [
  { value: 'main_auditorium_projection', label: 'Main Auditorium with projection' },
  { value: 'main_auditorium_no_projection', label: 'Main Auditorium without projection' },
  { value: 'main_stage', label: 'Main Stage' },
  { value: 'backstage_speakeasy', label: 'Backstage Speakeasy' },
];

/**
 * Which venue a Backstage enquiry is for. Not a choice in that mode — it is the
 * whole reason the person is on the page — so it is set here rather than picked.
 */
const BACKSTAGE_AREA = 'backstage_speakeasy';
const BACKSTAGE_LABEL =
  VENUE_OPTIONS.find(o => o.value === BACKSTAGE_AREA)!.label;

/**
 * One form, two doors.
 *
 * 'theatre' is /rental-request: the full Event Information Sheet, every venue on
 * offer, projection and the equipment list.
 *
 * 'backstage' is /backstage-enquiry, reached from the Backstage page. Same
 * fields, same validation, same Turnstile, same edge function, same admin
 * queue — but scoped: the venue is fixed to Backstage Speakeasy, and the parts
 * of the sheet that only exist because of the auditorium (the projector and
 * screen, the DVD/streaming provisioning, the banquet tables and folding
 * chairs) are not shown. Somebody enquiring about a room with a bar in it
 * should not have to scroll past a question about Blu-ray players to reach the
 * one about beer and wine.
 *
 * Deliberately a mode rather than a second page. A copy of this form would be a
 * second Turnstile wiring, a second payload shape and a second thing to
 * remember when the pipeline changes — and the divergence is a handful of
 * sections, not a different conversation.
 */
export type RentalRequestMode = 'theatre' | 'backstage';

export default function RentalRequest({ mode = 'theatre' }: { mode?: RentalRequestMode } = {}) {
  const backstage = mode === 'backstage';
  const [params] = useSearchParams();
  const token = params.get('token') || null;

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  // null until the bot check hands one over, and null again once it expires.
  // When Turnstile is not configured it stays null and nothing waits on it.
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);

  const [form, setForm] = useState({
    event_title: '',
    proposed_date: '',
    end_date: '',
    organization_name: '',
    applicant_name: '',
    email: '',
    phone: '',
    secondary_contact_name: '',
    secondary_contact_email: '',
    secondary_contact_phone: '',
    marquee_text: '',
    wants_concessions: false,
    wants_beer_wine: false,
    arrival_time: '',
    event_start_time: '',
    event_end_time: '',
    departure_time: '',
    venue_area: backstage ? BACKSTAGE_AREA : '',
    is_ticketed: false,
    is_public: false,
    needs_digital_ticketing: false,
    expected_guests: '',
    age_range: '',
    accessibility_requirements: '',
    renter_provides_media: false,
    kenworthy_provides_media: false,
    media_notes: '',
    event_description: '',
    activity_order: '',
  });
  const [equipment, setEquipment] = useState<Record<string, string>>({});

  const set = <K extends keyof typeof form>(k: K, v: any) => setForm(prev => ({ ...prev, [k]: v }));

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsed = rentalRequestSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.errors[0]?.message || 'Please check the form');
      return;
    }
    setSubmitting(true);

    const equipmentClean: Record<string, number> = {};
    for (const [k, v] of Object.entries(equipment)) {
      const n = parseInt(v, 10);
      if (Number.isFinite(n) && n > 0) equipmentClean[k] = n;
    }

    const payload: any = {
      ...form,
      proposed_date: form.proposed_date || null,
      // A single day is stored as no end date at all, so "has an end date"
      // means "runs longer than a day" everywhere downstream.
      end_date: form.end_date && form.end_date !== form.proposed_date ? form.end_date : null,
      expected_guests: form.expected_guests ? parseInt(form.expected_guests, 10) : null,
      venue_area: form.venue_area || null,
      equipment: equipmentClean,
    };
    // strip empty strings to null for optional text fields
    for (const k of Object.keys(payload)) {
      if (payload[k] === '') payload[k] = null;
    }

    // Backstage mode never showed the projection questions, so it must not
    // answer them. Left in, `false` reaches the admin queue as a considered
    // "no" to something nobody was asked — which is worse than a blank.
    if (backstage) {
      delete payload.renter_provides_media;
      delete payload.kenworthy_provides_media;
      delete payload.media_notes;
    }

    // Through the server, not straight into the table. The form used to insert
    // as `anon` from the browser, which took twelve scripted submissions in a
    // row without complaint — there was nowhere to check anything, because
    // there was nothing in between. See supabase/functions/rental-request.
    try {
      await invokeFunction('rental-request', { ...payload, turnstile_token: turnstileToken });
    } catch (err) {
      setSubmitting(false);
      toast.error(err instanceof Error ? err.message : 'Could not send that request');
      return;
    }
    setSubmitting(false);
    setSubmitted(true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  if (submitted) {
    return (
      <div className="container max-w-2xl py-16 px-4">
        <Card className="glass">
          <CardHeader>
            <CardTitle className="font-display text-3xl uppercase">Thank you</CardTitle>
            <CardDescription className="font-serif text-base">
              {backstage
                ? "We've received your Backstage enquiry. A member of the Kenworthy team will be in touch soon to talk through the evening and check the date is free. Nothing is held yet."
                : "We've received your rental request. A member of the Kenworthy team will be in touch soon to discuss availability and next steps."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline">
              <Link to={backstage ? '/backstage' : '/'}>
                {backstage ? 'Back to Backstage' : 'Back to Kenworthy'}
              </Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-10 px-4">
      {/* Backstage is an unlisted page — one link to it in the whole site, and
          `noindex` is what keeps it that way. A crawlable enquiry form would be
          a second front door into the same room, so this one is unlisted too. */}
      {backstage && (
        <SEO
          title="Enquire about Backstage — The Kenworthy"
          description="Ask about booking Backstage, the Kenworthy's after-hours speakeasy in Moscow, Idaho, for a private evening."
          path="/backstage-enquiry"
          noindex
        />
      )}

      <div className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-accent font-medium">
          {backstage ? 'Backstage Speakeasy' : 'Event Information Sheet'}
        </p>
        <h1 className="font-display text-4xl md:text-5xl uppercase">
          {backstage ? 'Enquire about Backstage' : 'Theatre Rental Request'}
        </h1>
        <p className="font-serif text-muted-foreground">
          {backstage
            ? "Tell us what you have in mind for the room behind the room and we'll get back to you. This is an enquiry, not a booking — nothing is held until we've spoken."
            : "Tell us about your event and we'll get back to you. This form is not your contract — staff will follow up to confirm details."}
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Contact & Event */}
        <Section title="Contact & Event Information">
          <Field label="Event Title *">
            <Input required value={form.event_title} onChange={e => set('event_title', e.target.value)} />
          </Field>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Proposed Date" hint="The first day of your event.">
              <Input type="date" value={form.proposed_date} onChange={e => set('proposed_date', e.target.value)} />
            </Field>
            <Field label="Last Day" hint="Only if your event runs more than one day.">
              <Input
                type="date"
                min={form.proposed_date || undefined}
                value={form.end_date}
                onChange={e => set('end_date', e.target.value)}
              />
            </Field>
          </div>
          <Field label="Organization / Applicant's Name">
            <Input value={form.organization_name} onChange={e => set('organization_name', e.target.value)} />
          </Field>
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Primary Contact Name *">
              <Input required value={form.applicant_name} onChange={e => set('applicant_name', e.target.value)} />
            </Field>
            <Field label="Secondary Contact Name">
              <Input value={form.secondary_contact_name} onChange={e => set('secondary_contact_name', e.target.value)} />
            </Field>
            <Field label="Email *">
              <Input type="email" required value={form.email} onChange={e => set('email', e.target.value)} />
            </Field>
            <Field label="Secondary Contact Email">
              <Input type="email" value={form.secondary_contact_email} onChange={e => set('secondary_contact_email', e.target.value)} />
            </Field>
            <Field label="Phone">
              <Input type="tel" value={form.phone} onChange={e => set('phone', e.target.value)} />
            </Field>
            <Field label="Secondary Contact Phone">
              <Input type="tel" value={form.secondary_contact_phone} onChange={e => set('secondary_contact_phone', e.target.value)} />
            </Field>
          </div>
        </Section>

        {/* Marquee */}
        <Section title="Marquee">
          <Field label="What would you like the marquee to read?" hint="Kenworthy reserves the right to refuse any message placed publicly on the marquee. Staff may suggest an alternate option due to limited space.">
            <Textarea rows={2} value={form.marquee_text} onChange={e => set('marquee_text', e.target.value)} />
          </Field>
        </Section>

        {/* Concessions */}
        <Section title="Concessions" hint="Proceeds from concession sales are retained by KPAC.">
          <ToggleRow label="Sell concessions items during your event" checked={form.wants_concessions} onChange={v => set('wants_concessions', v)} />
          <ToggleRow label="Sell beer & wine during your event" checked={form.wants_beer_wine} onChange={v => set('wants_beer_wine', v)} />
        </Section>

        {/* Set-up */}
        <Section title="Set-up">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Time renter will arrive">
              <Input type="time" value={form.arrival_time} onChange={e => set('arrival_time', e.target.value)} />
            </Field>
            <Field label="Event / film begins">
              <Input type="time" value={form.event_start_time} onChange={e => set('event_start_time', e.target.value)} />
            </Field>
            <Field label="Event / film ends">
              <Input type="time" value={form.event_end_time} onChange={e => set('event_end_time', e.target.value)} />
            </Field>
            <Field label="Time renter will leave">
              <Input type="time" value={form.departure_time} onChange={e => set('departure_time', e.target.value)} />
            </Field>
          </div>
          {/* Shown rather than hidden, and not editable. Someone filling this
              in should be able to see which room they are asking about — but
              this door only opens onto one of them, and an enquiry that arrives
              scoped to the auditorium because a radio was reachable is a
              booking conversation that starts in the wrong room. */}
          {backstage ? (
            <Field label="What part of the venue will you be using?">
              {/* Deliberately not shaped like the boxes above it. An empty-looking
                  bordered field with text in it reads as an input that has gone
                  wrong; a filled chip reads as an answer already given. */}
              <p
                className="w-fit rounded-md bg-muted px-3 py-2 font-serif text-sm"
                data-testid="locked-venue"
              >
                {BACKSTAGE_LABEL}
              </p>
            </Field>
          ) : (
            <Field label="What part of the venue will you be using?">
              <RadioGroup value={form.venue_area} onValueChange={v => set('venue_area', v)}>
                {VENUE_OPTIONS.map(opt => (
                  <div key={opt.value} className="flex items-center gap-2">
                    <RadioGroupItem value={opt.value} id={opt.value} />
                    <Label htmlFor={opt.value} className="font-serif font-normal cursor-pointer">{opt.label}</Label>
                  </div>
                ))}
              </RadioGroup>
            </Field>
          )}
        </Section>

        {/* Equipment — the auditorium's kit list. The projector, the screen, the
            eight-foot banquet tables: none of it is what Backstage is, and a
            quantity box for each is a long scroll past questions that do not
            apply. Asked in conversation there instead. */}
        {!backstage && (
          <Section title="Equipment Requests" hint="List the quantity where applicable.">
            <div className="grid md:grid-cols-2 gap-3">
              {EQUIPMENT.map(eq => (
                <div key={eq.key} className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
                  <Label htmlFor={`equipment-${eq.key}`} className="font-serif font-normal text-sm">{eq.label}</Label>
                  <Input
                    id={`equipment-${eq.key}`}
                    type="number"
                    min={0}
                    className="w-20 h-9"
                    placeholder="0"
                    value={equipment[eq.key] || ''}
                    onChange={e => setEquipment(prev => ({ ...prev, [eq.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </Section>
        )}

        {/* Ticketing */}
        <Section title="Ticketing">
          <ToggleRow label="This is a ticketed event" checked={form.is_ticketed} onChange={v => set('is_ticketed', v)} />
          <ToggleRow label="Open to the public" checked={form.is_public} onChange={v => set('is_public', v)} />
          <ToggleRow label="Use Kenworthy's digital platform for selling tickets" checked={form.needs_digital_ticketing} onChange={v => set('needs_digital_ticketing', v)} />
        </Section>

        {/* Guests */}
        <Section title="Guests">
          <div className="grid md:grid-cols-2 gap-4">
            <Field label="Anticipated number of guests">
              <Input type="number" min={0} value={form.expected_guests} onChange={e => set('expected_guests', e.target.value)} />
            </Field>
            <Field label="Age range">
              <Input value={form.age_range} onChange={e => set('age_range', e.target.value)} placeholder="e.g. all ages, 18+" />
            </Field>
          </div>
          <Field label="Accessibility requirements">
            <Textarea rows={2} value={form.accessibility_requirements} onChange={e => set('accessibility_requirements', e.target.value)} />
          </Field>
        </Section>

        {/* Film / Media — provisioning for the screen upstairs. There isn't one
            down here. */}
        {!backstage && (
          <Section title="Film / Media">
            <ToggleRow label="Renter will provide DVD, streaming, or media access" checked={form.renter_provides_media} onChange={v => set('renter_provides_media', v)} />
            <ToggleRow label="Kenworthy will provide DVD, streaming, or media access" checked={form.kenworthy_provides_media} onChange={v => set('kenworthy_provides_media', v)} />
            <Field label="Media notes">
              <Textarea rows={2} value={form.media_notes} onChange={e => set('media_notes', e.target.value)} placeholder="Title, format, source link, rights, etc." />
            </Field>
          </Section>
        )}

        {/* Description */}
        <Section title="Event Description">
          <Field label="Short description of your event">
            <Textarea rows={4} value={form.event_description} onChange={e => set('event_description', e.target.value)} />
          </Field>
          <Field label="Order & type of activities" hint="Anything we should know to make your event run smoothly.">
            <Textarea rows={4} value={form.activity_order} onChange={e => set('activity_order', e.target.value)} />
          </Field>
        </Section>

        <div className="pt-4 border-t border-border/40 space-y-3">
          <Turnstile onToken={setTurnstileToken} />
          {/* Stacked on a phone, a row from `sm`.

              It was a bare `justify-between` row at every width. The submit
              button inherits `whitespace-nowrap` from the button base, so its
              min-content width is the whole label — and "Checking your
              browser…", the widest of the four states, does not fit beside the
              note at 360px. Neither item could shrink, so the row pushed the
              page 16px wider than the viewport and the whole document scrolled
              sideways. Stacking removes the competition for the width, and
              `w-full` below `sm` makes the submit a full-width tap target
              rather than a content-width one. */}
          <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
            <p className="text-sm font-serif text-muted-foreground italic">
              {backstage ? 'This is an enquiry, not a booking.' : 'This form is not your contract.'}
            </p>
            {/*
              Held until the bot check has handed over a token — but only when
              there is a check to wait for. `turnstileConfigured` is false until
              the Cloudflare site key is set, and gating on the token alone
              would then disable the button forever.
            */}
            {/*
              The label has to say which of the two waits this is. A managed
              Turnstile widget usually renders nothing at all, so on a first
              visit the only thing a person sees is a Send button that does not
              work — for a second or two normally, longer on a slow network.
              "Send Request" sitting there greyed out reads as a broken form;
              naming the check turns the same wait into something legible.
            */}
            <Button
              type="submit"
              size="lg"
              className="w-full sm:w-auto sm:shrink-0"
              disabled={submitting || (turnstileConfigured && !turnstileToken)}
            >
              {submitting
                ? 'Sending…'
                : turnstileConfigured && !turnstileToken
                  ? 'Checking your browser…'
                  : backstage ? 'Send Enquiry' : 'Send Request'}
            </Button>
          </div>
        </div>
        {token && <input type="hidden" value={token} readOnly />}
      </form>
    </div>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <div>
        <h2 className="font-display text-xl uppercase tracking-wide text-accent">{title}</h2>
        {hint && <p className="font-serif text-sm text-muted-foreground mt-1">{hint}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

/**
 * A labelled control.
 *
 * The label is wired to what it labels, which it was not: every `<Label>` on
 * this form rendered with no `htmlFor` and nothing nested inside it, so the
 * association existed visually and nowhere else. Clicking "Email" did not focus
 * the email box, and a screen reader read the whole sheet as unlabelled text
 * boxes. Nothing catches that on its own — the markup is valid, the layout is
 * right, and the form submits.
 *
 * So the id is generated here and pushed onto the child, rather than spelled
 * out at every call site where it would be forgotten exactly once and stay
 * forgotten. `aria-labelledby` as well as `htmlFor`, because two of these wrap
 * something that is not a form control — the venue radio group, and the
 * read-only venue in Backstage mode — and `htmlFor` pointing at a div does
 * nothing.
 */
function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  const id = useId();
  const labelId = `${id}-label`;
  const hintId = `${id}-hint`;

  const control = isValidElement(children)
    ? cloneElement(children as React.ReactElement<any>, {
        id: (children as React.ReactElement<any>).props.id ?? id,
        'aria-labelledby': labelId,
        'aria-describedby': hint ? hintId : undefined,
      })
    : children;

  return (
    <div className="space-y-2">
      <Label id={labelId} htmlFor={id} className="font-serif">{label}</Label>
      {control}
      {hint && <p id={hintId} className="font-serif text-sm text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Same association problem as Field, same fix — the switch is the control. */
function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
      <Label htmlFor={id} className="font-serif font-normal text-sm cursor-pointer">{label}</Label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}