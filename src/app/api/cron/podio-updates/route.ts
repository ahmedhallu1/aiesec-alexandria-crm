import { NextRequest, NextResponse } from "next/server";
import { notifyMembers } from "@/server/notify";
import { markCronRun } from "@/server/data";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { podioUpdateDueEmail } from "@/lib/email/templates";
import { accountSlug, B2C_DEFAULT_UPDATE_DAYS } from "@/lib/types";

export const dynamic = "force-dynamic";

interface B2cRow {
  id: string;
  name: string;
  created_at: string;
  podio_update_every_days: number | null;
  podio_updated_at: string | null;
  podio_update_notified_at: string | null;
  responsible: {
    id: string;
    name: string;
    nickname: string | null;
    email: string;
    is_active: boolean;
  } | null;
}

/** B2C accounts live on Podio and must be refreshed every N days (v23).
 *  Daily: for every ACTIVE B2C account whose refresh date has arrived, ping
 *  the responsible MM + the B2C VP/Director — bell + email, ONCE per cycle
 *  (podio_update_notified_at; marking "Updated on Podio" clears it). */
export async function GET(req: NextRequest) {
  if (!env.cronSecret || req.nextUrl.searchParams.get("key") !== env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const [accountsRes, leadersRes] = await Promise.all([
    db()
      .from("accounts")
      .select(
        "id, name, created_at, podio_update_every_days, podio_updated_at, podio_update_notified_at, " +
          "responsible:members!accounts_responsible_id_fkey(id, name, nickname, email, is_active)"
      )
      .eq("function", "B2C")
      .eq("out_of_process", false)
      .eq("is_test", false),
    // the B2C VP/Director — the label may live in sub_functions only
    db()
      .from("members")
      .select("id, name, nickname, email, role, functions, sub_functions")
      .eq("is_active", true)
      .in("role", ["LCVP", "Director"]),
  ]);
  if (accountsRes.error || leadersRes.error) {
    const detail = accountsRes.error?.message ?? leadersRes.error?.message;
    console.error("[podio-updates] query failed:", detail);
    return NextResponse.json({ ok: false, error: detail }, { status: 500 });
  }
  const accountsData = accountsRes.data;
  const leadersData = leadersRes.data;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const leaders = ((leadersData ?? []) as any[]).filter(
    (m) =>
      (m.functions ?? []).includes("B2C") || (m.sub_functions ?? []).includes("B2C")
  );

  const now = new Date();
  const sent: string[] = [];
  const errors: string[] = [];

  for (const a of (accountsData ?? []) as unknown as B2cRow[]) {
    const every = a.podio_update_every_days ?? B2C_DEFAULT_UPDATE_DAYS;
    const anchor = new Date(a.podio_updated_at ?? a.created_at);
    const due = new Date(anchor.getTime() + every * 24 * 60 * 60 * 1000);
    if (now < due) continue; // countdown still running
    // one reminder per cycle: skip if we already nagged after this due date
    if (a.podio_update_notified_at && new Date(a.podio_update_notified_at) >= due) continue;

    const daysOverdue = Math.floor((now.getTime() - due.getTime()) / (24 * 60 * 60 * 1000));
    const url = `${env.appUrl}/accounts/${accountSlug(a.name)}`;
    const responsible = a.responsible && a.responsible.is_active ? a.responsible : null;

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
        `🔄 Update "${a.name}" on Podio`,
        daysOverdue > 0
          ? `${daysOverdue} day${daysOverdue === 1 ? "" : "s"} overdue — refresh it, then mark it updated.`
          : `The ${every}-day refresh is due today — update it, then mark it updated.`,
        null,
        `/accounts/${accountSlug(a.name)}`
      );

      if (recipientEmails.length > 0) {
        const mail = podioUpdateDueEmail({
          accountName: a.name,
          everyDays: every,
          daysOverdue,
          responsibleName: responsible ? responsible.nickname || responsible.name : null,
          accountUrl: url,
        });
        await sendEmail({ to: [...new Set(recipientEmails)], ...mail });
      }

      await db()
        .from("accounts")
        .update({ podio_update_notified_at: now.toISOString() })
        .eq("id", a.id);
      sent.push(a.name);
    } catch (e) {
      errors.push(`${a.name}: ${e instanceof Error ? e.message : e}`);
    }
  }

  await markCronRun("podio-updates");
  return NextResponse.json({ ok: true, sent, errors });
}
