import { NextRequest, NextResponse } from "next/server";
import { notifyMembers } from "@/server/notify";
import { markCronRun } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { podioUpdateDueEmail } from "@/lib/email/templates";
import { accountSlug, podioDefaultDays, type AccountFunction } from "@/lib/types";

export const dynamic = "force-dynamic";

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

interface PodioRow {
  id: string;
  name: string;
  function: AccountFunction;
  created_at: string;
  podio_update_every_days: number | null;
  podio_updated_at: string | null;
  podio_update_notified_at: string | null;
  podio_update_second_notified_at: string | null;
  responsible: {
    id: string;
    name: string;
    email: string;
    is_active: boolean;
  } | null;
}

/** Which VP/Director "owns" reminders for an account of this function.
 *  BD accounts belong to the B2B&BD crew (either label counts). */
function leaderMatches(
  m: { functions?: string[] | null; sub_functions?: string[] | null },
  fn: AccountFunction
): boolean {
  const all = [...(m.functions ?? []), ...(m.sub_functions ?? [])];
  if (fn === "BD" || fn === "B2B") return all.includes("B2B") || all.includes("BD");
  return all.includes(fn);
}

/** Continuous Podio updates (v23 B2C → v24 every function that opts in).
 *  Daily: for every ACTIVE account with the feature ON whose refresh date has
 *  arrived, ping the responsible + the function's VP/Director — bell + email,
 *  ONCE per cycle (podio_update_notified_at). A week after that first nag with
 *  still no update, a SECOND, firmer reminder goes out — also once per cycle
 *  (podio_update_second_notified_at; "Updated on Podio" clears both). */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // every enabled account — paged past Supabase's 1000-row response cap
  // (new IGV/B2C/BD accounts default ON, so this set will keep growing)
  const accountsData: unknown[] = [];
  {
    const PAGE = 1000;
    for (let off = 0; off < 30000; off += PAGE) {
      const { data, error } = await db()
        .from("accounts")
        .select(
          "id, name, function, created_at, podio_update_every_days, podio_updated_at, " +
            "podio_update_notified_at, podio_update_second_notified_at, " +
            "responsible:members!accounts_responsible_id_fkey(id, name, email, is_active)"
        )
        .eq("podio_update_enabled", true)
        .eq("out_of_process", false)
        .eq("is_test", false)
        .order("created_at")
        .order("id")
        .range(off, off + PAGE - 1);
      if (error) {
        console.error("[podio-updates] accounts query failed:", error.message);
        return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
      }
      accountsData.push(...(data ?? []));
      if ((data ?? []).length < PAGE) break;
    }
  }
  // VPs/Directors — the function label may live in sub_functions only
  const leadersRes = await db()
    .from("members")
    .select("id, name, email, role, functions, sub_functions")
    .eq("is_active", true)
    .in("role", ["LCVP", "Director"]);
  if (leadersRes.error) {
    console.error("[podio-updates] leaders query failed:", leadersRes.error.message);
    return NextResponse.json({ ok: false, error: leadersRes.error.message }, { status: 500 });
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allLeaders = (leadersRes.data ?? []) as any[];

  const now = new Date();
  const sent: string[] = [];
  const errors: string[] = [];

  for (const a of accountsData as PodioRow[]) {
    const every = a.podio_update_every_days ?? podioDefaultDays(a.function);
    const anchor = new Date(a.podio_updated_at ?? a.created_at);
    const due = new Date(anchor.getTime() + every * DAY_MS);
    if (now < due) continue; // countdown still running

    const firstAt =
      a.podio_update_notified_at && new Date(a.podio_update_notified_at) >= due
        ? new Date(a.podio_update_notified_at)
        : null;
    // pass 1: the cycle's first reminder. pass 2: a week after it, firmer.
    let pass: 1 | 2;
    if (!firstAt) pass = 1;
    else if (
      now.getTime() - firstAt.getTime() >= WEEK_MS &&
      !(a.podio_update_second_notified_at && new Date(a.podio_update_second_notified_at) >= due)
    )
      pass = 2;
    else continue; // already nagged this cycle

    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / DAY_MS);
    const url = `${env.appUrl}/accounts/${accountSlug(a.name)}`;
    const responsible = a.responsible && a.responsible.is_active ? a.responsible : null;
    const leaders = allLeaders.filter((m) => leaderMatches(m, a.function));

    try {
      const recipientIds = [
        ...(responsible ? [responsible.id] : []),
        ...leaders.map((l) => l.id),
      ];
      const recipientEmails = [
        ...(responsible?.email ? [responsible.email] : []),
        ...leaders.map((l) => l.email).filter(Boolean),
      ];

      await notifyMembers(
        [...new Set(recipientIds)],
        "podio_update",
        pass === 2
          ? `⏰ Still not updated on Podio — "${a.name}"`
          : `🔄 Update "${a.name}" on Podio`,
        pass === 2
          ? `Reminded a week ago and still pending (${daysOverdue} days overdue) — refresh it now, then mark it updated.`
          : daysOverdue > 0
            ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue — refresh it, then mark it updated.`
            : `The ${every}-day refresh is due today — update it, then mark it updated.`,
        null,
        `/accounts/${accountSlug(a.name)}`
      );

      if (recipientEmails.length > 0) {
        const mail = podioUpdateDueEmail({
          accountName: a.name,
          accountFunction: a.function,
          everyDays: every,
          daysOverdue,
          responsibleName: responsible ? responsible.name : null,
          accountUrl: url,
          secondReminder: pass === 2,
        });
        await sendEmail({ to: [...new Set(recipientEmails)], ...mail });
      }

      const { error: stampError } = await db()
        .from("accounts")
        .update(
          pass === 2
            ? { podio_update_second_notified_at: now.toISOString() }
            : { podio_update_notified_at: now.toISOString() }
        )
        .eq("id", a.id);
      // an unstamped nag would re-send daily — surface it instead
      if (stampError) throw new Error(`stamp failed: ${stampError.message}`);
      sent.push(`${a.name}${pass === 2 ? " (2nd)" : ""}`);
    } catch (e) {
      errors.push(`${a.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  await markCronRun("podio-updates");
  return NextResponse.json({ ok: true, sent, errors });
}
