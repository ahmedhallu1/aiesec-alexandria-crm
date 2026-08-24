import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/supabase";
import { env } from "@/lib/env";
import { sendEmail } from "@/lib/google/gmail";
import { periodReportEmail } from "@/lib/email/templates";
import { buildFunctionReport, buildOgxReport, markCronRun } from "@/server/data";
import { notifyMembers } from "@/server/notify";
import { resolveMemberSettings } from "@/lib/member-settings";

export const dynamic = "force-dynamic";

/** v21 — per-function period reports. **SPRINT AND MONTH ONLY** (v33.54 —
 *  quarters are gone: nobody steers a peak in three-month jumps, and the
 *  quarterly mail landed on the same morning as the month's saying much the
 *  same thing).
 *
 *  Checked DAILY; a report fires only on the morning after its period closed:
 *   - sprint:  on the 16th (sprint 1 = 1–15) and on the 1st (sprint 2 = 16–EOM)
 *   - month:   on the 1st (previous month)
 *  Reporting starts with the winter peak — periods before Aug 2026 are skipped.
 *  Every report carries the SAME numbers for the previous window of the same
 *  length in brackets, so a sprint reads as better or worse than the last one
 *  rather than as a number on its own.
 *
 *  ONE EMAIL PER FUNCTION — raising (IGV / IGT / B2B&BD) and, since v33.54,
 *  **OGX (OGT / OGV)**, which had no period report at all: their funnel is
 *  sign-ups, not accounts, so it gets its own builder. To the whole crew + the
 *  LCP, BCC'd; per-(kind,fn,period) idempotency via app_settings.
 *
 *  ?test=1 sends the CURRENT (unfinished) sprint's reports to the IM mailbox
 *  only — a preview, not counted as sent. */

const REPORT_START = "2026-08-01";
const FUNCTIONS: ("IGV" | "IGT" | "B2B")[] = ["IGV", "IGT", "B2B"];
/** the OGX sides — their own funnel, their own builder (v33.54) */
const OGX_FUNCTIONS: ("OGT" | "OGV")[] = ["OGT", "OGV"];

interface Due {
  kind: "sprint" | "month";
  start: string;
  end: string;
  label: string;
  /** the window of the SAME length immediately before this one */
  previous: { start: string; end: string } | null;
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
    // sprint 1 closed last night; the one before it is the PREVIOUS month's
    // sprint 2 (16–end), which is what "vs last sprint" has to mean
    const py = m0 === 0 ? y - 1 : y;
    const pm0 = m0 === 0 ? 11 : m0 - 1;
    due.push({
      kind: "sprint",
      start: `${y}-${pad(m0 + 1)}-01`,
      end: `${y}-${pad(m0 + 1)}-15`,
      label: `${MONTHS[m0]} ${y} · Sprint 1 (1–15)`,
      previous: {
        start: `${py}-${pad(pm0 + 1)}-16`,
        end: `${py}-${pad(pm0 + 1)}-${pad(eom(py, pm0))}`,
      },
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
      // the sprint before it is the same month's first half
      previous: { start: `${py}-${pad(pm0 + 1)}-01`, end: `${py}-${pad(pm0 + 1)}-15` },
    });
    const ppy = pm0 === 0 ? py - 1 : py;
    const ppm0 = pm0 === 0 ? 11 : pm0 - 1;
    due.push({
      kind: "month",
      start: `${py}-${pad(pm0 + 1)}-01`,
      end: `${py}-${pad(pm0 + 1)}-${pad(last)}`,
      label: `${MONTHS[pm0]} ${py}`,
      previous: {
        start: `${ppy}-${pad(ppm0 + 1)}-01`,
        end: `${ppy}-${pad(ppm0 + 1)}-${pad(eom(ppy, ppm0))}`,
      },
    });
  }
  // QUARTERS ARE GONE (v33.54) — see the note at the top of this file.
  return due
    .filter((d) => d.start >= REPORT_START)
    // a comparison that reaches back before the peak is another term's work
    .map((d) => (d.previous && d.previous.start < REPORT_START ? { ...d, previous: null } : d));
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
    previous: second
      ? { start: `${y}-${pad(m0 + 1)}-01`, end: `${y}-${pad(m0 + 1)}-15` }
      : null,
  };
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get("key") !== env.cronSecret || !env.cronSecret)
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const isTest = req.nextUrl.searchParams.get("test") === "1";
  const sent: string[] = [];
  const skipped: string[] = [];

  const periods = isTest ? [currentSprint(new Date())] : duePeriods(new Date());

  const targets: { fn: string; ogx: boolean }[] = [
    ...FUNCTIONS.map((fn) => ({ fn, ogx: false })),
    ...OGX_FUNCTIONS.map((fn) => ({ fn, ogx: true })),
  ];
  for (const period of periods) {
    for (const { fn, ogx } of targets) {
      const settingKey = `report:${period.kind}:${fn}:${period.start}`;
      try {
        if (!isTest) {
          const { data: already } = await db()
            .from("app_settings").select("key").eq("key", settingKey).maybeSingle();
          if (already) { skipped.push(`${settingKey} (already sent)`); continue; }
        }

        const report = ogx
          ? await buildOgxReport(fn as "OGT" | "OGV", period, period.kind, period.previous)
          : await buildFunctionReport(
              fn as "IGV" | "IGT" | "B2B",
              period,
              period.kind,
              period.previous
            );
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

        // WHO STILL WANTS THE EMAIL (v34.8). The report is resolved by
        // ADDRESS, so the opt-out has to be resolved by address too — the
        // bell below is unaffected either way, which is the point: the
        // numbers still reach everyone, just not always by inbox.
        const { data: crewRows } = await db()
          .from("members")
          .select("id, email, settings")
          .in("email", report.recipients);
        const crew = (crewRows ?? []) as {
          id: string; email: string | null; settings: unknown;
        }[];
        const optedOut = new Set(
          crew
            .filter((m) => resolveMemberSettings(m.settings).emailPeriodReports === false)
            .map((m) => (m.email ?? "").toLowerCase())
        );
        const mailTo = report.recipients.filter(
          (e) => !optedOut.has(e.toLowerCase())
        );

        if (mailTo.length > 0) {
          await sendEmail({
            to: [env.gmailSender],
            bcc: mailTo,
            ...mail,
          });
        }

        // bell for the crew too (link → dashboard) — everyone, always
        await notifyMembers(
          crew.map((m) => m.id),
          "report",
          `📊 ${report.functionLabel} ${period.kind} report is out`,
          period.label,
          null,
          "/dashboard"
        );

        await db().from("app_settings").upsert({
          key: settingKey,
          value: { sentAt: new Date().toISOString(), recipients: mailTo.length },
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
