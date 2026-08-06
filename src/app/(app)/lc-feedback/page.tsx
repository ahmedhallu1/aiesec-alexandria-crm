import { canSeeLcConcerns } from "@/lib/rbac";
import {
  getViewer, listAllMembers, listLcFeedback, listPastTouchPointsForFeedback,
  type LcFeedbackRow,
} from "@/server/data";
import { LcFeedbackView } from "@/components/crm/lc-feedback-view";

export const metadata = { title: "Feedback" };

export default async function LcFeedbackPage() {
  const viewer = await getViewer();
  const isInboxOwner = canSeeLcConcerns(viewer);

  const [all, inbox, touchPoints] = await Promise.all([
    listAllMembers(),
    isInboxOwner ? listLcFeedback(viewer) : Promise.resolve([] as LcFeedbackRow[]),
    // ANY past session the viewer was part of — not just the ones a register
    // marked them present at (v33.19)
    listPastTouchPointsForFeedback(viewer).catch(() => []),
  ]);

  const members = all
    .filter((m) => m.is_active && m.id !== viewer.id)
    .map((m) => ({
      id: m.id,
      label: m.name,
      role: m.role as string,
      team: m.team_name,
      functions: m.functions ?? [],
    }));

  return (
    <LcFeedbackView
      members={members}
      touchPoints={touchPoints}
      viewer={{
        id: viewer.id,
        role: viewer.role,
        stakeholderId: viewer.stakeholder_id,
        teamMemberIds: viewer.teamMemberIds,
        functions: viewer.functions ?? [],
      }}
      isInboxOwner={isInboxOwner}
      inbox={inbox}
    />
  );
}
