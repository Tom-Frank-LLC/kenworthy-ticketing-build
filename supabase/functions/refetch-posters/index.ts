import { createClient } from 'npm:@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TABLES = ['movies', 'events', 'live_performances'] as const;
const WP_SUFFIX_RE = /-\d+x\d+(\.(?:jpg|jpeg|png|webp|gif))(\?.*)?$/i;

type Report = {
  table: string;
  id: string;
  title: string;
  from: string;
  to?: string;
  status: 'updated' | 'skipped' | 'failed';
  reason?: string;
};

function stripSuffix(url: string): string | null {
  if (!WP_SUFFIX_RE.test(url)) return null;
  return url.replace(WP_SUFFIX_RE, '$1');
}

function contentTypeFor(url: string): string {
  const ext = url.split('.').pop()?.toLowerCase().split('?')[0] ?? '';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  return 'image/jpeg';
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
    const { data: isSuper } = await userClient.rpc('has_role', {
      _user_id: user.id, _role: 'superadmin',
    });
    if (!isSuper) {
      return new Response(JSON.stringify({ error: 'forbidden — superadmin only' }), {
        status: 403, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );

    const body = await req.json().catch(() => ({}));
    const dryRun: boolean = !!body.dryRun;

    const report: Report[] = [];

    for (const table of TABLES) {
      const { data: rows, error } = await admin
        .from(table)
        .select('id, title, poster_url')
        .not('poster_url', 'is', null);
      if (error) throw error;

      for (const row of rows ?? []) {
        const url: string = row.poster_url;
        const stripped = stripSuffix(url);
        if (!stripped) continue;

        if (dryRun) {
          report.push({ table, id: row.id, title: row.title, from: url, to: stripped, status: 'skipped', reason: 'dry-run' });
          continue;
        }

        try {
          // Fetch full-size original from WordPress.
          const res = await fetch(stripped, {
            headers: { 'User-Agent': 'Kenworthy-Poster-Rehydrator/1.0' },
            redirect: 'follow',
          });
          if (!res.ok) {
            report.push({ table, id: row.id, title: row.title, from: url, status: 'failed', reason: `fetch ${res.status}` });
            continue;
          }
          const buf = new Uint8Array(await res.arrayBuffer());
          if (buf.byteLength < 1024) {
            report.push({ table, id: row.id, title: row.title, from: url, status: 'failed', reason: `too small (${buf.byteLength}b)` });
            continue;
          }

          const basename = stripped.split('/').pop()!.split('?')[0];
          const objectPath = `wp-rehydrated/${row.id}-${basename}`;
          const ct = contentTypeFor(stripped);

          const { error: upErr } = await admin.storage
            .from('posters')
            .upload(objectPath, buf, { contentType: ct, upsert: true });
          if (upErr) {
            report.push({ table, id: row.id, title: row.title, from: url, status: 'failed', reason: `upload: ${upErr.message}` });
            continue;
          }

          const { data: pub } = admin.storage.from('posters').getPublicUrl(objectPath);
          const newUrl = pub.publicUrl;

          const { error: updErr } = await admin
            .from(table)
            .update({ poster_url: newUrl })
            .eq('id', row.id);
          if (updErr) {
            report.push({ table, id: row.id, title: row.title, from: url, status: 'failed', reason: `update: ${updErr.message}` });
            continue;
          }

          report.push({ table, id: row.id, title: row.title, from: url, to: newUrl, status: 'updated' });
        } catch (e) {
          report.push({
            table, id: row.id, title: row.title, from: url,
            status: 'failed', reason: e instanceof Error ? e.message : String(e),
          });
        }
      }
    }

    const summary = {
      total: report.length,
      updated: report.filter(r => r.status === 'updated').length,
      failed: report.filter(r => r.status === 'failed').length,
      skipped: report.filter(r => r.status === 'skipped').length,
      dryRun,
      report,
    };
    return new Response(JSON.stringify(summary, null, 2), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
      status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});