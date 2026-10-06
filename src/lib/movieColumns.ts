/**
 * The columns of `movies` the public may read.
 *
 * Anon has a column-level grant on this table, not a table-level one, because
 * it also carries distributor terms (distributor, circuit, terms_percent) that
 * are not the public's business. `select('*')` therefore fails outright for a
 * patron, and every public read has to name its columns — and name the same
 * ones, or the feed and the showing page disagree about what a film is.
 *
 * That grant was set in 20260701020754, silently widened to the whole table by
 * a blanket grant in 20260810165116, and restored in 20261006225932. The list
 * there and this list must match; supabase/tests/anon_surface/ checks both
 * that anon can select exactly these and that it cannot select the terms.
 *
 * Three pages carried this list by hand and it was one place short the first
 * time a public column was added. When a migration grants a new column to
 * anon, it goes here and nowhere else.
 */
export const MOVIE_PUBLIC_COLUMNS =
  'id,title,description,poster_url,duration_minutes,rating,genre,is_active,created_at,updated_at,trailer_url,is_featured,release_year,release_label,pass_processing_fee,ticket_type,rsvp_url,show_runtime';
