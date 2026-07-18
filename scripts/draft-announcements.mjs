#!/usr/bin/env node
/**
 * Draft the Sodio launch announcement emails — ONE personalized DRAFT per
 * active member, created in the IM mailbox (GMAIL_SENDER) so Ahmed can review
 * and send them by hand. NOTHING is sent by this script; it only creates
 * Gmail drafts.
 *
 * Two flavors, decided by the SAME rule the app uses to unlock the Raising
 * module (rbac.ts → hasRaisingAccess):
 *   • "launch"     — the member's module is LIVE (IGV raising, IGT raising,
 *                    B2B/BD, or the LCP): a funny, role/function/level-tailored
 *                    tour of what's now theirs + The Blue Man hype.
 *   • "stay-tuned" — module not built yet (TM, OGX, F&L, B2C, CXP, no-module):
 *                    a short "yours is coming" teaser.
 * Content differs per (role, function, level). The sender (Ahmed) is skipped.
 *
 * Usage (from the repo root or the worktree — it finds .env.local by walking up):
 *   node scripts/draft-announcements.mjs --dry     # print the plan, create nothing
 *   node scripts/draft-announcements.mjs           # create the drafts
 *   node scripts/draft-announcements.mjs --only=igv-vp,lcp   # subset by segment key
 *
 * Reads AUTH_GOOGLE_ID / AUTH_GOOGLE_SECRET / GMAIL_REFRESH_TOKEN / GMAIL_SENDER
 * / GMAIL_SENDER_NAME / SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / ADMIN_EMAILS
 * / NEXT_PUBLIC_APP_URL from .env.local. Secrets are only READ, never printed.
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const DRY = process.argv.includes("--dry");
const EMIT = (process.argv.find((a) => a.startsWith("--emit=")) || "").replace("--emit=", "");
const ONLY = (process.argv.find((a) => a.startsWith("--only=")) || "")
  .replace("--only=", "")
  .split(",")
  .filter(Boolean);

// ── env: walk up from this file until we find .env.local ────────────────────
function findEnv() {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    const p = join(dir, ".env.local");
    if (existsSync(p)) return p;
    const up = dirname(dir);
    if (up === dir) break;
    dir = up;
  }
  return null;
}
const envPath = findEnv();
const ENV = {};
if (envPath) {
  for (const line of readFileSync(envPath, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) ENV[m[1]] = m[2].replace(/^"|"$/g, "").trim();
  }
}
const get = (k) => process.env[k] || ENV[k] || "";

const CLIENT_ID = get("AUTH_GOOGLE_ID");
const CLIENT_SECRET = get("AUTH_GOOGLE_SECRET");
const REFRESH = get("GMAIL_REFRESH_TOKEN");
const SENDER = get("GMAIL_SENDER");
const SENDER_NAME = get("GMAIL_SENDER_NAME") || "Sodio · AIESEC in Alexandria";
const SUPA_URL = get("SUPABASE_URL");
const SUPA_KEY = get("SUPABASE_SERVICE_ROLE_KEY");
const APP_URL = (get("NEXT_PUBLIC_APP_URL") || "https://aiesec-alexandria-crm.vercel.app").replace(/\/$/, "");
const ADMINS = get("ADMIN_EMAILS").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);

for (const [k, v] of [["AUTH_GOOGLE_ID", CLIENT_ID], ["AUTH_GOOGLE_SECRET", CLIENT_SECRET], ["SUPABASE_URL", SUPA_URL], ["SUPABASE_SERVICE_ROLE_KEY", SUPA_KEY]]) {
  if (!v) { console.error(`✖ Missing ${k} in .env.local (${envPath || "not found"})`); process.exit(1); }
}
if (!DRY && !REFRESH) { console.error("✖ Missing GMAIL_REFRESH_TOKEN — needed to create drafts (use --dry to preview)."); process.exit(1); }

// ── mirror of rbac.ts classification ────────────────────────────────────────
const hitB2B = (m) => ["B2B", "BD"].some((x) => (m.functions || []).includes(x) || (m.sub_functions || []).includes(x));
const icxFns = (m) => (m.functions || []).filter((f) => f === "IGV" || f === "IGT");
const scopeFns = (m) => { const f = icxFns(m); if (f.length || hitB2B(m)) f.push("B2B", "BD"); return [...new Set(f)]; };
const isMaster = (m) => m.role === "LCP" || ADMINS.includes((m.email || "").toLowerCase());
const isIcxLead = (m) => (m.role === "LCVP" || m.role === "Director") && scopeFns(m).length > 0;
const hasRaising = (m) =>
  isMaster(m) || isIcxLead(m) || hitB2B(m) ||
  (icxFns(m).length > 0 && (m.sub_functions || []).some((s) => s === "Raising" || s === "ICX"));

/** The segment key drives which body a member gets. */
function segmentOf(m) {
  if (isMaster(m)) return "lcp";
  if (hitB2B(m)) return m.role === "Director" || m.role === "LCVP" ? "b2b-lead" : m.role === "Team Leader" ? "b2b-tl" : "b2b-member";
  const igv = icxFns(m).includes("IGV"), igt = icxFns(m).includes("IGT");
  if (hasRaising(m)) {
    const fn = igv && igt ? "icx" : igv ? "igv" : "igt";
    if (m.role === "LCVP" || m.role === "Director") return `${fn}-vp`;
    if (m.role === "Team Leader") return `${fn}-tl`;
    return `${fn}-member`;
  }
  // stay-tuned, function-aware
  const fnl = [...(m.functions || []), ...(m.sub_functions || [])];
  if (fnl.includes("TM")) return "soon-tm";
  if (fnl.some((f) => ["OGV", "OGT", "OGX"].includes(f))) return "soon-ogx";
  if (fnl.some((f) => ["F&L"].includes(f))) return "soon-fl";
  if (fnl.some((f) => ["B2C"].includes(f))) return "soon-b2c";
  if (fnl.some((f) => ["CXP"].includes(f))) return "soon-cxp";
  return "soon-generic";
}
const isLaunch = (seg) => !seg.startsWith("soon-");

