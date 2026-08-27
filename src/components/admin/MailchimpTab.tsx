import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { CollapsibleSection } from './CollapsibleSection';
import { toast } from 'sonner';
import { Mail, Loader2, Copy, ExternalLink, RefreshCw } from 'lucide-react';
import { format } from 'date-fns';
import { syncMailchimpProfile } from '@/lib/mailchimp';
import { topGenre } from '@/lib/genres';

/**
 * Admin control panel for the Mailchimp integration.
 *  - Bootstrap: creates the "Programming" interest category + e-commerce
 *    store in Mailchimp and prints the webhook URL to paste into
 *    Mailchimp's audience settings.
 *  - Backfill: walks existing profiles and pushes merge fields + tags.
 *  - Per-showing campaign draft: prefills a Mailchimp campaign with the
 *    showing's poster, description, and buy link.
 */
export default function MailchimpTab() {
  const [bootstrapping, setBootstrapping] = useState(false);
  const [webhook, setWebhook] = useState<string | null>(null);
  const [showings, setShowings] = useState<any[]>([]);
  const [backfilling, setBackfilling] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const [busyShowing, setBusyShowing] = useState<string | null>(null);

  useEffect(() => {
    // Show existing webhook secret if bootstrap has been run
    supabase.from('app_config').select('value').eq('key', 'mailchimp_webhook').maybeSingle()
      .then(({ data }) => {
        const secret = (data?.value as any)?.secret;
        if (secret) {
          const url = `${(import.meta as any).env.VITE_SUPABASE_URL}/functions/v1/mailchimp-webhook?s=${secret}`;
          setWebhook(url);
        }
      });
    // Load upcoming showings for campaign drafts
    supabase.from('showings')
      .select('id, show_datetime, movie:movies(title, poster_url), event:events(title, poster_url), performance:live_performances(title, poster_url)')
      .gte('show_datetime', new Date().toISOString())
      .order('show_datetime', { ascending: true })
      .limit(30)
      .then(({ data }) => setShowings(data || []));
  }, []);

  async function runBootstrap() {
    setBootstrapping(true);
    try {
      const { data, error } = await supabase.functions.invoke('mailchimp-bootstrap', { body: {} });
      if (error) throw error;
      if ((data as any)?.webhook_url) setWebhook((data as any).webhook_url);
      toast.success('Mailchimp bootstrap complete');
    } catch (e: any) {
      toast.error(e?.message || 'Bootstrap failed');
    } finally {
      setBootstrapping(false);
    }
  }

  async function runBackfill() {
    if (!confirm('Backfill LTV, tags, and interest groups for all opted-in profiles? This can take a minute.')) return;
    setBackfilling(true);
    try {
      const { data: profiles } = await supabase
        .from('profiles')
        .select('id, email, marketing_opt_in')
        .eq('marketing_opt_in', true);
      const list = (profiles || []).filter((p: any) => p.email);
      setProgress({ done: 0, total: list.length });
      // Sequential, one-at-a-time to stay well under Mailchimp rate limits
      for (let i = 0; i < list.length; i++) {
        const p: any = list[i];
        // Only the current logged-in user's syncMailchimpProfile works client-side.
        // For arbitrary profiles we fall back to a plain subscribe call — the
        // server sees the admin JWT so merge fields are permitted.
        try {
          const { data: tRes } = await supabase
            .from('tickets')
            .select('total_price, created_at, showings(movies(genre))')
            .eq('user_id', p.id).eq('status', 'confirmed');
          const { data: dRes } = await supabase
            .from('donations')
            .select('amount_cents, created_at')
            .eq('user_id', p.id).eq('status', 'completed');
          const tickets = tRes || [];
          const donations = dRes || [];
          const ltvT = tickets.reduce((s, t: any) => s + Number(t.total_price || 0), 0);
          const ltvD = donations.reduce((s, d: any) => s + Number(d.amount_cents || 0) / 100, 0);
          const dates = [...tickets.map((t: any) => t.created_at), ...donations.map((d: any) => d.created_at)].filter(Boolean).sort();
          const last = dates.length ? dates[dates.length - 1] : null;
          // Same rule as syncMailchimpProfile: split first, credit each genre.
          const favGenre = topGenre((tickets as any[]).map(t => t?.showings?.movies?.genre));
          const tags: string[] = [];
          if (tickets.length) tags.push('ticket-buyer');
          if (donations.length) tags.push('donor');
          await supabase.functions.invoke('mailchimp-subscribe', {
            body: {
              email: p.email,
              tags,
              source: 'backfill',
              merge_fields: {
                LTV_TICKETS: Math.round(ltvT * 100) / 100,
                LTV_DONATIONS: Math.round(ltvD * 100) / 100,
                LAST_PURCH: last ? String(last).slice(0, 10) : '',
                FAV_GENRE: favGenre ?? '',
              },
            },
          });
        } catch { /* keep going */ }
        setProgress({ done: i + 1, total: list.length });
      }
      toast.success(`Backfilled ${list.length} contacts`);
    } catch (e: any) {
      toast.error(e?.message || 'Backfill failed');
    } finally {
      setBackfilling(false);
    }
  }

  async function draftCampaign(showingId: string) {
    setBusyShowing(showingId);
    try {
      const { data, error } = await supabase.functions.invoke('mailchimp-campaign', { body: { showing_id: showingId } });
      if (error) throw error;
      const url = (data as any)?.edit_url;
      if (url) {
        window.open(url, '_blank', 'noopener');
        toast.success('Draft created — opened in Mailchimp');
      } else {
        toast.success('Draft created in Mailchimp');
      }
    } catch (e: any) {
      toast.error(e?.message || 'Campaign draft failed');
    } finally {
      setBusyShowing(null);
    }
  }

  return (
    <div className="space-y-6">
      <CollapsibleSection id="mailchimp.integration" title="Mailchimp integration" icon={Mail} defaultOpen>
        <div className="text-sm text-muted-foreground">
          Kenworthy is connected to a Mailchimp audience. Tags (<code>ticket-buyer</code>, <code>donor</code>, <code>film-pass</code>, <code>dvd-renter</code>), merge fields (<code>LTV_TICKETS</code>, <code>LTV_DONATIONS</code>, <code>LAST_PURCH</code>, <code>FAV_GENRE</code>), and interest groups (Films / Live Performances / Special Events / Backstage) sync automatically on each purchase.
        </div>
        <div className="flex flex-wrap gap-2">
          <Button onClick={runBootstrap} disabled={bootstrapping} variant="outline">
            {bootstrapping && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Bootstrap store & interest groups
          </Button>
          <Button onClick={runBackfill} disabled={backfilling} variant="outline">
            {backfilling && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Backfill existing contacts
          </Button>
          <Button onClick={() => syncMailchimpProfile({ source: 'admin-self-sync' }).then(() => toast.success('Your own contact refreshed'))} variant="ghost">
            <RefreshCw className="h-4 w-4 mr-1" /> Sync my contact
          </Button>
        </div>
        {progress && (
          <div className="text-xs text-muted-foreground">Backfilling {progress.done} / {progress.total}…</div>
        )}
        {webhook && (
          <div className="space-y-2 rounded-md border p-3 bg-muted/30">
            <div className="text-xs font-medium">Inbound webhook URL</div>
            <div className="text-xs text-muted-foreground">Paste this into Mailchimp → Audience → Manage Audience → Webhooks. Enable all event types.</div>
            <div className="flex gap-2">
              <Input readOnly value={webhook} className="font-mono text-xs" />
              <Button size="icon" variant="outline" onClick={() => { navigator.clipboard.writeText(webhook); toast.success('Copied'); }}><Copy className="h-4 w-4" /></Button>
            </div>
          </div>
        )}
      </CollapsibleSection>

      <CollapsibleSection
        id="mailchimp.draft"
        title="Draft a campaign from a showing"
        count={showings.length}
      >
        {showings.length === 0 && <div className="text-sm text-muted-foreground">No upcoming showings.</div>}
        {showings.map((s: any) => {
          const prod = s.movie || s.event || s.performance || {};
          const kind = s.movie ? 'Film' : s.event ? 'Event' : 'Performance';
          return (
            <div key={s.id} className="flex items-center justify-between gap-3 rounded-md border p-3">
              <div className="min-w-0 flex-1">
                <div className="font-medium truncate">{prod.title || 'Untitled'}</div>
                <div className="text-xs text-muted-foreground flex items-center gap-2">
                  <Badge variant="outline" className="text-xs">{kind}</Badge>
                  {s.show_datetime && format(new Date(s.show_datetime), 'EEE MMM d, h:mm a')}
                </div>
              </div>
              <Button size="sm" variant="outline" disabled={busyShowing === s.id} onClick={() => draftCampaign(s.id)}>
                {busyShowing === s.id ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <ExternalLink className="h-4 w-4 mr-1" />}
                Draft in Mailchimp
              </Button>
            </div>
          );
        })}
      </CollapsibleSection>
    </div>
  );
}