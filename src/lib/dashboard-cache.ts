import type { AccountScope } from "./rbac";

/** THE DASHBOARD CACHE KEY (v33.6).
 *
 *  The dashboard reads ~4,000 account rows on every render, and forty members
 *  refreshing all day is what put the project at 93% of its CPU allowance. The
 *  read is cacheable — but this data is RBAC-SCOPED, so the key is the whole
 *  safety argument: two viewers may share a cache entry only if they would
 *  have read exactly the same rows.
 *
 *  So the key carries the SCOPE ITSELF, not the viewer. An IGV VP and an IGT
 *  VP hash differently because their function lists differ; two members hash
 *  differently because their id lists do; a test view hashes differently
 *  because it sees test accounts. Ids are SORTED so the same scope always
 *  produces the same key regardless of query order.
 *
 *  ⚠️ WHY THERE ARE NO FILTERS IN HERE ANY MORE (v33.49). There used to be
 *  two — `from` and `to` — and that was the shape of a trap: the KEY carried
 *  the date range while the READ also carried the dashboard's TEAM filter,
 *  which never appeared in the key at all. So a VP who picked a team cached
 *  that team's rows under the whole function's key, and for the next half
 *  hour every viewer of that function — including the VP who had just cleared
 *  the filter — was served one team's numbers as the function's. It went
 *  unnoticed for as long as it did because until v33.46 `refresh()` was
 *  quietly dropping the entry on nearly every write; the moment the cache
 *  actually started holding, the collision became the whole LC's dashboard.
 *
 *  The fix is structural rather than "add teamId to the key": the cached read
 *  is now FILTER-FREE (the scope's whole account set) and every filter — date
 *  range, team, member — is applied in JS afterwards. A filter can therefore
 *  no longer disagree with the key, because there is nothing left to disagree
 *  with. Anything that ever narrows the DB read again MUST come back into
 *  this key.
 *
 *  Exported for the tests — this is the function that must never collide. */
export function dashboardCacheKey(scope: AccountScope, testMode: boolean): string {
  const scopeKey =
    scope.kind === "all"
      ? "all"
      : scope.kind === "functions"
        ? `fns:${[...scope.fns].sort().join("|")}`
        : `ids:${[...scope.ids].sort().join("|")}`;
  return [scopeKey, testMode ? "test" : "live"].join("::");
}
