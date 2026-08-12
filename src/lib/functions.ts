import { supabase } from '@/integrations/supabase/client';

/**
 * Invoke an edge function and get the server's own error message back.
 *
 * supabase-js turns any non-2xx into a `FunctionsHttpError` whose `.message`
 * is the generic "Edge Function returned a non-2xx status code" — the JSON body
 * is left unread on `error.context`. For payments that is the difference
 * between telling a customer "Your card was declined. Please use a different
 * card." and telling them nothing useful at all, so the body is unwrapped here.
 *
 * Throws an Error carrying the message worth showing; returns the parsed body
 * on success.
 */
export async function invokeFunction<T = unknown>(name: string, body: unknown): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });

  if (!error) {
    // Some functions answer 200 with { error } for soft failures.
    const payload = data as { error?: unknown } | null;
    if (payload && typeof payload === 'object' && payload.error) {
      throw new Error(String(payload.error));
    }
    return data as T;
  }

  let message = error.message;
  const response = (error as { context?: unknown }).context as Response | undefined;
  if (response && typeof response.json === 'function') {
    const parsed = (await response.json().catch(() => null)) as { error?: unknown } | null;
    if (parsed?.error) message = String(parsed.error);
  }

  throw new Error(message || 'Something went wrong. Please try again.');
}