// ── branded email shell (self-contained copy of email/templates.ts) ─────────
function layout(preheader, bodyHtml) {
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background-color:#eef3fa;font-family:'Segoe UI',Arial,Helvetica,sans-serif;">
${preheader ? `<div style="display:none;max-height:0;overflow:hidden;">${preheader}</div>` : ""}
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#eef3fa;padding:28px 12px;"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
<tr><td style="background-color:#0A2540;background-image:linear-gradient(135deg,#0A2540 0%,#0d3a6e 60%,#037EF3 140%);border-radius:16px 16px 0 0;padding:26px 32px;">
<span style="color:#ffffff;font-size:21px;font-weight:800;letter-spacing:0.5px;">AIESEC <span style="color:#5db4ff;">in Alexandria</span></span>
<span style="float:right;color:#9db8d4;font-size:12px;padding-top:8px;letter-spacing:1px;">SODIO</span></td></tr>
<tr><td style="height:4px;background-image:linear-gradient(90deg,#037EF3,#0CB9C1 45%,#F48924 75%,#F85A40);font-size:0;line-height:0;">&nbsp;</td></tr>
<tr><td style="background-color:#ffffff;padding:32px;border-radius:0 0 16px 16px;color:#0A2540;font-size:15px;line-height:1.65;">${bodyHtml}</td></tr>
<tr><td style="padding:20px 32px;color:#5c6b80;font-size:12px;text-align:center;line-height:1.7;">
Sodio · AIESEC in Alexandria · <a href="${APP_URL}" style="color:#037EF3;text-decoration:none;font-weight:bold;">Open the CRM</a><br>
<span style="color:#93a5bc;">Built for you — reply anytime, or roast us in the feedback tab. 💙</span></td></tr>
</table></td></tr></table></body></html>`;
}
function button(label, url) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:24px 0;"><tr>
<td style="background-color:#037EF3;background-image:linear-gradient(135deg,#037EF3,#0a66d0);border-radius:10px;">
<a href="${url}" style="display:inline-block;padding:13px 30px;color:#ffffff;font-weight:bold;text-decoration:none;font-size:14px;letter-spacing:0.3px;">${label} →</a></td></tr></table>`;
}
const h = (t) => `<p style="margin:22px 0 8px;font-size:13px;font-weight:800;letter-spacing:0.6px;text-transform:uppercase;color:#037EF3;">${t}</p>`;
const ul = (items) => `<ul style="margin:6px 0 4px;padding-left:20px;">${items.map((i) => `<li style="margin:7px 0;">${i}</li>`).join("")}</ul>`;
const callout = (html, color = "#037EF3", bg = "#f0f7ff") =>
  `<p style="border-left:4px solid ${color};background:${bg};border-radius:0 8px 8px 0;padding:12px 16px;margin:18px 0;">${html}</p>`;

