-- One-time data fix: staff.age_group (the Junior/Senior split claim races
-- match against) is only ever written at import time or by hand editing the
-- Staff page — it never updates itself as someone has a birthday. A 17-year-
-- old imported as "junior" quietly stays "junior" forever unless a manager
-- happens to re-save their record after they turn 18.
--
-- The app itself now recomputes this live from birthday wherever one's on
-- file (eligibility.ts, the Staff page), so this only needs to run once to
-- fix everyone already sitting on a stale value — going forward the app
-- keeps it correct without further migrations.
--
-- Safe to run more than once.

update staff
set age_group = case
  when extract(year from age(current_date, birthday)) >= 18 then 'senior'
  else 'junior'
end
where birthday is not null
  and age_group is distinct from (
    case when extract(year from age(current_date, birthday)) >= 18 then 'senior' else 'junior' end
  );
