-- ============================================
-- Adds somewhere to save a day's overall totals (start time, drive miles,
-- drive hours, estimated arrival back home) alongside its list of stops.
-- These were only ever computed for the on-screen preview while building a
-- route and were thrown away the moment a day got approved — this is why
-- the calendar's day-detail popup never had them to show. No RLS changes
-- needed: this column is covered by the same policies already protecting
-- the rest of each schedule_days row.
-- ============================================
alter table schedule_days add column summary jsonb;