// ── shared content bricks ───────────────────────────────────────────────────
const blueMan = () =>
  h("Meet The Blue Man 🔵🚶") +
  `<p style="margin:6px 0;">See the little walking guy in the corner? That's <strong>The Blue Man</strong> — Sodio's built-in AI. Ask him <em>anything</em>, in English or fluent Egyptian Arabic:</p>` +
  ul([
    `"مين الأول في الـ oGV في تركيا دلوقتي؟" — he reads AIESEC <strong>CORE</strong> live, whole world, real time.`,
    `"How do I book a visit?" — he knows this system better than the person who built it. Probably.`,
    `"Draft me a proposal for [company]" — and he'll point you to the button that does it.`,
  ]) +
  `<p style="margin:6px 0;color:#5c6b80;font-size:13px;">He only ever sees <em>your</em> data — no peeking outside your scope.</p>`;

const stunners = (extra = []) =>
  h("A few things that'll make you smile") +
  ul([
    `<strong>Proposal emails in one click</strong> — a branded, AIESEC-blue proposal drafts straight into <em>your own Gmail</em>. You just review and hit send.`,
    `<strong>It's a real app</strong> — add it to your home screen, dark mode, Arabic-friendly, works on the metro.`,
    `<strong>The archive is the blacklist</strong> — burned company names can never sneak back in.`,
    ...extra,
    `<strong>Confetti when you sign a deal</strong> 🎉 — because you earned it.`,
  ]);

const feedbackPS = `<p style="margin:20px 0 0;color:#5c6b80;font-size:13px;">P.S. Found a bug or have a wild idea? Tell The Blue Man, or hit the feedback tab — the anonymous mask 🎭 is there if you want to speak freely.</p>`;

const openBtn = button("Open Sodio", APP_URL);

