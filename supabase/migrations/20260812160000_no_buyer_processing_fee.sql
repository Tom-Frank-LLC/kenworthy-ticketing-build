-- Standard ticket buyers do not pay the card processing fee.
--
-- Policy, decided by the theatre: a patron buying a ticket pays the ticket
-- price and Idaho sales tax, and nothing else. Square's cut is a cost of doing
-- business that the Kenworthy absorbs.
--
-- The `pass_processing_fee` toggle stays in the schema, because theatre
-- rentals are settled case by case and a promoter may agree to have the fee
-- carried by their buyers rather than come out of their share. But it is an
-- exception someone has to opt into deliberately, per production — so every
-- existing production is reset to off here, rather than leaving surcharges
-- switched on from before the policy was set.
--
-- The column DEFAULT is already false, so productions created from now on
-- start with no surcharge.

UPDATE public.movies            SET pass_processing_fee = false WHERE pass_processing_fee;
UPDATE public.events            SET pass_processing_fee = false WHERE pass_processing_fee;
UPDATE public.live_performances SET pass_processing_fee = false WHERE pass_processing_fee;

COMMENT ON COLUMN public.movies.pass_processing_fee IS
  'Rental exception only. When true, Square''s card processing fee is grossed up onto the buyer''s total instead of being absorbed by the theatre. Standard Kenworthy programming leaves this false: the patron pays ticket price + tax.';

COMMENT ON COLUMN public.events.pass_processing_fee IS
  'Rental exception only — see public.movies.pass_processing_fee.';

COMMENT ON COLUMN public.live_performances.pass_processing_fee IS
  'Rental exception only — see public.movies.pass_processing_fee.';
