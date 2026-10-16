import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';

/**
 * Open a signed contract as it was signed, from the private signed-contracts
 * bucket, through a URL that lasts a minute.
 *
 * Call it straight from a click: the tab is opened before the await, while the
 * click still counts as a user gesture, because a window.open after it is a
 * popup and gets blocked.
 */
export async function openSignedContractPdf(path: string) {
  const tab = window.open('', '_blank');
  const { data, error } = await supabase.storage.from('signed-contracts').createSignedUrl(path, 60);
  if (error || !data) {
    tab?.close();
    toast.error(error?.message || 'Could not open the signed PDF');
    return;
  }
  if (tab) tab.location.href = data.signedUrl;
  else window.location.href = data.signedUrl;
}
