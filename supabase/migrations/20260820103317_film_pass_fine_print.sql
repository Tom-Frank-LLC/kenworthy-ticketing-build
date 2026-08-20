-- What a pass is good for, said by the pass rather than by the page.
--
-- The purchase page carried one sentence for every pass: "Valid on standard
-- movies. Not on special events or premium screenings." That was true while the
-- only product was the standard pass. A festival pass is the exact opposite — a
-- special event is the only place it works — so the page was contradicting, in
-- its own fine print, the thing it was selling directly above.
--
-- The sentence therefore belongs to the pass. Staff edit it where they edit the
-- price, because the two change for the same reason: someone decided what this
-- pass is.
--
-- The other line on that block — passes are used in person, they cannot book
-- online — stays in the page. It is a property of how passes work at this
-- theatre, not of any one pass, and duplicating it onto every row would invite
-- the rows to disagree about it.

ALTER TABLE public.film_pass_types
  ADD COLUMN IF NOT EXISTS fine_print text;

COMMENT ON COLUMN public.film_pass_types.fine_print IS
  'One line on the purchase page saying where this pass is and is not valid, shown under the order summary for whichever pass is selected. Edited by staff alongside the price. NULL simply prints nothing, so a pass with no note still sells; it does not fall back to another pass''s wording, because a wrong claim about validity is worse than no claim.';

-- Carry today's behaviour across rather than changing it silently.
--
-- Every pass that is not a festival pass was showing the standard sentence a
-- moment ago and still shows it now. Festival passes get a sentence that is
-- actually true of them — they are scoped to the screenings tagged under
-- pass_type_showings and are deliberately not default_for_movies — and staff
-- can rewrite it.
UPDATE public.film_pass_types
SET fine_print = 'Valid on standard movies. Not on special events or premium screenings.'
WHERE fine_print IS NULL
  AND festival_slug IS NULL;

UPDATE public.film_pass_types
SET fine_print = 'Valid only at this festival''s screenings, listed on the festival page. Not valid on standard movies.'
WHERE fine_print IS NULL
  AND festival_slug IS NOT NULL;
