import { button, detailsTable, emailLayout, escapeHtml } from "./templates";
import { env } from "@/lib/env";

/** TM touch-point emails (v29). Every one carries the TM VP on CC — that
 *  wiring lives in the action; these are just the words.
 *
 *  WHO BOOKED IT IS NOT NEWS (v33.43, by the LCP's request): the audience
 *  needs the what, the when and the where. The owner is still recorded on the
 *  touch point and still records attendance — they just aren't announced. */

interface Base {
  label: string;
  whenLabel: string;
  audience: string;
  /** v33.43 — where it happens, when it isn't virtual */
  location?: string | null;
  note?: string | null;
}

export function touchPointInviteEmail(opts: Base) {
  return {
    subject: `📅 ${opts.label} — ${opts.whenLabel}`,
    html: emailLayout({
      preheader: `A ${opts.label.toLowerCase()} for ${opts.audience} — ${opts.whenLabel}`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">You're expected 📅</h1>
        <p>There's a <b>${escapeHtml(opts.label)}</b> for ${escapeHtml(opts.audience)}.</p>
        ${detailsTable([
          ["What", opts.label],
          ["When", opts.whenLabel],
          ["Who", opts.audience],
          ["Where", opts.location ?? null],
          ["Note", opts.note ?? null],
        ])}
        <p>Attendance is taken afterwards — being there is the whole point. 💙</p>
        ${button("See it on your calendar", `${env.appUrl}/calendar`)}`,
    }),
  };
}

export function touchPointMovedEmail(opts: Base & { previousWhen: string }) {
  return {
    subject: `🔁 Moved: ${opts.label} — now ${opts.whenLabel}`,
    html: emailLayout({
      preheader: `${opts.label} moved from ${opts.previousWhen} to ${opts.whenLabel}`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">New time 🔁</h1>
        <p>The <b>${escapeHtml(opts.label)}</b> for ${escapeHtml(opts.audience)} moved.</p>
        ${detailsTable([
          ["What", opts.label],
          ["Was", opts.previousWhen],
          ["Now", opts.whenLabel],
          ["Where", opts.location ?? null],
          ["Note", opts.note ?? null],
        ])}
        ${button("See it on your calendar", `${env.appUrl}/calendar`)}`,
    }),
  };
}

export function touchPointCancelledEmail(opts: Base & { reason: string }) {
  return {
    subject: `❌ Cancelled: ${opts.label} (${opts.whenLabel})`,
    html: emailLayout({
      preheader: `${opts.label} on ${opts.whenLabel} is cancelled`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">Cancelled ❌</h1>
        <p>The <b>${escapeHtml(opts.label)}</b> for ${escapeHtml(opts.audience)} on
        <b>${escapeHtml(opts.whenLabel)}</b> is off.</p>
        ${detailsTable([["Reason", opts.reason]])}
        <p style="margin-bottom:0;">Nothing to attend — your calendar is clear.</p>`,
    }),
  };
}

/** SOMEONE SAID IN ADVANCE (v33.43). An excuse filed before the session is
 *  worth more than one written after it: it reaches TM while the room can
 *  still be planned, and it lands on the attendance sheet as excused. */
export function touchPointExcuseEmail(opts: {
  memberName: string;
  label: string;
  whenLabel: string;
  audience: string;
  /** "absent" | "late" */
  status: string;
  excuse: string;
}) {
  const heading = opts.status === "late" ? "Running late ⏰" : "Can't make it 🙏";
  return {
    subject: `${opts.status === "late" ? "⏰" : "🙏"} ${opts.memberName} — ${opts.label} (${opts.whenLabel})`,
    html: emailLayout({
      preheader: `${opts.memberName} told us in advance about ${opts.label}`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">${heading}</h1>
        <p><b>${escapeHtml(opts.memberName)}</b> let us know
        ${opts.status === "late" ? "they will arrive late to" : "they can't attend"}
        the <b>${escapeHtml(opts.label)}</b>.</p>
        ${detailsTable([
          ["Who", opts.memberName],
          ["What", opts.label],
          ["When", opts.whenLabel],
          ["Audience", opts.audience],
          ["Reason", opts.excuse],
        ])}
        <p style="margin-bottom:0;">It is already on the attendance sheet as
        <b>${escapeHtml(opts.status)} — excused</b>; whoever records the session
        can still change it.</p>`,
    }),
  };
}
