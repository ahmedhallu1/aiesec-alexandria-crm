import "server-only";
import { db } from "@/lib/supabase";
import {
  canManageMembership,
  canSeeCvPool,
  canUseAdminTools,
  canViewArchive,
  considerationFunctions,
  hasConsiderationAccess,
  hasOgxAccess,
  hasRaisingAccess,
  hasTmAccess,
  ogxFunctions,
  type Viewer,
} from "@/lib/rbac";
import { accountFiltersFromParams, signupFiltersFromParams } from "@/lib/filters-from-params";
import { dashboardLaneViews } from "@/lib/dashboard-lanes";
import { isOgxLaneKey } from "@/lib/dashboard-funnel";
import { cairoToday, fmtDateTime } from "@/lib/types";
import { SOURCE_LABEL } from "@/lib/icx-approvals";
import { hasCxpAccess } from "@/lib/cxp/rbac";
import type { ExportBook, ExportCell, ExportSheet } from "@/lib/export/book";
import {
  b2cCicAccess,
  considerationStats,
  getDashboard,
  listAccounts,
  listCvsPage,
  listIrCalls,
  listMembersDirectory,
  listPartnerLcDetails,
  listSignupsPage,
  ogxDashboard,
  type AccountFilters,
  type DrillGroup,
  type OgxBoardRow,
  type OgxLane,
} from "./data";

/**
 * DATA EXPORT — WHAT CAN BE EXTRACTED, AND BY WHOM (v37.2).
 *
 * THE ONE RULE: an export is built by the SAME scoped reader its page uses —
 * `listAccounts` for Raising, `listSignupsPage` for Sign-ups, and so on — with
 * the same filters read from the same URL. So a file can never hold a row the
 * person could not already see on screen: the permission check is not
 * re-implemented here, it is inherited. `available` only decides whether the
 * button shows; the reader is what guarantees the rows.
 *
 * Every export is audit-logged by the route (what, how many rows, which
 * filters) — a spreadsheet of phone numbers leaving the building is exactly
 * the kind of thing the log exists for.
 */

type Params = Record<string, string | undefined>;

export interface ExportDef {
  id: string;
  label: string;
  /** one line for the settings page's data section */
  description: string;
  available: (v: Viewer) => boolean;
  build: (v: Viewer, p: Params) => Promise<ExportBook>;
}

const stamp = () => cairoToday();
const yes = (b: boolean | null | undefined) => (b ? "Yes" : "No");
const day = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : null);
const list = (a: string[] | null | undefined) => (a ?? []).filter(Boolean).join(", ");

/** Page through a paged reader until it runs out (hard ceiling: 20k rows). */
async function allPages<T>(
  fetchPage: (page: number) => Promise<{ rows: T[]; total: number }>,
  size: number
): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < 200; page++) {
    const { rows, total } = await fetchPage(page);
    out.push(...rows);
    if (rows.length < size || out.length >= total || out.length >= 20_000) break;
  }
  return out;
}

const drillSheet = (name: string, rows: DrillGroup[]): ExportSheet => ({
  name,
  columns: ["Name", "Market research", "Contacted", "Visits", "Visits done", "Deals", "Opens", "Out of process"],
  rows: rows.map((r) => [r.label, r.mr, r.contacted, r.visitScheduled, r.visitDone, r.deals, r.slots, r.outOfProcess]),
});

const ogxSheet = (name: string, rows: OgxBoardRow[]): ExportSheet => ({
  name,
  columns: ["Name", "Sign-ups", "Contacted", "Interested", "Applied", "Accepted", "Approved"],
  rows: rows.map((r) => [r.label, r.signups, r.contacted, r.interested, r.applied, r.accepted, r.approved]),
});

const pct = (a: number, b: number) => (b > 0 ? `${Math.min(100, Math.round((a / b) * 100))}%` : "—");

