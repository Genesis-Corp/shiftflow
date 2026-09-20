-- One-time data fix: staff.role_type ("Department Only" / "Potential All
-- Rounder" / "All Rounder") used to be a field set by hand on the Add/Edit
-- Staff form. It's now computed automatically from each person's department
-- training levels — PUT /api/staff/[id]/departments recomputes it every
-- time departments are saved — so this only needs to run once to fix
-- everyone already sitting on a stale, manually-chosen value.
--
-- Same rule as src/lib/roleType.ts: "trained" and "advanced" both count as
-- trained; 3+ trained departments -> all_rounder; 1 or 2 trained alongside
-- at least one supervised department -> potential_all_rounder; anything
-- else (including no departments at all) -> department_only.
--
-- Safe to run more than once.

with counts as (
  select
    staff_id,
    count(*) filter (where training_level in ('trained', 'advanced')) as trained_count,
    count(*) filter (where training_level = 'supervised') as supervised_count
  from staff_departments
  group by staff_id
),
computed as (
  select
    staff_id,
    case
      when trained_count >= 3 then 'all_rounder'
      when trained_count in (1, 2) and supervised_count > 0 then 'potential_all_rounder'
      else 'department_only'
    end as new_role_type
  from counts
)
update staff
set role_type = computed.new_role_type
from computed
where staff.id = computed.staff_id
  and staff.role_type is distinct from computed.new_role_type;

-- Staff with no department rows at all (not covered by the join above,
-- since they have no staff_departments rows to aggregate) are
-- department_only by definition.
update staff
set role_type = 'department_only'
where role_type <> 'department_only'
  and id not in (select staff_id from staff_departments);
