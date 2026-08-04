/**
 * LB LAUNCH DRAFTS (v33) — one Gmail DRAFT per Leadership Body member.
 *
 * These people already know what Sodio is. They sat through the session. So
 * this is NOT a tutorial: it's the "it's live, it's yours, here's your lever"
 * email — short, specific to the person, and a bit funny. The EB gets a
 * different letter from the MMs, because their lever is different.
 *
 * NOTHING IS SENT. Every message lands in the sender's Drafts folder to be
 * read and sent by hand.
 *
 *   node scripts/draft-lb-announcements.mjs --dry      # plan only
 *   node scripts/draft-lb-announcements.mjs --emit=/tmp/lb   # + HTML previews
 *   node scripts/draft-lb-announcements.mjs            # create the drafts
 */

import { readFileSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { google } from "googleapis";

const DRY = process.argv.includes("--dry");
const EMIT = (process.argv.find((a) => a.startsWith("--emit=")) || "").replace("--emit=", "");

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
const APP_URL = (get("NEXT_PUBLIC_APP_URL") || "https://sodio.vercel.app").replace(/\/$/, "");

// ── the LB, per the system's own rule ───────────────────────────────────────
const LB_ROLES = ["LCP", "LCVP", "Director", "Team Leader", "Coordinator"];
const isEb = (m) => m.role === "LCP" || m.role === "LCVP";

// ── look ────────────────────────────────────────────────────────────────────
const layout = (pre, body) => `<!DOCTYPE html><html><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width"></head>
<body style="margin:0;padding:0;background:#eef3fa;font-family:'Segoe UI',Arial,sans-serif;">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${pre}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#eef3fa;padding:26px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:620px;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 10px 30px -12px rgba(3,126,243,.35);">
<tr><td style="background:linear-gradient(135deg,#037EF3,#0a5fd0 55%,#0A2540);padding:26px 30px;">
  <p style="margin:0;color:#fff;font-size:22px;font-weight:800;letter-spacing:-.3px;">Sodio</p>
  <p style="margin:4px 0 0;color:rgba(255,255,255,.82);font-size:13px;">AIESEC in Alexandria</p>
</td></tr>
<tr><td style="padding:28px 30px 8px;color:#0f172a;font-size:15px;line-height:1.65;">${body}</td></tr>
<tr><td style="padding:18px 30px 26px;">
  <p style="margin:0;color:#8595a8;font-size:12px;">Sent by Sodio · <a href="${APP_URL}" style="color:#037EF3;">${APP_URL.replace(/^https?:\/\//, "")}</a></p>
</td></tr>
</table></td></tr></table></body></html>`;

const btn = (label, url) =>
  `<p style="margin:22px 0 6px;"><a href="${url}" style="display:inline-block;background:#037EF3;color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 26px;border-radius:10px;">${label}</a></p>`;
const h = (t) =>
  `<p style="margin:24px 0 6px;font-size:12px;font-weight:800;letter-spacing:.7px;text-transform:uppercase;color:#037EF3;">${t}</p>`;
const ul = (items) =>
  `<ul style="margin:6px 0 4px;padding-left:20px;">${items.map((i) => `<li style="margin:7px 0;">${i}</li>`).join("")}</ul>`;
const note = (html) =>
  `<div style="margin:18px 0;padding:13px 16px;background:#f0f7ff;border-left:4px solid #037EF3;border-radius:8px;font-size:14px;">${html}</div>`;

// ── what's actually new, per function ───────────────────────────────────────
const FN_LEVER = {
  IGV: "Your lane is split properly now — <b>IGV Raising</b> and <b>IGV Consideration</b> are separate dashboards, and your people only see the side they actually work.",
  IGT: "IGT finally reads right: <b>IGT Raising, IGTa, IGTe</b> and <b>IGT Consideration</b> are four lanes, not one blur. The CV pool is yours alone now — it's a talent hunt, not a volunteer one.",
  OGT: "OGT sign-ups, the funnel, and the 🔥 streak board — which now covers <b>all of OGX</b>, not just OGV, and can't be gamed any more (undo a contact and the day is gone).",
  OGV: "OGV's streak board grew up: it covers <b>all of OGX</b>, shows today's contact count next to every name, and — this is the fun part — you can see it too, not just your MMs.",
  B2C: "B2C is its own island, the way it should be: your own lane, your own archive, and a name IGV burned no longer blocks you from selling them a course.",
  BD: "BD has <b>its own dashboard</b> now — separate from B2B, because you sell partnerships and they raise opens, and mixing the two made both numbers meaningless.",
  B2B: "The B2B lane is yours, and BD's numbers no longer sit on top of it.",
  TM: "Touch points, attendance, appeals and the whole LC calendar — plus you now read <b>every</b> function's dashboard, because you review every function's people.",
  "F&L": "You read <b>every</b> lane now — every function's funnel, money and plan, without having to ask anyone for a screenshot.",
  CXP: "Your workspace is still on the way — but the LC-wide calendar, attendance and feedback are already yours.",
};

const blueMan = `<b>The Blue Man</b> 🚶 got sharper this week: he answers in <i>your</i> question's language (he used to reply in Arabic to English questions — sorry), he stopped refusing things he actually has the data for, and he gives you the whole answer instead of one line.`;

// ── the two letters ─────────────────────────────────────────────────────────
function ebLetter(c) {
  const lever = FN_LEVER[c.fn] || "";
  return {
    subject: `${c.nick}, Sodio is live — and the whole LC is watching you use it`,
    pre: "Your function's numbers, your plan, your people — all live.",
    body: `
<p style="margin:0;">${c.nick} 👋</p>
<p>You already know what Sodio does — you sat through the session. So no tour.
Just this: <b>it's live, it's got your real data in it, and from here the LC
copies whatever you do with it.</b></p>
<p>That last part isn't flattery, it's the actual mechanic. If your MMs see you
open the dashboard on a Tuesday, they log their contacts on a Monday. If they
never see you in it, no feature I build will save it.</p>
${lever ? note(lever) : ""}
${h("What's yours specifically")}
${ul([
  "<b>Your whole function's funnel</b> — MR → Contacted → Visits → Done → Deals → Opens, with the conversion between every step. No more asking for numbers.",
  "<b>The plan is the goal.</b> Nobody sets targets in Sodio — your planning sheet is the target, and the dashboard tracks against it automatically.",
  "<b>Leaderboards</b> that rank on any column you tap, and now break ties sensibly (deeper work wins).",
  "<b>Your MMs' plans</b>, filed and visible, so a team with no plan is obvious instead of invisible.",
])}
${h("Two things worth ten minutes")}
${ul([
  `<b>The calendar Timeline button.</b> Set your routine once — "function meeting every Tuesday 7pm" — and it books the whole peak in one click. Make one of them <b>virtual</b> and people's Yes/No on the invite fills in the attendance for you.`,
  "<b>Feedback about people</b> — a 🎉 goes straight to them, a 😟 goes privately to the LCP and TM. Both are anonymous if you want.",
])}
<p style="margin-top:18px;">${blueMan}</p>
${btn("Open your dashboard", `${APP_URL}/dashboard`)}
<p style="margin:16px 0 0;">Break it and tell me what broke. That's genuinely more
useful to me than a compliment. 💙</p>
<p style="margin:14px 0 0;color:#5c6b80;font-size:13px;">— Ahmed, IM</p>`,
  };
}

function mmLetter(c) {
  const lever = FN_LEVER[c.fn] || "";
  const teamLine =
    c.role === "Team Leader"
      ? `<b>Your team's numbers are on your dashboard</b> — not the whole function's, yours. Every account your members work rolls up there, and your filed plan sits next to it as the target.`
      : `<b>Your own numbers are on your dashboard</b>, and your filed plan sits next to them as the target.`;
  return {
    subject: `${c.nick}, Sodio is live — your team's numbers are already in it`,
    pre: "It's live, it's got your real data, and it's yours.",
    body: `
<p style="margin:0;">${c.nick} 👋</p>
<p>You know the pitch already, so I'll skip it. <b>Sodio is live, your real
accounts and people are in it, and nothing here needs a training session.</b></p>
${note(teamLine)}
${lever ? `<p>${lever}</p>` : ""}
${h("The three that save you the most time")}
${ul([
  "<b>Adding an account checks itself.</b> Type the name and Sodio tells you instantly whether it's already in the CRM, whether it's in the archive, and — new — whether it's <b>already on Podio</b>. No more opening the national form in another tab.",
  "<b>Quick actions log themselves.</b> Tap WhatsApp, call or email on any row and the contact form opens with the channel already picked. Every result is there, including the ones that branch — <i>Not interested</i> archives it, <i>Visit scheduled</i> books the visit.",
  "<b>Reporting a visit now asks what came out of it</b> — interested, not interested, sending the proposal, not ready yet — and does the right next thing for each one instead of leaving you a blank box.",
])}
${h("And the bit people actually enjoy")}
<p>The <b>calendar</b> holds your meetings, visits and IR calls in one month view.
Your <b>Timeline</b> books your whole routine for the peak in one go. And
attendance stops being a WhatsApp argument — a virtual touch point takes it from
everyone's Yes/No on the invite.</p>
<p style="margin-top:18px;">${blueMan} Ask him <i>"which of my accounts has no next step?"</i> and see.</p>
${btn("Open Sodio", APP_URL)}
<p style="margin:16px 0 0;">If something's wrong or slow or ugly — the feedback
tab, or just reply to this. The 🎭 anonymous option is there if you'd rather be
blunt. 💙</p>
<p style="margin:14px 0 0;color:#5c6b80;font-size:13px;">— Ahmed, IM</p>`,
  };
}

