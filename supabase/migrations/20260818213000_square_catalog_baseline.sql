-- A rolling record of what the Square catalog looked like, so losses are visible.
--
-- The problem this exists for: Square's UpsertCatalogObject REPLACES the object
-- it is given, and a dashboard Library CSV has no columns for per-showtime
-- variations or the undocumented item_data.event block. So a CSV export/edit/
-- import round-trip silently strips both. On 2026-08-17, 770 of 838 EVENT items
-- lost their event block that way (docs/venue-date-square-mechanism.md §9).
--
-- Nothing in this repo performs that import — it is a human dashboard workflow,
-- so it cannot be prevented in code. What CAN be fixed is that the damage was
-- INVISIBLE: the Aug 14 overwrite was found only by noticing a timestamp
-- pattern, and the Aug 17 bleed only because someone happened to run a probe.
--
-- This table is the "before" that makes an automated comparison possible. A
-- snapshot is cheap (one catalog walk), and with it a loss becomes a report
-- instead of an archaeology exercise.
--
-- It is NOT the repair source. Square retains historical catalog versions and
-- serves them through `catalog_version=<epoch ms>` on an ordinary read
-- (docs/square-catalog-history-recovery.md), so a repair pulls the authentic
-- prior object from Square rather than reconstructing one from these columns.
-- Reconstructing an item from our own columns is precisely what destroyed 906
-- items on 2026-08-14, and this table must never become a tempting way to do it
-- again. It records shape, not truth.

CREATE TABLE IF NOT EXISTS public.square_catalog_baseline (
  square_item_id text PRIMARY KEY,

  name text,
  product_type text,
  category_id text,
  is_archived boolean NOT NULL DEFAULT false,

  -- The two things a CSV round-trip destroys.
  has_event_block boolean NOT NULL DEFAULT false,
  event_start_at timestamptz,

  -- [{ id, name, price_cents }] — enough to name exactly which variations went
  -- missing and to find them in version history. Not enough to rebuild an item,
  -- deliberately.
  variations jsonb NOT NULL DEFAULT '[]'::jsonb,
  variation_count integer NOT NULL DEFAULT 0,

  -- Square's own optimistic-concurrency version at capture time. Combined with
  -- captured_at this gives a repair a known-good instant to read back from.
  item_version bigint,
  item_updated_at timestamptz,

  captured_at timestamptz NOT NULL DEFAULT now(),

  -- Set when a check has confirmed this item still matches its baseline, so a
  -- sweep can report "last known good" rather than only "changed since capture".
  last_ok_at timestamptz
);

COMMENT ON TABLE public.square_catalog_baseline IS
  'Shape of each Square catalog item at last snapshot, so square-catalog-guard '
  'can detect variations and event blocks disappearing. Not a restore source — '
  'repairs read the authentic prior object from Square version history.';

CREATE INDEX IF NOT EXISTS square_catalog_baseline_event_idx
  ON public.square_catalog_baseline (has_event_block)
  WHERE has_event_block;
CREATE INDEX IF NOT EXISTS square_catalog_baseline_captured_idx
  ON public.square_catalog_baseline (captured_at);

-- What each check run found. One row per run, so a bleed shows up as a trend
-- rather than a single alarming number with nothing to compare it to.
CREATE TABLE IF NOT EXISTS public.square_catalog_guard_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ran_at timestamptz NOT NULL DEFAULT now(),
  items_seen integer NOT NULL DEFAULT 0,
  items_baselined integer NOT NULL DEFAULT 0,
  lost_event_block integer NOT NULL DEFAULT 0,
  lost_variations integer NOT NULL DEFAULT 0,
  lost_category integer NOT NULL DEFAULT 0,
  vanished integer NOT NULL DEFAULT 0,
  findings jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text
);

CREATE INDEX IF NOT EXISTS square_catalog_guard_runs_ran_at_idx
  ON public.square_catalog_guard_runs (ran_at DESC);

-- RLS. Operational data about the catalog, not customer data: no anon, admins
-- read, service role writes. Policy AND grant — a policy without a grant is dead
-- (see 20260814214233_rls_permissions_hardening).

ALTER TABLE public.square_catalog_baseline   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.square_catalog_guard_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Admins read catalog baseline" ON public.square_catalog_baseline;
CREATE POLICY "Admins read catalog baseline"
  ON public.square_catalog_baseline FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

DROP POLICY IF EXISTS "Admins read guard runs" ON public.square_catalog_guard_runs;
CREATE POLICY "Admins read guard runs"
  ON public.square_catalog_guard_runs FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

REVOKE ALL ON public.square_catalog_baseline   FROM anon, authenticated;
REVOKE ALL ON public.square_catalog_guard_runs FROM anon, authenticated;
GRANT SELECT ON public.square_catalog_baseline   TO authenticated;
GRANT SELECT ON public.square_catalog_guard_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.square_catalog_baseline   TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.square_catalog_guard_runs TO service_role;
