-- Remember whether the buyer agreed to be texted, so a resend can honour it.
--
-- Consent has been a request-scoped field since the A2P work: the checkout form
-- sends `sms_consent`, ticket-checkout passes it to deliverConfirmation, and an
-- explicit `false` blocks the SMS outright -- including a number the function
-- would otherwise recover from auth or `profiles`, which is the case that
-- matters. A returning buyer whose number we already hold has not consented by
-- having bought before.
--
-- What that never covered is a *resend*. `send-ticket-confirmation` is the
-- operator's re-dispatch endpoint and carries no consent field, so it landed in
-- the "no signal" branch and fell back to whatever number was on file. The
-- buyer's actual answer existed only for the length of the original request.
--
-- Three-valued on purpose, and nullable for exactly that reason:
--
--   true   asked and agreed
--   false  asked and declined -- never text this order
--   NULL   never asked: every order placed before this column existed, and any
--          path that does not collect consent. Preserves today's behaviour
--          rather than silently reclassifying old orders as refusals.
--
-- NULL is deliberately not "no". Backfilling it to false would be defensible
-- for compliance and wrong as a record: it would assert that thousands of
-- buyers were asked and declined, when they were never asked at all. The
-- distinction is what an audit would want.

ALTER TABLE public.tickets
  ADD COLUMN IF NOT EXISTS sms_consent boolean;

COMMENT ON COLUMN public.tickets.sms_consent IS
  'Whether the buyer affirmatively agreed to receive this order by SMS, from the unchecked opt-in checkbox at checkout. true = agreed, false = asked and declined (never text this order), NULL = never asked (orders predating the column, and any path with no opt-in of its own, e.g. the box office). NULL is not a refusal -- it means no answer was captured. A2P 10DLC treats consent as affirmative and per-number, so the absence of a "no" is not a "yes", and neither is a number sitting in profiles.';
