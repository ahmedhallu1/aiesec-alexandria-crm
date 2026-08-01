-- Elevate v28 review fix (applied to prod 2026-08-08): atomic per-IP booking
-- rate counter — the old read-then-upsert let a parallel burst bypass 3/hour.
create or replace function bump_rate_bucket(k text)
returns int language plpgsql security definer as $$
declare v int;
begin
  insert into app_settings (key, value, updated_at)
    values (k, jsonb_build_object('n', 1), now())
  on conflict (key) do update
    set value = jsonb_build_object('n', coalesce((app_settings.value->>'n')::int, 0) + 1),
        updated_at = now()
  returning (value->>'n')::int into v;
  return v;
end $$;
notify pgrst, 'reload schema';
