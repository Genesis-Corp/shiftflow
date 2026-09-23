-- The store's own name, editable in Settings, so every staff-facing text is
-- identifiable without a redeploy — see @/lib/sms/config's getBusinessName().
-- Falls back to SMS_BUSINESS_NAME (env) until this is saved, same pattern as
-- quiet_hours_start/end already on this table.
--
-- Safe to run more than once.

alter table store_settings add column if not exists business_name text;
