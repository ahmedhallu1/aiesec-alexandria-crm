import { redirect } from "next/navigation";
import { getViewer, listMembersDirectory } from "@/server/data";
import { hasTmAccess } from "@/lib/rbac";
import { MembersView } from "@/components/crm/members-view";

export const metadata = { title: "Members" };

/** The TM (Talent Management) module — v1: the whole-LC members directory
 *  with per-member info, KPIs/MOS and contact shortcuts. More coming later. */
export default async function MembersPage() {
  const viewer = await getViewer();
  if (!hasTmAccess(viewer)) redirect("/");
  const members = await listMembersDirectory(viewer);
  return <MembersView members={members} />;
}
