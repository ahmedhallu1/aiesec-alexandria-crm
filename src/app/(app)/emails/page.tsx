import { gateTab } from "@/server/tabs";
import {
  getViewer, listAllMembers, listEmailGroups, listMyEmails,
} from "@/server/data";
import {
  canUseMailboxTab, hasConsiderationAccess, hasRaisingAccess, isB2C, isTmCore,
} from "@/lib/rbac";
import {
  COMPOSE_TEMPLATES, EMAIL_IMAGES, EMAIL_LAYOUTS, emailImageUrl, templatesFor,
  type MailAudience,
} from "@/lib/email/compose";
import { EmailsView } from "@/components/crm/emails-view";

export const metadata = { title: "Emails" };

/** THE LC'S LETTERS (v33.24) — every member writes to partners, EPs and other
 *  LCs from here, through their OWN Gmail (v33.41: the tab used to be MMs and
 *  above, which just sent members back to a blank Gmail with no signature). */
export default async function EmailsPage() {
  const viewer = await getViewer();
  await gateTab(viewer, "/emails", canUseMailboxTab(viewer));

  const [{ rows, recents }, members, groups] = await Promise.all([
    listMyEmails(viewer),
    listAllMembers(),
    listEmailGroups(viewer),
  ]);

  // THE STARTING POINTS ARE THEIRS (v33.41). The tab belongs to everyone now,
  // so the template list is built from what this person actually DOES — a
  // raiser never opens the EP contract mail, an OGX member never opens the
  // company pitch. LCP/admin see the lot, because they answer for all of it.
  const everything = viewer.isAdmin || viewer.role === "LCP";
  const has = (...fns: string[]) =>
    [...viewer.functions, ...viewer.sub_functions].some((f) => fns.includes(f));
  const audiences: MailAudience[] = everything
    ? ["raising", "consideration", "ogx", "b2c", "tm"]
    : [
        ...(hasRaisingAccess(viewer) ? (["raising"] as MailAudience[]) : []),
        ...(hasConsiderationAccess(viewer) ? (["consideration"] as MailAudience[]) : []),
        ...(has("OGT", "OGV") ? (["ogx"] as MailAudience[]) : []),
        ...(isB2C(viewer) ? (["b2c"] as MailAudience[]) : []),
        ...(isTmCore(viewer) ? (["tm"] as MailAudience[]) : []),
      ];
  const isMm =
    viewer.isAdmin ||
    ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"].includes(viewer.role);
  const templates = templatesFor(COMPOSE_TEMPLATES, { audiences, isMm });
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
