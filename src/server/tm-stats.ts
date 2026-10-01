import "server-only";
import { db } from "@/lib/supabase";
import { isTmCore, type Viewer } from "@/lib/rbac";
import { cairoToUtc } from "@/lib/time";
import { monthOf } from "@/lib/plan";
import { NO_WORKING_HOURS_FUNCTIONS } from "@/lib/types";
import { isPlanningMm, isPlanningTl, laneOpensActual } from "./data";

/** THE TM DASHBOARD (v33.18) — the LC through TM's eyes: does the LC show
 *  up, does it record itself, does it plan, does it deliver the plan.
 *
 *  v33.18 cuts the SAME attendance rows three ways — by function, by role
 *  level, and by member (the chase list) — from one pass over the rows;
 *  nothing is re-queried per grouping.
 *
 *  Attendance is attributed to a MEMBER's function(s) (the pattern the rest
 *  of the codebase uses — an LC-scope touch point has no function of its
 *  own); a multi-function member counts in each of their lanes. Working
 *  hours never judge TM/F&L/CXP (they have no stampable workspace), so the
 *  per-function rates are computed over the sessions each member was
 *  actually expected at. */

export interface TmStats {
  windowLabel: string;
  monthLabel: string;
  attendance: {
    /** touch points whose attendance is confirmed, in the window */
    sessions: number;
    /** past-start, still unconfirmed (the chase list) */
    owed: number;
    cancelled: number;
    /** % of expected people who showed up at all (attended + late) */
    rate: number;
    attended: number;
    late: number;
    absent: number;
    excused: number;
    byKind: { kind: string; sessions: number; rate: number }[];
    byFunction: { fn: string; rate: number; records: number; people: number }[];
    /** the same rows grouped by the member's ROLE, seniority order */
    byRole: { role: string; rate: number; records: number; people: number }[];
    /** every member with ≥1 record, worst rate first — the chase list */
    byMember: {
      id: string; name: string; role: string; fns: string;
      rate: number; records: number; attended: number; late: number; absent: number;
    }[];
    /** members with the weakest showing (≥3 records so one miss isn't a verdict) */
    lowMembers: { name: string; rate: number; records: number }[];
  };
  plans: {
    mmFiled: number;
    mmTotal: number;
    mmMissing: string[];
    tlFiled: number;
    tlTotal: number;
    tlMissing: string[];
    /** the VP planning sheet per lane — does this month's cell exist */
    vpLanes: { fn: string; filed: boolean }[];
  };
  goals: { fn: string; planned: number; actual: number; unit: string }[];
  membersActive: number;
}

const WINDOW_DAYS = 30;
const MAJOR_FNS = ["IGV", "IGT", "B2B", "BD", "B2C", "OGV", "OGT", "TM", "F&L", "CXP"];
/** seniority, so the role drill reads top-down like the LC's own hierarchy */
const ROLE_ORDER = ["LCP", "LCVP", "Director", "Team Leader", "Coordinator", "Member", "Admin"];

type MemberLite = {
  id: string;
  name: string;
  role: string;
  functions: string[] | null;
  sub_functions: string[] | null;
};

const fnsOf = (m: MemberLite): string[] => {
  const all = new Set([...(m.functions ?? []), ...(m.sub_functions ?? [])]);
  return MAJOR_FNS.filter((f) => all.has(f));
};

