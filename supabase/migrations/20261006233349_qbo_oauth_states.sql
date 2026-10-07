-- Single-use nonces for qbo-sync's OAuth state (security audit 2026-10-06, L4).
--
-- oauth_start records one row per authorize URL it hands out; oauth_callback
-- deletes the row it is about to act on (DELETE ... RETURNING, so of two
-- racing callbacks only one gets it back). Before this, the nonce in the
-- signed state was never checked against anything, so a captured callback URL
-- replayed for the state's whole ten-minute life.
--
-- Service role only. No browser path reads or writes it: the only writer is
-- qbo-sync, which holds the service key, and the rows mean nothing to anyone
-- else. RLS is on with no policies, and anon/authenticated hold no grants, so
-- PostgREST refuses both rather than returning an empty success.

CREATE TABLE IF NOT EXISTS public.qbo_oauth_states (
  nonce       uuid PRIMARY KEY,
  user_id     uuid NOT NULL,
  environment text NOT NULL,
  expires_at  timestamptz NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS qbo_oauth_states_expires_at_idx
  ON public.qbo_oauth_states (expires_at);

ALTER TABLE public.qbo_oauth_states ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.qbo_oauth_states FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, DELETE ON public.qbo_oauth_states TO service_role;

COMMENT ON TABLE public.qbo_oauth_states IS
  'qbo-sync OAuth nonces: inserted by oauth_start, consumed (deleted) by oauth_callback. Service role only.';
