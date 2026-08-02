import { button, detailsTable, emailLayout, escapeHtml } from "./templates";
import { env } from "@/lib/env";

/** ATTENDANCE emails (v29) — the nag ladder and the appeals.
 *  Recipients and CCs are decided by the caller; these are just the words. */

const attendanceUrl = (touchPointId?: string | null) =>
  `${env.appUrl}/attendance${touchPointId ? `?tp=${touchPointId}` : ""}`;

/** The reminder ladder: nag #1 is a nudge, #2 a poke, #3 the last word before
 *  the app starts asking on sight. */
export function attendanceDueEmail(opts: {
  label: string;
  whenLabel: string;
  audience: string;
  ownerName: string;
  /** 1-based: which reminder this is */
  reminder: number;
  touchPointId: string;
}) {
  const n = Math.max(1, opts.reminder);
  const heading =
    n === 1
      ? "Who showed up? 📝"
      : n === 2
        ? "Still no attendance record ⏳"
        : "Last reminder — then Elevate will ask on sight 🔔";
  const opener =
    n === 1
      ? `The <b>${escapeHtml(opts.label)}</b> is done — tell Elevate who was there. It takes a minute.`
      : n === 2
        ? `Second reminder: the <b>${escapeHtml(opts.label)}</b> still has no attendance record. Nobody's numbers move until it lands.`
        : `Third reminder. From now on Elevate will ask you for the <b>${escapeHtml(opts.label)}</b> record every time you open it — record it and it stops.`;

  return {
    subject:
      n === 1
        ? `📝 Record attendance — ${opts.label} (${opts.whenLabel})`
        : `⏳ Reminder ${n}: attendance still missing — ${opts.label}`,
    html: emailLayout({
      preheader: `${opts.label} on ${opts.whenLabel} is still waiting for its attendance record`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">${heading}</h1>
        <p>${opener}</p>
        ${detailsTable([
          ["What", opts.label],
          ["When", opts.whenLabel],
          ["Who", opts.audience],
          ["Booked by", opts.ownerName],
          ["Reminder", `#${n}`],
        ])}
        <p>Attended · Late · Absent — and a valid excuse where there is one. That's it.</p>
        ${button("Record it now", attendanceUrl(opts.touchPointId))}`,
    }),
  };
}

/** "I think this is wrong" — mailed to whoever recorded the row, TM on CC. */
export function attendanceAppealEmail(opts: {
  memberName: string;
  label: string;
  whenLabel: string;
  status: string;
  automatic: boolean;
  message: string;
  touchPointId: string;
}) {
  return {
    subject: `🙋 Attendance appeal — ${opts.memberName} · ${opts.label}`,
    html: emailLayout({
      preheader: `${opts.memberName} thinks their ${opts.label} attendance is wrong`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Someone says this one's wrong 🙋</h1>
        <p><b>${escapeHtml(opts.memberName)}</b> is appealing their attendance on the
        <b>${escapeHtml(opts.label)}</b>.</p>
        ${detailsTable([
          ["What", opts.label],
          ["When", opts.whenLabel],
          ["Recorded as", opts.status],
          ["Recorded by", opts.automatic ? "Elevate (automatic working hours)" : "You"],
          ["Their message", opts.message],
        ])}
        <p>Open the record, fix it if they're right, and mark the appeal resolved.
        TM is on copy.</p>
        ${button("Open the attendance record", attendanceUrl(opts.touchPointId))}`,
    }),
  };
}
