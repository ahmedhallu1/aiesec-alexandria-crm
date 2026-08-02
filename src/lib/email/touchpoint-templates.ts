import { button, detailsTable, emailLayout, escapeHtml } from "./templates";
import { env } from "@/lib/env";

/** TM touch-point emails (v29). Every one carries the TM VP on CC — that
 *  wiring lives in the action; these are just the words. */

interface Base {
  label: string;
  whenLabel: string;
  audience: string;
  ownerName: string;
  note?: string | null;
}

export function touchPointInviteEmail(opts: Base) {
  return {
    subject: `📅 ${opts.label} — ${opts.whenLabel}`,
    html: emailLayout({
      preheader: `${opts.ownerName} booked a ${opts.label.toLowerCase()} for ${opts.audience}`,
      body: `
        <h1 style="margin:0 0 16px;font-size:20px;color:#0A2540;">You're expected 📅</h1>
        <p><b>${escapeHtml(opts.ownerName)}</b> booked a <b>${escapeHtml(opts.label)}</b>
        for ${escapeHtml(opts.audience)}.</p>
        ${detailsTable([
          ["What", opts.label],
          ["When", opts.whenLabel],
          ["Who", opts.audience],
          ["Booked by", opts.ownerName],
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
          ["Booked by", opts.ownerName],
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
        ${detailsTable([
          ["Reason", opts.reason],
          ["Cancelled by", opts.ownerName],
        ])}
        <p style="margin-bottom:0;">Nothing to attend — your calendar is clear.</p>`,
    }),
  };
}
