import { redirect } from "next/navigation";
import { getViewer, listAllMembers, listMyEmails } from "@/server/data";
import { canUseMailboxTab } from "@/lib/rbac";
import { COMPOSE_TEMPLATES } from "@/lib/email/compose";
import { EmailsView } from "@/components/crm/emails-view";

export const metadata = { title: "Emails" };

/** THE LC'S LETTERS (v33.24) — MMs and above write to partners, EPs and other
 *  LCs from here, through their OWN Gmail. */
export default async function EmailsPage() {
  const viewer = await getViewer();
  if (!canUseMailboxTab(viewer)) redirect("/");

  const [{ rows, recents }, members] = await Promise.all([
    listMyEmails(viewer),
    listAllMembers(),
  ]);

  return (
    <EmailsView
      sent={rows}
      recents={recents}
      templates={COMPOSE_TEMPLATES}
      people={members
        .filter((m) => m.email && m.id !== viewer.id)
        .map((m) => ({ name: m.name, email: m.email as string, role: m.role }))}
    />
  );
}
