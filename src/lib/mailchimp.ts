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