-- 0082 (v36.9) — BD and B2B get a real goal-vs-achieved too.
--
-- The winter-term planning sheet was re-pointed to a new spreadsheet
-- ("Alexandria | Planning Tool 26.2" — the old one had gone permanently
-- unreachable). Its BD and B2B goal-setting tabs don't share the 6-lane
-- Opens/Applicants/.../Complete funnel shape — they set ONE term-wide target
-- (BD: a revenue figure + a contract-signed count; B2B: a slots split across
-- IGV/IGTa/IGTe), not a month-by-month plan. plan_cells already models
-- "one number, keyed by fn/scope/period_start/metric" — it just needs room
-- for these two functions, a 'term' scope (period_start = the term's own
-- February 1st, not a specific month), and BD/B2B's own metric names.
--
-- Nothing here changes what the 6 existing lanes (IGV/IGTa/IGTe/OGV/OGTa/
-- OGTe) store or mean.
alter table plan_cells drop constraint plan_cells_fn_check;
alter table plan_cells add constraint plan_cells_fn_check
  check (fn in ('IGV','IGTa','IGTe','OGV','OGTa','OGTe','BD','B2B'));

alter table plan_cells drop constraint plan_cells_scope_check;
alter table plan_cells add constraint plan_cells_scope_check
  check (scope in ('month','sprint','term'));

alter table plan_cells drop constraint plan_cells_metric_check;
alter table plan_cells add constraint plan_cells_metric_check
  check (metric in (
    'opens','signups','applicants','accepted','approvals','realised',
    'finished','complete',
    'revenue','contracts','slots_igv','slots_igta','slots_igte'
  ));
