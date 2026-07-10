import { redirect } from "next/navigation";
import { getViewer, listVisibleMembers } from "@/server/data";
import { allowedAccountFunctions, hasRaisingAccess } from "@/lib/rbac";
import { ImportView } from "@/components/crm/import-view";

export const metadata = { title: "Import accounts" };

export default async function ImportPage() {
  const viewer = await getViewer();
  if (!hasRaisingAccess(viewer)) redirect("/");
  const allowedFns = allowedAccountFunctions(viewer);
  if (allowedFns.length === 0) redirect("/accounts");

  const members = await listVisibleMembers(viewer);

  return (
    <ImportView
      viewer={{
        id: viewer.id,
        canAssignOthers:
          viewer.isAdmin || ["LCP", "LCVP", "Director", "Team Leader"].includes(viewer.role),
        allowedFns,
      }}
      members={members.map((m) => ({
        id: m.id,
        label: m.nickname || m.name,
        functions: m.functions ?? [],
      }))}
    />
  );
}
