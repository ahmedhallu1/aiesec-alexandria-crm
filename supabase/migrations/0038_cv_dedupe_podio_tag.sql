-- 0038 — CV de-duplication + the "has Podio" membership tag (v33.2)

-- 1. CV DE-DUPLICATION.
-- The pool is shared and several people upload from the same IR call, so the
-- same CV arrived more than once with nobody noticing. The hash is of the FILE
-- BYTES, computed in the browser before the upload is even requested, so an
-- exact duplicate costs no storage and no Gemini call.
alter table cvs add column if not exists file_hash text;
create index if not exists cvs_file_hash_idx on cvs (file_hash);

-- 2. "HAS PODIO" — a per-member capability, not a rank.
-- Podio request states were editable by MMs and above only. In practice some
-- members hold the LC's Podio access and do the submissions themselves, so the
-- authority has to follow the person, not the role.
alter table members add column if not exists has_podio boolean not null default false;
