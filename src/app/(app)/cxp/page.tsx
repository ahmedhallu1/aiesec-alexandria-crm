import { redirect } from "next/navigation";
import { cxpAccess, listEps } from "@/server/cxp";
import { CxpEpsView } from "@/components/crm/cxp-eps-view";
import type { CxpSide } from "@/lib/cxp/types";

export const metadata = { title: "CXP" };

/** THE CXP MODULE — the LC's ECB submission tracking, migrated out of the
 *  standalone Internal Auditing System (v35).
 *
 *  Per EP, per stage: the documents the ECB requires and whether we have them
 *  before the weekly deadline. Defaults to THIS MONTH; last month's incomplete
 *  rows live behind the toggle in the view. */
export default async function CxpPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const access = await cxpAccess();
  if (!access.allowed) redirect("/");
  const sp = await searchParams;

  // the URL may only name a side this viewer actually reads
  const requested = sp.side as CxpSide | undefined;
  const side =
    requested && access.sides.includes(requested) ? requested : access.defaultSide;
  const scope = sp.scope === "previous" ? "previous" : "current";
  const search = sp.q ?? "";

  const { rows, month, previousIncompleteCount } = await listEps({
    side,
    scope,
    search,
  });

  return (
    <div className="grid gap-5">
      <div>
        <h1 className="text-2xl font-bold">CXP — ECB submissions</h1>
        <p className="text-sm text-muted-foreground">
          Every EP&apos;s required documents, by stage, against the ECB&apos;s weekly deadlines.
        </p>
      </div>
      <CxpEpsView
        rows={rows}
        sides={access.sides}
        side={side}
        scope={scope}
        month={month}
        previousIncompleteCount={previousIncompleteCount}
        search={search}
      />
    </div>
  );
}
