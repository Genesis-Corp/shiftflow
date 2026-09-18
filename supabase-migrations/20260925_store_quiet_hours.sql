-- SMS quiet hours, moved from the SMS_QUIET_HOURS env var (a Vercel setting
-- only a developer could change, requiring a redeploy) into store_settings,
-- so the store can set and adjust it themselves from Settings. Nullable —
-- both null means no quiet-hours restriction at all. SMS_QUIET_HOURS still
-- works as a fallback until the store saves a window of their own here.
--
-- Safe to run more than once.

alter table store_settings add column if not exists quiet_hours_start time;
alter table store_settings add column if not exists quiet_hours_end time;
