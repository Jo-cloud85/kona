-- Profiles gain up to 3 goals instead of one — wrap any existing single goal
-- object into a one-element array, then rename the column.
update public.profiles
  set goal = jsonb_build_array(goal)
  where goal is not null and jsonb_typeof(goal) = 'object';

alter table public.profiles rename column goal to goals;
