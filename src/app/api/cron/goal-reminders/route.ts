import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { goalPeriodEndedEmail } from "@/lib/email/templates";
import { notifyMembers } from "@/server/notify";

export const dynamic = "force-dynamic";

interface GoalRow {
  id: string;
  scope: "function" | "team";
  function: string | null; // IGV / IGTa / IGTe lane
  team_leader_id: string | null;
  target: number;
  period_label: string;
  period_start: string;
  period_end: string;
}

interface MemberLite {
  id: string;
  name: string;
  nickname: string | null;
  email: string;
  role: string;
  functions: string[] | null;
  stakeholder_id: string | null;
  team_name: string | null;
  is_active: boolean;
}

/** Achieved slots for a lane goal = the per-product opens signed inside the
 *  period (B2B and cross-product deals count toward their lanes, exactly like
 *  the dashboard). */
async function laneAchieved(lane: string, from: string, to: string): Promise<number> {
  const col = lane === "IGV" ? "slots_igv" : lane === "IGTa" ? "slots_igta" : "slots_igte";
  const { data } = await db()
    .from("deals")
    .select(col)
    .gte("created_at", `${from}T00:00:00Z`)
    .lte("created_at", `${to}T23:59:59Z`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).reduce((sum, d) => sum + (d[col] ?? 0), 0);
}

/** Achieved slots for a team goal = deals whose responsible is the TL or one
 *  of their direct reports (same rollup as the dashboard's team progress). */
async function teamAchieved(
  teamIds: string[],
  from: string,
  to: string
): Promise<number> {
  if (teamIds.length === 0) return 0;
  const { data } = await db()
    .from("deals")
    .select("slots, member_id")
    .in("member_id", teamIds)
    .gte("created_at", `${from}T00:00:00Z`)
    .lte("created_at", `${to}T23:59:59Z`);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return ((data ?? []) as any[]).reduce((sum, d) => sum + (d.slots ?? 0), 0);
}

/** Runs daily (Supabase pg_cron). For every goal whose period has ENDED with
 *  no reminder yet and no successor goal in place, emails the goal's owners —
 *  the lane's VPs/Directors (the MMs' leaders) for function goals, the Team
 *  Leader for team goals — with last period's goal vs achieved and a button
 *  to set the new goal. Sent once per goal. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const { data: ended, error } = await db()
    .from("performance_goals")
    .select("id, scope, function, team_leader_id, target, period_label, period_start, period_end")
    .lt("period_end", today)
    .is("ended_reminder_sent_at", null)
    .limit(50);
  if (error) {
    const friendly = error.message.includes("ended_reminder_sent_at")
      ? "Goal reminders need migration 0012 — run it in the Supabase SQL editor."
      : error.message;
    return NextResponse.json({ error: friendly }, { status: 500 });
  }
  if (!ended?.length) return NextResponse.json({ checked: 0, sent: 0 });

  const { data: membersData } = await db()
    .from("members")
    .select("id, name, nickname, email, role, functions, stakeholder_id, team_name, is_active")
    .eq("is_active", true);
  const members = (membersData ?? []) as MemberLite[];

  const markSent = (id: string) =>
    db()
      .from("performance_goals")
      .update({ ended_reminder_sent_at: new Date().toISOString() })
      .eq("id", id);

  const twoWeeksAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 10);

  let sent = 0;
  for (const goal of ended as GoalRow[]) {
    try {
      // ancient history (first deploy of this cron) — mark silently, no email
      if (goal.period_end < twoWeeksAgo) {
        await markSent(goal.id);
        continue;
      }

      // a successor goal already covers today → nothing to remind about
      let successor = db()
        .from("performance_goals")
        .select("id")
        .eq("scope", goal.scope)
        .lte("period_start", today)
        .gte("period_end", today)
        .limit(1);
      successor =
        goal.scope === "function"
          ? successor.eq("function", goal.function!)
          : successor.eq("team_leader_id", goal.team_leader_id!);
      const { data: next } = await successor.maybeSingle();
      if (next) {
        await markSent(goal.id);
        continue;
      }

      // owners + achieved, per scope
      let owners: MemberLite[] = [];
      let scopeLabel = "";
      let achieved = 0;
      let setGoalUrl = env.appUrl;

      if (goal.scope === "function" && goal.function) {
        const parentFn = goal.function === "IGV" ? "IGV" : "IGT";
        owners = members.filter(
          (m) =>
            (m.role === "LCVP" || m.role === "Director") &&
            (m.functions ?? []).includes(parentFn)
        );
        scopeLabel = `${goal.function} lane`;
        achieved = await laneAchieved(goal.function, goal.period_start, goal.period_end);
        setGoalUrl = `${env.appUrl}/?fn=${goal.function}`;
      } else if (goal.scope === "team" && goal.team_leader_id) {
        const tl = members.find((m) => m.id === goal.team_leader_id);
        if (tl) {
          owners = [tl];
          const teamIds = [
            tl.id,
            ...members.filter((m) => m.stakeholder_id === tl.id).map((m) => m.id),
          ];
          scopeLabel = tl.team_name ? `Team ${tl.team_name}` : `Team ${tl.nickname || tl.name}`;
          achieved = await teamAchieved(teamIds, goal.period_start, goal.period_end);
        }
      }

      if (owners.length === 0) {
        await markSent(goal.id);
        continue;
      }

      const mail = goalPeriodEndedEmail({
        scopeLabel,
        periodLabel: goal.period_label,
        target: goal.target,
        achieved,
        setGoalUrl,
      });
      await sendEmail({ to: owners.map((o) => o.email), ...mail });
      await notifyMembers(
        owners.map((o) => o.id),
        "info",
        `🎯 ${goal.period_label} ended — set the new ${scopeLabel} goal`,
        `Last period: ${achieved}/${goal.target} slots. Set the new goal so the dashboards show it.`,
        null,
        goal.scope === "function" ? `/?fn=${goal.function}` : "/"
      );
      await markSent(goal.id);
      sent += 1;
    } catch (e) {
      console.error(`[cron] goal reminder for ${goal.id} failed:`, e);
    }
  }

  return NextResponse.json({ checked: ended.length, sent });
}
