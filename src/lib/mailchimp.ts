import { supabase } from '@/integrations/supabase/client';

export type MailchimpTag =
  | 'newsletter'
  | 'account-signup'
  | 'ticket-buyer'
  | 'donor'
  | 'film-pass'
  | 'dvd-renter'
  | string;

export interface SubscribeArgs {
  email: string;
  first_name?: string;
  last_name?: string;
  tags?: MailchimpTag[];
  source?: string;
  merge_fields?: Record<string, string | number | null>;
  interests?: Record<string, boolean>;
  unsubscribe?: boolean;
}

/**
 * Fire-and-forget Mailchimp upsert. Never throws — marketing sync must not
 * block ticket sales, donations, or account creation.
 */
export async function subscribeToMailchimp(args: SubscribeArgs): Promise<boolean> {
  try {
    const { data, error } = await supabase.functions.invoke('mailchimp-subscribe', {
      body: args,
    });
    if (error) {
      console.warn('[mailchimp] subscribe failed', error);
      return false;
    }
    // Mark the profile as synced if we have an authenticated user that matches
    const { data: userData } = await supabase.auth.getUser();
    if (userData?.user?.email?.toLowerCase() === args.email.toLowerCase()) {
      await supabase
        .from('profiles')
        .update({ mailchimp_synced_at: new Date().toISOString() })
        .eq('id', userData.user.id);
    }
    return Boolean(data);
  } catch (e) {
    console.warn('[mailchimp] subscribe threw', e);
    return false;
  }
}

/**
 * Record a Mailchimp e-commerce order (fire-and-forget).
 */
export interface EcomOrderLine {
  id: string;
  product_id: string;
  product_title: string;
  quantity: number;
  price: number;
  category?: string;
}
export async function recordMailchimpOrder(args: {
  email: string;
  first_name?: string;
  last_name?: string;
  order: { id: string; total: number; lines: EcomOrderLine[] };
}): Promise<void> {
  try {
    await supabase.functions.invoke('mailchimp-ecommerce', { body: args });
  } catch (e) {
    console.warn('[mailchimp] ecommerce failed', e);
  }
}

/**
 * Recompute LTV / last purchase / favorite genre / interests from the DB
 * for the current signed-in user and push everything to Mailchimp in one
 * call. Adds any additional tags provided. Fire-and-forget.
 *
 * `unsubscribe: true` skips profile enrichment and just tells Mailchimp
 * to unsubscribe this address (used when the user clears the opt-in box).
 */
export async function syncMailchimpProfile(opts: {
  extraTags?: MailchimpTag[];
  source?: string;
  unsubscribe?: boolean;
  addInterests?: Array<'Films' | 'Live Performances' | 'Special Events' | 'Backstage'>;
} = {}): Promise<void> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    const user = userData?.user;
    if (!user?.email) return;

    const { data: profile } = await supabase
      .from('profiles')
      .select('display_name, marketing_opt_in, mailchimp_interest_ids')
      .eq('id', user.id)
      .maybeSingle();
    // Only sync if the user has consented, unless we're explicitly unsubscribing
    if (!opts.unsubscribe && !profile?.marketing_opt_in) return;

    const [first, ...rest] = (profile?.display_name || '').trim().split(/\s+/);

    if (opts.unsubscribe) {
      await subscribeToMailchimp({
        email: user.email,
        first_name: first ?? '',
        last_name: rest.join(' '),
        source: opts.source,
        unsubscribe: true,
      });
      return;
    }

    // Lifetime ticket spend + last purchase date + fav genre
    const [ticketsRes, donationsRes, cfgRes] = await Promise.all([
      supabase
        .from('tickets')
        .select('total_price, created_at, showings(movies(genre))')
        .eq('user_id', user.id)
        .eq('status', 'confirmed'),
      supabase
        .from('donations')
        .select('amount_cents, created_at')
        .eq('user_id', user.id)
        .eq('status', 'completed'),
      supabase.from('app_config').select('value').eq('key', 'mailchimp_interests').maybeSingle(),
    ]);

    const tickets = (ticketsRes.data as any[]) || [];
    const donations = (donationsRes.data as any[]) || [];
    const ltvTickets = tickets.reduce((s, t) => s + Number(t.total_price || 0), 0);
    const ltvDonations = donations.reduce((s, d) => s + Number(d.amount_cents || 0) / 100, 0);
    const lastPurchDates = [
      ...tickets.map((t: any) => t.created_at),
      ...donations.map((d: any) => d.created_at),
    ].filter(Boolean).sort();
    const lastPurch = lastPurchDates.length ? lastPurchDates[lastPurchDates.length - 1] : null;

    const genreCounts: Record<string, number> = {};
    for (const t of tickets) {
      const g = t?.showings?.movies?.genre;
      if (g) genreCounts[g] = (genreCounts[g] || 0) + 1;
    }
    const favGenre = Object.entries(genreCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

    // Interests: only pass if we know the IDs
    const groupIds: Record<string, string> = ((cfgRes.data as any)?.value?.group_ids) || {};
    const interests: Record<string, boolean> | undefined = opts.addInterests?.length
      ? Object.fromEntries(opts.addInterests.map((n) => [groupIds[n], true]).filter(([id]) => !!id))
      : undefined;

    // Cache new totals in the profile
    await supabase.from('profiles').update({
      mailchimp_ltv_tickets: ltvTickets,
      mailchimp_ltv_donations: ltvDonations,
      mailchimp_last_purchase_at: lastPurch,
      mailchimp_fav_genre: favGenre,
    }).eq('id', user.id);

    await subscribeToMailchimp({
      email: user.email,
      first_name: first ?? '',
      last_name: rest.join(' '),
      tags: opts.extraTags,
      source: opts.source,
      merge_fields: {
        LTV_TICKETS: Math.round(ltvTickets * 100) / 100,
        LTV_DONATIONS: Math.round(ltvDonations * 100) / 100,
        LAST_PURCH: lastPurch ? lastPurch.slice(0, 10) : '',
        FAV_GENRE: favGenre ?? '',
      },
      interests,
    });
  } catch (e) {
    console.warn('[mailchimp] syncMailchimpProfile threw', e);
  }
}