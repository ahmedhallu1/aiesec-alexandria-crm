import { NextRequest, NextResponse } from "next/server";
import { notifyMembers } from "@/server/notify";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { cairoToUtc } from "@/lib/time";
import { sendEmail } from "@/lib/google/gmail";
import { visitFollowupEmail } from "@/lib/email/templates";

export const dynamic = "force-dynamic";

/** Runs every 15 min (Supabase pg_cron). Exactly 2 hours after a visit's
 *  scheduled time, the responsible member gets a prompt to report whether the
 *  visit was completed, with a comment and next steps. */
export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const { data: pending, error } = await db()
    .from("visits")
    .select("*, account:accounts(id, name, out_of_process), member:members(id, name, nickname, email)")
    .is("done", null)
    .is("followup_prompt_sent_at", null)
    .limit(50);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const now = Date.now();
  const twoHours = 2 * 60 * 60 * 1000;
  let sent = 0;

  for (const visit of pending ?? []) {
    if (!visit.account || visit.account.out_of_process || !visit.member?.email) continue;
    const visitAt = cairoToUtc(visit.visit_date, visit.visit_time).getTime();
    if (now < visitAt + twoHours) continue;

    const mail = visitFollowupEmail({
      memberFirstName: visit.member.nickname || visit.member.name.split(" ")[0],
      accountName: visit.account.name,
      visitDate: visit.visit_date,
      visitTime: visit.visit_time,
      reportUrl: `${env.appUrl}/accounts/${visit.account.id}?report=${visit.id}`,
    });
    try {
      await sendEmail({ to: [visit.member.email], ...mail });
      await notifyMembers(
        [visit.member.id],
        "followup",
        `How did the visit to ${visit.account.name} go? 📝`,
        "Report it from the account page — your leaders get notified automatically."
      );
      await db()
        .from("visits")
        .update({ followup_prompt_sent_at: new Date().toISOString() })
        .eq("id", visit.id);
      sent += 1;
    } catch (e) {
      console.error(`[cron] follow-up for visit ${visit.id} failed:`, e);
    }
  }

  return NextResponse.json({ checked: pending?.length ?? 0, sent });
}
