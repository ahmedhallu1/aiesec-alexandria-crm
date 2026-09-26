// =============================================================================
// URL PARAMS → LIST FILTERS, in one place (v37.2).
//
// The accounts and sign-ups pages read their filters from the URL, and the
// Export button sends that same URL to /api/export — so the file holds exactly
// the rows on screen, never a differently-filtered set. Both callers use these
// functions; there is no second copy to drift. Pure: RBAC is applied later,
// by the scoped reader each list already uses.
// =============================================================================

import type { AccountFilters, SignupFilters } from "@/server/data";
import type { Stage } from "@/lib/types";

type Params = Record<string, string | undefined>;

/** Keeps only the valid picks of a comma-joined filter value, so one bad
 *  entry in a hand-edited URL drops itself rather than the whole filter. */
export function keepCsv(
  raw: string | undefined,
  allowed?: string[],
  extra?: (v: string) => boolean
): string | undefined {
  const kept = (raw ?? "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean)
    .filter((v) => (allowed ? allowed.includes(v) : true))
    .filter((v) => (extra ? extra(v) : true));
  return kept.length > 0 ? kept.join(",") : undefined;
}

export function accountFiltersFromParams(
  params: Params,
  opts: { archiveAllowed: boolean }
): AccountFilters {
  return {
    q: params.q || undefined,
    fn:
      params.fn === "IGV" || params.fn === "IGT" || params.fn === "B2B" ||
      params.fn === "BD" || params.fn === "B2C"
        ? params.fn
        : undefined,
    product: (!params.fn || params.fn === "IGT"
      ? keepCsv(params.product, ["GTa", "GTe"])
      : undefined) as AccountFilters["product"],
    lane: keepCsv(params.lane, ["IGV", "IGT", "GTa", "GTe", "B2B", "BD", "B2C"]),
    project: params.project || undefined,
    stage: keepCsv(params.stage, undefined, (v) => v !== "Out of Process") as Stage | undefined,
    lastStatus: params.lastStatus || undefined,
    flag:
      params.flag === "needs_podio" || params.flag === "next_step_missing"
        ? params.flag
        : undefined,
    from: params.from || undefined,
    to: params.to || undefined,
    subProduct: params.sub && (!params.fn || params.fn === "IGT") ? params.sub : undefined,
    industry: params.industry || undefined,
    accountType: params.type || undefined,
    proposal: keepCsv(params.proposal, ["sent", "not_sent"]),
    deals: keepCsv(params.deals, ["has", "none"]),
    podio: keepCsv(params.podio, [
      "requested", "not_requested", "Checking", "Approved", "Rejected",
    ]),
    sort: params.sort || undefined,
    dir: params.dir === "asc" ? "asc" : params.dir === "desc" ? "desc" : undefined,
    responsibleId: params.resp || undefined,
    teamId: params.team || undefined,
    archived: params.archived === "1" && opts.archiveAllowed,
  };
}

/** The sign-ups list's filters. `fn` is resolved by the caller (it depends on
 *  which OGX sides the viewer holds, and on B2C's both-sides default). */
export function signupFiltersFromParams(sp: Params, fn: string | undefined): SignupFilters {
  return {
    view: sp.view,
    fn,
    batch: sp.batch,
    program: sp.program,
    status: sp.status,
    potential: sp.potential,
    interested: sp.interested,
    contacted: sp.contacted,
    country: sp.country,
    personStatus: sp.personStatus,
    assigned: sp.assigned,
    campaign: sp.campaign,
    cicMine: sp.cicMine === "1",
    firstCaller: sp.firstCaller,
    // validated in listSignupsPage, which also understands a comma list
    phone: sp.phone,
    q: sp.q,
    sort: sp.sort,
    dir: sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined,
  };
}
