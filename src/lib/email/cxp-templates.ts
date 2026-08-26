import { env } from "@/lib/env";
import { button, emailLayout, escapeHtml, gridTable } from "./templates";
import type { CxpFunction } from "@/lib/cxp/types";

/** THE ECB SUBMISSION REMINDER — rebranded (v35).
 *
 *  This is the ONE email the old auditing system sent, and the only part of it
 *  the LC actually depends on today. It goes out the day before each ECB
 *  weekly deadline (the 5th / 12th / 19th / 26th), one message per function, to
 *  that function's VP plus the CXP Director of its side.
 *
 *  WHAT CHANGED: the frame. It arrived in a `#037EF3` box in Segoe UI, signed
 *  "Internal Auditing System · Directed by EB Iris · Made by Omar Eldeeb and
 *  Ahmed Hallul", sent from whichever Google account happened to hold the OAuth
 *  token. It now wears Sodio's own layout and goes out from Sodio's mailbox
 *  like every other system email.
 *
 *  WHAT DID NOT CHANGE: the subject line, the roster table and the ordering.
 *  VPs filter and search on that subject in production, so it is reproduced
 *  verbatim — em dash included. Complete EPs stay in the table on purpose: the
 *  VP reads it as a full roster with a status column, not as a to-do list.
 */
export function cxpSubmissionReminderEmail(opts: {
  function: CxpFunction;
  deadlineDate: string;
  epList: {
    epName: string;
    epOppId: string;
    missing: number;
    /** the split that tells a VP what is URGENT vs merely open (v35) */
    overdue?: number;
  }[];
  weeklyUrl: string;
  folderUrl?: string | null;
  zipUrl?: string | null;
}): { subject: string; html: string } {
  const epCount = opts.epList.length;
  // VERBATIM from the old system — do not reword, it is a saved Gmail filter
  const subject = `[ECB] ${opts.function} submission due ${opts.deadlineDate} — ${epCount} EP(s)`;

  const totalMissing = opts.epList.reduce((n, e) => n + e.missing, 0);
  const totalOverdue = opts.epList.reduce((n, e) => n + (e.overdue ?? 0), 0);

  const rows = opts.epList.map((e) => [
    e.epName,
    e.epOppId,
    e.missing === 0 ? "complete" : `${e.missing} missing`,
  ]);

  const action = opts.zipUrl
    ? `${button("Download the ZIP", opts.zipUrl)}
       <p style="margin:0 0 14px;color:#5c6b80;font-size:13px;">Extract it, review the documents, then submit to ECB.</p>`
    : `<p style="margin:14px 0;color:#5c6b80;font-size:13px;">No ZIP has been generated for this week yet — open the weekly board to build one, or use the Drive folder below.</p>
       ${button("Open the weekly board", opts.weeklyUrl)}`;

  return {
    subject,
    html: emailLayout({
      preheader: `${opts.function} · ${epCount} EP(s) · ${totalMissing} document(s) still missing before ${opts.deadlineDate}.`,
      body: `
        <h2 style="margin:0 0 4px;">${escapeHtml(opts.function)} · ECB submission</h2>
        <p style="margin:0 0 14px;color:#5c6b80;">Deadline <strong>${escapeHtml(opts.deadlineDate)}</strong> — that is tomorrow.</p>

        <p style="border-left:4px solid #7552CC;background:#EFEAFA;border-radius:0 8px 8px 0;padding:12px 16px;font-weight:600;margin:0 0 6px;">
          ${epCount} EP(s) in this weekly submission · ${totalMissing} document(s) still missing${
            totalOverdue > 0
              ? ` · <span style="color:#C0392B;">${totalOverdue} carried over from an earlier deadline</span>`
              : ""
          }
        </p>

        <p style="margin:20px 0 4px;font-size:13px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:#5B3BA8;">The roster</p>
        ${gridTable(["EP Name", "EP/OPP ID", "Documents"], rows)}

        ${action}

        ${
          opts.folderUrl
            ? `<p style="margin:14px 0 0;font-size:13px;">Weekly Drive folder: <a href="${opts.folderUrl}" style="color:#5B3BA8;">open in Drive</a></p>`
            : ""
        }
        <p style="margin:6px 0 0;font-size:13px;">Weekly board: <a href="${opts.weeklyUrl}" style="color:#5B3BA8;">${escapeHtml(opts.weeklyUrl)}</a></p>

        <p style="margin:18px 0 0;color:#5c6b80;font-size:13px;">
          Missing a level-4 or level-5 document — ID, passport, contract, visa &amp; entry stamp, flight tickets — costs the LC 150&nbsp;EGP each. Worth the ten minutes.
        </p>`,
    }),
  };
}

