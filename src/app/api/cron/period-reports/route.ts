import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { periodReportEmail } from "@/lib/email/templates";
import { buildFunctionReport, markCronRun } from "@/server/data";
import { notifyMembers } from "@/server/notify";

export const dynamic = "force-dynamic";

/** v21 — per-function period reports (sprint / month / quarter).
 *
 *  Checked DAILY; a report fires only on the morning after its period closed:
 *   - sprint:  on the 16th (sprint 1 = 1–15) and on the 1st (sprint 2 = 16–EOM)
 *   - month:   on the 1st (previous month)
 *   - quarter: on Feb/May/Aug/Nov 1st (previous term quarter)
 *  Reporting starts with the winter peak — periods before Aug 2026 are skipped.
 *  One email per function (IGV / IGT / B2B&BD) to the whole crew + the LCP,
 *  BCC'd; per-(kind,fn,period) idempotency via app_settings.
 *
 *  ?test=1 sends the CURRENT (unfinished) sprint's reports to the IM mailbox
 *  only — a preview, not counted as sent. */

const REPORT_START = "2026-08-01";
const FUNCTIONS: ("IGV" | "IGT" | "B2B")[] = ["IGV", "IGT", "B2B"];

interface Due {
  kind: "sprint" | "month" | "quarter";
  start: string;
  end: string;
  label: string;
}

const MONTHS = ["January","February","March","April","May","June",
  "July","August","September","October","November","December"];
const pad = (n: number) => String(n).padStart(2, "0");
const eom = (y: number, m0: number) => new Date(Date.UTC(y, m0 + 1, 0)).getUTCDate();

function duePeriods(now: Date): Due[] {
  const cairo = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const y = cairo.getFullYear(), m0 = cairo.getMonth(), day = cairo.getDate();
  const due: Due[] = [];

  if (day === 16) {
    due.push({
      kind: "sprint",
      start: `${y}-${pad(m0 + 1)}-01`,
      end: `${y}-${pad(m0 + 1)}-15`,
      label: `${MONTHS[m0]} ${y} · Sprint 1 (1–15)`,
    });
  }
  if (day === 1) {
    const py = m0 === 0 ? y - 1 : y;
    const pm0 = m0 === 0 ? 11 : m0 - 1;
    const last = eom(py, pm0);
    due.push({
      kind: "sprint",
      start: `${py}-${pad(pm0 + 1)}-16`,
      end: `${py}-${pad(pm0 + 1)}-${pad(last)}`,
      label: `${MONTHS[pm0]} ${py} · Sprint 2 (16–${last})`,
    });
    due.push({
      kind: "month",
      start: `${py}-${pad(pm0 + 1)}-01`,
      end: `${py}-${pad(pm0 + 1)}-${pad(last)}`,
      label: `${MONTHS[pm0]} ${py}`,
    });
    // term quarters start Feb/May/Aug/Nov → a quarter CLOSED when this month
    // is one of those (the previous 3 months formed it)
    if ([1, 4, 7, 10].includes(m0)) {
      const qStartM0 = (pm0 - 2 + 12) % 12;
      const qStartY = pm0 < 2 ? py - 1 : py;
      // term quarters: Q1 Feb-Apr · Q2 May-Jul · Q3 Aug-Oct · Q4 Nov-Jan.
      // m0 is the reporting month (1st) = the month AFTER the quarter closed:
      // May(4)→Q1 · Aug(7)→Q2 · Nov(10)→Q3 · Feb(1)→Q4.
      const qNum = { 4: "Q1", 7: "Q2", 10: "Q3", 1: "Q4" }[m0] ?? "Q";
      due.push({
        kind: "quarter",
        start: `${qStartY}-${pad(qStartM0 + 1)}-01`,
        end: `${py}-${pad(pm0 + 1)}-${pad(last)}`,
        label: `${qNum} (${MONTHS[qStartM0].slice(0, 3)}–${MONTHS[pm0].slice(0, 3)} ${py})`,
      });
    }
  }
  return due.filter((d) => d.start >= REPORT_START);
}

/** The current (possibly unfinished) sprint — for ?test=1 previews. */
function currentSprint(now: Date): Due {
  const cairo = new Date(now.toLocaleString("en-US", { timeZone: "Africa/Cairo" }));
  const y = cairo.getFullYear(), m0 = cairo.getMonth();
  const second = cairo.getDate() > 15;
  const last = eom(y, m0);
  return {
    kind: "sprint",
    start: `${y}-${pad(m0 + 1)}-${second ? "16" : "01"}`,
    end: `${y}-${pad(m0 + 1)}-${second ? pad(last) : "15"}`,
    label: `${MONTHS[m0]} ${y} · Sprint ${second ? 2 : 1} — LIVE PREVIEW`,
  };
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isTest = req.nextUrl.searchParams.get("test") === "1";
  const sent: string[] = [];
  const skipped: string[] = [];

  const periods = isTest ? [currentSprint(new Date())] : duePeriods(new Date());

  for (const period of periods) {
    for (const fn of FUNCTIONS) {
      const settingKey = `report:${period.kind}:${fn}:${period.start}`;
      try {
        if (!isTest) {
          const { data: already } = await db()
            .from("app_settings").select("key").eq("key", settingKey).maybeSingle();
          if (already) { skipped.push(`${settingKey} (already sent)`); continue; }
        }

        const report = await buildFunctionReport(fn, period, period.kind);
        if (!report) { skipped.push(`${settingKey} (no crew)`); continue; }

        const mail = periodReportEmail({
          functionLabel: report.functionLabel,
          periodKind: period.kind,
          periodLabel: period.label,
          kpis: report.kpis,
          planLine: report.planLine,
          waterfallHeaders: report.waterfallHeaders,
          waterfallRows: report.waterfallRows,
          boldRows: report.boldRows,
          indentRows: report.indentRows,
          mmPlanLines: report.mmPlanLines,
          dashboardUrl: `${env.appUrl}/dashboard`,
        });

        if (isTest) {
          // preview goes ONLY to the IM mailbox
          await sendEmail({
            to: [env.gmailSender],
            ...mail,
            subject: `[TEST] ${mail.subject}`,
          });
          sent.push(`${settingKey} → TEST to ${env.gmailSender}`);
          continue;
        }

        await sendEmail({
          to: [env.gmailSender],
          bcc: report.recipients,
          ...mail,
        });

        // bell for the crew too (link → dashboard)
        const { data: crewRows } = await db()
          .from("members")
          .select("id, email")
          .in("email", report.recipients);
        await notifyMembers(
          (crewRows ?? []).map((m) => m.id),
          "report",
          `📊 ${report.functionLabel} ${period.kind} report is out`,
          period.label,
          null,
          "/dashboard"
        );

        await db().from("app_settings").upsert({
          key: settingKey,
          value: { sentAt: new Date().toISOString(), recipients: report.recipients.length },
          updated_at: new Date().toISOString(),
        });
        sent.push(settingKey);
      } catch (e) {
        console.error(`[period-reports] ${settingKey} failed:`, e);
        skipped.push(`${settingKey} (error)`);
      }
    }
  }

  await markCronRun("period-reports");
  return NextResponse.json({ ok: true, sent, skipped });
}
