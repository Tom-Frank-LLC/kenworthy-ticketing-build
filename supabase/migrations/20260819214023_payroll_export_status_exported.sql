-- payroll_exports needs a status for "a CSV was produced for manual import".
--
-- Until QuickBooks is wired up for real, payroll leaves this system as a CSV
-- that someone imports by hand. That is a genuine, completed export and it
-- belongs in the ledger, but none of the existing statuses says so:
--
--   'pending' reads as unfinished, which it is not.
--   'success' is the value the old qbo-sync payroll_export path wrote after
--             claiming a push it never made, so it cannot be trusted to mean
--             "reached QuickBooks" and should not be overloaded further.
--
-- 'exported' means: we produced the file, a human still has to import it.
-- Recording it matters mainly so a second import of the same period is
-- visible before someone does it — QuickBooks will not stop them.

ALTER TABLE public.payroll_exports
  DROP CONSTRAINT IF EXISTS payroll_exports_status_check;

ALTER TABLE public.payroll_exports
  ADD CONSTRAINT payroll_exports_status_check
  CHECK (status IN ('pending', 'success', 'failed', 'partial', 'exported'));
