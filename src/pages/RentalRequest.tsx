import { useState } from 'react';
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
import { z } from 'zod';

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

const schema = z.object({
  event_title: z.string().trim().min(1, 'Required').max(200),
  applicant_name: z.string().trim().min(1, 'Required').max(120),
  email: z.string().trim().email('Invalid email').max(255),
});

export default function RentalRequest() {
  const [params] = useSearchParams();
  const token = params.get('token') || null;

  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const [form, setForm] = useState({
    event_title: '',
    proposed_date: '',
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
    venue_area: '',
    is_ticketed: false,
    is_public: false,
    needs_digital_ticketing: false,
    expected_guests: '',
    age_range: '',
    special_needs: '',
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
    const parsed = schema.safeParse(form);
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
      expected_guests: form.expected_guests ? parseInt(form.expected_guests, 10) : null,
      venue_area: form.venue_area || null,
      equipment: equipmentClean,
    };
    // strip empty strings to null for optional text fields
    for (const k of Object.keys(payload)) {
      if (payload[k] === '') payload[k] = null;
    }

    const { error } = await supabase.from('rental_requests').insert(payload);
    setSubmitting(false);
    if (error) {
      toast.error(error.message);
      return;
    }
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
              We've received your rental request. A member of the Kenworthy team will be in touch soon to discuss availability and next steps.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <Button asChild variant="outline"><Link to="/">Back to the Kenworthy</Link></Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-3xl py-10 px-4">
      <div className="mb-8 space-y-2">
        <p className="text-xs uppercase tracking-[0.2em] text-accent font-medium">Event Information Sheet</p>
        <h1 className="font-display text-4xl md:text-5xl uppercase">Theatre Rental Request</h1>
        <p className="font-serif text-muted-foreground">
          Tell us about your event and we'll get back to you. This form is not your contract — staff will follow up to confirm details.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="space-y-8">
        {/* Contact & Event */}
        <Section title="Contact & Event Information">
          <Field label="Event Title *">
            <Input required value={form.event_title} onChange={e => set('event_title', e.target.value)} />
          </Field>
          <Field label="Proposed Date">
            <Input type="date" value={form.proposed_date} onChange={e => set('proposed_date', e.target.value)} />
          </Field>
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
          <Field label="What would you like the marquee to read?" hint="The Kenworthy reserves the right to refuse any message placed publicly on the marquee. Staff may suggest an alternate option due to limited space.">
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
        </Section>

        {/* Equipment */}
        <Section title="Equipment Requests" hint="List the quantity where applicable.">
          <div className="grid md:grid-cols-2 gap-3">
            {EQUIPMENT.map(eq => (
              <div key={eq.key} className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
                <Label className="font-serif font-normal text-sm">{eq.label}</Label>
                <Input
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

        {/* Ticketing */}
        <Section title="Ticketing">
          <ToggleRow label="This is a ticketed event" checked={form.is_ticketed} onChange={v => set('is_ticketed', v)} />
          <ToggleRow label="Open to the public" checked={form.is_public} onChange={v => set('is_public', v)} />
          <ToggleRow label="Use the Kenworthy's digital platform for selling tickets" checked={form.needs_digital_ticketing} onChange={v => set('needs_digital_ticketing', v)} />
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
          <Field label="Special needs">
            <Textarea rows={2} value={form.special_needs} onChange={e => set('special_needs', e.target.value)} />
          </Field>
          <Field label="Accessibility requirements">
            <Textarea rows={2} value={form.accessibility_requirements} onChange={e => set('accessibility_requirements', e.target.value)} />
          </Field>
        </Section>

        {/* Film / Media */}
        <Section title="Film / Media">
          <ToggleRow label="Renter will provide DVD, streaming, or media access" checked={form.renter_provides_media} onChange={v => set('renter_provides_media', v)} />
          <ToggleRow label="Kenworthy will provide DVD, streaming, or media access" checked={form.kenworthy_provides_media} onChange={v => set('kenworthy_provides_media', v)} />
          <Field label="Media notes">
            <Textarea rows={2} value={form.media_notes} onChange={e => set('media_notes', e.target.value)} placeholder="Title, format, source link, rights, etc." />
          </Field>
        </Section>

        {/* Description */}
        <Section title="Event Description">
          <Field label="Short description of your event">
            <Textarea rows={4} value={form.event_description} onChange={e => set('event_description', e.target.value)} />
          </Field>
          <Field label="Order & type of activities" hint="Anything we should know to make your event run smoothly.">
            <Textarea rows={4} value={form.activity_order} onChange={e => set('activity_order', e.target.value)} />
          </Field>
        </Section>

        <div className="flex items-center justify-between gap-4 pt-4 border-t border-border/40">
          <p className="text-xs font-serif text-muted-foreground italic">This form is not your contract.</p>
          <Button type="submit" size="lg" disabled={submitting}>
            {submitting ? 'Sending…' : 'Send Request'}
          </Button>
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
        {hint && <p className="font-serif text-xs text-muted-foreground mt-1">{hint}</p>}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <Label className="font-serif">{label}</Label>
      {children}
      {hint && <p className="font-serif text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-center justify-between gap-3 rounded-md border border-border/40 px-3 py-2">
      <Label className="font-serif font-normal text-sm cursor-pointer">{label}</Label>
      <Switch checked={checked} onCheckedChange={onChange} />
    </div>
  );
}