import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';

function normalizeTitle(raw: string | null | undefined): string {
  if (!raw) return '';
  let s = String(raw).toLowerCase();
  s = s.replace(/\(\d{4}\)/g, ' ');
  s = s.replace(/[\u2018\u2019']/g, '');
  s = s.replace(/[^a-z0-9]+/g, ' ').trim();
  s = s.replace(/^(the|a|an)\s+/, '');
  return s.replace(/\s+/g, ' ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const authHeader = req.headers.get('Authorization') ?? '';
    const userClient = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    const { data: isAdmin } = await userClient.rpc('has_role', { _user_id: user.id, _role: 'admin' });
    if (!isAdmin) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    // Build a lookup: normalized title -> movie id
    const { data: movies, error: mErr } = await admin.from('movies').select('id,title');
    if (mErr) throw mErr;
    const byTitle = new Map<string, string>();
    for (const m of movies ?? []) byTitle.set(normalizeTitle(m.title), m.id);

    // Process unmatched historical screenings in batches
    let totalMatched = 0;
    let processed = 0;
    const BATCH = 500;
    while (true) {
      const { data: rows, error } = await admin
        .from('historical_screenings')
        .select('id, film_title_normalized')
        .is('matched_movie_id', null)
        .limit(BATCH);
      if (error) throw error;
      if (!rows || rows.length === 0) break;
      processed += rows.length;

      const updates: { id: string; matched_movie_id: string }[] = [];
      for (const r of rows) {
        const mid = byTitle.get(r.film_title_normalized);
        if (mid) updates.push({ id: r.id, matched_movie_id: mid });
      }
      if (updates.length) {
        // Per-row update because we only want to touch matched rows
        for (const u of updates) {
          await admin
            .from('historical_screenings')
            .update({ matched_movie_id: u.matched_movie_id, match_confidence: 'auto_high' })
            .eq('id', u.id);
        }
        totalMatched += updates.length;
      }
      if (rows.length < BATCH) break;
    }

    return new Response(JSON.stringify({ processed, matched: totalMatched }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: (e as Error).message }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});