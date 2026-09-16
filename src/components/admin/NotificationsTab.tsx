import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { CollapsibleSection } from './CollapsibleSection';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Bell, Loader2, Save, MailCheck, MailX } from 'lucide-react';
import {
  STAFF_NOTIFICATIONS_CONFIG_KEY,
  STAFF_NOTIFICATION_TYPES,
  parseRecipientList,
  parseStaffNotificationSettings,
  validateSetting,
  type StaffNotificationSettings,
} from '@/lib/staffNotifications';

/**
 * Who inside the building is emailed when something happens.
 *
 * One card per notification type from the registry in
 * src/lib/staffNotifications.ts, each with an on/off switch and a recipient
 * list. Saving writes the whole `staff_notifications` row to app_config; the
 * edge function that sends the email reads the same row on every send, so a
 * change here takes effect on the next submission with no deploy.
 *
 * The recipient box is the only place these addresses come from. That is a
 * security property, not just a convenience: the public forms that trigger
 * these emails are unauthenticated, and if a form could name a recipient it
 * would be an open relay with our verified sender on it. The screen says so
 * in words, because the next person to touch this should know why a "notify
 * the submitter too" checkbox is not the small feature it looks like.
 */

type Draft = { enabled: boolean; recipientsText: string };

export default function NotificationsTab() {
  const [saved, setSaved] = useState<StaffNotificationSettings | null>(null);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingKind, setSavingKind] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('app_config')
      .select('value')
      .eq('key', STAFF_NOTIFICATIONS_CONFIG_KEY)
      .maybeSingle();
    if (error) toast.error(error.message);
    // A missing row reads as the defaults — the same thing the function does.
    const parsed = parseStaffNotificationSettings(data?.value ?? null);
    setSaved(parsed);
    setDrafts(
      Object.fromEntries(
        Object.entries(parsed).map(([kind, s]) => [
          kind,
          { enabled: s.enabled, recipientsText: s.recipients.join(', ') },
        ]),
      ),
    );
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  function setDraft(kind: string, patch: Partial<Draft>) {
    setDrafts(d => ({ ...d, [kind]: { ...d[kind], ...patch } }));
  }

  async function save(kind: string) {
    if (!saved) return;
    const draft = drafts[kind];
    const { recipients, invalid } = parseRecipientList(draft.recipientsText);
    const next = { enabled: draft.enabled, recipients };
    const problem = validateSetting(next, invalid);
    if (problem) { toast.error(problem); return; }

    // The whole row is rewritten with every kind's saved value plus this
    // edit, so saving one card cannot drop another card's list.
    const value: StaffNotificationSettings = { ...saved, [kind]: next };

    setSavingKind(kind);
    // .select() is not optional: a write blocked by RLS comes back as 204
    // with no error, which supabase-js reports as success.
    const { data, error } = await supabase
      .from('app_config')
      .upsert({
        key: STAFF_NOTIFICATIONS_CONFIG_KEY,
        // Plain data; the cast is only because an interface has no index signature.
        value: value as unknown as Json,
        updated_at: new Date().toISOString(),
      })
      .select('key');
    setSavingKind(null);
    if (error) { toast.error(error.message); return; }
    if (!data?.length) { toast.error('Nothing was saved — you may not have permission.'); return; }

    setSaved(value);
    setDraft(kind, { recipientsText: recipients.join(', ') });
    toast.success(
      next.enabled
        ? `Saved. These now go to ${recipients.join(', ')}.`
        : 'Saved. This notification is off — nobody will be emailed.',
    );
  }

  if (loading || !saved) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground py-8">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading notification settings…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <CollapsibleSection
        id="notifications.staff"
        title="Staff notifications"
        icon={Bell}
        defaultOpen
        description="Which inboxes are emailed when something happens on the public site. Changes take effect on the next submission."
      >
        <p className="text-sm text-muted-foreground">
          Recipients are set here and only here. A public form can never choose who
          receives one of these emails — the person who submitted it appears as the
          reply-to address, so replying goes straight to them.
        </p>

        <div className="space-y-4 pt-2">
          {STAFF_NOTIFICATION_TYPES.map(type => {
            const current = saved[type.kind];
            const draft = drafts[type.kind];
            if (!draft) return null;
            const dirty =
              draft.enabled !== current.enabled ||
              draft.recipientsText.trim() !== current.recipients.join(', ');
            const busy = savingKind === type.kind;
            const inputId = `notify-${type.kind}-recipients`;

            return (
              <div key={type.kind} className="rounded-md border border-border/60 p-4 space-y-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{type.label}</h3>
                      {current.enabled
                        ? <Badge variant="outline" className="gap-1"><MailCheck className="h-3 w-3" /> On</Badge>
                        : <Badge variant="secondary" className="gap-1"><MailX className="h-3 w-3" /> Off</Badge>}
                    </div>
                    <p className="text-sm text-muted-foreground max-w-prose">{type.description}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label htmlFor={`notify-${type.kind}-enabled`} className="text-sm">
                      {draft.enabled ? 'Sending' : 'Not sending'}
                    </Label>
                    <Switch
                      id={`notify-${type.kind}-enabled`}
                      checked={draft.enabled}
                      onCheckedChange={v => setDraft(type.kind, { enabled: v })}
                      disabled={busy}
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor={inputId}>Send to</Label>
                  <Textarea
                    id={inputId}
                    rows={2}
                    value={draft.recipientsText}
                    onChange={e => setDraft(type.kind, { recipientsText: e.target.value })}
                    placeholder={type.defaultRecipients.join(', ')}
                    disabled={busy}
                    className="font-mono text-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Separate addresses with commas or new lines.
                    {' '}Currently going to: <span className="font-medium text-foreground">
                      {current.enabled ? current.recipients.join(', ') : 'nobody (off)'}
                    </span>.
                  </p>
                </div>

                <div className="flex items-center gap-3">
                  <Button size="sm" onClick={() => save(type.kind)} disabled={busy || !dirty}>
                    {busy ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
                    Save
                  </Button>
                  {dirty && !busy && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => setDraft(type.kind, {
                        enabled: current.enabled,
                        recipientsText: current.recipients.join(', '),
                      })}
                    >
                      Discard changes
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </CollapsibleSection>
    </div>
  );
}