// ── per-segment body builders ───────────────────────────────────────────────
const SEG = {
  lcp: (m) => ({
    subject: `Sodio is live, ${m.nick} — the whole LC's raising, in one screen 🚀`,
    pre: "Your command deck for ICX raising is live.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>Remember the 47 WhatsApp groups, the three half-dead Google Sheets, and that one voice note where someone listed all our accounts? May they rest in peace. <strong>Sodio is live.</strong></p>` +
      callout(`<strong>The big idea:</strong> one free CRM that runs the entire ICX <strong>Raising</strong> process — from "just found this company" to "deal signed 🏆" — for everyone, on their phones.`) +
      h("Your command deck, President") +
      ul([
        `Every function's funnel, live: <strong>MR → Contacted → Visits → Visits done → Deals → Opens</strong>, split by lane (IGV / IGTa / IGTe / B2B) with goals-vs-achieved bars.`,
        `<strong>Leaderboards that re-sort with an animation</strong> when you tap a column. Yes, we made a spreadsheet fun.`,
        `<strong>Test view</strong> — become any member for a moment to see <em>exactly</em> what they see. Debugging trust, not accounts.`,
        `<strong>Broadcasts</strong> from the bell 🔔 to the whole LC, one function, or hand-picked people.`,
        `And you never get the visit-reminder spam — Sodio knows the LCP steers, not chases.`,
      ]) +
      blueMan() + stunners() + openBtn + feedbackPS,
  }),

  "igv-vp": (m) => ({
    subject: `${m.nick}, your IGV cockpit just opened 🛬`,
    pre: "Set the IGV goal, watch the whole lane, edit membership in-app.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>The IGV raising machine now has a dashboard, and it's yours to drive.</p>` +
      callout(`<strong>Sodio</strong> is our free CRM for the whole ICX Raising process — one place, on everyone's phone.`) +
      h("What's now yours as IGV VP") +
      ul([
        `Set the <strong>IGV goal</strong> (month or peak) — progress bars land on your whole crew's dashboards.`,
        `One <strong>wide leaderboard</strong> of your Members & Coordinators: MR · Contacted · Visits · Done · Deals · Opens, tap any column to re-sort.`,
        `<strong>Edit membership right in the app</strong> — it writes back to the Membership sheet, so "who touched the sheet?" dies today.`,
        `Every IGV visit your members book lands on <strong>your calendar</strong> too, with the report email.`,
        `You also see <strong>B2B accounts</strong> — they raise IGV opens for you.`,
      ]) +
      blueMan() + stunners() + openBtn + feedbackPS,
  }),

  "igt-vp": (m) => ({
    subject: `${m.nick}, the IGT lane is live — and it splits itself 🧮`,
    pre: "IGTa + IGTe tracked automatically, plus the feedback inbox is yours.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>Your IGT raising world now lives in Sodio — and it does the annoying math for you.</p>` +
      callout(`<strong>Sodio</strong> is our free CRM running the whole ICX Raising process in one place.`) +
      h("What's now yours as IGT VP") +
      ul([
        `Set <strong>IGTa</strong> and <strong>IGTe</strong> goals separately — the All-IGT goal is just the sum, tracked for you.`,
        `The full <strong>wide leaderboard</strong> for your crew + <strong>in-app membership editing</strong> (writes back to the sheet).`,
        `Every IGT visit lands on <strong>your calendar</strong> with the report email; <strong>B2B accounts</strong> feed your IGT opens too.`,
        `And yes — you + Ahmed are the only two humans who read the <strong>feedback inbox</strong> 🕵️. Handle with care.`,
      ]) +
      blueMan() + stunners() + openBtn + feedbackPS,
  }),

  "b2b-lead": (m) => ({
    subject: `${m.nick}, your B2B lane is money — literally 💰`,
    pre: "Two goals (opens + EGP), the Podio worklist, whole-ICX raising.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>The Suits now have a proper cockpit — and it counts EGP, not vibes.</p>` +
      callout(`<strong>Sodio</strong> is our free CRM for the entire ICX Raising process. Your crew raises for the <em>whole</em> ICX — opens split across IGV / IGTa / IGTe.`) +
      h(`What's now yours as ${m.role === "Director" ? "B2B & BD Director" : "B2B & BD VP"}`) +
      ul([
        `Your <strong>own B2B lane</strong>, isolated and yours, with <strong>TWO goals you set</strong>: B2B in <strong>opens</strong> and BD in <strong>EGP money</strong> 💰.`,
        `<strong>BD deals are measured in money</strong> — record the EGP (+ optional benefits); the account header sums your EGP for you.`,
        `The <strong>Podio worklist</strong>: accounts pending national submission, a copy-the-name button, request states, and "ask to submit" that pings the owner.`,
        `Proposal emails use the <strong>Talent-Solutions</strong> pitch by default — the whole-programs B2B variant.`,
      ]) +
      blueMan() + stunners() + openBtn + feedbackPS,
  }),

  "igv-tl": (m) => ({
    subject: `${m.nick}, your IGV team just got superpowers 🦸`,
    pre: "Team accounts, a team goal, and visits that remind themselves.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>Leading an IGV team used to mean chasing people for updates. Not anymore.</p>` +
      callout(`<strong>Sodio</strong> is our free CRM for the whole ICX Raising process — one place, on your team's phones.`) +
      h("What's now yours as an IGV Team Leader") +
      ul([
        `<strong>Your team's accounts</strong> in one view; pick who's <strong>Responsible</strong> (you or a teammate); set the <strong>team goal</strong>.`,
        `Book a visit → <strong>calendar reminders</strong> (24h + 1h) for the responsible, shared with you and the VP.`,
        `The <strong>+2h "did it happen?"</strong> nudge, and a firmer one a week later if it's still unreported — so nothing rots.`,
        `A team <strong>leaderboard</strong> so your crew can flex their numbers at each other.`,
      ]) +
      blueMan() + stunners() + openBtn + feedbackPS,
  }),

  "igt-tl": (m) => ({
    subject: `${m.nick}, ${m.team ? `${m.team} ` : "your IGT team "}now runs on Sodio ⚙️`,
    pre: "Team accounts, a team goal, self-reminding visits.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>Your IGT squad just traded the group chat for a real cockpit.</p>` +
      callout(`<strong>Sodio</strong> is our free CRM for the whole ICX Raising process, on everyone's phone.`) +
      h("What's now yours as an IGT Team Leader") +
      ul([
        `${m.team ? `<strong>${m.team}</strong> gets` : "Your team gets"} its own <strong>goal</strong> and its own <strong>leaderboard</strong>.`,
        `Your team's IGT accounts in one view; pick the <strong>Responsible</strong>; opens split IGTa + IGTe automatically.`,
        `Book a visit → <strong>calendar reminders</strong> (24h + 1h), shared with the VP; the <strong>+2h nudge</strong> and a week-later reminder keep visits from rotting.`,
      ]) +
      blueMan() + stunners() + openBtn + feedbackPS,
  }),

  "b2b-tl": (m) => ({
    subject: `${m.nick}, your B2B squad now closes in EGP 💼`,
    pre: "Money deals, the Podio worklist, whole-ICX raising.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>The Suits' team lane is live — and it speaks money.</p>` +
      callout(`<strong>Sodio</strong> is our free CRM for the whole ICX Raising process. Your crew raises for the <em>whole</em> ICX — opens split across IGV / IGTa / IGTe.`) +
      h("What's now yours as a B2B & BD Team Leader") +
      ul([
        `Your team's <strong>B2B/BD accounts</strong>; pick the Responsible; set the team goal.`,
        `<strong>BD deals in EGP</strong> — record the money (+ optional benefits); the account sums it for you.`,
        `The <strong>Podio worklist</strong> to push accounts toward national submission (copy-name, request states, "ask to submit").`,
      ]) +
      blueMan() + stunners() + openBtn + feedbackPS,
  }),

  // ── generic launch fallbacks (member/coordinator in a live function) ──
  "igv-member": (m) => ({
    subject: `${m.nick}, your IGV raising toolkit is live 🚀`,
    pre: "Your accounts, your visits, your opens — one app.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>Everything you raise now lives in one place — and it reminds <em>you</em>, not the other way round.</p>` +
      callout(`<strong>Sodio</strong> is our free CRM for the whole ICX Raising process.`) +
      h("Your daily flow") +
      ul([
        `Add an account → log every contact → "Visit Scheduled" books it with <strong>calendar reminders</strong> → report it → <strong>Record deal 🏆</strong>.`,
        `Every in-process account keeps a <strong>next step with a date</strong>, so nothing slips.`,
        `<strong>My numbers</strong> shows your personal KPIs — your own little MOS tracker.`,
      ]) +
      blueMan() + stunners() + openBtn + feedbackPS,
  }),
  "igt-member": (m) => ({ ...SEG["igv-member"](m), subject: `${m.nick}, your IGT raising toolkit is live 🚀` }),
  "icx-member": (m) => ({ ...SEG["igv-member"](m), subject: `${m.nick}, your ICX raising toolkit is live 🚀` }),
  "b2b-member": (m) => ({ ...SEG["igv-member"](m), subject: `${m.nick}, your B2B raising toolkit is live 💼` }),
  "icx-vp": (m) => SEG["igv-vp"](m),
  "icx-tl": (m) => SEG["igv-tl"](m),

  // ── stay-tuned ──
  "soon-tm": (m) => ({
    subject: `${m.nick}, your Sodio module is warming up 👀 (peek inside)`,
    pre: "TM directory + Playbook are already live; the full module is next.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>You've probably heard the IGV / IGT / B2B crews bragging about their shiny new CRM. Here's the deal: <strong>yours is coming</strong> — and you already get a head start.</p>` +
      callout(`<strong>Sodio</strong> is our own free CRM. Right now it runs ICX <strong>Raising</strong>; the full <strong>Talent Management</strong> module is next on the runway.`) +
      h("You can already peek") +
      ul([
        `The <strong>Members directory</strong> — the whole LC, teams, managers, per-member KPIs, with call / WhatsApp / email shortcuts.`,
        `The <strong>Playbook</strong> — the role-organized manual for the whole system.`,
        `And <strong>The Blue Man</strong> 🔵 — our AI agent who reads AIESEC CORE live and talks fluent Egyptian Arabic.`,
      ]) +
      `<p style="margin:14px 0 0;">The full TM module (pipelines, MOS, the works) is being built. We'll ping you the second it lands.</p>` +
      button("Peek at Sodio", APP_URL) +
      `<p style="margin:20px 0 0;color:#5c6b80;font-size:13px;">P.S. Pinky promise you'll be the first to know. 🤙</p>`,
  }),
  "soon-ogx": (m) => ({
    subject: `${m.nick}, OGX on Sodio is coming — stay tuned 👀`,
    pre: "The ICX raising crew is live; OGX is high on the list.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>The ICX raising crews just got a brand-new CRM, and the group chats are <em>loud</em>. Your turn is coming.</p>` +
      callout(`<strong>Sodio</strong> is our own free CRM. Today it runs ICX <strong>Raising</strong>; <strong>OGX</strong> is a big one and it's high on the build list.`) +
      h("What you'll get") +
      ul([
        `Your whole process in one place, on your phone — no more scattered sheets.`,
        `<strong>The Blue Man</strong> 🔵 — an AI agent who reads AIESEC CORE live (global rankings, real time) and talks fluent Egyptian Arabic.`,
        `Goals, leaderboards, calendar reminders, one-click branded emails — the works.`,
      ]) +
      `<p style="margin:14px 0 0;">Meanwhile you can sign in, explore the Playbook, and say hi to The Blue Man.</p>` +
      button("Explore Sodio", APP_URL) +
      `<p style="margin:20px 0 0;color:#5c6b80;font-size:13px;">P.S. We'll email you the second OGX goes live. 🤙</p>`,
  }),
  "soon-fl": (m) => ({
    subject: `${m.nick}, Sodio has a seat reserved for F&L 👀`,
    pre: "ICX raising is live; your finance module is on the plan.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>The ICX crews are already living in our new CRM. F&L, your module is on the plan.</p>` +
      callout(`<strong>Sodio</strong> is our own free CRM. Today it runs ICX <strong>Raising</strong>; more functions — yours included — are being built on the same engine.`) +
      h("What's coming your way") +
      ul([
        `Your workflow in one place, on your phone.`,
        `<strong>The Blue Man</strong> 🔵 — an AI agent who reads AIESEC CORE live and talks fluent Egyptian Arabic.`,
        `Clean dashboards and one-click branded emails.`,
      ]) +
      `<p style="margin:14px 0 0;">Sign in anytime to explore the Playbook and meet The Blue Man.</p>` +
      button("Explore Sodio", APP_URL) +
      `<p style="margin:20px 0 0;color:#5c6b80;font-size:13px;">P.S. You'll be the first to know. 🤙</p>`,
  }),
  // soon-b2c / soon-cxp / soon-generic are assigned just below (they reuse
  // the soonGeneric factory, which is hoisted).
};

