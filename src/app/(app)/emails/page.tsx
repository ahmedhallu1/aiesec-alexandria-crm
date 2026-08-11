import { redirect } from "next/navigation";
import {
  getViewer, listAllMembers, listEmailGroups, listMyEmails,
} from "@/server/data";
import { canUseMailboxTab } from "@/lib/rbac";
import {
  COMPOSE_TEMPLATES, EMAIL_IMAGES, EMAIL_LAYOUTS, emailImageUrl,
} from "@/lib/email/compose";
import { EmailsView } from "@/components/crm/emails-view";

export const metadata = { title: "Emails" };

/** THE LC'S LETTERS (v33.24) — MMs and above write to partners, EPs and other
 *  LCs from here, through their OWN Gmail. */
export default async function EmailsPage() {
  const viewer = await getViewer();
  if (!canUseMailboxTab(viewer)) redirect("/");

  const [{ rows, recents }, members, groups] = await Promise.all([
    listMyEmails(viewer),
    listAllMembers(),
    listEmailGroups(viewer),
  ]);

  // v33.37 — audience-gated templates: the contract mail belongs to the OGX
  // crews (the mailbox gate already guarantees MM-and-above)
  const isOgx =
    viewer.isAdmin ||
    viewer.role === "LCP" ||
    [...viewer.functions, ...viewer.sub_functions].some((f) => f === "OGT" || f === "OGV");
  const templates = COMPOSE_TEMPLATES.filter(
    (t) => !t.audience || (t.audience === "ogx" && isOgx)
  );
  // the Expectation mail is a BUTTON here now, not its own tab (v33.37) —
  // same gate the /ogt-mail page enforces
  const showExpectation =
    viewer.isAdmin ||
    viewer.role === "LCP" ||
    ((viewer.role === "LCVP" || viewer.role === "Director") &&
      [...viewer.functions, ...viewer.sub_functions].some((f) => f === "OGT" || f === "OGV"));

  return (
    <EmailsView
      sent={rows}
      recents={recents}
      templates={templates}
      showExpectation={showExpectation}
      layouts={EMAIL_LAYOUTS}
      groups={groups}
      images={EMAIL_IMAGES.map((i) => ({
        key: i.key, label: i.label, width: i.width, url: emailImageUrl(i.file),
      }))}
      people={members
        .filter((m) => m.email && m.id !== viewer.id)
        .map((m) => ({ name: m.name, email: m.email as string, role: m.role }))}
    />
  );
}