/** THE PER-DOCUMENT NUDGE (v35).
 *
 *  In the old system this was not an email at all: it was a Google Calendar
 *  event per (EP × requirement) whose reminder overrides fired Google's own
 *  notification at 10:00 on the day and 14:00 the day before. Those
 *  notifications are composed by Google, so they could never carry the LC's
 *  branding — which is exactly the complaint that started this migration.
 *
 *  This is the branded replacement: ONE DIGEST PER FUNCTION PER DAY, listing
 *  every document falling due, instead of N unbranded calendar pings. Not per
 *  person — CXP EPs carry no "responsible member" field, so the audience is
 *  the same one the submission reminder already uses: that function's VP(s)
 *  plus the CXP leadership of its side. The calendar events stay where they
 *  are; this rides alongside them.
 */
export function cxpDocumentDigestEmail(opts: {
  /** e.g. "IGV" — mirrors the submission reminder's subject so the same
   *  Gmail filter that catches one catches both */
  functionLabel: string;
  /** who this digest addresses — "IGV team", "the OGT crew" */
  audienceLabel: string;
  items: {
    function: CxpFunction;
    epName: string;
    epOppId: string;
    requirementName: string;
    dueDate: string | null;
    window: string | null;
    overdue: boolean;
  }[];
  epUrlFor: (epOppId: string) => string;
}): { subject: string; html: string } {
  // `overdue` on the item marks the DAY-OF touch (its due date is today) —
  // the urgent half of the two reminders the old calendar events sent. It is
  // not a running "still missing" tracker: a document nobody acted on simply
  // does not resurface after today, same as the calendar never re-fired.
  const dueToday = opts.items.filter((i) => i.overdue);
  const soon = opts.items.filter((i) => !i.overdue);

  const subject =
    dueToday.length > 0
      ? `[ECB] ${opts.functionLabel} — ${dueToday.length} due today, ${soon.length} due soon`
      : `[ECB] ${opts.functionLabel} — ${soon.length} document(s) due soon`;

  const section = (
    label: string,
    color: string,
    items: typeof opts.items
  ): string =>
    items.length === 0
      ? ""
      : `<p style="margin:20px 0 4px;font-size:13px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:${color};">${label}</p>
         ${gridTable(
           ["EP", "Document", "When"],
           items.map((i) => [
             `${i.epName} (${i.function})`,
             i.requirementName,
             i.window ?? i.dueDate ?? "—",
           ])
         )}`;

  return {
    subject,
    html: emailLayout({
      preheader: `${opts.items.length} ECB document(s) need collecting.`,
      body: `
        <h2 style="margin:0 0 4px;">Documents to collect</h2>
        <p style="margin:0 0 14px;color:#5c6b80;">Hi ${escapeHtml(opts.audienceLabel)} — here is what the ECB is waiting on today.</p>
        ${section("Due today", "#C0392B", dueToday)}
        ${section("Due soon", "#5B3BA8", soon)}
        ${button("Open CXP", `${env.appUrl}/cxp`)}
        <p style="margin:14px 0 0;color:#5c6b80;font-size:13px;">
          A document collected outside its window counts as incorrect, not late — the dates above are the whole point.
        </p>`,
    }),
  };
}
