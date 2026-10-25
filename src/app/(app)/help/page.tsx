import { gateTab } from "@/server/tabs";
import {
  hasConsiderationAccess, hasOgxAccess, hasRaisingAccess, hasTmAccess,
} from "@/lib/rbac";
import { memberIsB2B, memberIsB2C } from "@/lib/types";
import { getViewer } from "@/server/data";
import { HelpView } from "@/components/crm/help-view";

export const metadata = { title: "Help" };

/** THE HELP CENTER (v33.36) — the Playbook, grown up: searchable articles,
 *  FAQs, diagrams and The Violet Man as the AI layer.
 *  ⚠️ RULE unchanged: update `src/lib/help-articles.ts` (+ HELP_VERSION in
 *  help-content.ts) with every release, in the same commit. */
export default async function HelpPage() {
  const viewer = await getViewer();
  await gateTab(viewer, "/help");
  return (
    <HelpView
      viewer={{
        role: viewer.role,
        isAdmin: viewer.isAdmin,
        isB2B: memberIsB2B(viewer),
        isB2C: memberIsB2C(viewer),
        isTm: hasTmAccess(viewer),
        isOgx: hasOgxAccess(viewer),
        isConsideration: hasConsiderationAccess(viewer),
        hasRaising: hasRaisingAccess(viewer),
      }}
    />
  );
}
