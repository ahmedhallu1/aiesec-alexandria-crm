-- 0077 — visit_followups_due(): the SQL gate in front of the visit-followups cron
--
-- Applied to production on 2026-09-10 (v36.3) but the file never reached the
-- repo; recreated verbatim from the live definition on 2026-10-03 (v37.7) so a
-- rebuild or restore does not leave the pg_cron job calling a missing function.
--
-- pg_cron asks this every 15 minutes and only calls
-- /api/cron/visit-followups?passes=reminders when something is actually due.
-- It MIRRORS src/server/cron/visit-followups.ts + src/lib/next-step-reminder.ts:
-- change one, change the other.

create or replace function public.visit_followups_due()
 returns boolean
 language sql
 stable security definer
 set search_path to 'public'
as $function$
  select
    extract(hour from (now() at time zone 'Africa/Cairo')) >= 7
    and (
      exists (
        select 1 from visits v join accounts a on a.id = v.account_id
        where v.done is null and v.followup_prompt_sent_at is null and v.member_id is not null
          and not a.out_of_process and not a.is_test
          and ((v.visit_date + v.visit_time) at time zone 'Africa/Cairo') + interval '2 hours' <= now()
      )
      or exists (
        select 1 from visits v join accounts a on a.id = v.account_id
        where v.done is null and v.forgotten_nag_sent_at is null and v.member_id is not null
          and v.followup_prompt_sent_at <= now() - interval '7 days'
          and not a.out_of_process and not a.is_test
      )
      or exists (
        select 1 from signup_cic_calls c
        where c.side = 'B2C' and c.outcome = 'call_back' and c.caller_id is not null
          and c.call_back_reminded_at is null and c.call_back_at <= now()
      )
      or exists (
        select 1 from accounts a join members m on m.id = a.responsible_id and m.is_active
        where a.next_step_date = (now() at time zone 'Africa/Cairo')::date
          and not a.out_of_process and not a.is_test
          and coalesce(a.next_step_reminded_key, '')
              <> a.next_step_date::text || ' ' || coalesce(to_char(a.next_step_time, 'HH24:MI'), '--:--')
          and now() >= case
                when a.next_step_time is null then (a.next_step_date + time '09:00') at time zone 'Africa/Cairo'
                else ((a.next_step_date + a.next_step_time) at time zone 'Africa/Cairo') - interval '1 hour'
              end
      )
    );
$function$;

revoke all on function public.visit_followups_due() from public, anon, authenticated;
grant execute on function public.visit_followups_due() to service_role;
