-- ============================================
-- Saves her actual day-to-day Schedule tab settings (start time, stop
-- count, visit duration, "be home by" time, max hours, route direction)
-- so they're remembered every time instead of resetting to generic
-- defaults on every login — she can still change any of them for a
-- particular day, it just won't forget her usual answer afterward.
--
-- home_address_id already existed for a different feature (the "fill in
-- missing day stats" button) but had no actual control setting it
-- anywhere in the app — it's reused here as her default starting address
-- too, rather than adding a second, separate "home base" field.
-- ============================================
alter table user_settings add column stop_count integer;
alter table user_settings add column start_time text;
alter table user_settings add column return_time text;
alter table user_settings add column visit_duration integer;
alter table user_settings add column max_hours numeric;
alter table user_settings add column route_direction text;