function encodeHeader(v) {
  return /^[\x20-\x7E]*$/.test(v) ? v : `=?UTF-8?B?${Buffer.from(v, "utf8").toString("base64")}?=`;
}
async function createDraft(gmail, to, subject, html) {
  const raw = Buffer.from(
    [
      `From: ${encodeHeader(SENDER_NAME)} <${SENDER}>`,
      `To: ${to}`,
      `Subject: ${encodeHeader(subject)}`,
      "MIME-Version: 1.0",
      'Content-Type: text/html; charset="UTF-8"',
      "",
      html,
    ].join("\r\n"),
    "utf8"
  )
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const res = await gmail.users.drafts.create({ userId: "me", requestBody: { message: { raw } } });
  return res.data.id;
}

async function main() {
  const url = `${SUPA_URL}/rest/v1/members?is_active=eq.true&select=name,nickname,email,role,functions,sub_functions,team_name`;
  const res = await fetch(url, { headers: { apikey: SUPA_KEY, Authorization: `Bearer ${SUPA_KEY}` } });
  if (!res.ok) { console.error(`✖ Supabase fetch failed: ${res.status}`); process.exit(1); }
  const members = await res.json();

  const plan = [];
  for (const m of members) {
    if (!LB_ROLES.includes(m.role)) continue;
    if (!m.email) { console.warn(`  ! ${m.name} has no email — skipped`); continue; }
    const fns = [...(m.functions || []), ...(m.sub_functions || [])];
    const fn = ["IGV", "IGT", "OGT", "OGV", "B2C", "BD", "B2B", "TM", "F&L", "CXP"].find((f) => fns.includes(f)) || "";
    const ctx = { nick: m.nickname || m.name.split(" ")[0], name: m.name, role: m.role, fn };
    const letter = isEb(m) ? ebLetter(ctx) : mmLetter(ctx);
    plan.push({
      email: m.email, name: m.name, role: m.role, fn,
      band: isEb(m) ? "EB" : "MM",
      subject: letter.subject, html: layout(letter.pre, letter.body),
    });
  }

  plan.sort((a, b) => (a.band === b.band ? a.name.localeCompare(b.name) : a.band === "EB" ? -1 : 1));
  const eb = plan.filter((p) => p.band === "EB").length;
  console.log(`\n📬 ${plan.length} LB draft(s) — ${eb} EB, ${plan.length - eb} MM${DRY ? "   (DRY RUN)" : ""}\n`);
  for (const p of plan) {
    console.log(`  ${p.band === "EB" ? "👑" : "⚡"} ${p.role.padEnd(12)} ${p.name.padEnd(24)} ${(p.fn || "—").padEnd(5)} <${p.email}>`);
  }

  if (EMIT) {
    mkdirSync(EMIT, { recursive: true });
    for (const p of plan) writeFileSync(join(EMIT, `${p.band}__${p.name.replace(/[^\w]+/g, "_")}.html`), p.html);
    console.log(`\n💾 ${plan.length} HTML previews → ${EMIT}\n`);
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
      console.log(`  ✅ ${p.name.padEnd(24)} ${id}`);
    } catch (e) {
      console.error(`  ✖ ${p.name.padEnd(24)} ${e?.message || e}`);
    }
  }
  console.log(`\n✅ ${ok}/${plan.length} drafts in ${SENDER}'s Drafts. Nothing was sent — review and send by hand.\n`);
}

main().catch((e) => { console.error(e); process.exit(1); });
