-- "Visit Scheduled" as a contact RESULT — logging it books the visit exactly
-- like the dedicated Schedule visit button (calendar reminders included).
-- Run in the Supabase SQL editor (after 0006_admin_label.sql).

alter type contact_status add value if not exists 'Visit Scheduled';
notify pgrst, 'reload schema';
