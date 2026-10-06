-- Stored URLs that reach an href or a src must be http(s).
--
-- Audit 2026-10-06, L13. rsvp_url and trailer_url are written by admin forms
-- and also by hosts — outside organisers — through the "Hosts can update
-- assigned events/movies/live_performances" policies, which cover every
-- column. Nothing checked the scheme. The pages put rsvp_url in an <a href>
-- and, for a trailer the parser did not recognise, put trailer_url straight
-- into an iframe src on page load. React 18 renders `javascript:` URLs (it only
-- warns), so the enforcing CSP was the only thing between a host-written value
-- and script on our origin. The pages now gate both (src/lib/safeUrl.ts,
-- src/lib/trailer.ts); this is the other half, so a bad value cannot be stored
-- in the first place. featured_slides_link_shape (20260828030114) is the
-- pattern.
--
--   rsvp_url     https only, no whitespace. The admin forms already refuse
--                anything else (rsvpUrlError in src/lib/liveEventTypes.ts) and
--                save the trimmed value, so this refuses nothing a form sends.
--   trailer_url  https only, ignoring surrounding whitespace: the forms save it
--                untrimmed, and the parser trims before use, so a pasted
--                trailing space is harmless and must not turn into a failed
--                save. Every trailer the audit could see (789 on staging) is an
--                https YouTube or Vimeo link.
--   press_articles.url
--                http or https. Written through safeHttpUrl, which keeps an
--                old outlet's http:// link; http is not the hazard, other
--                schemes are.
--
-- NOT VALID first, then VALIDATE where the existing rows allow it. Rows written
-- before today cannot be seen from here. A constraint left NOT VALID still
-- refuses new bad values, but it also refuses *any* UPDATE of a row that
-- already violates it, whatever column the update touches — so the deploy
-- steps count the violators before this is pushed (see
-- docs/briefs/BRIEF-sec-client-hygiene.md), and a constraint this leaves
-- unvalidated is a row to fix, not a state to live in.

ALTER TABLE public.movies
  ADD CONSTRAINT movies_rsvp_url_https
    CHECK (rsvp_url IS NULL OR rsvp_url ~ '^https://[^\s]+$') NOT VALID,
  ADD CONSTRAINT movies_trailer_url_https
    CHECK (trailer_url IS NULL OR btrim(trailer_url, E' \t\r\n') ~ '^https://[^\s]+$') NOT VALID;

ALTER TABLE public.events
  ADD CONSTRAINT events_rsvp_url_https
    CHECK (rsvp_url IS NULL OR rsvp_url ~ '^https://[^\s]+$') NOT VALID,
  ADD CONSTRAINT events_trailer_url_https
    CHECK (trailer_url IS NULL OR btrim(trailer_url, E' \t\r\n') ~ '^https://[^\s]+$') NOT VALID;

ALTER TABLE public.live_performances
  ADD CONSTRAINT live_performances_rsvp_url_https
    CHECK (rsvp_url IS NULL OR rsvp_url ~ '^https://[^\s]+$') NOT VALID,
  ADD CONSTRAINT live_performances_trailer_url_https
    CHECK (trailer_url IS NULL OR btrim(trailer_url, E' \t\r\n') ~ '^https://[^\s]+$') NOT VALID;

ALTER TABLE public.festival_years
  ADD CONSTRAINT festival_years_trailer_url_https
    CHECK (trailer_url IS NULL OR btrim(trailer_url, E' \t\r\n') ~ '^https://[^\s]+$') NOT VALID;

ALTER TABLE public.press_articles
  ADD CONSTRAINT press_articles_url_http
    CHECK (url ~ '^https?://[^\s]+$') NOT VALID;

-- Validate each one the existing rows satisfy. One that fails stays NOT VALID
-- and says so; the push does not fail, because a failed push here would also
-- hold back whatever else ships with it.
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN
    SELECT * FROM (VALUES
      ('movies',            'movies_rsvp_url_https'),
      ('movies',            'movies_trailer_url_https'),
      ('events',            'events_rsvp_url_https'),
      ('events',            'events_trailer_url_https'),
      ('live_performances', 'live_performances_rsvp_url_https'),
      ('live_performances', 'live_performances_trailer_url_https'),
      ('festival_years',    'festival_years_trailer_url_https'),
      ('press_articles',    'press_articles_url_http')
    ) AS v(tbl, con)
  LOOP
    BEGIN
      EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', c.tbl, c.con);
    EXCEPTION WHEN check_violation THEN
      RAISE WARNING '% left NOT VALID: existing rows in public.% violate it. Fix them, then VALIDATE CONSTRAINT.', c.con, c.tbl;
    END;
  END LOOP;
END
$$;
