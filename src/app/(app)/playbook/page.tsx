import { getViewer } from "@/server/data";
import { PlaybookView } from "@/components/crm/playbook-view";

export const metadata = { title: "Playbook" };

/** The Sodio Playbook — the living, role-organized manual of the system.
 *  ⚠️ RULE: update `playbook-view.tsx` (content + PLAYBOOK_VERSION) with every
 *  release, in the same commit — this page is what gets handed to the next
 *  generations. */
export default async function PlaybookPage() {
  const viewer = await getViewer();
  return (
    <PlaybookView
      role={viewer.role}
      isAdmin={viewer.isAdmin}
      isB2B={viewer.functions.includes("B2B") || viewer.sub_functions.includes("B2B")}
    />
  );
}
