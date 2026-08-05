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
 *  Exported for the tests — this is the function that must never collide. */
export function dashboardCacheKey(
  scope: AccountScope,
  testMode: boolean,
  filters: { from?: string; to?: string }
): string {
  const scopeKey =
    scope.kind === "all"
      ? "all"
      : scope.kind === "functions"
        ? `fns:${[...scope.fns].sort().join("|")}`
        : `ids:${[...scope.ids].sort().join("|")}`;
  return [
    scopeKey,
    testMode ? "test" : "live",
    filters.from ?? "",
    filters.to ?? "",
  ].join("::");
}

