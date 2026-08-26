import { notFound, redirect } from "next/navigation";
import { cxpAccess, getEp } from "@/server/cxp";
import { CxpEpView, type EpDocRow } from "@/components/crm/cxp-ep-view";
import { computeDeadline, deadlineInputsOf } from "@/lib/cxp/deadlines";
import { requirementsForStage } from "@/lib/cxp/requirements";
import { STAGE_BY_KEY, sideOf } from "@/lib/cxp/types";
import { canEditCxpFunction } from "@/lib/cxp/rbac";
import { getViewer } from "@/server/data";

/** ONE EP's SUBMISSION FILE — the checklist across every stage, each document
 *  with its own computed ECB deadline. */
export default async function CxpEpPage({
  params,
}: {
  params: Promise<{ epOppId: string }>;
}) {
  const access = await cxpAccess();
  if (!access.allowed) redirect("/");

  const { epOppId } = await params;
  const found = await getEp(decodeURIComponent(epOppId));
  // getEp already narrows to the viewer's functions, so "not found" and
  // "not yours" are deliberately the same answer
  if (!found) notFound();

  const { records, statusMap } = found;
  const rep = records[0];
  const viewer = await getViewer();
  const canEdit = canEditCxpFunction(viewer, rep.function);

  const docs: EpDocRow[] = [];
  for (const r of records) {
    for (const req of requirementsForStage(r.function, r.stage_key)) {
      const status = statusMap[`${r.ep_opp_id}|${r.stage_key}|${req.key}`];
      const uploaded = status ? status.uploaded : Boolean(r.sheet_flags?.[req.key]);
      const d = computeDeadline(deadlineInputsOf(r), req);
      docs.push({
        stageKey: r.stage_key,
        stage: STAGE_BY_KEY[r.stage_key],
        requirementKey: req.key,
        requirementName: req.name,
        criteria: req.criteria,
        uploaded,
        fileUrl: status?.file_url ?? null,
        dueDate: d.dueDate,
        window:
          d.windowStart && d.windowEnd ? `${d.windowStart} → ${d.windowEnd}` : null,
        basedOn: d.basedOn || null,
        note: d.note ?? null,
      });
    }
  }

  return (
    <CxpEpView
      header={{
        epName: rep.ep_name,
        epOppId: rep.ep_opp_id,
        product: rep.product,
        function: rep.function,
        side: rep.side ?? sideOf(rep.function),
        status: rep.status,
        approvalDate: rep.approval_date,
        startDate: rep.start_date,
        endDate: rep.end_date,
        arrivalDate: rep.arrival_date,
        hostLc: rep.host_lc,
        homeLc: rep.home_lc,
        opportunityName: rep.opportunity_name,
        comments: records
          .filter((r) => r.ecb_comment)
          .map((r) => ({ stage: STAGE_BY_KEY[r.stage_key], comment: r.ecb_comment! })),
        needsReview: records.some((r) => r.needs_review),
      }}
      docs={docs}
      canEdit={canEdit}
    />
  );
}
