import { useId, useState } from 'react';
import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Turnstile, turnstileConfigured } from '@/components/Turnstile';
import { invokeFunction } from '@/lib/functions';
import { marqueeBookingSchema, toRentalRequestPayload } from '@/lib/marqueeBooking';

/**
 * "Book the marquee" — the form behind the hero button.
 *
 * Five fields, because that is all the box office needs to start the
 * conversation: who you are, how to reach you, what the sign should say, and
 * when. Everything else about a marquee booking is settled by a human on the
 * follow-up, so asking it here would only be a longer form with a worse
 * completion rate.
 *
 * The submission path is the full rental form's, verbatim — same edge function,
 * same bot check, same queue. See src/lib/marqueeBooking.ts for why.
 */
export function MarqueeBookingForm({ trigger }: { trigger: React.ReactNode }) {
  const id = useId();
  const [open, setOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);

  const [form, setForm] = useState({
    applicant_name: '',
    email: '',
    phone: '',
    marquee_text: '',
    proposed_date: '',
    end_date: '',
  });

  const set = (key: keyof typeof form, value: string) =>
    setForm(prev => ({ ...prev, [key]: value }));

  // Today, as the date input wants it — so the picker cannot offer a day that
  // has already gone.
  const today = new Date();
  const minDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;

  function reset() {
    setForm({ applicant_name: '', email: '', phone: '', marquee_text: '', proposed_date: '', end_date: '' });
    setErrors({});
    setFormError(null);
    setSubmitted(false);
    setTurnstileToken(null);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);

    const parsed = marqueeBookingSchema.safeParse(form);
    if (!parsed.success) {
      // Errors land against their own field rather than in a toast that
      // disappears before a screen reader reaches it.
      const next: Record<string, string> = {};
      for (const issue of parsed.error.errors) {
        const field = String(issue.path[0] ?? 'form');
        if (!next[field]) next[field] = issue.message;
      }
      setErrors(next);
      return;
    }
    setErrors({});
    setSubmitting(true);

    try {
      await invokeFunction('rental-request', toRentalRequestPayload(parsed.data, turnstileToken));
    } catch (err) {
      setSubmitting(false);
      setFormError(err instanceof Error ? err.message : 'Could not send that request');
      return;
    }
    setSubmitting(false);
    setSubmitted(true);
  }

  function field(name: keyof typeof form, label: string, node: React.ReactNode, hint?: string) {
    const errorId = `${id}-${name}-error`;
    const hintId = `${id}-${name}-hint`;
    return (
      <div className="space-y-1.5">
        <Label htmlFor={`${id}-${name}`}>{label}</Label>
        {node}
        {hint && !errors[name] && (
          <p id={hintId} className="text-xs font-serif text-muted-foreground">{hint}</p>
        )}
        {errors[name] && (
          <p id={errorId} className="text-xs font-serif text-destructive">{errors[name]}</p>
        )}
      </div>
    );
  }

  const describedBy = (name: keyof typeof form, hint?: boolean) =>
    errors[name] ? `${id}-${name}-error` : hint ? `${id}-${name}-hint` : undefined;

  return (
    <Dialog
      open={open}
      onOpenChange={next => {
        setOpen(next);
        if (!next) reset();
      }}
    >
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent className="sm:max-w-lg max-h-[90vh] overflow-y-auto">
        {submitted ? (
          <>
            <DialogHeader>
              <DialogTitle className="font-display uppercase text-2xl">Request sent</DialogTitle>
              <DialogDescription className="font-serif text-base">
                Thank you — this is a request rather than a confirmed booking. Someone from the
                Kenworthy will be in touch to confirm the date, check the message fits the sign,
                and take it from there.
              </DialogDescription>
            </DialogHeader>
            <Button onClick={() => setOpen(false)}>Close</Button>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle className="font-display uppercase text-2xl">Book the marquee</DialogTitle>
              <DialogDescription className="font-serif text-base">
                $150 for one side, one day. Tell us what it should say and when — we'll confirm
                availability and the details by email. Sending this does not reserve the date.
              </DialogDescription>
            </DialogHeader>

            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
              {field(
                'applicant_name',
                'Your name',
                <Input
                  id={`${id}-applicant_name`}
                  value={form.applicant_name}
                  onChange={e => set('applicant_name', e.target.value)}
                  aria-invalid={Boolean(errors.applicant_name)}
                  aria-describedby={describedBy('applicant_name')}
                  autoComplete="name"
                />,
              )}

              {field(
                'email',
                'Email',
                <Input
                  id={`${id}-email`}
                  type="email"
                  value={form.email}
                  onChange={e => set('email', e.target.value)}
                  aria-invalid={Boolean(errors.email)}
                  aria-describedby={describedBy('email')}
                  autoComplete="email"
                />,
              )}

              {field(
                'phone',
                'Phone (optional)',
                <Input
                  id={`${id}-phone`}
                  type="tel"
                  value={form.phone}
                  onChange={e => set('phone', e.target.value)}
                  aria-invalid={Boolean(errors.phone)}
                  aria-describedby={describedBy('phone')}
                  autoComplete="tel"
                />,
              )}

              {field(
                'marquee_text',
                'What should the marquee say?',
                <Textarea
                  id={`${id}-marquee_text`}
                  value={form.marquee_text}
                  onChange={e => set('marquee_text', e.target.value)}
                  rows={3}
                  maxLength={300}
                  aria-invalid={Boolean(errors.marquee_text)}
                  aria-describedby={describedBy('marquee_text', true)}
                />,
                'Short and in capitals reads best from the street. We will let you know what fits.',
              )}

              <div className="grid sm:grid-cols-2 gap-4">
                {field(
                  'proposed_date',
                  'Day to display it',
                  <Input
                    id={`${id}-proposed_date`}
                    type="date"
                    min={minDate}
                    value={form.proposed_date}
                    onChange={e => set('proposed_date', e.target.value)}
                    aria-invalid={Boolean(errors.proposed_date)}
                    aria-describedby={describedBy('proposed_date')}
                  />,
                )}
                {field(
                  'end_date',
                  'Through (optional)',
                  <Input
                    id={`${id}-end_date`}
                    type="date"
                    min={form.proposed_date || minDate}
                    value={form.end_date}
                    onChange={e => set('end_date', e.target.value)}
                    aria-invalid={Boolean(errors.end_date)}
                    aria-describedby={describedBy('end_date', true)}
                  />,
                  'Leave blank for a single day.',
                )}
              </div>

              <Turnstile onToken={setTurnstileToken} />

              {formError && (
                <p role="alert" className="text-sm font-serif text-destructive">{formError}</p>
              )}

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-border/40">
                <p className="text-xs font-serif text-muted-foreground italic">
                  Renting the room instead?{' '}
                  <Link to="/rental-request" className="underline">Full rental request</Link>
                </p>
                {/*
                  Two different waits share this button, and the label has to say
                  which. A managed Turnstile widget usually renders nothing, so a
                  greyed-out "Send request" with no explanation reads as a broken
                  form — the same reasoning as the full rental form's submit.
                */}
                <Button type="submit" disabled={submitting || (turnstileConfigured && !turnstileToken)}>
                  {submitting
                    ? 'Sending…'
                    : turnstileConfigured && !turnstileToken
                      ? 'Checking your browser…'
                      : 'Send request'}
                </Button>
              </div>
            </form>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