function soonGeneric(fn) {
  return (m) => ({
    subject: `${m.nick}, your Sodio module is on the way 👀`,
    pre: "ICX raising is live; your module is being built next.",
    body:
      `<p>Yalla ${m.nick} 👋</p>` +
      `<p>The ICX raising crews just got a brand-new CRM and won't stop talking about it. ${fn ? `${fn}, your` : "Your"} module is being built.</p>` +
      callout(`<strong>Sodio</strong> is our own free CRM. Today it runs ICX <strong>Raising</strong>; more functions are coming on the same engine — yours included.`) +
      h("What you'll get") +
      ul([
        `Your whole process in one place, on your phone.`,
        `<strong>The Blue Man</strong> 🔵 — an AI agent who reads AIESEC CORE live (global, real time) and talks fluent Egyptian Arabic.`,
        `Goals, leaderboards, calendar reminders, and one-click branded emails.`,
      ]) +
      `<p style="margin:14px 0 0;">Meanwhile, sign in to explore the Playbook and say hi to The Blue Man.</p>` +
      button("Explore Sodio", APP_URL) +
      `<p style="margin:20px 0 0;color:#5c6b80;font-size:13px;">P.S. We'll email you the moment it's live. 🤙</p>`,
  });
}
// resolve the two thunk-wrapped soon variants
SEG["soon-b2c"] = soonGeneric("B2C");
SEG["soon-cxp"] = soonGeneric("CXP");
SEG["soon-generic"] = soonGeneric(null);

