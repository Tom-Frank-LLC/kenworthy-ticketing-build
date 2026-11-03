-- Square service charges (the ~3% surcharge on rental invoices) get their own
-- line in the Square-sourced QBO journal. Seeded to "Fees charged to renters"
-- because every service charge measured (Oct 2026) was on a rental invoice;
-- change it in Accounting → Mappings if the accountant books it elsewhere.
INSERT INTO public.account_mappings (source_type, source_key, account_id, is_default, notes)
SELECT 'service_charge', '_all', id, true, 'Square service charges; seeded with the Square-sourced QBO export'
FROM public.chart_of_accounts WHERE code = '4312'
ON CONFLICT (source_type, source_key) DO NOTHING;
