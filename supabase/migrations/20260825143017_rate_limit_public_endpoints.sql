-- A speed bump on the public endpoints, and an honest account of what it is.
--
-- The end-to-end audit recorded "no rate limiting anywhere" and recommended
-- Cloudflare rules. That recommendation was wrong, and the reason is worth
-- writing down because it is not obvious: WAF rules attach to a *zone*, the
-- Worker is served from `*.workers.dev` which is Cloudflare's zone rather than
-- ours, and every write endpoint the audit cared about lives on `*.supabase.co`
-- — behind Supabase's Cloudflare, not ours. No rule we could write would ever
-- see that traffic. Moving the site to kenworthy.org does not change it either:
-- the browser still calls Supabase directly, and putting Supabase behind our
-- own zone needs the Custom Domain add-on neither project has.
--
-- So the limit has to live where the request actually lands, which is here.
--
-- ---------------------------------------------------------------------------
-- What this is not
-- ---------------------------------------------------------------------------
--
-- A per-IP fixed-window counter stops casual scripted abuse from one address.
-- It does not stop a distributed attempt, and it cannot tell a busy library
-- behind one NAT from one determined script. Thresholds are therefore set well
-- above anything a person plausibly does, and this is a speed bump rather than
-- a wall. Turnstile — already on the rental form — is the stronger control, and
-- the donation form is the endpoint that most deserves it next.
--
-- Deliberately NOT covered: `/auth/v1/recover`. Supabase's own
-- `rate_limit_email_sent` already caps actual sends (~2/hour at the default,
-- confirmed in FINDINGS-staging-auth-email-rate-limit.md). The audit called
-- that endpoint unlimited on the strength of fourteen 200s, which were
-- nonexistent addresses that never generate a send. A second limiter in front
-- of a platform limiter would only add a second thing to misconfigure.
--
-- ---------------------------------------------------------------------------
-- The table stores no IP addresses
-- ---------------------------------------------------------------------------
--
-- `identifier` is a SHA-256 hex digest computed in the edge function; the raw
-- address never crosses the wire and is never written. That keeps a table of
-- who-visited-when from existing at all, which matters because these rows would
-- otherwise be exactly that. Rows are ephemeral by construction — `expires_at`
-- is minutes away — and a returning visitor reuses their row rather than adding
-- one.

CREATE TABLE IF NOT EXISTS public.rate_limits (
  -- Which limit this is: 'donation', 'ticket-access', 'mailchimp-subscribe'.
  -- Part of the key so one caller hitting one endpoint hard cannot lock
  -- themselves out of the others.
  bucket      text        NOT NULL,
  -- SHA-256 of the client address. Never a raw IP — see above.
  identifier  text        NOT NULL,
  count       integer     NOT NULL DEFAULT 0,
  expires_at  timestamptz NOT NULL,
  PRIMARY KEY (bucket, identifier)
);

COMMENT ON TABLE public.rate_limits IS
  'Fixed-window per-caller counters for the public edge functions. `identifier` is a SHA-256 digest of the client IP computed in the function — no raw address is ever stored. Rows are ephemeral (expires_at is minutes out) and self-purging; see check_rate_limit. Written only by service_role.';

-- Purging wants expires_at, not the primary key.
CREATE INDEX IF NOT EXISTS rate_limits_expires_at_idx ON public.rate_limits (expires_at);

-- RLS on, and no policies at all: this table is service_role-only, and
-- service_role bypasses RLS. Enabling it means a future blanket grant cannot
-- quietly turn the table into something anon can read — which is precisely how
-- 20260810165116 caught this codebase out before.
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.rate_limits FROM PUBLIC;
REVOKE ALL ON public.rate_limits FROM anon, authenticated;
GRANT ALL ON public.rate_limits TO service_role;

-- ---------------------------------------------------------------------------
-- Claim one request against a window, atomically
-- ---------------------------------------------------------------------------
--
-- One statement, because it has to be. PostgREST gives every RPC call its own
-- transaction, so a read-then-write would let two concurrent requests both see
-- count = limit - 1 and both proceed. `INSERT ... ON CONFLICT DO UPDATE`
-- resolves that in the row lock the upsert already takes: the second caller
-- blocks, then sees the first caller's increment.
--
-- Fixed window rather than sliding: a sliding window needs either a row per
-- request or a periodic sweep, and neither is worth it for a speed bump. The
-- known cost is that a caller can spend a full allowance at the end of one
-- window and another at the start of the next. At these thresholds that is not
-- a meaningful attack.
--
-- Returns the verdict rather than raising, so the caller decides what a refusal
-- looks like — `ticket-access` answers a browser following an emailed link and
-- must not hand back a raw error.

CREATE OR REPLACE FUNCTION public.check_rate_limit(
  p_bucket          text,
  p_identifier      text,
  p_limit           integer,
  p_window_seconds  integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count   integer;
  v_expires timestamptz;
BEGIN
  IF p_identifier IS NULL OR btrim(p_identifier) = '' THEN
    -- No identifier means we could not establish a caller. Allow rather than
    -- refuse: failing closed here would take the endpoint down for everyone the
    -- moment a header changed shape, and this is a speed bump, not a gate.
    RETURN jsonb_build_object('allowed', true, 'count', 0, 'reason', 'no identifier');
  END IF;

  INSERT INTO public.rate_limits AS rl (bucket, identifier, count, expires_at)
  VALUES (p_bucket, p_identifier, 1, now() + make_interval(secs => p_window_seconds))
  ON CONFLICT (bucket, identifier) DO UPDATE
    SET count = CASE WHEN rl.expires_at <= now() THEN 1 ELSE rl.count + 1 END,
        expires_at = CASE WHEN rl.expires_at <= now()
                          THEN now() + make_interval(secs => p_window_seconds)
                          ELSE rl.expires_at END
  RETURNING rl.count, rl.expires_at INTO v_count, v_expires;

  -- Self-purging, cheaply. Sweeping on ~1% of calls keeps the table to the
  -- callers who are actually active without needing pg_cron, and without paying
  -- a delete on every request. The window is generous so a sweep never races a
  -- live counter.
  IF random() < 0.01 THEN
    DELETE FROM public.rate_limits WHERE expires_at < now() - interval '1 hour';
  END IF;

  RETURN jsonb_build_object(
    'allowed',     v_count <= p_limit,
    'count',       v_count,
    'limit',       p_limit,
    'retry_after', GREATEST(0, CEIL(EXTRACT(EPOCH FROM (v_expires - now()))))::integer
  );
END;
$function$;

COMMENT ON FUNCTION public.check_rate_limit(text, text, integer, integer) IS
  'Claims one request against a fixed window and returns {allowed, count, limit, retry_after}. Atomic: the upsert''s row lock is what makes two concurrent callers serialise, which a read-then-write cannot do when PostgREST gives each call its own transaction. Allows the request when no identifier is supplied — this is a speed bump, and failing closed on a missing header would take the endpoint down for everyone. Service role only.';

REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.check_rate_limit(text, text, integer, integer) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.check_rate_limit(text, text, integer, integer) TO service_role;