export const EXPORTS: ExportDef[] = [
  // ------------------------------------------------------------ raising
  {
    id: "accounts",
    label: "Raising accounts",
    description: "Every account you can see on Raising, with the filters you have on.",
    available: hasRaisingAccess,
    async build(v, p) {
      const filters = accountFiltersFromParams(p, { archiveAllowed: canViewArchive() });
      const rows = await listAccounts(v, filters);
      return {
        fileName: `Sodio accounts ${stamp()}`,
        sheets: [
          {
            name: filters.archived ? "Archived accounts" : "Accounts",
            columns: [
              "Account", "Function", "Product", "Project", "Sub product", "Type", "Industry",
              "Stage", "Responsible", "Team", "Phone", "Email", "Website", "Social",
              "Contact attempts", "Last contact", "Last result", "Next step", "Next step date",
              "Visit date", "Deals", "Opens", "Opens GV", "Opens GTa", "Opens GTe",
              "Proposal sent", "Requested on Podio", "Podio state", "Out of process",
              "Why out of process", "Added on",
            ],
            rows: rows.map((r): ExportCell[] => [
              r.name, r.function, r.product, r.project, r.sub_product, r.account_type, r.industry,
              r.stage, r.responsible_name ?? "Unassigned", r.responsible_team_name,
              r.phone, r.email, r.website, r.social_link,
              r.attempts, day(r.last_contact_at), r.last_contact_status, r.next_step,
              r.next_step_date, r.visit_date, r.deals_count, r.slots_count,
              r.slots_igv_count, r.slots_igta_count, r.slots_igte_count,
              yes(r.proposal_sent), yes(r.requested_podio), r.request_state,
              yes(r.out_of_process), r.oop_reason, day(r.created_at),
            ]),
          },
        ],
      };
    },
  },

  // ------------------------------------------------------------ OGX
  {
    id: "signups",
    label: "Sign-ups",
    description: "The sign-ups list you are looking at — the view, side and filters you have on.",
    available: (v) => hasOgxAccess(v) || b2cCicAccess(v),
    async build(v, p) {
      const fns = ogxFunctions(v);
      const fn = p.fn && (fns as string[]).includes(p.fn) ? p.fn : hasOgxAccess(v) ? fns[0] : undefined;
      const filters = signupFiltersFromParams(p, fn);
      const rows = await allPages((page) => listSignupsPage(v, filters, page, 100), 100);
      return {
        fileName: `Sodio sign-ups ${stamp()}`,
        sheets: [
          {
            name: "Sign-ups",
            columns: [
              "Name", "EP ID", "Side", "Programme", "Signed up", "Phone", "Email", "Country",
              "Home LC", "University", "Campaign", "Assigned to", "Assigned on", "Contacted",
              "Interested", "Status", "Out of process", "Why", "2nd caller (CIC)", "Source",
            ],
            rows: rows.map((r): ExportCell[] => [
              r.name, r.ep_id, r.fn, r.program, day(r.signed_up_at), r.phone, r.email, r.country,
              r.home_lc, r.university, r.campaign, r.assigned_name, day(r.assigned_at),
              r.contact_status, r.interested, r.status, yes(r.out_of_process), r.oop_reason,
              r.cic_assigned_name, r.source,
            ]),
          },
        ],
      };
    },
  },

  // ------------------------------------------------------------ consideration
  {
    id: "approvals",
    label: "ICX approvals",
    description: "Every approval logged in Consideration → Approvals, for the lanes you read.",
    available: (v) => considerationFunctions(v).length > 0,
    async build(v) {
      const { listIcxApprovals } = await import("./icx-approvals");
      const rows = await listIcxApprovals(v);
      return {
        fileName: `Sodio approvals ${stamp()}`,
        sheets: [
          {
            name: "Approvals",
            columns: [
              "Approved on", "EP", "EXPA id", "Programme", "Sending LC", "Country", "How it came",
              "Our account", "Opportunity", "Made by", "EP email", "EP phone", "Notes",
              "From SubTool", "Logged by", "Logged on",
            ],
            rows: rows.map((r): ExportCell[] => [
              r.approved_on, r.ep_name, r.expa_id, r.product, r.partner_lc_name, r.country,
              SOURCE_LABEL[r.source], r.account_name, r.opportunity, r.made_by_name, r.ep_email,
              r.ep_phone, r.notes, yes(r.from_subtool), r.logged_by_name, day(r.created_at),
            ]),
          },
        ],
      };
    },
  },
  {
    id: "ir_calls",
    label: "IR calls",
    description: "Scheduled calls and the whole call log, with the log's filters you have on.",
    available: hasConsiderationAccess,
    async build(v, p) {
      const filters = {
        q: p.callq, product: p.callproduct, status: p.callstatus, member: p.callmember,
        lc: p.calllc, has: p.callhas, sort: p.callsort,
        dir: (p.calldir === "asc" ? "asc" : p.calldir === "desc" ? "desc" : undefined) as
          | "asc" | "desc" | undefined,
        from: p.callfrom, to: p.callto,
      };
      let scheduled: Awaited<ReturnType<typeof listIrCalls>>["scheduled"] = [];
      const log = await allPages(async (page) => {
        const r = await listIrCalls(v, page, 100, undefined, filters);
        if (page === 0) scheduled = r.scheduled;
        return { rows: r.rows, total: r.total };
      }, 100);
      const columns = [
        "When (Cairo)", "Partner LC", "Programme", "Status", "Host", "IR", "IR role", "IR email",
        "IR phone", "Demand", "Notes", "Booked on",
      ];
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const row = (c: any): ExportCell[] => [
        fmtDateTime(c.called_at), c.partner_lc_name, c.product, c.status, c.member_name,
        c.booker_name, c.booker_role, c.booker_email, c.booker_phone, c.demand, c.notes,
        day(c.booked_at),
      ];
      return {
        fileName: `Sodio IR calls ${stamp()}`,
        sheets: [
          { name: "Scheduled", columns, rows: scheduled.map(row) },
          { name: "Call log", columns, rows: log.map(row) },
        ],
      };
    },
  },
  {
    id: "partner_lcs",
    label: "Partner LCs",
    description: "The partner-LC registry: countries, calls, CVs, partnerships and their IRs.",
    available: hasConsiderationAccess,
    async build(v) {
      const lcs = await listPartnerLcDetails(v);
      return {
        fileName: `Sodio partner LCs ${stamp()}`,
        sheets: [
          {
            name: "Partner LCs",
            columns: ["LC", "Country", "Reached as", "Calls", "CVs", "Last call", "Partnerships", "Who works it"],
            rows: lcs.map((l): ExportCell[] => [
              l.name, l.country, list(l.products), l.calls, l.cvs, day(l.lastCallAt),
              l.partnerships.filter((x) => x.status === "done").map((x) => x.product).join(", "),
              l.assignedTo.map((a) => a.name).join(", "),
            ]),
          },
          {
            name: "IRs",
            columns: ["LC", "Name", "Role", "Programme", "Email", "Phone"],
            rows: lcs.flatMap((l) =>
              l.contacts.map((c): ExportCell[] => [l.name, c.name, c.role, c.product, c.email, c.phone])
            ),
          },
        ],
      };
    },
  },
  {
    id: "cvs",
    label: "CV pool",
    description: "The CV pool's details (not the files), with the pool's filters you have on.",
    available: canSeeCvPool,
    async build(v, p) {
      const filters = { q: p.q, lc: p.cvlc, industry: p.industry, status: p.status, uploader: p.uploader, phone: p.cvphone };
      const rows = await allPages((page) => listCvsPage(v, filters, page, 100), 100);
      return {
        fileName: `Sodio CV pool ${stamp()}`,
        sheets: [
          {
            name: "CVs",
            columns: ["Name", "Phone", "Email", "Industry", "Skills", "Partner LC", "Uploaded by", "Uploaded on", "File"],
            rows: rows.map((c): ExportCell[] => [
              c.person_name, c.phone, c.email, c.industry, c.skills, c.partner_lc_name,
              c.uploader_name, day(c.created_at), c.file_name,
            ]),
          },
        ],
      };
    },
  },

  // ------------------------------------------------------------ people
  {
    id: "membership",
    label: "Membership",
    description: "Everyone in the LC, active and inactive — the same columns the membership upload takes.",
    available: canManageMembership,
    async build() {
      const { data } = await db()
        .from("members")
        .select("name, email, fallback_email, phone, role, functions, sub_functions, stakeholder_name, team_name, is_active")
        .order("is_active", { ascending: false })
        .order("name");
      return {
        fileName: `Sodio membership ${stamp()}`,
        sheets: [
          {
            name: "Membership",
            columns: ["Name", "Email", "Phone", "Role", "Function", "Sub Function", "Manager", "Active", "Backup email"],
            rows: (data ?? []).map((m): ExportCell[] => [
              m.name, m.email, m.phone, m.role, list(m.functions), list(m.sub_functions),
              // "Yes"/"No" — what the membership upload reads back
              m.stakeholder_name, m.is_active ? "Yes" : "No", m.fallback_email,
            ]),
          },
        ],
      };
    },
  },
  {
    id: "members_directory",
    label: "Members directory & MOS",
    description: "Every member with their manager and their numbers (the Talent Management directory).",
    available: hasTmAccess,
    async build(v, p) {
      const rows = await listMembersDirectory(v, { from: p.from, to: p.to });
      return {
        fileName: `Sodio members ${stamp()}`,
        sheets: [
          {
            name: "Members",
            columns: [
              "Name", "Role", "Function", "Sub function", "Manager", "Email", "Phone",
              "Market research", "Contacted", "Visits", "Visits done", "Deals", "Opens", "EGP",
              "Sign-ups", "Sign-ups approved",
            ],
            rows: rows.map((m): ExportCell[] => [
              m.name, m.role, list(m.functions), list(m.sub_functions), m.manager, m.email, m.phone,
              m.kpis.mr, m.kpis.contacted, m.kpis.visits, m.kpis.visitsDone, m.kpis.deals,
              m.kpis.slots, m.kpis.egp, m.kpis.signupTotal, m.kpis.signupApprovals,
            ]),
          },
        ],
      };
    },
  },
  {
    id: "attendance",
    label: "Attendance",
    description: "Attendance records you can see, with the history's filters you have on.",
    available: () => true,
    async build(v, p) {
      const { listAttendanceHistory } = await import("./attendance-read");
      const DATE = /^\d{4}-\d{2}-\d{2}$/;
      const rows = await allPages(
        async (page) => {
          const r = await listAttendanceHistory(v, {
            from: DATE.test(p.from ?? "") ? p.from : "",
            to: DATE.test(p.to ?? "") ? p.to : "",
            kind: p.kind ?? "",
            status: p.status ?? "",
            member: (p.member ?? "").slice(0, 120),
            fn: (p.fn ?? "").slice(0, 120),
            page: page + 1,
            pageSize: 100,
          });
          return { rows: r.rows, total: r.total };
        },
        100
      );
      return {
        fileName: `Sodio attendance ${stamp()}`,
        sheets: [
          {
            name: "Attendance",
            columns: ["When", "Touch point", "Kind", "Member", "Function", "Status", "Excused", "Excuse", "Recorded by", "Automatic"],
            rows: rows.map((r): ExportCell[] => [
              fmtDateTime(r.startsAt), r.label, r.kind, r.memberName, list(r.memberFunctions),
              r.status, yes(r.excused), r.excuse, r.ownerName, yes(r.automatic),
            ]),
          },
        ],
      };
    },
  },

  // ------------------------------------------------------------ admin
  {
    id: "im_prompts",
    label: "Messages to the LC — answers",
    description: "Every “Say something to the LC” prompt, and each person's answer.",
    available: canUseAdminTools,
    async build() {
      const { loadImPromptResults } = await import("./im-prompt-results");
      const r = await loadImPromptResults();
      const rows = r.ok ? r.data : [];
      return {
        fileName: `Sodio LC messages ${stamp()}`,
        sheets: [
          {
            name: "Prompts",
            columns: ["Sent", "Title", "Kind", "Sent to", "Answered", "Skipped", "Waiting", "Average rating", "Closed"],
            rows: rows.map((p): ExportCell[] => [
              fmtDateTime(p.createdAt), p.title, p.responseKind, p.sent, p.answered, p.skipped,
              p.waiting, p.avgRating, yes(!p.active),
            ]),
          },
          {
            name: "Answers",
            columns: ["Prompt", "Person", "Role", "Rating", "Answer", "Acknowledged", "Skipped", "When"],
            rows: rows.flatMap((p) =>
              p.responses.map((x): ExportCell[] => [
                p.title, x.name, x.role, x.rating, x.text, yes(x.acknowledged), yes(x.skipped), fmtDateTime(x.at),
              ])
            ),
          },
        ],
      };
    },
  },

  // ------------------------------------------------------------ CXP
  {
    id: "cxp",
    label: "CXP — EP submissions",
    description: "Every EP's ECB submission status, with the documents collected and missing.",
    available: hasCxpAccess,
    async build(_v, p) {
      const { listEps } = await import("./cxp");
      const { rows, month } = await listEps({
        side: p.side === "ICX" || p.side === "OGX" ? p.side : null,
        scope: p.scope === "previous" ? "previous" : "current",
        search: p.q ?? null,
      });
      return {
        fileName: `Sodio CXP ${month.slice(0, 7)}`,
        sheets: [
          {
            name: "EPs",
            columns: ["EP", "EP/OPP ID", "Function", "Product", "Stage", "EXPA status", "Collected", "Required", "Missing", "Start", "End", "ECB comment"],
            rows: rows.map((r): ExportCell[] => [
              r.epName, r.epOppId, r.function, r.product, r.stage, r.status, r.uploadedCount,
              r.totalCount, r.missingCount, r.startDate, r.endDate, r.comment,
            ]),
          },
        ],
      };
    },
  },

  // ------------------------------------------------------------ dashboard
  {
    id: "dashboard",
    label: "Dashboard",
    description: "A dashboard lane as a workbook: the totals, the conversions, every leaderboard and drill.",
    available: (v) => dashboardLaneViews(v).length > 0,
    async build(v, p) {
      const views = dashboardLaneViews(v);
      const lane = p.fn && views.some((x) => x.key === p.fn) ? p.fn : views[0]?.key;
      if (!lane) return { fileName: "Sodio dashboard", sheets: [] };
      const laneLabel = views.find((x) => x.key === lane)?.label ?? lane;
      const window = [p.from, p.to].filter(Boolean).join(" → ") || "all time";
      const header = (rows: ExportCell[][]): ExportSheet => ({
        name: "Summary",
        columns: ["", ""],
        rows: [["Lane", laneLabel], ["Dates", window], ["Exported", fmtDateTime(new Date().toISOString())], ...rows],
      });
      const fileName = `Sodio dashboard ${laneLabel} ${stamp()}`;

      if (lane === "CONS_IGV" || lane === "CONS_IGT") {
        const s = await considerationStats(v, lane === "CONS_IGV" ? "IGV" : "IGT", {
          from: p.from, to: p.to, member: p.member, team: p.team,
        });
        if (!s) return { fileName, sheets: [] };
        const a = s.approvals;
        const sheets: ExportSheet[] = [
          header([
            ["🏆 Approvals (" + a.totalLabel + ")", a.total],
            ["Approvals this month", a.thisMonth],
            ...(a.planKind !== "none"
              ? ([
                  [`Approvals planned (${a.plan.label})`, a.plan.planned],
                  [`Approvals achieved (${a.plan.label})`, a.plan.achieved],
                ] as ExportCell[][])
              : []),
            ["IR calls — total", s.irTotal],
            ["Calls this month", s.irThisMonth],
            ["Upcoming calls", s.irUpcoming],
            ["Calls completed", s.irCompleted],
            ["Waiting to be reported", s.irOverdue],
            ["Partner LCs reached", s.partnerLcsContacted],
            ["Partnerships", s.partnerships.total],
            ...(s.showCvs ? ([["CVs in the pool", s.cvTotal]] as ExportCell[][]) : []),
          ]),
          {
            name: "Leaderboard",
            columns: ["Member", "Approvals", "Calls done", "Upcoming", "Waiting", "This month", "Total calls", "LCs reached", "Partnerships", "CVs"],
            rows: s.byMember.map((m) => [m.name, m.approvals, m.done, m.upcoming, m.overdue, m.month, m.total, m.lcs, m.partnerships, m.cvs]),
          },
          {
            name: "Approvals by person",
            columns: ["Person", "Approvals"],
            rows: a.people.map((x) => [x.name, x.own]),
          },
          {
            name: "Approvals by MM",
            columns: ["MM", "Own", "Team", "Total"],
            rows: a.mms.map((x) => [x.name, x.own, x.team, x.total]),
          },
          {
            name: "Approvals by month",
            columns: a.planKind !== "none" ? ["Month", "Achieved", "Planned"] : ["Month", "Achieved"],
            rows: a.byMonth.map((m) => (a.planKind !== "none" ? [m.month, m.achieved, m.planned] : [m.month, m.achieved])),
          },
          {
            name: "Approvals by source",
            columns: ["Source", "Approvals"],
            rows: [...a.bySource.map((x) => [x.label, x.count] as ExportCell[]), ...a.topLcs.map((x) => [`LC: ${x.name}`, x.count] as ExportCell[])],
          },
        ];
        return { fileName, sheets };
      }

      if (isOgxLaneKey(lane)) {
        const d = await ogxDashboard(v, lane as OgxLane, { from: p.from, to: p.to, team: p.team, member: p.member });
        if (!d) return { fileName, sheets: [] };
        const t = d.total;
        return {
          fileName,
          sheets: [
            header([
              ["Sign-ups", t.signups], ["Contacted", t.contacted], ["Interested", t.interested],
              ["Applied", t.applied], ["Accepted", t.accepted], ["Approved", t.approved],
              ["Sign-up → Contacted", pct(t.contacted, t.signups)],
              ["Contacted → Applied", pct(t.applied, t.contacted)],
              ["Applied → Approved", pct(t.approved, t.applied)],
              ["Referrals among them", d.referrals],
            ]),
            ogxSheet("Members", d.board),
            ogxSheet("MMs", d.mmBoard),
            ogxSheet("Teams", d.byTeam),
            ...(d.bySide ? [ogxSheet("By side", d.bySide.map((x) => ({ key: x.fn, label: x.fn, ...x.total })))] : []),
          ],
        };
      }

      // an account lane (All ICX · IGV · IGT · IGTa/e · B2B · BD · B2C)
      const fnFilter: Pick<AccountFilters, "fn" | "product"> =
        lane === "IGTa" ? { fn: "IGT", product: "GTa" }
          : lane === "IGTe" ? { fn: "IGT", product: "GTe" }
            : ["IGV", "IGT", "B2B", "BD", "B2C"].includes(lane) ? { fn: lane as AccountFilters["fn"] }
              : {};
      const d = await getDashboard(
        v,
        { ...fnFilter, teamId: p.team || undefined, responsibleId: p.member || undefined, from: p.from || undefined, to: p.to || undefined },
        lane === "TM" ? "all" : lane
      );
      const t = d.total;
      const sheets: ExportSheet[] = [
        header([
          ["Market research", t.mr], ["Contacted", t.contacted], ["Visits", t.visitScheduled],
          ["Visits done", t.visitDone], ["Deals", t.deals], ["Opens", t.slots],
          ["MR → Contacted", pct(t.contacted, t.mr)],
          ["Contacted → Visits", pct(t.visitScheduled, t.contacted)],
          ["Visits → Done", pct(t.visitDone, t.visitScheduled)],
          ["Visit done → Deal", pct(t.dealAccounts, t.visitDone)],
          ["Out of process", t.outOfProcess],
          // the lane's plan is only ever returned to leaders (getDashboard)
          ...(d.lanePlan
            ? ([
                [`Opens planned (${d.lanePlan.window.label})`, d.lanePlan.window.plannedOpens],
                [`Opens achieved (${d.lanePlan.window.label})`, d.lanePlan.window.actualOpens],
              ] as ExportCell[][])
            : []),
        ]),
        drillSheet("Leaderboard", d.memberBoard),
        drillSheet("MMs", d.mmBoard),
        ...(d.teamBoard ? [drillSheet("My team", d.teamBoard)] : []),
        drillSheet("By team", d.byTeam),
        drillSheet("By function", d.byFunction),
      ];
      return { fileName, sheets };
    },
  },
];

export function exportsFor(v: Viewer): ExportDef[] {
  return EXPORTS.filter((e) => e.available(v));
}