// ── Gmail draft creation ────────────────────────────────────────────────────
function encodeHeader(v) {
  return /^[\x20-\x7e]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v).toString("base64")}?=`;
}
async function createDraft(gmail, to, subject, html) {
  const raw = [
    `From: ${encodeHeader(SENDER_NAME)} <${SENDER}>`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(html).toString("base64"),
  ].join("\r\n");
  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: { message: { raw: Buffer.from(raw).toString("base64url") } },
  });
  return res.data.id ?? null;
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const url = `${SUPA_URL}/rest/v1/members?is_active=eq.true&select=name,nickname,email,role,functions,sub_functions,team_name`;
  const res = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!res.ok) { console.error(`✖ Supabase fetch failed: ${res.status} ${await res.text()}`); process.exit(1); }
  const members = await res.json();

  const senderLc = SENDER.toLowerCase();
  const plan = [];
  for (const m of members) {
    const email = (m.email || "").toLowerCase();
    if (!email) continue;
    if (email === senderLc) continue; // never email the sender/reviewer himself
    const seg = segmentOf(m);
    if (ONLY.length && !ONLY.includes(seg)) continue;
    const ctx = { nick: m.nickname || m.name.split(" ")[0], name: m.name, role: m.role, team: m.team_name };
    const builder = SEG[seg];
    if (!builder) { console.warn(`  ! no builder for segment ${seg} (${m.name}) — skipped`); continue; }
    const { subject, pre, body } = builder(ctx);
    plan.push({ email: m.email, name: m.name, role: m.role, seg, kind: isLaunch(seg) ? "LAUNCH" : "stay-tuned", subject, html: layout(pre, body) });
  }

  plan.sort((a, b) => (a.kind === b.kind ? a.seg.localeCompare(b.seg) : a.kind === "LAUNCH" ? -1 : 1));
  const launch = plan.filter((p) => p.kind === "LAUNCH").length;
  console.log(`\n📬 ${plan.length} draft(s) planned — ${launch} launch, ${plan.length - launch} stay-tuned${DRY ? "  (DRY RUN — nothing created)" : ""}\n`);
  for (const p of plan) {
    console.log(`  ${p.kind === "LAUNCH" ? "🚀" : "⏳"} [${p.seg.padEnd(12)}] ${p.name.padEnd(22)} <${p.email}>`);
    console.log(`      ${p.subject}`);
  }

  if (EMIT) {
    mkdirSync(EMIT, { recursive: true });
    for (const p of plan) writeFileSync(join(EMIT, `${p.seg}__${p.name.replace(/[^\w]+/g, "_")}.html`), p.html);
    console.log(`\n💾 Wrote ${plan.length} HTML previews to ${EMIT}\n`);
  }

  if (DRY) { console.log("\n(Preview only. Re-run without --dry to create the drafts.)\n"); return; }

  const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET);
  oauth2.setCredentials({ refresh_token: REFRESH });
  const gmail = google.gmail({ version: "v1", auth: oauth2 });

  console.log(`\nCreating drafts in ${SENDER} …\n`);
  let ok = 0;
  for (const p of plan) {
    try {
      const id = await createDraft(gmail, p.email, p.subject, p.html);
      ok++;
      console.log(`  ✅ ${p.name.padEnd(22)} draft ${id}`);
    } catch (e) {
      console.error(`  ✖ ${p.name.padEnd(22)} ${e?.message || e}`);
    }
  }
  console.log(`\n✅ Done — ${ok}/${plan.length} drafts created in ${SENDER}'s Drafts folder. Review and send them by hand.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
