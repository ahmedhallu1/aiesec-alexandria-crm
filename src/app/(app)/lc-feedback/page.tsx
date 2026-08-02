import {
  getViewer, listAllMembers, listAttendedTouchPoints, listLcFeedback,
  type LcFeedbackRow,
} from "@/server/data";
import { LcFeedbackView } from "@/components/crm/lc-feedback-view";

export const metadata = { title: "Feedback" };

export default async function LcFeedbackPage() {
  const viewer = await getViewer();
  const isInboxOwner = viewer.isAdmin || viewer.role === "LCP";

  const [all, inbox, touchPoints] = await Promise.all([
    listAllMembers(),
    isInboxOwner ? listLcFeedback(viewer) : Promise.resolve([] as LcFeedbackRow[]),
    listAttendedTouchPoints(viewer).catch(() => []),
  ]);

  const members = all
    .filter((m) => m.is_active && m.id !== viewer.id)
    .map((m) => ({
      id: m.id,
      label: m.nickname || m.name,
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