export async function tmStats(viewer: Viewer): Promise<TmStats | null> {
  if (!isTmCore(viewer)) return null;
  const now = new Date();
  const fromIso = new Date(now.getTime() - WINDOW_DAYS * 86_400_000).toISOString();
  const month = monthOf(now);
  const monthKey = month.planKeys[0];
  const monthFromIso = cairoToUtc(month.start, "00:00").toISOString();

  const [{ data: tpRows }, { data: memberRows }] = await Promise.all([
    db()
      .from("touch_points")
      .select("id, kind, scope, function_key, status, starts_at, attendance_recorded_at")
      .gte("starts_at", fromIso)
      .lte("starts_at", now.toISOString()),
    db()
      .from("members")
      .select("id, name, role, functions, sub_functions")
      .eq("is_active", true),
  ]);
  const tps = (tpRows ?? []) as {
    id: string; kind: string; scope: string; function_key: string | null;
    status: string; starts_at: string; attendance_recorded_at: string | null;
  }[];
  const members = (memberRows ?? []) as MemberLite[];
  const memberBy = new Map(members.map((m) => [m.id, m]));

  const live = tps.filter((t) => t.status !== "cancelled");
  const recorded = live.filter((t) => t.attendance_recorded_at);
  const owed = live.filter((t) => !t.attendance_recorded_at).length;
  const cancelled = tps.length - live.length;

  // attendance rows of the RECORDED sessions only — unconfirmed pre-fills are
  // proposals, not the record
  const recordedIds = recorded.map((t) => t.id);
  const kindBy = new Map(recorded.map((t) => [t.id, t.kind]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const attRows: any[] = [];
  // Chunked by id (a long `.in()` list breaks the URL) AND paged inside each
  // chunk (v37.6): the API returns at most 1000 rows per request, and an LC
  // session alone carries ~70 attendance rows — fifteen of them in one chunk
  // silently dropped the rest of the register from every number below.
  for (let i = 0; i < recordedIds.length; i += 100) {
    const ids = recordedIds.slice(i, i + 100);
    for (let off = 0; ; off += 1000) {
      const { data, error } = await db()
        .from("touch_point_attendance")
        .select("touch_point_id, member_id, status, excused")
        .in("touch_point_id", ids)
        .order("touch_point_id")
        .order("member_id")
        .range(off, off + 999);
      if (error) throw error;
      attRows.push(...(data ?? []));
      if ((data ?? []).length < 1000) break;
    }
  }

  let attended = 0, late = 0, absent = 0, excused = 0;
  const byKindAgg = new Map<string, { showed: number; total: number; sessions: Set<string> }>();
  const byFnAgg = new Map<string, { showed: number; total: number; people: Set<string> }>();
  const byRoleAgg = new Map<string, { showed: number; total: number; people: Set<string> }>();
  const byMemberAgg = new Map<
    string,
    { showed: number; total: number; attended: number; late: number; absent: number }
  >();
  for (const r of attRows) {
    const showed = r.status === "attended" || r.status === "late";
    if (r.status === "attended") attended += 1;
    else if (r.status === "late") late += 1;
    else if (r.status === "absent") {
      absent += 1;
      if (r.excused) excused += 1;
    }
    const kind = kindBy.get(r.touch_point_id) ?? "meeting";
    const k = byKindAgg.get(kind) ?? { showed: 0, total: 0, sessions: new Set<string>() };
    k.showed += showed ? 1 : 0;
    k.total += 1;
    k.sessions.add(r.touch_point_id);
    byKindAgg.set(kind, k);
    const m = memberBy.get(r.member_id);
    if (m) {
      for (const fn of fnsOf(m)) {
        const f = byFnAgg.get(fn) ?? { showed: 0, total: 0, people: new Set<string>() };
        f.showed += showed ? 1 : 0;
        f.total += 1;
        f.people.add(r.member_id);
        byFnAgg.set(fn, f);
      }
      const roleKey = m.role || "Member";
      const rl = byRoleAgg.get(roleKey) ?? { showed: 0, total: 0, people: new Set<string>() };
      rl.showed += showed ? 1 : 0;
      rl.total += 1;
      rl.people.add(r.member_id);
      byRoleAgg.set(roleKey, rl);
      const me = byMemberAgg.get(r.member_id)
        ?? { showed: 0, total: 0, attended: 0, late: 0, absent: 0 };
      me.showed += showed ? 1 : 0;
      me.total += 1;
      if (r.status === "attended") me.attended += 1;
      else if (r.status === "late") me.late += 1;
      else if (r.status === "absent") me.absent += 1;
      byMemberAgg.set(r.member_id, me);
    }
  }
  const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
  const total = attended + late + absent;

  const lowMembers = [...byMemberAgg.entries()]
    .filter(([, v]) => v.total >= 3)
    .map(([id, v]) => ({
      name: memberBy.get(id)?.name ?? "?",
      rate: pct(v.showed, v.total),
      records: v.total,
    }))
    .sort((a, b) => a.rate - b.rate)
    .slice(0, 5);

  // the per-member drill: worst rate first, then whoever has the most records
  // (a 40%-of-20 is a bigger problem than a 40%-of-3)
  const byMember = [...byMemberAgg.entries()]
    .map(([id, v]) => {
      const m = memberBy.get(id);
      const majors = m ? fnsOf(m) : [];
      const list = majors.length > 0 ? majors : (m?.functions ?? []);
      return {
        id,
        name: m?.name ?? "?",
        role: m?.role || "Member",
        fns: list.join(", "),
        rate: pct(v.showed, v.total),
        records: v.total,
        attended: v.attended,
        late: v.late,
        absent: v.absent,
      };
    })
    .sort((a, b) => a.rate - b.rate || b.records - a.records);

  const byRole = [...byRoleAgg.entries()]
    .map(([role, v]) => ({
      role,
      rate: pct(v.showed, v.total),
      records: v.total,
      people: v.people.size,
    }))
    .sort((a, b) => {
      const ia = ROLE_ORDER.indexOf(a.role);
      const ib = ROLE_ORDER.indexOf(b.role);
      // an unknown role sinks below the known ladder rather than jumping it
      return (ia < 0 ? ROLE_ORDER.length : ia) - (ib < 0 ? ROLE_ORDER.length : ib);
    });

  // ---------------------------------------------------------------- plans
  const planShape = (m: MemberLite) => ({
    role: m.role,
    functions: m.functions ?? [],
    sub_functions: m.sub_functions ?? [],
  });
  const mmPlanners = members.filter((m) => isPlanningMm(planShape(m)));
  const tlPlanners = members.filter((m) => isPlanningTl(planShape(m)));
  const [{ data: mmRows }, { data: tlRows }, { data: cellRows }] = await Promise.all([
    db().from("mm_plans").select("member_id").eq("month", monthKey),
    db().from("tl_plans").select("member_id").eq("month", monthKey),
    db()
      .from("plan_cells")
      .select("fn, metric, value")
      .eq("scope", "month")
      .eq("period_start", monthKey),
  ]);
  const mmFiledSet = new Set((mmRows ?? []).map((r) => r.member_id as string));
  const tlFiledSet = new Set((tlRows ?? []).map((r) => r.member_id as string));
  const mmMissing = mmPlanners.filter((m) => !mmFiledSet.has(m.id)).map((m) => m.name);
  const tlMissing = tlPlanners.filter((m) => !tlFiledSet.has(m.id)).map((m) => m.name);
  const cells = (cellRows ?? []) as { fn: string; metric: string; value: number }[];
  const cellVal = (fn: string, metric: string) =>
    cells.find((c) => c.fn === fn && c.metric === metric)?.value ?? null;
  const VP_LANES = ["IGV", "IGTa", "IGTe", "OGV", "OGTa", "OGTe"];
  const vpLanes = VP_LANES.map((fn) => ({
    fn,
    filed: cells.some((c) => c.fn === fn),
  }));

  // ---------------------------------------------------------------- goals
  const opensActual = await laneOpensActual(monthFromIso, now.toISOString());
  // OGX "actual" approximates: sign-ups whose status is Approved and whose
  // last edit fell in this month (the status has no dated column of its own)
  const approvedInMonth = async (fn: "OGV" | "OGT") => {
    const { count } = await db()
      .from("signups")
      .select("id", { count: "exact", head: true })
      .eq("fn", fn)
      .eq("status", "Approved")
      .gte("last_edited_at", monthFromIso);
    return count ?? 0;
  };
  const [ogvApproved, ogtApproved] = await Promise.all([
    approvedInMonth("OGV"),
    approvedInMonth("OGT"),
  ]);
  const goals: TmStats["goals"] = [];
  const pushGoal = (fn: string, planned: number | null, actual: number, unit: string) => {
    if (planned !== null || actual > 0) goals.push({ fn, planned: planned ?? 0, actual, unit });
  };
  pushGoal("IGV", cellVal("IGV", "opens"), opensActual.IGV, "opens");
  pushGoal("IGTa", cellVal("IGTa", "opens"), opensActual.IGTa, "opens");
  pushGoal("IGTe", cellVal("IGTe", "opens"), opensActual.IGTe, "opens");
  pushGoal("OGV", cellVal("OGV", "approvals"), ogvApproved, "approvals");
  pushGoal(
    "OGT",
    (() => {
      const a = cellVal("OGTa", "approvals");
      const e = cellVal("OGTe", "approvals");
      return a === null && e === null ? null : (a ?? 0) + (e ?? 0);
    })(),
    ogtApproved,
    "approvals"
  );

  return {
    windowLabel: `last ${WINDOW_DAYS} days`,
    monthLabel: month.label,
    attendance: {
      sessions: recorded.length,
      owed,
      cancelled,
      rate: pct(attended + late, total),
      attended,
      late,
      absent,
      excused,
      byKind: [...byKindAgg.entries()].map(([kind, v]) => ({
        kind,
        sessions: v.sessions.size,
        rate: pct(v.showed, v.total),
      })),
      byFunction: [...byFnAgg.entries()]
        // working hours never judge TM/F&L/CXP — tiny samples there are noise
        .filter(([fn, v]) => v.total >= 3 || !NO_WORKING_HOURS_FUNCTIONS.includes(fn))
        .map(([fn, v]) => ({
          fn,
          rate: pct(v.showed, v.total),
          records: v.total,
          people: v.people.size,
        }))
        .sort((a, b) => b.records - a.records),
      byRole,
      byMember,
      lowMembers,
    },
    plans: {
      mmFiled: mmPlanners.length - mmMissing.length,
      mmTotal: mmPlanners.length,
      mmMissing: mmMissing.slice(0, 12),
      tlFiled: tlPlanners.length - tlMissing.length,
      tlTotal: tlPlanners.length,
      tlMissing: tlMissing.slice(0, 12),
      vpLanes,
    },
    goals,
    membersActive: members.length,
  };
}
