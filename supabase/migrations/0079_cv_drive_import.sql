-- 0079 — IMPORTING ANOTHER LC'S CV POOL FROM GOOGLE DRIVE (v36.4)
--
-- Partner LCs keep their CV pools as Drive folders, each laid out its own way
-- (by programme, by sector, one folder per person with a CV + a video + a
-- certificate, or everything loose). The importer walks the folder, lets the
-- AI decide which files are CVs and whose, and copies each CV into the pool.
--
--   drive_file_id  the Drive file a CV came from — importing the same folder
--                  again skips what is already here without downloading it
--   source_path    where it sat in that folder ("oGTa / IT / Nour.pdf"), so a
--                  reader can see where it came from
--   product        GTa or GTe when the folder said so — the CV pool is IGT's,
--                  and a Global Teacher CV is not a Global Talent one

alter table cvs add column if not exists drive_file_id text;
alter table cvs add column if not exists source_path text;
alter table cvs add column if not exists product text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cvs_product_check') then
    alter table cvs add constraint cvs_product_check check (product is null or product in ('GTa', 'GTe'));
  end if;
end $$;

create unique index if not exists cvs_drive_file_id_key on cvs (drive_file_id) where drive_file_id is not null;
