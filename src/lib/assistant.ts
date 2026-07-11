import "server-only";
import type { Viewer } from "@/lib/rbac";
import { getDashboard, listAccounts, listVisibleMembers } from "@/server/data";

/** The Blue Man — Sodio's assistant. Builds the RBAC-SCOPED context blob the
 *  model answers from: a member's Blue Man only sees what that member can see.
 *  Resources are pluggable — the auditing system plugs in here later. */
export async function buildAssistantContext(viewer: Viewer): Promise<string> {
  const [dash, accounts, members] = await Promise.all([
    getDashboard(viewer, {}),
    listAccounts(viewer, { includeArchived: true }),
    listVisibleMembers(viewer),
  ]);

  const accountLines = accounts
    .slice(0, 150)
    .map(
      (a) =>
        `- ${a.name} [${a.function}${a.product ? `/${a.product}` : ""}${a.project ? `/${a.project}` : ""}] stage=${a.stage} responsible=${a.responsible_nickname || a.responsible_name} contacts=${a.attempts} deals=${a.deals_count ?? 0} slots=${a.slots_count}${a.out_of_process ? ` ARCHIVED(${a.oop_reason ?? ""})` : ""}${a.next_step ? ` next="${a.next_step}" (${a.next_step_date ?? "no date"})` : ""}`
    )
    .join("\n");

  const memberLines = members
    .map(
      (m) =>
        `- ${m.nickname || m.name} (${m.role}${(m.functions ?? []).length ? ` · ${(m.functions ?? []).join(",")}` : ""})`
    )
    .join("\n");

  const board = dash.functionBoard
    .slice(0, 15)
    .map((g, i) => `${i + 1}. ${g.label}: ${g.slots} slots · ${g.deals} deals · ${g.contacted} contacted`)
    .join("\n");

  return `## Sodio live data (scoped to what THIS user is allowed to see)

### Viewer
${viewer.nickname || viewer.name} — role ${viewer.role}${viewer.isAdmin ? " (Admin/IM director)" : ""}, functions: ${viewer.functions.join(", ") || "—"}.

### KPIs (viewer's scope)
Market Research (total accounts): ${dash.total.mr}
Contacted: ${dash.total.contacted} · Visits scheduled: ${dash.total.visitScheduled} · Visits done: ${dash.total.visitDone}
Deals: ${dash.total.deals} · Slots/opens raised: ${dash.total.slots} · Accounts archived: ${dash.total.outOfProcess}

### Goals
Function goal: ${dash.funcGoal ? `${dash.funcGoal.target} slots (${dash.funcGoal.period_label})` : "not set"}
Team goal: ${dash.teamGoal ? `${dash.teamGoal.target} slots (${dash.teamGoal.period_label})` : "not set"}

### Leaderboard (opens roll up from members to their Team Leader)
${board || "(empty)"}

### Members visible to this user
${memberLines || "(only themselves)"}

### Accounts (up to 150)
${accountLines || "(none yet)"}`;
}

export const BLUE_MAN_SYSTEM_PROMPT = `You are **The Blue Man** 🚶 — the walking spirit of AIESEC in Alexandria and the built-in assistant of **Sodio**, the LC's ICX CRM.

Personality: warm, punchy, a little playful (this is a youth-led organization — never stiff), but always accurate. Answer in the language the user writes in (English or Arabic/Franco).

You can answer about:
1. **Sodio's data** — use ONLY the scoped data block provided below. Never invent numbers. If something isn't in the data, say the user's access doesn't cover it or it doesn't exist yet.
2. **How Sodio works** — rules summary: accounts are unique across ICX; every in-process account needs a next step with a date or a booked visit; 3 unanswered contacts → archive prompt; "Not Interested" or Podio "Rejected" auto-archives; deals are many-per-account (deals count separately from slots/opens); opens roll up from a member to their Team Leader; goals: IGT goal = IGTa + IGTe; visits create calendar reminders 24h & 1h before; proposal emails are drafted into the member's own Gmail; B2B raises for the whole ICX (bulk deals across IGV+IGT).
3. **AIESEC in general** — use Google Search grounding, PREFERRING these official sources: https://aiesec.org (global), https://aiesec.org.eg (Egypt), https://core.aiesec.org.eg (VERY important — AIESEC Egypt core/CIM resources), https://expa.aiesec.org (EXPA platform).

Rules: keep answers short and scannable (bullets over walls of text). Numbers from the data block are the truth. Do not reveal other members' personal contact data (emails/phones) unless the asker is a leader. Never make up AIESEC policy — if unsure, say so and point to the official source. Sign off occasionally with a small 🚶💙 when it fits.`;
