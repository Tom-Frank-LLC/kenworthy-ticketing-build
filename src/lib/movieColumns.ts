/**
 * The columns of `movies` the public may read.
 *
 * Anon has a column-level grant on this table, not a table-level one
 * (20260701020754), because it also carries distributor terms that are not
 * the public's business. `select('*')` therefore fails outright for a patron,
 * and every public read has to name its columns — and name the same ones, or
 * the feed and the showing page disagree about what a film is.
 *
 * Three pages carried this list by hand and it was one place short the first
 * time a public column was added. When a migration grants a new column to
 * anon, it goes here and nowhere else.
 */
export const MOVIE_PUBLIC_COLUMNS =
  'id,title,description,poster_url,duration_minutes,rating,genre,is_active,created_at,updated_at,trailer_url,is_featured,release_year,release_label,pass_processing_fee,ticket_type,rsvp_url';
