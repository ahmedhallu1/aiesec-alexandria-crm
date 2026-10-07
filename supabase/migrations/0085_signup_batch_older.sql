-- v37.9 — OGV's third tracker generation.
-- "Alexandria - OGV 26.2 New Signups" (source ogv_262) is the NEW batch; the
-- 26.1 [New] "Main" tab (ogv_main) becomes OLD and the 26.1 [Old] "Old" tab
-- (ogv_old) becomes OLDER. Sources (row identity) are unchanged — only the
-- batch label moves. OGT keeps its two batches.

alter table signups drop constraint if exists signups_batch_check;
alter table signups
  add constraint signups_batch_check check (batch in ('new', 'old', 'older'));

-- order matters: retag the oldest first so no row is briefly ambiguous
update signups set batch = 'older' where source = 'ogv_old' and batch <> 'older';
update signups set batch = 'old'   where source = 'ogv_main' and batch <> 'old';

-- One-time, applied AFTER the first ogv_262 import (2026-10-07): the 1,519
-- rows the 26.2 sheet arrived with are all Techne Summit sign-ups, but its
-- Campaign Name column was empty — so they were tagged here, not on the sheet
-- (the importer's keepCampaignWhenBlank keeps the tag). Later uploads carry
-- their own campaign. Run as:
--   update signups set campaign = 'Techne Summit'
--   where source = 'ogv_262' and campaign is null and ep_id in (<the 1,519>);
